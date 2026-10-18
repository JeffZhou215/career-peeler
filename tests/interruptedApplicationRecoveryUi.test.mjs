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
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function handlerHarness(options = {}) {
  const requests = [], status = [];
  const state = { busy: false, pending: null, result: null, refreshed: 0 };
  const sandbox = { currentRecovery: { current: { ...recovery } }, recoveryCheck: { current: null },
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
  response.resolve({ ok: true, data: { resolved: true, message: "Old response" } });
  await pending;
  assert.equal(h.state.result, null);
  assert.deepEqual(h.status, []);
  assert.equal(h.state.refreshed, 0);
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
