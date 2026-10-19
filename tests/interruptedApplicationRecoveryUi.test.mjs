import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

let server, Feedback, source;
const job = { jobId: "200670922-0836", title: "ML Engineer, Apple Foundation Models",
  url: "https://jobs.apple.com/en-us/details/200670922-0836/ml-engineer-apple-foundation-models" };
const recovery = { ...job, sessionId: "interrupted-session", reconciliationRequired: true,
  message: "Apple's Active list does not verify this exact job ID. Automatic applications remain paused." };
const oldError = "The worker restarted. Sync Submissions before starting another application; no application was resumed.";
before(async () => {
  server = await createServer({ configFile: false, plugins: [react()], appType: "custom", logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ RankingRecoveryFeedback: Feedback } = await server.ssrLoadModule("/src/sidepanel/components/RankedJobsSection.jsx"));
  source = await readFile(new URL("../src/sidepanel/components/RankedJobsSection.jsx", import.meta.url), "utf8");
});
after(async () => { await server?.close(); });
const render = props => renderToStaticMarkup(createElement(Feedback, { view: { recovered: true, recovery, error: oldError, errorJob: job }, ...props }));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }

function handlerHarness(options = {}) {
  const requests = [], status = [];
  const state = { busy: false, pending: null, result: null, refreshed: 0 };
  const sandbox = { currentRecovery: { current: { ...recovery } }, recoveryCheck: { current: null },
    currentWorkflowSession: { current: recovery.sessionId },
    busy: false, view: { running: false }, applyOpen: false,
    setBusy: value => { state.busy = value; }, setPendingAction: value => { state.pending = value; },
    setRecoveryCheckResult: value => { state.result = value; }, setStatusMessage: value => status.push(value),
    getActiveTab: options.getActiveTab || (async () => ({ id: 7, windowId: 3, url: "https://jobs.apple.com/en-us/search" })),
    chrome: { runtime: { sendMessage: async message => { requests.push(message); return options.sendMessage
      ? options.sendMessage(message) : { ok: true, data: { resolved: true, message: "Confirmed submitted. Review your batch before continuing." } }; } } },
    refresh: async () => { state.refreshed++; },
    save: () => assert.fail("A read-only status check must not save or send the user's profile")
  };
  vm.createContext(sandbox);
  const begin = source.indexOf("  async function checkInterruptedApplication(");
  const end = source.indexOf("\n\n  async function act(", begin);
  assert.ok(begin >= 0 && end > begin);
  vm.runInContext(`${source.slice(begin, end)}\nglobalThis.check = checkInterruptedApplication;`, sandbox);
  return { sandbox, requests, state, status };
}

test("recovery displays one notice with the exact role, safe review link, and explicit read-only check", () => {
  const html = render();
  assert.match(html, /Automatic applications remain paused/);
  assert.match(html, /No applications resumed/);
  assert.match(html, /reads Active submissions and refreshes the reviewed job page; it never submits an application/);
  assert.match(html, /Check Application Status/);
  assert.ok(html.includes(`href="${job.url}"`));
  assert.ok(html.includes(`Job ID ${job.jobId}`));
  assert.doesNotMatch(html, /The worker restarted|Sync Submissions before starting another application|I Allow|Confirm And Apply/);
  assert.equal((html.match(/role="alert"/g) || []).length, 1);
});

test("the recovery check is disabled during another operation or with missing reviewed identity", () => {
  for (const props of [{ busy: true }, { view: { recovery: { ...recovery, sessionId: null } } },
    { view: { recovery: { ...recovery, jobId: null } } }]) {
    assert.match(render(props), /<button[^>]*disabled=""[^>]*>Check Application Status<\/button>/);
  }
  assert.match(render({ busy: true, checking: true }), /Checking Application Status…/);
});

test("unrelated errors remain visible beside the single recovery notice", () => {
  const html = render({ error: "Chrome could not open the requested tab." });
  assert.match(html, /Chrome could not open the requested tab/);
  assert.match(html, /Automatic applications remain paused/);
  assert.equal((html.match(/role="alert"/g) || []).length, 2);
});

test("a partial scan keeps its failure visible after global progress is overwritten on restart", () => {
  const message = "Could not verify Apple search page 38 after bounded recovery. Choose Resume Scan.";
  const latestSearch = { complete: false, pagesRead: 37, failure: { message, expectedPage: 38 } };
  const html = render({ view: { recovered: false, error: null, errorJob: job }, latestSearch });
  assert.match(html, /Could not verify Apple search page 38/);
  assert.doesNotMatch(html, /Review ML Engineer|href=|Check Application Status/);
  assert.equal((html.match(/role="alert"/g) || []).length, 1);
  const existingError = render({ view: { error: message }, latestSearch });
  assert.equal((existingError.match(/Could not verify Apple search page 38/g) || []).length, 1);
  const running = render({ view: { running: true }, latestSearch });
  assert.doesNotMatch(running, /Could not verify Apple search page 38/);
});

test("the returned check reason is shown above the button and identifies the checked job", () => {
  const message = "Open the reviewed job link, then Check Application Status again.";
  const html = render({ result: { message, jobId: recovery.jobId } });
  assert.ok(html.indexOf(message) < html.indexOf(">Check Application Status</button>"));
  assert.match(html, /Application Check · Job ID 200670922-0836/);
  assert.equal((html.match(/Open the reviewed job link/g) || []).length, 1);
  const nextRole = render({ view: { recovery: { ...recovery, jobId: "200000002-0836" } },
    result: { message: "Previous role confirmed. Another application needs review.", jobId: recovery.jobId } });
  assert.match(nextRole, /Application Check · Job ID 200670922-0836/);
  assert.match(nextRole, /Job ID 200000002-0836/);
});

test("a completed check result remains visible when that workflow no longer needs recovery", () => {
  const html = render({ view: { workflowSessionId: recovery.sessionId, recovered: false, recovery: null },
    result: { message: "The interrupted submission is confirmed. Review a new batch.", jobId: recovery.jobId } });
  assert.match(html, /The interrupted submission is confirmed/);
  assert.match(html, /Application Check · Job ID 200670922-0836/);
  assert.doesNotMatch(html, /Check Application Status|Confirm And Apply/);
});

test("a wrong role or suffix cannot become the recovery review link", () => {
  for (const url of [job.url.replace("0836", "9999"), "https://example.com/role", "javascript:alert(1)"]) {
    const html = render({ view: { recovery: { ...recovery, url }, error: oldError } });
    assert.doesNotMatch(html, /href=/);
    assert.ok(html.includes(`Job ID ${job.jobId}`));
  }
});

test("a matching current role provides the review link when recovery metadata lacks it", () => {
  const html = render({ view: { recovery: { ...recovery, url: null }, currentJob: job } });
  assert.ok(html.includes(`href="${job.url}"`));
});

test("scan interruption guidance and ordinary errors remain available outside application recovery", () => {
  const html = render({ view: { recovered: true, error: "The next page timed out." }, interruptedRanking: true,
    latestSearch: { pagesRead: 13 } });
  assert.match(html, /Resume Scan to continue from page 14/);
  assert.match(html, /The next page timed out/);
  assert.doesNotMatch(html, /Check Application Status|never submits/);
});

test("an explicit status check sends only the exact workflow identity and tab then refreshes without applying", async () => {
  const h = handlerHarness();
  await h.sandbox.check();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].type, "APPLE_CAREERS_CHECK_INTERRUPTED_APPLICATION");
  assert.equal(h.requests[0].workflowSessionId, recovery.sessionId);
  assert.equal(h.requests[0].jobId, recovery.jobId);
  assert.equal(h.requests[0].tab.id, 7);
  assert.deepEqual(Object.keys(h.requests[0]).sort(), ["jobId", "tab", "type", "workflowSessionId"]);
  assert.equal(h.state.refreshed, 1);
  assert.match(h.state.result.message, /Confirmed submitted/);
  assert.deepEqual(h.status, [], "persistent recovery feedback does not duplicate a global status message");
  assert.equal(h.state.busy, false);
  assert.equal(h.state.pending, null);
});

test("a still-unknown result reports the pause and never starts or retries an application", async () => {
  const h = handlerHarness({ sendMessage: async () => ({ ok: true, data: { resolved: false } }) });
  await h.sandbox.check();
  assert.match(h.state.result.message, /still unverified/);
  assert.match(h.state.result.message, /remain paused/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.state.refreshed, 1);
});

test("duplicate clicks are locked synchronously before the tab lookup completes", async () => {
  const tab = deferred();
  const h = handlerHarness({ getActiveTab: () => tab.promise });
  const first = h.sandbox.check();
  await h.sandbox.check();
  assert.equal(h.state.busy, true);
  assert.equal(h.requests.length, 0);
  tab.resolve({ id: 7 });
  await first;
  assert.equal(h.requests.length, 1);
});

test("a changed recovered job during tab lookup cannot dispatch a stale check", async () => {
  const tab = deferred();
  const h = handlerHarness({ getActiveTab: () => tab.promise });
  const pending = h.sandbox.check();
  h.sandbox.currentRecovery.current = { ...recovery, jobId: "200670922-9999" };
  tab.resolve({ id: 7 });
  await pending;
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.result, null);
  assert.equal(h.state.busy, false);
});

test("a late status response cannot report success for a newer recovery session", async () => {
  const response = deferred();
  const h = handlerHarness({ sendMessage: () => response.promise });
  const pending = h.sandbox.check();
  await tick();
  h.sandbox.currentRecovery.current = { ...recovery, sessionId: "new-session" };
  h.sandbox.currentWorkflowSession.current = "new-session";
  response.resolve({ ok: true, data: { resolved: true, message: "Old response" } });
  await pending;
  assert.equal(h.state.result, null);
  assert.deepEqual(h.status, []);
  assert.equal(h.state.refreshed, 0);
});

test("a self-resolving operation retains its response when recovery disappears within the same workflow", async () => {
  const response = deferred();
  const h = handlerHarness({ sendMessage: () => response.promise });
  const pending = h.sandbox.check();
  await tick();
  h.sandbox.currentRecovery.current = null;
  response.resolve({ ok: true, data: { resolved: true, message: "Exact application confirmed." } });
  await pending;
  assert.equal(h.state.result.message, "Exact application confirmed.");
  assert.equal(h.state.result.jobId, recovery.jobId);
  assert.equal(h.state.result.sessionId, recovery.sessionId);
  assert.equal(h.state.refreshed, 1);
});

test("a response stays associated with the checked role when another role needs review in the same workflow", async () => {
  const response = deferred();
  const h = handlerHarness({ sendMessage: () => response.promise });
  const pending = h.sandbox.check();
  await tick();
  h.sandbox.currentRecovery.current = { ...recovery, jobId: "200000002-0836" };
  response.resolve({ ok: true, data: { resolved: false, message: "This role is confirmed. Another role needs review." } });
  await pending;
  assert.match(h.state.result.message, /Another role needs review/);
  assert.equal(h.state.result.jobId, recovery.jobId);
  assert.equal(h.requests.length, 1);
});

test("a new workflow without a recovery notice still rejects a previous workflow's late result", async () => {
  const response = deferred();
  const h = handlerHarness({ sendMessage: () => response.promise });
  const pending = h.sandbox.check();
  await tick();
  h.sandbox.currentRecovery.current = null;
  h.sandbox.currentWorkflowSession.current = "new-session";
  response.resolve({ ok: true, data: { resolved: true, message: "Old workflow confirmed." } });
  await pending;
  assert.equal(h.state.result, null);
  assert.equal(h.state.refreshed, 0);
});

function refreshHarness() {
  const requests = [];
  const state = { view: null, error: "" };
  const sandbox = { viewPreferencesLoaded: true, topN: 8, profile: {},
    initializedTop: { current: true }, rankingRefreshGeneration: { current: 0 }, rankingRefreshPending: { current: null },
    setTopN() {}, setTopNDraft() {}, setView: value => { state.view = value; }, setError: value => { state.error = value; },
    chrome: { runtime: { sendMessage: () => { const request = deferred(); requests.push(request); return request.promise; } } } };
  vm.createContext(sandbox);
  const prefix = "  const refresh = useCallback(";
  const start = source.indexOf(prefix) + prefix.length;
  const end = source.indexOf("\n  }, [profile, topN, viewPreferencesLoaded]);", start);
  assert.ok(start >= prefix.length && end > start);
  vm.runInContext(`globalThis.refresh = ${source.slice(start, end)}\n  };`, sandbox);
  return { sandbox, requests, state };
}

function installPolling(h) {
  h.sandbox.view = { running: true };
  h.sandbox.console = { error: failure => { h.state.pollError = failure; } };
  h.sandbox.useEffect = effect => { h.state.stopPolling = effect(); };
  h.sandbox.setInterval = (callback, intervalMs) => { h.state.tick = callback; h.state.intervalMs = intervalMs; return 1; };
  h.sandbox.clearInterval = () => { h.state.stopped = true; };
  const begin = source.indexOf("  useEffect(() => {\n    if (!view?.running) return undefined;");
  const suffix = "\n  }, [view?.running, refresh]);";
  const end = source.indexOf(suffix, begin) + suffix.length;
  assert.ok(begin >= 0 && end > begin);
  vm.runInContext(source.slice(begin, end), h.sandbox);
}

test("a late ranking read cannot replace a newer reconciled snapshot", async () => {
  const h = refreshHarness();
  const old = h.sandbox.refresh();
  const latest = h.sandbox.refresh();
  const confirmed = { workflowSessionId: recovery.sessionId, recovery: null, running: false };
  h.requests[1].resolve({ ok: true, data: confirmed });
  await latest;
  h.requests[0].resolve({ ok: true, data: { recovery, running: false } });
  await old;
  assert.equal(h.state.view, confirmed);
  assert.equal(h.state.error, "");
});

test("a stale ranking failure cannot overwrite a successful newer refresh", async () => {
  const h = refreshHarness();
  const old = h.sandbox.refresh();
  const latest = h.sandbox.refresh();
  const confirmed = { recovery: null };
  h.requests[1].resolve({ ok: true, data: confirmed }); await latest;
  h.requests[0].resolve({ ok: false, error: "Stale failed read" }); await old;
  assert.equal(h.state.view, confirmed);
  assert.equal(h.state.error, "");
});

test("the latest failed ranking refresh still reports its real error", async () => {
  const h = refreshHarness();
  const pending = h.sandbox.refresh();
  h.requests[0].resolve({ ok: false, error: "Current read failed" });
  await pending;
  assert.equal(h.state.error, "Current read failed");
});

test("one-second polling waits for a slower ranking response instead of starving its result", async () => {
  const h = refreshHarness(); installPolling(h);
  assert.equal(h.state.intervalMs, 1000);
  h.state.tick();
  // Each tick represents another second while the first read remains pending.
  h.state.tick(); h.state.tick(); h.state.tick();
  assert.equal(h.requests.length, 1);
  const finished = { running: false, recovery: null };
  h.requests[0].resolve({ ok: true, data: finished });
  await tick();
  assert.equal(h.state.view, finished);
  assert.equal(h.sandbox.rankingRefreshPending.current, null);
  h.state.stopPolling();
  assert.equal(h.state.stopped, true);
});

test("a newer explicit or scoped refresh retains the polling lock when the older read finishes", async () => {
  const h = refreshHarness(); installPolling(h);
  h.state.tick();
  h.sandbox.profile = { llmModel: "gpt-4.1" };
  const latest = h.sandbox.refresh(12);
  assert.equal(h.requests.length, 2);
  const pendingGeneration = h.sandbox.rankingRefreshPending.current;
  h.requests[0].resolve({ ok: true, data: { running: true, old: true } });
  await tick();
  assert.equal(h.sandbox.rankingRefreshPending.current, pendingGeneration);
  h.state.tick(); h.state.tick();
  assert.equal(h.requests.length, 2);
  const finished = { running: false, topN: 12 };
  h.requests[1].resolve({ ok: true, data: finished });
  await latest;
  assert.equal(h.state.view, finished);
  assert.equal(h.sandbox.rankingRefreshPending.current, null);
  h.state.stopPolling();
});

test("a rejected latest ranking message releases the polling guard and permits the next check", async () => {
  const h = refreshHarness(); installPolling(h);
  h.state.tick();
  h.requests[0].reject(new Error("The background worker restarted"));
  await tick();
  assert.equal(h.sandbox.rankingRefreshPending.current, null);
  assert.match(h.state.pollError.message, /worker restarted/);
  h.state.tick();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ ok: true, data: { running: false } });
  await tick();
  assert.equal(h.state.view.running, false);
  h.state.stopPolling();
});

test("a rejected superseded message cannot clear a newer refresh's pending token", async () => {
  const h = refreshHarness();
  const old = h.sandbox.refresh();
  const latest = h.sandbox.refresh();
  const latestGeneration = h.sandbox.rankingRefreshPending.current;
  h.requests[0].reject(new Error("Older request failed"));
  await assert.rejects(old, /Older request failed/);
  assert.equal(h.sandbox.rankingRefreshPending.current, latestGeneration);
  h.requests[1].resolve({ ok: true, data: { running: false } });
  await latest;
  assert.equal(h.sandbox.rankingRefreshPending.current, null);
});

test("failed or malformed checks retain manual-review feedback without claiming an outcome", async () => {
  for (const result of [undefined, { ok: false, error: "Sign in to Apple Careers first." }, { ok: true, data: {} }]) {
    const h = handlerHarness({ sendMessage: async () => result });
    await h.sandbox.check();
    assert.equal(h.state.result.failed, true);
    assert.equal(h.state.refreshed, 0);
    assert.equal(h.requests.length, 1);
    assert.equal(h.state.busy, false);
    assert.doesNotMatch(h.state.result.message, /Confirmed submitted/);
  }
});

test("a running workflow, open review sheet, or missing identity cannot start a recovery check", async () => {
  for (const update of [h => { h.sandbox.view.running = true; }, h => { h.sandbox.applyOpen = true; },
    h => { h.sandbox.busy = true; }, h => { h.sandbox.currentRecovery.current.sessionId = null; },
    h => { h.sandbox.currentRecovery.current.reconciliationRequired = false; }]) {
    const h = handlerHarness(); update(h); await h.sandbox.check();
    assert.equal(h.requests.length, 0);
  }
});
