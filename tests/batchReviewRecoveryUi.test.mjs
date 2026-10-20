import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

let server, Review, source;
const selectedIds = ["200000101-0836", "200000102-9999"];
const batch = { jobs: selectedIds.map((jobId, index) => ({ jobId, title: `Engineer ${index + 1}`, score: 90,
  eligible: true, url: `https://jobs.apple.com/en-us/details/${jobId}/engineer` })),
  batchToken: "reviewed-batch", capacity: { known: true, remaining: 12 }, reviewCount: 0 };
const recoveryJob = { jobId: "200000103-0836", title: "Previously Interrupted Engineer",
  url: "https://jobs.apple.com/en-us/details/200000103-0836/previously-interrupted-engineer", source: "recovery" };
before(async () => {
  server = await createServer({ configFile: false, plugins: [react()], appType: "custom", logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ ApplicationBatchReview: Review } = await server.ssrLoadModule("/src/sidepanel/components/RankedJobsSection.jsx"));
  source = await readFile(new URL("../src/sidepanel/components/RankedJobsSection.jsx", import.meta.url), "utf8");
});
after(async () => { await server?.close(); });
const render = props => renderToStaticMarkup(createElement(Review, { selectedCount: 2, allowSubmission: true,
  reviewAcknowledged: true, onReviewChange() {}, onConsentChange() {}, onConfirm() {}, onRetry() {}, onCancel() {}, onOpenSetup() {}, ...props }));

function handlerSource(name, nextName) {
  return source.slice(source.indexOf(`  async function ${name}(`), source.indexOf(nextName, source.indexOf(`  async function ${name}(`)));
}
function preparationHarness(response = { ok: true, data: batch }, options = {}) {
  const events = [];
  const requests = [];
  let requestNumber = 0;
  const state = { open: false, busy: false, batch: { jobs: [] }, count: 0, error: "", errorType: "", errorJob: null,
    view: { capacity: { known: true, remaining: 49 } } };
  const sandbox = { selectedQueueIds: [...selectedIds], batchSelection: { current: [] },
    batchReviewGeneration: { current: 0 }, batchReviewRequest: { current: null },
    batchReviewClosePending: { current: false },
    crypto: { randomUUID: () => `review-request-${++requestNumber}` },
    setReviewSelectionCount: count => { state.count = count; events.push("count"); },
    setApplicationBatch: value => { state.batch = value; events.push("batch"); },
    setApplyOpen: value => { state.open = value; events.push("open"); },
    setBusy: value => { state.busy = value; events.push("busy"); },
    setPendingAction: value => { state.pending = value; },
    setError: value => { state.error = value; }, setBatchReviewErrorType: value => { state.errorType = value; },
    setBatchReviewErrorJob: value => { state.errorJob = value; },
    setReviewedQueueToken: value => { state.reviewToken = value; },
    setView: update => { state.view = update(state.view); },
    getActiveTab: options.getActiveTab || (async () => ({ id: 7, windowId: 1, url: "https://jobs.apple.com/en-us/search" })),
    save: options.save || (async () => ({ resume: "offline" })),
    chrome: { runtime: { sendMessage: async message => { requests.push(message);
      return options.sendMessage ? options.sendMessage(message) : response; } } },
    refresh: async () => { state.refreshed = true; await options.refresh?.(state); }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${handlerSource("reviewSelectedBatch", "\n\n  useEffect(")}\nglobalThis.prepare = reviewSelectedBatch; globalThis.cancel = cancelBatchReview;`, sandbox);
  return { sandbox, state, events, requests };
}

test("loading review retains the requested count and never claims cached capacity or shows Confirm", () => {
  const html = render({ preparing: true, busy: true, capacity: { known: true, remaining: 49 } });
  assert.match(html, /2 Selected · Capacity Will Be Verified/);
  assert.match(html, /Checking Previous Applications…/);
  assert.match(html, /submission-sync-spinner/);
  assert.doesNotMatch(html, /0 Selected|49|Confirm And Apply|Retry Check/);
  assert.match(html, /<button(?![^>]*disabled)[^>]*>Cancel<\/button>/);
});

test("an unselected previous application remains identifiable and clickable when batch preparation fails", () => {
  assert.ok(!selectedIds.includes(recoveryJob.jobId));
  const html = render({ batch: null, error: "The previous application outcome needs review.",
    errorType: "submission_outcome_unknown", errorJob: recoveryJob });
  assert.match(html, /Previous Application Needs Review/);
  assert.ok(html.includes(recoveryJob.title));
  assert.match(html, /Job ID 200000103-0836/);
  assert.ok(html.includes(`href="${recoveryJob.url}"`));
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /2 Selected · Capacity Will Be Verified/);
  assert.doesNotMatch(html, /sheet-job-list|Confirm And Apply|I Allow These Applications/);
  for (const id of selectedIds) assert.ok(!html.includes(id), "a prior application must not appear as a selected batch role");
});

test("selected role error context keeps the full suffix without labeling it as a previous application", () => {
  const errorJob = { ...batch.jobs[1], source: "selection" };
  const html = render({ error: "The selected role changed.", errorType: "batch_review_failed", errorJob });
  assert.match(html, /Job ID 200000102-9999/);
  assert.ok(html.includes(errorJob.title));
  assert.ok(html.includes(`href="${errorJob.url}"`));
  assert.doesNotMatch(html, /Previous Application Needs Review|Confirm And Apply/);
});

test("unsafe or mismatched blocking-role URLs retain the exact ID without a clickable link", () => {
  for (const url of [
    "this is not a URL",
    "javascript:alert(1)",
    "https://example.com/en-us/details/200000103-0836/engineer",
    "https://jobs.apple.com.example.com/en-us/details/200000103-0836/engineer",
    "http://jobs.apple.com/en-us/details/200000103-0836/engineer",
    "https://jobs.apple.com/en-us/details/200000103-9999/engineer",
    "https://jobs.apple.com/en-us/details/200000103/engineer",
    "https://jobs.apple.com/en-us/search",
    undefined
  ]) {
    const html = render({ error: "Review the affected application.", errorType: "submission_outcome_unknown",
      errorJob: { ...recoveryJob, url } });
    assert.match(html, /Job ID 200000103-0836/);
    assert.doesNotMatch(html, /<a\b|href=/, `unsafe or mismatched URL must not create a link: ${url}`);
    assert.doesNotMatch(html, /Confirm And Apply/);
  }
});

test("generic errors never fabricate a role ID or infer a blocking role from the prepared batch", () => {
  for (const errorJob of [undefined, null, { title: "Unidentified role", source: "recovery" }]) {
    const html = render({ batch, error: "Apple could not verify inventory.", errorType: "submission_sync_failed", errorJob });
    assert.match(html, /Apple could not verify inventory/);
    assert.match(html, /Retry Check/);
    assert.doesNotMatch(html, /Job ID|Previous Application Needs Review|<a\b|Confirm And Apply|I Allow These Applications/);
    for (const id of selectedIds) assert.ok(!html.includes(id));
  }
});

test("actual application start remains protected from closing while read-only preparation permits it", () => {
  const html = render({ batch, busy: true, starting: true });
  assert.match(html, /<button[^>]*disabled=""[^>]*>Cancel<\/button>/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Starting…<\/button>/);
  assert.match(source, /onClose=\{cancelBatchReview\}[^>]*busy=\{busy && pendingAction !== "prepare"\}/);
});

test("failed inventory checks remain in the sheet with Retry and no submission controls", () => {
  for (const errorType of ["submission_sync_failed", "recovery_tab_required", "stopped_by_user"]) {
    const html = render({ error: "Sign in to Apple and retry the check.", errorType, capacity: { known: true, remaining: 12 } });
    assert.match(html, /role="alert"/);
    assert.match(html, /Retry Check/);
    assert.match(html, /2 Selected · Capacity Will Be Verified/);
    assert.doesNotMatch(html, /Confirm And Apply|I Allow These Applications/);
  }
});

test("confirmed changes and unknown outcomes require reviewing the selection instead of retrying submission", () => {
  for (const errorType of ["batch_review_failed", "submission_outcome_unknown"]) {
    const html = render({ error: "Review the affected role before continuing.", errorType });
    assert.match(html, /Back To Queue/);
    assert.doesNotMatch(html, /Retry Check|Confirm And Apply|I Allow These Applications/);
  }
});

test("successful reconciliation reports the check and requires a new explicit batch confirmation", () => {
  const html = render({ batch: { ...batch, reconciliationPerformed: true } });
  assert.match(html, /Previous Applications Checked/);
  assert.match(html, /Review And Confirm This Batch Before Applying/);
  assert.match(html, /Confirm And Apply \(2\)/);
  for (const id of selectedIds) assert.ok(html.includes(id));
  assert.doesNotMatch(html, /Retry Check|Checking Previous Applications…/);
});

test("a prepared cached count is not advertised as a fresh sync and retains consent safeguards", () => {
  const html = render({ batch, allowSubmission: false });
  assert.match(html, /Capacity Is Verified Before Applying/);
  assert.doesNotMatch(html, /Previous Applications Checked|Synced just now|Freshly Verified/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Confirm And Apply \(2\)<\/button>/);
  const concerns = render({ batch: { ...batch, reviewToken: "concerns", reviewCount: 1 }, reviewAcknowledged: false });
  assert.match(concerns, /I Reviewed The Match Concerns/);
  assert.match(concerns, /<button[^>]*disabled=""[^>]*>Confirm And Apply \(2\)<\/button>/);
});

test("an error cannot leave the old prepared batch actionable", () => {
  const html = render({ batch, error: "The reviewed batch changed.", errorType: "batch_review_failed" });
  assert.doesNotMatch(html, /Confirm And Apply|I Allow These Applications/);
  assert.match(html, /Back To Queue/);
});

test("Apply Selected opens loading feedback before awaiting a tab and sends the exact selection with tab context", async () => {
  let resolveTab;
  const tabReady = new Promise(resolve => { resolveTab = resolve; });
  const h = preparationHarness(undefined, { getActiveTab: () => tabReady });
  const pending = h.sandbox.prepare();
  assert.equal(h.state.open, true);
  assert.equal(h.state.busy, true);
  assert.equal(h.state.batch, null);
  assert.equal(h.state.count, 2);
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.events.slice(0, 4), ["count", "batch", "open", "busy"]);
  resolveTab({ id: 7, windowId: 1 });
  await pending;
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].type, "APPLE_CAREERS_PREPARE_APPLICATION_BATCH");
  assert.deepEqual([...h.requests[0].selectedIds], selectedIds);
  assert.equal(h.requests[0].tab.id, 7);
  assert.equal(h.requests[0].reviewRequestId, "review-request-1");
  assert.equal(h.state.batch, batch);
  assert.equal(h.state.view.capacity, batch.capacity);
  assert.equal(h.state.busy, false);
});

test("preparation failures preserve the original selection for Retry even if the live queue changes", async () => {
  const h = preparationHarness({ ok: false, error: "Apple could not verify inventory.", errorType: "submission_sync_failed" });
  await h.sandbox.prepare();
  assert.equal(h.state.open, true);
  assert.equal(h.state.batch, null);
  assert.equal(h.state.count, 2);
  assert.equal(h.state.errorType, "submission_sync_failed");
  assert.equal(h.state.refreshed, true);
  h.sandbox.selectedQueueIds = [];
  await h.sandbox.prepare(h.sandbox.batchSelection.current);
  assert.deepEqual([...h.requests[1].selectedIds], selectedIds);
  assert.equal(h.state.count, 2);
});

test("preparation failures preserve top-level and nested blocking-job context through a refreshed ranking view", async () => {
  for (const response of [
    { ok: false, error: "The previous application needs review.", errorType: "submission_outcome_unknown", errorJob: recoveryJob },
    { ok: false, error: "The previous application needs review.", data: { errorType: "submission_outcome_unknown", errorJob: recoveryJob } }
  ]) {
    const h = preparationHarness(response, { refresh: state => {
      assert.deepEqual(state.errorJob, recoveryJob, "the error context is installed before refreshing");
      state.view = { capacity: { known: false }, recovery: null, errorJob: null };
    } });
    await h.sandbox.prepare();
    assert.equal(h.state.errorType, "submission_outcome_unknown");
    assert.deepEqual(h.state.errorJob, recoveryJob);
    assert.equal(h.state.view.errorJob, null, "the ranking snapshot does not supply the retained context");
    assert.equal(h.state.batch, null);
    assert.equal(h.state.open, true);
    const html = render({ batch: h.state.batch, error: h.state.error, errorType: h.state.errorType, errorJob: h.state.errorJob });
    assert.ok(html.includes(`href="${recoveryJob.url}"`));
    assert.doesNotMatch(html, /Confirm And Apply/);
  }
});

test("a thrown preparation failure preserves its blocking-job context", async () => {
  const h = preparationHarness(undefined, { save: async () => {
    throw Object.assign(new Error("The previous application cannot be reconciled."),
      { errorType: "submission_outcome_unknown", errorJob: recoveryJob });
  } });
  await h.sandbox.prepare();
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.errorType, "submission_outcome_unknown");
  assert.deepEqual(h.state.errorJob, recoveryJob);
  assert.equal(h.state.refreshed, true);
});

test("a fresh preparation clears the previous blocking role before awaiting the next tab lookup", async () => {
  let resolveTab, request = 0;
  const nextTab = new Promise(resolve => { resolveTab = resolve; });
  const h = preparationHarness(undefined, { sendMessage: async () => ++request === 1
    ? { ok: false, error: "Review the previous application.", errorType: "submission_outcome_unknown", errorJob: recoveryJob }
    : { ok: true, data: batch } });
  await h.sandbox.prepare();
  assert.deepEqual(h.state.errorJob, recoveryJob);
  h.sandbox.getActiveTab = () => nextTab;
  const pending = h.sandbox.prepare(h.sandbox.batchSelection.current);
  assert.equal(h.state.errorJob, null);
  assert.equal(h.state.error, "");
  assert.equal(h.state.errorType, "");
  assert.equal(h.state.busy, true);
  resolveTab({ id: 7, windowId: 1 });
  await pending;
  assert.equal(h.state.batch, batch);
  assert.equal(h.state.errorJob, null);
});

test("cancelling a completed failed review clears its retained blocking-role context", async () => {
  const h = preparationHarness({ ok: false, error: "Review the previous application.",
    errorType: "submission_outcome_unknown", errorJob: recoveryJob });
  await h.sandbox.prepare();
  assert.deepEqual(h.state.errorJob, recoveryJob);
  assert.equal(h.sandbox.batchReviewRequest.current, null);
  h.sandbox.cancel();
  assert.equal(h.state.open, false);
  assert.equal(h.state.errorJob, null);
  assert.deepEqual([...h.sandbox.selectedQueueIds], selectedIds);
});

test("cancelling before a delayed tab lookup preserves selection and prevents a late preparation request", async () => {
  let resolveTab;
  const tab = new Promise(resolve => { resolveTab = resolve; });
  const h = preparationHarness(undefined, { getActiveTab: () => tab });
  const pending = h.sandbox.prepare();
  h.sandbox.cancel();
  assert.equal(h.state.open, false);
  assert.equal(h.state.busy, false);
  assert.equal(h.state.errorJob, null);
  resolveTab({ id: 7, windowId: 1 });
  await pending;
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.batch, null);
  assert.equal(h.state.open, false);
  assert.deepEqual([...h.sandbox.selectedQueueIds], selectedIds);
  assert.deepEqual([...h.sandbox.batchSelection.current], selectedIds);
});

test("cancelling during a delayed profile save prevents a late preparation request", async () => {
  let resolveProfile, enteredSave;
  const saved = new Promise(resolve => { resolveProfile = resolve; });
  const entered = new Promise(resolve => { enteredSave = resolve; });
  const h = preparationHarness(undefined, { save: () => { enteredSave(); return saved; } });
  const pending = h.sandbox.prepare();
  await entered;
  h.sandbox.cancel();
  resolveProfile({ resume: "offline" });
  await pending;
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.open, false);
  assert.equal(h.state.batch, null);
  assert.equal(h.state.busy, false);
  assert.deepEqual([...h.sandbox.selectedQueueIds], selectedIds);
});

test("cancelling a dispatched check sends Stop once and ignores its late successful response", async () => {
  let resolveCheck, enteredCheck;
  const checked = new Promise(resolve => { resolveCheck = resolve; });
  const entered = new Promise(resolve => { enteredCheck = resolve; });
  const h = preparationHarness(undefined, { sendMessage: message => {
    if (message.type === "APPLE_CAREERS_PREPARE_APPLICATION_BATCH") { enteredCheck(); return checked; }
    assert.equal(message.type, "APPLE_CAREERS_STOP_JOB_RANKING");
    return { ok: true };
  } });
  const pending = h.sandbox.prepare();
  await entered;
  h.sandbox.cancel();
  h.sandbox.cancel(); // Dialog close may follow the explicit Cancel event.
  assert.deepEqual(h.requests.map(message => message.type), ["APPLE_CAREERS_PREPARE_APPLICATION_BATCH", "APPLE_CAREERS_STOP_JOB_RANKING"]);
  assert.equal(h.requests[1].reviewRequestId, h.requests[0].reviewRequestId);
  assert.equal(h.state.open, false);
  resolveCheck({ ok: true, data: { ...batch, reconciliationPerformed: true } });
  await pending;
  assert.equal(h.state.batch, null);
  assert.equal(h.state.open, false);
  assert.equal(h.state.view.capacity.remaining, 49, "a cancelled response cannot install new capacity in the sheet");
  assert.deepEqual([...h.sandbox.selectedQueueIds], selectedIds);
  assert.ok(!h.requests.some(message => message.type === "APPLE_CAREERS_APPLY_JOB_QUEUE"));
});

test("a cancelled late failure cannot reopen the sheet or overwrite a newer preparation", async () => {
  let resolveFirst, resolveSecond, enterFirst, enterSecond;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  const second = new Promise(resolve => { resolveSecond = resolve; });
  const enteredFirst = new Promise(resolve => { enterFirst = resolve; });
  const enteredSecond = new Promise(resolve => { enterSecond = resolve; });
  let attempt = 0;
  const h = preparationHarness(undefined, { sendMessage: message => {
    if (message.type === "APPLE_CAREERS_STOP_JOB_RANKING") return { ok: true };
    if (++attempt === 1) { enterFirst(); return first; }
    enterSecond(); return second;
  } });
  const old = h.sandbox.prepare();
  await enteredFirst;
  h.sandbox.cancel();
  const next = h.sandbox.prepare();
  await enteredSecond;
  const prepared = h.requests.filter(message => message.type === "APPLE_CAREERS_PREPARE_APPLICATION_BATCH");
  assert.notEqual(prepared[0].reviewRequestId, prepared[1].reviewRequestId);
  h.sandbox.cancel({ type: "close" }); // Delayed native close from the cancelled old sheet.
  assert.equal(h.state.open, true);
  assert.equal(h.state.busy, true);
  assert.equal(h.requests.filter(message => message.type === "APPLE_CAREERS_STOP_JOB_RANKING").length, 1);
  resolveFirst({ ok: false, error: "A cancelled request failed late.", errorType: "submission_sync_failed", errorJob: recoveryJob });
  await old;
  assert.equal(h.state.open, true);
  assert.equal(h.state.busy, true);
  assert.equal(h.state.pending, "prepare");
  assert.equal(h.state.error, "");
  assert.equal(h.state.errorJob, null, "late context from the cancelled request must not overwrite the new review");
  resolveSecond({ ok: true, data: batch });
  await next;
  assert.equal(h.state.batch, batch);
  assert.equal(h.state.busy, false);
  assert.equal(h.state.errorJob, null);
});

test("a recovery error at Confirm performs preparation once and never retries Apply automatically", async () => {
  const messages = [], preparations = [], cleared = [];
  const sandbox = { applicationBatch: batch, selectedIds: [], visible: [], reviewedQueueToken: null,
    commitTopN: () => 12, setBusy() {}, setPendingAction() {}, setError() {}, setBatchReviewErrorType() {}, setBatchReviewErrorJob() {},
    getActiveTab: async () => ({ id: 7, windowId: 1 }), save: async () => ({ afterRanking: "review" }),
    chrome: { runtime: { sendMessage: async message => { messages.push(message); return {
      ok: false, error: "Interrupted application needs reconciliation.", errorType: "workflow_recovery_required" }; } } },
    reviewSelectedBatch: async ids => { preparations.push([...ids]); }, setSelectedQueueIds: ids => cleared.push(ids),
    setApplyOpen() {}, setView() {}, setQueueOpen() {}, setSelectedIds() {}, setStatusMessage() {}, refresh() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(`${handlerSource("act", "\n\n  async function remove")}\nglobalThis.confirm = act;`, sandbox);
  await sandbox.confirm("APPLE_CAREERS_APPLY_JOB_QUEUE");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "APPLE_CAREERS_APPLY_JOB_QUEUE");
  assert.deepEqual([...messages[0].selectedIds], selectedIds);
  assert.deepEqual(preparations, [selectedIds]);
  assert.equal(cleared.length, 0, "selection is cleared only after an accepted Apply start");
});

test("Confirm failures retain top-level and nested blocking-role context and clear it before a fresh action", async () => {
  for (const response of [
    { ok: false, error: "The reviewed role needs attention.", errorType: "submission_outcome_unknown", errorJob: recoveryJob },
    { ok: false, error: "The reviewed role needs attention.", data: { errorType: "submission_outcome_unknown", errorJob: recoveryJob } }
  ]) {
    const messages = [], cleared = [];
    const state = { error: "Previous error", errorType: "batch_review_failed", errorJob: { ...batch.jobs[0], source: "selection" } };
    const sandbox = { applicationBatch: batch, selectedIds: [], visible: [], reviewedQueueToken: null,
      commitTopN: () => 12, setBusy() {}, setPendingAction() {},
      setError: value => { state.error = value; }, setBatchReviewErrorType: value => { state.errorType = value; },
      setBatchReviewErrorJob: value => { state.errorJob = value; },
      getActiveTab: async () => {
        assert.equal(state.errorJob, null, "a new action clears stale context before looking up the tab");
        return { id: 7, windowId: 1 };
      },
      save: async () => ({ afterRanking: "review" }),
      chrome: { runtime: { sendMessage: async message => { messages.push(message); return response; } } },
      setSelectedQueueIds: ids => cleared.push(ids),
      setApplyOpen() {}, setView() {}, setQueueOpen() {}, setSelectedIds() {}, setStatusMessage() {}, refresh() {}
    };
    vm.createContext(sandbox);
    vm.runInContext(`${handlerSource("act", "\n\n  async function remove")}\nglobalThis.confirm = act;`, sandbox);
    await sandbox.confirm("APPLE_CAREERS_APPLY_JOB_QUEUE");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "APPLE_CAREERS_APPLY_JOB_QUEUE");
    assert.deepEqual(state.errorJob, recoveryJob);
    assert.equal(state.errorType, "submission_outcome_unknown");
    assert.equal(cleared.length, 0);
    const html = render({ batch, error: state.error, errorType: state.errorType, errorJob: state.errorJob });
    assert.ok(html.includes(`href="${recoveryJob.url}"`));
    assert.doesNotMatch(html, /Confirm And Apply|I Allow These Applications/);
  }
});
