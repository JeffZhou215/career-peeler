const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createContentHarness, createBackgroundHarness } = require("./helpers/appleWorkflowHarness.cjs");

const rolesUrl = "https://jobs.apple.com/app/en-us/profile/roles";
const searchUrl = "https://jobs.apple.com/en-us/search?team=software";
const tab = (id, url = rolesUrl, windowId = 1) => ({ id, url, windowId, status: "complete" });
const role = jobId => ({ jobId, title: "Software Engineer", active: true, favorite: false,
  url: `https://jobs.apple.com/en-us/details/${jobId}/engineer` });
const page = (roles = [], pageIndex = 1, pageCount = 1) => ({ roles, pageIndex, pageCount,
  accountVerified: true, inventoryState: roles.length ? "confirmed" : "confirmed_empty",
  hasNextPage: pageIndex < pageCount, withdrawalConfirmationOpen: false });
const inventory = { pages: [page([role("200123456-0836")], 1, 2), page([role("200987654-0836")], 2, 2)], pageCount: 2 };
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };

async function syncHarness(tabs = [tab(1)], options = {}) {
  const h = createBackgroundHarness(tabs, { ...options, sendMessage: options.sendMessage || (async (_id, message) => {
    if (message.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE") return { ok: true, data: inventory.pages[1] };
    if (message.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES") return { ok: true, data: inventory };
    throw new Error(`Unexpected message: ${message.type}`);
  }) });
  await h.ready;
  h.sandbox.waitForTabComplete = async () => {};
  h.sandbox.callOpenAi = async () => { assert.fail("Capacity checks must not invoke LLM analysis"); };
  return h;
}

for (const url of [rolesUrl, searchUrl]) {
  test(`manual page load and SPA navigation cannot request sync (${url})`, async () => {
    const content = createContentHarness({ observe: true, url });
    content.getSubmittedSignal = () => true; // A transient success marker cannot authorize a full sync.
    await content.flushObservationTimers();
    content.window.location = new URL(rolesUrl);
    for (let count = 0; count < 3; count++) {
      content.mutate();
      await content.flushObservationTimers();
    }
    assert.deepEqual(content.observationCalls.messages, []);
  });
}

test("manual navigation, repeated activation, and worker restart do not synchronize or create tabs", async () => {
  const h = await syncHarness([tab(1, searchUrl)]);
  h.data.appleSubmittedRoleReviews = { latestScan: { complete: true, roles: [role("200123456-0836")] } };
  const cached = structuredClone(h.data.appleSubmittedRoleReviews);
  h.tabs[0].url = rolesUrl;
  await h.sandbox.chrome.tabs.onUpdated.emit(1, { url: rolesUrl }, h.tabs[0]);
  for (let count = 0; count < 4; count++) await h.sandbox.chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
  await settle();
  const restarted = await syncHarness(h.tabs, { data: h.data });
  await restarted.sandbox.chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
  await settle();
  for (const worker of [h, restarted]) {
    assert.deepEqual(worker.calls.created, []);
    assert.deepEqual(worker.calls.updated, []);
    assert.deepEqual(worker.calls.messages, []);
    assert.deepEqual(worker.calls.removed, []);
  }
  assert.deepEqual(h.data.appleSubmittedRoleReviews, cached);
});

test("legacy passive sync messages, including confirmed=true, are harmless after an update", async () => {
  const h = await syncHarness();
  for (const confirmed of [false, true]) {
    const result = await h.sandbox.dispatch({ type: "APPLE_CAREERS_REQUEST_SUBMISSION_SYNC", confirmed }, { tab: h.tabs[0] });
    assert.equal(result.ignored, true);
  }
  const denied = await h.sandbox.dispatch({ type: "APPLE_CAREERS_REFRESH_QUEUE_CAPACITY", tab: h.tabs[0] }, { tab: h.tabs[0] });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /extension panel/);
  assert.deepEqual(h.calls.created, []);
  assert.deepEqual(h.calls.messages, []);
});

test("a read-only current-page request cannot paginate or request full synchronization", async () => {
  const content = createContentHarness({ observe: true, url: rolesUrl });
  content.collectCurrentAppleSubmittedHistoryPage = () => inventory.pages[1];
  content.goToAppleSubmittedHistoryPage = async () => { assert.fail("A page read must not navigate"); };
  const result = await content.dispatch({ type: "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE" });
  assert.equal(result.ok, true);
  assert.equal(result.data.pageIndex, 2);
  await content.flushObservationTimers();
  assert.deepEqual(content.observationCalls.messages, []);
});

test("visible Submitted markers still report identified roles without requesting a full sync", async () => {
  const content = createContentHarness({ observe: true, url: inventory.pages[0].roles[0].url });
  content.isElementVisible = () => true;
  content.getJobTitle = () => "Software Engineer";
  content.document.querySelectorAll = selector => selector === "a, button, [role='button']"
    ? [{ innerText: "Submitted" }] : [];
  await content.flushObservationTimers();
  content.mutate();
  await content.flushObservationTimers();
  assert.equal(content.observationCalls.messages.length, 1);
  assert.equal(content.observationCalls.messages[0].type, "APPLE_CAREERS_OBSERVED_SUBMISSION");
  assert.equal(content.observationCalls.messages[0].jobId, "200123456-0836");
});

test("explicit Sync reuses a suitable submissions tab, preserving ownership and matching cache", async () => {
  const h = await syncHarness();
  h.data.appleSubmittedRoleReviews = { pages: { 1: { roles: [{ ...inventory.pages[0].roles[0], score: 87, reason: "Cached match" }] } } };
  const result = await h.sandbox.dispatch({ type: "APPLE_CAREERS_REFRESH_QUEUE_CAPACITY", tab: h.tabs[0] });
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls.created, []);
  assert.deepEqual(h.calls.removed, []);
  assert.deepEqual(h.calls.updated, []);
  assert.equal(h.calls.messages[1].type, "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES");
  assert.equal(h.calls.messages[1].restoreOriginalPage, true);
  assert.equal(h.data.appleSubmittedRoleReviews.pages[1].roles[0].score, 87);
  const capacity = await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState());
  assert.equal(capacity.submitted, 2);
  assert.equal(capacity.remaining, 48);
});

test("explicit Sync from a filtered search uses and closes one inactive temporary tab in the same window", async () => {
  const h = await syncHarness([tab(1, searchUrl), tab(2, rolesUrl, 2)]);
  const result = await h.sandbox.dispatch({ type: "APPLE_CAREERS_REFRESH_QUEUE_CAPACITY", tab: h.tabs[0] });
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls.created, [{ url: rolesUrl, windowId: 1, active: false }]);
  assert.deepEqual(h.calls.removed, [3]);
  assert.deepEqual(h.calls.updated, []);
  assert.equal(h.tabs[0].url, searchUrl);
  assert.equal(h.calls.messages[0].restoreOriginalPage, false);
});

test("explicit Sync prefers its source submissions tab and skips an unsuitable existing tab", async () => {
  const h = await syncHarness([tab(1), tab(2)], { sendMessage: async (id, message) => {
    if (message.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE") {
      assert.equal(id, 2, "prefer the explicitly selected source tab");
      return { ok: true, data: inventory.pages[0] };
    }
    assert.equal(id, 2);
    return { ok: true, data: inventory };
  } });
  assert.equal((await h.sandbox.refreshAppleJobQueueCount(h.tabs[1])).ok, true);
  const unsuitable = await syncHarness([tab(1)], { sendMessage: async (_id, message) =>
    message.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE"
      ? { ok: true, data: { ...inventory.pages[0], withdrawalConfirmationOpen: true } }
      : { ok: true, data: inventory } });
  assert.equal((await unsuitable.sandbox.refreshAppleJobQueueCount(unsuitable.tabs[0])).ok, true);
  assert.equal(unsuitable.calls.created.length, 1);
  assert.deepEqual(unsuitable.calls.removed, [2], "never close the user's dialog tab");
});

test("activation during an explicit sync cannot spawn another sync or concurrent runner", async () => {
  let resolveInventory;
  const waiting = new Promise(resolve => { resolveInventory = resolve; });
  const h = await syncHarness([tab(1)], { sendMessage: async (_id, message) =>
    message.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE" ? { ok: true, data: inventory.pages[0] } : waiting });
  const sync = h.sandbox.refreshAppleJobQueueCount(h.tabs[0]);
  await settle();
  for (let count = 0; count < 4; count++) await h.sandbox.chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
  const another = await h.sandbox.refreshAppleJobQueueCount(h.tabs[0]);
  assert.equal(another.ok, false);
  resolveInventory({ ok: true, data: inventory });
  assert.equal((await sync).ok, true);
  assert.equal(h.calls.messages.filter(message => message.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES").length, 1);
  assert.deepEqual(h.calls.created, []);
});

test("reused-tab collection restores the original page after success and failure", async () => {
  for (const fail of [false, true]) {
    const content = createContentHarness();
    let index = 2;
    const visited = [];
    content.collectCurrentAppleSubmittedHistoryPage = () => inventory.pages[index - 1];
    content.goToAppleSubmittedHistoryPage = async target => { visited.push(target); index = target; return inventory.pages[index - 1]; };
    content.advanceAppleSubmittedHistoryPage = async () => {
      if (fail) throw new Error("Read failed");
      return { advanced: true, page: inventory.pages[++index - 1] };
    };
    const result = content.dispatch({ type: "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES", restoreFirstPage: false, restoreOriginalPage: true });
    const response = await result;
    assert.equal(response.ok, !fail);
    assert.equal(index, 2);
    assert.deepEqual(visited, [1, 2]);
    if (!fail) assert.equal(response.data.complete, true);
  }
});

test("a failed explicit reused-tab read invalidates capacity without closing the user's tab", async () => {
  const h = await syncHarness([tab(1)], { sendMessage: async (_id, message) =>
    message.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE" ? { ok: true, data: inventory.pages[0] }
      : { ok: false, error: "Session expired during pagination" } });
  const result = await h.sandbox.refreshAppleJobQueueCount(h.tabs[0]);
  assert.equal(result.ok, false);
  assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).known, false);
  assert.deepEqual(h.calls.removed, []);
  assert.deepEqual(h.calls.created, []);
});

test("explicit Analyze still paginates and matches every submission page without creating a sync tab", async () => {
  const h = await syncHarness([tab(1)], { sendMessage: async (_id, message) => {
    if (message.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE") return { ok: true, data: inventory.pages[1] };
    if (message.type === "APPLE_CAREERS_SET_SUBMITTED_HISTORY_PAGE") return { ok: true, data: inventory.pages[message.pageIndex - 1] };
    if (message.type === "APPLE_CAREERS_ADVANCE_SUBMITTED_HISTORY_PAGE") return { ok: true, data: { advanced: true, page: inventory.pages[1] } };
    throw new Error(`Unexpected message: ${message.type}`);
  } });
  const scored = [];
  h.sandbox.scoreAppleSubmittedRoles = async roles => { scored.push(...roles.map(role => role.jobId)); return { roles }; };
  const result = await h.sandbox.dispatch({ type: "APPLE_CAREERS_ANALYZE_ALL_SUBMITTED_ROLES", tabId: 1, userProfile: {}, analysisId: "explicit-analysis" });
  assert.equal(result.ok, true);
  assert.equal(result.data.warning, null);
  assert.equal(result.data.pagesRead, 2);
  assert.deepEqual(scored, inventory.pages.flatMap(page => page.roles.map(role => role.jobId)));
  assert.deepEqual(h.calls.created, []);
  assert.deepEqual(h.calls.removed, []);
});
