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
  let intervalId = 0;
  const intervals = new Map();
  const store = options.store || {};
  const calls = { scored: 0, applied: [], removed: [], pages: 0, pageUrls: [], capacityReads: [], capacityTabs: [],
    collected: [], next: [], updated: [], workerPulses: 0, intervalsStarted: [], intervalsCleared: [] };
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
  const setSearchUrl = (url) => {
    mocks.currentSearchUrl = url;
    mocks.currentSearchPage = Number(new URL(url).searchParams.get("page") || 1);
  };
  const searchMessage = async (tabId, message) => {
    if (message.type === "APPLE_CAREERS_COLLECT_JOB_LINKS") {
      calls.pages++;
      calls.collected.push(structuredClone(message));
      assert.equal(message.verifySearchPagination, true, "every ranking read verifies actual pagination");
      assert.equal(message.expectedSearchUrl, sandbox.api.appleRankingSearchUrl(message.expectedSearchUrl));
      const page = mocks.pages[(mocks.currentSearchPage || 1) - 1];
      if (mocks.onPage) mocks.onPage(mocks.currentSearchPage, message);
      if (mocks.collect) return mocks.collect(tabId, message, page);
      if (!page || page.ok === false) return { ok: false, error: page?.error || "Synthetic search page could not be read." };
      if (message.expectedPage !== mocks.currentSearchPage) return { ok: false,
        error: `Expected search page ${message.expectedPage}, but Apple is still on page ${mocks.currentSearchPage}.` };
      return { ok: true, data: { url: mocks.currentSearchUrl, paginationVerified: true,
        currentPage: mocks.currentSearchPage, pageCount: mocks.pages.length,
        hasNextPage: mocks.currentSearchPage < mocks.pages.length, ...page } };
    }
    if (message.type === "APPLE_CAREERS_GO_TO_NEXT_PAGE") {
      calls.next.push(structuredClone(message));
      assert.equal(message.expectedFromPage, mocks.currentSearchPage, "next-page requests bind the original page");
      assert.equal(message.expectedPage, message.expectedFromPage + 1);
      if (mocks.next) return mocks.next(tabId, message);
      const nextUrl = new URL(mocks.currentSearchUrl);
      nextUrl.searchParams.set("page", String(message.expectedPage));
      setSearchUrl(nextUrl.href);
      return { ok: true, action: "click" };
    }
    throw new Error(`Unexpected direct message ${message.type}`);
  };
  const sandbox = {
    ...core, CareerPeelerRanking: ranking, CareerPeelerApplicationSafety: safety, CareerPeelerJobStore: adapter,
    console: { error() {} }, URL,
    setInterval: (callback, interval) => {
      const id = ++intervalId;
      intervals.set(id, { callback, interval, nextAt: clock + interval });
      calls.intervalsStarted.push(interval);
      return id;
    },
    clearInterval: id => { intervals.delete(id); calls.intervalsCleared.push(id); },
    Date: class extends Date { static now() { return clock; } },
    APPLE_SUBMITTED_ROLE_REVIEWS_KEY: "reviews", APPLIED_JOBS_KEY: "applied", USER_PROFILE_KEY: "profile",
    APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY: "details", submittedRoleAnalysisRuns: new Map(),
    scanState: core.createIdleState(), currentScanActivitySteps: [],
    chrome: { runtime: { getPlatformInfo: async () => { calls.workerPulses++; return { os: "mac", arch: "arm64" }; } },
      storage: { session: adapter, local: {
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(store[key])])),
      set: async (updates) => Object.assign(store, structuredClone(updates))
    } }, tabs: {
      onActivated: { addListener() {} }, onUpdated: { addListener() {} },
      query: async () => mocks.capacityTabs || [],
      create: async ({ url }) => ({ id: 42, url }),
      get: async (id) => ({ id, url: mocks.currentSearchUrl, windowId: 1, status: "complete" }),
      update: async (id, updates) => {
        calls.updated.push({ id, ...structuredClone(updates) });
        if (mocks.update) return mocks.update(id, updates);
        if (updates.url) setSearchUrl(updates.url);
        return { id, url: mocks.currentSearchUrl, windowId: 1, status: "complete" };
      },
      sendMessage: searchMessage,
      remove: async (id) => calls.removed.push(id)
    } },
    delay: async (ms) => { clock += ms; for (const timer of intervals.values()) {
      while (clock >= timer.nextAt) { timer.nextAt += timer.interval; await timer.callback(); }
    } }, waitForTabComplete: async () => {}, activateTab: async () => {},
    initializeKnownSiteScanActivity: async () => {}, saveScanState: async () => {},
    closeOwnedWorkflowTabs: async () => {}, finishKnownSiteScanRun: async () => {},
    createActiveWorkflowTab: async (url) => { mocks.currentJobUrl = url; return { id: 99, url }; },
    createTaskTab: async url => { if (url.includes("/search")) { setSearchUrl(url); calls.pageUrls.push(url); } return { id: 42, url }; }, getTaskWindowId: async () => 1,
    appliedJobLedger: {}, errorJobLedger: {}, currentScanActivityCycles: [],
    beginKnownSiteActivityCycle: async () => "test-cycle", finishKnownSiteActivityCycle: async () => {},
    waitForAppleSubmittedRoleDetails: async (_tab, jobId) => ({ jobId, url: mocks.currentJobUrl, ...mocks.live }),
    getAutoApplyReadinessError: () => null,
    sendMessageWithFallback: async (tabId, message) => {
      if (message.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE") return { ok: true, data: {
        accountVerified: true, withdrawalConfirmationOpen: false, inventoryState: "confirmed",
        pageIndex: 1, pageCount: 1, roles: [{ jobId: "123", active: true }]
      } };
      if (message.type === "APPLE_CAREERS_COLLECT_JOB_LINKS") {
        return searchMessage(tabId, message);
      }
      if (message.type === "APPLE_CAREERS_GO_TO_NEXT_PAGE") throw new Error("Mutating pagination must not use generic message replay.");
      if (message.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES") {
        calls.capacityReads.push({ tabId, restoreOriginalPage: message.restoreOriginalPage });
        return {
          ok: !mocks.signedOut, data: { pageCount: 1, pages: [{ roles: mocks.activeRoles,
            pageIndex: 1, pageCount: 1, hasNextPage: false, withdrawalConfirmationOpen: false,
            accountVerified: true, inventoryState: mocks.activeRoles.length ? "confirmed" : "confirmed_empty" }] }
        };
      }
      if (message.type === "APPLE_CAREERS_EXTRACT_JOB") return { ok: true, data: { jobId: message.expectedJobId,
        url: mocks.currentJobUrl, identityVerified: true, canApply: true, alreadySubmitted: false, ...mocks.status } };
      if (message.type === "APPLE_CAREERS_LOCAL_MATCH_POSTING") return { ok: true, data: { score: 90 } };
      throw new Error(`Unexpected message ${message.type}`);
    },
    fetchAppleSubmittedRoleDetails: async (links) => {
      if (mocks.onDetails) mocks.onDetails(links);
      return { detailsByJobId: new Map(links.map((job) => [job.jobId, details])) };
    },
    callOpenAi: async () => { calls.scored += 1; if (mocks.onScore) mocks.onScore(calls.scored); if (mocks.error) throw mocks.error; return JSON.stringify(good); },
    runApplicationWorkflow: async (tab, options) => {
      assert.ok(calls.capacityReads.length, "every application requires a fresh full inventory read");
      assert.equal(store.appleJobRanking.capacitySnapshot.complete, true);
      const persisted = store.appleJobRanking;
      assert.equal(persisted.jobs[ranking.idOf(options.jobContext.jobId)].queueStatus, "applying");
      assert.ok(persisted.reservations.some((role) => role.jobId === options.jobContext.jobId));
      calls.applied.push(options.jobContext.jobId);
      if (mocks.onApplied) await mocks.onApplied(options.jobContext, options);
      return mocks.workflow;
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../lib/appleWorkflowRecovery.js"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "../lib/appleWithdrawalRecovery.js"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "../lib/appleRankingWorker.js"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "../lib/appleSubmissionSync.js"), "utf8") +
    "\nglobalThis.api = { startAppleJobRanking, runAppleJobRanking, runAppleJobQueue, getAppleRankingView, appleRankingProfileSignature, scoreAppleRankingPosting, queueTopAppleJobs, refreshAppleJobQueueCount, appleAutoApplyJobs, appleRankingDiscovery, appleRankingSearchUrl };", sandbox);
  function queuedJob(jobId, score) {
    return { jobId, title: details.title, url: `https://jobs.apple.com/en-us/details/${jobId}/engineer`,
      eligible: true, score, queueStatus: "queued", profileSignature: sandbox.api.appleRankingProfileSignature(profile),
      postingSignature: core.fingerprintText(JSON.stringify(ranking.postingInput(details))) };
  }
  return { api: sandbox.api, store, calls, mocks, queuedJob, sandbox, setSearchUrl };
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

test("confirmed submissions stay confirmed when subsequent journal or ranking bookkeeping fails", async () => {
  for (const boundary of ["journal", "ranking"]) {
    const h = workerHarness();
    h.store.appleJobRanking = { jobs: { "100": h.queuedJob("100", 95), "101": h.queuedJob("101", 85) },
      searches: {}, reservations: [] };
    let confirmed = false;
    let failed = false;
    const adapter = h.sandbox.CareerPeelerJobStore;
    const operation = boundary === "journal" ? "updateMetadata" : "patch";
    const original = adapter[operation];
    h.mocks.onApplied = async (job, options) => {
      // The real workflow durably checkpoints Apple's confirmation before returning.
      await adapter.updateMetadata("appleApplicationWorkflow", journal => {
        assert.equal(journal.id, options.workflowSessionId);
        journal.jobs[job.jobId].state = "submitted";
        journal.jobs[job.jobId].submissionOutcome = "confirmed";
        return journal;
      });
      confirmed = true;
    };
    adapter[operation] = async (...args) => {
      if (confirmed && !failed && args[0] === (boundary === "journal" ? "appleApplicationWorkflow" : "appleJobRanking")) {
        failed = true;
        throw new Error(`Synthetic ${boundary} bookkeeping write failed after confirmed submission.`);
      }
      return original(...args);
    };
    await h.api.runAppleJobQueue({ sourceTabId: 1, selectedJobIds: new Set(["100", "101"]) }, profile);
    assert.equal(failed, true, `${boundary} failure must occur after the application returned confirmed`);
    assert.deepEqual(h.calls.applied, ["100"], "bookkeeping failure pauses before another application");
    const state = h.store.appleJobRanking;
    assert.equal(state.jobs["100"].queueStatus, "submitted", "known confirmation cannot become uncertain");
    assert.equal(state.jobs["101"].queueStatus, "queued");
    assert.ok(state.reservations.some(item => item.jobId === "100"), "confirmed application still consumes its capacity slot");
    assert.equal(state.applicationFailures["100"].errorType, "submission_bookkeeping_failed");
    assert.equal(state.applicationFailures["100"].submissionOutcomeUnknown, false);
    assert.equal(state.applicationFailures["100"].status, "submitted");
    assert.equal(h.store.appleApplicationWorkflow.jobs["100"].state, "submitted");
    assert.equal(state.lastBatchSummary.submitted, 1);
    assert.equal(state.phase, "Application queue paused");
    assert.match(state.error, /bookkeeping|confirmed/i);
    assert.equal((await h.api.getAppleRankingView(profile)).capacity.submitted, 1);
    assert.equal((await h.api.getAppleRankingView(profile)).capacity.remaining, 49);
    assert.deepEqual(h.calls.intervalsStarted, [20000]);
    assert.equal(h.calls.intervalsCleared.length, 1, "worker activity ends when the batch pauses");
    const pulses = h.calls.workerPulses;
    await h.sandbox.delay(60000);
    assert.equal(h.calls.workerPulses, pulses, "no application worker activity remains after the batch exits");
  }
});

test("a multi-job selected queue keeps worker activity scoped to the active batch and releases it after completion", async () => {
  const h = workerHarness();
  h.store.appleJobRanking = { jobs: { "100": h.queuedJob("100", 95), "101": h.queuedJob("101", 85) },
    searches: {}, reservations: [] };
  h.mocks.onApplied = async () => { await h.sandbox.delay(45000); };
  await h.api.runAppleJobQueue({ sourceTabId: 1, selectedJobIds: new Set(["100", "101"]) }, profile);
  assert.deepEqual(h.calls.applied, ["100", "101"]);
  assert.equal(h.store.appleJobRanking.lastBatchSummary.submitted, 2);
  assert.deepEqual(h.calls.intervalsStarted, [20000]);
  assert.ok(h.calls.workerPulses >= 5, "long active Apple replies retain extension API activity");
  assert.equal(h.calls.intervalsCleared.length, 1);
  const pulses = h.calls.workerPulses;
  await h.sandbox.delay(60000);
  assert.equal(h.calls.workerPulses, pulses, "completed queues do not leave an idle worker timer");
  assert.equal((await h.api.getAppleRankingView(profile)).capacity.remaining, 48);
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
  malformed.mocks.pages = [{ links: [searchLink("100")], paginationVerified: false }];
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
  second.mocks.pages = [{ links: [searchLink("101")], hasNextPage: true },
    { links: [searchLink("102")], hasNextPage: false }];
  await second.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA, resume: true, autoApply: true, topN: 50 }, profile);
  const completed = Object.values(second.store.appleJobRanking.searches)[0];
  assert.equal(completed.scanId, interrupted.scanId);
  assert.deepEqual([...completed.discoveredJobIds].sort(), ["101", "102"]);
  assert.deepEqual([...second.calls.applied].sort(), ["101", "102"]);
  assert.ok(second.calls.pageUrls[0].includes("page=2"));
  assert.equal(first.store.appleJobRanking.jobs["100"].queueStatus, "available");
});

test("verified search scans continue beyond ten pages and bind every navigation to the observed ordinal", async () => {
  const h = workerHarness();
  h.mocks.pages = Array.from({ length: 15 }, (_, index) => ({ links: [searchLink(String(7000 + index))] }));
  await h.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA }, profile);
  const search = Object.values(h.store.appleJobRanking.searches)[0];
  assert.equal(search.complete, true);
  assert.equal(search.pagesRead, 15);
  assert.equal(h.calls.scored, 15);
  assert.equal(h.calls.next.length, 14);
  assert.deepEqual(h.calls.next.map(message => message.expectedFromPage), Array.from({ length: 14 }, (_, index) => index + 1));
  assert.ok(h.calls.next.every(message => message.expectedSearchUrl === filterA && typeof message.previousPageSignature === "string"));
  assert.deepEqual(h.calls.collected.map(message => message.expectedPage), Array.from({ length: 15 }, (_, index) => index + 1));
});

test("a timed-out next-page response reconciles an already reached target without replaying navigation", async () => {
  const h = workerHarness();
  h.mocks.pages = [{ links: [searchLink("100")] }, { links: [searchLink("101")] }];
  h.mocks.next = async (_tabId, message) => {
    const url = new URL(h.mocks.currentSearchUrl);
    url.searchParams.set("page", String(message.expectedPage));
    h.setSearchUrl(url.href);
    throw new Error("Next-page response timed out after the click.");
  };
  await h.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA }, profile);
  assert.equal(Object.values(h.store.appleJobRanking.searches)[0].complete, true);
  assert.equal(h.calls.next.length, 1, "the potentially executed Next action must not be replayed");
  assert.equal(h.calls.updated.length, 0, "a verified target needs no fallback navigation");
  assert.equal(h.calls.scored, 2);
});

test("a next-page timeout on the original page uses bounded owned-tab navigation and verifies the target", async () => {
  const h = workerHarness();
  h.mocks.pages = [{ links: [searchLink("100")] }, { links: [searchLink("101")] }];
  h.mocks.next = async () => { throw new Error("Next-page request timed out before a result was known."); };
  await h.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA }, profile);
  assert.equal(Object.values(h.store.appleJobRanking.searches)[0].complete, true);
  assert.equal(h.calls.next.length, 1);
  assert.equal(h.calls.updated.length, 1);
  assert.ok(h.calls.updated.every(update => update.id === 42 && new URL(update.url).searchParams.get("page") === "2"));
  assert.ok(h.calls.collected.some(message => message.expectedPage === 2));
  assert.equal(h.calls.scored, 2);
});

test("pagination retry exhaustion retains its real failure reason and never starts Auto Apply", async () => {
  const h = workerHarness();
  h.mocks.pages = [{ links: [searchLink("100")] }, { links: [searchLink("101")] }];
  h.mocks.next = async () => ({ ok: false, error: "Apple Next control did not become ready." });
  h.mocks.update = async () => { throw new Error("Synthetic navigation timed out."); };
  await h.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA, autoApply: true }, profile);
  const search = Object.values(h.store.appleJobRanking.searches)[0];
  assert.equal(search.complete, false);
  assert.equal(search.pagesRead, 1);
  assert.match(h.store.appleJobRanking.error, /Apple Next control did not become ready/);
  assert.match(h.store.appleJobRanking.error, /Synthetic navigation timed out/);
  assert.equal(h.calls.updated.length, 2);
  assert.equal(h.calls.next.length, 1);
  assert.deepEqual(h.calls.applied, []);
  assert.equal(h.calls.capacityReads.length, 0);
  assert.equal(h.store.appleJobRanking.jobs["100"].score, 90);
});

test("wrong page ordinals or a changing page count cannot certify a complete scan", async () => {
  for (const invalid of [{ currentPage: 1 }, { pageCount: 3 }]) {
    const h = workerHarness();
    h.mocks.pages = [{ links: [searchLink("100")] }, { links: [searchLink("101")], ...invalid }];
    await h.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA, autoApply: true }, profile);
    assert.equal(Object.values(h.store.appleJobRanking.searches)[0].complete, false);
    assert.ok(h.store.appleJobRanking.error);
    assert.deepEqual(h.calls.applied, []);
    assert.equal(h.calls.capacityReads.length, 0);
  }
});

test("resume uses the last completed page rather than a prematurely advanced pageIndex", async () => {
  const first = workerHarness();
  first.mocks.pages = [{ links: [searchLink("100")] }, { ok: false, error: "Page two inventory read failed." }];
  await first.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA }, profile);
  const search = Object.values(first.store.appleJobRanking.searches)[0];
  assert.equal(search.pagesRead, 1);
  search.pageIndex = 8; // Simulate an older checkpoint that counted navigation as completed processing.
  const restored = workerHarness({ store: first.store });
  restored.mocks.pages = [{ links: [searchLink("100")] }, { links: [searchLink("101")] }];
  await restored.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA, resume: true }, profile);
  assert.equal(new URL(restored.calls.pageUrls[0]).searchParams.get("page"), "2");
  assert.equal(restored.calls.scored, 1);
  assert.equal(Object.values(restored.store.appleJobRanking.searches)[0].complete, true);
});

test("Resume Scan rejects a different filter or changed profile instead of silently starting another scan", async () => {
  for (const changed of ["filter", "profile"]) {
    const h = workerHarness();
    const searchKey = core.fingerprintText(filterA);
    const saved = { url: filterA, scanId: "saved-partial-scan", pagesRead: 13, pageIndex: 13,
      complete: false, discoveredJobIds: ["100"], profileSignature: h.api.appleRankingProfileSignature(profile), startedAt: 1 };
    h.store.appleJobRanking = { jobs: {}, searches: { [searchKey]: saved }, latestSearchKey: searchKey, reservations: [] };
    const result = await h.api.startAppleJobRanking({ id: 1, url: changed === "filter" ? filterB : filterA },
      changed === "profile" ? { ...profile, resumeText: "Changed resume content" } : profile, { resume: true });
    assert.equal(result.ok, false);
    assert.match(result.error, changed === "filter" ? /last interrupted filter/ : /resume or matching settings changed/);
    assert.equal(h.calls.pageUrls.length, 0);
    assert.equal(h.calls.next.length, 0);
    assert.deepEqual(h.store.appleJobRanking.searches[searchKey], saved);
  }
});

test("resume rereads an interrupted page and processes discovered jobs without a completed score", async () => {
  const first = workerHarness();
  const run = { sourceTabId: 1, searchUrl: filterA };
  first.mocks.pages = [{ links: [searchLink("100"), searchLink("101")] }];
  first.mocks.onDetails = links => { if (links[0].jobId === "101") run.stopRequested = true; };
  await first.api.runAppleJobRanking(run, profile);
  const interrupted = Object.values(first.store.appleJobRanking.searches)[0];
  assert.equal(interrupted.pagesRead, 0);
  assert.deepEqual([...interrupted.discoveredJobIds], ["100", "101"]);
  assert.deepEqual([...interrupted.processedJobIds], ["100"]);
  assert.equal(first.store.appleJobRanking.jobs["101"].score, null);
  const restored = workerHarness({ store: first.store });
  restored.mocks.pages = [{ links: [searchLink("100"), searchLink("101")] }];
  await restored.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA, resume: true }, profile);
  const completed = Object.values(restored.store.appleJobRanking.searches)[0];
  assert.equal(new URL(restored.calls.pageUrls[0]).searchParams.get("page") || "1", "1");
  assert.equal(restored.calls.scored, 1, "only the unprocessed job should require matching");
  assert.equal(restored.store.appleJobRanking.scoresReused, 0, "the completed job is skipped, not reprocessed");
  assert.deepEqual([...completed.processedJobIds], ["100", "101"]);
  assert.equal(completed.complete, true);
});

test("pagination rejects exact filter drift even after the first page completed", async () => {
  const h = workerHarness();
  const filtered = "https://jobs.apple.com/en-us/search?team=software&location=USA";
  h.mocks.pages = [{ links: [searchLink("100")] }, { url: "https://jobs.apple.com/en-us/search?team=software&location=CAN&page=2",
    links: [searchLink("101")] }];
  await h.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filtered, autoApply: true }, profile);
  assert.equal(Object.values(h.store.appleJobRanking.searches)[0].complete, false);
  assert.equal(h.calls.scored, 1);
  assert.equal(h.calls.applied.length, 0);
  assert.ok(h.store.appleJobRanking.error);
});

test("nonretryable authentication failures during Next stop without recovery navigation or Auto Apply", async () => {
  const h = workerHarness();
  h.mocks.pages = [{ links: [searchLink("100")] }, { links: [searchLink("101")] }];
  h.mocks.next = async () => ({ ok: false, error: "Apple requires sign-in before continuing.",
    data: { errorType: "search_authentication_required", retryable: false } });
  await h.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA, autoApply: true }, profile);
  assert.equal(Object.values(h.store.appleJobRanking.searches)[0].complete, false);
  assert.equal(h.calls.next.length, 1);
  assert.equal(h.calls.updated.length, 0);
  assert.equal(h.calls.capacityReads.length, 0);
  assert.deepEqual(h.calls.applied, []);
  assert.equal(h.store.appleJobRanking.errorType, "search_authentication_required");
  assert.match(h.store.appleJobRanking.error, /requires sign-in/);
});

test("an initial transient read is retried without changing pages, with a bounded retry limit", async () => {
  const recovered = workerHarness();
  const page = { url: filterA, paginationVerified: true, currentPage: 1, pageCount: 1,
    hasNextPage: false, links: [searchLink("100")] };
  recovered.mocks.pages = [page];
  recovered.mocks.collect = async () => recovered.calls.pages === 1
    ? { ok: false, error: "Apple is still loading the first search page." }
    : { ok: true, data: page };
  await recovered.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA }, profile);
  assert.equal(Object.values(recovered.store.appleJobRanking.searches)[0].complete, true);
  assert.equal(recovered.calls.pages, 2);
  assert.equal(recovered.calls.next.length, 0);
  assert.equal(recovered.calls.updated.length, 0);
  assert.equal(recovered.calls.scored, 1);

  const exhausted = workerHarness();
  exhausted.mocks.pages = [{ ok: false, error: "Apple's first search page never became ready." }];
  await exhausted.api.runAppleJobRanking({ sourceTabId: 1, searchUrl: filterA, autoApply: true }, profile);
  assert.equal(Object.values(exhausted.store.appleJobRanking.searches)[0].complete, false);
  assert.equal(exhausted.calls.pages, 2);
  assert.match(exhausted.store.appleJobRanking.error, /never became ready/);
  assert.equal(exhausted.calls.updated.length, 0);
  assert.equal(exhausted.calls.capacityReads.length, 0);
  assert.deepEqual(exhausted.calls.applied, []);
});

test("cancellation during pagination reconciliation does not perform another navigation", async () => {
  const h = workerHarness();
  const run = { sourceTabId: 1, searchUrl: filterA, autoApply: true };
  h.mocks.pages = [{ links: [searchLink("100")] }, { links: [searchLink("101")] }];
  h.mocks.next = async () => ({ ok: false, error: "Next response could not be verified." });
  h.mocks.collect = async (_tabId, message) => {
    if (message.expectedPage === 2) {
      run.stopRequested = true;
      return { ok: false, error: "Stopped while reconciling the next page." };
    }
    return { ok: true, data: { url: filterA, paginationVerified: true,
      currentPage: 1, pageCount: 2, hasNextPage: true, links: [searchLink("100")] } };
  };
  await h.api.runAppleJobRanking(run, profile);
  const search = Object.values(h.store.appleJobRanking.searches)[0];
  assert.equal(search.complete, false);
  assert.equal(search.pagesRead, 1);
  assert.equal(h.calls.next.length, 1);
  assert.equal(h.calls.updated.length, 0);
  assert.equal(h.calls.capacityReads.length, 0);
  assert.deepEqual(h.calls.applied, []);
  assert.equal(h.store.appleJobRanking.phase, "Ranking stopped; results saved");
  assert.equal(h.store.appleJobRanking.error, null);
});

test("Stop during the completed-page save prevents the pending Next action", async () => {
  const h = workerHarness();
  const run = { sourceTabId: 1, searchUrl: filterA, autoApply: true };
  h.mocks.pages = [{ links: [searchLink("100")] }, { links: [searchLink("101")] }];
  const patch = h.sandbox.CareerPeelerJobStore.patch;
  h.sandbox.CareerPeelerJobStore.patch = async (...args) => {
    await patch(...args);
    if (Object.values(args[1].searches || {}).some(search => search.pagesRead === 1 && !search.complete)) run.stopRequested = true;
  };
  await h.api.runAppleJobRanking(run, profile);
  const search = Object.values(h.store.appleJobRanking.searches)[0];
  assert.equal(search.pagesRead, 1);
  assert.equal(search.complete, false);
  assert.deepEqual([...search.processedJobIds], ["100"]);
  assert.equal(h.calls.next.length, 0);
  assert.equal(h.calls.updated.length, 0);
  assert.equal(h.calls.capacityReads.length, 0);
  assert.deepEqual(h.calls.applied, []);
  assert.equal(h.store.appleJobRanking.phase, "Ranking stopped; results saved");
  assert.equal(h.store.appleJobRanking.error, null);
});

test("latest scan strong-match count uses exact current observations while saved count includes every cache", async () => {
  const h = workerHarness();
  const job = (jobId, overrides = {}) => ({ ...h.queuedJob(jobId, 90), queueStatus: "available", ...overrides });
  const jobs = {
    "100": job("100"),
    "101": job("101"), // Historical eligible job, absent from the latest scan.
    "102": job("102", { profileSignature: "older-resume" }),
    "103": job("103", { score: null, eligible: false }),
    "104": job("104", { queueStatus: "submitted" }),
    "105": job("105"),
    "200123456": job("200123456-9999"), // Latest discovery has the same base but a different full ID.
    "106": job("106", { eligible: false, score: 75, breakdown: {} }),
    "107": job("107", { queueStatus: "withdrawn" }),
    "108": job("108", { queueStatus: "queued" })
  };
  const searchKey = core.fingerprintText(filterA);
  h.store.appleJobRanking = { jobs, latestSearchKey: searchKey, reservations: [], searches: { [searchKey]: {
    url: filterA, scanId: "current-scan", complete: false, profileSignature: h.api.appleRankingProfileSignature(profile),
    discoveredJobIds: ["100", "102", "103", "104", "105", "200123456-0836", "106", "107", "108"], startedAt: 1
  } } };
  h.store.applied = { "105": { jobId: "105", site: "apple" } };
  const view = await h.api.getAppleRankingView(profile);
  assert.equal(view.latestSearchStrongCount, 2, "only exact observed, current-profile, eligible, unapplied jobs count");
  assert.equal(view.eligibleCount, 4, "historical eligible jobs remain visible in the global cache count");
  assert.equal(view.savedJobCount, 10, "saved count includes historical, stale, unscored, applied, and protected histories");
  assert.equal(view.staleCount, 1);
  assert.equal(view.queued.length, 1);
  assert.equal(view.latestSearch.complete, false, "an observed match count does not certify full scan completion");
});

test("legacy, absent, or stale-profile scan identity reports an unknown latest-scan match count rather than cached totals", async () => {
  for (const latestSearch of [null, { url: filterA, discoveredIds: ["100"], complete: true, startedAt: 1 },
    { url: filterA, scanId: "legacy-scan", discoveredIds: ["100"], complete: false, startedAt: 1 },
    { url: filterA, scanId: "old-profile-scan", discoveredJobIds: ["100"], profileSignature: "older-resume", complete: true, startedAt: 1 }]) {
    const h = workerHarness();
    const searchKey = core.fingerprintText(filterA);
    h.store.appleJobRanking = { jobs: { "100": h.queuedJob("100", 90) }, reservations: [],
      latestSearchKey: searchKey, searches: latestSearch ? { [searchKey]: latestSearch } : {} };
    const view = await h.api.getAppleRankingView(profile);
    assert.equal(view.latestSearchStrongCount, null);
    assert.equal(view.savedJobCount, 1);
    assert.equal(view.eligibleCount, 1);
  }
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

test("explicit Auto Apply reuses a ready submissions tab but still verifies full capacity before applying", async () => {
  const h = workerHarness();
  h.mocks.capacityTabs = [{ id: 7, windowId: 1, status: "complete", url: "https://jobs.apple.com/app/en-us/profile/roles" }];
  await scanFixture(h, ["100"], { autoApply: true });
  assert.deepEqual(h.calls.applied, ["100"]);
  assert.deepEqual(h.calls.capacityReads, [{ tabId: 7, restoreOriginalPage: true }]);
  assert.ok(!h.calls.removed.includes(7), "the user's submissions tab stays open");
});

test("explicit Auto Apply refuses unknown capacity even when a cached count says slots are available", async () => {
  const h = workerHarness();
  h.store.appleJobRanking = { jobs: {}, searches: {}, reservations: [],
    capacitySnapshot: { complete: true, inventoryState: "confirmed_empty", roles: [], updatedAt: 100000 } };
  h.mocks.signedOut = true;
  await scanFixture(h, ["100"], { autoApply: true });
  assert.equal(h.calls.capacityReads.length, 1);
  assert.deepEqual(h.calls.applied, []);
  assert.equal(h.store.appleJobRanking.capacitySnapshot.inventoryState, "unknown");
});
