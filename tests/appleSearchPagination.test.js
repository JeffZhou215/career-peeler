const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createContentHarness } = require("./helpers/appleWorkflowHarness.cjs");

const searchUrl = "https://jobs.apple.com/en-us/search?location=USA&team=software";
const job = id => ({ jobId: String(id), title: `Role ${id}`,
  url: `https://jobs.apple.com/en-us/details/${id}/software-engineer`, alreadyAppliedFromList: false });
const element = (text = "", attributes = {}) => ({ innerText: text, textContent: text, isConnected: true,
  getAttribute: name => attributes[name] ?? null, getBoundingClientRect: () => ({ width: 100, height: 30 }) });

function fixture(options = {}) {
  const sandbox = createContentHarness({ url: options.url || searchUrl });
  let now = 0;
  const events = [];
  const state = { current: 1, total: 3, ids: ["200000001-0836", "200000002-0836"], loading: false,
    metadata: true, nextDisabled: null, previousDisabled: null, nextMissing: false, error: "", ...options };
  const input = element();
  Object.defineProperty(input, "value", { get: () => String(state.current) });
  const total = element();
  Object.defineProperty(total, "textContent", { get: () => String(state.total) });
  const next = element("", { "aria-label": "Next Page" });
  const previous = element("", { "aria-label": "Previous Page" });
  Object.defineProperty(next, "disabled", { get: () => state.nextDisabled ?? state.current >= state.total });
  Object.defineProperty(previous, "disabled", { get: () => state.previousDisabled ?? state.current <= 1 });
  let clicks = 0;
  next.click = () => { clicks++; options.onClick?.({ state, schedule, next }); };
  const pagination = element();
  pagination.querySelector = selector => selector === "#pagination-search-page-number" ? input
    : selector.includes("paginationTotalPages") ? total
      : selector.includes("Next Page") ? state.nextMissing ? null : next
        : selector.includes("Previous Page") ? previous : null;
  sandbox.document.querySelector = selector => selector === "#search-pagnation" ? state.metadata ? pagination : null
    : selector === "#search-pagnation #pagination-search-page-number" ? state.metadata ? input : null : null;
  sandbox.document.querySelectorAll = selector => selector === "[aria-busy='true'], [role='progressbar']"
    ? state.loading ? [element("Loading")] : []
      : selector === "[role='alert']" ? state.error ? [element(state.error)] : []
        : selector === "a[href], button, [role='button']" ? [previous, next] : [];
  sandbox.collectJobLinks = () => state.ids.map(job);
  sandbox.Date = class extends Date { static now() { return now; } };
  sandbox.delay = async ms => { now += ms; for (const event of events.filter(event => !event.done && event.at <= now)) {
    event.done = true; event.callback();
  } };
  function schedule(after, callback) { events.push({ at: now + after, callback, done: false }); }
  const collect = (extra = {}) => sandbox.dispatch({ type: "APPLE_CAREERS_COLLECT_JOB_LINKS", verifySearchPagination: true,
    expectedSearchUrl: searchUrl, expectedPage: state.current, timeoutMs: 4000, ...extra });
  const advance = (extra = {}) => sandbox.dispatch({ type: "APPLE_CAREERS_GO_TO_NEXT_PAGE", expectedSearchUrl: searchUrl,
    expectedFromPage: 1, expectedPage: 2, previousPageSignature: "200000001-0836|200000002-0836", timeoutMs: 4000, ...extra });
  return { sandbox, state, next, previous, input, pagination, schedule, collect, advance,
    get clicks() { return clicks; }, get now() { return now; } };
}

test("ranking collection proves the live ordinal and stable complete result identity", async () => {
  const h = fixture({ current: 13, total: 200, url: `${searchUrl}&page=1` });
  const response = await h.collect();
  assert.equal(response.ok, true);
  assert.equal(response.data.currentPage, 13);
  assert.equal(response.data.pageCount, 200);
  assert.equal(response.data.paginationVerified, true);
  assert.equal(response.data.hasNextPage, true);
  assert.equal(h.sandbox.getCurrentResultsPage(), 13);
  assert.equal(h.now, 900);
});

test("strict collection waits through delayed metadata and temporarily disabled Next", async () => {
  const h = fixture({ metadata: false, nextDisabled: true });
  h.schedule(600, () => { h.state.metadata = true; });
  h.schedule(1500, () => { h.state.nextDisabled = false; });
  const response = await h.collect();
  assert.equal(response.ok, true);
  assert.equal(response.data.hasNextPage, true);
  assert.equal(h.now, 2400);
});

test("SPA replacements with unchanged row count reset the settling window", async () => {
  const h = fixture();
  h.schedule(600, () => { h.state.ids = ["200000003-0836", "200000004-0836"]; });
  h.schedule(1200, () => { h.state.ids = ["200000005-0836", "200000006-0836"]; });
  const response = await h.collect();
  assert.equal(response.ok, true);
  assert.equal(response.data.links[0].jobId, "200000005-0836");
  assert.equal(h.now, 2100);
});

test("a final page needs total metadata and a disabled Next, not a missing control", async () => {
  const final = fixture({ current: 3, total: 3 });
  assert.equal((await final.collect()).data.hasNextPage, false);
  for (const options of [{ current: 3, total: 3, nextMissing: true }, { metadata: false },
    { current: 3, total: "invalid" }, { current: 3, total: 3, nextDisabled: false }]) {
    const response = await fixture(options).collect({ timeoutMs: 1200 });
    assert.equal(response.ok, false);
    assert.equal(response.data.errorType, "search_pagination_unavailable");
    assert.equal(response.data.retryable, true);
  }
});

test("strict readers reject changed filters and wrong page identities", async () => {
  for (const [options, extra, errorType] of [[{ url: `${searchUrl}&keyword=GPU` }, {}, "search_filter_changed"],
    [{ current: 3 }, { expectedPage: 2 }, "search_page_mismatch"]]) {
    const response = await fixture(options).collect(extra);
    assert.equal(response.ok, false);
    assert.equal(response.data.errorType, errorType);
    assert.equal(response.data.retryable, false);
  }
  const behind = await fixture({ current: 1 }).collect({ expectedPage: 2, timeoutMs: 1200 });
  assert.equal(behind.ok, false);
  assert.equal(behind.data.errorType, "search_page_not_ready");
});

test("loading, page errors, and authentication failures cannot prove the terminal page", async () => {
  for (const [options, errorType] of [[{ current: 3, total: 3, loading: true }, "search_results_loading"],
    [{ current: 3, total: 3, error: "Unable to load results. Try again." }, "search_results_failed"]]) {
    const response = await fixture(options).collect({ timeoutMs: 1200 });
    assert.equal(response.ok, false);
    assert.equal(response.data.errorType, errorType);
  }
  const auth = fixture();
  auth.sandbox.document.body.innerText = "Please sign in to continue";
  const response = await auth.collect();
  assert.equal(response.ok, false);
  assert.equal(response.data.errorType, "session_or_login_required");
  assert.equal(response.data.retryable, false);
});

test("Next clicks the verified container node after disabled controls become ready", async () => {
  const h = fixture({ nextDisabled: true, onClick: ({ state, schedule }) => {
    state.loading = true;
    schedule(600, () => { state.current = 2; });
    schedule(1500, () => { state.ids = ["200000003-0836", "200000004-0836"]; state.loading = false; });
  } });
  const wrong = element("Next Page");
  wrong.disabled = true;
  wrong.click = () => { throw new Error("Wrong control clicked"); };
  const original = h.sandbox.document.querySelectorAll;
  h.sandbox.document.querySelectorAll = selector => selector === "a[href], button, [role='button']"
    ? [wrong, h.next] : original(selector);
  h.schedule(900, () => { h.state.nextDisabled = false; });
  const response = await h.advance();
  assert.equal(response.ok, true);
  assert.equal(response.currentPage, 2);
  assert.equal(h.clicks, 1);
  assert.equal(h.now, 3300);
});

test("Next waits for target ordinal and a settled different identity before succeeding", async () => {
  const h = fixture({ onClick: ({ state, schedule }) => {
    schedule(300, () => { state.current = 2; });
    schedule(1200, () => { state.ids = ["200000003-0836", "200000004-0836"]; });
    schedule(1800, () => { state.ids = ["200000005-0836", "200000006-0836"]; });
  } });
  const response = await h.advance();
  assert.equal(response.ok, true);
  assert.equal(h.now, 2700);
  assert.equal(h.clicks, 1);
});

test("delayed transitions beyond the old twelve-second timeout succeed with one click", async () => {
  const h = fixture({ onClick: ({ state, schedule }) => {
    schedule(15000, () => { state.current = 2; state.ids = ["200000003-0836"]; });
  } });
  const response = await h.advance({ timeoutMs: 30000 });
  assert.equal(response.ok, true);
  assert.equal(h.clicks, 1);
  assert.equal(h.now, 15900);
});

test("a timed-out Next is never clicked a second time", async () => {
  const h = fixture();
  const response = await h.advance({ timeoutMs: 1200 });
  assert.equal(response.ok, false);
  assert.equal(response.data.retryable, true);
  assert.equal(h.clicks, 1);
});

test("a target ordinal with unchanged job IDs remains unverified", async () => {
  const h = fixture({ onClick: ({ state }) => { state.current = 2; } });
  const response = await h.advance({ timeoutMs: 1200 });
  assert.equal(response.ok, false);
  assert.equal(response.data.errorType, "search_page_not_ready");
  assert.equal(h.clicks, 1);
});

test("an earlier nonadjacent page must settle to new results before collection succeeds", async () => {
  const h = fixture({ current: 3, total: 4 });
  h.schedule(2100, () => { h.state.ids = ["200000005-0836"]; });
  const response = await h.collect({ previousPageSignature: "200000003-0836|200000004-0836",
    seenPageSignatures: ["200000001-0836|200000002-0836", "200000003-0836|200000004-0836"] });
  assert.equal(response.ok, true);
  assert.equal(response.data.links[0].jobId, "200000005-0836");
  assert.equal(h.now, 3000, "old results lasting longer than the settling window cannot pass");
});

test("Next does not accept an older page's results or click twice during rerendering", async () => {
  const h = fixture({ current: 2, total: 4, ids: ["200000003-0836"], onClick: ({ state, schedule }) => {
    state.current = 3;
    state.ids = ["200000001-0836"];
    schedule(1800, () => { state.ids = ["200000005-0836"]; });
  } });
  const response = await h.advance({ expectedFromPage: 2, expectedPage: 3,
    previousPageSignature: "200000003-0836", seenPageSignatures: ["200000001-0836", "200000003-0836"] });
  assert.equal(response.ok, true);
  assert.equal(h.now, 2700);
  assert.equal(h.clicks, 1);
});

test("persistently repeated nonadjacent results return a retryable failure", async () => {
  const h = fixture({ current: 3, total: 4 });
  const response = await h.collect({ previousPageSignature: "200000003-0836",
    seenPageSignatures: ["200000001-0836|200000002-0836", "200000003-0836"], timeoutMs: 1500 });
  assert.equal(response.ok, false);
  assert.equal(response.data.errorType, "search_page_repeated");
  assert.equal(response.data.retryable, true);
  assert.match(response.error, /page 3/);
});

test("a replay after the intended transition verifies without another click", async () => {
  const h = fixture({ current: 2, ids: ["200000003-0836"] });
  const response = await h.advance();
  assert.equal(response.ok, true);
  assert.equal(response.alreadyAdvanced, true);
  assert.equal(h.clicks, 0);
});

test("page skips, changed results before clicking, and changed filters fail closed", async () => {
  for (const [options, errorType] of [[{ current: 3 }, "search_page_mismatch"],
    [{ ids: ["200000003-0836"] }, "search_page_changed"], [{ url: `${searchUrl}&keyword=GPU` }, "search_filter_changed"]]) {
    const h = fixture(options);
    const response = await h.advance();
    assert.equal(response.ok, false);
    assert.equal(response.data.errorType, errorType);
    assert.equal(response.data.retryable, false);
    assert.equal(h.clicks, 0);
  }
});

test("filter drift and page skipping during transition stop after only one click", async () => {
  for (const change of [h => { h.sandbox.window.location = new URL(`${searchUrl}&keyword=GPU`); },
    h => { h.state.current = 3; h.state.ids = ["200000003-0836"]; }]) {
    const h = fixture();
    let clicks = 0;
    h.next.click = () => { clicks++; change(h); };
    const response = await h.advance();
    assert.equal(response.ok, false);
    assert.equal(response.data.retryable, false);
    assert.equal(clicks, 1);
  }
});

test("detached or hidden pagination never proves a complete search", async () => {
  const h = fixture({ current: 1, total: 1 });
  h.pagination.getBoundingClientRect = () => ({ width: 0, height: 0 });
  assert.equal((await h.collect({ timeoutMs: 1200 })).ok, false);
  const detached = fixture();
  detached.next.isConnected = false;
  const response = await detached.advance({ timeoutMs: 1200 });
  assert.equal(response.ok, false);
  assert.equal(detached.clicks, 0);
});

test("hidden enabled or detached boundary controls cannot prove the first or final page", async () => {
  for (const boundary of ["next", "previous", "detached"]) {
    const h = fixture(boundary === "previous" ? { current: 1, previousDisabled: false }
      : { current: 3, total: 3, nextDisabled: false });
    const control = boundary === "previous" ? h.previous : h.next;
    if (boundary === "detached") control.isConnected = false;
    else control.getBoundingClientRect = () => ({ width: 0, height: 0 });
    const response = await h.collect({ timeoutMs: 1200 });
    assert.equal(response.ok, false);
    assert.equal(response.data.errorType, "search_pagination_unavailable");
  }
});

test("invalid next-page ownership and login redirects return non-retryable failures", async () => {
  for (const extra of [{ expectedPage: 3 }, { expectedFromPage: 0 }, { previousPageSignature: "" },
    { expectedSearchUrl: "not a URL" }]) {
    const h = fixture();
    const response = await h.advance(extra);
    assert.equal(response.ok, false);
    assert.equal(response.data.retryable, false);
    assert.equal(h.clicks, 0);
  }
  const login = fixture({ url: "https://jobs.apple.com/en-us/login" });
  const response = await login.collect();
  assert.equal(response.ok, false);
  assert.equal(response.data.errorType, "session_or_login_required");
});

test("legacy Next uses the chosen enabled control, preserving the generic caller", async () => {
  const h = fixture({ onClick: ({ state }) => { state.ids = ["200000003-0836"]; } });
  const disabled = element("Next Page");
  disabled.disabled = true;
  disabled.click = () => { throw new Error("Disabled duplicate clicked"); };
  h.sandbox.HTMLAnchorElement = class {};
  h.sandbox.document.querySelectorAll = () => [disabled, h.next];
  const response = await h.sandbox.dispatch({ type: "APPLE_CAREERS_GO_TO_NEXT_PAGE" });
  assert.equal(response.ok, true);
  assert.equal(h.clicks, 1);
});

test("absent offset no longer masks an existing current-page control", () => {
  const h = fixture({ metadata: false });
  h.sandbox.document.querySelectorAll = () => [element("7")];
  assert.equal(h.sandbox.getCurrentResultsPage(), 7);
  h.sandbox.window.location = new URL(`${searchUrl}&offset=40&limit=20`);
  assert.equal(h.sandbox.getCurrentResultsPage(), 3);
});
