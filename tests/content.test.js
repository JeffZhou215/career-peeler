const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
// lib/core.js has zero chrome.*/DOM dependency, so it loads as a real module here (no vm sandbox
// needed) -- used below to test the actual bridge from a local match decision to auto-apply eligibility,
// not just content.js's classification in isolation.
const { statusFromDecision, shouldAutoApply, normalizeUserProfile } = require(path.join(__dirname, "..", "lib", "core.js"));

const contentPath = path.join(__dirname, "..", "content.js");
const source = fs.readFileSync(contentPath, "utf8");

const sandbox = {
  URL,
  console,
  setTimeout,
  chrome: {
    runtime: {
      onMessage: {
        addListener() {}
      }
    }
  },
  document: {
    body: { innerText: "" },
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
      href: "https://jobs.apple.com/en-us/search",
      pathname: "/en-us/search",
      search: ""
    },
    getComputedStyle() {
      return {
        visibility: "visible",
        display: "block"
      };
    }
  }
};

vm.runInNewContext(
  `${source}
globalThis.__contentTestApi = {
  analyzeLocalMatch,
  auditRequiredApplicationFields,
  classifyRole,
  cleanTitle,
  clickAndDetectSubmission,
  clickPrimaryAction,
  extractExperienceMatches,
  extractAppleSubmittedRoleDetails,
  getAlreadyAppliedSignal,
  getRequiredFieldAuditFingerprint,
  getSubmittedSignal,
  getJobIdFromUrl,
  hasVisibleApplicationQuestionControls,
  getApplicationControlQuestionLabel,
  findAgentCustomDropdown,
  findAgentNativeSelect,
  findAgentOptionGroup,
  findOpenTextQuestionField,
  isQuestionControlRequired,
  isCategoricalWorkAuthorizationStatusQuestion,
  isAgeEligibilityQuestion,
  isApplicationChoiceQuestion,
  isAgentQuestionExcluded,
  isAgentChoiceConfirmed,
  isAlreadyAppliedDialogText,
  isAnswerControlElement,
  isEssayQuestionLabel,
  isInternshipTitle,
  isNonAnswerAction,
  isNoAnswerText,
  isCriminalHistoryQuestion,
  isDisabilityStatusQuestion,
  isPriorAppleContractorQuestion,
  isPriorAppleEmploymentQuestion,
  isRaceEthnicityQuestion,
  isStartDateQuestion,
  isSupportedJobDetailUrl,
  isTikTokAuthorizationModuleQuestion,
  isValidationBlockedControl,
  isVisaSponsorshipQuestion,
  isVeteranStatusQuestion,
  isWorkAuthorizationQuestion,
  isYesAnswerText,
  parseYears,
  resolveRequiredFieldAudit,
  runApplicationWorkflowStep,
  shouldAgentAnswerRequiredControl,
  shouldAnswerTikTokAuthorizationField,
  textIncludesTerm,
  waitForAppleWithdrawalConfirmationModal
};`,
  sandbox,
  { filename: "content.js" }
);

const {
  analyzeLocalMatch,
  auditRequiredApplicationFields,
  classifyRole,
  cleanTitle,
  clickAndDetectSubmission,
  clickPrimaryAction,
  extractExperienceMatches,
  extractAppleSubmittedRoleDetails,
  getAlreadyAppliedSignal,
  getRequiredFieldAuditFingerprint,
  getSubmittedSignal,
  getJobIdFromUrl,
  hasVisibleApplicationQuestionControls,
  getApplicationControlQuestionLabel,
  findAgentCustomDropdown,
  findAgentNativeSelect,
  findAgentOptionGroup,
  findOpenTextQuestionField,
  isQuestionControlRequired,
  isCategoricalWorkAuthorizationStatusQuestion,
  isAgeEligibilityQuestion,
  isApplicationChoiceQuestion,
  isAgentQuestionExcluded,
  isAgentChoiceConfirmed,
  isAlreadyAppliedDialogText,
  isAnswerControlElement,
  isEssayQuestionLabel,
  isInternshipTitle,
  isNonAnswerAction,
  isNoAnswerText,
  isCriminalHistoryQuestion,
  isDisabilityStatusQuestion,
  isPriorAppleContractorQuestion,
  isPriorAppleEmploymentQuestion,
  isRaceEthnicityQuestion,
  isStartDateQuestion,
  isSupportedJobDetailUrl,
  isTikTokAuthorizationModuleQuestion,
  isValidationBlockedControl,
  isVisaSponsorshipQuestion,
  isVeteranStatusQuestion,
  isWorkAuthorizationQuestion,
  isYesAnswerText,
  parseYears,
  resolveRequiredFieldAudit,
  runApplicationWorkflowStep,
  shouldAgentAnswerRequiredControl,
  shouldAnswerTikTokAuthorizationField,
  textIncludesTerm,
  waitForAppleWithdrawalConfirmationModal
} = sandbox.__contentTestApi;

function classify(
  title,
  description,
  userYearsOfExperience,
  noMatchKeywords,
  resumeProfileText = "Software engineer experienced in Python, Java, backend APIs, AWS, SQL, distributed systems, and machine learning."
) {
  const combinedText = `${title}\n${description}`;
  const matches = extractExperienceMatches(combinedText);
  const matchScore = analyzeLocalMatch(combinedText, noMatchKeywords, resumeProfileText);
  return {
    ...classifyRole(matches, matchScore, title, userYearsOfExperience),
    matchScore,
    matches
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const asyncTests = [];

function asyncTest(name, fn) {
  asyncTests.push({ name, fn });
}

test("parses numeric and word-based years", () => {
  assert.deepEqual(Array.from(parseYears("Requires 2+ years of software experience")), [2]);
  assert.deepEqual(Array.from(parseYears("Requires three years of engineering experience")), [3]);
});

test("matches exact technical terms without substring false positives", () => {
  assert.equal(textIncludesTerm("We use JavaScript and React", "JavaScript"), true);
  assert.equal(textIncludesTerm("This role uses TypeScript", "Java"), false);
});

test("cleans Apple Careers title suffixes", () => {
  assert.equal(
    cleanTitle("Software QA Engineer, Creativity Apps - Jobs - Careers at Apple"),
    "Software QA Engineer, Creativity Apps"
  );
});

test("extracts Apple role id from details URL", () => {
  assert.equal(
    getJobIdFromUrl("https://jobs.apple.com/en-us/details/200637724-0836/software-qa-engineer?team=SFTWR"),
    "200637724-0836"
  );
});

test("Apple posting details remain usable when qualification sections are absent", () => {
  const originalHref = sandbox.window.location.href;
  const originalTitle = sandbox.document.title;
  const originalQuerySelector = sandbox.document.querySelector;
  try {
    sandbox.window.location.href = "https://jobs.apple.com/en-us/details/200651307-0836/hid-algorithms-engineer";
    sandbox.document.title = "HID Algorithms Engineer - Jobs - Careers at Apple";
    sandbox.document.querySelector = (selector) => selector === "#jobdetails-jobdescription"
      ? { innerText: "Build and integrate sensing algorithms with the software stack, collaborate with engineers, and ship reliable user experiences." }
      : null;
    const details = extractAppleSubmittedRoleDetails();
    assert.equal(details.jobId, "200651307-0836");
    assert.equal(details.ready, true);
    assert.equal(details.minimumQualifications, "");
  } finally {
    sandbox.window.location.href = originalHref;
    sandbox.document.title = originalTitle;
    sandbox.document.querySelector = originalQuerySelector;
  }
});

test("extracts TikTok and ByteDance role ids from details URLs", () => {
  assert.equal(
    getJobIdFromUrl("https://careers.tiktok.com/position/7391234567890123456/detail"),
    "7391234567890123456"
  );
  assert.equal(
    getJobIdFromUrl("https://jobs.bytedance.com/en/position/7391234567890123456/detail"),
    "7391234567890123456"
  );
  assert.equal(
    getJobIdFromUrl("https://lifeattiktok.com/resume/7538573630772726034/apply"),
    "7538573630772726034"
  );
  assert.equal(
    getJobIdFromUrl("https://lifeattiktok.com/search/7278068779270408508"),
    "7278068779270408508"
  );
});

test("extracts generic career role ids from query parameters", () => {
  assert.equal(
    getJobIdFromUrl("https://careers.tiktok.com/search?job_id=ABC-123"),
    "ABC-123"
  );
});

test("recognizes TikTok search detail links but not application links as result cards", () => {
  assert.equal(isSupportedJobDetailUrl(new URL("https://lifeattiktok.com/search/7278068779270408508")), true);
  assert.equal(isSupportedJobDetailUrl(new URL("https://lifeattiktok.com/search?keyword=ml")), false);
  assert.equal(isSupportedJobDetailUrl(new URL("https://lifeattiktok.com/resume/7278068779270408508/apply")), false);
  assert.equal(isSupportedJobDetailUrl(new URL("https://careers.tiktok.com/position/application")), false);
  assert.equal(isSupportedJobDetailUrl(new URL("https://careers.tiktok.com/position/7278068779270408508/detail")), true);
});

test("recognizes joinbytedance.com as a supported ByteDance careers host", () => {
  assert.equal(
    isSupportedJobDetailUrl(
      new URL(
        "https://joinbytedance.com/search?keyword=software+engineer&recruitment_id_list=1&job_category_id_list=&subject_id_list=&location_code_list=CT_159%2CCT_93&limit=12&offset=0"
      )
    ),
    false
  );
  assert.equal(isSupportedJobDetailUrl(new URL("https://joinbytedance.com/search/7278068779270408508")), true);
  assert.equal(
    getJobIdFromUrl("https://joinbytedance.com/search/7278068779270408508"),
    "7278068779270408508"
  );
});

test("recognizes TikTok work authorization and sponsorship questions", () => {
  assert.equal(
    isWorkAuthorizationQuestion("Are you legally authorized to work in the US without restriction?"),
    true
  );
  assert.equal(
    isVisaSponsorshipQuestion("Will you now or in the future require visa sponsorship or a visa transfer?"),
    true
  );
  assert.equal(isWorkAuthorizationQuestion("Are you eligible to work in the United States?"), true);
  assert.equal(isWorkAuthorizationQuestion("Are you legally authorized to work in Singapore?"), true);
  assert.equal(isWorkAuthorizationQuestion("Current right-to-work status"), true);
  assert.equal(isCategoricalWorkAuthorizationStatusQuestion("Current right-to-work status"), true);
  assert.equal(isVisaSponsorshipQuestion("Will you need immigration support for a work visa?"), true);
});

test("selects only affirmative yes answer labels", () => {
  assert.equal(isYesAnswerText("Yes"), true);
  assert.equal(isYesAnswerText("Yes, I am authorized"), true);
  assert.equal(isYesAnswerText("No"), false);
  assert.equal(isYesAnswerText("Prefer not to answer"), false);
});

test("selects only negative no answer labels", () => {
  assert.equal(isNoAnswerText("No"), true);
  assert.equal(isNoAnswerText("No, I have not"), true);
  assert.equal(isNoAnswerText("Yes"), false);
  assert.equal(isNoAnswerText("Prefer not to answer"), false);
});

test("recognizes Apple age eligibility and prior employment screening questions", () => {
  assert.equal(isAgeEligibilityQuestion("Are you 18 years of age or older?"), true);
  assert.equal(
    isPriorAppleEmploymentQuestion("Have you ever been employed by Apple?"),
    true
  );
  assert.equal(
    isPriorAppleContractorQuestion(
      "Have you ever worked for Apple as a temporary agency worker, consultant, or an independent contractor?"
    ),
    true
  );
  assert.equal(isAgeEligibilityQuestion("Will you now or in the future require visa sponsorship?"), false);
  assert.equal(isPriorAppleEmploymentQuestion("Are you legally authorized to work in the United States?"), false);
});

test("known-site question-agent discovery recognizes the authorized date, criminal-history, and EEO concepts", () => {
  assert.equal(isStartDateQuestion("What is the earliest date you are available to start?"), true);
  assert.equal(isCriminalHistoryQuestion("Have you ever been convicted of a felony?"), true);
  assert.equal(isCriminalHistoryQuestion("Do you consent to a background check?"), false);
  assert.equal(isRaceEthnicityQuestion("Race / Ethnicity"), true);
  assert.equal(isVeteranStatusQuestion("Protected veteran status"), true);
  assert.equal(isDisabilityStatusQuestion("Voluntary self-identification of disability"), true);
  assert.equal(isApplicationChoiceQuestion("What is the earliest date you are available to start?"), true);
  assert.equal(isApplicationChoiceQuestion("Download Resume"), false);
});

test("known-site controls use a data-field/ancestor question instead of a bare Select trigger label", () => {
  const dataField = {
    getAttribute(name) {
      return name === "data-form-field-i18n-name" ? "What is your earliest available start date?" : null;
    }
  };
  const control = {
    name: "",
    id: "",
    labels: [],
    parentElement: null,
    getAttribute(name) {
      return name === "aria-label" ? "Select" : null;
    },
    closest(selector) {
      return selector === "[data-form-field-i18n-name]" ? dataField : null;
    }
  };
  assert.equal(getApplicationControlQuestionLabel(control), "What is your earliest available start date?");
});

test("known-site option groups require real selected state; only custom-dropdown trigger text can confirm a choice", () => {
  const unselectedOption = {
    checked: false,
    className: "",
    getAttribute() {
      return null;
    },
    querySelector() {
      return null;
    }
  };
  assert.equal(isAgentChoiceConfirmed("option_group", unselectedOption, "Yes No", "Yes"), false);
  assert.equal(isAgentChoiceConfirmed("custom_dropdown", unselectedOption, "Selected: Yes", "Yes"), true);
});

test("known-site custom-dropdown discovery skips a handled first question and continues to the next one", () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const makeDropdown = (question) => ({
    required: true,
    disabled: false,
    labels: [],
    name: "",
    id: "",
    parentElement: null,
    innerText: "Select",
    contains() {
      return false;
    },
    getBoundingClientRect() {
      return { width: 120, height: 32 };
    },
    getAttribute(name) {
      return name === "aria-label" ? "Select" : null;
    },
    closest(selector) {
      if (selector === "[data-form-field-i18n-name]") {
        return { getAttribute: () => question };
      }
      return null;
    }
  });
  const first = makeDropdown("First question?");
  const second = makeDropdown("Second question?");

  try {
    sandbox.document.querySelectorAll = () => [first, second];
    assert.equal(findAgentCustomDropdown(new Set(["custom_dropdown::First question?"])), second);
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

test("known-site question discovery skips every optional question and keeps required questions", () => {
  const makeQuestion = (required) => ({
    required,
    getAttribute() {
      return null;
    },
    closest() {
      return null;
    },
    querySelector() {
      return null;
    }
  });

  assert.equal(isQuestionControlRequired(makeQuestion(false), "Why Apple?"), false);
  assert.equal(isQuestionControlRequired(makeQuestion(true), "Why Apple?"), true);
  assert.equal(isQuestionControlRequired(makeQuestion(false), "Why Apple? *"), true);
  assert.equal(isQuestionControlRequired(makeQuestion(false), "Why Apple? (optional) *"), false);
  assert.equal(
    isQuestionControlRequired(makeQuestion(false), "Current right-to-work status — mandatory for applicants to Singapore"),
    true
  );
  assert.equal(isQuestionControlRequired(makeQuestion(true), "What term best describes your gender identity? — voluntary"), false);
  assert.equal(isQuestionControlRequired(makeQuestion(false), "Do you have a disability? — voluntary"), false);
  const voluntarySection = { innerText: "Voluntary demographic survey", parentElement: null };
  const localField = {
    innerText: "Gender identity",
    parentElement: voluntarySection,
    querySelector() { return null; },
    getAttribute() { return null; }
  };
  const nestedVoluntaryQuestion = {
    required: true,
    getAttribute() { return null; },
    closest() { return localField; },
    querySelector() { return null; }
  };
  assert.equal(isQuestionControlRequired(nestedVoluntaryQuestion, "Gender identity"), false);
  assert.equal(
    isQuestionControlRequired(makeQuestion(false), "Will you be required to obtain sponsorship?"),
    false
  );
});

test("required-field audit inventories answered, answerable, and unsupported required controls", () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const makeField = (label) => ({
    innerText: label,
    getAttribute(name) {
      return name === "data-form-field-i18n-name" ? label : null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  });
  const makeControl = ({ tagName, label, required = true, value = "", type = "" }) => {
    const field = makeField(label);
    const control = {
      tagName,
      type,
      required,
      value,
      disabled: false,
      readOnly: false,
      labels: [],
      name: "",
      id: "",
      parentElement: field,
      className: "",
      checked: false,
      options: [],
      selectedIndex: -1,
      contains() {
        return false;
      },
      matches() {
        return false;
      },
      getAttribute(name) {
        if (name === "type") return type || null;
        if (name === "aria-label") return label;
        return null;
      },
      getBoundingClientRect() {
        return { width: 240, height: 40 };
      },
      closest(selector) {
        if (selector === "#apply-parsing-feedback") return null;
        if (selector.includes("[data-form-field-i18n-name]")) return field;
        if (selector === "label, fieldset, div, li, section") return field;
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    };
    field.querySelectorAll = (selector) => selector.includes("radio") || selector.includes("checkbox") ? [control] : [];
    return control;
  };

  const requiredSelect = makeControl({ tagName: "SELECT", label: "Current work pass status" });
  requiredSelect.options = [
    { disabled: false, value: "", textContent: "Select" },
    { disabled: false, value: "foreigner", textContent: "Foreigner" }
  ];
  requiredSelect.selectedIndex = 0;
  const answeredText = makeControl({ tagName: "INPUT", type: "text", label: "Why this role?", value: "Relevant answer" });
  const optionalText = makeControl({ tagName: "TEXTAREA", label: "Additional comments (optional)" });
  const unsupportedCheckbox = makeControl({
    tagName: "INPUT",
    type: "checkbox",
    label: "I certify this application is accurate"
  });

  try {
    sandbox.document.querySelectorAll = () => [requiredSelect, answeredText, optionalText, unsupportedCheckbox];
    const audit = auditRequiredApplicationFields();

    assert.equal(audit.totalRequired, 3);
    assert.equal(audit.answeredCount, 1);
    assert.equal(audit.unanswered.length, 2);
    assert.deepEqual(
      Array.from(audit.answerableUnanswered, (record) => record.label),
      ["Current work pass status"]
    );
    assert.deepEqual(
      Array.from(audit.unsupportedUnanswered, (record) => record.label),
      ["I certify this application is accurate"]
    );
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

asyncTest("required-field audit invokes the question agent only for supported unanswered fields and re-reads afterward", async () => {
  const originalAuditRequiredApplicationFields = sandbox.auditRequiredApplicationFields;
  const originalAnswerRequiredQuestionsWithAgent = sandbox.answerRequiredQuestionsWithAgent;
  let auditReads = 0;
  let agentCalls = 0;

  try {
    sandbox.auditRequiredApplicationFields = () => {
      auditReads += 1;
      if (auditReads === 1) {
        const record = { label: "Current right-to-work status", answerable: true };
        return {
          totalRequired: 1,
          answeredCount: 0,
          unanswered: [record],
          answerableUnanswered: [record],
          unsupportedUnanswered: []
        };
      }
      return {
        totalRequired: 1,
        answeredCount: 1,
        unanswered: [],
        answerableUnanswered: [],
        unsupportedUnanswered: []
      };
    };
    sandbox.answerRequiredQuestionsWithAgent = async () => {
      agentCalls += 1;
      return {
        answeredCount: 1,
        incomplete: false,
        alreadyAppliedSignal: null,
        questionText: null
      };
    };

    const result = await resolveRequiredFieldAudit([]);
    assert.equal(agentCalls, 1);
    assert.equal(auditReads, 2);
    assert.equal(result.incomplete, false);
    assert.equal(result.answeredCount, 1);
  } finally {
    sandbox.auditRequiredApplicationFields = originalAuditRequiredApplicationFields;
    sandbox.answerRequiredQuestionsWithAgent = originalAnswerRequiredQuestionsWithAgent;
  }
});

asyncTest("required-field audit blocks an unsupported required control without spending an LLM call", async () => {
  const originalAuditRequiredApplicationFields = sandbox.auditRequiredApplicationFields;
  const originalAnswerRequiredQuestionsWithAgent = sandbox.answerRequiredQuestionsWithAgent;
  let agentCalls = 0;
  const record = { label: "Required certification", answerable: false };
  const blockedAudit = {
    totalRequired: 1,
    answeredCount: 0,
    unanswered: [record],
    answerableUnanswered: [],
    unsupportedUnanswered: [record]
  };

  try {
    sandbox.auditRequiredApplicationFields = () => blockedAudit;
    sandbox.answerRequiredQuestionsWithAgent = async () => {
      agentCalls += 1;
      throw new Error("unsupported controls must not invoke the question agent");
    };

    const steps = [];
    const result = await resolveRequiredFieldAudit(steps);
    assert.equal(agentCalls, 0);
    assert.equal(result.incomplete, true);
    assert.equal(result.questionText, "Required certification");
    assert.ok(steps.some((step) => step.step === "Audit required fields" && step.status === "blocked"));
  } finally {
    sandbox.auditRequiredApplicationFields = originalAuditRequiredApplicationFields;
    sandbox.answerRequiredQuestionsWithAgent = originalAnswerRequiredQuestionsWithAgent;
  }
});

asyncTest("required-field recovery stops before another agent call when the same fields made no progress", async () => {
  const originalAuditRequiredApplicationFields = sandbox.auditRequiredApplicationFields;
  const originalAnswerRequiredQuestionsWithAgent = sandbox.answerRequiredQuestionsWithAgent;
  const record = { kind: "custom_dropdown", label: "Current right-to-work status", answerable: true };
  const blockedAudit = {
    totalRequired: 1,
    answeredCount: 0,
    unanswered: [record],
    answerableUnanswered: [record],
    unsupportedUnanswered: []
  };
  let agentCalls = 0;

  try {
    sandbox.auditRequiredApplicationFields = () => blockedAudit;
    sandbox.answerRequiredQuestionsWithAgent = async () => {
      agentCalls += 1;
      throw new Error("a repeated recovery target must not spend another agent call");
    };

    const fingerprint = getRequiredFieldAuditFingerprint(blockedAudit);
    const result = await resolveRequiredFieldAudit([], {
      includeUnmarked: true,
      previousRecoveryFingerprint: fingerprint
    });

    assert.equal(result.noProgress, true);
    assert.equal(result.incomplete, true);
    assert.equal(result.recoveryFingerprint, fingerprint);
    assert.equal(agentCalls, 0);
  } finally {
    sandbox.auditRequiredApplicationFields = originalAuditRequiredApplicationFields;
    sandbox.answerRequiredQuestionsWithAgent = originalAnswerRequiredQuestionsWithAgent;
  }
});

test("the question agent discovers required non-question select and text labels", () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const selectField = {
    innerText: "Singapore Work Pass Status",
    getAttribute(name) {
      return name === "data-form-field-i18n-name" ? "Singapore Work Pass Status" : null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  const select = {
    tagName: "SELECT",
    required: true,
    disabled: false,
    labels: [],
    name: "",
    id: "",
    parentElement: null,
    selectedIndex: 0,
    options: [
      { disabled: false, value: "", textContent: "Select" },
      { disabled: false, value: "employment_pass", textContent: "Employment Pass" }
    ],
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return { width: 240, height: 40 };
    },
    closest(selector) {
      if (selector.includes("[data-form-field-i18n-name]")) return selectField;
      if (selector === "label, fieldset, div, li, section") return selectField;
      return null;
    }
  };
  const textField = {
    tagName: "INPUT",
    required: true,
    readOnly: false,
    disabled: false,
    labels: [],
    name: "",
    id: "",
    value: "",
    parentElement: null,
    getAttribute(name) {
      if (name === "type") return "text";
      if (name === "aria-label") return "Singapore Work Pass Number";
      return null;
    },
    getBoundingClientRect() {
      return { width: 240, height: 40 };
    },
    closest() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };

  try {
    sandbox.document.querySelectorAll = (selector) => selector === "select" ? [select] : [];
    assert.equal(findAgentNativeSelect(), select);

    sandbox.document.querySelectorAll = (selector) => selector.includes("textarea") ? [textField] : [];
    assert.equal(findOpenTextQuestionField(), textField);
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

test("ByteDance validation can wake the agent for an unmarked required control, but optional still wins", () => {
  const invalidField = {
    getBoundingClientRect() {
      return { width: 240, height: 40 };
    }
  };
  const container = {
    getAttribute() {
      return null;
    },
    querySelector(selector) {
      return selector === "[aria-invalid='true']" ? invalidField : null;
    },
    querySelectorAll() {
      return [];
    }
  };
  const control = {
    required: false,
    parentElement: null,
    getAttribute() {
      return null;
    },
    closest(selector) {
      return selector.includes("[data-form-field-i18n-name]") ? container : null;
    },
    querySelector() {
      return null;
    }
  };

  assert.equal(isValidationBlockedControl(control), true);
  assert.equal(shouldAgentAnswerRequiredControl(control, "Singapore Work Pass Type"), true);
  assert.equal(shouldAgentAnswerRequiredControl(control, "Singapore Work Pass Type (optional)"), false);
  assert.equal(shouldAgentAnswerRequiredControl(control, "Do you have a disability? — voluntary"), false);

  const unmarkedControl = {
    ...control,
    closest(selector) {
      return selector.startsWith("form,") ? container : null;
    }
  };
  assert.equal(shouldAgentAnswerRequiredControl(unmarkedControl, "Singapore Work Pass Type"), false);
  assert.equal(
    shouldAgentAnswerRequiredControl(unmarkedControl, "Singapore Work Pass Type", { includeUnmarked: true }),
    true
  );
  assert.equal(
    shouldAgentAnswerRequiredControl(unmarkedControl, "Singapore Work Pass Type (optional)", { includeUnmarked: true }),
    false
  );
  assert.equal(
    shouldAgentAnswerRequiredControl(unmarkedControl, "Which ethnicity do you identify with? — voluntary", {
      includeUnmarked: true
    }),
    false
  );
});

test("ByteDance Work Authorization module questions remain actionable when Formily omits required markers", () => {
  const module = {
    className: "applyFormModuleWrapper__2JZaE",
    innerText:
      "Work Authorization To comply with our legal obligations, we are required to ask each applicant for employment.",
    parentElement: null,
    querySelector(selector) {
      return selector === "[class*='applyFormModuleWrapper-title']"
        ? { innerText: "Work Authorization" }
        : null;
    }
  };
  const field = {
    className: "ud-formily-item",
    parentElement: module,
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

  const workAuthorization = "Are you legally authorized to work in the US without restriction?";
  const sponsorship = "Will you now or in the future require visa sponsorship or a visa transfer?";

  assert.equal(isQuestionControlRequired(field, workAuthorization), false);
  assert.equal(isTikTokAuthorizationModuleQuestion(field, workAuthorization), true);
  assert.equal(isTikTokAuthorizationModuleQuestion(field, sponsorship), true);
  assert.equal(shouldAnswerTikTokAuthorizationField(field, workAuthorization), true);
  assert.equal(shouldAnswerTikTokAuthorizationField(field, sponsorship), true);
  assert.equal(isTikTokAuthorizationModuleQuestion(field, `${sponsorship} (optional)`), false);
  assert.equal(shouldAnswerTikTokAuthorizationField(field, `${sponsorship} (optional)`), false);
  assert.equal(isTikTokAuthorizationModuleQuestion(field, "Why do you want to join ByteDance?"), false);
});

test("a visible Submit button does not make a one-page ByteDance form review-only while question controls remain", () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const control = {
    disabled: false,
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return { width: 240, height: 40 };
    }
  };
  const field = {
    querySelectorAll() {
      return [control];
    },
    getBoundingClientRect() {
      return { width: 640, height: 120 };
    }
  };

  try {
    sandbox.document.querySelectorAll = (selector) =>
      selector === "[data-form-field-i18n-name]" ? [field] : [];
    assert.equal(hasVisibleApplicationQuestionControls(), true);

    sandbox.document.querySelectorAll = () => [];
    assert.equal(hasVisibleApplicationQuestionControls(), false);
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

test("the question-agent fallback discovers a blank no-marker ByteDance authorization dropdown", () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const question = "Are you legally authorized to work in the US without restriction?";
  const module = {
    className: "applyFormModuleWrapper__2JZaE",
    innerText: "Work Authorization",
    parentElement: null,
    querySelector() {
      return { innerText: "Work Authorization" };
    }
  };
  const input = { value: "" };
  const field = {
    className: "ud-formily-item",
    innerText: question,
    parentElement: module,
    getAttribute(name) {
      return name === "data-form-field-i18n-name" ? question : null;
    },
    querySelector(selector) {
      if (selector.startsWith(".ud__select__selector")) return control;
      if (selector.startsWith("input[role='combobox']")) return input;
      return null;
    }
  };
  const control = {
    className: "ud__select__selector ud__select__selector-readOnly",
    innerText: "",
    parentElement: field,
    disabled: false,
    labels: [],
    name: "",
    id: "",
    contains() {
      return false;
    },
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return { width: 240, height: 40 };
    },
    closest(selector) {
      if (selector === "[data-form-field-i18n-name]") return field;
      if (selector.includes("[data-form-field-i18n-name]")) return field;
      return null;
    }
  };

  try {
    sandbox.document.querySelectorAll = () => [control];
    assert.equal(findAgentCustomDropdown(), control);

    control.innerText = "Yes";
    assert.equal(findAgentCustomDropdown(), null, "an already-selected dropdown must not wake the agent again");
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

test("stuck recovery skips a populated ByteDance phone prefix and continues to the required dropdown", () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const makeField = (label) => ({
    className: "ud-formily-item",
    innerText: label,
    parentElement: null,
    getAttribute(name) {
      return name === "data-form-field-i18n-name" ? label : null;
    },
    querySelector(selector) {
      if (selector.startsWith(".ud__select__selector")) return this.control;
      if (selector.startsWith("input[role='combobox']")) return { value: "" };
      return null;
    },
    querySelectorAll() {
      return [];
    }
  });
  const makeControl = (field, displayedValue) => ({
    tagName: "DIV",
    className: "ud__select__selector ud__select__selector-readOnly",
    innerText: displayedValue,
    parentElement: field,
    disabled: false,
    required: false,
    labels: [],
    name: "",
    id: "",
    contains() {
      return false;
    },
    matches(selector) {
      return selector.includes(".ud__select__selector");
    },
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return { width: 120, height: 40 };
    },
    closest(selector) {
      if (selector === "[data-form-field-i18n-name]") return field;
      if (selector.includes(".ud-formily-item")) return field;
      if (selector.startsWith("form,")) return field;
      if (selector === "label, fieldset, div, li, section") return field;
      return null;
    },
    querySelector() {
      return null;
    }
  });
  const phoneField = makeField("Phone number");
  const phonePrefix = makeControl(phoneField, "+1");
  phoneField.control = phonePrefix;
  const statusQuestion = "Current right-to-work status — mandatory for applicants to Singapore";
  const statusField = makeField(statusQuestion);
  const statusDropdown = makeControl(statusField, "");
  statusField.control = statusDropdown;

  try {
    sandbox.document.querySelectorAll = () => [phonePrefix, statusDropdown];
    assert.equal(
      findAgentCustomDropdown(new Set(), { includeUnmarked: true }),
      statusDropdown,
      "the populated +1 selector must not consume the recovery pass"
    );
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

test("stuck recovery never treats a saved-resume download menu as an application question", () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const form = { innerText: "Yifu_Zhou_Resume.pdf Last updated: 2026-04-23 18:04" };
  const downloadMenu = {
    tagName: "BUTTON",
    id: "resume-downloadfile-menu",
    className: "",
    innerText: "Yifu_Zhou_Resume.pdf Last updated: 2026-04-23 18:04",
    disabled: false,
    labels: [],
    name: "",
    parentElement: form,
    contains() {
      return false;
    },
    getAttribute(name) {
      if (name === "id") return this.id;
      if (name === "aria-haspopup") return "menu";
      return null;
    },
    getBoundingClientRect() {
      return { width: 300, height: 40 };
    },
    closest(selector) {
      if (selector.startsWith("form,")) return form;
      if (selector === "label, fieldset, div, li, section") return form;
      return null;
    }
  };

  try {
    sandbox.document.querySelectorAll = () => [downloadMenu];
    assert.equal(findAgentCustomDropdown(new Set(), { includeUnmarked: true }), null);
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

asyncTest("a Submit click that reveals validation errors stops for review instead of being treated as success", async () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  let clicked = false;
  const alert = {
    innerText: "Please answer the required Work Authorization questions.",
    getBoundingClientRect() {
      return { width: 420, height: 40 };
    }
  };
  const submit = {
    innerText: "Submit",
    value: "",
    getAttribute() {
      return null;
    },
    scrollIntoView() {},
    click() {
      clicked = true;
    }
  };

  try {
    sandbox.document.querySelectorAll = (selector) => {
      if (selector === "[role='alert']") return clicked ? [alert] : [];
      if (selector === "[aria-invalid='true']") return [];
      return [];
    };

    const steps = [];
    const result = await clickAndDetectSubmission(submit, steps, { outcomeOptions: { timeoutMs: 0 } });

    assert.equal(result.clicked, true);
    assert.equal(result.done, false);
    assert.equal(result.pausedForReview, true);
    assert.equal(result.errorType, "blocked_by_validation");
    assert.ok(steps.some((step) => step.step === "Check for validation errors after submitting"));
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

asyncTest("a Submit click is still attempted when validation markers already exist", async () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  let clicked = false;
  const alert = {
    innerText: "Current right-to-work status is required.",
    getBoundingClientRect() {
      return { width: 420, height: 40 };
    }
  };
  const submit = {
    innerText: "Submit",
    value: "",
    getAttribute() {
      return null;
    },
    scrollIntoView() {},
    click() {
      clicked = true;
    }
  };

  try {
    sandbox.document.querySelectorAll = (selector) => {
      if (selector === "[role='alert']") return [alert];
      if (selector === "[aria-invalid='true']") return [];
      return [];
    };

    const steps = [];
    const result = await clickAndDetectSubmission(submit, steps, { outcomeOptions: { timeoutMs: 0 } });

    assert.equal(clicked, true);
    assert.equal(result.clicked, true);
    assert.equal(result.errorType, "blocked_by_validation");
    assert.equal(steps[0].step, "Submit application");
    assert.equal(steps[1].step, "Check for validation errors after submitting");
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

asyncTest("an unconfirmed Submit becomes validation-blocked when explicit required fields remain", async () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const originalAuditRequiredApplicationFields = sandbox.auditRequiredApplicationFields;
  const submit = {
    innerText: "Submit",
    value: "",
    getAttribute() {
      return null;
    },
    scrollIntoView() {},
    click() {}
  };

  try {
    sandbox.document.querySelectorAll = () => [];
    sandbox.auditRequiredApplicationFields = (options) => {
      assert.equal(options.includeUnmarked, false);
      return {
        totalRequired: 1,
        answeredCount: 0,
        unanswered: [{ label: "Current right-to-work status" }],
        answerableUnanswered: [{ label: "Current right-to-work status" }],
        unsupportedUnanswered: []
      };
    };

    const steps = [];
    const result = await clickAndDetectSubmission(submit, steps, { outcomeOptions: { timeoutMs: 0 } });

    assert.equal(result.pausedForReview, true);
    assert.equal(result.errorType, "blocked_by_validation");
    assert.match(result.summary, /explicit unanswered required fields/i);
    assert.equal(steps[1].step, "Check for validation errors after submitting");
    assert.equal(steps[1].status, "blocked");
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
    sandbox.auditRequiredApplicationFields = originalAuditRequiredApplicationFields;
  }
});

asyncTest("an unconfirmed Submit stops before a false second Submit/Continue search", async () => {
  const originalClickFinalSubmit = sandbox.clickFinalSubmit;
  const originalClickAction = sandbox.clickAction;
  let continueSearchCalled = false;

  try {
    sandbox.clickFinalSubmit = async () => ({
      clicked: true,
      done: false,
      pending: false,
      pausedForReview: true,
      errorType: "clicked_but_unconfirmed",
      summary: "Submit confirmation was not detected."
    });
    sandbox.clickAction = async () => {
      continueSearchCalled = true;
      return false;
    };

    const result = await clickPrimaryAction({ primaryActionId: null }, []);
    assert.equal(result.pausedForReview, true);
    assert.equal(result.errorType, "clicked_but_unconfirmed");
    assert.equal(continueSearchCalled, false);
  } finally {
    sandbox.clickFinalSubmit = originalClickFinalSubmit;
    sandbox.clickAction = originalClickAction;
  }
});

asyncTest("Continue or Submit is attempted before the required-field audit", async () => {
  const originalGetAlreadyAppliedSignal = sandbox.getAlreadyAppliedSignal;
  const originalAuditRequiredApplicationFields = sandbox.auditRequiredApplicationFields;
  const originalFindPrimaryActionButton = sandbox.findPrimaryActionButton;
  const originalClickFinalSubmit = sandbox.clickFinalSubmit;
  let auditCalled = false;
  let submitCalled = false;

  try {
    sandbox.getAlreadyAppliedSignal = () => null;
    sandbox.auditRequiredApplicationFields = () => {
      auditCalled = true;
      throw new Error("the action layer must not audit before clicking");
    };
    sandbox.findPrimaryActionButton = () => null;
    sandbox.clickFinalSubmit = async () => {
      submitCalled = true;
      return {
        clicked: true,
        done: false,
        pending: true,
        summary: "Submit clicked; confirmation pending."
      };
    };

    const steps = [];
    const result = await clickPrimaryAction({ primaryActionId: "submit" }, steps);
    assert.equal(result.clicked, true);
    assert.equal(result.pending, true);
    assert.equal(submitCalled, true);
    assert.equal(auditCalled, false);
  } finally {
    sandbox.getAlreadyAppliedSignal = originalGetAlreadyAppliedSignal;
    sandbox.auditRequiredApplicationFields = originalAuditRequiredApplicationFields;
    sandbox.findPrimaryActionButton = originalFindPrimaryActionButton;
    sandbox.clickFinalSubmit = originalClickFinalSubmit;
  }
});

asyncTest("an unconfirmed Submit stops without broad required-field recovery", async () => {
  const originalGetSiteConfig = sandbox.getSiteConfig;
  const originalGetCurrentUrl = sandbox.getCurrentUrl;
  const originalGetSessionRequiredSignal = sandbox.getSessionRequiredSignal;
  const originalGetAlreadyAppliedSignal = sandbox.getAlreadyAppliedSignal;
  const originalGetSubmittedSignal = sandbox.getSubmittedSignal;
  const originalWaitForApplicationFormToSettle = sandbox.waitForApplicationFormToSettle;
  const originalFindPrimaryActionButton = sandbox.findPrimaryActionButton;
  const originalHasVisibleApplicationQuestionControls = sandbox.hasVisibleApplicationQuestionControls;
  const originalResolveRequiredFieldAudit = sandbox.resolveRequiredFieldAudit;
  const originalGetLoadingSignal = sandbox.getLoadingSignal;
  const originalClickPrimaryAction = sandbox.clickPrimaryAction;
  let submitClicks = 0;
  let recoveryCalls = 0;

  try {
    sandbox.getSiteConfig = () => ({
      id: "tiktok",
      isJobDetailUrl: () => false,
      isApplicationUrl: () => true,
      finalSubmitPattern: /^submit$/i,
      continuePattern: /^continue$/i
    });
    sandbox.getCurrentUrl = () => new URL("https://jobs.bytedance.com/en/resume/123/apply");
    sandbox.getSessionRequiredSignal = () => null;
    sandbox.getAlreadyAppliedSignal = () => null;
    sandbox.getSubmittedSignal = () => null;
    sandbox.waitForApplicationFormToSettle = async () => ({ alreadyAppliedSignal: null });
    sandbox.findPrimaryActionButton = () => ({
      innerText: "Submit",
      value: "",
      getAttribute() {
        return null;
      }
    });
    sandbox.hasVisibleApplicationQuestionControls = () => false;
    sandbox.resolveRequiredFieldAudit = async () => {
      recoveryCalls += 1;
      throw new Error("ambiguous confirmation must not trigger broad field recovery");
    };
    sandbox.getLoadingSignal = () => null;
    sandbox.clickPrimaryAction = async () => {
      submitClicks += 1;
      return {
        clicked: true,
        done: false,
        pending: false,
        pausedForReview: true,
        errorType: "clicked_but_unconfirmed",
        summary: "Submit confirmation was not detected."
      };
    };

    const result = await runApplicationWorkflowStep();
    assert.equal(result.pausedForReview, true);
    assert.equal(result.errorType, "clicked_but_unconfirmed");
    assert.equal(submitClicks, 1);
    assert.equal(recoveryCalls, 0);
  } finally {
    sandbox.getSiteConfig = originalGetSiteConfig;
    sandbox.getCurrentUrl = originalGetCurrentUrl;
    sandbox.getSessionRequiredSignal = originalGetSessionRequiredSignal;
    sandbox.getAlreadyAppliedSignal = originalGetAlreadyAppliedSignal;
    sandbox.getSubmittedSignal = originalGetSubmittedSignal;
    sandbox.waitForApplicationFormToSettle = originalWaitForApplicationFormToSettle;
    sandbox.findPrimaryActionButton = originalFindPrimaryActionButton;
    sandbox.hasVisibleApplicationQuestionControls = originalHasVisibleApplicationQuestionControls;
    sandbox.resolveRequiredFieldAudit = originalResolveRequiredFieldAudit;
    sandbox.getLoadingSignal = originalGetLoadingSignal;
    sandbox.clickPrimaryAction = originalClickPrimaryAction;
  }
});

asyncTest("post-click validation engages required-field recovery before retrying", async () => {
  const originals = {
    getSiteConfig: sandbox.getSiteConfig,
    getCurrentUrl: sandbox.getCurrentUrl,
    getSessionRequiredSignal: sandbox.getSessionRequiredSignal,
    getAlreadyAppliedSignal: sandbox.getAlreadyAppliedSignal,
    getSubmittedSignal: sandbox.getSubmittedSignal,
    waitForApplicationFormToSettle: sandbox.waitForApplicationFormToSettle,
    findPrimaryActionButton: sandbox.findPrimaryActionButton,
    answerQuestionnaire: sandbox.answerQuestionnaire,
    clickSponsorshipAnswer: sandbox.clickSponsorshipAnswer,
    resolveRequiredFieldAudit: sandbox.resolveRequiredFieldAudit,
    getLoadingSignal: sandbox.getLoadingSignal,
    clickPrimaryAction: sandbox.clickPrimaryAction
  };
  const events = [];
  let recoveryOptions = null;

  try {
    sandbox.getSiteConfig = () => ({
      id: "tiktok",
      isJobDetailUrl: () => false,
      isApplicationUrl: () => true,
      finalSubmitPattern: /^submit$/i,
      continuePattern: /^continue$/i
    });
    sandbox.getCurrentUrl = () => new URL("https://jobs.bytedance.com/en/resume/123/apply");
    sandbox.getSessionRequiredSignal = () => null;
    sandbox.getAlreadyAppliedSignal = () => null;
    sandbox.getSubmittedSignal = () => null;
    sandbox.waitForApplicationFormToSettle = async () => ({ alreadyAppliedSignal: null });
    sandbox.findPrimaryActionButton = () => null;
    sandbox.answerQuestionnaire = async () => ({
      answeredAny: false,
      requiredCount: 0,
      answeredCount: 0,
      alreadyAppliedSignal: null
    });
    sandbox.clickSponsorshipAnswer = () => false;
    sandbox.getLoadingSignal = () => null;
    sandbox.clickPrimaryAction = async (_siteConfig, steps) => {
      events.push("submit");
      steps.push({ step: "Submit application", status: "clicked", label: "Submit" });
      steps.push({
        step: "Check for validation errors after submitting",
        status: "blocked",
        label: "Current right-to-work status is required"
      });
      return {
        clicked: true,
        done: false,
        pending: false,
        pausedForReview: true,
        errorType: "blocked_by_validation",
        summary: "Submit was blocked by validation."
      };
    };
    sandbox.resolveRequiredFieldAudit = async (_steps, options) => {
      events.push("recover");
      recoveryOptions = options;
      return {
        answeredCount: 1,
        incomplete: false,
        noProgress: false,
        recoveryFingerprint: "custom_dropdown::current right-to-work status",
        alreadyAppliedSignal: null,
        audit: {
          totalRequired: 1,
          answeredCount: 1,
          unanswered: [],
          answerableUnanswered: [],
          unsupportedUnanswered: []
        }
      };
    };

    const result = await runApplicationWorkflowStep();
    assert.deepEqual(events, ["submit", "recover"]);
    assert.equal(recoveryOptions.includeUnmarked, true);
    assert.equal(result.validationRecoveryAttempted, true);
    assert.equal(result.validationRecoveryFingerprint, "custom_dropdown::current right-to-work status");
    assert.match(result.summary, /question agent answered and verified 1 field/i);
  } finally {
    Object.assign(sandbox, originals);
  }
});

asyncTest("the third validation-blocked final Submit stops without another recovery", async () => {
  const originals = {
    getSiteConfig: sandbox.getSiteConfig,
    getCurrentUrl: sandbox.getCurrentUrl,
    getSessionRequiredSignal: sandbox.getSessionRequiredSignal,
    getAlreadyAppliedSignal: sandbox.getAlreadyAppliedSignal,
    getSubmittedSignal: sandbox.getSubmittedSignal,
    waitForApplicationFormToSettle: sandbox.waitForApplicationFormToSettle,
    findPrimaryActionButton: sandbox.findPrimaryActionButton,
    hasVisibleApplicationQuestionControls: sandbox.hasVisibleApplicationQuestionControls,
    resolveRequiredFieldAudit: sandbox.resolveRequiredFieldAudit,
    getLoadingSignal: sandbox.getLoadingSignal,
    clickPrimaryAction: sandbox.clickPrimaryAction
  };
  let recoveryCalls = 0;

  try {
    sandbox.getSiteConfig = () => ({
      id: "tiktok",
      isJobDetailUrl: () => false,
      isApplicationUrl: () => true,
      finalSubmitPattern: /^submit$/i,
      continuePattern: /^continue$/i
    });
    sandbox.getCurrentUrl = () => new URL("https://jobs.bytedance.com/en/resume/123/apply");
    sandbox.getSessionRequiredSignal = () => null;
    sandbox.getAlreadyAppliedSignal = () => null;
    sandbox.getSubmittedSignal = () => null;
    sandbox.waitForApplicationFormToSettle = async () => ({ alreadyAppliedSignal: null });
    sandbox.findPrimaryActionButton = () => ({
      innerText: "Submit",
      value: "",
      getAttribute() {
        return null;
      }
    });
    sandbox.hasVisibleApplicationQuestionControls = () => false;
    sandbox.getLoadingSignal = () => null;
    sandbox.clickPrimaryAction = async (_siteConfig, steps) => {
      steps.push({ step: "Submit application", status: "clicked", label: "Submit" });
      return {
        clicked: true,
        done: false,
        pending: false,
        pausedForReview: true,
        errorType: "blocked_by_validation",
        summary: "Submit was blocked by validation."
      };
    };
    sandbox.resolveRequiredFieldAudit = async () => {
      recoveryCalls += 1;
      throw new Error("the retry cap must stop before another agent call");
    };

    const result = await runApplicationWorkflowStep({ submissionAttemptCount: 2 });
    assert.equal(result.pausedForReview, true);
    assert.equal(result.errorType, "submission_retry_limit");
    assert.match(result.summary, /after 3 final Submit attempts/i);
    assert.equal(recoveryCalls, 0);
  } finally {
    Object.assign(sandbox, originals);
  }
});

asyncTest("a missing or disabled Continue/Submit action triggers one broadened required-field recovery pass", async () => {
  const originals = {
    getSiteConfig: sandbox.getSiteConfig,
    getCurrentUrl: sandbox.getCurrentUrl,
    getSessionRequiredSignal: sandbox.getSessionRequiredSignal,
    getAlreadyAppliedSignal: sandbox.getAlreadyAppliedSignal,
    getSubmittedSignal: sandbox.getSubmittedSignal,
    waitForApplicationFormToSettle: sandbox.waitForApplicationFormToSettle,
    findPrimaryActionButton: sandbox.findPrimaryActionButton,
    answerQuestionnaire: sandbox.answerQuestionnaire,
    clickSponsorshipAnswer: sandbox.clickSponsorshipAnswer,
    resolveRequiredFieldAudit: sandbox.resolveRequiredFieldAudit,
    getLoadingSignal: sandbox.getLoadingSignal,
    clickPrimaryAction: sandbox.clickPrimaryAction
  };
  const auditOptions = [];

  try {
    sandbox.getSiteConfig = () => ({
      id: "tiktok",
      isJobDetailUrl: () => false,
      isApplicationUrl: () => true,
      finalSubmitPattern: /^submit$/i,
      continuePattern: /^continue$/i
    });
    sandbox.getCurrentUrl = () => new URL("https://jobs.bytedance.com/en/resume/123/apply");
    sandbox.getSessionRequiredSignal = () => null;
    sandbox.getAlreadyAppliedSignal = () => null;
    sandbox.getSubmittedSignal = () => null;
    sandbox.waitForApplicationFormToSettle = async () => ({ alreadyAppliedSignal: null });
    sandbox.findPrimaryActionButton = () => null;
    sandbox.answerQuestionnaire = async () => ({
      answeredAny: false,
      requiredCount: 0,
      answeredCount: 0,
      alreadyAppliedSignal: null
    });
    sandbox.clickSponsorshipAnswer = () => false;
    sandbox.resolveRequiredFieldAudit = async (_steps, options = {}) => {
      auditOptions.push(options);
      return {
        answeredCount: options.includeUnmarked ? 1 : 0,
        incomplete: false,
        alreadyAppliedSignal: null,
        questionText: null,
        audit: {
          totalRequired: options.includeUnmarked ? 1 : 0,
          answeredCount: options.includeUnmarked ? 1 : 0,
          unanswered: [],
          answerableUnanswered: [],
          unsupportedUnanswered: []
        }
      };
    };
    sandbox.getLoadingSignal = () => null;
    sandbox.clickPrimaryAction = async () => ({
      clicked: false,
      done: false,
      pending: false,
      summary: "No Continue or Submit action was found."
    });

    const result = await runApplicationWorkflowStep();
    assert.equal(result.clicked, true);
    assert.match(result.summary, /required-field recovery answered and verified 1 field/i);
    assert.equal(auditOptions.length, 1);
    assert.equal(auditOptions[0].includeUnmarked, true);
  } finally {
    Object.assign(sandbox, originals);
  }
});

test("known-site question discovery hard-skips Apple's optional resume-parsing feedback survey", () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const feedbackGroup = {
    innerText:
      "We used some of your resume information to fill out your profile and made recommendations. How did we do? Most of the information was accurate. There were inaccuracies or unexpected entries",
    getBoundingClientRect() {
      return { width: 640, height: 180 };
    },
    closest(selector) {
      return selector === "#apply-parsing-feedback" ? this : null;
    },
    querySelectorAll() {
      throw new Error("excluded optional feedback controls should never be inspected");
    }
  };

  try {
    sandbox.document.querySelectorAll = () => [feedbackGroup];
    assert.equal(isAgentQuestionExcluded(feedbackGroup), true);
    assert.equal(findAgentOptionGroup(), null);
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

test("hard-skips senior titles even with strong technical overlap", () => {
  const result = classify(
    "Senior Software Engineer",
    "Build backend APIs with C# .NET, AWS, DynamoDB, SQS, EventBridge, and Terraform."
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /senior-level/i);
});

test("hard-skips manager titles even with strong technical overlap", () => {
  const result = classify(
    "Software Engineering Manager, Apple Services Engineering",
    "Build backend APIs, microservices, AWS systems, DynamoDB, queues, and distributed services."
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /senior-level/i);
});

test("hard-skips internship titles even with strong technical overlap", () => {
  const result = classify(
    "Software Engineering Internship, 2026",
    "Build backend APIs, microservices, AWS systems, DynamoDB, queues, and distributed services."
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /internship/i);

  const pluralResult = classify(
    "AIML - Summer Intern",
    "Build backend APIs, microservices, AWS systems, DynamoDB, queues, and distributed services."
  );

  assert.equal(pluralResult.decision, "Likely skip");
  assert.match(pluralResult.reason, /internship/i);
});

test("recognizes internship titles without matching substrings like 'International'", () => {
  assert.equal(isInternshipTitle("Software Engineering Internship, 2026"), true);
  assert.equal(isInternshipTitle("AIML - Summer Intern"), true);
  assert.equal(isInternshipTitle("Interns Program Coordinator"), true);
  assert.equal(isInternshipTitle("International Software Engineer"), false);
  assert.equal(isInternshipTitle("Internal Tools Engineer"), false);
});

test("recognizes plural 'Internships' titles", () => {
  // \bintern(s|ship)?\b previously missed "Internships" -- neither "s" nor "ship" alone
  // leaves a word boundary before the trailing "s" in "...ships".
  assert.equal(isInternshipTitle("Engineering Program Management Undergrad Internships"), true);
  assert.equal(isInternshipTitle("Software Engineering Internships, 2026"), true);
});

test("hard-skips jobs matching user-defined no-match keywords, before any other scoring", () => {
  const result = classify(
    "Software Development Engineer",
    "Build backend APIs and microservices using machine learning, AWS, DynamoDB, and full-stack services.",
    2,
    ["machine learning", "embedded"]
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /no-match keyword list/i);
  assert.deepEqual(result.matchScore.noMatchKeywordHits, ["machine learning"]);
});

test("does not hard-skip on no-match keywords when none are configured or none match", () => {
  const withoutKeywords = classify(
    "Software Development Engineer",
    "Build backend APIs and microservices using machine learning, AWS, DynamoDB, and full-stack services."
  );
  assert.notEqual(withoutKeywords.decision, "Likely skip");

  const withNonMatchingKeywords = classify(
    "Software Development Engineer",
    "Build backend APIs and microservices using machine learning, AWS, DynamoDB, and full-stack services.",
    2,
    ["embedded", "firmware"]
  );
  assert.notEqual(withNonMatchingKeywords.decision, "Likely skip");
});

test("does not hard-skip on a no-match keyword that only appears under Preferred Qualifications", () => {
  const result = classify(
    "Software Development Engineer",
    "Minimum Qualifications: Build backend APIs and microservices using AWS and DynamoDB.\n" +
      "Preferred Qualifications: Experience with machine learning is a plus.",
    2,
    ["machine learning"]
  );

  assert.notEqual(result.decision, "Likely skip");
  assert.deepEqual(result.matchScore.noMatchKeywordHits, []);
});

test("still hard-skips on a no-match keyword that appears in Minimum Qualifications, even if also mentioned under Preferred", () => {
  const result = classify(
    "Software Development Engineer",
    "Minimum Qualifications: Experience with machine learning and backend APIs.\n" +
      "Preferred Qualifications: Deeper machine learning research experience is a plus.",
    2,
    ["machine learning"]
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /no-match keyword list/i);
  assert.deepEqual(result.matchScore.noMatchKeywordHits, ["machine learning"]);
});

test("still hard-skips on a no-match keyword in unlabeled text with no section headers at all", () => {
  const result = classify(
    "Software Development Engineer",
    "Build backend APIs and microservices using machine learning, AWS, and DynamoDB.",
    2,
    ["machine learning"]
  );

  assert.equal(result.decision, "Likely skip");
  assert.deepEqual(result.matchScore.noMatchKeywordHits, ["machine learning"]);
});

test("skips iOS app roles with Swift/UIKit/Xcode mismatch", () => {
  const result = classify(
    "iOS Software Engineer",
    "Develop iOS applications using Swift, UIKit, SwiftUI, Objective-C, and Xcode.",
    undefined,
    undefined,
    "Backend software engineer experienced in Python services, cloud APIs, SQL, AWS, and distributed systems."
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /domain mismatch|senior-level/i);
});

test("does not penalize bare Swift/macOS mentions without app-framework signals", () => {
  const result = classify(
    "Software Development Engineer",
    "Designing, programming, debugging and modifying software related to a cloud-based macOS application. Coding in Swift to develop the back-end for a testing tool, using SQL to query Postgres databases, and applying machine learning for data insights."
  );

  assert.notEqual(result.decision, "Likely skip");
  assert.equal(result.matchScore.domainMismatches.length, 0);
});

test("does not hard-skip a role with no stated years-of-experience requirement", () => {
  const result = classify(
    "Software Development Engineer",
    "Designing, programming, debugging and modifying software related to a cloud-based macOS application. Coding in Swift to develop the back-end for a testing tool, using SQL to query Postgres databases, and applying machine learning for data insights. Master's degree in Computer Science or a related field.",
    undefined,
    undefined,
    "Software engineer with experience in Swift, backend application development, SQL and Postgres databases, machine learning, cloud systems, and software testing."
  );

  assert.notEqual(result.decision, "Likely skip");
  assert.equal(result.requiredYears, null);
  assert.match(result.reason, /No years-of-experience requirement was stated/i);
});

test("keeps backend and full-stack roles eligible", () => {
  const result = classify(
    "Software Engineer, Backend Services",
    "Build backend APIs and microservices using C# .NET, AWS Lambda, SQS queues, EventBridge, DynamoDB, Terraform, SQL, and Angular web tools."
  );

  assert.ok(["Likely match", "Review"].includes(result.decision));
  assert.ok(result.matchScore.keywords.includes("Backend/API Engineering"));
});

test("keeps AI experience roles eligible from title and AI signals", () => {
  const result = classify(
    "Software Engineer - AI Experiences",
    "Build AI product experiences using Python, machine learning, LLMs, embeddings, APIs, and production services.",
    undefined,
    undefined,
    "Software engineer with experience building AI experiences, machine learning systems, and LLM-based products using Python, embeddings, and APIs."
  );

  assert.ok(["Likely match", "Review"].includes(result.decision));
  assert.ok(result.matchScore.keywords.includes("AI Product Experiences"));
});

test("keeps Gen AI software engineer roles eligible", () => {
  const result = classify(
    "Gen AI Software Engineer",
    "Build generative AI and machine learning systems using Python, LLMs, embeddings, APIs, and production software services.",
    undefined,
    undefined,
    "Software engineer experienced in generative AI, machine learning, Python, LLMs, embeddings, APIs, and production software services."
  );

  assert.ok(["Likely match", "Review"].includes(result.decision));
  assert.ok(result.matchScore.keywords.includes("AI Product Experiences"));
});

test("keeps LLM AIOps and data center networking roles eligible", () => {
  const result = classify(
    "LLM AIOps Development Engineer - Data Center Networking",
    "Build an AIOps observability platform with Python, machine learning, LLM agents, RAG, APIs, microservices, distributed data pipelines, monitoring, and automated remediation.",
    undefined,
    undefined,
    "Software engineer with experience in Python, machine learning, LLM agents, RAG, APIs, microservices, distributed systems, observability, and cloud infrastructure."
  );

  assert.ok(["Likely match", "Review"].includes(result.decision));
  assert.ok(result.matchScore.keywords.includes("LLMs"));
  assert.ok(result.matchScore.keywords.includes("Cloud Infrastructure"));
});

test("keeps QA automation roles eligible", () => {
  const result = classify(
    "Software QA Engineer, Creativity Apps",
    "Create test automation, integration testing, API validation, Jasmine tests, MSTest coverage, and quality assurance tooling.",
    undefined,
    undefined,
    "Software QA engineer experienced in test automation, integration testing, API testing, Jasmine, MSTest, and quality assurance."
  );

  assert.ok(["Likely match", "Review"].includes(result.decision));
  assert.ok(result.matchScore.keywords.includes("QA/Test Automation"));
});

test("skips high required years of experience", () => {
  const result = classify(
    "Software Engineer",
    "Minimum qualifications include 5+ years of professional software engineering experience with backend services."
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /exceed your 2 years/i);
});

test("skips high YOE bullets under minimum qualification headings", () => {
  const result = classify(
    "Software Engineer",
    "Minimum Qualifications\n10+ years of industry experience building large-scale software systems.\nExperience building backend APIs and distributed services."
  );

  assert.equal(result.decision, "Likely skip");
  assert.equal(result.requiredYears, 10);
  assert.match(result.reason, /exceed your 2 years/i);
});

test("skips high YOE when qualification headings are flattened into one block", () => {
  const result = classify(
    "ML Infrastructure Engineer",
    [
      "Description Architect scalable ML serving infrastructure supporting dynamic model sharding, load balancing, and fault tolerance.",
      "Minimum Qualifications 10+ years of experience in GPU programming CUDA ROCm and high-performance computing, successfully optimizing large-scale parallel workloads.",
      "Strong experience with inter-node communication technologies InfiniBand RDMA NCCL in the context of ML training/inference.",
      "Preferred Qualifications Python is a plus."
    ].join(" ")
  );

  assert.equal(result.decision, "Likely skip");
  assert.equal(result.requiredYears, 10);
  assert.match(result.reason, /exceed your 2 years/i);
});

test("skips very high non-preferred YOE even if section context is lost", () => {
  const result = classify(
    "ML Infrastructure Engineer",
    "10+ years of experience in GPU programming CUDA ROCm and high-performance computing. Build distributed inference systems with PyTorch and large-scale ML infrastructure."
  );

  assert.equal(result.decision, "Likely skip");
  assert.equal(result.requiredYears, 10);
  assert.match(result.reason, /high years-of-experience signal/i);
});

// Regression: a "10+ years" sentence describing the TEAM's or PLATFORM's own tenure was being read as a
// candidate YOE requirement, using the exact wording a real requirement sentence uses ("N years of
// experience/engineering/..."). Caught from a real TikTok posting where a strong local match (100%
// keyword overlap) still hard-skipped on a sentence that was never about the candidate at all.
test("does not treat a sentence about the TEAM's or PLATFORM's own years of experience as a candidate YOE requirement", () => {
  const teamResult = classify(
    "Software Test Engineer (AI)",
    "Qualifications\nProficiency in Python. Experience with distributed systems, Docker, Spark or Hadoop is a plus. 8+ years of combined experience across the team building large-scale testing infrastructure."
  );
  assert.notEqual(teamResult.decision, "Likely skip");
  // .length, not assert.deepEqual(teamResult.matches, []) -- content.js runs inside a vm sandbox here
  // (see this file's header), so its arrays belong to a different realm than a literal [] written in
  // this test file; deepEqual's strict prototype check fails on that cross-realm mismatch even when
  // both are genuinely empty. Comparing .length (a primitive number) sidesteps it entirely.
  assert.equal(teamResult.matches.length, 0);

  const platformResult = classify(
    "Software Engineer, AIGC Agentic Workflow",
    "What You'll Bring\nStrong Python and backend engineering skills. Our platform has 10+ years of engineering investment in distributed, Spark/Hadoop-backed infrastructure."
  );
  assert.notEqual(platformResult.decision, "Likely skip");
  assert.equal(platformResult.matches.length, 0);

  // Sanity check: a genuine candidate-directed high-YOE mention (no team/company phrasing) must still
  // hard-skip -- this fix narrows the false-positive case above, it doesn't weaken the safety margin the
  // "even if section context is lost" test above already covers.
  const genuineResult = classify(
    "ML Infrastructure Engineer",
    "10+ years of experience in GPU programming and high-performance computing required."
  );
  assert.equal(genuineResult.decision, "Likely skip");
});

// The "bridge" from a local match decision to auto-apply: content.js's classifyRole decision feeds
// statusFromDecision/shouldAutoApply (lib/core.js) in background.js's scanJobLink, unchanged by this
// session's fixes -- this test exercises that real path end to end (not just each half in isolation) so
// a job that's now correctly classified "Likely match" is confirmed to actually be auto-apply-eligible,
// and a genuinely disqualified one is confirmed to still correctly be rejected.
test("a locally 'Likely match' job (once correctly classified) is auto-apply-eligible; a genuinely disqualified one is not", () => {
  const autoApplyProfile = normalizeUserProfile({
    scanMode: "auto_apply",
    autoApplyConsent: true,
    userYearsOfExperience: 2
  });

  const goodJob = classify(
    "Software Test Engineer (AI)",
    "Qualifications\nProficiency in Python. Experience with distributed systems, Docker, Spark or Hadoop is a plus. 8+ years of combined experience across the team building large-scale testing infrastructure."
  );
  const goodStatus = statusFromDecision(goodJob.decision);
  assert.equal(goodStatus, "likely_match");
  assert.equal(shouldAutoApply(goodStatus, goodJob, autoApplyProfile), true);

  const seniorJob = classify("Senior Software Engineer, Test Infrastructure", "Minimum Qualifications\n5+ years of experience with Python and distributed systems.");
  const seniorStatus = statusFromDecision(seniorJob.decision);
  assert.equal(seniorJob.decision, "Likely skip");
  assert.equal(shouldAutoApply(seniorStatus, seniorJob, autoApplyProfile), false);
});

// Real posting (https://joinbytedance.com/search/6964059491882076430) lists Android/Java/Objective-C/Python/Golang as alternatives.
// The candidate's Python and Java background satisfies alternatives in that list, so Objective-C alone
// must not turn this backend/infrastructure role into an iOS domain mismatch.
test("real ByteDance posting (Software Engineer, Backend and Infrastructure): Objective-C alternative is not an iOS domain mismatch", () => {
  const result = classify(
    "Software Engineer, Backend and Infrastructure",
    `Responsibilities
Build development infra including Cloud IDE, Repo&code management and CI/CD systems; - Build advanced intelligent data platforms, help client developers make decisions to optimize the user experience of our products; - Build ByteDance staging environment for TikTok, Ads, Shopping to enable internal isolate user and traffic from Prod, scale distributed applications, tweak technology like K8S, RPC, DB, MQ, KAFKA, HDFS, Hive, Yarn, build monitor and alert system; - Research and convert state of art computer engineering technology into the real products.

Minimum Qualifications
Bachelor degree in computer science or a related technical discipline; - Experience working with Android/Java/Objective-C/Python/Golang

Preferred Qualifications
Full-stack development experience - Experience in one or more of the following: private or public cloud, backend architecture, storage system, databases, CI/CD system, build infrastructure and big data.`,
    2,
    [] // no no-match keywords -- this is the user's current configuration
  );

  assert.equal(result.decision, "Likely match");
  assert.match(result.reason, /strong/i);
  assert.ok(!/domain mismatch/i.test(result.reason), "must not skip on the Objective-C mention given the override terms present");
});

test("uses user-provided years of experience for required YOE", () => {
  const result = classify(
    "Software Engineer",
    "Minimum qualifications include 3+ years of professional software engineering experience with backend services, APIs, AWS, and queues.",
    4
  );

  assert.notEqual(result.decision, "Likely skip");
});

test("does not hard-skip preferred years alone", () => {
  const result = classify(
    "Backend Software Engineer",
    "Preferred Qualifications\n5+ years of experience.\nBuild APIs, services, queues, AWS systems, and DynamoDB-backed microservices."
  );

  assert.notEqual(result.decision, "Likely skip");
});

test("does not hard-skip high preferred years alone", () => {
  const result = classify(
    "Backend Software Engineer",
    "Preferred Qualifications\n10+ years of experience.\nBuild APIs, services, queues, AWS systems, and DynamoDB-backed microservices."
  );

  assert.notEqual(result.decision, "Likely skip");
});

test("leaves weak generic jobs unknown", () => {
  const result = classify(
    "Software Engineer",
    "Join a team building excellent products and collaborating with cross-functional partners."
  );

  assert.equal(result.decision, "Unknown");
});

function makeStubElement(tagName, text, role = null, id = "") {
  return {
    tagName,
    innerText: text,
    textContent: text,
    value: "",
    name: "",
    id,
    labels: [],
    closest: () => null,
    getAttribute: (attr) => {
      if (attr === "role") return role;
      if (attr === "id") return id;
      return null;
    }
  };
}

test("does not treat a review card's 'Edit' button as an answer control", () => {
  const editButton = makeStubElement("BUTTON", "Edit");
  const submitButton = makeStubElement("BUTTON", "Submit");
  const yesRadioLabel = makeStubElement("LABEL", "Yes");
  const customDropdownButton = makeStubElement("BUTTON", "Select an option", "button");

  assert.equal(isAnswerControlElement(editButton), false);
  assert.equal(isAnswerControlElement(submitButton), false);
  assert.equal(isAnswerControlElement(yesRadioLabel), true);
  assert.equal(isAnswerControlElement(customDropdownButton), true);
});

test("does not treat a 'Download Resume' button as an answer control", () => {
  const downloadResumeButton = makeStubElement("BUTTON", "Download Resume");
  const viewResumeButton = makeStubElement("BUTTON", "View Resume");
  const printButton = makeStubElement("BUTTON", "Print");

  assert.equal(isAnswerControlElement(downloadResumeButton), false);
  assert.equal(isAnswerControlElement(viewResumeButton), false);
  assert.equal(isAnswerControlElement(printButton), false);
});

test("excludes Apple's saved-file download buttons by id, even when the label is just the filename", () => {
  // Apple's Review & Submit page labels these buttons with the uploaded filename itself
  // (e.g. "Yifu_Zhou_Resume.pdf"), which the text denylist can't reliably catch, so the id
  // ("...downloadfile...") is what has to exclude them.
  const resumeDownloadButton = makeStubElement("BUTTON", "Yifu_Zhou_Resume.pdf", null, "apply-resume-downloadfile");
  const coverLetterDownloadButton = makeStubElement(
    "BUTTON",
    "Cover_letter.pdf",
    null,
    "apply-links-downloadfile-9d607e9f-5da0-40ec-9451-594ffa6eaf47"
  );

  assert.equal(isNonAnswerAction(resumeDownloadButton), true);
  assert.equal(isAnswerControlElement(resumeDownloadButton), false);
  assert.equal(isNonAnswerAction(coverLetterDownloadButton), true);
  assert.equal(isAnswerControlElement(coverLetterDownloadButton), false);
});

test("excludes every section's Edit button by its '-edit-button' id suffix", () => {
  const sectionIds = [
    "apply-contact-edit-button",
    "apply-resume-edit-button",
    "apply-educationDegrees-edit-button",
    "apply-employments-edit-button",
    "apply-skills-edit-button",
    "apply-languages-edit-button",
    "apply-links-edit-button",
    "apply-selfdisclosure-edit-button",
    "apply-questionnaire-edit-button"
  ];

  for (const id of sectionIds) {
    const editButton = makeStubElement("BUTTON", "Edit", null, id);
    assert.equal(isAnswerControlElement(editButton), false, id);
  }
});

test("recognizes genuine open-ended essay questions", () => {
  assert.equal(isEssayQuestionLabel("Why do you want to work at this company?"), true);
  assert.equal(isEssayQuestionLabel("Tell us about a challenge you overcame."), true);
  assert.equal(isEssayQuestionLabel("What interests you about this role?"), true);
  assert.equal(isEssayQuestionLabel("Describe a time you showed leadership."), true);
});

test("does not treat personal-info fields as essay questions, even when they contain '?' or 'company'", () => {
  // "What company do you currently work for?" contains both a "?" and the word "company", which
  // would otherwise collide with the essay allowlist -- the personal-info denylist must win.
  assert.equal(isEssayQuestionLabel("What company do you currently work for?"), false);
  assert.equal(isEssayQuestionLabel("What is your current employer?"), false);
  assert.equal(isEssayQuestionLabel("LinkedIn URL"), false);
  assert.equal(isEssayQuestionLabel("What is your expected salary?"), false);
  assert.equal(isEssayQuestionLabel("Full Name"), false);
  assert.equal(isEssayQuestionLabel("Email address"), false);
});

test("does not treat plain unlabeled or unrelated text as an essay question", () => {
  assert.equal(isEssayQuestionLabel("Phone number"), false);
  assert.equal(isEssayQuestionLabel(""), false);
});

// Real ByteDance "Application Failed" confirm-dialog text (ud__confirm__content), reported as a live
// bug: getAlreadyAppliedDialog()'s selector list didn't match this dialog's BEM (double-underscore)
// class names at all, so getAlreadyAppliedSignal() returned null and the workflow fell through to the
// Continue/Submit search, which failed with a confusing error instead of correctly recognizing this as
// already-applied. This locks in that the TEXT half of that detection was always correct -- the bug was
// purely in the DOM selector (not unit-testable here; see this file's document.querySelectorAll stub),
// not in isAlreadyAppliedDialogText's own matching logic.
test("isAlreadyAppliedDialogText recognizes ByteDance's real 'Application Failed' confirm-dialog text", () => {
  assert.equal(
    isAlreadyAppliedDialogText("Application Failed You've already applied for this job. Unable to apply again."),
    true
  );
  assert.equal(isAlreadyAppliedDialogText("Application submitted successfully."), false);
  assert.equal(isAlreadyAppliedDialogText(""), false);
});

test("getAlreadyAppliedSignal recognizes TikTok's exact ud__confirm__body popup element", () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const popupBody = {
    innerText: "You've already applied for this job. Unable to apply again.",
    getBoundingClientRect() {
      return { width: 420, height: 80, top: 180 };
    },
    querySelector() {
      return null;
    }
  };

  try {
    sandbox.document.querySelectorAll = (selector) =>
      selector.includes(".ud__confirm__body") ? [popupBody] : [];

    const signal = getAlreadyAppliedSignal();

    assert.equal(signal?.text, "You've already applied for this job. Unable to apply again.");
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

test("getAlreadyAppliedSignal recognizes ByteDance's exact visible failure message without relying on wrapper classes", () => {
  const originalHref = sandbox.window.location.href;
  const originalBodyText = sandbox.document.body.innerText;
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;

  try {
    sandbox.window.location.href = "https://jobs.bytedance.com/en/resume/123/apply";
    sandbox.document.body.innerText =
      "Application Failed\nYou've already applied for this job. Unable to apply again.\nView more jobs Cancel";
    sandbox.document.querySelectorAll = () => [];

    const signal = getAlreadyAppliedSignal();

    assert.match(signal?.text || "", /already applied for this job/i);
  } finally {
    sandbox.window.location.href = originalHref;
    sandbox.document.body.innerText = originalBodyText;
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

test("getSubmittedSignal recognizes ByteDance's 'We have received your resume' success page", () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const receivedMessage = {
    innerText: "We have received your resume.",
    tagName: "DIV",
    getBoundingClientRect() {
      return { width: 360, height: 40, top: 240 };
    },
    getAttribute() {
      return null;
    }
  };

  try {
    sandbox.document.querySelectorAll = () => [receivedMessage];

    const signal = getSubmittedSignal();

    assert.equal(signal?.text, "We have received your resume.");
    assert.equal(signal?.tagName, "div");
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

asyncTest("the workflow terminates when ByteDance shows an already-applied dialog on a detail page", async () => {
  const originalHref = sandbox.window.location.href;
  const originalQuerySelector = sandbox.document.querySelector;
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const dialog = {
    innerText: "Application Failed You've already applied for this job. Unable to apply again.",
    tagName: "DIV",
    getBoundingClientRect() {
      return { width: 400, height: 240, top: 100 };
    },
    getAttribute() {
      return null;
    },
    querySelector() {
      return null;
    }
  };

  try {
    sandbox.window.location.href = "https://careers.tiktok.com/position/123/detail";
    sandbox.document.querySelector = () => null;
    sandbox.document.querySelectorAll = (selector) =>
      selector.includes(".ud__confirm__content") ? [dialog] : [];

    const result = await runApplicationWorkflowStep();

    assert.equal(result.done, true);
    assert.equal(result.alreadySubmitted, true);
    assert.equal(result.errorType, "already_applied");
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].step, "Detect already applied notice");
  } finally {
    sandbox.window.location.href = originalHref;
    sandbox.document.querySelector = originalQuerySelector;
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

asyncTest("a delayed ByteDance already-applied dialog stops the workflow before questionnaire fields are read", async () => {
  const originalHref = sandbox.window.location.href;
  const originalQuerySelector = sandbox.document.querySelector;
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  let dialogChecks = 0;
  let questionnaireReads = 0;
  const dialog = {
    innerText: "Application Failed You've already applied for this job. Unable to apply again.",
    tagName: "DIV",
    getBoundingClientRect() {
      return { width: 400, height: 240, top: 100 };
    },
    getAttribute() {
      return null;
    },
    querySelector() {
      return null;
    }
  };

  try {
    sandbox.window.location.href = "https://lifeattiktok.com/resume/123/apply";
    sandbox.document.querySelector = (selector) =>
      selector === "[data-form-field-i18n-name]" ? { getAttribute() {} } : null;
    sandbox.document.querySelectorAll = (selector) => {
      if (selector.includes(".ud__confirm__content")) {
        dialogChecks += 1;
        return dialogChecks >= 2 ? [dialog] : [];
      }

      if (selector === "[data-form-field-i18n-name]") {
        questionnaireReads += 1;
      }

      return [];
    };

    const result = await runApplicationWorkflowStep();

    assert.equal(result.done, true);
    assert.equal(result.alreadySubmitted, true);
    assert.equal(result.errorType, "already_applied");
    assert.equal(questionnaireReads, 0);
  } finally {
    sandbox.window.location.href = originalHref;
    sandbox.document.querySelector = originalQuerySelector;
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

asyncTest("a ByteDance already-applied dialog is detected after the page shell stabilizes but before the form loads", async () => {
  const originalHref = sandbox.window.location.href;
  const originalQuerySelector = sandbox.document.querySelector;
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  let dialogChecks = 0;
  let questionnaireReads = 0;
  const dialog = {
    innerText: "Application Failed You've already applied for this job. Unable to apply again.",
    tagName: "DIV",
    getBoundingClientRect() {
      return { width: 400, height: 240, top: 100 };
    },
    getAttribute() {
      return null;
    },
    querySelector() {
      return null;
    }
  };

  try {
    sandbox.window.location.href = "https://jobs.bytedance.com/en/resume/123/apply";
    sandbox.document.querySelector = () => null;
    sandbox.document.querySelectorAll = (selector) => {
      if (selector.includes(".ud__confirm__content")) {
        dialogChecks += 1;
        // The old logic returned after five stable shell checks, before this seventh dialog check.
        return dialogChecks >= 7 ? [dialog] : [];
      }

      if (selector === "[data-form-field-i18n-name]") {
        questionnaireReads += 1;
      }

      if (selector === "[data-form-field-i18n-name], select, input, textarea, button, [role='button']") {
        return [{}];
      }

      return [];
    };

    const result = await runApplicationWorkflowStep();

    assert.equal(result.done, true);
    assert.equal(result.alreadySubmitted, true);
    assert.equal(result.errorType, "already_applied");
    assert.equal(questionnaireReads, 0);
    assert.ok(dialogChecks >= 7);
  } finally {
    sandbox.window.location.href = originalHref;
    sandbox.document.querySelector = originalQuerySelector;
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
  }
});

asyncTest("a ByteDance popup mounting during the Submit search interrupts it immediately", async () => {
  const originalHref = sandbox.window.location.href;
  const originalBodyText = sandbox.document.body.innerText;
  const originalQuerySelector = sandbox.document.querySelector;
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const originalScrollTo = sandbox.window.scrollTo;
  let clickableScans = 0;
  let popupTimer;

  try {
    sandbox.window.location.href = "https://jobs.bytedance.com/en/resume/123/apply";
    sandbox.document.body.innerText = "Application page";
    sandbox.window.scrollTo = () => {};
    sandbox.document.querySelector = () => null;
    sandbox.document.querySelectorAll = (selector) => {
      if (selector === "[data-form-field-i18n-name], select, input, textarea, button, [role='button']") {
        return [{}];
      }

      if (selector === "button, input[type='button'], input[type='submit'], a, [role='button']") {
        clickableScans += 1;
      }

      return [];
    };
    popupTimer = setTimeout(() => {
      sandbox.document.body.innerText =
        "Application Failed You've already applied for this job. Unable to apply again.";
    }, 3350);

    const result = await runApplicationWorkflowStep();

    assert.equal(result.done, true);
    assert.equal(result.alreadySubmitted, true);
    assert.equal(result.errorType, "already_applied");
    assert.ok(result.steps.some((step) => step.step === "Detect already applied notice"));
    // One scan can happen before the popup mounts, and buildStepResult reads visible actions once.
    // A larger count would mean the Submit search kept polling after the failure was detectable.
    assert.ok(clickableScans <= 2);
  } finally {
    clearTimeout(popupTimer);
    sandbox.window.location.href = originalHref;
    sandbox.document.body.innerText = originalBodyText;
    sandbox.document.querySelector = originalQuerySelector;
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
    sandbox.window.scrollTo = originalScrollTo;
  }
});

asyncTest("Apple confirmation waits for Proceed to render and become enabled", async () => {
  const originalQuerySelectorAll = sandbox.document.querySelectorAll;
  const originalSetTimeout = sandbox.setTimeout;
  let tick = 0;
  const button = {
    get disabled() { return tick < 2; },
    getBoundingClientRect: () => ({ width: tick ? 100 : 0, height: 40 }),
    getAttribute: () => null
  };
  const modal = {
    getBoundingClientRect: () => ({ width: 300, height: 200 }),
    querySelector: (selector) => selector.includes("header")
      ? { textContent: "Are you sure you want to withdraw this submission?" } : button
  };
  try {
    sandbox.document.querySelectorAll = (selector) => selector === ".rc-overlay-popup-outer" ? [modal] : [];
    sandbox.setTimeout = (callback) => { tick += 1; callback(); };
    const result = await waitForAppleWithdrawalConfirmationModal();
    assert.equal(result.confirmation?.proceedButton, button);
    assert.equal(tick, 2, "the popup appearing before an enabled Proceed button must not stop the batch");
  } finally {
    sandbox.document.querySelectorAll = originalQuerySelectorAll;
    sandbox.setTimeout = originalSetTimeout;
  }
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
