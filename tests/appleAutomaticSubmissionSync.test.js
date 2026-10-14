const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { createContentHarness, createBackgroundHarness } = require("./helpers/appleWorkflowHarness.cjs");
const url = "https://jobs.apple.com/app/en-us/profile/roles";
const sourceTab = { id: 1, windowId: 1, status: "complete", active: true, url };
const role = id => ({ jobId: id, title: "Software Engineer", active: true, favorite: false, protectedFromBatchWithdrawal: false });
const page = (roles = [], extra = {}) => ({ roles, pageIndex: 1, pageCount: 1, hasNextPage: false,
  withdrawalConfirmationOpen: false, accountVerified: true, inventoryState: roles.length ? "confirmed" : "confirmed_empty", ...extra });
const statusKey = "appleSubmissionSyncStatus";
const settle = () => new Promise(resolve => setImmediate(resolve));
async function harness(result = { ok: true, data: page([role("200000001")]) }, data = {}) {
  const h = createBackgroundHarness([{ ...sourceTab }], { data, sendMessage: async (_id, message) => {
    assert.equal(message.type, "APPLE_CAREERS_PEEK_SUBMITTED_HISTORY_PAGE", "automatic checks never paginate or submit");
    return typeof result === "function" ? result() : result;
  } });
  await h.ready;
  h.sandbox.callOpenAi = async () => assert.fail("Automatic sync must not analyze roles");
  return h;
}
const request = h => h.sandbox.dispatch({ type: "APPLE_CAREERS_CHECK_SUBMISSION_CAPACITY" }, { tab: h.tabs[0] });

test("ready Active navigation, activation and content messages coalesce into one verified automatic check", async () => {
  const h = await harness();
  await Promise.all([h.sandbox.chrome.tabs.onUpdated.emit(1, { url }, h.tabs[0]),
    h.sandbox.chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 }), request(h)]);
  await settle();
  assert.equal(h.calls.messages.length, 1);
  assert.equal(h.data[statusKey].state, "synced");
  assert.ok(h.data[statusKey].lastSuccessAt);
  const capacity = await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState());
  assert.equal(capacity.submitted, 1);
  assert.equal(capacity.remaining, 49);
  assert.deepEqual(h.calls.created, []);
  assert.deepEqual(h.calls.updated, []);
  assert.deepEqual(h.calls.removed, []);
  assert.deepEqual(h.calls.injected, []);
});

test("SPA Active readiness reports one check per stable inventory signature", async () => {
  const content = createContentHarness({ observe: true, url: "https://jobs.apple.com/en-us/search" });
  await content.flushObservationTimers();
  content.window.location = new URL(url);
  content.collectCurrentAppleSubmittedHistoryPage = () => page([role("200000001")]);
  for (let index = 0; index < 5; index++) { content.mutate(); await content.flushObservationTimers(); }
  assert.equal(content.observationCalls.messages.length, 1);
  assert.equal(content.observationCalls.messages[0].type, "APPLE_CAREERS_CHECK_SUBMISSION_CAPACITY");
  content.collectCurrentAppleSubmittedHistoryPage = () => page([role("200000002")]);
  content.mutate(); await content.flushObservationTimers();
  assert.equal(content.observationCalls.messages.length, 2);
});

test("single-page confirmed empty succeeds; missing authentication and malformed zero remain unknown", async () => {
  for (const confirmed of [true, false]) {
    const h = await harness({ ok: true, data: page([], { accountVerified: confirmed }) });
    const result = await request(h);
    assert.equal(result.ok, confirmed);
    const capacity = await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState());
    assert.equal(capacity.known, confirmed);
    if (confirmed) { assert.equal(capacity.submitted, 0); assert.equal(capacity.remaining, 50); }
    else { assert.equal(h.data[statusKey].state, "failed"); assert.equal(h.data[statusKey].lastSuccessAt, undefined); }
  }
});

test("failed automatic sync invalidates a stale count and preserves the last successful timestamp and reservations", async () => {
  const previous = Date.now() - 120000;
  for (const error of ["Network failed", "Sign in required", "Inventory is still loading"]) {
    const h = await harness({ ok: false, error }, {
      [statusKey]: { state: "synced", lastSuccessAt: previous },
      appleJobRanking: { jobs: {}, searches: {}, reservations: [{ jobId: "200000003" }],
        capacitySnapshot: { complete: true, inventoryState: "confirmed_empty", roles: [], updatedAt: previous } }
    });
    assert.equal((await request(h)).ok, false);
    assert.equal(h.data[statusKey].state, "failed");
    assert.equal(h.data[statusKey].lastSuccessAt, previous);
    assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).known, false);
    assert.equal(h.data.appleJobRanking.reservations.length, 1);
  }
});

test("paginated inventories defer without changing cached proof or navigating the visible tab", async () => {
  const lastSuccessAt = Date.now() - 120000;
  const h = await harness({ ok: true, data: page([role("200000001")], { pageCount: 2, hasNextPage: true }) }, {
    [statusKey]: { state: "synced", lastSuccessAt }, appleSubmittedRoleReviews: { lastCompleteScan: { roles: [role("200000002")], complete: true } }
  });
  const cached = structuredClone(h.data.appleSubmittedRoleReviews);
  assert.equal((await request(h)).deferred, true);
  assert.equal(h.data[statusKey].reason, "pagination");
  assert.equal(h.data[statusKey].lastSuccessAt, lastSuccessAt);
  assert.deepEqual(h.data.appleSubmittedRoleReviews, cached);
  assert.deepEqual(h.calls.created, []);
  assert.deepEqual(h.calls.updated, []);
  assert.equal(h.calls.messages.length, 1);
});

test("Auto Apply, ranking, withdrawal, and submission analysis defer passive checks before any page read", async () => {
  for (const busy of ["queue", "scan", "withdraw", "analysis"]) {
    const h = await harness();
    if (busy === "queue") vm.runInContext("appleRankingActiveRun = { applying: true }", h.sandbox);
    if (busy === "scan") vm.runInContext("scanState.running = true", h.sandbox);
    if (busy === "withdraw") vm.runInContext("appleWithdrawalBatchUntil = Date.now() + 60000", h.sandbox);
    if (busy === "analysis") vm.runInContext("submittedRoleAnalysisRuns.set('analysis', {})", h.sandbox);
    const result = await request(h);
    assert.equal(result.deferred, true);
    assert.equal(h.data[statusKey].reason, "workflow");
    assert.deepEqual(h.calls.messages, []);
    assert.deepEqual(h.calls.created, []);
  }
});

test("workflow recovery defers automatic sync without acknowledging uncertain outcomes", async () => {
  const h = await harness();
  h.data.appleApplicationWorkflow = { id: "old-owner", status: "paused", reconciliationRequired: true,
    jobs: { "200000003": { state: "uncertain", submissionOutcome: "unknown" } } };
  const journal = structuredClone(h.data.appleApplicationWorkflow);
  assert.equal((await request(h)).deferred, true);
  assert.equal(h.data[statusKey].reason, "recovery");
  assert.deepEqual(h.data.appleApplicationWorkflow, journal);
  assert.deepEqual(h.calls.messages, []);
});

test("successful automatic reads retain pending reservations and do not rewrite uncertain queue results", async () => {
  const h = await harness({ ok: true, data: page([]) }, {
    appleJobRanking: { jobs: { "200000003": { jobId: "200000003", queueStatus: "uncertain" } }, searches: {},
      reservations: [{ jobId: "200000003" }], applicationFailures: { "200000003": { submissionOutcomeUnknown: true, status: "uncertain" } } }
  });
  await request(h);
  assert.equal(h.data.appleJobRanking.jobs["200000003"].queueStatus, "uncertain");
  assert.equal(h.data.appleJobRanking.reservations.length, 1);
  assert.equal(h.data.appleJobRanking.applicationFailures["200000003"].status, "uncertain");
  assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).remaining, 49);
});

test("restart preserves successful timestamp and throttle, and never restarts a sync by itself", async () => {
  const h = await harness();
  await request(h);
  const lastSuccessAt = h.data[statusKey].lastSuccessAt;
  const restarted = await harness(undefined, h.data);
  assert.equal(restarted.calls.messages.length, 0);
  await restarted.sandbox.chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
  await request(restarted);
  assert.equal(restarted.calls.messages.length, 0);
  assert.equal(h.data[statusKey].lastSuccessAt, lastSuccessAt);
});

test("restart during a sync marks it interrupted, retains last success, and leaves capacity unknown", async () => {
  const lastSuccessAt = Date.now() - 120000;
  const h = await harness(undefined, {
    [statusKey]: { state: "syncing", lastSuccessAt },
    appleJobRanking: { jobs: {}, searches: {}, reservations: [{ jobId: "200000003" }], capacitySnapshot: { complete: true, roles: [role("200000001")] } }
  });
  assert.equal(h.data[statusKey].state, "failed");
  assert.equal(h.data[statusKey].reason, "interrupted");
  assert.equal(h.data[statusKey].lastSuccessAt, lastSuccessAt);
  assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).known, false);
  assert.equal(h.data.appleJobRanking.reservations.length, 1);
  assert.equal(h.calls.messages.length, 0);
});

test("in-flight automatic checks show Syncing and cannot be marked successful before verification", async () => {
  let finish;
  const read = new Promise(resolve => { finish = resolve; });
  const h = await harness(() => read);
  const first = request(h);
  await settle();
  assert.equal(h.data[statusKey].state, "syncing");
  assert.equal(h.data[statusKey].lastSuccessAt, undefined);
  const second = await request(h);
  assert.equal(second.coalesced, true);
  finish({ ok: true, data: page([]) });
  assert.equal((await first).ok, true);
  assert.equal(h.data[statusKey].state, "synced");
  assert.equal(h.calls.messages.length, 1);
});

test("inactive Your Roles views do not change count or sync success metadata", async () => {
  const previous = { state: "synced", lastSuccessAt: Date.now() - 120000 };
  const h = await harness({ ok: true, data: { activeContext: false } }, { [statusKey]: previous });
  assert.equal((await request(h)).ignored, true);
  assert.deepEqual(h.data[statusKey], previous);
  assert.equal(h.data.appleSubmittedRoleReviews, undefined);
});

test("an inactive tab does not trigger work and rapid signature changes do not bypass the successful-sync throttle", async () => {
  const h = await harness();
  h.tabs[0].active = false;
  assert.equal((await request(h)).ignored, true);
  assert.equal(h.calls.messages.length, 0);
  h.tabs[0].active = true;
  await request(h);
  await h.sandbox.dispatch({ type: "APPLE_CAREERS_CHECK_SUBMISSION_CAPACITY", signature: "changed-inventory" }, { tab: h.tabs[0] });
  assert.equal(h.calls.messages.length, 1);
  h.data[statusKey].lastAttemptAt = Date.now() - 61000;
  await request(h);
  assert.equal(h.calls.messages.length, 2);
});


test("a ready-page message can retry a failed loading read without waiting for the activation cooldown", async () => {
  let ready = false;
  const h = await harness(() => ready ? { ok: true, data: page([]) } : { ok: false, error: "Inventory is still loading" });
  assert.equal((await request(h)).ok, false);
  ready = true;
  const result = await h.sandbox.dispatch({ type: "APPLE_CAREERS_CHECK_SUBMISSION_CAPACITY", signature: "1|1|" }, { tab: h.tabs[0] });
  assert.equal(result.ok, true);
  assert.equal(h.data[statusKey].state, "synced");
  assert.equal(h.calls.messages.length, 2);
});

test("explicit Sync cannot launch a concurrent inventory read during automatic synchronization", async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = await harness(() => pending);
  const automatic = request(h);
  await settle();
  const explicit = await h.sandbox.dispatch({ type: "APPLE_CAREERS_REFRESH_QUEUE_CAPACITY", tab: h.tabs[0] });
  assert.equal(explicit.ok, false);
  assert.equal(h.data[statusKey].state, "syncing");
  assert.equal(h.calls.messages.length, 1);
  finish({ ok: true, data: page([]) });
  await automatic;
  assert.equal(h.data[statusKey].state, "synced");
});

test("persistence failure cannot claim a successful sync and leaves cached rankings intact", async () => {
  const h = await harness();
  h.sandbox.CareerPeelerJobStore = { ...h.sandbox.CareerPeelerJobStore,
    set: async () => { throw new Error("Job database write failed"); } };
  assert.equal((await request(h)).ok, false);
  assert.equal(h.data[statusKey].state, "failed");
  assert.equal(h.data[statusKey].lastSuccessAt, undefined);
  assert.equal(h.data.appleSubmittedRoleReviews, undefined);
});

test("an open Apple withdrawal dialog defers without reading other pages or clearing reservations", async () => {
  const h = await harness({ ok: true, data: page([role("200000001")], { withdrawalConfirmationOpen: true }) }, {
    appleJobRanking: { jobs: {}, searches: {}, reservations: [{ jobId: "200000003" }] }
  });
  assert.equal((await request(h)).deferred, true);
  assert.equal(h.data[statusKey].reason, "dialog");
  assert.equal(h.data[statusKey].lastSuccessAt, undefined);
  assert.equal(h.data.appleJobRanking.reservations.length, 1);
  assert.deepEqual(h.calls.created, []);
});

test("the real Peek handler distinguishes Active, non-Active, and failed page reads without navigation", async () => {
  const content = createContentHarness();
  content.window.location = new URL(url);
  content.getSessionRequiredSignal = () => null;
  content.collectCurrentAppleSubmittedHistoryPage = () => page([]);
  const peek = () => content.dispatch({ type: "APPLE_CAREERS_PEEK_SUBMITTED_HISTORY_PAGE" });
  content.document.body.innerText = "Your Favorite Roles";
  assert.equal((await peek()).data.activeContext, false);
  content.document.body.innerText = "Your Active Submitted Roles";
  assert.equal((await peek()).data.inventoryState, "confirmed_empty");
  content.collectCurrentAppleSubmittedHistoryPage = () => { throw new Error("Still loading"); };
  assert.equal((await peek()).ok, false);
  content.getSessionRequiredSignal = () => "Please sign in";
  assert.match((await peek()).error, /sign in/);
  assert.deepEqual(content.observationCalls.messages, []);
});

test("a failed database preflight still exposes a failed sync without claiming a zero count", async () => {
  const h = await harness();
  h.sandbox.CareerPeelerJobStore = { ...h.sandbox.CareerPeelerJobStore,
    getMetadata: async () => { throw new Error("Database unavailable"); } };
  assert.equal((await request(h)).ok, false);
  assert.equal(h.data[statusKey].state, "failed");
  assert.equal(h.data[statusKey].lastSuccessAt, undefined);
  assert.equal(h.data[statusKey].lastVerifiedCount, undefined);
  assert.equal(h.calls.messages.length, 0);
});
