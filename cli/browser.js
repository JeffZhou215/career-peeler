// Playwright driver for content.js, replacing the extension's chrome.tabs.*/chrome.scripting/
// chrome.runtime.sendMessage plumbing. content.js itself is never modified -- it's read verbatim
// and registered as a context-level init script (NOT page.addScriptTag: real sites like
// jobs.apple.com send a strict Content-Security-Policy that blocks <script>-tag injection outright;
// addInitScript uses Playwright's CDP-level injection, which is exempt from page CSP the same way a
// real extension content script is). Because addInitScript reruns on every navigation and new page
// in the context automatically, content.js is always present -- there's no equivalent of
// background.js's sendMessageWithFallback inject-on-failure dance needed here.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const CONTENT_JS_PATH = path.join(__dirname, "..", "content.js");

// Functions cli/browser.js calls directly via page.evaluate(). content.js declares these as plain
// top-level `function`s, which would normally become window properties for a real <script> tag
// (and did, throughout this project's Playwright-based test scripts, which use page.addScriptTag).
// addInitScript is different: verified empirically that its top-level function/const declarations
// do NOT persist across separate page.evaluate() calls the way addScriptTag's do, even though both
// run "in the page" -- only explicit window.x = ... assignments survive. So the injected source
// gets this export tail appended, exactly mirroring the `globalThis.__contentTestApi = {...}`
// convention the tests/*.test.js VM harnesses already use to expose internals for assertions.
const EXPOSED_FUNCTION_NAMES = [
  "getSiteConfig",
  "getCurrentUrl",
  "getJobId",
  "getJobTitle",
  "getSubmittedSignal",
  "collectJobLinks",
  "waitForJobListToSettle",
  "getJobListStats",
  "getNextPageControl",
  "getCurrentResultsPage",
  "goToNextPage",
  "extractJobDetails",
  "runApplicationWorkflowStep"
];

function readContentJsSource() {
  const source = fs.readFileSync(CONTENT_JS_PATH, "utf8");
  const exportTail = EXPOSED_FUNCTION_NAMES.map((name) => `window.${name} = ${name};`).join("\n");
  return `${source}\n${exportTail}`;
}

// Bridges content.js's one outbound chrome.runtime.sendMessage call (APPLE_CAREERS_GENERATE_ANSWER,
// used by answerOpenTextQuestion() to ask for an LLM-drafted answer). Every other message type in
// content.js's dispatcher is simply never exercised here -- the CLI calls content.js's functions
// directly via page.evaluate() instead of going through chrome.runtime.onMessage/sendResponse.
async function installChromeStub(context, { generateAnswer }) {
  await context.exposeFunction("__careerPeelerGenerateAnswer", async (questionText, jobId) => {
    try {
      return await generateAnswer(questionText, jobId);
    } catch (error) {
      return { ok: false, error: error?.message || "The request failed." };
    }
  });

  await context.addInitScript(`
    window.chrome = {
      runtime: {
        sendMessage: (msg) =>
          msg && msg.type === "APPLE_CAREERS_GENERATE_ANSWER"
            ? window.__careerPeelerGenerateAnswer(msg.questionText, msg.jobId)
            : Promise.resolve({ ok: false, error: "Unhandled message type in CLI stub: " + (msg && msg.type) }),
        onMessage: { addListener() {} }
      }
    };
  `);
}

async function launchContext({ dataDir, headless = false, generateAnswer }) {
  const userDataDir = path.join(dataDir, "browser-profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: null
  });

  // Registration order = execution order for addInitScript: the chrome stub must exist before
  // content.js's trailing chrome.runtime.onMessage.addListener(...) call runs.
  await installChromeStub(context, { generateAnswer });
  await context.addInitScript({ content: readContentJsSource() });

  return context;
}

async function openPage(context, url) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" }).catch(() => {});
  return page;
}

async function waitForPageLoad(page, timeoutMs) {
  await page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => {});
}

// content.js's goToNextPage() "navigate" branch does `window.location.href = url` and returns
// synchronously -- a real race against the navigation destroying the current JS execution context.
// If that race is lost, page.evaluate() throws; addInitScript already guarantees content.js is
// re-present on the new document, so just wait for it to settle and report what happened.
async function goToNextPageOnPage(page) {
  try {
    return await page.evaluate(() => goToNextPage());
  } catch (error) {
    if (!/context was destroyed|Execution context/i.test(error?.message || "")) {
      throw error;
    }
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    return { ok: true, action: "navigate", navigatedAway: true };
  }
}

async function collectJobLinksOnPage(page) {
  return page.evaluate(async () => {
    await waitForJobListToSettle();
    const siteConfig = getSiteConfig();
    const currentUrl = getCurrentUrl();
    const currentJob =
      siteConfig?.isJobDetailUrl(currentUrl) || siteConfig?.isApplicationUrl(currentUrl)
        ? {
            site: siteConfig.id,
            siteLabel: siteConfig.label,
            url: window.location.href,
            jobId: getJobId(),
            title: getJobTitle(),
            alreadyAppliedFromList: Boolean(getSubmittedSignal()),
            isCurrentPage: true
          }
        : null;
    const links = collectJobLinks();

    return {
      site: siteConfig?.id || "unknown",
      siteLabel: siteConfig?.label || "Unsupported site",
      url: window.location.href,
      currentPage: getCurrentResultsPage(),
      currentJob,
      links,
      listStats: getJobListStats(links),
      hasNextPage: Boolean(getNextPageControl())
    };
  });
}

async function extractJobDetailsOnPage(page, { userYearsOfExperience, noMatchKeywords } = {}) {
  return page.evaluate(
    ({ userYearsOfExperience: yoe, noMatchKeywords: keywords }) =>
      extractJobDetails({ userYearsOfExperience: yoe, noMatchKeywords: keywords }),
    { userYearsOfExperience, noMatchKeywords }
  );
}

async function runApplicationWorkflowStepOnPage(page) {
  return page.evaluate(() => runApplicationWorkflowStep());
}

function tabMatchesApplication(page, siteConfig, jobId) {
  let parsedUrl;
  try {
    parsedUrl = new URL(page.url());
  } catch (_error) {
    return false;
  }

  if (!siteConfig?.isSupportedUrl(parsedUrl)) {
    return false;
  }

  if (siteConfig.isApplicationUrl?.(parsedUrl)) {
    return !jobId || parsedUrl.href.includes(jobId);
  }

  return false;
}

async function waitForApplicationPage(context, previousPages, siteConfig, jobId, timeoutMs = 8000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const applicationPage = context.pages().find(
      (candidate) => !previousPages.has(candidate) && tabMatchesApplication(candidate, siteConfig, jobId)
    );

    if (applicationPage) {
      await waitForPageLoad(applicationPage, timeoutMs);
      return applicationPage;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return null;
}

module.exports = {
  readContentJsSource,
  launchContext,
  openPage,
  waitForPageLoad,
  goToNextPageOnPage,
  collectJobLinksOnPage,
  extractJobDetailsOnPage,
  runApplicationWorkflowStepOnPage,
  tabMatchesApplication,
  waitForApplicationPage
};
