const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ranking = require("../lib/jobRanking.js");
const core = require("../lib/core.js");

const resume = "Built Python backend APIs and distributed task queues. Developed LLM-powered developer tooling. Bachelor of Computer Science.";
const details = { title: "Software Engineer, Agentic Developer Platform",
  description: "Build Python backend APIs for developers. Develop LLM-powered developer tooling and distributed task queues.",
  minimumQualifications: "Experience building backend services. Bachelor of Computer Science or equivalent experience.",
  minimumQualificationItems: ["Experience building backend services.", "Bachelor of Computer Science or equivalent experience."],
  preferredQualifications: "Experience with Kubernetes.", requiredExperience: [] };
const good = { responsibilities: 90, qualifications: 90, level: 90, domain: 90, confidence: "high",
  minimum_checks: [
    { id: 1, status: "met", requirement_quote: "building backend services", resume_quote: "Built Python backend APIs" },
    { id: 2, status: "met", requirement_quote: "Bachelor of Computer Science", resume_quote: "Bachelor of Computer Science" }
  ], evidence: [
    { job_quote: "Python backend APIs", resume_quote: "Python backend APIs" },
    { job_quote: "LLM-powered developer tooling", resume_quote: "LLM-powered developer tooling" }
  ], reason: "Direct backend and agentic tooling experience; required education is supported." };
const profile = core.normalizeUserProfile({ resumeProfile: resume, userYearsOfExperience: 1.5,
  llmEnabled: true, llmApiKey: "sk-test", llmModel: "gpt-4o", llmApiKeyValidationStatus: "valid",
  llmApiKeyValidatedFingerprint: core.fingerprintText("sk-test"), autoApplyConsent: true,
  eeoGender: "male", eeoRaceEthnicity: ["asian"], eeoVeteranStatus: "not_protected_veteran", eeoDisabilityStatus: "no_current_or_past" });

test("ranking supports agentic and backend work, without requiring preferred Kubernetes", () => {
  const result = ranking.evaluateRankingResult(good, details, resume);
  assert.equal(result.score, 90);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.blockers, []);
  const prompt = ranking.buildRankingPrompt(details, resume, 1.5);
  assert.match(prompt[0].content, /Agentic developer platforms/);
  assert.equal(JSON.parse(prompt[1].content).minimum_qualifications.length, 2);
});

test("generic skill overlap cannot override a missing or omitted minimum qualification", () => {
  for (const checks of [good.minimum_checks.slice(0, 1),
    [good.minimum_checks[0], { ...good.minimum_checks[1], status: "gap" }]]) {
    const result = ranking.evaluateRankingResult({ ...good, minimum_checks: checks }, details, resume);
    assert.equal(result.eligible, false);
    assert.ok(result.blockers.some((reason) => /Computer Science/.test(reason)));
  }
});

test("fabricated resume evidence, low confidence, and seniority block automatic queues", () => {
  const fabricated = { ...good, evidence: good.evidence.map((item) => ({ ...item, resume_quote: "Performed GPU silicon validation" })) };
  assert.equal(ranking.evaluateRankingResult(fabricated, details, resume).eligible, false);
  assert.equal(ranking.evaluateRankingResult({ ...good, confidence: "low" }, details, resume).eligible, false);
  assert.equal(ranking.evaluateRankingResult(good, details, resume, "Senior role exceeds candidate level").eligible, false);
  assert.throws(() => ranking.evaluateRankingResult({ ...good, level: "90" }, details, resume), /invalid/);
});

test("top N deduplicates posting aliases, excludes submitted IDs, and never pads with poor matches", () => {
  const jobs = [{ jobId: "100", score: 85, eligible: true }, { jobId: "100-0836", score: 90, eligible: true },
    { jobId: "101", score: 98, eligible: false }, { jobId: "102", score: 95, eligible: true },
    { jobId: "103", score: 91, eligible: true, queueStatus: "uncertain" }];
  assert.deepEqual(ranking.topCandidates(jobs, 1, 3).map((job) => job.jobId), ["102", "100-0836"]);
  assert.deepEqual(ranking.topCandidates(jobs, 50, 0, ["102-0836"]).map((job) => job.jobId), ["100-0836"]);
});

test("capacity counts current applications and uncertain slots, rather than the lifetime applied ledger", () => {
  const snapshot = { complete: true, updatedAt: 1000, scannedAt: 1000,
    roles: [{ jobId: "100-0836" }, { jobId: "100-9999" }, { jobId: "101" }] };
  const applications = [
    { jobId: "200", site: "apple", appliedAt: new Date(500).toISOString() },
    { jobId: "201", site: "apple", appliedAt: new Date(2000).toISOString() },
    { jobId: "202", site: "tiktok", appliedAt: new Date(2000).toISOString() },
    { jobId: "203", site: "apple" }
  ];
  const result = ranking.applicationCapacity(snapshot, applications, [{ jobId: "100" }, { jobId: "201" }, { jobId: "204" }]);
  assert.equal(result.submitted, 5);
  assert.equal(result.remaining, 45);
  assert.equal(ranking.applicationCapacity(snapshot, applications, [], ["201"]).submitted, 3,
    "a confirmed withdrawal must not be re-added from the lifetime application ledger");
  assert.equal(ranking.applicationCapacity({ ...snapshot, complete: false }).known, false);
});

test("auto-apply rejects Review, low scores, required gaps, and a missing LLM result", () => {
  const auto = { ...profile, scanMode: "auto_apply" };
  const job = { title: "Software Engineer", matches: [], llmMatch: { decision: "Likely match", score: 80,
    missingCriticalRequirements: [], yoeAssessment: "acceptable" } };
  assert.equal(core.shouldAutoApply("likely_match", job, auto), true);
  assert.equal(core.shouldAutoApply("reviewed", job, auto), false);
  assert.equal(core.shouldAutoApply("likely_match", { ...job, llmMatch: { ...job.llmMatch, score: 79 } }, auto), false);
  assert.equal(core.shouldAutoApply("likely_match", { ...job, llmMatch: { ...job.llmMatch, missingCriticalRequirements: ["GPU validation"] } }, auto), false);
  assert.equal(core.shouldAutoApply("likely_match", { ...job, llmMatch: null }, auto), false);
});

test("OpenAI 429 errors preserve the actionable provider message and retry metadata", async () => {
  const originalFetch = global.fetch;
  const originalError = console.error;
  const logs = [];
  try {
    console.error = (...args) => logs.push(args);
    global.fetch = async () => ({ ok: false, status: 429, statusText: "Too Many Requests",
      text: async () => JSON.stringify({ error: { code: "insufficient_quota", message: "Credit balance exhausted for sk-test" } }),
      headers: { get: () => "12" } });
    await assert.rejects(core.callOpenAi([], { apiKey: "sk-test", model: "gpt-4o" }), (error) => {
      assert.equal(error.httpStatus, 429);
      assert.equal(error.code, "insufficient_quota");
      assert.equal(error.retryAfterMs, 12000);
      assert.match(error.message, /Credit balance exhausted/);
      assert.ok(!error.message.includes("sk-test"));
      return true;
    });
    assert.ok(!JSON.stringify(logs).includes("sk-test"));
  } finally { global.fetch = originalFetch; console.error = originalError; }
});

function workerHarness() {
  let clock = 100000;
  const store = {};
  const calls = { scored: 0, applied: [], removed: [], pages: 0 };
  const mocks = { pages: [], activeRoles: [], live: details, workflow: { ok: true, data: { submitted: true } } };
  const sandbox = {
    ...core, CareerPeelerRanking: ranking, console: { error() {} }, URL,
    Date: class extends Date { static now() { return clock; } },
    APPLE_SUBMITTED_ROLE_REVIEWS_KEY: "reviews", APPLIED_JOBS_KEY: "applied", USER_PROFILE_KEY: "profile",
    APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY: "details", submittedRoleAnalysisRuns: new Map(),
    scanState: core.createIdleState(), currentScanActivitySteps: [],
    chrome: { storage: { local: {
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(store[key])])),
      set: async (updates) => Object.assign(store, structuredClone(updates))
    } }, tabs: {
      create: async ({ url }) => ({ id: 42, url }),
      remove: async (id) => calls.removed.push(id)
    } },
    delay: async (ms) => { clock += ms; }, waitForTabComplete: async () => {}, activateTab: async () => {},
    initializeKnownSiteScanActivity: async () => {}, saveScanState: async () => {},
    closeOwnedWorkflowTabs: async () => {}, finishKnownSiteScanRun: async () => {},
    createActiveWorkflowTab: async (url) => ({ id: 99, url }),
    waitForAppleSubmittedRoleDetails: async () => mocks.live,
    getAutoApplyReadinessError: () => null,
    sendMessageWithFallback: async (tabId, message) => {
      if (message.type === "APPLE_CAREERS_COLLECT_JOB_LINKS") return { ok: true, data: mocks.pages[calls.pages++] };
      if (message.type === "APPLE_CAREERS_GO_TO_NEXT_PAGE") return { ok: true, action: "click" };
      if (message.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES") return {
        ok: !mocks.signedOut, data: { pageCount: 1, pages: [{ roles: mocks.activeRoles }] }
      };
      if (message.type === "APPLE_CAREERS_EXTRACT_JOB") return { ok: true, data: { alreadySubmitted: false } };
      throw new Error(`Unexpected message ${message.type}`);
    },
    fetchAppleSubmittedRoleDetails: async (links) => ({ detailsByJobId: new Map(links.map((job) => [job.jobId, details])) }),
    callOpenAi: async () => { calls.scored += 1; if (mocks.error) throw mocks.error; return JSON.stringify(good); },
    runApplicationWorkflow: async (tab, options) => {
      const persisted = store.appleJobRanking;
      assert.equal(persisted.jobs[options.jobContext.jobId].queueStatus, "applying");
      assert.ok(persisted.reservations.some((role) => role.jobId === options.jobContext.jobId));
      calls.applied.push(options.jobContext.jobId);
      return mocks.workflow;
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../lib/appleRankingWorker.js"), "utf8") +
    "\nglobalThis.api = { runAppleJobRanking, runAppleJobQueue, getAppleRankingView, appleRankingProfileSignature, scoreAppleRankingPosting, queueTopAppleJobs, refreshAppleJobQueueCount };", sandbox);
  function queuedJob(jobId, score) {
    return { jobId, title: details.title, url: `https://jobs.apple.com/en-us/details/${jobId}/engineer`,
      eligible: true, score, queueStatus: "queued", profileSignature: sandbox.api.appleRankingProfileSignature(profile),
      postingSignature: core.fingerprintText(JSON.stringify(ranking.postingInput(details))) };
  }
  return { api: sandbox.api, store, calls, mocks, queuedJob };
}

test("filtered scans visit all pages, deduplicate overlaps, and reuse matching scores on the next scan", async () => {
  const h = workerHarness();
  const link = (jobId) => ({ jobId, title: details.title, url: `https://jobs.apple.com/en-us/details/${jobId}/engineer` });
  h.mocks.pages = [{ links: [link("100"), link("101")], hasNextPage: true },
    { links: [link("101"), link("102")], hasNextPage: false }];
  await h.api.runAppleJobRanking({ searchUrl: "https://jobs.apple.com/en-us/search?team=software", sourceTabId: 1 }, profile);
  assert.equal(h.calls.scored, 3);
  assert.equal(Object.values(h.store.appleJobRanking.searches)[0].complete, true);
  h.calls.pages = 0;
  await h.api.runAppleJobRanking({ searchUrl: "https://jobs.apple.com/en-us/search?team=software", sourceTabId: 1 }, profile);
  assert.equal(h.calls.scored, 3, "rescanning unchanged jobs must not use additional LLM calls");
  assert.equal(h.store.appleJobRanking.scoresReused, 3);
  const changed = await h.api.getAppleRankingView({ ...profile, resumeProfile: "Different resume content" }, 50);
  assert.equal(changed.candidates.length, 0);
  assert.equal(changed.staleCount, 3);
});

test("quota errors leave discovered jobs and completed scores available without retrying billing failures", async () => {
  const h = workerHarness();
  h.mocks.pages = [{ links: [h.queuedJob("100", 90)], hasNextPage: false }];
  h.mocks.error = Object.assign(new Error("No API credits remaining"), { httpStatus: 429, code: "insufficient_quota" });
  await h.api.runAppleJobRanking({ searchUrl: "https://jobs.apple.com/en-us/search", sourceTabId: 1 }, profile);
  assert.equal(h.calls.scored, 1);
  assert.equal(h.store.appleJobRanking.jobs["100"].eligible, false);
  assert.match(h.store.appleJobRanking.error, /credits/);
  assert.equal(Object.values(h.store.appleJobRanking.searches)[0].complete, false);
});

test("temporary rate limits have bounded retries, while long requested waits pause the scan", async () => {
  const h = workerHarness();
  h.mocks.error = Object.assign(new Error("Too many tokens"), { httpStatus: 429, code: "rate_limit_exceeded", retryAfterMs: 2500 });
  await assert.rejects(h.api.scoreAppleRankingPosting(details, profile, {}), /tokens/);
  assert.equal(h.calls.scored, 3);
  h.mocks.error.retryAfterMs = 60000;
  await assert.rejects(h.api.scoreAppleRankingPosting(details, profile, {}), /tokens/);
  assert.equal(h.calls.scored, 4, "do not retry before a long Retry-After delay has elapsed");
});

test("the scorer rejects required experience and personal exclusions before spending API credits", async () => {
  const h = workerHarness();
  const senior = await h.api.scoreAppleRankingPosting({ ...details, title: "Senior Software Engineer" }, profile, {});
  const yoe = await h.api.scoreAppleRankingPosting({ ...details, requiredExperience: [{ years: 3 }] }, profile, {});
  const excluded = await h.api.scoreAppleRankingPosting(details, { ...profile, noMatchKeywords: ["developer tooling"] }, {});
  assert.equal(senior.eligible, false);
  assert.equal(yoe.eligible, false);
  assert.equal(excluded.eligible, false);
  assert.equal(h.calls.scored, 0);
});

test("49 active submissions permits exactly one highest-ranked application, leaving the rest queued", async () => {
  const h = workerHarness();
  h.store.appleJobRanking = { jobs: { "100": h.queuedJob("100", 85), "101": h.queuedJob("101", 95) }, searches: {}, reservations: [] };
  h.mocks.activeRoles = Array.from({ length: 49 }, (_, index) => ({ jobId: String(index + 1), active: true }));
  await h.api.runAppleJobQueue({ sourceTabId: 1 }, profile);
  assert.deepEqual(h.calls.applied, ["101"]);
  assert.equal(h.store.appleJobRanking.jobs["100"].queueStatus, "queued");
  assert.equal((await h.api.getAppleRankingView(profile)).capacity.remaining, 0);
  assert.equal(h.calls.scored, 0, "applying uses saved scores rather than LLM matching again");
});

test("an uncertain outcome reserves its slot and stops before the next job", async () => {
  const h = workerHarness();
  h.store.appleJobRanking = { jobs: { "100": h.queuedJob("100", 95), "101": h.queuedJob("101", 85) }, searches: {}, reservations: [] };
  h.mocks.workflow = { ok: false, error: "Lost submission response" };
  await h.api.runAppleJobQueue({ sourceTabId: 1 }, profile);
  assert.deepEqual(h.calls.applied, ["100"]);
  assert.equal(h.store.appleJobRanking.jobs["100"].queueStatus, "uncertain");
  assert.equal(h.store.appleJobRanking.jobs["101"].queueStatus, "queued");
  assert.equal(h.store.appleJobRanking.reservations.length, 1);
});

test("a changed posting is not submitted using an old score", async () => {
  const h = workerHarness();
  h.store.appleJobRanking = { jobs: { "100": h.queuedJob("100", 95) }, searches: {}, reservations: [] };
  h.mocks.live = { ...details, minimumQualifications: "Five years of GPU validation experience." };
  await h.api.runAppleJobQueue({ sourceTabId: 1 }, profile);
  assert.equal(h.calls.applied.length, 0);
  assert.equal(h.store.appleJobRanking.jobs["100"].eligible, false);
  assert.equal(h.store.appleJobRanking.jobs["100"].queueStatus, "needs_review");
});

test("the queue requires a live count and makes no submission at 50 or after sign-out", async () => {
  for (const signedOut of [false, true]) {
    const h = workerHarness();
    h.store.appleJobRanking = { jobs: { "100": h.queuedJob("100", 95) }, searches: {}, reservations: [] };
    h.mocks.activeRoles = Array.from({ length: 50 }, (_, index) => ({ jobId: String(index + 1), active: true }));
    h.mocks.signedOut = signedOut;
    await h.api.runAppleJobQueue({ sourceTabId: 1 }, profile);
    assert.equal(h.calls.applied.length, 0);
    assert.equal(h.store.appleJobRanking.jobs["100"].queueStatus, "queued");
    if (signedOut) assert.match(h.store.appleJobRanking.error, /Sign in/);
  }
});

test("queue edits are serialized before asynchronous storage reads", async () => {
  const h = workerHarness();
  h.store.appleJobRanking = { jobs: { "100": h.queuedJob("100", 95) }, searches: {}, reservations: [] };
  const results = await Promise.all([h.api.queueTopAppleJobs(profile, 50), h.api.queueTopAppleJobs(profile, 50)]);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
});

test("refreshing the count resolves an interrupted application without applying or rescoring it", async () => {
  const h = workerHarness();
  h.store.appleJobRanking = { jobs: { "100": { ...h.queuedJob("100", 95), queueStatus: "applying" } },
    searches: {}, reservations: [{ jobId: "100" }] };
  h.mocks.activeRoles = [{ jobId: "100", active: true }];
  const result = await h.api.refreshAppleJobQueueCount({ id: 1, url: "https://jobs.apple.com/en-us/search" });
  assert.equal(result.ok, true);
  assert.equal(h.store.appleJobRanking.jobs["100"].queueStatus, "submitted");
  assert.equal(h.calls.applied.length, 0);
  assert.equal(h.calls.scored, 0);
});
