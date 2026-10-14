const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ranking = require("../lib/jobRanking.js");
const core = require("../lib/core.js");
const safety = require("../lib/appleApplicationSafety.js");
const { createContentHarness } = require("./helpers/appleWorkflowHarness.cjs");

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
const resumeFileDataUrl = "data:application/pdf;base64,synthetic-fixture";
const profile = core.normalizeUserProfile({ resumeText: resume, resumeFileDataUrl,
  resumeTextFingerprint: core.fingerprintText(resumeFileDataUrl), userYearsOfExperience: 1.5,
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

function workerHarness(options = {}) {
  let clock = 100000;
  const store = options.store || {};
  const calls = { scored: 0, applied: [], removed: [], pages: 0, pageUrls: [] };
  const mocks = { pages: [], activeRoles: [], live: details, workflow: { ok: true, data: { submitted: true } } };
  const adapter = {
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(store[key])])),
    set: async updates => Object.assign(store, structuredClone(updates)),
    remove: async key => { delete store[key]; },
    patch: async (key, value) => { store[key] = structuredClone(value); },
    getRecords: async (key, ids, field = null) => {
      const records = field ? store[key]?.[field] : store[key];
      return Object.fromEntries(ids.filter(id => records?.[id]).map(id => [id, structuredClone(records[id])]));
    },
    putRecords: async (key, values) => { store[key] = { ...store[key], ...structuredClone(values) }; },
    updateMetadata: async (key, update) => { const value = update(structuredClone(store[key])); store[key] = structuredClone(value); return structuredClone(value); },
    getMetadata: async key => structuredClone(store[key])
  };
  const sandbox = {
    ...core, CareerPeelerRanking: ranking, CareerPeelerApplicationSafety: safety, CareerPeelerJobStore: adapter,
    appleWithdrawalBatchUntil: 0, console: { error() {} }, URL,
    Date: class extends Date { static now() { return clock; } },
    APPLE_SUBMITTED_ROLE_REVIEWS_KEY: "reviews", APPLIED_JOBS_KEY: "applied", USER_PROFILE_KEY: "profile",
    APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY: "details", submittedRoleAnalysisRuns: new Map(),
    scanState: core.createIdleState(), currentScanActivitySteps: [],
    chrome: { storage: { session: adapter, local: {
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(store[key])])),
      set: async (updates) => Object.assign(store, structuredClone(updates))
    } }, tabs: {
      create: async ({ url }) => ({ id: 42, url }),
      remove: async (id) => calls.removed.push(id)
    } },
    delay: async (ms) => { clock += ms; }, waitForTabComplete: async () => {}, activateTab: async () => {},
    initializeKnownSiteScanActivity: async () => {}, saveScanState: async () => {},
    closeOwnedWorkflowTabs: async () => {}, finishKnownSiteScanRun: async () => {},
    createActiveWorkflowTab: async (url) => { mocks.currentJobUrl = url; return { id: 99, url }; },
    createTaskTab: async url => { if (url.includes("/search")) { mocks.currentSearchUrl = url; calls.pageUrls.push(url); } return { id: 42, url }; }, getTaskWindowId: async () => 1,
    appliedJobLedger: {}, errorJobLedger: {}, currentScanActivityCycles: [],
    beginKnownSiteActivityCycle: async () => "test-cycle", finishKnownSiteActivityCycle: async () => {},
    waitForAppleSubmittedRoleDetails: async (_tab, jobId) => ({ jobId, url: mocks.currentJobUrl, ...mocks.live }),
    getAutoApplyReadinessError: () => null,
    sendMessageWithFallback: async (tabId, message) => {
      if (message.type === "APPLE_CAREERS_COLLECT_JOB_LINKS") {
        const page = mocks.pages[calls.pages++];
        if (!page || page.ok === false) return { ok: false };
        if (mocks.onPage) mocks.onPage(calls.pages);
        return { ok: true, data: { url: mocks.currentSearchUrl, ...page } };
      }
      if (message.type === "APPLE_CAREERS_GO_TO_NEXT_PAGE") return { ok: true, action: "click" };
      if (message.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES") return {
        ok: !mocks.signedOut, data: { pageCount: 1, pages: [{ roles: mocks.activeRoles,
          pageIndex: 1, pageCount: 1, hasNextPage: false, withdrawalConfirmationOpen: false,
          accountVerified: true, inventoryState: mocks.activeRoles.length ? "confirmed" : "confirmed_empty" }] }
      };
      if (message.type === "APPLE_CAREERS_EXTRACT_JOB") return { ok: true, data: { jobId: message.expectedJobId,
        url: mocks.currentJobUrl, identityVerified: true, canApply: true, alreadySubmitted: false, ...mocks.status } };
      if (message.type === "APPLE_CAREERS_LOCAL_MATCH_POSTING") return { ok: true, data: { score: 90 } };
      throw new Error(`Unexpected message ${message.type}`);
    },
    fetchAppleSubmittedRoleDetails: async (links) => ({ detailsByJobId: new Map(links.map((job) => [job.jobId, details])) }),
    callOpenAi: async () => { calls.scored += 1; if (mocks.error) throw mocks.error; return JSON.stringify(good); },
    runApplicationWorkflow: async (tab, options) => {
      const persisted = store.appleJobRanking;
      assert.equal(persisted.jobs[ranking.idOf(options.jobContext.jobId)].queueStatus, "applying");
      assert.ok(persisted.reservations.some((role) => role.jobId === options.jobContext.jobId));
      calls.applied.push(options.jobContext.jobId);
      return mocks.workflow;
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../lib/appleWorkflowRecovery.js"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "../lib/appleRankingWorker.js"), "utf8") +
    "\nglobalThis.api = { runAppleJobRanking, runAppleJobQueue, getAppleRankingView, appleRankingProfileSignature, scoreAppleRankingPosting, queueTopAppleJobs, refreshAppleJobQueueCount, appleAutoApplyJobs, appleRankingDiscovery, appleRankingSearchUrl };", sandbox);
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
  const changed = await h.api.getAppleRankingView({ ...profile, resumeText: "Different resume content" }, 50);
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

test("the scorer rejects seniority and required experience before spending API credits", async () => {
  const h = workerHarness();
  const senior = await h.api.scoreAppleRankingPosting({ ...details, title: "Senior Software Engineer" }, profile, {});
  const yoe = await h.api.scoreAppleRankingPosting({ ...details, requiredExperience: [{ years: 3 }] }, profile, {});
  assert.equal(senior.eligible, false);
  assert.equal(yoe.eligible, false);
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
  h.store.appleJobRanking.jobs["100"].queueStatus = "available";
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

const filterA = "https://jobs.apple.com/en-us/search?team=software";
const filterB = "https://jobs.apple.com/en-us/search?team=machine-learning";
const searchLink = jobId => ({ jobId, title: details.title, url: `https://jobs.apple.com/en-us/details/${jobId}/engineer` });
async function scanFixture(h, ids, options = {}) {
  h.calls.pages = 0;
  h.mocks.pages = [{ links: ids.map(searchLink), hasNextPage: false }];
  const run = { sourceTabId: 1, searchUrl: filterA, topN: 50, ...options };
  await h.api.runAppleJobRanking(run, profile);
  return run;
}

test("Auto Apply excludes a strong cached job absent from the latest complete scan without deleting its score or queue history", async () => {
  const h = workerHarness();
  await scanFixture(h, ["100", "101"]);
  const old = h.store.appleJobRanking.jobs["100"];
  old.score = 99;
  old.queueStatus = "queued";
  const preserved = structuredClone(old);
  await scanFixture(h, ["101"], { autoApply: true });
  assert.deepEqual(h.calls.applied, ["101"]);
  assert.deepEqual(h.store.appleJobRanking.jobs["100"], preserved);
  assert.equal(h.calls.scored, 2, "current observations can reuse scores; absent cached jobs are not rescored");
  const latest = Object.values(h.store.appleJobRanking.searches)[0];
  assert.deepEqual(latest.autoApplyJobIds, ["101"]);
  assert.equal(h.store.appleJobRanking.jobs["101"].autoQueuedFrom.scanId, latest.scanId);
  const view = await h.api.getAppleRankingView(profile);
  assert.equal(view.queued.find(job => job.jobId === "100").discoveryStatus, "historical_cache");
  assert.equal(view.queued.find(job => job.jobId === "100").filterMembership, "absent");
});

test("a cached role observed again is eligible for the new automatic scope without another LLM score", async () => {
  const h = workerHarness();
  await scanFixture(h, ["100"]);
  const firstScan = Object.values(h.store.appleJobRanking.searches)[0].scanId;
  await scanFixture(h, ["100"], { autoApply: true });
  assert.deepEqual(h.calls.applied, ["100"]);
  assert.equal(h.calls.scored, 1);
  assert.notEqual(Object.values(h.store.appleJobRanking.searches)[0].scanId, firstScan);
});

test("changed filters retain reusable assessments but Auto Apply selects only the intended filter's discoveries", async () => {
  const h = workerHarness();
  await scanFixture(h, ["100", "101"]);
  await scanFixture(h, ["101", "102"], { searchUrl: filterB });
  assert.equal(h.calls.scored, 3, "a shared role retains its assessment across filters");
  await scanFixture(h, ["101"], { searchUrl: filterB, autoApply: true });
  assert.deepEqual(h.calls.applied, ["101"]);
  assert.ok(h.store.appleJobRanking.jobs["100"]);
  assert.ok(h.store.appleJobRanking.jobs["102"]);
  const view = await h.api.getAppleRankingView(profile);
  assert.equal(view.latestSearch.url, filterB);
  assert.equal(view.candidates.find(job => job.jobId === "100").discoveryStatus, "historical_cache");
});

test("failed and cancelled partial scans keep unseen cached roles unknown and never Auto Apply", async () => {
  for (const cancelled of [false, true]) {
    const h = workerHarness();
    await scanFixture(h, ["100", "101"]);
    const run = { sourceTabId: 1, searchUrl: filterA, topN: 50, autoApply: true };
    h.calls.pages = 0;
    h.mocks.pages = [{ links: [searchLink("101")], hasNextPage: true }, { ok: false }];
    if (cancelled) h.mocks.onPage = page => { if (page === 2) run.stopRequested = true; };
    await h.api.runAppleJobRanking(run, profile);
    assert.equal(h.calls.applied.length, 0);
    const view = await h.api.getAppleRankingView(profile);
    assert.equal(view.latestSearch.complete, false);
    assert.equal(view.candidates.find(job => job.jobId === "100").discoveryStatus, "unknown");
    assert.equal(view.candidates.find(job => job.jobId === "100").filterMembership, "unknown");
    assert.equal(view.candidates.find(job => job.jobId === "101").discoveryStatus, "current_scan");
    assert.equal(h.store.appleJobRanking.jobs["100"].eligible, true, "no global deletion/closure is inferred from missing partial discoveries");
  }
});

test("a search redirect or filter drift prevents completion and automatic queue construction", async () => {
  for (const url of [filterB, "https://jobs.apple.com/app/en-us/profile/roles"]) {
    const h = workerHarness();
    const run = { sourceTabId: 1, searchUrl: filterA, topN: 50, autoApply: true };
    h.mocks.pages = [{ url, links: [searchLink("100")], hasNextPage: false }];
    await h.api.runAppleJobRanking(run, profile);
    assert.equal(h.calls.applied.length, 0);
    assert.equal(Object.values(h.store.appleJobRanking.searches)[0].complete, false);
    assert.ok(h.store.appleJobRanking.error);
  }
});

test("pagination and parameter ordering do not change the filter identity; missing terminal-page evidence fails closed", async () => {
  const h = workerHarness();
  const url = "https://jobs.apple.com/en-us/search?team=software&location=USA";
  h.mocks.pages = [{ url: "https://jobs.apple.com/en-us/search?location=USA&page=1&team=software", links: [searchLink("100")], hasNextPage: true },
    { url: "https://jobs.apple.com/en-us/search?team=software&location=USA&page=2", links: [searchLink("101")], hasNextPage: false }];
  await h.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: url }, profile);
  assert.equal(Object.values(h.store.appleJobRanking.searches)[0].complete, true);
  assert.equal(h.api.appleRankingSearchUrl(url), h.api.appleRankingSearchUrl(h.mocks.pages[1].url));
  assert.equal(h.api.appleRankingSearchUrl(url), h.api.appleRankingSearchUrl(url.replace("/en-us/search?", "/EN-US/search/?")));
  const malformed = workerHarness();
  malformed.mocks.pages = [{ links: [searchLink("100")] }];
  await malformed.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA, autoApply: true }, profile);
  assert.equal(Object.values(malformed.store.appleJobRanking.searches)[0].complete, false);
  assert.equal(malformed.calls.applied.length, 0);
});

test("a restored partial scan preserves its own observations but imports no historical same-filter membership", async () => {
  const first = workerHarness();
  await scanFixture(first, ["100", "101"]);
  first.calls.pages = 0;
  first.mocks.pages = [{ links: [searchLink("101")], hasNextPage: true }, { ok: false }];
  await first.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA }, profile);
  const interrupted = Object.values(first.store.appleJobRanking.searches)[0];
  const second = workerHarness({ store: first.store });
  second.mocks.pages = [{ links: [searchLink("102")], hasNextPage: false }];
  await second.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA, resume: true, autoApply: true, topN: 50 }, profile);
  const completed = Object.values(second.store.appleJobRanking.searches)[0];
  assert.equal(completed.scanId, interrupted.scanId);
  assert.deepEqual([...completed.discoveredJobIds].sort(), ["101", "102"]);
  assert.deepEqual([...second.calls.applied].sort(), ["101", "102"]);
  assert.ok(second.calls.pageUrls[0].includes("page=2"));
  assert.equal(first.store.appleJobRanking.jobs["100"].queueStatus, "available");
});

test("legacy restored scans with base-only discovery have unknown membership and require fresh discovery", async () => {
  const h = workerHarness();
  const searchKey = core.fingerprintText(filterA);
  h.store.appleJobRanking = { jobs: { "100": h.queuedJob("100", 99) }, searches: {
    [searchKey]: { url: filterA, complete: true, discoveredIds: ["100"], startedAt: 1,
      profileSignature: h.api.appleRankingProfileSignature(profile) }
  }, latestSearchKey: searchKey, reservations: [] };
  const view = await h.api.getAppleRankingView(profile);
  assert.equal(view.queued[0].discoveryStatus, "unknown");
  await h.api.runAppleJobQueue({ sourceTabId: 1, searchUrl: filterA, autoApply: true,
    autoJobIds: new Set(["100"]), autoScope: { searchKey, scanId: undefined } }, profile);
  assert.equal(h.calls.applied.length, 0);
  assert.match(h.store.appleJobRanking.error, /verified completed scan/);
  const legacy = h.store.appleJobRanking.searches[searchKey];
  legacy.discoveredJobIds = ["100"];
  legacy.autoApplyJobIds = ["100"];
  h.store.appleJobRanking.jobs["100"].autoQueuedFrom = { searchKey, scanId: undefined };
  assert.equal((await h.api.getAppleRankingView(profile)).queued[0].discoveryStatus, "unknown");
  assert.throws(() => h.api.appleAutoApplyJobs(h.store.appleJobRanking, { searchUrl: filterA,
    autoJobIds: new Set(["100"]), autoScope: { searchKey, scanId: undefined } }, h.api.appleRankingProfileSignature(profile)), /verified completed scan/);
  h.store.appleJobRanking.searches[searchKey].complete = false;
  h.store.appleJobRanking.searches[searchKey].pageIndex = 9;
  await scanFixture(h, ["101"], { resume: true });
  assert.equal(h.calls.pageUrls.at(-1), filterA, "legacy resume reuses caches while rediscovering membership from page one");
  assert.deepEqual(Object.values(h.store.appleJobRanking.searches)[0].discoveredJobIds, ["101"]);
});

test("duplicate exact job IDs across pages and scans yield one observation and one automatic application", async () => {
  const h = workerHarness();
  await scanFixture(h, ["100", "101"]);
  h.calls.pages = 0;
  h.mocks.pages = [{ links: [searchLink("100"), searchLink("100")], hasNextPage: true },
    { links: [searchLink("100"), searchLink("101")], hasNextPage: false }];
  await h.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA, autoApply: true, topN: 50 }, profile);
  const search = Object.values(h.store.appleJobRanking.searches)[0];
  assert.deepEqual([...search.discoveredJobIds].sort(), ["100", "101"]);
  assert.equal(search.jobsRead, 2);
  assert.deepEqual([...h.calls.applied].sort(), ["100", "101"]);
  assert.equal(h.calls.scored, 2);
});

test("changing a job suffix cannot reuse the previous identity or inherit its queued permission", async () => {
  const h = workerHarness();
  await scanFixture(h, ["200123456-0836"]);
  h.store.appleJobRanking.jobs["200123456"].queueStatus = "queued";
  await scanFixture(h, ["200123456-9999"], { autoApply: true });
  assert.equal(h.calls.scored, 2);
  assert.deepEqual(h.calls.applied, ["200123456-9999"]);
  assert.deepEqual(Object.values(h.store.appleJobRanking.searches)[0].discoveredJobIds, ["200123456-9999"]);
});

test("manual historical selection remains supported and applies only explicitly selected roles after live verification", async () => {
  const h = workerHarness();
  await scanFixture(h, ["100", "101"]);
  await scanFixture(h, ["101"]);
  const queued = await h.api.queueTopAppleJobs(profile, 50, ["100"]);
  assert.equal(queued.ok, true);
  assert.equal(queued.count, 1);
  const selected = new Set(["100"]);
  await h.api.runAppleJobQueue({ sourceTabId: 1, selectedJobIds: selected }, profile);
  assert.deepEqual(h.calls.applied, ["100"]);
  assert.equal(h.store.appleJobRanking.jobs["101"].queueStatus, "available");
});

test("automatic queue reconstruction after worker restart requires the current persisted scan identity and exact membership", async () => {
  const first = workerHarness();
  await scanFixture(first, ["100", "101"]);
  const searchKey = first.store.appleJobRanking.latestSearchKey;
  const oldId = first.store.appleJobRanking.searches[searchKey].scanId;
  await scanFixture(first, ["101"]);
  for (const job of Object.values(first.store.appleJobRanking.jobs)) job.queueStatus = "queued";
  const currentId = first.store.appleJobRanking.searches[searchKey].scanId;
  // Simulate termination after the selected automatic plan commits, before the
  // workflow owner is claimed. Loading this state never starts a runner itself.
  first.store.appleJobRanking.searches[searchKey].autoApplyJobIds = ["101"];
  first.store.appleJobRanking.jobs["101"].autoQueuedFrom = { searchKey, scanId: currentId };
  const restored = workerHarness({ store: first.store });
  await restored.api.getAppleRankingView(profile);
  assert.equal(restored.calls.applied.length, 0);
  await restored.api.runAppleJobQueue({ sourceTabId: 1, searchUrl: filterA, autoApply: true,
    autoJobIds: new Set(["100", "101"]), autoScope: { searchKey, scanId: oldId } }, profile);
  assert.equal(restored.calls.applied.length, 0);
  await restored.api.runAppleJobQueue({ sourceTabId: 1, searchUrl: filterA, autoApply: true,
    autoJobIds: new Set(["100", "101"]), autoScope: { searchKey, scanId: currentId } }, profile);
  assert.deepEqual(restored.calls.applied, ["101"]);
  assert.equal(first.store.appleJobRanking.jobs["100"].queueStatus, "queued");
});

test("missing automatic scope cannot fall back to applying the entire saved queue", async () => {
  const h = workerHarness();
  h.store.appleJobRanking = { jobs: { "100": h.queuedJob("100", 95) }, searches: {}, reservations: [] };
  await h.api.runAppleJobQueue({ sourceTabId: 1, autoApply: true }, profile);
  assert.equal(h.calls.applied.length, 0);
  assert.match(h.store.appleJobRanking.error, /scope/);
});

test("live identity mismatches and unavailable apply actions stop before the application workflow", async () => {
  for (const problem of ["posting_id", "status_id", "unavailable"]) {
    const h = workerHarness();
    h.store.appleJobRanking = { jobs: { "100": h.queuedJob("100", 95) }, searches: {}, reservations: [] };
    if (problem === "posting_id") h.mocks.live = { ...details, jobId: "101", url: searchLink("101").url };
    if (problem === "status_id") h.mocks.status = { jobId: "101", url: searchLink("101").url };
    if (problem === "unavailable") h.mocks.status = { canApply: false };
    await h.api.runAppleJobQueue({ sourceTabId: 1, selectedJobIds: new Set(["100"]) }, profile);
    assert.equal(h.calls.applied.length, 0);
    assert.equal(h.store.appleJobRanking.jobs["100"].queueStatus, "needs_review");
    assert.equal(h.store.appleJobRanking.reservations.length, 0);
  }
});

test("live applicability probe is read-only and distinguishes enabled, unavailable, submitted, and changed identity", async () => {
  for (const scenario of ["enabled", "disabled", "unavailable", "submitted", "changed", "session"]) {
    const content = createContentHarness();
    content.window.location = new URL(searchLink("200123456-0836").url);
    content.getSessionRequiredSignal = () => scenario === "session" ? "Session expired" : null;
    content.getSubmittedSignal = () => scenario === "submitted" ? { text: "Submitted" } : null;
    content.getAlreadyAppliedSignal = () => null;
    let clicks = 0;
    content.waitForJobSpecificApplyAction = async () => {
      if (scenario === "changed") content.window.location = new URL(searchLink("200987654-0836").url);
      return scenario === "unavailable" ? null : { disabled: scenario === "disabled", getAttribute: () => null, click() { clicks++; } };
    };
    if (scenario === "changed") await assert.rejects(content.readAppleJobApplicability("200123456-0836"), /job identity/i);
    else {
      const result = await content.readAppleJobApplicability("200123456-0836");
      assert.equal(result.canApply, scenario === "enabled");
      assert.equal(result.alreadySubmitted, scenario === "submitted");
    }
    assert.equal(clicks, 0);
  }
});

test("a newer incomplete filter cannot authorize an older completed automatic plan", async () => {
  const h = workerHarness();
  await scanFixture(h, ["100"]);
  const searchKey = h.store.appleJobRanking.latestSearchKey;
  const scanId = h.store.appleJobRanking.searches[searchKey].scanId;
  h.store.appleJobRanking.searches[searchKey].autoApplyJobIds = ["100"];
  h.store.appleJobRanking.jobs["100"].queueStatus = "queued";
  h.store.appleJobRanking.jobs["100"].autoQueuedFrom = { searchKey, scanId };
  h.mocks.error = new Error("Synthetic scan failure");
  await scanFixture(h, ["101"], { searchUrl: filterB });
  const restored = workerHarness({ store: h.store });
  await restored.api.runAppleJobQueue({ sourceTabId: 1, searchUrl: filterA, autoApply: true,
    autoJobIds: new Set(["100"]), autoScope: { searchKey, scanId } }, profile);
  assert.equal(restored.calls.applied.length, 0);
  const view = await restored.api.getAppleRankingView(profile);
  assert.equal(view.latestSearch.complete, false);
  assert.equal(view.queued.find(job => job.jobId === "100").filterMembership, "unknown");
});

test("a valid automatic plan still cannot bypass an unresolved workflow recovery gate", async () => {
  const h = workerHarness();
  await scanFixture(h, ["100"]);
  const searchKey = h.store.appleJobRanking.latestSearchKey;
  const scanId = h.store.appleJobRanking.searches[searchKey].scanId;
  h.store.appleJobRanking.searches[searchKey].autoApplyJobIds = ["100"];
  h.store.appleJobRanking.jobs["100"].queueStatus = "queued";
  h.store.appleJobRanking.jobs["100"].autoQueuedFrom = { searchKey, scanId };
  const pending = { id: "interrupted-owner", status: "paused", reconciliationRequired: true, jobs: {} };
  h.store.appleApplicationWorkflow = structuredClone(pending);
  await h.api.runAppleJobQueue({ sourceTabId: 1, searchUrl: filterA, autoApply: true,
    autoJobIds: new Set(["100"]), autoScope: { searchKey, scanId } }, profile);
  assert.equal(h.calls.applied.length, 0);
  assert.deepEqual(h.store.appleApplicationWorkflow, pending);
  assert.match(h.store.appleJobRanking.error, /Sync Submissions/);
});

test("expired authentication in the applicability probe pauses the queue before another job", async () => {
  const h = workerHarness();
  h.store.appleJobRanking = { jobs: { "100": h.queuedJob("100", 95), "101": h.queuedJob("101", 85) }, searches: {}, reservations: [] };
  h.mocks.status = { canApply: false, errorType: "session_or_login_required" };
  await h.api.runAppleJobQueue({ sourceTabId: 1, selectedJobIds: new Set(["100", "101"]) }, profile);
  assert.equal(h.calls.applied.length, 0);
  assert.equal(h.store.appleJobRanking.jobs["101"].queueStatus, "queued");
  assert.match(h.store.appleJobRanking.error, /Sign in/);
});
