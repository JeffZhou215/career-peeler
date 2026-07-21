#!/usr/bin/env node
// Command-line entry point. Kept deliberately thin: argv parsing + terminal output only, all real
// logic lives in cli/orchestrator.js (Playwright-driven scan/apply flow) and cli/store.js (JSON
// persistence) -- both built on the same lib/core.js the Chrome extension's background.js uses.
const { parseArgs } = require("node:util");
const readline = require("node:readline/promises");
const process = require("node:process");

const core = require("../lib/core.js");
const { createStore, defaultDataDir } = require("./store.js");
const browser = require("./browser.js");
const orchestrator = require("./orchestrator.js");

const LOGIN_URLS = {
  apple: "https://jobs.apple.com/en-us/search",
  tiktok: "https://careers.tiktok.com/position"
};

function printUsage() {
  console.log(`Career Peeler CLI

Usage:
  career-peeler login <apple|tiktok>     Open a browser to log in once; the session persists.
  career-peeler config [--set k=v ...]   View or update your matching/apply profile.
  career-peeler scan <list-url>          Scan a job list page (and apply, if enabled).
  career-peeler apply <application-url>  Run the apply workflow on an already-open application page.
  career-peeler status                   Print the current/last scan status.
  career-peeler stop                     Stop a scan running in another terminal.
  career-peeler history [--clear]        Print or clear locally tracked job records.

Common flags:
  --data-dir <path>   Override the data directory (default: ~/.career-peeler, or
                      $CAREER_PEELER_DATA_DIR).
  --headless          Run the browser headless (scan/apply/login default to a visible window).
  --scan-only         Force scan-only mode for this run, regardless of the saved profile.
  --auto-apply        Force auto-apply mode for this run, regardless of the saved profile.
`);
}

function printStatusLine(scanState) {
  const stats = scanState.stats || {};
  console.log(
    `[${scanState.phase}] scanned=${scanState.scanned} queued=${scanState.queued} ` +
      `applied=${stats.applied || 0} likely_match=${stats.likelyMatch || 0} likely_skip=${stats.likelySkip || 0} ` +
      `reviewed=${stats.reviewed || 0} needs_review=${stats.needsReview || 0} errors=${stats.errors || 0}`
  );
}

async function withBrowserContext(dataDir, headless, store, run) {
  const generateAnswer = async (questionText, jobId) => {
    const job = store.getJobRecord(jobId);
    const userProfile = store.getProfile();
    return core.generateFreeTextAnswer({ questionText, job, userProfile });
  };

  const context = await browser.launchContext({ dataDir, headless, generateAnswer });
  try {
    return await run(context);
  } finally {
    await context.close();
  }
}

async function commandLogin(positionals, values) {
  const site = positionals[0];
  const url = LOGIN_URLS[site];

  if (!url) {
    console.error("Usage: career-peeler login <apple|tiktok>");
    process.exitCode = 1;
    return;
  }

  const dataDir = values["data-dir"] || defaultDataDir();
  const store = createStore(dataDir);

  await withBrowserContext(dataDir, false, store, async (context) => {
    const page = await context.newPage();
    await page.goto(url);
    console.log(`Opened ${url}`);
    console.log("Log in (including any 2FA) in that window, then come back here and press Enter.");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question("");
    rl.close();

    await page.close();
    console.log("Session saved. Future `career-peeler scan`/`apply` runs will reuse it.");
  });
}

async function commandConfig(positionals, values) {
  const dataDir = values["data-dir"] || defaultDataDir();
  const store = createStore(dataDir);

  const setPairs = values.set || [];
  if (setPairs.length > 0) {
    const updates = {};
    for (const pair of setPairs) {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) {
        console.error(`Ignoring malformed --set value (expected key=value): ${pair}`);
        continue;
      }
      const key = pair.slice(0, eqIndex);
      const rawValue = pair.slice(eqIndex + 1);
      if (key === "userYearsOfExperience") {
        updates[key] = Number(rawValue);
      } else if (key === "llmEnabled" || key === "autoApplyConsent") {
        updates[key] = rawValue === "true";
      } else if (key === "noMatchKeywords") {
        updates[key] = rawValue.split(",").map((term) => term.trim());
      } else {
        updates[key] = rawValue;
      }
    }
    const saved = store.saveProfile({ ...store.getProfile(), ...updates });
    console.log("Saved profile:");
    console.log(JSON.stringify({ ...saved, llmApiKey: saved.llmApiKey ? "(set)" : "" }, null, 2));
    return;
  }

  const profile = store.getProfile();
  console.log(JSON.stringify({ ...profile, llmApiKey: profile.llmApiKey ? "(set)" : "" }, null, 2));
  console.log("\nUpdate with: career-peeler config --set key=value [--set key2=value2 ...]");
  console.log(
    "Keys: userYearsOfExperience, scanMode (scan_only|auto_apply), autoApplyConsent (true|false), " +
      "llmEnabled (true|false), llmApiKey, llmModel, resumeProfile, noMatchKeywords (comma-separated)"
  );
}

async function commandScan(positionals, values) {
  const listUrl = positionals[0];

  if (!listUrl) {
    console.error("Usage: career-peeler scan <list-url> [--scan-only | --auto-apply] [--headless]");
    process.exitCode = 1;
    return;
  }

  const dataDir = values["data-dir"] || defaultDataDir();
  const headless = Boolean(values.headless);
  const store = createStore(dataDir);

  const profile = store.getProfile();
  if (values["scan-only"]) {
    profile.scanMode = "scan_only";
  } else if (values["auto-apply"]) {
    profile.scanMode = "auto_apply";
  }

  await withBrowserContext(dataDir, headless, store, async (context) => {
    let stopping = false;
    const onSignal = () => {
      if (stopping) {
        console.log("\nForce exiting.");
        process.exit(1);
      }
      stopping = true;
      console.log("\nStopping after the current step finishes (press Ctrl+C again to force exit)...");
      orchestrator.stopScan(store);
    };
    process.on("SIGINT", onSignal);

    console.log(`Scanning ${listUrl} (${profile.scanMode === "auto_apply" ? "auto-apply" : "scan-only"} mode)...`);

    let lastPhase = null;
    const progressTimer = setInterval(() => {
      if (store.scanState.phase !== lastPhase) {
        lastPhase = store.scanState.phase;
        printStatusLine(store.scanState);
      }
    }, 500);

    try {
      const result = await orchestrator.startScan(context, store, listUrl, profile);
      if (!result.ok) {
        console.error(`Could not start scan: ${result.error}`);
        process.exitCode = 1;
        return;
      }
    } finally {
      clearInterval(progressTimer);
      process.removeListener("SIGINT", onSignal);
    }

    printStatusLine(store.scanState);
    console.log(`Done: ${store.scanState.phase}`);
  });
}

async function commandApply(positionals, values) {
  const applicationUrl = positionals[0];

  if (!applicationUrl) {
    console.error("Usage: career-peeler apply <application-url>");
    process.exitCode = 1;
    return;
  }

  const dataDir = values["data-dir"] || defaultDataDir();
  const headless = Boolean(values.headless);
  const store = createStore(dataDir);
  const siteConfig = core.getSiteConfig(applicationUrl);

  if (!siteConfig) {
    console.error("That doesn't look like a supported Apple, TikTok, or ByteDance careers URL.");
    process.exitCode = 1;
    return;
  }

  const profile = store.getProfile();
  store.scanState = {
    ...core.createIdleState(),
    running: true,
    phase: "Running current application page",
    userProfile: profile,
    pid: process.pid
  };
  store.saveScanState();

  await withBrowserContext(dataDir, headless, store, async (context) => {
    const page = await browser.openPage(context, applicationUrl);
    await browser.waitForPageLoad(page, 25000);

    await orchestrator.scanCurrentApplicationPage(context, store, page, {
      site: siteConfig.id,
      siteLabel: siteConfig.label,
      jobId: core.getJobIdFromUrl(applicationUrl),
      title: await page.title().catch(() => ""),
      url: applicationUrl
    });

    store.updateScanState({ running: false, phase: "Complete", completedAt: new Date().toISOString() });
    printStatusLine(store.scanState);
  });
}

function commandStatus(values) {
  const dataDir = values["data-dir"] || defaultDataDir();
  const store = createStore(dataDir);
  console.log(JSON.stringify(store.scanState, null, 2));
}

function commandStop(values) {
  const dataDir = values["data-dir"] || defaultDataDir();
  const store = createStore(dataDir);

  if (!store.scanState.running) {
    console.log("No scan is currently marked as running.");
    return;
  }

  const pid = store.scanState.pid;
  if (pid) {
    try {
      process.kill(pid, "SIGINT");
      console.log(`Sent stop signal to process ${pid}.`);
      return;
    } catch (_error) {
      console.log(`Process ${pid} is no longer running; marking the scan as stopped.`);
    }
  }

  orchestrator.stopScan(store);
}

function commandHistory(values) {
  const dataDir = values["data-dir"] || defaultDataDir();
  const store = createStore(dataDir);

  if (values.clear) {
    const result = store.clearHistory();
    console.log(result.ok ? "Job history cleared." : `Could not clear history: ${result.error}`);
    return;
  }

  console.log(JSON.stringify(store.getJobRecords(), null, 2));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      "data-dir": { type: "string" },
      headless: { type: "boolean" },
      "scan-only": { type: "boolean" },
      "auto-apply": { type: "boolean" },
      set: { type: "string", multiple: true },
      clear: { type: "boolean" }
    }
  });

  if (command === "login") {
    await commandLogin(positionals, values);
  } else if (command === "config") {
    await commandConfig(positionals, values);
  } else if (command === "scan") {
    await commandScan(positionals, values);
  } else if (command === "apply") {
    await commandApply(positionals, values);
  } else if (command === "status") {
    commandStatus(values);
  } else if (command === "stop") {
    commandStop(values);
  } else if (command === "history") {
    commandHistory(values);
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
