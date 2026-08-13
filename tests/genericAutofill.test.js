const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Mirrors background.js's GENERIC_AUTOFILL_FILES load order -- each file shares state via the same
// window.__careerPeelerGA namespace object, so they must run in dependency order within one sandbox,
// same as chrome.scripting.executeScript's files[] array does in the real extension.
const GENERIC_AUTOFILL_FILES = [
  "domHelpers.js",
  "classify.js",
  "actions.js",
  "snapshot.js",
  "prompt.js",
  "loop.js",
  "agent.js"
];

const sandbox = {
  console,
  chrome: {
    runtime: {
      onMessage: {
        addListener() {}
      },
      // Overridden per-test below for askLlmForAnswer coverage; the default here just guarantees
      // any accidental/unmocked call resolves instead of throwing "not a function".
      sendMessage() {
        return Promise.resolve({ ok: false, error: "not mocked" });
      }
    }
  },
  document: {
    title: "",
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getElementById() {
      return null;
    }
  },
  window: {
    location: {
      hostname: "boards.greenhouse.io"
    },
    getComputedStyle() {
      return {
        visibility: "visible",
        display: "block"
      };
    },
    // Regression guard for the removed manual-answer popup (see genericAutofill/prompt.js) --
    // askLlmForAnswer must never call this, no matter what chrome.runtime.sendMessage resolves to.
    promptCallCount: 0,
    prompt() {
      sandbox.window.promptCallCount += 1;
      return null;
    }
  }
};

vm.createContext(sandbox);
for (const file of GENERIC_AUTOFILL_FILES) {
  const filePath = path.join(__dirname, "..", "genericAutofill", file);
  const source = fs.readFileSync(filePath, "utf8");
  vm.runInContext(source, sandbox, { filename: file });
}

const {
  inferGenericFieldMapping,
  buildOptionMatcher,
  isEssayQuestionLabel,
  isWorkAuthorizationQuestion,
  isVisaSponsorshipQuestion,
  isAgeEligibilityQuestion,
  isPreviousEmploymentQuestion,
  isReferralSourceQuestion,
  askLlmForAnswer
} = sandbox.window.__careerPeelerGenericAutofillTestApi;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

// Mirrors tests/core.test.js's asyncTest pattern -- askLlmForAnswer is async (it awaits
// chrome.runtime.sendMessage), so its tests are collected and drained sequentially at the bottom of
// this file rather than run inline like the synchronous classification tests above.
const asyncTests = [];

function asyncTest(name, fn) {
  asyncTests.push({ name, fn });
}

// vm.runInContext runs the genericAutofill/*.js files in a separate realm with its own Object
// constructor, so an object literal returned from inside it isn't reference-equal (per assert's
// strict deepEqual) to a plain object literal written in this file even when their own properties
// match -- spread it into a plain object in THIS realm first, mirroring content.test.js's
// Array.from(...) wrapping for the same cross-realm reason.
function mapping(label) {
  const result = inferGenericFieldMapping(label);
  return result ? { ...result } : result;
}

test("exposes the generic autofill test API", () => {
  assert.equal(typeof inferGenericFieldMapping, "function");
});

test("inferGenericFieldMapping maps contact fields to the right profile key", () => {
  assert.deepEqual(mapping("First Name"), { action: "map", profileKey: "firstName" });
  assert.deepEqual(mapping("Last Name"), { action: "map", profileKey: "lastName" });
  assert.deepEqual(mapping("Email Address"), { action: "map", profileKey: "email" });
  assert.deepEqual(mapping("Mobile phone number"), { action: "map", profileKey: "phone" });
  assert.deepEqual(mapping("City"), { action: "map", profileKey: "addressCity" });
  assert.deepEqual(mapping("LinkedIn Profile"), { action: "map", profileKey: "linkedinUrl" });
  assert.deepEqual(mapping("GitHub"), { action: "map", profileKey: "githubUrl" });
});

test("inferGenericFieldMapping maps combined-name e-signature fields to fullName, not essay", () => {
  // Regression test: a bare "Full Name" field was previously unrecognized and fell through to the
  // essay/LLM-answer path, which produced a nonsense self-introduction paragraph instead of a name.
  assert.deepEqual(mapping("Full Name *"), { action: "map", profileKey: "fullName" });
  assert.deepEqual(mapping("Legal Name"), { action: "map", profileKey: "fullName" });
  assert.deepEqual(mapping("Type your full legal name as your signature"), { action: "map", profileKey: "fullName" });
});

test("inferGenericFieldMapping maps work-authorization and sponsorship questions", () => {
  assert.deepEqual(mapping("Are you legally authorized to work in the US?"), {
    action: "map",
    profileKey: "workAuthorized"
  });
  assert.deepEqual(mapping("Will you now or in the future require visa sponsorship?"), {
    action: "map",
    profileKey: "requiresSponsorship"
  });
});

test("inferGenericFieldMapping maps EEO fields", () => {
  assert.deepEqual(mapping("Gender"), { action: "map", profileKey: "eeoGender" });
  assert.deepEqual(mapping("Race/Ethnicity"), { action: "map", profileKey: "eeoRaceEthnicity" });
  assert.deepEqual(mapping("Veteran Status"), { action: "map", profileKey: "eeoVeteranStatus" });
  assert.deepEqual(mapping("Disability Status"), { action: "map", profileKey: "eeoDisabilityStatus" });
});

test("inferGenericFieldMapping detects genuine essay questions ahead of other rules", () => {
  assert.deepEqual(mapping("Why do you want to work at this company?"), { action: "essay" });
  assert.deepEqual(mapping("Tell us about a time you solved a hard problem"), { action: "essay" });
});

test("inferGenericFieldMapping does not treat personal-info fields as essay questions", () => {
  assert.equal(inferGenericFieldMapping("What company do you currently work for?"), null);
});

test("inferGenericFieldMapping returns null for unrecognized, non-question fields", () => {
  assert.equal(inferGenericFieldMapping("Referral code"), null);
  assert.equal(inferGenericFieldMapping("Employee ID"), null);
});

test("inferGenericFieldMapping treats an unrecognized field phrased as a question as an essay prompt", () => {
  // Matches content.js's own bare "?" essay heuristic -- low-stakes, free-text fields like this are
  // reasonable for the LLM to draft a short answer for, same as on the three known sites.
  assert.deepEqual(mapping("What is your favorite part of software engineering?"), { action: "essay" });
});

test("inferGenericFieldMapping maps the referral-source question to a fixed LinkedIn answer, ahead of the essay check", () => {
  // "How did you hear about us?" ends in "?" like a genuine essay prompt, so this concept must be
  // checked before isEssayQuestionLabel -- same ordering reason as work-authorization/sponsorship.
  assert.deepEqual(mapping("How did you hear about us?"), { action: "fixed", value: "LinkedIn" });
  assert.deepEqual(mapping("How do you hear about us?"), { action: "fixed", value: "LinkedIn" });
  assert.deepEqual(mapping("Where did you hear about this position?"), { action: "fixed", value: "LinkedIn" });
  assert.deepEqual(mapping("Referral Source"), { action: "fixed", value: "LinkedIn" });
});

test("inferGenericFieldMapping maps the previous-employment question to a fixed No answer, ahead of the essay check", () => {
  assert.deepEqual(mapping("Have you previously been employed by us?"), { action: "fixed", value: "No" });
  assert.deepEqual(mapping("Have you worked for this company before?"), { action: "fixed", value: "No" });
  assert.deepEqual(mapping("Are you a former employee of this company?"), { action: "fixed", value: "No" });
});

test("isReferralSourceQuestion/isPreviousEmploymentQuestion don't false-positive on unrelated questions", () => {
  assert.equal(isReferralSourceQuestion("What company do you currently work for?"), false);
  assert.equal(isReferralSourceQuestion("How would you rate your experience applying?"), false);
  assert.equal(isPreviousEmploymentQuestion("Do you currently work for another employer?"), false);
  assert.equal(isPreviousEmploymentQuestion("Please describe your work experience."), false);
});

test('buildOptionMatcher("LinkedIn") matches a LinkedIn option and rejects unrelated referral sources', () => {
  // Exercises the same matcher loop.js's dropdown handling builds for the referral-source case --
  // proves "LinkedIn not offered" correctly fails to match rather than picking a fallback option.
  const matcher = buildOptionMatcher("LinkedIn");
  assert.equal(matcher("LinkedIn"), true);
  assert.equal(matcher("LinkedIn Job Posting"), true);
  assert.equal(matcher("Indeed"), false);
  assert.equal(matcher("Company Website"), false);
  assert.equal(matcher("Glassdoor"), false);
});

asyncTest("askLlmForAnswer resolves the LLM's resume-grounded answer when chrome.runtime.sendMessage succeeds", async () => {
  sandbox.chrome.runtime.sendMessage = async () => ({
    ok: true,
    data: { answer: "  I have three years of backend experience relevant to this role.  " }
  });

  const answer = await askLlmForAnswer("Describe your relevant experience.");
  assert.equal(answer, "I have three years of backend experience relevant to this role.");
});

asyncTest("askLlmForAnswer resolves null (not a popup) when the LLM has no resume-supported answer", async () => {
  sandbox.chrome.runtime.sendMessage = async () => ({ ok: false, error: "LLM matching is not enabled." });

  const answer = await askLlmForAnswer("What is your favorite color?");
  assert.equal(answer, null);
});

asyncTest("askLlmForAnswer never shows the manual-answer popup, whether or not the LLM answers", async () => {
  sandbox.window.promptCallCount = 0;

  sandbox.chrome.runtime.sendMessage = async () => ({ ok: true, data: { answer: "An LLM-drafted answer." } });
  await askLlmForAnswer("Some ordinary unanswered question");

  sandbox.chrome.runtime.sendMessage = async () => ({ ok: false, error: "LLM matching is not enabled." });
  await askLlmForAnswer("Some other unanswered question");

  assert.equal(sandbox.window.promptCallCount, 0);
});

test("prompt.js's source no longer references window.prompt (removed manual-answer popup)", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "genericAutofill", "prompt.js"), "utf8");
  assert.equal(/window\.prompt/.test(source), false);
});

test("the unrelated window.confirm HITL guard on the known-site diagnostic workflow is untouched", () => {
  // Not part of genericAutofill -- content.test.js/background.test.js don't cover the sidepanel UI,
  // so this is a light regression guard that removing the manual-answer popup above didn't also
  // remove this separate, legitimate confirmation (see src/sidepanel/components/KnownSitesSection.jsx).
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "sidepanel", "components", "KnownSitesSection.jsx"),
    "utf8"
  );
  assert.match(source, /window\.confirm\(/);
});

test("buildOptionMatcher matches yes/no answers, not the opposite", () => {
  const yesMatcher = buildOptionMatcher("yes");
  assert.equal(yesMatcher("Yes"), true);
  assert.equal(yesMatcher("No"), false);

  const noMatcher = buildOptionMatcher("no");
  assert.equal(noMatcher("No"), true);
  assert.equal(noMatcher("Yes"), false);
});

test("buildOptionMatcher does substring matching for free-form EEO/location values", () => {
  const matcher = buildOptionMatcher("Asian");
  assert.equal(matcher("Asian (Not Hispanic or Latino)"), true);
  assert.equal(matcher("White"), false);
});

test("isEssayQuestionLabel/isWorkAuthorizationQuestion/isVisaSponsorshipQuestion/isAgeEligibilityQuestion behave identically to content.js's originals on shared fixtures", () => {
  assert.equal(isEssayQuestionLabel("Why do you want to work at this company?"), true);
  assert.equal(isEssayQuestionLabel("First Name"), false);
  assert.equal(isWorkAuthorizationQuestion("Are you legally authorized to work in the US?"), true);
  assert.equal(isWorkAuthorizationQuestion("What is your favorite color?"), false);
  assert.equal(isVisaSponsorshipQuestion("Do you now or will you in the future require visa sponsorship?"), true);
  assert.equal(isAgeEligibilityQuestion("Are you at least 18 years of age?"), true);
});

(async () => {
  for (const { name, fn } of asyncTests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      throw error;
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
