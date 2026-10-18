const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness, createContentHarness } = require("./helpers/appleWorkflowHarness.cjs");

const key = "appleApplicationWorkflow";
const jobId = "200670922-0836";
const base = jobId.split("-")[0];
const role = { jobId, title: "ML Engineer, Apple Foundation Models", url: `https://jobs.apple.com/en-us/details/${jobId}/engineer` };
const rolesUrl = "https://jobs.apple.com/app/en-us/profile/roles";
const active = id => ({ ...role, jobId: id, active: true });
const inventory = ids => ({ pageCount: 1, pages: [{ roles: ids.map(active), pageIndex: 1, pageCount: 1,
  accountVerified: true, hasNextPage: false, withdrawalConfirmationOpen: false,
  inventoryState: ids.length ? "confirmed" : "confirmed_empty" }] });

async function fixture(options = {}) {
  const now = Date.now();
  const data = { appleWithdrawalWorkflow: { version: 1, records: {} },
    [key]: { id: "reviewed-session", owner: "old-worker", status: "paused", reconciliationRequired: true,
      currentJobId: jobId, startedAt: now - 1000, recoveredAt: now - 500, jobs: {
        [jobId]: { ...role, workflowSessionId: "reviewed-session", state: "uncertain", submissionOutcome: "unknown",
          submissionAttemptCount: 1, submitIntentAt: now - 600, submitAuthorizedStep: "step-1", stepId: "step-1", tabId: 1 } } },
    appleJobRanking: { version: 1, jobs: { [base]: { ...role, queueStatus: "uncertain" } }, searches: {},
      applicationFailures: {}, reservations: [{ jobId, startedAt: now - 600 }] } };
  const tabs = [{ id: 1, windowId: 1, status: "complete", url: role.url },
    { id: 2, windowId: 1, status: "complete", url: rolesUrl }];
  let inventoryReads = 0;
  let statusReads = 0;
  const h = createBackgroundHarness(tabs, { data, sendMessage: async (tabId, message) => {
    if (message.type === "APPLE_CAREERS_REVOKE_WORKFLOW") return { ok: true, workflowSessionId: message.workflowSessionId };
    if (message.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES") {
      inventoryReads++;
      return options.inventory ? options.inventory(inventoryReads) : { ok: true, data: inventory([base]) };
    }
    if (message.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE") return { ok: true, data: inventory([base]).pages[0] };
    if (message.type === "APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS") {
      statusReads++;
      const proof = { requestId: message.requestId, jobId, url: role.url, identityVerified: true,
        submissionOutcome: "confirmed", proof: "job_identified_submission", observedAt: Date.now(),
        documentStartedAt: message.notBefore, signal: { jobId } };
      return options.status ? options.status({ h, message, proof, tabId }) : { ok: true, data: proof };
    }
    assert.fail(`Recovery must not perform application actions: ${message.type}`);
  } });
  await h.ready;
  h.sandbox.callOpenAi = async () => { assert.fail("Recovery cannot use AI"); };
  h.check = () => h.sandbox.dispatch({ type: "APPLE_CAREERS_CHECK_INTERRUPTED_APPLICATION", tab: tabs[1], workflowSessionId: "reviewed-session", jobId });
  h.reads = () => ({ inventoryReads, statusReads });
  return h;
}

function unknown(h) {
  assert.equal(h.data[key].jobs[jobId].submissionOutcome, "unknown");
  assert.equal(h.data[key].jobs[jobId].state, "uncertain");
  assert.equal(h.data[key].jobs[jobId].submissionAttemptCount, 1);
  assert.ok(h.data.appleJobRanking.reservations.some(item => item.jobId === jobId));
}

test("explicit read-only exact-job confirmation reconciles unknown without Submit or new tabs", async () => {
  const h = await fixture();
  const result = await h.check();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.resolved, true);
  assert.equal(h.data[key].jobs[jobId].state, "submitted");
  assert.equal(h.data[key].jobs[jobId].submissionAttemptCount, 1);
  assert.equal(h.data[key].status, "paused", "verification must not resume an application");
  assert.equal(h.data[key].reconciliationRequired, false);
  assert.equal(h.data.appleJobRanking.reservations.length, 0);
  assert.equal(h.data.appleJobRanking.jobs[base].queueStatus, "submitted");
  assert.equal(h.data.appleSubmissionSyncStatus.recoveryWarning, null);
  assert.equal(h.calls.created.length, 0);
  assert.equal(h.calls.updated.length, 0);
  assert.deepEqual(h.calls.reloaded, [{ id: 1, bypassCache: true }]);
  assert.deepEqual(h.reads(), { inventoryReads: 2, statusReads: 1 });
  await assert.rejects(h.sandbox.claimAppleApplicationSession([role]), /confirmed submission/);
});

for (const patch of [
  { submissionOutcome: "unknown", proof: null, signal: null },
  { proof: "generic_submitted_label" },
  { submissionOutcome: "not_attempted", canApply: true },
  { signal: { jobId: base } }
]) test(`ambiguous or merely applicable detail status cannot resolve unknown (${JSON.stringify(patch)})`, async () => {
  const h = await fixture({ status: ({ proof }) => ({ ok: true, data: { ...proof, ...patch } }) });
  const result = await h.check();
  assert.equal(result.ok, true);
  assert.equal(result.data.resolved, false);
  unknown(h);
  await assert.rejects(h.sandbox.claimAppleApplicationSession([role]), /reconciliation|unknown/);
});

for (const patch of [
  { jobId: base }, { url: role.url.replace("0836", "9999") }, { requestId: "stale-request" },
  { observedAt: 1 }, { identityVerified: false }, { documentStartedAt: 1 }
]) test(`unverified identity or stale recovery evidence is rejected (${JSON.stringify(patch)})`, async () => {
  const h = await fixture({ status: ({ proof }) => ({ ok: true, data: { ...proof, ...patch } }) });
  assert.equal((await h.check()).ok, false);
  unknown(h);
});

test("a reviewed role must be open in the same window; status checks do not navigate or create it", async () => {
  const h = await fixture();
  h.tabs[0].windowId = 2;
  const result = await h.check();
  assert.equal(result.ok, true);
  assert.equal(result.data.resolved, false);
  assert.match(result.data.message, /Open the reviewed job/);
  assert.equal(h.reads().statusReads, 0);
  assert.equal(h.calls.created.length, 0);
  unknown(h);
});

test("late status cannot resolve a changed workflow operation", async () => {
  const h = await fixture({ status: ({ h, proof }) => {
    h.data[key].jobs[jobId].stepId = "new-step";
    return { ok: true, data: proof };
  } });
  assert.equal((await h.check()).ok, false);
  unknown(h);
  assert.equal(h.data[key].jobs[jobId].stepId, "new-step");
});

test("cancellation during status read remains cancelled and cannot resolve late evidence", async () => {
  const h = await fixture({ status: async ({ h, proof }) => {
    await h.sandbox.cancelAppleApplicationSession();
    return { ok: true, data: proof };
  } });
  assert.equal((await h.check()).ok, false);
  unknown(h);
  assert.equal(h.data[key].stopRequested, true);
  assert.equal(h.data[key].status, "cancelled");
});

test("an already cancelled workflow may be checked without restoring permission to run", async () => {
  const h = await fixture();
  await h.sandbox.cancelAppleApplicationSession();
  const result = await h.check();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.resolved, true);
  assert.equal(h.data[key].status, "cancelled");
  assert.equal(h.data[key].stopRequested, true);
  assert.equal(h.data[key].jobs[jobId].submissionOutcome, "confirmed");
});

test("duplicate concurrent check messages cannot overlap", async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const h = await fixture({ status: async ({ proof }) => { entered(); await wait; return { ok: true, data: proof }; } });
  const first = h.check(); await started;
  assert.equal((await h.check()).ok, false);
  release(); assert.equal((await first).ok, true);
  assert.equal(h.reads().statusReads, 1);
});

test("failed or incomplete fresh inventory prevents exact-job recovery reads", async () => {
  for (const response of [{ ok: false, error: "Network unavailable" }, { ok: true, data: { pageCount: 2, pages: inventory([base]).pages } }]) {
    const h = await fixture({ inventory: () => response });
    assert.equal((await h.check()).ok, false);
    assert.equal(h.reads().statusReads, 0);
    unknown(h);
  }
});

test("post-proof sync failure retains durable confirmation but cannot claim fresh capacity or resume", async () => {
  const h = await fixture({ inventory: read => read === 1 ? { ok: true, data: inventory([base]) } : { ok: false, error: "Network interrupted" } });
  const result = await h.check();
  assert.equal(result.ok, false);
  assert.equal(h.data[key].jobs[jobId].submissionOutcome, "confirmed");
  assert.equal(h.data[key].reconciliationRequired, true);
  assert.equal(h.data.appleSubmissionSyncStatus.state, "failed");
  assert.ok(h.data.appleJobRanking.reservations.some(item => item.jobId === jobId));
});

test("passive Submitted observations cannot clear an unknown operation or reservation", async () => {
  const h = await fixture();
  const result = await h.sandbox.observeAppleSubmission({ jobId, title: role.title }, { tab: h.tabs[0] });
  assert.equal(result.deferred, true);
  unknown(h);
  assert.notEqual(h.data.appleJobRanking.jobs[base].queueStatus, "submitted");
});

test("foreign and content-page messages cannot invoke the explicit recovery operation", async () => {
  const h = await fixture();
  h.sandbox.chrome.runtime.id = "rolebeam-test";
  for (const sender of [{ tab: h.tabs[0] }, { id: "foreign" }, { url: "https://jobs.apple.com/" }]) {
    const response = await h.sandbox.dispatch({ type: "APPLE_CAREERS_CHECK_INTERRUPTED_APPLICATION", tab: h.tabs[1], workflowSessionId: "reviewed-session", jobId }, sender);
    assert.equal(response.ok, false);
  }
  assert.equal(h.reads().statusReads, 0);
  unknown(h);
});

test("same-worker unknown outcomes expose exact recovery controls without claiming a worker restart", async () => {
  const h = await fixture();
  delete h.data[key].recoveredAt;
  const view = await h.sandbox.getAppleRankingView({});
  assert.equal(view.recovered, false);
  assert.equal(view.workflowSessionId, "reviewed-session");
  assert.equal(view.recovery.sessionId, "reviewed-session");
  assert.equal(view.recovery.jobId, jobId);
  assert.equal(view.recovery.reconciliationRequired, true);
});

test("a readiness failure explains why the exact status was not verified without changing the pending operation", async () => {
  const reason = "Apple's job status is still loading. Try Check Application Status again; no application was submitted.";
  const h = await fixture({ status: ({ proof }) => ({ ok: true, data: { ...proof,
    submissionOutcome: "unknown", proof: null, signal: null, reasonCode: "page_loading", reason } }) });
  const result = await h.check();
  assert.equal(result.ok, true);
  assert.equal(result.data.resolved, false);
  assert.equal(result.data.reasonCode, "page_loading");
  assert.equal(result.data.message, reason);
  unknown(h);
});

test("resolving one operation retains another unknown operation and its reservation", async () => {
  const secondId = "200000002-0836";
  const h = await fixture({ inventory: () => ({ ok: true, data: inventory([base, secondId.split("-")[0]]) }) });
  h.data[key].jobs[secondId] = { jobId: secondId, state: "uncertain", submissionOutcome: "unknown", submissionAttemptCount: 1 };
  h.data.appleJobRanking.reservations.push({ jobId: secondId, startedAt: Date.now() });
  const result = await h.check();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.resolved, false);
  assert.equal(h.data[key].jobs[jobId].submissionOutcome, "confirmed");
  assert.equal(h.data[key].jobs[secondId].submissionOutcome, "unknown");
  assert.equal(h.data[key].reconciliationRequired, true);
  assert.deepEqual(Array.from(h.data.appleJobRanking.reservations, item => item.jobId), [secondId]);
  await assert.rejects(h.sandbox.claimAppleApplicationSession([role]), /reconciliation|interrupted/);
});

test("the check never reloads or reads an interrupted application form", async () => {
  const h = await fixture();
  h.tabs[0].url = `https://jobs.apple.com/app/en-us/apply/${jobId}`;
  const response = await h.check();
  assert.equal(response.ok, true);
  assert.equal(response.data.resolved, false);
  assert.equal(h.reads().statusReads, 0);
  assert.equal(h.calls.reloaded.length, 0);
  unknown(h);
});

function contentFixture(ids = [jobId]) {
  const h = createContentHarness({ url: role.url });
  const alert = { innerText: "Your application has been submitted", isConnected: true,
    getBoundingClientRect: () => ({ width: 400, height: 30, top: 10 }),
    getAttribute: () => null, querySelectorAll: () => ids.map(id => ({ href: role.url.replace(jobId, id) })) };
  h.document.readyState = "complete";
  h.performance = { timeOrigin: Date.now() };
  h.document.querySelectorAll = selector => selector === "#global-alert, [role='alert'], [data-autom='submission-confirmation']" ? [alert] : [];
  h.alert = alert;
  h.read = () => h.dispatch({ type: "APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS", expectedJobId: jobId,
    requestId: "read-only-proof", notBefore: h.performance.timeOrigin });
  return h;
}

test("content recovery uses real job-associated signal parsing and never clicks", async () => {
  const h = contentFixture();
  const response = await h.read();
  assert.equal(response.ok, true, response.error);
  assert.equal(response.data.submissionOutcome, "confirmed");
  assert.equal(response.data.signal.jobId, jobId);
  assert.equal(response.data.requestId, "read-only-proof");
  assert.equal(h.observationCalls.messages.length, 0);
});

for (const ids of [[], [base], ["200670922-9999"], [jobId, "200000002-0836"]]) {
  test(`generic/base/different/ambiguous confirmation does not resolve exact recovery (${ids.join(",")})`, async () => {
    const response = await contentFixture(ids).read();
    assert.ok(!response.ok || response.data.submissionOutcome === "unknown");
  });
}

test("loading, authentication loss, SPA identity changes and disappearing confirmations remain unresolved", async () => {
  for (const variant of ["loading", "login", "navigate", "disappear"]) {
    const h = contentFixture();
    if (variant === "loading") h.document.readyState = "loading";
    if (variant === "login") h.document.body.innerText = "Please sign in to continue";
    if (variant === "navigate") h.delay = async () => { h.window.location = new URL(role.url.replace("0836", "9999")); };
    if (variant === "disappear") h.delay = async () => { h.document.querySelectorAll = () => []; };
    const response = await h.read();
    assert.ok(!response.ok || response.data.submissionOutcome === "unknown", variant);
  }
});

for (const text of ["No application submitted", "Your application has not been submitted", "Application was submitted but has been withdrawn", "Application submitted; error pending"]) {
  test(`negative or historical exact-ID alert cannot confirm recovery (${text})`, async () => {
    const h = contentFixture();
    h.alert.innerText = text;
    const response = await h.read();
    assert.equal(response.ok, true);
    assert.equal(response.data.submissionOutcome, "unknown");
  });
}

test("an old exact-job document and an application form cannot provide fresh recovery proof", async () => {
  for (const variant of ["stale", "form"]) {
    const h = contentFixture();
    const notBefore = h.performance.timeOrigin + (variant === "stale" ? 1000 : 0);
    if (variant === "form") h.window.location = new URL(`https://jobs.apple.com/app/en-us/apply/${jobId}`);
    const response = await h.dispatch({ type: "APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS", expectedJobId: jobId, requestId: "proof", notBefore });
    assert.equal(response.ok, true);
    assert.equal(response.data.submissionOutcome, "unknown");
  }
});
