const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const backgroundPath = path.join(__dirname, "..", "background.js");
const source = fs.readFileSync(backgroundPath, "utf8");

const sandbox = {
  URL,
  console,
  chrome: {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {}
      }
    },
    runtime: {
      onMessage: {
        addListener() {}
      }
    }
  }
};

vm.runInNewContext(
  `${source}
globalThis.__backgroundTestApi = {
  applyRequiredYoeHardSkip,
  buildAnswerPrompt,
  classifyWorkflowError,
  compactResumeMatch,
  decisionFromLlmResult,
  getHardSkipTitleReason,
  getJobIdFromUrl,
  getSiteConfig,
  getSiteLabel,
  getYoeHardSkip,
  hasLlmAnswerCapability,
  incrementStatsForStatus,
  isLocalHardSkip,
  normalizeLlmDecision,
  normalizeNoMatchKeywords,
  normalizeUserProfile,
  normalizeUserYearsOfExperience,
  normalizeYoeAssessment,
  recordAppliedCheckpoint,
  shouldAutoApply,
  statusFromDecision,
  truncateText,
  getScanStateForTest: () => scanState,
  setScanStateForTest: (partial) => {
    scanState = { ...scanState, ...partial };
  }
};`,
  sandbox,
  { filename: "background.js" }
);

const {
  applyRequiredYoeHardSkip,
  buildAnswerPrompt,
  classifyWorkflowError,
  compactResumeMatch,
  decisionFromLlmResult,
  getHardSkipTitleReason,
  getJobIdFromUrl,
  getSiteConfig,
  getSiteLabel,
  getYoeHardSkip,
  hasLlmAnswerCapability,
  incrementStatsForStatus,
  isLocalHardSkip,
  normalizeLlmDecision,
  normalizeNoMatchKeywords,
  normalizeUserProfile,
  normalizeUserYearsOfExperience,
  normalizeYoeAssessment,
  recordAppliedCheckpoint,
  shouldAutoApply,
  statusFromDecision,
  truncateText,
  getScanStateForTest,
  setScanStateForTest
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

test("getSiteConfig recognizes Apple and TikTok/ByteDance hosts", () => {
  assert.equal(getSiteConfig("https://jobs.apple.com/en-us/search")?.id, "apple");
  assert.equal(getSiteConfig("https://www.apple.com/careers/us/")?.id, "apple");
  assert.equal(getSiteConfig("https://careers.tiktok.com/position/123/detail")?.id, "tiktok");
  assert.equal(getSiteConfig("https://lifeattiktok.com/search/123")?.id, "tiktok");
  assert.equal(getSiteConfig("https://joinbytedance.com/search?keyword=software+engineer")?.id, "tiktok");
  assert.equal(getSiteConfig("https://example.com"), null);
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
  assert.equal(profile.llmModel, "gpt-4o-mini");
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

test("isLocalHardSkip excludes confident skip reasons but lets soft seniority-signal skips through", () => {
  const confidentReasons = [
    "Matched your no-match keyword list: Swift.",
    "Title appears senior-level: Senior Software Engineer.",
    "Title appears to be an internship: Software Engineering Intern.",
    "A required experience sentence appears to exceed your 2 years of experience.",
    "A high years-of-experience signal (10+ years) appears to exceed your 2 years of experience.",
    "Strong domain mismatch detected: iOS app development.",
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
  assert.equal(isLocalHardSkip({ decision: "Review", reason: "Title appears senior-level: X." }), false);
});

test("shouldAutoApply requires auto_apply mode, consent, and an eligible status", () => {
  setScanStateForTest({
    userProfile: normalizeUserProfile({ scanMode: "auto_apply", autoApplyConsent: true, userYearsOfExperience: 5 })
  });

  assert.equal(shouldAutoApply("likely_match", { requiredYears: 2, matches: [] }), true);
  assert.equal(shouldAutoApply("seen", { requiredYears: 2, matches: [] }), false);
  assert.equal(shouldAutoApply("likely_match", { requiredYears: 10, matches: [] }), false);

  setScanStateForTest({
    userProfile: normalizeUserProfile({ scanMode: "scan_only", autoApplyConsent: true, userYearsOfExperience: 5 })
  });
  assert.equal(shouldAutoApply("likely_match", { requiredYears: 2, matches: [] }), false);
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

test("decisionFromLlmResult forces Likely skip when YOE is assessed too high", () => {
  assert.equal(decisionFromLlmResult({ decision: "Likely match", yoe_assessment: "too_high" }), "Likely skip");
  assert.equal(decisionFromLlmResult({ decision: "Likely match", yoe_assessment: "acceptable" }), "Likely match");
});

test("incrementStatsForStatus tallies scan stats by status", () => {
  setScanStateForTest({ stats: { applied: 0, likelyMatch: 0, applyFailed: 0 } });
  incrementStatsForStatus("applied");
  incrementStatsForStatus("likely_match");
  incrementStatsForStatus("review_apply_failed");

  const stats = getScanStateForTest().stats;
  assert.equal(stats.applied, 1);
  assert.equal(stats.likelyMatch, 1);
  assert.equal(stats.applyFailed, 1);
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
  assert.equal(userContent.question, "Why do you want to work at this company?");
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
