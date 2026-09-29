const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const backgroundPath = path.join(__dirname, "..", "background.js");
const source = fs.readFileSync(backgroundPath, "utf8");
const core = require(path.join(__dirname, "..", "lib", "core.js"));
const sidepanelFormatSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "sidepanel", "lib", "format.js"),
  "utf8"
);
const sidepanelActivitySource = fs.readFileSync(
  path.join(__dirname, "..", "src", "sidepanel", "lib", "activity.js"),
  "utf8"
);
const storageData = {};

const sidepanelFormatSandbox = { URL };
vm.runInNewContext(
  `${sidepanelFormatSource.replace(/\bexport\s+/g, "")}
globalThis.__sidepanelFormatTestApi = { isSupportedCareersUrl };`,
  sidepanelFormatSandbox,
  { filename: "src/sidepanel/lib/format.js" }
);
const { isSupportedCareersUrl } = sidepanelFormatSandbox.__sidepanelFormatTestApi;

const sidepanelActivitySandbox = { URL };
vm.runInNewContext(
  `${sidepanelActivitySource.replace(/\bexport\s+/g, "")}
globalThis.__sidepanelActivityTestApi = { buildCycleViews };`,
  sidepanelActivitySandbox,
  { filename: "src/sidepanel/lib/activity.js" }
);
const { buildCycleViews } = sidepanelActivitySandbox.__sidepanelActivityTestApi;

function readStorage(keys) {
  if (keys === undefined || keys === null) {
    return { ...storageData };
  }

  const requestedKeys = Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(requestedKeys.filter((key) => key in storageData).map((key) => [key, storageData[key]]));
}

const sandbox = {
  URL,
  console,
  // background.js's real importScripts("lib/core.js") loads that file into the same global scope
  // (classic MV3 service workers support importScripts natively) -- simulate that here by
  // pre-populating the sandbox with lib/core.js's exports instead of actually loading a file.
  importScripts: (...files) => {
    for (const file of files.filter((name) => name !== "lib/core.js")) {
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox, { filename: file });
    }
  },
  ...core,
  chrome: {
    storage: {
      local: {
        get: async (keys) => readStorage(keys),
        set: async (updates) => Object.assign(storageData, updates),
        remove: async (keys) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storageData[key];
          }
        }
      }
    },
    runtime: {
      onMessage: {
        addListener() {}
      }
    },
    sidePanel: {
      setPanelBehavior: async () => {}
    }
  }
};

vm.runInNewContext(
  `${source}
globalThis.__backgroundTestApi = {
  applyRequiredYoeHardSkip,
  buildPersistedScanState,
  buildPublicScanState,
  buildRetryableErrorLinks,
  buildAnswerPrompt,
  closeOwnedWorkflowTabs,
  createActiveWorkflowTab,
  classifyWorkflowError,
  compactResumeMatch,
  decisionFromLlmResult,
  getHardSkipTitleReason,
  getAutoApplyReadinessError,
  getDurableJobIdentity,
  getJobIdFromUrl,
  getSiteConfig,
  getSiteLabel,
  getYoeHardSkip,
  hasLlmAnswerCapability,
  incrementStatsForStatus,
  isLocalHardSkip,
  isLinkProcessed,
  activateListTab,
  activateTab,
  normalizeLlmDecision,
  normalizeAppleSubmittedJobId,
  normalizeNoMatchKeywords,
  normalizeUserProfile,
  normalizeUserYearsOfExperience,
  normalizeYoeAssessment,
  pruneJobRecords,
  fetchAppleSubmittedRoleDetails,
  waitForAppleSubmittedRoleDetails,
  recordAppliedCheckpoint,
  rememberAppliedJob,
  rememberPersistedError,
  forgetPersistedErrorForJob,
  clearAppliedJobs,
  clearErrorJobs,
  shouldAutoApply,
  shouldAutoSubmitGenericAutofill,
  buildGenericSubmitOutcome,
  buildNeedsReviewReasonSummary,
  buildGenericContentProfile,
  isWorkdayHostname,
  isWorkdayUrl,
  dispatchTrustedWorkdayClick,
  dispatchTrustedAppleWithdrawalClick,
  dispatchTrustedWorkdayTextReplacement,
  mergeWorkdayAutofillPage,
  persistObservedWorkdayCandidateProfile,
  runWorkdayAutofillWorkflow,
  buildFinalMatchObservation,
  beginKnownSiteActivityCycle,
  finishKnownSiteActivityCycle,
  getKnownSiteCycleResult,
  pushKnownSiteStep,
  resolveKnownSiteStep,
  runApplicationWorkflow,
  statusFromDecision,
  truncateText,
  translateKnownSiteStep,
  scanStateReady,
  setOwnedWorkflowTabIdsForTest: (tabIds) => {
    ownedWorkflowTabIds.clear();
    for (const tabId of tabIds) ownedWorkflowTabIds.add(tabId);
  },
  getScanStateForTest: () => scanState,
  setScanStateForTest: (partial) => {
    scanState = { ...scanState, ...partial };
  },
  getDurableLedgersForTest: () => ({ applied: { ...appliedJobLedger }, errors: { ...errorJobLedger } }),
  setDurableLedgersForTest: ({ applied = {}, errors = {} }) => {
    appliedJobLedger = { ...applied };
    errorJobLedger = { ...errors };
    appliedLedgerVersion += 1;
    errorLedgerVersion += 1;
    syncScanStateLedgerViews();
  }
};`,
  sandbox,
  { filename: "background.js" }
);

const {
  applyRequiredYoeHardSkip,
  buildPersistedScanState,
  buildPublicScanState,
  buildRetryableErrorLinks,
  buildAnswerPrompt,
  closeOwnedWorkflowTabs,
  createActiveWorkflowTab,
  classifyWorkflowError,
  compactResumeMatch,
  decisionFromLlmResult,
  getHardSkipTitleReason,
  getAutoApplyReadinessError,
  getDurableJobIdentity,
  getJobIdFromUrl,
  getSiteConfig,
  getSiteLabel,
  getYoeHardSkip,
  hasLlmAnswerCapability,
  incrementStatsForStatus,
  isLocalHardSkip,
  isLinkProcessed,
  activateListTab,
  activateTab,
  normalizeLlmDecision,
  normalizeAppleSubmittedJobId,
  normalizeNoMatchKeywords,
  normalizeUserProfile,
  normalizeUserYearsOfExperience,
  normalizeYoeAssessment,
  pruneJobRecords,
  fetchAppleSubmittedRoleDetails,
  waitForAppleSubmittedRoleDetails,
  recordAppliedCheckpoint,
  rememberAppliedJob,
  rememberPersistedError,
  forgetPersistedErrorForJob,
  clearAppliedJobs,
  clearErrorJobs,
  shouldAutoApply,
  shouldAutoSubmitGenericAutofill,
  buildGenericSubmitOutcome,
  buildNeedsReviewReasonSummary,
  buildGenericContentProfile,
  isWorkdayHostname,
  isWorkdayUrl,
  dispatchTrustedWorkdayClick,
  dispatchTrustedAppleWithdrawalClick,
  dispatchTrustedWorkdayTextReplacement,
  mergeWorkdayAutofillPage,
  persistObservedWorkdayCandidateProfile,
  runWorkdayAutofillWorkflow,
  buildFinalMatchObservation,
  beginKnownSiteActivityCycle,
  finishKnownSiteActivityCycle,
  getKnownSiteCycleResult,
  pushKnownSiteStep,
  resolveKnownSiteStep,
  runApplicationWorkflow,
  statusFromDecision,
  truncateText,
  translateKnownSiteStep,
  scanStateReady,
  setOwnedWorkflowTabIdsForTest,
  getScanStateForTest,
  setScanStateForTest,
  getDurableLedgersForTest,
  setDurableLedgersForTest
} = sandbox.__backgroundTestApi;

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

test("getSiteConfig recognizes Apple and TikTok/ByteDance hosts", () => {
  assert.equal(getSiteConfig("https://jobs.apple.com/en-us/search")?.id, "apple");
  assert.equal(getSiteConfig("https://www.apple.com/careers/us/")?.id, "apple");
  assert.equal(getSiteConfig("https://careers.tiktok.com/position/123/detail")?.id, "tiktok");
  assert.equal(getSiteConfig("https://lifeattiktok.com/search/123")?.id, "tiktok");
  assert.equal(getSiteConfig("https://joinbytedance.com/search?keyword=software+engineer")?.id, "tiktok");
  assert.equal(getSiteConfig("https://example.com"), null);
});

test("the side-panel URL gate recognizes joinbytedance.com consistently with the runtime", () => {
  assert.equal(isSupportedCareersUrl("https://joinbytedance.com/search/7278068779270408508"), true);
});

test("legacy flat activity is split into setup, iOS, and Android outer cycles", () => {
  const views = buildCycleViews({
    running: false,
    steps: [
      { id: 1, tool: "validate_api_key", status: "success", observation: "API key is valid" },
      { id: 2, tool: "extract_resume_profile", status: "success", observation: "candidate profile ready" },
      {
        id: 3,
        tool: "read_job_description",
        label: "iOS Software Engineer - TikTok - Singapore",
        status: "success",
        url: "https://lifeattiktok.com/search/ios-1"
      },
      { id: 4, tool: "local_match", status: "success", observation: "33%" },
      {
        id: 5,
        tool: "read_job_description",
        label: "Android Software Engineer - TikTok - Singapore",
        status: "success",
        url: "https://lifeattiktok.com/search/android-2"
      },
      { id: 6, tool: "local_match", status: "success", observation: "40%" }
    ]
  });

  assert.deepEqual(Array.from(views, (view) => view.title), [
    "API Key Validation",
    "Candidate Profile",
    "iOS Software Engineer - TikTok - Singapore",
    "Android Software Engineer - TikTok - Singapore"
  ]);
  assert.deepEqual(Array.from(views, (view) => view.steps.length), [1, 1, 2, 2]);
  assert.equal(views[2].steps.some((step) => /Android/.test(step.label || "")), false);
  assert.equal(views[3].steps.some((step) => /iOS/.test(step.label || "")), false);
});

test("the previous combined Scan Setup cycle renders as separate validation and profile rows", () => {
  const views = buildCycleViews({
    running: false,
    cycles: [{ id: "system:scan-setup", jobId: "scan-setup", title: "Scan Setup", status: "success" }],
    steps: [
      { id: 1, cycleId: "system:scan-setup", tool: "validate_api_key", status: "success" },
      { id: 2, cycleId: "system:scan-setup", tool: "extract_resume_profile", status: "success" }
    ]
  });

  assert.deepEqual(Array.from(views, (view) => view.title), ["API Key Validation", "Candidate Profile"]);
  assert.deepEqual(Array.from(views, (view) => view.outcome), ["Valid", "Ready"]);
});

test("a failed confirmation settles the old pending Submit row instead of leaving running dots", () => {
  const views = buildCycleViews({
    running: true,
    steps: [
      {
        id: 1,
        tool: "read_job_description",
        label: "Android Software Engineer",
        status: "success",
        url: "https://lifeattiktok.com/search/android-2"
      },
      {
        id: 2,
        tool: "submit_application",
        label: "Submit",
        status: "pending",
        observation: "clicked Submit; confirmation pending"
      },
      {
        id: 3,
        tool: "read_page",
        label: "Submission Confirmation",
        status: "error",
        observation: "could not confirm a success signal"
      }
    ]
  });

  assert.equal(views[0].status, "attention");
  assert.equal(views[0].outcome, "Needs Attention");
  assert.equal(views[0].steps[1].status, "error");
  assert.match(views[0].steps[1].observation, /outcome was not confirmed/i);
});

test("buildRetryableErrorLinks returns only supported, deduplicated saved error jobs", () => {
  const links = buildRetryableErrorLinks([
    {
      jobId: "123",
      site: "tiktok",
      title: "Newest copy",
      url: "https://jobs.bytedance.com/en/position/123"
    },
    {
      jobId: "123",
      site: "tiktok",
      title: "Older duplicate",
      url: "https://jobs.bytedance.com/en/position/123"
    },
    {
      jobId: "unknown",
      title: "Apple role",
      url: "https://jobs.apple.com/en-us/details/200123/software-engineer"
    },
    {
      jobId: "join-123",
      title: "Join ByteDance role",
      url: "https://joinbytedance.com/search/join-123"
    },
    {
      jobId: "manual-123",
      title: "Manual recovery role",
      url: "https://example.com/stale/error-url",
      manualReviewUrl: "https://jobs.bytedance.com/en/position/manual-123"
    },
    {
      type: "scan_loop_failed",
      message: "No job URL"
    },
    {
      jobId: "foreign",
      url: "https://example.com/jobs/foreign"
    }
  ]);

  assert.equal(links.length, 4);
  assert.equal(links[0].title, "Newest copy");
  assert.equal(links[0].site, "tiktok");
  assert.equal(links[0].alreadyAppliedFromList, false);
  assert.equal(links[1].jobId, "200123");
  assert.equal(links[1].site, "apple");
  assert.equal(links[2].jobId, "join-123");
  assert.equal(links[2].site, "tiktok");
  assert.equal(links[3].url, "https://jobs.bytedance.com/en/position/manual-123");
});

test("durable ledgers use site-qualified job IDs and retain an error until the job resolves", () => {
  const originalState = getScanStateForTest();
  const originalLedgers = getDurableLedgersForTest();

  try {
    setScanStateForTest(core.createIdleState());
    setDurableLedgersForTest({});

    const tiktokJob = {
      jobId: "site-qualified-123",
      site: "tiktok",
      title: "Infrastructure Engineer",
      url: "https://jobs.bytedance.com/en/position/site-qualified-123"
    };
    const appleJob = {
      jobId: "site-qualified-123",
      site: "apple",
      title: "Infrastructure Engineer",
      url: "https://jobs.apple.com/en-us/details/site-qualified-123/infrastructure-engineer"
    };

    assert.notEqual(getDurableJobIdentity(tiktokJob).key, getDurableJobIdentity(appleJob).key);
    rememberAppliedJob(tiktokJob);
    assert.equal(isLinkProcessed(tiktokJob), true);
    assert.equal(isLinkProcessed(appleJob), false);

    rememberPersistedError({
      ...appleJob,
      type: "submit_not_found",
      message: "Could not find submit button."
    });
    assert.equal(getScanStateForTest().savedErrorCount, 1);
    assert.equal(getScanStateForTest().retryableErrorCount, 1);

    setScanStateForTest(core.createIdleState());
    setDurableLedgersForTest(getDurableLedgersForTest());
    assert.equal(getScanStateForTest().savedErrorCount, 1, "a new scan state must not erase the error ledger");

    forgetPersistedErrorForJob(appleJob);
    assert.equal(getScanStateForTest().savedErrorCount, 0);
  } finally {
    setScanStateForTest(originalState);
    setDurableLedgersForTest(originalLedgers);
  }
});

test("buildPublicScanState excludes the API key, raw resume, and complete user profile from public status", () => {
  const publicState = { ...buildPublicScanState({
    running: true,
    phase: "Scanning job detail",
    scanned: 3,
    userProfile: {
      llmApiKey: "sk-secret",
      resumeFileDataUrl: "data:application/pdf;base64,very-large-resume",
      candidateProfile: { professionalSummary: "private profile" }
    }
  }) };

  assert.deepEqual(publicState, {
    running: true,
    phase: "Scanning job detail",
    scanned: 3
  });
  assert.equal(JSON.stringify(publicState).includes("sk-secret"), false);
  assert.equal(JSON.stringify(publicState).includes("very-large-resume"), false);
});

test("buildPersistedScanState leaves durable ledger records out of the frequently-written status snapshot", () => {
  const persistedState = { ...buildPersistedScanState({
    phase: "Complete",
    appliedJobs: [{ jobId: "applied-1" }],
    errors: [{ jobId: "error-1" }],
    savedAppliedCount: 1,
    savedErrorCount: 1
  }) };

  assert.deepEqual(persistedState, {
    phase: "Complete",
    savedAppliedCount: 1,
    savedErrorCount: 1
  });
});

test("getSiteLabel resolves from a site id or a URL", () => {
  assert.equal(getSiteLabel("apple"), "Apple Careers");
  assert.equal(getSiteLabel("https://careers.tiktok.com/position/123/detail"), "TikTok/ByteDance Careers");
  assert.equal(getSiteLabel("https://example.com"), "Unknown site");
});

test("getJobIdFromUrl extracts ids across supported path shapes", () => {
  assert.equal(
    getJobIdFromUrl("https://jobs.apple.com/en-us/details/200669112-0836/software-development-engineer"),
    "200669112-0836"
  );
  assert.equal(getJobIdFromUrl("https://careers.tiktok.com/position/7278068779270408508/detail"), "7278068779270408508");
  assert.equal(getJobIdFromUrl("not a url"), null);
});

test("normalizeUserYearsOfExperience clamps to sane bounds", () => {
  assert.equal(normalizeUserYearsOfExperience("3"), 3);
  assert.equal(normalizeUserYearsOfExperience(-5), 2);
  assert.equal(normalizeUserYearsOfExperience("not a number"), 2);
  assert.equal(normalizeUserYearsOfExperience(500), 50);
});

test("normalizeNoMatchKeywords trims, dedupes case-insensitively, and caps length", () => {
  assert.deepEqual(Array.from(normalizeNoMatchKeywords("iOS, Swift\nswift\n\n embedded ")), ["iOS", "Swift", "embedded"]);
  assert.deepEqual(Array.from(normalizeNoMatchKeywords(["iOS", " iOS ", "Firmware"])), ["iOS", "Firmware"]);
  assert.deepEqual(Array.from(normalizeNoMatchKeywords(null)), []);

  const many = Array.from({ length: 60 }, (_, i) => `term${i}`);
  assert.equal(normalizeNoMatchKeywords(many).length, 50);
});

test("normalizeUserProfile fills in defaults and normalizes nested fields", () => {
  const profile = normalizeUserProfile({
    userYearsOfExperience: "4",
    scanMode: "not_a_real_mode",
    noMatchKeywords: "iOS, iOS, Swift"
  });

  assert.equal(profile.userYearsOfExperience, 4);
  assert.equal(profile.scanMode, "scan_only");
  assert.equal(profile.llmModel, "gpt-4o");
  assert.deepEqual(Array.from(profile.noMatchKeywords), ["iOS", "Swift"]);
});

test("statusFromDecision maps decisions to storage statuses", () => {
  assert.equal(statusFromDecision("Likely match"), "likely_match");
  assert.equal(statusFromDecision("Likely skip"), "likely_skip");
  assert.equal(statusFromDecision("Review"), "reviewed");
  assert.equal(statusFromDecision("Unknown"), "seen");
});

test("getHardSkipTitleReason flags seniority and internship titles", () => {
  assert.match(getHardSkipTitleReason("Senior Software Engineer"), /senior-level/);
  assert.match(getHardSkipTitleReason("Engineering Manager"), /manager-level/);
  assert.match(getHardSkipTitleReason("Software Engineering Internship"), /internship/);
  assert.match(getHardSkipTitleReason("Engineering Program Management Undergrad Internships"), /internship/);
  assert.equal(getHardSkipTitleReason("Software Engineer"), null);
});

test("getYoeHardSkip flags required experience above the user's profile", () => {
  const job = { requiredYears: 8, matches: [] };
  const hardSkip = getYoeHardSkip(job, { userYearsOfExperience: 2 });

  assert.ok(hardSkip);
  assert.match(hardSkip.reason, /above your 2 years of experience/);

  assert.equal(getYoeHardSkip({ requiredYears: 2, matches: [] }, { userYearsOfExperience: 5 }), null);
});

test("applyRequiredYoeHardSkip overrides the decision only when YOE truly exceeds the profile", () => {
  const overridden = applyRequiredYoeHardSkip(
    { decision: "Likely match", requiredYears: 10, matches: [] },
    { userYearsOfExperience: 2 }
  );
  assert.equal(overridden.decision, "Likely skip");
  assert.match(overridden.reason, /Hard skip/);

  const unchanged = applyRequiredYoeHardSkip(
    { decision: "Likely match", requiredYears: 2, matches: [] },
    { userYearsOfExperience: 5 }
  );
  assert.equal(unchanged.decision, "Likely match");
});

test("isLocalHardSkip excludes confident skip reasons but lets soft seniority/domain-mismatch signal skips through", () => {
  const confidentReasons = [
    "Matched your no-match keyword list: Swift.",
    "Title appears senior-level: Senior Software Engineer.",
    "Title appears to be an internship: Software Engineering Intern.",
    "A required experience sentence appears to exceed your 2 years of experience.",
    "A high years-of-experience signal (10+ years) appears to exceed your 2 years of experience.",
    "Hard skip: Required YOE is 5, above your 2 years of experience.",
    "Hard skip: High YOE signal is 10, above your 2 years of experience."
  ];

  for (const reason of confidentReasons) {
    assert.equal(isLocalHardSkip({ decision: "Likely skip", reason }), true, reason);
  }

  assert.equal(
    isLocalHardSkip({ decision: "Likely skip", reason: "Seniority mismatch detected: staff/principal title." }),
    false
  );
  // Regression: "Strong domain mismatch detected" used to be a confident (LLM-bypassing) reason. It's a
  // soft, sometimes-wrong keyword-penalty heuristic from content.js's classifyRole (a QA/testing role
  // that merely mentions "mobile app" as context can trip it) -- exactly the kind of signal that should
  // still reach the LLM for a real judgment call, not pre-empt it. See core.test.js for the fuller
  // regression test this was caught from (a live scan showing zero OpenAI usage across hundreds of jobs).
  assert.equal(isLocalHardSkip({ decision: "Likely skip", reason: "Strong domain mismatch detected: iOS app development." }), false);
  assert.equal(isLocalHardSkip({ decision: "Review", reason: "Title appears senior-level: X." }), false);
});

test("shouldAutoApply requires auto_apply mode, consent, and an eligible status", () => {
  const autoApplyProfile = normalizeUserProfile({
    scanMode: "auto_apply",
    autoApplyConsent: true,
    userYearsOfExperience: 5
  });

  assert.equal(shouldAutoApply("likely_match", { requiredYears: 2, matches: [] }, autoApplyProfile), true);
  assert.equal(shouldAutoApply("seen", { requiredYears: 2, matches: [] }, autoApplyProfile), false);
  assert.equal(shouldAutoApply("likely_match", { requiredYears: 10, matches: [] }, autoApplyProfile), false);

  const scanOnlyProfile = normalizeUserProfile({
    scanMode: "scan_only",
    autoApplyConsent: true,
    userYearsOfExperience: 5
  });
  assert.equal(shouldAutoApply("likely_match", { requiredYears: 2, matches: [] }, scanOnlyProfile), false);
});

test("background scan readiness enforces the personalized LLM layer only for LLM-assisted auto-apply", () => {
  const requiredApplicationAnswers = {
    eeoGender: "male",
    eeoRaceEthnicity: ["asian"],
    eeoVeteranStatus: "not_protected_veteran",
    eeoDisabilityStatus: "no_current_or_past"
  };
  const missingAnswers = normalizeUserProfile({ scanMode: "auto_apply", autoApplyConsent: true, llmEnabled: false });
  assert.match(getAutoApplyReadinessError(missingAnswers), /saved answers/i);

  const localOnly = normalizeUserProfile({
    scanMode: "auto_apply",
    autoApplyConsent: true,
    llmEnabled: false,
    ...requiredApplicationAnswers
  });
  assert.equal(getAutoApplyReadinessError(localOnly), null);

  const unvalidated = normalizeUserProfile({
    scanMode: "auto_apply",
    autoApplyConsent: true,
    llmEnabled: true,
    llmApiKey: "sk-test",
    resumeProfile: "Backend engineer",
    ...requiredApplicationAnswers
  });
  assert.match(getAutoApplyReadinessError(unvalidated), /valid API key/i);

  const validatedBase = normalizeUserProfile({
    ...unvalidated,
    llmApiKeyValidationStatus: "valid",
    llmApiKeyValidatedFingerprint: core.fingerprintText("sk-test")
  });
  assert.equal(getAutoApplyReadinessError(validatedBase), null);

  const withoutProfile = normalizeUserProfile({ ...validatedBase, resumeProfile: "", candidateProfile: {} });
  assert.match(getAutoApplyReadinessError(withoutProfile), /CandidateProfile or a resume\/profile summary/i);

  const resumeFileDataUrl = "data:application/pdf;base64,JVBERi0xLjQK";
  const staleResume = normalizeUserProfile({ ...validatedBase, resumeFileDataUrl });
  assert.match(getAutoApplyReadinessError(staleResume), /currently selected PDF resume/i);

  const freshResume = normalizeUserProfile({
    ...staleResume,
    candidateProfile: { professionalSummary: "Backend engineer" },
    candidateProfileResumeFingerprint: core.fingerprintText(resumeFileDataUrl)
  });
  assert.equal(getAutoApplyReadinessError(freshResume), null);
});

test("shouldAutoSubmitGenericAutofill only submits with zero flagged or unresolved agent fields and auto-apply consent", () => {
  const requiredApplicationAnswers = {
    eeoGender: "male",
    eeoRaceEthnicity: ["asian"],
    eeoVeteranStatus: "not_protected_veteran",
    eeoDisabilityStatus: "no_current_or_past"
  };
  const autoApplyProfile = normalizeUserProfile({
    scanMode: "auto_apply",
    autoApplyConsent: true,
    ...requiredApplicationAnswers
  });
  const scanOnlyProfile = normalizeUserProfile({ scanMode: "scan_only", autoApplyConsent: true });
  const noConsentProfile = normalizeUserProfile({
    scanMode: "auto_apply",
    autoApplyConsent: false,
    ...requiredApplicationAnswers
  });
  const incompleteProfile = normalizeUserProfile({ scanMode: "auto_apply", autoApplyConsent: true });

  assert.equal(shouldAutoSubmitGenericAutofill(0, false, autoApplyProfile), true);
  assert.equal(shouldAutoSubmitGenericAutofill(1, false, autoApplyProfile), false);
  assert.equal(shouldAutoSubmitGenericAutofill(0, true, autoApplyProfile), false);
  assert.equal(shouldAutoSubmitGenericAutofill(0, false, scanOnlyProfile), false);
  assert.equal(shouldAutoSubmitGenericAutofill(0, false, noConsentProfile), false);
  assert.equal(shouldAutoSubmitGenericAutofill(0, false, incompleteProfile), false);
});

test("generic submit clicks remain confirmation-pending and are never reported as submitted", () => {
  const clicked = { ...buildGenericSubmitOutcome(true, { clicked: true }) };
  assert.deepEqual(clicked, {
    submitted: false,
    submitAttempted: true,
    submitClicked: true,
    confirmationPending: true
  });

  const notClicked = { ...buildGenericSubmitOutcome(true, { clicked: false }) };
  assert.equal(notClicked.submitted, false);
  assert.equal(notClicked.submitAttempted, true);
  assert.equal(notClicked.submitClicked, false);
  assert.equal(notClicked.confirmationPending, false);
});

test("buildNeedsReviewReasonSummary summarizes single vs multiple flagged fields", () => {
  assert.equal(
    buildNeedsReviewReasonSummary([{ label: "Email", reason: "Email -- no value saved" }]),
    "Email -- no value saved"
  );
  assert.equal(
    buildNeedsReviewReasonSummary([
      { label: "Email", reason: "Email -- no value saved" },
      { label: "Gender", reason: "Gender -- no value saved" }
    ]),
    "2 fields need review: Email, Gender"
  );
});

test("Workday URL detection is limited to candidate-facing Workday hosts", () => {
  assert.equal(isWorkdayHostname("acme.wd5.myworkdayjobs.com"), true);
  assert.equal(isWorkdayHostname("acme.myworkdaysite.com"), true);
  assert.equal(isWorkdayUrl("https://acme.wd5.myworkdayjobs.com/en-US/jobs"), true);
  assert.equal(isWorkdayUrl("https://example.com/?next=myworkdayjobs.com"), false);
  assert.equal(isWorkdayHostname("fake-myworkdayjobs.com"), false);
});

asyncTest("trusted Workday clicks use a bounded CDP mouse sequence and detach immediately", async () => {
  const originalDebugger = sandbox.chrome.debugger;
  const calls = [];

  try {
    sandbox.chrome.debugger = {
      attach(target, version, callback) {
        calls.push({ operation: "attach", target, version });
        callback();
      },
      sendCommand(target, method, params, callback) {
        calls.push({ operation: "command", target, method, params });
        callback({});
      },
      detach(target, callback) {
        calls.push({ operation: "detach", target });
        callback();
      }
    };

    const result = await dispatchTrustedWorkdayClick(
      { tab: { id: 42, url: "https://acme.wd5.myworkdayjobs.com/en-US/apply" } },
      { x: 125.5, y: 240.25 }
    );

    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((call) => call.operation), ["attach", "command", "command", "command", "detach"]);
    assert.deepEqual(
      calls.filter((call) => call.operation === "command").map((call) => call.params.type),
      ["mouseMoved", "mousePressed", "mouseReleased"]
    );
    assert.ok(calls.every((call) => call.target.tabId === 42));

    const rejected = await dispatchTrustedWorkdayClick(
      { tab: { id: 42, url: "https://example.com/apply" } },
      { x: 125.5, y: 240.25 }
    );
    assert.equal(rejected.ok, false);

    const rejectedFrame = await dispatchTrustedWorkdayClick(
      { frameId: 3, tab: { id: 42, url: "https://acme.wd5.myworkdayjobs.com/en-US/apply" } },
      { x: 125.5, y: 240.25 }
    );
    assert.equal(rejectedFrame.ok, false);
    assert.equal(calls.length, 5, "a non-Workday sender must never reach chrome.debugger");
  } finally {
    sandbox.chrome.debugger = originalDebugger;
  }
});

asyncTest("Apple Proceed waits for popup layout after debugger attachment and never clicks an obscured button", async () => {
  const originalDebugger = sandbox.chrome.debugger;
  const originalScripting = sandbox.chrome.scripting;
  const calls = [];
  let attached = false;
  let obscured = false;
  const sender = { tab: { id: 63, url: "https://jobs.apple.com/app/en-us/profile/roles" } };
  const roleId = "200674539";

  try {
    sandbox.chrome.debugger = {
      attach(target, version, callback) { attached = true; calls.push("attach"); callback(); },
      sendCommand(target, method, params, callback) {
        assert.equal(attached, true);
        calls.push(params);
        callback({});
      },
      detach(target, callback) { attached = false; calls.push("detach"); callback(); }
    };
    sandbox.chrome.scripting = {
      executeScript: async ({ func, args }) => {
        assert.equal(attached, true, "locate the button only after Chrome changes the viewport on attachment");
        calls.push("locate");
        let clock = 0;
        let tick = 0;
        const button = {
          get disabled() { return args[1] === "proceed" && tick < 2; },
          getAttribute: () => null,
          getBoundingClientRect: () => ({ left: 100, top: tick < 3 ? 100 + tick * 10 : 160,
            width: 100, height: 40, right: 200, bottom: 200 }),
          contains: () => false,
          closest: () => ({ querySelector: (selector) => selector.includes("checkbox") ? { checked: false } : {} }),
          scrollIntoView: () => {}
        };
        const modal = {
          getBoundingClientRect: () => ({ width: 300, height: 200 }),
          querySelector: (selector) => selector.includes("header")
            ? { textContent: "Are you sure you want to withdraw this submission?" } : button
        };
        const result = await vm.runInNewContext(`(${func.toString()})(...args)`, {
          args,
          Date: { now: () => clock },
          setTimeout: (callback, ms) => { clock += ms; tick += 1; callback(); },
          window: { innerWidth: 800, innerHeight: 600,
            getComputedStyle: (element) => ({ display: "block", visibility: "visible",
              opacity: element === modal && tick === 0 ? "0" : "1" }) },
          document: {
            querySelector: () => ({ value: "2" }),
            querySelectorAll: () => [modal],
            getElementById: () => button,
            elementFromPoint: () => obscured ? {} : button
          }
        });
        return [{ result }];
      }
    };

    assert.equal((await dispatchTrustedAppleWithdrawalClick(sender, roleId, "proceed", 2)).ok, false);
    assert.equal(calls.length, 0, "Proceed requires this role's own opened confirmation");
    assert.equal((await dispatchTrustedAppleWithdrawalClick(sender, roleId, "open", 2)).ok, true);
    assert.equal((await dispatchTrustedAppleWithdrawalClick(sender, "200654506", "open", 2)).ok, false);
    calls.length = 0;
    assert.equal((await dispatchTrustedAppleWithdrawalClick(sender, roleId, "proceed", 2)).ok, true);
    assert.deepEqual(calls.filter((call) => typeof call === "string"), ["attach", "locate", "detach"]);
    const events = calls.filter((call) => typeof call === "object");
    assert.deepEqual(events.map((event) => event.type), ["mouseMoved", "mousePressed", "mouseReleased"]);
    assert.ok(events.every((event) => event.x === 150 && event.y === 180), "click the final position after animation and enabling");

    assert.equal((await dispatchTrustedAppleWithdrawalClick(sender, roleId, "open", 2)).ok, true);
    obscured = true;
    calls.length = 0;
    const blocked = await dispatchTrustedAppleWithdrawalClick(sender, roleId, "proceed", 2);
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /obscured/);
    assert.deepEqual(calls, ["attach", "locate", "detach"], "no click is dispatched when another element covers Proceed");
    obscured = false;
    assert.equal((await dispatchTrustedAppleWithdrawalClick(sender, roleId, "proceed", 2)).ok, true,
      "a failed preflight keeps the pending confirmation tied to the same role");
  } finally {
    sandbox.chrome.debugger = originalDebugger;
    sandbox.chrome.scripting = originalScripting;
  }
});

asyncTest("trusted Workday text repair clears one selected value, inserts its replacement, and detaches", async () => {
  const originalDebugger = sandbox.chrome.debugger;
  const calls = [];

  try {
    sandbox.chrome.debugger = {
      attach(target, version, callback) {
        calls.push({ operation: "attach", target, version });
        callback();
      },
      sendCommand(target, method, params, callback) {
        calls.push({ operation: "command", target, method, params });
        callback({});
      },
      detach(target, callback) {
        calls.push({ operation: "detach", target });
        callback();
      }
    };

    const sender = {
      frameId: 0,
      tab: { id: 84, url: "https://acme.wd5.myworkdayjobs.com/en-US/apply" }
    };
    const result = await dispatchTrustedWorkdayTextReplacement(sender, "Jeff");

    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((call) => call.operation), ["attach", "command", "command", "command", "detach"]);
    assert.deepEqual(
      calls.filter((call) => call.operation === "command").map((call) => [call.method, call.params.type, call.params.key, call.params.text]),
      [
        ["Input.dispatchKeyEvent", "keyDown", "Backspace", undefined],
        ["Input.dispatchKeyEvent", "keyUp", "Backspace", undefined],
        ["Input.insertText", undefined, undefined, "Jeff"]
      ]
    );
    assert.ok(calls.every((call) => call.target.tabId === 84));

    const callCount = calls.length;
    assert.equal((await dispatchTrustedWorkdayTextReplacement({ tab: { id: 84, url: "https://example.com" } }, "Jeff")).ok, false);
    assert.equal((await dispatchTrustedWorkdayTextReplacement(sender, "x".repeat(4001))).ok, false);
    assert.equal(calls.length, callCount, "rejected requests must never reach chrome.debugger");
  } finally {
    sandbox.chrome.debugger = originalDebugger;
  }
});

test("mergeWorkdayAutofillPage accumulates fields and page-level workflow state", () => {
  const aggregate = {
    filledFields: [],
    flaggedFields: [],
    hadPendingAnswerFields: false,
    needsResumeUpload: false,
    resumeUploaded: false,
    trace: [],
    pageTitle: "",
    hostname: "",
    pageFingerprint: "",
    workdayPagesProcessed: 0
  };
  mergeWorkdayAutofillPage(aggregate, {
    filledFields: [{ label: "Country", value: "United States of America" }],
    flaggedFields: [],
    hadPendingAnswerFields: false,
    needsResumeUpload: true,
    resumeUploaded: true,
    trace: ["Resume attached."],
    pageTitle: "Apply",
    hostname: "acme.myworkdayjobs.com",
    pageFingerprint: "resume"
  });
  mergeWorkdayAutofillPage(aggregate, {
    filledFields: [{ label: "Phone", value: "555-555-5555" }],
    flaggedFields: [{ label: "Question", reason: "needs review" }],
    hadPendingAnswerFields: true,
    trace: ["Profile page."],
    pageFingerprint: "profile"
  });

  assert.equal(aggregate.workdayPagesProcessed, 2);
  assert.equal(aggregate.filledFields.length, 2);
  assert.equal(aggregate.flaggedFields.length, 1);
  assert.equal(aggregate.hadPendingAnswerFields, true);
  assert.equal(aggregate.resumeUploaded, true);
  assert.equal(aggregate.pageFingerprint, "profile");
});

asyncTest("persistObservedWorkdayCandidateProfile enriches the single local profile record idempotently", async () => {
  const resumeFileDataUrl = "data:application/pdf;base64,WORKDAY";
  storageData.appleCareersUserProfile = normalizeUserProfile({
    resumeFileDataUrl,
    resumeFileName: "resume.pdf",
    resumeFileType: "application/pdf",
    candidateProfileResumeFingerprint: core.fingerprintText(resumeFileDataUrl),
    candidateProfile: {
      experience: [{ company: "Acme", title: "Engineer", summary: "Resume summary" }]
    }
  });

  const observed = {
    experience: [{ company: "Acme", title: "Engineer", location: "Austin, TX" }],
    education: [{ institution: "State University", degree: "Masters", gradeAverage: "3.9" }]
  };
  const first = await persistObservedWorkdayCandidateProfile(observed);
  assert.equal(first.changed, true);
  assert.equal(storageData.appleCareersUserProfile.candidateProfile.experience[0].summary, "Resume summary");
  assert.equal(storageData.appleCareersUserProfile.candidateProfile.experience[0].location, "Austin, TX");
  assert.equal(storageData.appleCareersUserProfile.candidateProfile.education[0].gradeAverage, "3.9");

  const second = await persistObservedWorkdayCandidateProfile(observed);
  assert.equal(second.changed, false);
  assert.equal(storageData.appleCareersUserProfile.candidateProfile.experience.length, 1);
  assert.equal(storageData.appleCareersUserProfile.candidateProfile.education.length, 1);
});

test("buildGenericContentProfile keeps form data but strips the OpenAI key before page injection", () => {
  const contentProfile = buildGenericContentProfile({
    llmEnabled: true,
    llmApiKey: "sk-secret",
    firstName: "Jeff",
    resumeProfile: "Backend engineer."
  });
  assert.equal(contentProfile.llmEnabled, true);
  assert.equal(contentProfile.llmApiKey, "");
  assert.equal(contentProfile.firstName, "Jeff");
  assert.equal(contentProfile.resumeProfile, "Backend engineer.");
});

test("classifyWorkflowError recognizes common failure signatures", () => {
  assert.equal(classifyWorkflowError("You've already applied for this job.", null), "already_applied");
  assert.equal(classifyWorkflowError("Answered 1 of 2 required authorization questions", null), "questionnaire_incomplete");
  assert.equal(classifyWorkflowError("Please sign in to continue", null), "session_or_login_required");
  assert.equal(classifyWorkflowError("Timed out waiting for tab to load.", null), "workflow_timeout");
  assert.equal(classifyWorkflowError("Something unexpected happened", null), "apply_failed");
});

test("normalizeLlmDecision and normalizeYoeAssessment normalize free-text LLM output", () => {
  assert.equal(normalizeLlmDecision("likely_match"), "Likely match");
  assert.equal(normalizeLlmDecision("LIKELY SKIP"), "Likely skip");
  assert.equal(normalizeLlmDecision("review"), "Review");
  assert.equal(normalizeLlmDecision("garbage"), "Review");

  assert.equal(normalizeYoeAssessment("too-high"), "too_high");
  assert.equal(normalizeYoeAssessment("Acceptable"), "acceptable");
  assert.equal(normalizeYoeAssessment("garbage"), "unclear");
});

test("decisionFromLlmResult forces Likely skip when YOE is assessed too high AND a real local YOE signal backs it up", () => {
  const jobWithYoeSignal = { requiredYears: 8, matches: [{ type: "required", years: [8] }] };
  assert.equal(decisionFromLlmResult({ decision: "Likely match", yoe_assessment: "too_high" }, jobWithYoeSignal), "Likely skip");
  assert.equal(decisionFromLlmResult({ decision: "Likely match", yoe_assessment: "acceptable" }, jobWithYoeSignal), "Likely match");
});

// Regression: the LLM sometimes claims yoe_assessment: too_high for a job with ZERO explicit
// years-of-experience language anywhere -- confirmed via 5 repeated real API calls against a real
// ByteDance posting with no YOE requirement at all (job.requiredYears null, job.matches empty), where
// the model nonetheless consistently returned too_high, apparently conflating a missing infra-skill gap
// with an experience-level mismatch. Without job.matches/requiredYears as ground truth, this hard,
// unconditional override could skip a job over a YOE requirement that was never actually stated.
test("decisionFromLlmResult does not honor an LLM too_high claim when the local deterministic scan found no YOE requirement at all", () => {
  const jobWithNoYoeSignal = { requiredYears: null, matches: [] };
  assert.equal(decisionFromLlmResult({ decision: "Review", score: 37, yoe_assessment: "too_high" }, jobWithNoYoeSignal), "Review");
  assert.equal(
    decisionFromLlmResult({ decision: "Likely skip", yoe_assessment: "too_high" }, jobWithNoYoeSignal),
    "Likely skip",
    "still respects the LLM's own decision field when it independently says skip -- only the too_high OVERRIDE is untrusted, not the LLM's judgment entirely"
  );
});

test("incrementStatsForStatus tallies scan stats by status", () => {
  const stats = { applied: 0, likelyMatch: 0, applyFailed: 0 };
  incrementStatsForStatus(stats, "applied");
  incrementStatsForStatus(stats, "likely_match");
  incrementStatsForStatus(stats, "review_apply_failed");

  assert.equal(stats.applied, 1);
  assert.equal(stats.likelyMatch, 1);
  assert.equal(stats.applyFailed, 1);
});

test("quota fallback pruning retains the newest bounded job history instead of erasing every record", () => {
  const records = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [`job-${index + 1}`, { jobId: `job-${index + 1}` }])
  );
  const pruned = pruneJobRecords(records);

  assert.equal(Object.keys(pruned).length, 30);
  assert.equal(pruned["job-1"].jobId, "job-1");
  assert.equal(pruned["job-30"].jobId, "job-30");
  assert.equal(pruned["job-31"], undefined);
});

test("recordAppliedCheckpoint records lastApplied and increments stats.applied eagerly", () => {
  setScanStateForTest({
    lastApplied: null,
    stats: { applied: 0 }
  });

  recordAppliedCheckpoint({
    jobId: "200669112-0836",
    site: "apple",
    siteLabel: "Apple Careers",
    title: "Software Development Engineer",
    url: "https://jobs.apple.com/en-us/details/200669112-0836/software-development-engineer"
  });

  const state = getScanStateForTest();
  assert.equal(state.stats.applied, 1);
  assert.equal(state.lastApplied?.jobId, "200669112-0836");
  assert.ok(state.lastApplied?.appliedAt);
});

test("recordAppliedCheckpoint is a no-op without a jobContext", () => {
  setScanStateForTest({
    lastApplied: null,
    stats: { applied: 0 }
  });

  recordAppliedCheckpoint(null);

  const state = getScanStateForTest();
  assert.equal(state.stats.applied, 0);
  assert.equal(state.lastApplied, null);
});

test("compactResumeMatch and truncateText shape values defensively", () => {
  const empty = compactResumeMatch(null);
  assert.equal(empty.score, undefined);
  assert.equal(empty.percentage, undefined);
  assert.deepEqual(Array.from(empty.keywords), []);

  const filled = compactResumeMatch({ score: 10, percentage: 50, keywords: ["A", "B"] });
  assert.equal(filled.score, 10);
  assert.equal(filled.percentage, 50);
  assert.deepEqual(Array.from(filled.keywords), ["A", "B"]);

  assert.equal(truncateText("short"), "short");
  assert.equal(truncateText("x".repeat(10), 5), `${"x".repeat(5)}...`);
});

test("hasLlmAnswerCapability requires an enabled LLM, an API key, and a resume profile", () => {
  assert.equal(hasLlmAnswerCapability({ llmEnabled: false, llmApiKey: "k", resumeProfile: "r" }), false);
  assert.equal(hasLlmAnswerCapability({ llmEnabled: true, llmApiKey: "", resumeProfile: "r" }), false);
  assert.equal(hasLlmAnswerCapability({ llmEnabled: true, llmApiKey: "k", resumeProfile: "" }), false);
  assert.equal(hasLlmAnswerCapability({ llmEnabled: true, llmApiKey: "k", resumeProfile: "r" }), true);
});

test("buildAnswerPrompt grounds the answer in the resume profile, question, and job context", () => {
  const messages = buildAnswerPrompt(
    "Why do you want to work at this company?",
    { title: "Software Engineer", siteLabel: "Apple Careers", matchScore: { keywords: ["Swift", "iOS"] } },
    { resumeProfile: "5 years of backend experience." }
  );

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /never invent/i);

  const userContent = JSON.parse(messages[1].content);
  assert.equal(userContent.question, "<untrusted_question>Why do you want to work at this company?</untrusted_question>");
  assert.equal(userContent.resume_profile, "5 years of backend experience.");
  assert.equal(userContent.job.title, "Software Engineer");
  assert.equal(userContent.job.company, "Apple Careers");
  assert.deepEqual(Array.from(userContent.job.matched_keywords), ["Swift", "iOS"]);
});

test("buildAnswerPrompt tolerates a missing stored job record", () => {
  const messages = buildAnswerPrompt("Tell us about a challenge you overcame.", null, {
    resumeProfile: "5 years of backend experience."
  });
  const userContent = JSON.parse(messages[1].content);

  assert.equal(userContent.job.title, null);
  assert.equal(userContent.job.company, null);
  assert.deepEqual(Array.from(userContent.job.matched_keywords), []);
});

test("translateKnownSiteStep maps the entry-button click to the semantic open_application tool", () => {
  const opened = translateKnownSiteStep({ step: "Open application flow", status: "clicked", label: "Apply Now" });
  assert.equal(opened.tool, "open_application");
  assert.equal(opened.status, "success");

  const missing = translateKnownSiteStep({ step: "Open application flow", status: "missing" });
  assert.equal(missing.tool, "open_application");
  assert.equal(missing.status, "error");
});

test("translateKnownSiteStep keeps a final-submit click pending until the same page read confirms the outcome", () => {
  const submitted = translateKnownSiteStep({ step: "Submit application", status: "clicked", label: "Submit" });
  assert.equal(submitted.tool, "submit_application");
  assert.equal(submitted.status, "pending");
  assert.match(submitted.observation, /confirmation pending/);

  const confirmed = translateKnownSiteStep(
    { step: "Submit application", status: "clicked", label: "Submit" },
    { submissionConfirmed: true }
  );
  assert.equal(confirmed.status, "success");
  assert.match(confirmed.observation, /confirmed the outcome/);

  const blocked = translateKnownSiteStep(
    { step: "Submit application", status: "clicked", label: "Submit" },
    { submissionBlocked: true }
  );
  assert.equal(blocked.status, "error");
  assert.match(blocked.observation, /validation errors/);

  const unconfirmed = translateKnownSiteStep(
    { step: "Submit application", status: "clicked", label: "Submit" },
    { submissionUnconfirmed: true }
  );
  assert.equal(unconfirmed.status, "error");
  assert.match(unconfirmed.observation, /could not be confirmed/);

  const missing = translateKnownSiteStep({ step: "Submit application", status: "missing" });
  assert.equal(missing.tool, "submit_application");
  assert.equal(missing.status, "error");
  assert.match(missing.observation, /not found/);
});

test("translateKnownSiteStep distinguishes a confirmed submission from an unconfirmed one", () => {
  const confirmed = translateKnownSiteStep({
    step: "Confirm application submitted",
    status: "detected",
    label: "Your application has been submitted"
  });
  assert.equal(confirmed.tool, "read_page");
  assert.equal(confirmed.status, "success");

  // The exact regression case content.js's fallback branch used to silently misreport as done:true --
  // see clickAndDetectSubmission's comment on why this is now pausedForReview, not a false success.
  const unconfirmed = translateKnownSiteStep({ step: "Confirm application submitted", status: "unconfirmed" });
  assert.equal(unconfirmed.tool, "read_page");
  assert.equal(unconfirmed.status, "error");
  assert.match(unconfirmed.observation, /could not confirm/);
});

test("translateKnownSiteStep maps validation checks to errors", () => {
  // Preserve rendering for activity rows persisted by an older extension build, even though the
  // current workflow no longer creates a pre-submit validation step.
  const blocked = translateKnownSiteStep({
    step: "Check for validation errors before submitting",
    status: "blocked",
    label: "2 field(s) marked invalid"
  });
  assert.equal(blocked.tool, "verify");
  assert.equal(blocked.status, "error");
  assert.match(blocked.observation, /field\(s\) marked invalid/);

  const postClickBlocked = translateKnownSiteStep({
    step: "Check for validation errors after submitting",
    status: "blocked",
    label: "Please answer Work Authorization"
  });
  assert.equal(postClickBlocked.status, "error");
  assert.match(postClickBlocked.observation, /Work Authorization/);

  const continueBlocked = translateKnownSiteStep({
    step: "Check for validation errors after continuing",
    status: "blocked",
    label: "Singapore Work Pass Status is required"
  });
  assert.equal(continueBlocked.tool, "verify");
  assert.equal(continueBlocked.status, "error");
  assert.match(continueBlocked.observation, /Singapore Work Pass Status/);
});

test("translateKnownSiteStep surfaces deterministic authorization selection and pending submission reads", () => {
  const authorization = translateKnownSiteStep({
    step: "Answer work authorization",
    status: "selected",
    label: "Yes"
  });
  assert.deepEqual(
    { ...authorization },
    { tool: "select", label: "Work Authorization", status: "success", observation: "Yes selected and verified" }
  );

  const missingSponsorship = translateKnownSiteStep({
    step: "Answer visa sponsorship",
    status: "missing",
    label: "No visible dropdown options"
  });
  assert.equal(missingSponsorship.status, "error");
  assert.match(missingSponsorship.observation, /No visible dropdown options/);

  const pending = translateKnownSiteStep({
    step: "Wait for submit result",
    status: "loading",
    label: "Submitting"
  });
  assert.equal(pending.status, "pending");
  assert.match(pending.observation, /Submitting/);

  const requiredAudit = translateKnownSiteStep({
    step: "Audit required fields",
    status: "blocked",
    label: "1 of 2 required field(s) remain unanswered: Current right-to-work status."
  });
  assert.deepEqual(
    { ...requiredAudit },
    {
      tool: "read_page",
      label: "Required Field Audit",
      status: "error",
      observation: "1 of 2 required field(s) remain unanswered: Current right-to-work status."
    }
  );
});

test("translateKnownSiteStep maps already-submitted/already-applied detection to a successful read", () => {
  for (const stepName of ["Detect already submitted", "Detect already submitted after waiting", "Detect already applied notice"]) {
    const detected = translateKnownSiteStep({ step: stepName, status: "detected", label: "Submitted" });
    assert.equal(detected.tool, "read_page");
    assert.equal(detected.status, "success");
  }
});

test("translateKnownSiteStep surfaces question-agent choices and verified essay answers while leaving unrelated field noise out", () => {
  assert.deepEqual(
    { ...translateKnownSiteStep({ step: "Question agent: Earliest start date", status: "selected", label: "August 20, 2026" }) },
    { tool: "select", label: "Earliest start date", status: "success", observation: "August 20, 2026" }
  );
  assert.deepEqual(
    {
      ...translateKnownSiteStep({
        step: "Draft answer: Why Apple?",
        status: "filled",
        label: "Question answered with 24 words and verified."
      })
    },
    { tool: "generate", label: "Why Apple?", status: "success", observation: "Question answered with 24 words and verified." }
  );
  assert.equal(translateKnownSiteStep({ step: "Answer work authorization question", status: "answered" }), null);
  assert.equal(translateKnownSiteStep({ step: "Fill open text question", status: "filled" }), null);
  assert.equal(translateKnownSiteStep({ step: "Some future step nobody has written yet", status: "clicked" }), null);
});

test("buildFinalMatchObservation reports a YOE hard skip as the result instead of presenting the local score as an overall match", () => {
  const observation = buildFinalMatchObservation(
    {
      decision: "Likely skip",
      reason: "Hard skip: Required YOE is 10, above your 2 years of experience.",
      matchScore: { percentage: 100 }
    },
    false,
    { scanMode: "auto_apply", autoApplyConsent: true }
  );

  assert.equal(observation, "Hard skip — Required YOE is 10, above your 2 years of experience. Not applying.");
  assert.doesNotMatch(observation, /100% match/i);
});

test("buildFinalMatchObservation distinguishes scan-only mode from a matching skip decision", () => {
  assert.equal(
    buildFinalMatchObservation(
      { decision: "Likely match", reason: "Required experience is acceptable." },
      false,
      { scanMode: "scan_only", autoApplyConsent: false }
    ),
    "Likely match — Required experience is acceptable. Scan-only mode; no application attempted."
  );
});

test("buildFinalMatchObservation says when an eligible final decision will auto-apply", () => {
  assert.equal(
    buildFinalMatchObservation(
      { decision: "Review", reason: "Candidate meets most requirements." },
      true,
      { scanMode: "auto_apply", autoApplyConsent: true }
    ),
    "Review — Candidate meets most requirements. Applying automatically."
  );
});

asyncTest("question-agent activity transitions one live row from pending to completed", async () => {
  const activitySteps = [];
  const stepId = await pushKnownSiteStep(
    activitySteps,
    "question_agent",
    "Why Apple?",
    "pending",
    "Agent started; waiting for an LLM response...",
    { url: "https://jobs.apple.com/en-us/details/123" }
  );

  assert.equal(activitySteps.length, 1);
  assert.equal(activitySteps[0].status, "pending");
  assert.equal(activitySteps[0].url, "https://jobs.apple.com/en-us/details/123");
  await resolveKnownSiteStep(activitySteps, stepId, "success", "Agent returned a resume-grounded answer.");
  assert.equal(activitySteps.length, 1);
  assert.equal(activitySteps[0].status, "success");
  assert.equal(activitySteps[0].observation, "Agent returned a resume-grounded answer.");
});

asyncTest("known-site activity attaches steps to an explicit job cycle and closes with the final outcome", async () => {
  const activitySteps = [];
  const activityCycles = [];
  const cycleId = await beginKnownSiteActivityCycle(
    activitySteps,
    activityCycles,
    {
      site: "apple",
      jobId: "200000001",
      title: "Software Engineer",
      url: "https://jobs.apple.com/en-us/details/200000001/software-engineer"
    },
    "Reviewing"
  );

  await pushKnownSiteStep(activitySteps, "read_job_description", "Software Engineer", "success");

  assert.equal(activityCycles.length, 1);
  assert.equal(activityCycles[0].status, "running");
  assert.equal(activityCycles[0].outcome, "Reviewing");
  assert.equal(activitySteps[0].cycleId, cycleId);

  await finishKnownSiteActivityCycle(activitySteps, cycleId, getKnownSiteCycleResult("applied"), false);

  assert.equal(activityCycles[0].status, "success");
  assert.equal(activityCycles[0].outcome, "Applied");
  assert.equal(typeof activityCycles[0].completedAt, "number");
  assert.equal(storageData.appleCareersKnownSiteActivity.running, false);
  assert.equal(storageData.appleCareersKnownSiteActivity.cycles[0].id, cycleId);
});

test("known-site cycle outcomes distinguish routine completion from attention-required failures", () => {
  assert.deepEqual({ ...getKnownSiteCycleResult("submitted") }, { status: "success", outcome: "Already Applied" });
  assert.deepEqual({ ...getKnownSiteCycleResult("likely_skip") }, { status: "success", outcome: "Skipped" });
  assert.deepEqual({ ...getKnownSiteCycleResult("needs_review") }, {
    status: "attention",
    outcome: "Needs Attention"
  });
  assert.deepEqual({ ...getKnownSiteCycleResult("likely_match_apply_failed") }, {
    status: "attention",
    outcome: "Needs Attention"
  });
});

asyncTest("applied and error clear actions remove only their own ledger and related job records", async () => {
  await scanStateReady;
  const originalState = getScanStateForTest();
  const originalLedgers = getDurableLedgersForTest();
  const originalStorage = { ...storageData };
  const appliedJob = {
    jobId: "clear-applied-1",
    site: "apple",
    title: "Applied role",
    url: "https://jobs.apple.com/en-us/details/clear-applied-1/applied-role",
    status: "applied"
  };
  const errorJob = {
    jobId: "clear-error-1",
    site: "tiktok",
    title: "Error role",
    url: "https://jobs.bytedance.com/en/position/clear-error-1",
    status: "review_apply_failed"
  };
  const retainedJob = {
    jobId: "keep-seen-1",
    site: "apple",
    title: "Previously seen role",
    url: "https://jobs.apple.com/en-us/details/keep-seen-1/previously-seen-role",
    status: "likely_skip"
  };

  try {
    setScanStateForTest(core.createIdleState());
    setDurableLedgersForTest({});
    rememberAppliedJob(appliedJob);
    rememberPersistedError({ ...errorJob, type: "submit_not_found", message: "Could not find submit button." });
    storageData.appleCareersJobRecords = {
      [appliedJob.jobId]: appliedJob,
      [errorJob.jobId]: errorJob,
      [retainedJob.jobId]: retainedJob
    };

    const appliedResult = await clearAppliedJobs();
    assert.equal(appliedResult.ok, true);
    assert.equal(getScanStateForTest().savedAppliedCount, 0);
    assert.equal(getScanStateForTest().savedErrorCount, 1, "clearing applied jobs must preserve errors");
    assert.deepEqual(Object.keys(storageData.appleCareersJobRecords).sort(), [errorJob.jobId, retainedJob.jobId].sort());

    const errorResult = await clearErrorJobs();
    assert.equal(errorResult.ok, true);
    assert.equal(getScanStateForTest().savedErrorCount, 0);
    assert.deepEqual(Object.keys(storageData.appleCareersJobRecords), [retainedJob.jobId]);
  } finally {
    for (const key of Object.keys(storageData)) {
      delete storageData[key];
    }
    Object.assign(storageData, originalStorage);
    setScanStateForTest(originalState);
    setDurableLedgersForTest(originalLedgers);
  }
});

asyncTest("Workday auto-apply re-sweeps after Continue and stops at one confirmation-pending Submit", async () => {
  const originalTabs = sandbox.chrome.tabs;
  const originalDelay = sandbox.delay;
  const tab = {
    id: 71,
    status: "complete",
    title: "Workday application",
    url: "https://acme.wd5.myworkdayjobs.com/en-US/apply"
  };
  const messages = [];
  let page = 1;

  try {
    sandbox.delay = async () => {};
    sandbox.chrome.tabs = {
      async get() {
        return tab;
      },
      async sendMessage(_tabId, message) {
        messages.push(message);
        if (message.type === "APPLE_CAREERS_RUN_GENERIC_AUTOFILL") {
          return {
            ok: true,
            data: {
              filledFields: page === 1 ? [{ label: "Resume", value: "resume.pdf" }] : [{ label: "Country", value: "United States of America" }],
              flaggedFields: [],
              hadPendingAnswerFields: false,
              needsResumeUpload: page === 1,
              resumeUploaded: page === 1,
              trace: [],
              pageTitle: tab.title,
              hostname: "acme.wd5.myworkdayjobs.com",
              pageFingerprint: `page-${page}`
            }
          };
        }
        if (message.type === "APPLE_CAREERS_GET_WORKDAY_PROGRESS_ACTION") {
          return {
            ok: true,
            found: true,
            label: page === 1 ? "Continue" : "Submit",
            actionKind: page === 1 ? "continue" : "submit"
          };
        }
        if (message.type === "APPLE_CAREERS_CLICK_WORKDAY_PROGRESS_ACTION") {
          if (page === 1) page = 2;
          return { ok: true, clicked: true };
        }
        throw new Error(`Unexpected message ${message.type}`);
      }
    };

    const profile = normalizeUserProfile({
      scanMode: "auto_apply",
      autoApplyConsent: true,
      eeoGender: "male",
      eeoRaceEthnicity: ["asian"],
      eeoVeteranStatus: "not_protected_veteran",
      eeoDisabilityStatus: "no_current_or_past"
    });
    const result = await runWorkdayAutofillWorkflow(tab, profile, buildGenericContentProfile(profile));

    assert.equal(result.ok, true);
    assert.equal(result.data.workdayPagesProcessed, 2);
    assert.equal(result.data.filledFields.length, 2);
    assert.equal(result.data.submitClicked, true);
    assert.equal(result.data.submitted, false);
    assert.equal(result.data.confirmationPending, true);
    assert.equal(
      messages.filter((message) => message.type === "APPLE_CAREERS_CLICK_WORKDAY_PROGRESS_ACTION").length,
      2
    );
  } finally {
    sandbox.chrome.tabs = originalTabs;
    sandbox.delay = originalDelay;
  }
});

asyncTest("Workday retries the same Continue exactly once after rejected visible values are repaired", async () => {
  const originalTabs = sandbox.chrome.tabs;
  const originalDelay = sandbox.delay;
  const tab = {
    id: 72,
    status: "complete",
    title: "Workday validation recovery",
    url: "https://acme.wd5.myworkdayjobs.com/en-US/apply"
  };
  const messages = [];
  let page = 1;
  let firstPageSweep = 0;
  let continueClicks = 0;

  try {
    sandbox.delay = async () => {};
    sandbox.chrome.tabs = {
      async get() {
        return tab;
      },
      async sendMessage(_tabId, message) {
        messages.push(message);
        if (message.type === "APPLE_CAREERS_RUN_GENERIC_AUTOFILL") {
          if (page === 1) firstPageSweep += 1;
          return {
            ok: true,
            data: {
              filledFields: [],
              flaggedFields: [],
              hadPendingAnswerFields: false,
              needsResumeUpload: false,
              resumeUploaded: false,
              repairedRejectedWorkdayFieldCount: page === 1 && firstPageSweep === 2 ? 1 : 0,
              trace: [],
              pageTitle: tab.title,
              hostname: "acme.wd5.myworkdayjobs.com",
              pageFingerprint: `page-${page}`
            }
          };
        }
        if (message.type === "APPLE_CAREERS_GET_WORKDAY_PROGRESS_ACTION") {
          return {
            ok: true,
            found: true,
            label: page === 1 ? "Continue" : "Submit",
            actionKind: page === 1 ? "continue" : "submit"
          };
        }
        if (message.type === "APPLE_CAREERS_CLICK_WORKDAY_PROGRESS_ACTION") {
          if (page === 1) {
            continueClicks += 1;
            if (continueClicks === 2) page = 2;
          }
          return { ok: true, clicked: true };
        }
        throw new Error(`Unexpected message ${message.type}`);
      }
    };

    const profile = normalizeUserProfile({
      scanMode: "auto_apply",
      autoApplyConsent: true,
      eeoGender: "male",
      eeoRaceEthnicity: ["asian"],
      eeoVeteranStatus: "not_protected_veteran",
      eeoDisabilityStatus: "no_current_or_past"
    });
    const result = await runWorkdayAutofillWorkflow(tab, profile, buildGenericContentProfile(profile));

    assert.equal(result.ok, true);
    assert.equal(result.data.workdayPagesProcessed, 3);
    assert.equal(continueClicks, 2);
    assert.equal(result.data.confirmationPending, true);
    assert.equal(
      messages.filter((message) => message.type === "APPLE_CAREERS_CLICK_WORKDAY_PROGRESS_ACTION").length,
      3
    );
  } finally {
    sandbox.chrome.tabs = originalTabs;
    sandbox.delay = originalDelay;
  }
});

asyncTest("workflow tabs are activated without focusing Chrome, and the recorded list tab can be restored", async () => {
  const originalTabs = sandbox.chrome.tabs;
  const calls = [];

  try {
    setScanStateForTest({ listTabId: 11, listWindowId: 7 });
    sandbox.chrome.tabs = {
      async create(options) {
        calls.push({ method: "create", tabId: 22, options });
        return { id: 22, windowId: options.windowId, url: options.url };
      },
      async update(tabId, options) {
        calls.push({ method: "update", tabId, options });
        return { id: tabId, windowId: 7 };
      }
    };
    await createActiveWorkflowTab("https://careers.tiktok.com/position/123/detail");
    await activateListTab();

    assert.equal(calls[0].method, "create");
    assert.equal(calls[0].options.active, true);
    assert.equal(calls[0].options.windowId, 7);
    assert.equal(calls[1].method, "update");
    assert.equal(calls[1].tabId, 22);
    assert.equal(calls[1].options.active, true);
    assert.equal(calls[2].method, "update");
    assert.equal(calls[2].tabId, 11);
    assert.equal(calls[2].options.active, true);
    assert.equal(calls.length, 3);
  } finally {
    sandbox.chrome.tabs = originalTabs;
  }
});

asyncTest("application workflow carries bounded validation-recovery state across content-script reloads", async () => {
  const originalTabs = sandbox.chrome.tabs;
  const originalDelay = sandbox.delay;
  const liveTab = {
    id: 31,
    status: "complete",
    title: "ByteDance application",
    url: "https://jobs.bytedance.com/en/resume/123/apply"
  };
  const messages = [];

  try {
    sandbox.delay = async () => {};
    sandbox.chrome.tabs = {
      async get() {
        return liveTab;
      },
      async update() {
        return liveTab;
      },
      async query() {
        return [liveTab];
      },
      async sendMessage(_tabId, message) {
        messages.push(message);
        if (messages.length === 1) {
          return {
            ok: true,
            data: {
              url: liveTab.url,
              title: liveTab.title,
              heading: "",
              clicked: true,
              done: false,
              steps: [
                { step: "Submit application", status: "clicked", label: "Submit" },
                {
                  step: "Check for validation errors after submitting",
                  status: "blocked",
                  label: "Current right-to-work status is required"
                }
              ],
              visibleActions: ["Submit"],
              validationRecoveryAttempted: true,
              validationRecoveryFingerprint: "custom_dropdown::current right-to-work status",
              summary: "The question agent answered one required field; retrying."
            }
          };
        }

        return {
          ok: true,
          data: {
            url: liveTab.url,
            title: liveTab.title,
            heading: "",
            clicked: false,
            done: false,
            pausedForReview: true,
            errorType: "validation_no_progress",
            steps: [],
            visibleActions: ["Submit"],
            summary: "The same required field remained unanswered."
          }
        };
      }
    };

    const result = await runApplicationWorkflow(liveTab, {
      closeOnDone: false,
      userProfile: {}
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.pausedForReview, true);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].submissionAttemptCount, 0);
    assert.equal(messages[0].validationRecoveryAttempts, 0);
    assert.equal(messages[0].previousValidationRecoveryFingerprint, "");
    assert.equal(messages[1].submissionAttemptCount, 1);
    assert.equal(messages[1].validationRecoveryAttempts, 1);
    assert.equal(
      messages[1].previousValidationRecoveryFingerprint,
      "custom_dropdown::current right-to-work status"
    );
  } finally {
    sandbox.chrome.tabs = originalTabs;
    sandbox.delay = originalDelay;
  }
});

asyncTest("tab cleanup removes only extension-owned workflow tabs", async () => {
  const originalTabs = sandbox.chrome.tabs;
  const removedTabIds = [];

  try {
    setOwnedWorkflowTabIdsForTest([22]);
    sandbox.chrome.tabs = {
      async remove(tabId) {
        removedTabIds.push(tabId);
      }
    };

    await closeOwnedWorkflowTabs();

    assert.deepEqual(removedTabIds, [22]);
    assert.equal(removedTabIds.includes(99), false, "a user-owned application tab must never be removed");
  } finally {
    setOwnedWorkflowTabIdsForTest([]);
    sandbox.chrome.tabs = originalTabs;
  }
});

test("Apple submitted job IDs match across canonical detail redirects", () => {
  assert.equal(normalizeAppleSubmittedJobId("200651307"), "200651307");
  assert.equal(normalizeAppleSubmittedJobId("200651307-0836"), "200651307");
});

asyncTest("cached Apple details survive redirected URLs and optional qualifications", async () => {
  const key = "appleSubmittedRoleDetailsCache";
  const previous = storageData[key];
  try {
    storageData[key] = {
      "200651307": {
        version: 1,
        url: "https://jobs.apple.com/en-us/details/200651307-0836/hid-algorithms-engineer",
        description: "Cached role description",
        minimumQualifications: "",
        preferredQualifications: "",
        fetchedAt: Date.now()
      }
    };
    const result = await fetchAppleSubmittedRoleDetails([{
      jobId: "200651307",
      url: "https://jobs.apple.com/en-us/details/200651307/HID-Algorithms-Engineer"
    }]);
    assert.equal(result.cachedCount, 1);
    assert.equal(result.fetchedCount, 0);
    assert.equal(result.detailsByJobId.get("200651307")?.description, "Cached role description");
  } finally {
    if (previous === undefined) delete storageData[key];
    else storageData[key] = previous;
  }
});

asyncTest("redirected Apple posting IDs pass detail extraction", async () => {
  const originalTabs = sandbox.chrome.tabs;
  try {
    sandbox.chrome.tabs = {
      sendMessage: async () => ({
        ok: true,
        data: {
          ready: true,
          jobId: "200651307-0836",
          description: "A complete Apple job description"
        }
      })
    };
    const details = await waitForAppleSubmittedRoleDetails(1, "200651307", 100);
    assert.equal(details?.jobId, "200651307-0836");
  } finally {
    sandbox.chrome.tabs = originalTabs;
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
