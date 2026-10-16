const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createContentHarness, createBackgroundHarness } = require("./helpers/appleWorkflowHarness.cjs");
const safety = require("../lib/appleApplicationSafety.js");
const ranking = require("../lib/jobRanking.js");
const fs = require("node:fs");
const vm = require("node:vm");

const role = jobId => ({ jobId, title: "Software Engineer", active: true,
  url: `https://jobs.apple.com/en-us/details/${jobId}/software-engineer`, favorite: false, protectedFromBatchWithdrawal: false });
const page = (roles, pageIndex = 1, pageCount = 1) => ({ roles, pageIndex, pageCount,
  accountVerified: true, inventoryState: roles.length ? "confirmed" : "confirmed_empty",
  hasNextPage: pageIndex < pageCount, withdrawalConfirmationOpen: false });
const inventory = roles => ({ pages: [page(roles)], pageCount: 1 });
const reviewsKey = "appleSubmittedRoleReviews";
const element = text => ({ innerText: text, textContent: text, getAttribute: () => null,
  getBoundingClientRect: () => ({ width: 200, height: 30, top: 0 }) });

function contentInventory({ roles = [], authenticated = true, loading = false, error = "",
  pageCount = 0, pageIndex = null } = {}) {
  const sandbox = createContentHarness();
  sandbox.window.location = new URL("https://jobs.apple.com/app/en-us/profile/roles");
  sandbox.document.body.innerText = authenticated ? `Your Active Submitted Roles\n${error}` : "Please sign in to continue";
  sandbox.collectSubmittedRoleCards = () => roles;
  sandbox.document.querySelector = selector => selector.includes('input[type="number"]') && pageIndex !== null
    ? { value: String(pageIndex) } : selector.includes("paginationTotalPages") && pageCount !== null
      ? element(String(pageCount)) : null;
  sandbox.document.querySelectorAll = selector => selector.includes("aria-busy") && loading ? [element("Loading")]
    : selector === "[role='alert']" && error ? [element(error)]
      : [];
  return sandbox;
}

async function workerInventory(result = { ok: true, data: inventory([]) }) {
  const h = createBackgroundHarness();
  await h.ready;
  // These tests model current-version count synchronization; upgrade recovery
  // has separate coverage with a deliberately missing withdrawal journal.
  h.data.appleWithdrawalWorkflow = { version: 1, records: {} };
  h.sandbox.createTaskTab = async () => ({ id: 42 });
  h.sandbox.waitForTabComplete = async () => {};
  h.sandbox.sendMessageWithFallback = async () => {
    if (result instanceof Error) throw result;
    return result;
  };
  const state = { jobs: {}, applicationFailures: {}, reservations: [] };
  return { ...h, state, setResult(value) { result = value; } };
}

test("authenticated zero-total inventory succeeds and reports 0/50 using one virtual page", async () => {
  const content = contentInventory();
  const result = await content.collectAllAppleSubmittedHistoryPages({ restoreFirstPage: false });
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].inventoryState, "confirmed_empty");
  const h = await workerInventory({ ok: true, data: result });
  await h.sandbox.refreshAppleQueueCapacity(h.state, 1);
  const capacity = await h.sandbox.appleRankingCapacity(h.state);
  assert.equal(capacity.known, true);
  assert.equal(capacity.submitted, 0);
  assert.equal(capacity.remaining, 50);
  assert.equal(h.data[reviewsKey].lastCompleteScan.roles.length, 0);
  assert.deepEqual(h.calls.removed, [42]);
});

test("missing authentication, loading, errors, or missing zero-total evidence remain unknown", () => {
  for (const options of [{ authenticated: false }, { loading: true }, { error: "Unable to load submissions. Try again." },
    { error: "Your session expired" }, { error: "Request failed" }, { pageCount: null }, { pageCount: 1 }, { pageCount: 2, pageIndex: 1 },
    { pageCount: "not-a-count" }, { pageIndex: -1 }]) {
    assert.throws(() => contentInventory(options).collectCurrentAppleSubmittedHistoryPage());
  }
});

test("loading copy and foreign origins cannot be interpreted as empty inventory", () => {
  const loading = contentInventory();
  loading.getLoadingSignal = () => "Loading";
  assert.throws(() => loading.collectCurrentAppleSubmittedHistoryPage());
  const foreign = contentInventory();
  foreign.window.location = new URL("https://www.apple.com/app/en-us/profile/roles");
  assert.throws(() => foreign.collectCurrentAppleSubmittedHistoryPage());
});

test("nonempty active submissions preserve the current page shape and verified capacity", async () => {
  const content = contentInventory({ roles: [role("200000001"), role("200000002")], pageCount: 1, pageIndex: 1 });
  const current = content.collectCurrentAppleSubmittedHistoryPage();
  assert.equal(current.pageIndex, 1);
  assert.equal(current.roles.length, 2);
  const h = await workerInventory({ ok: true, data: { pages: [current], pageCount: 1 } });
  await h.sandbox.refreshAppleQueueCapacity(h.state, 1);
  assert.equal((await h.sandbox.appleRankingCapacity(h.state)).remaining, 48);
});

test("malformed, incomplete, duplicate, and failed inventories never become zero", async () => {
  for (const data of [{ pages: [], pageCount: 0 }, { pages: [page([], 1, 2)], pageCount: 2 },
    { pages: [{ ...page([]), inventoryState: undefined }], pageCount: 1 },
    { pages: [{ ...page([]), accountVerified: false }], pageCount: 1 },
    { pages: [{ ...page([role("200000001")]), roles: null }], pageCount: 1 },
    { pages: [page([role("bad-id")])], pageCount: 1 },
    { pages: [page([{ ...role("200000001"), active: false }])], pageCount: 1 },
    { pages: [page([role("200000001")], 1, 2), page([role("200000001")], 2, 2)], pageCount: 2 }]) {
    const h = await workerInventory({ ok: true, data });
    await assert.rejects(h.sandbox.refreshAppleQueueCapacity(h.state, 1));
    assert.equal((await h.sandbox.appleRankingCapacity(h.state)).known, false);
    assert.equal(h.data[reviewsKey], undefined);
    assert.deepEqual(h.calls.removed, [42]);
  }
  for (const result of [new Error("Network failed"), { ok: false, error: "Sign in required" }]) {
    const h = await workerInventory(result);
    await assert.rejects(h.sandbox.refreshAppleQueueCapacity(h.state, 1));
    assert.equal((await h.sandbox.appleRankingCapacity(h.state)).known, false);
  }
});

test("all pagination pages must be contiguous, consistent, and complete", () => {
  const data = { pages: [page([role("200000001")], 1, 2), page([role("200000002")], 2, 2)], pageCount: 2 };
  assert.equal(safety.validateSubmittedHistoryInventory(data).roles.length, 2);
  for (const pages of [[data.pages[0], data.pages[0]], [data.pages[1], data.pages[0]],
    [data.pages[0], { ...data.pages[1], pageCount: 3 }], [data.pages[0], page([], 2, 2)],
    [{ ...data.pages[0], hasNextPage: false }, data.pages[1]]]) {
    assert.throws(() => safety.validateSubmittedHistoryInventory({ ...data, pages }));
  }
});

test("the real all-pages collector visits every page and rejects changing pagination", async () => {
  for (const changing of [false, true]) {
    const content = createContentHarness();
    let index = 1;
    const pages = [page([role("200000001")], 1, 2), page([role("200000002")], 2, changing ? 3 : 2)];
    content.collectCurrentAppleSubmittedHistoryPage = () => pages[index - 1];
    content.goToAppleSubmittedHistoryPage = async target => { index = target; return pages[index - 1]; };
    content.advanceAppleSubmittedHistoryPage = async () => ({ advanced: true, page: pages[++index - 1] });
    if (changing) await assert.rejects(content.collectAllAppleSubmittedHistoryPages({ restoreFirstPage: false }), /pagination/);
    else {
      const result = await content.collectAllAppleSubmittedHistoryPages({ restoreFirstPage: false });
      assert.equal(result.pages.length, 2);
      assert.equal(result.roles.length, 2);
      assert.equal(result.complete, true);
      const h = await workerInventory({ ok: true, data: result });
      await h.sandbox.refreshAppleQueueCapacity(h.state, 1);
      assert.equal((await h.sandbox.appleRankingCapacity(h.state)).remaining, 48);
    }
  }
});

test("Scan And Match All accepts confirmed empty inventory without resume/API calls or warnings", async () => {
  const content = contentInventory();
  const h = await workerInventory();
  h.data.appleJobRanking = { jobs: {}, searches: {}, reservations: [{ jobId: "200000001" }] };
  h.sandbox.sendMessageWithFallback = async () => ({ ok: true, data: content.collectCurrentAppleSubmittedHistoryPage() });
  h.sandbox.getTaskWindowId = async () => 1;
  const result = await h.sandbox.analyzeAllAppleSubmittedRoles(1, {}, "zero-scan");
  assert.equal(result.warning, null);
  assert.equal(result.reviews[0].roles.length, 0);
  assert.equal(h.data[reviewsKey].latestScan.inventoryState, "confirmed_empty");
  assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).remaining, 50);
  assert.equal(h.data.appleJobRanking.reservations.length, 0);
  const current = await h.sandbox.analyzeAppleSubmittedRolesCurrentPage(1, {}, "zero-current");
  assert.equal(current.warning, null);
});

test("failed all-submissions scan preserves the saved complete ranking but invalidates capacity", async () => {
  const h = await workerInventory();
  const old = { complete: true, roles: [role("200000001")], updatedAt: Date.now() - 1000 };
  h.data[reviewsKey] = { lastCompleteScan: old, latestScan: old, pages: {} };
  h.sandbox.getTaskWindowId = async () => 1;
  h.sandbox.sendMessageWithFallback = async () => ({ ok: false, error: "Session expired" });
  await assert.rejects(h.sandbox.analyzeAllAppleSubmittedRoles(1, {}, "failed-scan"), /Session/);
  assert.equal(h.data[reviewsKey].lastCompleteScan.roles.length, 1);
  assert.equal(h.data[reviewsKey].latestScan.complete, false);
  assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).known, false);
});

test("incomplete pagination and malformed scan pages cannot reuse a cached zero count", async () => {
  for (const incomplete of [true, false]) {
    const h = await workerInventory();
    h.data[reviewsKey] = { lastCompleteScan: { complete: true, inventoryState: "confirmed_empty", roles: [], updatedAt: 1 }, pages: {} };
    h.sandbox.getTaskWindowId = async () => 1;
    h.sandbox.scoreAppleSubmittedRoles = async () => ({ roles: [] });
    const current = incomplete ? page([role("200000001")], 1, 2) : { ...page([]), accountVerified: false };
    h.sandbox.sendMessageWithFallback = async (_id, message) => ({ ok: true,
      data: message.type === "APPLE_CAREERS_ADVANCE_SUBMITTED_HISTORY_PAGE" ? { advanced: false } : current });
    if (incomplete) {
      const result = await h.sandbox.analyzeAllAppleSubmittedRoles(1, {}, "partial-scan");
      assert.match(result.warning, /incomplete/);
    } else await assert.rejects(h.sandbox.analyzeAllAppleSubmittedRoles(1, {}, "bad-scan"), /inventory/);
    assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).known, false);
    assert.equal(h.data[reviewsKey].lastCompleteScan.inventoryState, "confirmed_empty");
  }
});

test("successful final withdrawal can settle to a confirmed empty page and reconcile capacity", async () => {
  const content = contentInventory();
  let clock = 1000;
  content.Date = class extends Date { static now() { return clock; } };
  content.delay = async ms => { clock += ms; };
  content.getAppleWithdrawalSuccessMessage = () => "Submission withdrawn";
  content.getAppleWithdrawalFailureMessage = () => null;
  const outcome = await content.waitForSubmittedRoleWithdrawal("200000001", "Software Engineer", 1, 1, false, 2000);
  assert.equal(outcome.withdrawn, true);
  const h = await workerInventory({ ok: true, data: inventory([role("200000001")]) });
  await h.sandbox.refreshAppleQueueCapacity(h.state, 1);
  assert.equal((await h.sandbox.appleRankingCapacity(h.state)).submitted, 1);
  h.setResult({ ok: true, data: await content.collectAllAppleSubmittedHistoryPages({ restoreFirstPage: false }) });
  await h.sandbox.refreshAppleQueueCapacity(h.state, 1);
  assert.equal((await h.sandbox.appleRankingCapacity(h.state)).remaining, 50);
});

test("the Submissions panel persists final-withdrawal capacity only with confirmed complete empty evidence", async () => {
  const source = fs.readFileSync(require.resolve("../src/sidepanel/components/SubmittedApplicationsSection.jsx"), "utf8");
  const method = source.slice(source.indexOf("  async function removeSavedRole("), source.indexOf("  async function withdrawSelected("));
  for (const confirmed of [true, false]) {
    const h = await workerInventory();
    const old = { complete: true, inventoryState: "confirmed", roles: [role("200000001")], updatedAt: 1000, scannedAt: 1000 };
    h.data[reviewsKey] = { latestScan: old, lastCompleteScan: old, pages: { 1: page(old.roles) } };
    h.data.appleJobRanking = { capacitySnapshot: old, jobs: {}, reservations: [{ jobId: "200000002" }] };
    const ui = { jobStore: h.sandbox.CareerPeelerJobStore, SAVED_REVIEWS_KEY: reviewsKey,
      reloadArchive: async () => {} };
    vm.runInNewContext(method, ui);
    await ui.removeSavedRole("200000001", { ...page([]), accountVerified: confirmed });
    const state = await h.sandbox.readAppleRankingState();
    const capacity = await h.sandbox.appleRankingCapacity(state);
    assert.equal(capacity.known, confirmed);
    if (confirmed) {
      assert.equal(capacity.submitted, 0);
      assert.equal(capacity.remaining, 50);
      assert.equal(state.reservations.length, 0);
      assert.equal(h.data[reviewsKey].lastCompleteScan.inventoryState, "confirmed_empty");
    }
  }
});

test("a failed refresh invalidates a stale count without removing saved ranking or reservations", async () => {
  const h = await workerInventory(new Error("Network failed"));
  const old = { complete: true, roles: [role("200000001")], updatedAt: Date.now() - 10000, scannedAt: Date.now() - 10000 };
  h.data[reviewsKey] = { lastCompleteScan: old, latestScan: old, pages: { 1: page(old.roles) } };
  h.state.capacitySnapshot = old;
  h.state.reservations = [{ jobId: "200000002" }];
  await assert.rejects(h.sandbox.refreshAppleQueueCapacity(h.state, 1));
  assert.equal((await h.sandbox.appleRankingCapacity(h.state)).known, false);
  assert.equal(h.state.reservations.length, 1);
  assert.equal(h.data[reviewsKey].lastCompleteScan.roles.length, 1);
  const reloaded = await h.sandbox.readAppleRankingState();
  assert.equal((await h.sandbox.appleRankingCapacity(reloaded)).known, false);
  h.setResult({ ok: true, data: inventory([]) });
  await h.sandbox.refreshAppleQueueCapacity(reloaded, 1);
  assert.equal((await h.sandbox.appleRankingCapacity(reloaded)).remaining, 50);
});

test("fresh synchronization replaces stale counts and reconciles subsequent submissions", async () => {
  const h = await workerInventory({ ok: true, data: inventory([]) });
  h.data[reviewsKey] = { latestScan: { complete: true, roles: [role("200000003")], updatedAt: 1, scannedAt: 1 } };
  h.data.appleCareersAppliedJobs = { historical: { jobId: "200000003", site: "apple", appliedAt: new Date(1).toISOString() } };
  await h.sandbox.refreshAppleQueueCapacity(h.state, 1);
  assert.equal((await h.sandbox.appleRankingCapacity(h.state)).remaining, 50);
  const appliedAt = new Date(h.state.capacitySnapshot.scannedAt + 1000).toISOString();
  h.data.appleCareersAppliedJobs.new = { site: "apple", jobId: "200000001", appliedAt };
  h.state.reservations = [{ jobId: "200000001" }, { jobId: "200000002" }];
  assert.equal((await h.sandbox.appleRankingCapacity(h.state)).remaining, 48);
  h.setResult({ ok: true, data: inventory([role("200000001"), role("200000002")]) });
  await h.sandbox.refreshAppleQueueCapacity(h.state, 1);
  assert.equal(h.state.reservations.length, 0);
  assert.equal((await h.sandbox.appleRankingCapacity(h.state)).submitted, 2);
});

test("empty legacy cache is unknown; confirmed empty counts later applications and reservations", () => {
  assert.equal(ranking.applicationCapacity({ complete: true, roles: [], updatedAt: 1000 }).known, false);
  const snapshot = { complete: true, inventoryState: "confirmed_empty", roles: [], scannedAt: 1000, updatedAt: 1000 };
  const applied = [{ site: "apple", jobId: "200000001", appliedAt: new Date(1500).toISOString() }];
  assert.equal(ranking.applicationCapacity(snapshot, applied, [{ jobId: "200000002" }]).remaining, 48);
  assert.equal(ranking.applicationCapacity(snapshot, applied, [], ["200000001"]).remaining, 50);
});

test("failed fresh reads override even cached future timestamps", async () => {
  const h = await workerInventory(new Error("Network failed"));
  h.data[reviewsKey] = { lastCompleteScan: { complete: true, inventoryState: "confirmed_empty", roles: [], updatedAt: Date.now() + 60000 } };
  await assert.rejects(h.sandbox.refreshAppleQueueCapacity(h.state, 1));
  assert.equal((await h.sandbox.appleRankingCapacity(h.state)).known, false);
});
