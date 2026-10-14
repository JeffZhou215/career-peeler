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

const event = () => ({ addListener() {}, removeListener() {} });
const jobStore = {
  get: async keys => structuredClone(readStorage(keys)),
  set: async updates => Object.assign(storageData, structuredClone(updates)),
  remove: async keys => { for (const key of [].concat(keys)) delete storageData[key]; },
  patch: async (key, value) => { storageData[key] = structuredClone(value); },
  getMetadata: async key => structuredClone(storageData[key]),
  getRecords: async (key, ids, field = null) => {
    const records = field ? storageData[key]?.[field] : storageData[key];
    return Object.fromEntries(ids.filter(id => records?.[id]).map(id => [id, structuredClone(records[id])]));
  },
  putRecords: async (key, records) => { storageData[key] = { ...storageData[key], ...structuredClone(records) }; }
};

const sandbox = {
  CareerPeelerJobStore: jobStore,
  URL,
  console,
  // background.js's real importScripts("lib/core.js") loads that file into the same global scope
  // (classic MV3 service workers support importScripts natively) -- simulate that here by
  // pre-populating the sandbox with lib/core.js's exports instead of actually loading a file.
  importScripts: (...files) => {
    for (const file of files.filter((name) => !["lib/core.js", "lib/appleJobStore.js"].includes(name))) {
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox, { filename: file });
    }
  },
  ...core,
  chrome: {
    tabs: { onActivated: event(), onUpdated: event() },
    storage: {
      session: jobStore, onChanged: event(),
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

vm.createContext(sandbox);
vm.runInContext(
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
  dispatchTrustedAppleWithdrawalClick,
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
  dispatchTrustedAppleWithdrawalClick,
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

const { test, before } = require("node:test");
const asyncTest = test;
before(async () => { await scanStateReady; });

test("getSiteConfig supports Apple and rejects retired employer hosts", () => {
  assert.equal(getSiteConfig("https://jobs.apple.com/en-us/search")?.id, "apple");
  assert.equal(getSiteConfig("https://www.apple.com/careers/us/")?.id, "apple");
  for (const url of ["https://careers.tiktok.com/position/123/detail", "https://lifeattiktok.com/search/123", "https://joinbytedance.com/search", "https://acme.wd1.myworkdayjobs.com/en-US/External/job/123", "https://example.com"]) assert.equal(getSiteConfig(url), null);
});

test("the side-panel URL gate agrees with Apple-only runtime support", () => {
  for (const url of ["https://jobs.apple.com/en-us/search", "https://jobs.apple.com/app/en-us/profile/roles"]) assert.equal(isSupportedCareersUrl(url), true);
  for (const url of ["https://joinbytedance.com/search/123", "https://lifeattiktok.com/search/123", "https://acme.myworkdayjobs.com/External", "https://example.com"]) assert.equal(isSupportedCareersUrl(url), false);
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
        url: "https://jobs.apple.com/en-us/details/200000001/ios-engineer"
      },
      { id: 4, tool: "local_match", status: "success", observation: "33%" },
      {
        id: 5,
        tool: "read_job_description",
        label: "Android Software Engineer - TikTok - Singapore",
        status: "success",
        url: "https://jobs.apple.com/en-us/details/200000002/android-engineer"
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
        url: "https://jobs.apple.com/en-us/details/200000002/android-engineer"
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

test("buildRetryableErrorLinks returns only Apple jobs, deduplicates aliases, and uses supported recovery links", () => {
  const links = buildRetryableErrorLinks([
    { jobId: "200123", title: "Newest", url: "https://jobs.apple.com/en-us/details/200123/engineer" },
    { jobId: "200123", title: "Duplicate", url: "https://jobs.apple.com/en-us/details/200123/engineer" },
    { jobId: "unknown", title: "Apple role", url: "https://jobs.apple.com/en-us/details/200124/software-engineer" },
    { jobId: "200125", url: "https://example.com/stale", manualReviewUrl: "https://jobs.apple.com/en-us/details/200125/engineer" },
    { jobId: "123", site: "tiktok", url: "https://jobs.bytedance.com/en/position/123" },
    { type: "scan_loop_failed", message: "No job URL" }
  ]);
  assert.equal(links.length, 3);
  assert.equal(links[0].title, "Newest");
  assert.equal(links[0].site, "apple");
  assert.equal(links[0].alreadyAppliedFromList, false);
  assert.equal(links[1].jobId, "200124");
  assert.equal(links[2].url, "https://jobs.apple.com/en-us/details/200125/engineer");
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
  assert.equal(getSiteLabel("https://careers.tiktok.com/position/123/detail"), "Unknown site");
  assert.equal(getSiteLabel("https://example.com"), "Unknown site");
});

test("getJobIdFromUrl extracts ids across supported path shapes", () => {
  assert.equal(
    getJobIdFromUrl("https://jobs.apple.com/en-us/details/200669112-0836/software-development-engineer"),
    "200669112-0836"
  );
  assert.equal(getJobIdFromUrl("https://jobs.apple.com/app/en-us/apply/200669112-0836"), "200669112-0836");
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
    resumeText: "Backend engineer",
    ...requiredApplicationAnswers
  });
  assert.match(getAutoApplyReadinessError(unvalidated), /valid API key/i);

  const validatedBase = normalizeUserProfile({
    ...unvalidated,
    llmApiKeyValidationStatus: "valid",
    llmApiKeyValidatedFingerprint: core.fingerprintText("sk-test")
  });
  assert.equal(getAutoApplyReadinessError(validatedBase), null);

  const withoutProfile = normalizeUserProfile({ ...validatedBase, resumeText: "", candidateProfile: {} });
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
  assert.equal(hasLlmAnswerCapability({ llmEnabled: false, llmApiKey: "k", resumeText: "r" }), false);
  assert.equal(hasLlmAnswerCapability({ llmEnabled: true, llmApiKey: "", resumeText: "r" }), false);
  assert.equal(hasLlmAnswerCapability({ llmEnabled: true, llmApiKey: "k", resumeText: "" }), false);
  assert.equal(hasLlmAnswerCapability({ llmEnabled: true, llmApiKey: "k", resumeText: "r" }), true);
});

test("buildAnswerPrompt grounds the answer in the resume profile, question, and job context", () => {
  const messages = buildAnswerPrompt(
    "Why do you want to work at this company?",
    { title: "Software Engineer", siteLabel: "Apple Careers", matchScore: { keywords: ["Swift", "iOS"] } },
    { resumeText: "5 years of backend experience." }
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
    resumeText: "5 years of backend experience."
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
    await createActiveWorkflowTab("https://jobs.apple.com/en-us/details/123/engineer");
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
    title: "Apple application",
    url: "https://jobs.apple.com/app/en-us/apply/123"
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
        if (message.type === "APPLE_CAREERS_VERIFY_WORKFLOW_IDENTITY") return { ok: true, data: { identityVerified: true, expectedJobId: "123", url: liveTab.url } };
        messages.push(message);
        if (messages.length === 1) {
          return {
            ok: true,
            data: {
              identityVerified: true, expectedJobId: "123", submissionOutcome: "rejected",
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
            identityVerified: true, expectedJobId: "123", submissionOutcome: "rejected",
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
        version: 2,
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
