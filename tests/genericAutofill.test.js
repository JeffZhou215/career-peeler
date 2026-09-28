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
  "workdayExperience.js",
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
  setTimeout,
  HTMLInputElement: class HTMLInputElement {},
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
  choosePreferredLinkedInSourceLabel,
  choosePreferredWorkdaySourceLabel,
  choosePreferredWorkdaySourceParentLabel,
  isEssayQuestionLabel,
  isWorkAuthorizationQuestion,
  isCategoricalWorkAuthorizationStatusQuestion,
  isVisaSponsorshipQuestion,
  isAgeEligibilityQuestion,
  isPreviousEmploymentQuestion,
  isReferralSourceQuestion,
  isWorkdayHostname,
  isPhoneExtensionField,
  isPhoneCountryCodeField,
  isPhoneDeviceTypeField,
  isWorkdayDropdownStatusLabel,
  isWorkdayDropdownMenuElement,
  isDropdownBackingInput,
  getWorkdayProgressActionKind,
  askLlmForAnswer,
  askApplicationQuestionAgent,
  hasExpectedFieldValue,
  hasExplicitWorkdayFieldError,
  isDropdownValueConfirmed,
  isWorkdayDropdownMenuOpen,
  isWorkdayMultiSelectContainer,
  getVisibleDropdownOptionElements,
  getAssociatedWorkdayPromptOptions,
  getWorkdayMultiSelectOpenTarget,
  getWorkdayDropdownSearchInput,
  getWorkdayPromptMenuItemType,
  getWorkdayTrustedPromptClickTarget,
  getWorkdaySourceMenuState,
  resolveProfileValue,
  isElementStillActionable,
  isQuestionControlRequired,
  buildFrameworkTextCommitStages,
  describeEnteredValue,
  buildTextFillRetryOutcome,
  findNextUnhandledFieldEntry,
  hasMeaningfulExistingFieldValue,
  getMeaningfulExistingWorkdayDropdownValue,
  isMappedApplicationQuestion,
  parseWorkdayCandidateDate,
  getWorkdayDegreeFamily,
  doesWorkdayDegreeOptionMatch,
  buildWorkdayRoleDescription,
  workdayExperienceEntriesMatch,
  workdayEducationEntriesMatch,
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
function mapping(label, context) {
  const result = inferGenericFieldMapping(label, context);
  return result ? { ...result } : result;
}

function retryOutcome(label, args) {
  return { ...buildTextFillRetryOutcome(label, args) };
}

test("exposes the generic autofill test API", () => {
  assert.equal(typeof inferGenericFieldMapping, "function");
});

test("Workday candidate dates accept explicit month/year formats and never invent a month from a bare year", () => {
  assert.deepEqual({ ...parseWorkdayCandidateDate("04/2024") }, { current: false, month: 4, year: 2024 });
  assert.deepEqual({ ...parseWorkdayCandidateDate("2024-04") }, { current: false, month: 4, year: 2024 });
  assert.deepEqual({ ...parseWorkdayCandidateDate("Apr. 2024") }, { current: false, month: 4, year: 2024 });
  assert.deepEqual({ ...parseWorkdayCandidateDate("Present") }, { current: true, month: null, year: null });
  assert.equal(parseWorkdayCandidateDate("2024"), null);
});

test("Workday degree matching maps resume degree names only to the equivalent offered degree family", () => {
  assert.equal(getWorkdayDegreeFamily("M.S. Computer Science"), "masters");
  assert.equal(getWorkdayDegreeFamily("Bachelor of Science"), "bachelors");
  assert.equal(doesWorkdayDegreeOptionMatch("M.S. Computer Science", "Masters"), true);
  assert.equal(doesWorkdayDegreeOptionMatch("M.S. Computer Science", "Bachelors"), false);
  assert.equal(doesWorkdayDegreeOptionMatch("Ph.D.", "Doctorate"), true);
});

test("Workday structured-entry matching prevents duplicate jobs and same-school degrees", () => {
  assert.equal(
    workdayExperienceEntriesMatch(
      { company: "Acme, Inc.", title: "Software Engineer" },
      { company: "acme inc", title: "software engineer" }
    ),
    true
  );
  assert.equal(
    workdayEducationEntriesMatch(
      { institution: "State University", degree: "M.S. Computer Science" },
      { institution: "state university", degree: "Masters" }
    ),
    true
  );
  assert.equal(
    workdayEducationEntriesMatch(
      { institution: "State University", degree: "B.S." },
      { institution: "State University", degree: "Masters" }
    ),
    false
  );
});

test("Workday role descriptions use only saved profile content and de-duplicate repeated bullets", () => {
  assert.equal(
    buildWorkdayRoleDescription({
      summary: "Built backend systems.",
      responsibilities: ["Built backend systems.", "Improved reliability."],
      technologies: ["Go", "Kubernetes"]
    }),
    "Built backend systems.\n• Improved reliability.\nTechnologies: Go, Kubernetes"
  );
});

test("generic question gating skips optional application questions but not optional profile fields", () => {
  const optionalElement = {
    required: false,
    getAttribute() {
      return null;
    },
    closest() {
      return null;
    },
    querySelector() {
      return null;
    }
  };

  assert.equal(isQuestionControlRequired(optionalElement, "Why this company?"), false);
  assert.equal(isQuestionControlRequired(optionalElement, "Why this company? *"), true);
  assert.equal(isQuestionControlRequired(optionalElement, "Why this company? (optional) *"), false);
  assert.equal(
    isQuestionControlRequired(optionalElement, "Current right-to-work status — mandatory for applicants to Singapore"),
    true
  );
  assert.equal(isQuestionControlRequired({ ...optionalElement, required: true }, "Gender identity — voluntary"), false);
  const voluntarySection = { innerText: "Voluntary demographic survey", parentElement: null };
  const localField = {
    innerText: "Disability status",
    parentElement: voluntarySection,
    querySelector() { return null; },
    getAttribute() { return null; }
  };
  const nestedVoluntaryQuestion = {
    ...optionalElement,
    required: true,
    closest() { return localField; }
  };
  assert.equal(isQuestionControlRequired(nestedVoluntaryQuestion, "Disability status"), false);
  assert.equal(isQuestionControlRequired(optionalElement, "Will sponsorship be required in the future?"), false);
  assert.equal(isMappedApplicationQuestion("Why this company?", mapping("Why this company?")), true);
  assert.equal(isMappedApplicationQuestion("First Name", mapping("First Name")), false);
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
    action: "fixed",
    value: "Yes"
  });
  assert.deepEqual(mapping("Will you now or in the future require visa sponsorship?"), {
    action: "fixed",
    value: "Yes"
  });
  assert.deepEqual(mapping("Current right-to-work status — mandatory for applicants to Singapore"), {
    action: "fixed",
    value: "Foreigner"
  });
  assert.equal(mapping("Current right-to-work status"), null, "a categorical status without country context must use observed options");
  assert.equal(isCategoricalWorkAuthorizationStatusQuestion("Current right-to-work status"), true);
});

test("inferGenericFieldMapping applies the fixed no-criminal-history policy without misclassifying background-check consent", () => {
  assert.deepEqual(mapping("Have you ever been convicted of a felony?"), { action: "fixed", value: "No" });
  assert.notDeepEqual(mapping("Do you consent to a background check?"), { action: "fixed", value: "No" });
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

test("inferGenericFieldMapping keeps the non-Workday referral-source policy ahead of the essay check", () => {
  // "How did you hear about us?" ends in "?" like a genuine essay prompt, so this concept must be
  // checked before isEssayQuestionLabel -- same ordering reason as work-authorization/sponsorship.
  assert.deepEqual(mapping("How did you hear about us?"), { action: "fixed", value: "Other" });
  assert.deepEqual(mapping("How do you hear about us?"), { action: "fixed", value: "Other" });
  assert.deepEqual(mapping("Where did you hear about this position?"), { action: "fixed", value: "Other" });
  assert.deepEqual(mapping("Referral Source"), { action: "fixed", value: "Other" });
});

test("Workday field policy overrides are host-scoped", () => {
  const workday = { hostname: "example.wd5.myworkdayjobs.com" };
  assert.equal(isWorkdayHostname(workday.hostname), true);
  assert.equal(isWorkdayHostname("example.myworkdaysite.com"), true);
  assert.equal(isWorkdayHostname("notworkdayjobs.com"), false);
  assert.deepEqual(mapping("How did you hear about us?", workday), {
    action: "fixed",
    value: "Other"
  });
  assert.deepEqual(mapping("Country", workday), {
    action: "fixed",
    value: "United States of America"
  });
  assert.deepEqual(mapping("Country Phone Code", workday), {
    action: "fixed",
    value: "United States of America (+1)"
  });
  assert.deepEqual(mapping("Phone Device Type", workday), {
    action: "fixed",
    value: "Mobile"
  });
  assert.deepEqual(mapping("Country", { hostname: "boards.greenhouse.io" }), {
    action: "map",
    profileKey: "addressCountry"
  });
});

test("phone extensions are recognized separately from phone numbers", () => {
  assert.equal(isPhoneExtensionField("Phone Extension"), true);
  assert.equal(isPhoneExtensionField("Telephone number extension"), true);
  assert.equal(isPhoneExtensionField("Phone Number"), false);
  assert.equal(isPhoneCountryCodeField("Phone Country Code"), true);
  assert.equal(isPhoneCountryCodeField("Country Phone Code"), true);
  assert.equal(isPhoneDeviceTypeField("Phone Device Type"), true);
  assert.equal(isPhoneDeviceTypeField("Phone Number"), false);
});

test("Workday dropdown fast path recognizes a real prefilled button and rejects a placeholder", () => {
  const button = {
    value: "c553432013ba103b00decb5d94141669",
    innerText: "Mobile",
    getAttribute(name) {
      if (name === "aria-haspopup") return "listbox";
      if (name === "value") return this.value;
      return null;
    },
    querySelector() {
      return null;
    }
  };
  assert.equal(getMeaningfulExistingWorkdayDropdownValue(button), "Mobile");

  button.value = "";
  button.innerText = "Select One";
  assert.equal(getMeaningfulExistingWorkdayDropdownValue(button), "");
});

test("Workday multi-select fast path trusts selected-item chips instead of search text", () => {
  const selectedItem = {
    textContent: "Company Career Site",
    getAttribute(name) {
      return name === "data-automation-label" ? "Company Career Site" : null;
    }
  };
  const container = {
    getAttribute(name) {
      return name === "data-automation-id" ? "multiSelectContainer" : null;
    },
    querySelectorAll() {
      return [selectedItem];
    }
  };
  assert.equal(isWorkdayMultiSelectContainer(container), true);
  assert.equal(getMeaningfulExistingWorkdayDropdownValue(container), "Company Career Site");

  container.querySelectorAll = () => [];
  assert.equal(getMeaningfulExistingWorkdayDropdownValue(container), "");
});

test("Workday selected-item accessibility statuses are not application questions", () => {
  assert.equal(isWorkdayDropdownStatusLabel("items selected"), true);
  assert.equal(isWorkdayDropdownStatusLabel("1 item selected"), true);
  assert.equal(isWorkdayDropdownStatusLabel("3 items selected."), true);
  assert.equal(isWorkdayDropdownStatusLabel("Which items have you selected?"), false);
});

test("Workday expanded option panels are not inventoried as application dropdowns", () => {
  const originalHostname = sandbox.window.location.hostname;
  try {
    sandbox.window.location.hostname = "example.wd5.myworkdayjobs.com";
    const optionPanel = {
      getAttribute(name) {
        return name === "role" ? "listbox" : null;
      },
      querySelector(selector) {
        return selector === "[role='option']" ? {} : null;
      }
    };
    assert.equal(isWorkdayDropdownMenuElement(optionPanel), true);

    sandbox.window.location.hostname = "boards.greenhouse.io";
    assert.equal(isWorkdayDropdownMenuElement(optionPanel), false);
  } finally {
    sandbox.window.location.hostname = originalHostname;
  }
});

test("Workday dropdown state trusts the trigger's aria-expanded contract", () => {
  const attributes = {
    "aria-haspopup": "listbox",
    "aria-expanded": "true"
  };
  const trigger = {
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    querySelector() {
      return null;
    }
  };

  assert.equal(isWorkdayDropdownMenuOpen(trigger), true);
  delete attributes["aria-expanded"];
  assert.equal(isWorkdayDropdownMenuOpen(trigger), false);
  attributes["aria-expanded"] = "false";
  assert.equal(isWorkdayDropdownMenuOpen(trigger), false);
});

test("Workday progress actions use only the bounded exact-label vocabulary", () => {
  assert.equal(getWorkdayProgressActionKind("Continue"), "continue");
  assert.equal(getWorkdayProgressActionKind("Save and Continue"), "continue");
  assert.equal(getWorkdayProgressActionKind("Apply Now"), "continue");
  assert.equal(getWorkdayProgressActionKind("Submit Application"), "submit");
  assert.equal(getWorkdayProgressActionKind("Submit for Referral"), null);
  assert.equal(getWorkdayProgressActionKind("Cancel"), null);
});

test("inferGenericFieldMapping routes previous-employment questions to candidate profile history", () => {
  assert.deepEqual(mapping("Have you previously been employed by us?"), { action: "candidate_employment" });
  assert.deepEqual(mapping("Have you worked for this company before?"), { action: "candidate_employment" });
  assert.deepEqual(mapping("Are you a former employee of this company?"), { action: "candidate_employment" });
  assert.deepEqual(mapping("Have you ever worked for Mastercard as an employee?"), { action: "candidate_employment" });
});

test("isReferralSourceQuestion/isPreviousEmploymentQuestion don't false-positive on unrelated questions", () => {
  assert.equal(isReferralSourceQuestion("What company do you currently work for?"), false);
  assert.equal(isReferralSourceQuestion("How would you rate your experience applying?"), false);
  assert.equal(isPreviousEmploymentQuestion("Do you currently work for another employer?"), false);
  assert.equal(isPreviousEmploymentQuestion("Have you ever worked for another employer?"), false);
  assert.equal(isPreviousEmploymentQuestion("Have you ever been employed by any company?"), false);
  assert.equal(isPreviousEmploymentQuestion("Please describe your work experience."), false);
});

test('buildOptionMatcher("Other") requires the exact top-level option', () => {
  // A substring match here could enter a nested category such as "Other Job Board". Referral-source
  // policy must choose only the directly observed, exact Other option.
  const matcher = buildOptionMatcher("Other");
  assert.equal(matcher("Other"), true);
  assert.equal(matcher("Other Job Board"), false);
  assert.equal(matcher("Other Source"), false);
  assert.equal(matcher("Indeed"), false);
});

test("Workday source choice prefers exact LinkedIn, then the shortest observed containing label", () => {
  assert.equal(
    choosePreferredLinkedInSourceLabel(["LinkedIn Connection Post", "LinkedIn", "LinkedIn Job Board"]),
    "LinkedIn"
  );
  assert.equal(
    choosePreferredLinkedInSourceLabel(["Found this role on LinkedIn", "LinkedIn Connection Post"]),
    "LinkedIn Connection Post"
  );
  assert.equal(choosePreferredLinkedInSourceLabel(["Indeed", "Company Career Site"]), "");
});

test("Workday source policy prefers exact Other before any rendered LinkedIn option", () => {
  assert.equal(
    choosePreferredWorkdaySourceLabel(["LinkedIn", "Other", "LinkedIn Connection Post"]),
    "Other"
  );
  assert.equal(
    choosePreferredWorkdaySourceLabel(["LinkedIn Connection Post", "Indeed"]),
    "LinkedIn Connection Post"
  );
  assert.equal(choosePreferredWorkdaySourceLabel(["Other Job Board", "Indeed"]), "");
});

test("Workday source traversal recognizes the observed Salesforce and Job Board parent categories", () => {
  assert.equal(
    choosePreferredWorkdaySourceParentLabel([
      "Current or Former Employee",
      "Job Board",
      "External Career Site Sources",
      "Referral"
    ]),
    "External Career Site Sources"
  );
  assert.equal(
    choosePreferredWorkdaySourceParentLabel(["Employee Referral", "Job Board"]),
    "Job Board"
  );
  assert.equal(
    choosePreferredWorkdaySourceParentLabel(["Current or Former Employee", "Referral"]),
    ""
  );
});

test("Workday US phone-code matching rejects the similarly named Minor Outlying Islands option", () => {
  const matcher = buildOptionMatcher("United States of America (+1)");
  assert.equal(matcher("United States of America (+1)"), true);
  assert.equal(matcher("United States (+1)"), true);
  assert.equal(matcher("United States Minor Outlying Islands (+1)"), false);
  assert.equal(matcher("Canada (+1)"), false);
});

asyncTest("Workday dropdown verification accepts the exact selected value rendered in its field wrapper", async () => {
  const originalHostname = sandbox.window.location.hostname;
  try {
    sandbox.window.location.hostname = "example.wd5.myworkdayjobs.com";
    const fieldWrapper = {
      innerText: "Phone Device Type*\nMobile",
      parentElement: null
    };
    const dropdown = {
      innerText: "",
      parentElement: fieldWrapper,
      getAttribute() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    };

    assert.equal(await isDropdownValueConfirmed(dropdown, "Mobile"), true);
    assert.equal(await isDropdownValueConfirmed(dropdown, "Home"), false);
  } finally {
    sandbox.window.location.hostname = originalHostname;
  }
});

asyncTest("Workday multi-select verification rejects typed filter text until a selected-item chip exists", async () => {
  const originalHostname = sandbox.window.location.hostname;
  try {
    sandbox.window.location.hostname = "example.wd5.myworkdayjobs.com";
    const selectedItems = [];
    const searchInput = { value: "Company Career Site" };
    const dropdown = {
      innerText: "",
      parentElement: null,
      getAttribute(name) {
        return name === "data-automation-id" ? "multiSelectContainer" : null;
      },
      querySelector() {
        return searchInput;
      },
      querySelectorAll(selector) {
        return selector === "[data-automation-id='selectedItem']" ? selectedItems : [];
      }
    };

    assert.equal(await isDropdownValueConfirmed(dropdown, "Company Career Site"), false);
    selectedItems.push({
      textContent: "Company Career Site",
      getAttribute(name) {
        return name === "data-automation-label" ? "Company Career Site" : null;
      }
    });
    assert.equal(await isDropdownValueConfirmed(dropdown, "Company Career Site"), true);
  } finally {
    sandbox.window.location.hostname = originalHostname;
  }
});

asyncTest("askLlmForAnswer resolves the LLM's resume-grounded answer when chrome.runtime.sendMessage succeeds", async () => {
  sandbox.chrome.runtime.sendMessage = async () => ({
    ok: true,
    data: { answer: "  I have three years of backend experience relevant to this role.  " }
  });

  const answer = await askLlmForAnswer("Describe your relevant experience.");
  assert.equal(answer, "I have three years of backend experience relevant to this role.");
});

asyncTest("askApplicationQuestionAgent sends the bounded question contract without copying the profile or raw resume", async () => {
  let sentMessage = null;
  sandbox.chrome.runtime.sendMessage = async (message) => {
    sentMessage = message;
    return { ok: true, data: { action: "choose_option", value: "Backend", reason: "Profile match." } };
  };

  const decision = await askApplicationQuestionAgent({
    questionText: "Preferred area?",
    options: ["Frontend", "Backend"],
    fieldKind: "select",
    userProfile: { firstName: "Jeff" }
  });
  assert.equal(sentMessage.type, "APPLE_CAREERS_RESOLVE_APPLICATION_QUESTION");
  assert.deepEqual(Array.from(sentMessage.options), ["Frontend", "Backend"]);
  assert.equal("userProfile" in sentMessage, false);
  assert.equal(decision.action, "choose_option");
  assert.equal(decision.value, "Backend");
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

test("resolveProfileValue keeps non-EEO fixed policies but uses the saved EEO profile", () => {
  const profile = {
    workAuthorized: "no",
    requiresSponsorship: "no",
    eeoRaceEthnicity: ["white", "asian"],
    eeoVeteranStatus: "protected_veteran",
    eeoDisabilityStatus: "yes_current_or_past"
  };
  assert.equal(resolveProfileValue(profile, "workAuthorized"), "Yes");
  assert.equal(resolveProfileValue(profile, "requiresSponsorship"), "Yes");
  assert.deepEqual(resolveProfileValue(profile, "eeoRaceEthnicity"), ["white", "asian"]);
  assert.equal(resolveProfileValue(profile, "eeoVeteranStatus"), "protected_veteran");
  assert.equal(resolveProfileValue(profile, "eeoDisabilityStatus"), "yes_current_or_past");
});

test("buildOptionMatcher recognizes the authorized veteran/disability policy wording and rejects decline options", () => {
  const veteranMatcher = buildOptionMatcher("I am not a protected veteran");
  assert.equal(veteranMatcher("I am not a protected veteran"), true);
  assert.equal(veteranMatcher("I am a protected veteran"), false);
  assert.equal(veteranMatcher("Decline to self-identify"), false);

  const disabilityMatcher = buildOptionMatcher("No, I do not have a disability");
  assert.equal(disabilityMatcher("No, I do not have a disability and have not had one in the past"), true);
  assert.equal(disabilityMatcher("Yes, I have a disability"), false);
  assert.equal(disabilityMatcher("I do not wish to answer"), false);
});

test("buildOptionMatcher maps canonical saved EEO values without matching decline options", () => {
  const asianMatcher = buildOptionMatcher("asian");
  assert.equal(asianMatcher("Asian (Not Hispanic or Latino)"), true);
  assert.equal(asianMatcher("Prefer not to disclose"), false);

  const protectedVeteranMatcher = buildOptionMatcher("protected_veteran");
  assert.equal(protectedVeteranMatcher("I identify as one or more classifications of a protected veteran"), true);
  assert.equal(protectedVeteranMatcher("I am not a protected veteran"), false);

  const noDisabilityMatcher = buildOptionMatcher("no_current_or_past");
  assert.equal(noDisabilityMatcher("No, I do not have a disability and have not had one in the past"), true);
  assert.equal(noDisabilityMatcher("No"), true);
  assert.equal(noDisabilityMatcher("I do not wish to answer"), false);
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

test("hasExpectedFieldValue verifies native selects by selected option text as well as machine value", () => {
  const select = {
    tagName: "SELECT",
    value: "US",
    selectedIndex: 0,
    selectedOptions: [{ textContent: "United States", value: "US" }]
  };
  assert.equal(hasExpectedFieldValue(select, "United States"), true);
  assert.equal(hasExpectedFieldValue(select, "Canada"), false);
});

test("Workday validation recognizes a visible field error even when the input still has a value", () => {
  const previousHostname = sandbox.window.location.hostname;
  sandbox.window.location.hostname = "example.myworkdayjobs.com";
  try {
    const errorElement = {
      textContent: "This field is required",
      disabled: false,
      getAttribute: () => null,
      getBoundingClientRect: () => ({ width: 100, height: 20 })
    };
    const fieldContainer = {
      getAttribute: () => null,
      querySelector: () => null,
      querySelectorAll: () => [errorElement]
    };
    const field = {
      value: "Software Engineer",
      getAttribute: () => null,
      closest: () => fieldContainer
    };

    assert.equal(hasExplicitWorkdayFieldError(field), true);
    sandbox.window.location.hostname = "boards.greenhouse.io";
    assert.equal(hasExplicitWorkdayFieldError(field), false);
  } finally {
    sandbox.window.location.hostname = previousHostname;
  }
});

test("hasMeaningfulExistingFieldValue rejects non-empty placeholder select values but keeps real selections", () => {
  const placeholder = {
    value: "select",
    selectedIndex: 0,
    selectedOptions: [{ textContent: "Select an option", value: "select", disabled: false }]
  };
  const selected = {
    value: "US",
    selectedIndex: 0,
    selectedOptions: [{ textContent: "United States", value: "US", disabled: false }]
  };
  assert.equal(hasMeaningfulExistingFieldValue(placeholder, "select"), false);
  assert.equal(hasMeaningfulExistingFieldValue(selected, "select"), true);
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
  assert.equal(isWorkAuthorizationQuestion("Do you have the right to work in the US?"), true);
  assert.equal(isWorkAuthorizationQuestion("What is your favorite color?"), false);
  assert.equal(isVisaSponsorshipQuestion("Do you now or will you in the future require visa sponsorship?"), true);
  assert.equal(isVisaSponsorshipQuestion("Will you need immigration support for a work visa?"), true);
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

test("Workday text commits clear, insert a prefix, and re-add the final character", () => {
  assert.deepEqual(
    Array.from(buildFrameworkTextCommitStages("Jeff"), (stage) => ({ ...stage })),
    [
      { value: "", inputType: "deleteContentBackward", data: null },
      { value: "Jef", inputType: "insertText", data: "Jef" },
      { value: "Jeff", inputType: "insertText", data: "f" }
    ]
  );
  assert.deepEqual(
    Array.from(buildFrameworkTextCommitStages("8"), (stage) => ({ ...stage })),
    [
      { value: "", inputType: "deleteContentBackward", data: null },
      { value: "8", inputType: "insertText", data: "8" }
    ]
  );
});

test("the extension declares debugger permission for bounded trusted Workday prompt clicks and rejected-text repair", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  assert.equal(manifest.permissions.includes("debugger"), true);
  assert.equal(manifest.optional_permissions?.includes("debugger") || false, false);
});

test("Workday listbox backing inputs are not treated as text fields", () => {
  const trigger = { matches: (selector) => selector === "[aria-haspopup='listbox']" };
  const backingInput = {
    tagName: "INPUT",
    closest: () => null,
    parentElement: {
      querySelector: (selector) => selector === ":scope > [aria-haspopup='listbox']" ? trigger : null
    }
  };
  const ordinaryInput = {
    tagName: "INPUT",
    closest: () => null,
    parentElement: { querySelector: () => null }
  };

  assert.equal(isDropdownBackingInput(backingInput), true);
  assert.equal(isDropdownBackingInput(ordinaryInput), false);
});

test("Workday multi-select search inputs are not treated as ordinary text fields", () => {
  const searchInput = {
    tagName: "INPUT",
    closest(selector) {
      return selector.includes("[data-automation-id='multiSelectContainer']") ? {} : null;
    },
    parentElement: { querySelector: () => null }
  };

  assert.equal(isDropdownBackingInput(searchInput), true);
});

test("Workday responsive prompts open through the prompt button instead of their hidden search input", () => {
  const promptButton = { id: "prompt-button" };
  const searchInput = { id: "search-input" };
  const responsivePrompt = {
    querySelector(selector) {
      if (selector === "[data-automation-hiddensearch='true']") return {};
      if (selector === "[data-automation-id='promptSearchButton']") return promptButton;
      if (selector.includes("input")) return searchInput;
      return null;
    }
  };
  assert.equal(getWorkdayMultiSelectOpenTarget(responsivePrompt), promptButton);

  const searchablePrompt = {
    querySelector(selector) {
      if (selector === "[data-automation-hiddensearch='true']") return null;
      if (selector.includes("input")) return searchInput;
      return null;
    }
  };
  assert.equal(getWorkdayMultiSelectOpenTarget(searchablePrompt), searchInput);
});

test("Workday responsive prompt options stay scoped to their associated widget", () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const visibleOption = {
    disabled: false,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    getAttribute(name) {
      return name === "data-automation-id" ? "menuItem" : null;
    },
    closest: () => null
  };
  const promptRoot = {
    getAttribute(name) {
      return name === "data-associated-widget" ? "source-widget" : null;
    },
    querySelectorAll: () => [visibleOption]
  };
  const unrelatedPromptRoot = {
    getAttribute(name) {
      return name === "data-associated-widget" ? "phone-widget" : null;
    },
    querySelectorAll: () => [{ ...visibleOption }]
  };

  try {
    sandbox.document.querySelectorAll = (selector) =>
      selector === "[data-associated-widget]" ? [promptRoot, unrelatedPromptRoot] : [];
    assert.deepEqual(
      Array.from(getAssociatedWorkdayPromptOptions({ id: "source-widget" })),
      [visibleOption]
    );
    assert.deepEqual(Array.from(getAssociatedWorkdayPromptOptions({ id: "missing-widget" })), []);
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

test("Workday responsive prompt distinguishes branch rows from selectable leaves", () => {
  const typedOption = (type) => ({
    getAttribute: () => null,
    querySelector() {
      return { getAttribute: (name) => name === "data-uxi-multiselectlistitem-type" ? type : null };
    }
  });

  assert.equal(getWorkdayPromptMenuItemType(typedOption("2")), "2");
  assert.equal(getWorkdayPromptMenuItemType(typedOption("1")), "1");
  assert.equal(getWorkdayPromptMenuItemType(typedOption("")), "");
});

test("Workday trusted prompt clicks target the rendered text node observed in manual input", () => {
  const promptOption = {
    innerText: "External Career Site Sources",
    getAttribute: (name) => name === "data-automation-id" ? "promptOption" : null
  };
  const menuItem = {
    innerText: "External Career Site Sources",
    getAttribute: (name) => name === "data-automation-id" ? "menuItem" : null,
    querySelector: (selector) => selector === "[data-automation-id='promptOption']" ? promptOption : null
  };

  assert.equal(getWorkdayTrustedPromptClickTarget(menuItem), promptOption);
  assert.equal(getWorkdayTrustedPromptClickTarget(promptOption), promptOption);
});

test("Workday source branch success requires a changed non-empty menu inventory", () => {
  const option = (label) => ({
    innerText: label,
    textContent: label,
    getAttribute: () => null
  });
  const rootOptions = [
    option("Current or Former Employee"),
    option("External Career Site Sources"),
    option("Referral")
  ];

  assert.deepEqual(
    { ...getWorkdaySourceMenuState(rootOptions, rootOptions) },
    {
      rootInventory: "Current or Former Employee, External Career Site Sources, Referral",
      currentInventory: "Current or Former Employee, External Career Site Sources, Referral",
      optionCount: 3,
      opened: false
    }
  );
  assert.equal(getWorkdaySourceMenuState(rootOptions, []).opened, false);

  const childState = getWorkdaySourceMenuState(rootOptions, [
    option("Alumni Network"),
    option("LinkedIn Connection Post")
  ]);
  assert.equal(childState.opened, true);
  assert.equal(childState.optionCount, 2);
});

test("Workday source refresh can identify the prompt through its tenant-specific input", () => {
  const automationSearch = { id: "automation-search" };
  const uxiSearch = { id: "uxi-search" };
  const prompt = {
    querySelector(selector) {
      if (selector.includes("data-automation-id='searchBox'")) return automationSearch;
      return null;
    }
  };
  const fallbackPrompt = {
    querySelector(selector) {
      if (selector.includes("data-uxi-widget-type='selectinput'")) return uxiSearch;
      return null;
    }
  };

  assert.equal(getWorkdayDropdownSearchInput(prompt), automationSearch);
  assert.equal(getWorkdayDropdownSearchInput(fallbackPrompt), uxiSearch);
});

test("Workday promptOption choices are inventoried while committed selected-item chips are excluded", () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const option = (automationId, width = 100) => ({
    disabled: false,
    getBoundingClientRect: () => ({ width, height: 20 }),
    getAttribute(name) {
      if (name === "data-automation-id") return automationId;
      if (name === "aria-disabled" || name === "disabled") return null;
      return null;
    },
    closest(selector) {
      return selector === "[data-automation-id='selectedItemList']" && automationId === "selectedItem" ? {} : null;
    }
  });
  const promptOption = option("promptOption");
  const roleOption = option(null);
  const selectedItem = option("selectedItem");
  const hiddenPromptOption = option("promptOption", 0);

  try {
    sandbox.document.querySelectorAll = () => [promptOption, roleOption, selectedItem, hiddenPromptOption];
    assert.deepEqual(Array.from(getVisibleDropdownOptionElements()), [promptOption, roleOption]);
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

test("generic autofill installs its bounded action bridge in the page MAIN world", () => {
  const backgroundSource = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.match(backgroundSource, /world:\s*["']MAIN["']/);
  assert.match(backgroundSource, /genericAutofill\/mainWorldBridge\.js/);

  const actionsSource = fs.readFileSync(path.join(__dirname, "..", "genericAutofill", "actions.js"), "utf8");
  assert.match(actionsSource, /await clickElementInMainWorld\(openTarget\)/);
  assert.match(actionsSource, /await clickElementInMainWorld\(option,\s*\{\s*focus:\s*false\s*\}\)/);
  assert.match(
    actionsSource,
    /clickElementInMainWorld\(option,\s*\{\s*focus:\s*false,\s*sequence:\s*["']workday_prompt_menu_item["']\s*\}\)/
  );
  const clickResolverSource = actionsSource.slice(
    actionsSource.indexOf("async function clickResolvedDropdownOption"),
    actionsSource.indexOf("async function selectOpenedDropdownOption")
  );
  assert.ok(
    clickResolverSource.indexOf("sequence: \"workday_prompt_menu_item\"") <
      clickResolverSource.indexOf("clickElementThroughTrustedInput(trustedTarget)"),
    "Workday prompt rows must use the recorded page-context sequence before the trusted fallback"
  );
  assert.match(clickResolverSource, /recorded page-context sequence/);
  assert.match(clickResolverSource, /trusted browser input fallback on rendered branch text/);
  assert.match(actionsSource, /then trusted browser input retry/);
  assert.match(actionsSource, /APPLE_CAREERS_TRUSTED_WORKDAY_CLICK/);
  assert.match(actionsSource, /APPLE_CAREERS_TRUSTED_WORKDAY_TEXT_REPLACEMENT/);
  assert.match(actionsSource, /replaceRejectedWorkdayTextThroughTrustedInput/);
  assert.match(actionsSource, /data-automation-id["']\)\s*===\s*["']promptOption["']/);
  assert.match(actionsSource, /selectWorkdayReferralSource/);
  assert.match(actionsSource, /selectWorkdayReferralSource\(dropdownElement, openedOptions = \[\]\)/);
  assert.match(actionsSource, /await waitForPreferredWorkdaySourceLevel\(Array\.from\(optionsBeforeParentClick\)\)/);
  assert.match(
    actionsSource,
    /choosePreferredWorkdaySourceLabel\(candidateOptions\.map\(\(option\) => getOptionLabel\(option\)\)\)/
  );
  assert.match(actionsSource, /child menu did not appear\. Visible options remained:/);
  assert.match(actionsSource, /Child options \(/);
  assert.match(actionsSource, /opened:\s*optionCount > 0 && currentInventory !== rootInventory/);
  assert.match(
    actionsSource,
    /choosePreferredWorkdaySourceLabel\(candidateOptions\.map\(\(option\) => getOptionLabel\(option\)\)\)\) \{\s*latestOptions = currentOptions;\s*finish\(\);\s*return;/
  );
  assert.match(actionsSource, /The discovered leaf .* was not committed:/);
  assert.match(actionsSource, /associatedOptionsBeforeOpen\.length > 0/);
  assert.match(actionsSource, /choosePreferredWorkdaySourceParentLabel/);
  assert.match(actionsSource, /for\s*\(let depth = 0; depth < 4; depth \+= 1\)/);
  const sourceSelector = actionsSource.slice(
    actionsSource.indexOf("async function selectWorkdayReferralSource"),
    actionsSource.indexOf("function hasVisibleDropdownOptions")
  );
  assert.doesNotMatch(sourceSelector, /fillTextField/);
  assert.doesNotMatch(sourceSelector, /["']LinkedIn["']\s*\)/);
  assert.doesNotMatch(actionsSource, /selectWorkdayNestedReferralOption/);
  assert.doesNotMatch(actionsSource, /APPLE_CAREERS_TRUSTED_WORKDAY_PROMPT_ENTER/);
  assert.doesNotMatch(actionsSource, /selectWorkdayDropdownByFilteredOption/);
  assert.doesNotMatch(actionsSource, /typeInWorkdayDropdownSearch/);

  const loopSource = fs.readFileSync(path.join(__dirname, "..", "genericAutofill", "loop.js"), "utf8");
  assert.match(loopSource, /matcher:\s*isReferralSourceQuestion,\s*fixedValue:\s*["']Other["']/);
  assert.match(loopSource, /const openedSourceEntry = snapshotPage\(\)/);
  assert.match(
    loopSource,
    /await selectWorkdayReferralSource\(\s*openedSourceEntry\?\.element \|\| sourceEntry\.element,\s*openedOptions\s*\)/
  );
  assert.ok(
    loopSource.indexOf("const openedSourceEntry = snapshotPage()") <
      loopSource.indexOf("const MAX_FIELD_PASS_ITERATIONS"),
    "Workday source selection must run before ordinary text fields"
  );
  assert.doesNotMatch(loopSource, /selectWorkdayNestedReferralOption/);
  assert.match(loopSource, /await replaceRejectedWorkdayTextThroughTrustedInput\(element, existingValue\)/);
  assert.doesNotMatch(loopSource, /Workday still rejected the value after a page-context input retry/);
  assert.doesNotMatch(loopSource, /\["Job Board"\]/);
});

test("the MAIN-world bridge commits Workday text through browser editing and applies resolved clicks", () => {
  class FakeInput {
    constructor() {
      this.tagName = "INPUT";
      this.events = [];
      this.dispatchedEvents = [];
      this.focused = false;
    }
    focus() {
      this.focused = true;
    }
    select() {
      this.selected = true;
    }
    blur() {
      this.focused = false;
    }
    dispatchEvent(event) {
      this.events.push(event.type);
      this.dispatchedEvents.push(event);
      return true;
    }
    scrollIntoView() {
      this.scrolled = true;
    }
    getBoundingClientRect() {
      return { left: 10, top: 20, width: 100, height: 40 };
    }
    click() {
      this.events.push("click");
    }
  }
  Object.defineProperty(FakeInput.prototype, "value", {
    configurable: true,
    get() {
      return this._value || "";
    },
    set(value) {
      this._value = value;
    }
  });
  class FakeTextArea extends FakeInput {}
  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  }

  const listeners = {};
  const responses = [];
  const editingCommands = [];
  const input = new FakeInput();
  const bridgeWindow = {
    __careerPeelerMainWorldBridgeLoaded: true,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    postMessage(message) {
      responses.push(message);
    }
  };
  const bridgeSandbox = {
    window: bridgeWindow,
    document: {
      querySelector: () => input,
      execCommand(command, _showUi, value) {
        editingCommands.push({ command, value });
        if (command === "delete") {
          input.value = "";
        } else if (command === "insertText") {
          input.value += String(value ?? "");
        }
        input.events.push("input");
        return true;
      }
    },
    CSS: { escape: (value) => value },
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    InputEvent: FakeEvent,
    Event: FakeEvent,
    FocusEvent: FakeEvent,
    MouseEvent: FakeEvent,
    PointerEvent: FakeEvent
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "genericAutofill", "mainWorldBridge.js"), "utf8"),
    bridgeSandbox,
    { filename: "mainWorldBridge.js" }
  );
  assert.equal(bridgeWindow.__careerPeelerMainWorldBridgeVersion, 3);

  listeners.message({
    source: bridgeWindow,
    data: {
      channel: "career-peeler-main-world-text-request-v3",
      requestId: "request-1",
      targetId: "target-1",
      value: "Jeff",
      stages: [
        { value: "", inputType: "deleteContentBackward", data: null },
        { value: "Jef", inputType: "insertText", data: "Jef" },
        { value: "Jeff", inputType: "insertText", data: "f" }
      ]
    }
  });

  assert.equal(input.value, "Jeff");
  assert.deepEqual(editingCommands, [
    { command: "delete", value: null },
    { command: "insertText", value: "Jef" },
    { command: "insertText", value: "f" }
  ]);
  assert.deepEqual(input.events, ["input", "input", "input", "change", "blur"]);
  assert.equal(responses.at(-1).channel, "career-peeler-main-world-text-response-v3");
  assert.equal(responses.at(-1).ok, true);

  input.events = [];
  input.focused = false;
  listeners.message({
    source: bridgeWindow,
    data: {
      channel: "career-peeler-main-world-click-request-v3",
      requestId: "request-2",
      targetId: "target-2",
      focus: false
    }
  });

  assert.equal(input.scrolled, true);
  assert.equal(input.focused, false);
  assert.deepEqual(input.events, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  assert.equal(responses.at(-1).channel, "career-peeler-main-world-click-response-v3");
  assert.equal(responses.at(-1).ok, true);

  input.events = [];
  input.dispatchedEvents = [];
  listeners.message({
    source: bridgeWindow,
    data: {
      channel: "career-peeler-main-world-click-request-v3",
      requestId: "request-3",
      targetId: "target-3",
      focus: false,
      sequence: "workday_prompt_menu_item"
    }
  });

  assert.deepEqual(input.events, ["focus", "mousedown", "mouseup", "click", "blur"]);
  const promptMouseEvents = input.dispatchedEvents.filter((event) =>
    ["mousedown", "mouseup", "click"].includes(event.type)
  );
  assert.deepEqual(
    promptMouseEvents.map((event) => ({
      type: event.type,
      clientX: event.clientX,
      clientY: event.clientY,
      buttons: event.buttons,
      detail: event.detail,
      view: event.view
    })),
    [
      { type: "mousedown", clientX: 60, clientY: 40, buttons: 1, detail: 1, view: bridgeWindow },
      { type: "mouseup", clientX: 60, clientY: 40, buttons: 0, detail: 1, view: bridgeWindow },
      { type: "click", clientX: 60, clientY: 40, buttons: 0, detail: 1, view: bridgeWindow }
    ]
  );
  assert.equal(responses.at(-1).channel, "career-peeler-main-world-click-response-v3");
  assert.equal(responses.at(-1).ok, true);
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

test("buildTextFillRetryOutcome reports success when the framework-compatible retry stuck", () => {
  const outcome = retryOutcome("Address", {
    settledOk: false,
    fallback: { ok: true },
    fallbackFinalOk: true
  });
  assert.deepEqual(outcome, { ok: true, viaFallback: true });
});

test("buildTextFillRetryOutcome flags the field when the framework-compatible retry ran but still didn't stick", () => {
  const outcome = retryOutcome("Address", {
    settledOk: false,
    fallback: { ok: true },
    fallbackFinalOk: false
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /after a framework-compatible retry/);
  assert.equal(outcome.observation, "value still didn't stick after the framework-compatible retry");
});

test("buildTextFillRetryOutcome flags the field with the specific error when the framework-compatible retry itself failed", () => {
  const outcome = retryOutcome("Address", {
    settledOk: false,
    fallback: { ok: false, error: "The field was replaced before its value could be committed." },
    fallbackFinalOk: false
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /field was replaced/);
  assert.equal(
    outcome.observation,
    "framework-compatible retry failed (The field was replaced before its value could be committed.)"
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

asyncTest("runGenericAutofill closes its explicit activity cycle in chrome.storage.local", async () => {
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

  assert.equal(stored.cycles.length, 1);
  assert.equal(stored.cycles[0].status, "success");
  assert.equal(stored.cycles[0].outcome, "Complete");
  assert.equal(typeof stored.cycles[0].completedAt, "number");
  assert.ok(stored.steps.every((step) => step.cycleId === stored.cycles[0].id));
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
