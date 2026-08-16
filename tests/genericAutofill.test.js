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

// Mirrors loop.js's own copy of this literal (see that file's persistActivity comment for why it
// can't be imported instead) -- used below to read back what runGenericAutofill wrote.
const GENERIC_AUTOFILL_ACTIVITY_KEY = "appleCareersGenericAutofillActivity";

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
    },
    // Real chrome.storage.local is async and origin-scoped; an in-memory object is enough to let
    // runGenericAutofill's activity-log writes (persistActivity in loop.js) resolve instead of
    // throwing "chrome.storage is undefined" the first time a test actually calls it.
    storage: {
      local: {
        _data: {},
        get(key) {
          return Promise.resolve(typeof key === "string" ? { [key]: this._data[key] } : { ...this._data });
        },
        set(items) {
          Object.assign(this._data, items);
          return Promise.resolve();
        }
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
  askLlmForAnswer,
  hasExpectedFieldValue,
  resolveProfileValue,
  isElementStillActionable,
  describeEnteredValue,
  buildTextFillRetryOutcome,
  findNextUnhandledFieldEntry,
  runGenericAutofill
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

function retryOutcome(label, args) {
  return { ...buildTextFillRetryOutcome(label, args) };
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

test("inferGenericFieldMapping distinguishes Address Line 1 from Address Line 2 (regression: both used to map to addressLine1)", () => {
  assert.deepEqual(mapping("Address Line 1"), { action: "map", profileKey: "addressLine1" });
  assert.deepEqual(mapping("Street Address"), { action: "map", profileKey: "addressLine1" });
  assert.deepEqual(mapping("Address"), { action: "map", profileKey: "addressLine1" });

  assert.deepEqual(mapping("Address Line 2"), { action: "map", profileKey: "addressLine2" });
  assert.deepEqual(mapping("Apartment/Suite/Unit"), { action: "map", profileKey: "addressLine2" });
  assert.deepEqual(mapping("Apt/Suite (optional)"), { action: "map", profileKey: "addressLine2" });
});

test("ordinary fields are unaffected by the new Address Line 2 rule", () => {
  assert.deepEqual(mapping("First Name"), { action: "map", profileKey: "firstName" });
  assert.deepEqual(mapping("City"), { action: "map", profileKey: "addressCity" });
  assert.deepEqual(mapping("Country"), { action: "map", profileKey: "addressCountry" });
});

test("resolveProfileValue keeps Address Line 1 and Address Line 2 independent (regression: Line 2 used to duplicate Line 1's value)", () => {
  // Case: Address Line 1 has a value, Address Line 2 is absent from the profile -- resolves empty,
  // which loop.js's field loop already leaves blank rather than guessing (same as any other unset,
  // non-required mapped field).
  const line1Only = { addressLine1: "1 Microsoft Way", addressLine2: "" };
  assert.equal(resolveProfileValue(line1Only, "addressLine1"), "1 Microsoft Way");
  assert.equal(resolveProfileValue(line1Only, "addressLine2"), "");

  // Case: the profile has a real, distinct Address Line 2 value -- must resolve to THAT value, not
  // silently fall back to Line 1's.
  const both = { addressLine1: "1 Microsoft Way", addressLine2: "Suite 200" };
  assert.equal(resolveProfileValue(both, "addressLine1"), "1 Microsoft Way");
  assert.equal(resolveProfileValue(both, "addressLine2"), "Suite 200");
});

test("resolveProfileValue falls back to the extracted candidateProfile only for fields left blank in the flat autofill profile", () => {
  const candidateProfile = {
    basicInfo: {
      fullName: "Jeff Zhou",
      email: "extracted@example.com",
      linkedinUrl: "linkedin.com/in/extracted",
      city: "Redmond",
      state: "WA",
      country: ""
    }
  };

  // Flat field empty -> falls back to the extracted equivalent.
  const blankFlat = { email: "", linkedinUrl: "", addressCity: "", candidateProfile };
  assert.equal(resolveProfileValue(blankFlat, "email"), "extracted@example.com");
  assert.equal(resolveProfileValue(blankFlat, "linkedinUrl"), "linkedin.com/in/extracted");
  assert.equal(resolveProfileValue(blankFlat, "addressCity"), "Redmond");

  // Flat field already has a value the user typed by hand -> that value wins, never silently
  // overwritten by the extracted one.
  const filledFlat = { email: "typed-by-hand@example.com", candidateProfile };
  assert.equal(resolveProfileValue(filledFlat, "email"), "typed-by-hand@example.com");

  // No fallback field exists for this profileKey in candidateProfile.basicInfo -> stays empty, not
  // guessed.
  assert.equal(resolveProfileValue({ addressCountry: "", candidateProfile }, "addressCountry"), "");

  // fullName is a special case (combines firstName+lastName) -- falls back to the SINGLE extracted
  // fullName string only when BOTH flat halves are empty, never split-guessed the other direction.
  assert.equal(resolveProfileValue({ firstName: "", lastName: "", candidateProfile }, "fullName"), "Jeff Zhou");
  assert.equal(resolveProfileValue({ firstName: "Jane", lastName: "Doe", candidateProfile }, "fullName"), "Jane Doe");

  // No candidateProfile at all (never uploaded/extracted a resume) -- unchanged, pre-existing behavior.
  assert.equal(resolveProfileValue({ email: "" }, "email"), "");
});

test("hasExpectedFieldValue detects whether a filled field's live value survived later page activity", () => {
  // Already-filled value survives subsequent form processing/rerender.
  assert.equal(hasExpectedFieldValue({ value: "1 Microsoft Way" }, "1 Microsoft Way"), true);

  // A later rerender reverted the field back to empty -- exactly the "answers disappear" symptom;
  // loop.js's end-of-sweep verification pass uses this to detect it and retry/flag instead of
  // silently reporting the original fill as a success.
  assert.equal(hasExpectedFieldValue({ value: "" }, "1 Microsoft Way"), false);

  // A later rerender left some OTHER value in the field (e.g. the site's own autofill/default) --
  // also not what we filled, must not be treated as "still correct".
  assert.equal(hasExpectedFieldValue({ value: "something else" }, "1 Microsoft Way"), false);
});

test('buildOptionMatcher("Yes")/("No") only match a real Yes/No option\'s own text, never an unrelated one', () => {
  // Yes/No dropdown -> the agent must select the matching REAL option, never type "yes" into the
  // control. This is the matcher openDropdownAndSelectOption/selectMatchingOption both build the
  // click/selection off of -- proving it only recognizes genuine Yes/No option text is the testable
  // core of "never force an answer that isn't actually offered".
  const yesMatcher = buildOptionMatcher("Yes");
  assert.equal(yesMatcher("Yes"), true);
  assert.equal(yesMatcher("No"), false);
  // Intended dropdown answer does not exist among the real options -- must not match a same-ish-
  // sounding but different option, which would otherwise cause the wrong option to be clicked.
  assert.equal(yesMatcher("Confirmed"), false);
  assert.equal(yesMatcher("N/A"), false);

  const noMatcher = buildOptionMatcher("No");
  assert.equal(noMatcher("No"), true);
  assert.equal(noMatcher("Yes"), false);
  assert.equal(noMatcher("Declined"), false);
});

test("ordinary text fields still classify and resolve the same way as before (no dropdown-handling regression)", () => {
  assert.deepEqual(mapping("Email Address"), { action: "map", profileKey: "email" });
  assert.equal(resolveProfileValue({ email: "jeff@example.com" }, "email"), "jeff@example.com");
  // A generic (non yes/no) matcher still does plain case-insensitive substring matching -- unaffected
  // by buildOptionMatcher's special-cased "yes"/"no" branches.
  const cityMatcher = buildOptionMatcher("Redmond");
  assert.equal(cityMatcher("Redmond, WA"), true);
  assert.equal(cityMatcher("Seattle"), false);
});

test("isEssayQuestionLabel/isWorkAuthorizationQuestion/isVisaSponsorshipQuestion/isAgeEligibilityQuestion behave identically to content.js's originals on shared fixtures", () => {
  assert.equal(isEssayQuestionLabel("Why do you want to work at this company?"), true);
  assert.equal(isEssayQuestionLabel("First Name"), false);
  assert.equal(isWorkAuthorizationQuestion("Are you legally authorized to work in the US?"), true);
  assert.equal(isWorkAuthorizationQuestion("What is your favorite color?"), false);
  assert.equal(isVisaSponsorshipQuestion("Do you now or will you in the future require visa sponsorship?"), true);
  assert.equal(isAgeEligibilityQuestion("Are you at least 18 years of age?"), true);
});

test("isElementStillActionable is true for a connected, visible, enabled element", () => {
  const element = {
    isConnected: true,
    disabled: false,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    getAttribute: () => null
  };
  assert.equal(isElementStillActionable(element), true);
});

test("isElementStillActionable is false once a previously-live element is detached from the page", () => {
  // The exact staleness case a mid-sweep re-render can produce: loop.js held this element from the
  // upfront snapshot, and by the time it's this element's turn to be acted on, an earlier field's fill
  // has caused the page to replace this node's subtree entirely.
  const element = {
    isConnected: false,
    disabled: false,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    getAttribute: () => null
  };
  assert.equal(isElementStillActionable(element), false);
});

test("isElementStillActionable is false for a zero-size (hidden) element", () => {
  const element = {
    isConnected: true,
    disabled: false,
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    getAttribute: () => null
  };
  assert.equal(isElementStillActionable(element), false);
});

test("isElementStillActionable is false for a disabled element", () => {
  const element = {
    isConnected: true,
    disabled: true,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    getAttribute: () => null
  };
  assert.equal(isElementStillActionable(element), false);
});

test("describeEnteredValue never includes the actual value for a password-kind field", () => {
  assert.equal(describeEnteredValue("password", "hunter2"), "entered a value");
  assert.equal(describeEnteredValue("password", "hunter2").includes("hunter2"), false);
});

test("describeEnteredValue includes the value for ordinary field kinds", () => {
  assert.equal(describeEnteredValue("text", "2900 N Braeswood Blvd"), 'entered "2900 N Braeswood Blvd"');
  assert.equal(describeEnteredValue("email", "jeff@example.com"), 'entered "jeff@example.com"');
});

test("buildTextFillRetryOutcome reports success with no fallback when the value was present once the page settled", () => {
  // The Microsoft Careers regression case: the immediate post-fill check failed, but waitForSettle
  // gave the framework's own re-render/validation a chance to run first -- the value was there all
  // along, just not yet at the ~150ms mark isFieldNowInvalid checks at.
  const outcome = retryOutcome("Address", {
    settledOk: true,
    fallback: { ok: true },
    fallbackFinalOk: true
  });
  assert.deepEqual(outcome, { ok: true, viaFallback: false });
});

test("buildTextFillRetryOutcome reports success via fallback when the keyboard-input retry stuck", () => {
  const outcome = retryOutcome("Address", {
    settledOk: false,
    fallback: { ok: true },
    fallbackFinalOk: true
  });
  assert.deepEqual(outcome, { ok: true, viaFallback: true });
});

test("buildTextFillRetryOutcome flags the field when the keyboard-input retry ran but still didn't stick", () => {
  const outcome = retryOutcome("Address", {
    settledOk: false,
    fallback: { ok: true },
    fallbackFinalOk: false
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /even via keyboard input/);
  assert.equal(outcome.observation, "value still didn't stick, even via keyboard input");
});

test("buildTextFillRetryOutcome flags the field with the specific error when the keyboard-input fallback itself failed", () => {
  const outcome = retryOutcome("Address", {
    settledOk: false,
    fallback: { ok: false, error: "Debugger permission was not granted, so the keyboard-input fallback is unavailable." },
    fallbackFinalOk: false
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /Debugger permission was not granted/);
  assert.equal(
    outcome.observation,
    "keyboard-input fallback failed (Debugger permission was not granted, so the keyboard-input fallback is unavailable.)"
  );
});

function key(entry) {
  return `${entry.fieldKind}::${entry.label}`;
}

test("findNextUnhandledFieldEntry returns the first entry not yet in the handled set", () => {
  const entries = [
    { fieldKind: "text", label: "First name" },
    { fieldKind: "text", label: "Address" },
    { fieldKind: "select", label: "Country" }
  ];

  const handled = new Set();
  assert.equal(findNextUnhandledFieldEntry(entries, handled, key), entries[0]);

  handled.add(key(entries[0]));
  assert.equal(findNextUnhandledFieldEntry(entries, handled, key), entries[1]);

  handled.add(key(entries[1]));
  assert.equal(findNextUnhandledFieldEntry(entries, handled, key), entries[2]);
});

test("findNextUnhandledFieldEntry returns undefined once every entry has been handled -- the sequential loop's termination condition", () => {
  const entries = [
    { fieldKind: "text", label: "Address" },
    { fieldKind: "select", label: "Country" }
  ];
  const handled = new Set(entries.map(key));

  assert.equal(findNextUnhandledFieldEntry(entries, handled, key), undefined);
});

test("findNextUnhandledFieldEntry recognizes a field replaced by a fresh re-render as already handled (keyed by kind+label, not element identity)", () => {
  // The exact staleness case the sequential rewrite exists for: field.element from a LATER
  // snapshotPage() call is a DIFFERENT object than the one from an EARLIER call, even for the "same"
  // logical field a framework re-rendered -- but the key (kind+label) stays stable across that replace,
  // so a field already decided about on an earlier pass is correctly skipped on a later one instead of
  // being re-picked (and re-filled) forever.
  const staleElement = { tag: "stale" };
  const freshElement = { tag: "fresh" }; // a different object, same logical field after a re-render

  const handled = new Set([key({ fieldKind: "text", label: "Address" })]);
  const freshEntries = [
    { fieldKind: "text", label: "Address", element: freshElement },
    { fieldKind: "text", label: "City", element: staleElement }
  ];

  const next = findNextUnhandledFieldEntry(freshEntries, handled, key);
  assert.equal(next.label, "City");
});

asyncTest("runGenericAutofill writes a live-then-done activity log to chrome.storage.local", async () => {
  // document.querySelectorAll is stubbed to always return [] (see the sandbox above), so this sweep
  // finds no fields/questions/dropdowns/resume input and no apply-entry button -- it's exercising the
  // activity-log plumbing itself (the new capability this test covers), not field-filling behavior,
  // which stays covered by the DOM-independent classification tests above instead.
  sandbox.chrome.storage.local._data = {};

  const result = await runGenericAutofill({});
  assert.equal(result.ok, true);

  const stored = sandbox.chrome.storage.local._data[GENERIC_AUTOFILL_ACTIVITY_KEY];
  assert.ok(stored, "expected an activity log entry to have been written to chrome.storage.local");
  assert.equal(stored.running, false, "activity log must end with running: false, even though nothing was found to fill");

  const lastStep = stored.steps[stored.steps.length - 1];
  assert.equal(lastStep.tool, "done");
  assert.equal(lastStep.status, "success");
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
