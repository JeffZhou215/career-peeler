const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness } = require("./helpers/appleWorkflowHarness.cjs");

// Worker-side contract tests for Apple's verified disabled Submitted controls.
// The content parser has its own DOM tests; this fixture exercises actual worker
// messages, complete inventory validation, journal reconciliation, and ownership.
const workflowKey = "appleApplicationWorkflow";
const jobId = "200670922-0836";
const baseId = "200670922";
const sessionId = "reviewed-submitted-controls-session";
const role = { jobId, title: "ML Engineer, Apple Foundation Models",
  url: `https://jobs.apple.com/en-us/details/${jobId}/ml-engineer` };
const rolesUrl = "https://jobs.apple.com/app/en-us/profile/roles";
const activeRole = (id, title = role.title) => ({ jobId: id, title, active: true,
  url: `https://jobs.apple.com/en-us/details/${id}/ml-engineer` });
function submittedControlEvidence() {
  const control = position => ({ id: `jobdetails-jobdetails-jobdetail${position}-actions-jobdetailssubmitresume`,
    tagName: "A", role: "link", ariaDisabled: "true", tabIndex: "-1", href: null,
    text: "Submitted", ariaLabel: `Submitted: ${role.title} ${jobId}`, disabledClass: true,
    visible: true, connected: true });
  return { url: role.url, authenticated: true, title: role.title, roleNumber: jobId,
    controls: [control("header"), control("footer")] };
}
function inventory(roles) {
  return { pageCount: 1, pages: [{ roles, pageIndex: 1, pageCount: 1,
    accountVerified: true, hasNextPage: false, withdrawalConfirmationOpen: false,
    inventoryState: roles.length ? "confirmed" : "confirmed_empty" }] };
}

async function fixture(options = {}) {
  const clock = { now: Date.now() };
  const data = { appleWithdrawalWorkflow: { version: 1, records: {} },
    [workflowKey]: { id: sessionId, owner: "previous-worker", status: "paused", reconciliationRequired: true,
      currentJobId: jobId, startedAt: clock.now - 1000, recoveredAt: clock.now - 500, jobs: {
        [jobId]: { ...role, workflowSessionId: sessionId, state: "uncertain", submissionOutcome: "unknown",
          submissionAttemptCount: 1, submitIntentAt: clock.now - 600, submitAuthorizedStep: "reviewed-step",
          stepId: "reviewed-step", tabId: 1 } } },
    appleJobRanking: { version: 1, jobs: { [baseId]: { ...role, queueStatus: "uncertain" } }, searches: {},
      applicationFailures: {}, reservations: [{ jobId, startedAt: clock.now - 600 }] } };
  const tabs = [{ id: 1, windowId: 1, status: "complete", url: role.url },
    { id: 2, windowId: 1, status: "complete", url: rolesUrl }];
  const observed = { inventoryReads: 0, statusReads: 0, messages: [] };
  let h;
  const currentInventory = () => options.inventory || inventory([activeRole(baseId)]);
  h = createBackgroundHarness(tabs, { data, sendMessage: async (tabId, message) => {
    observed.messages.push(message);
    if (message.type === "APPLE_CAREERS_REVOKE_WORKFLOW") return { ok: true, workflowSessionId: message.workflowSessionId };
    if (message.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE") return { ok: true, data: currentInventory().pages[0] };
    if (message.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES") {
      observed.inventoryReads++;
      return options.inventoryResponse ? options.inventoryResponse(observed.inventoryReads) : { ok: true, data: currentInventory() };
    }
    if (message.type === "APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS") {
      observed.statusReads++;
      const proof = { requestId: message.requestId, jobId, url: role.url, identityVerified: true,
        submissionOutcome: "confirmed", proof: "apple_submitted_controls", observedAt: clock.now,
        documentStartedAt: message.notBefore,
        signal: { jobId, text: `Submitted: ${role.title} ${jobId}`, title: role.title, source: "apple_submitted_controls" },
        controlEvidence: submittedControlEvidence() };
      return options.status ? options.status({ h, message, proof, tabId, clock }) : { ok: true, data: proof };
    }
    assert.fail(`A read-only recovery check must not perform this action: ${message.type}`);
  } });
  await h.ready;
  h.sandbox.Date = class extends Date { static now() { return clock.now; } };
  h.sandbox.callOpenAi = async () => { assert.fail("Submission status reconciliation cannot use AI"); };
  h.clock = clock;
  h.observed = observed;
  h.check = () => h.sandbox.dispatch({ type: "APPLE_CAREERS_CHECK_INTERRUPTED_APPLICATION",
    tab: tabs[1], workflowSessionId: sessionId, jobId });
  return h;
}

function assertUnknown(h) {
  const job = h.data[workflowKey].jobs[jobId];
  assert.equal(job.state, "uncertain");
  assert.equal(job.submissionOutcome, "unknown");
  assert.equal(job.submissionAttemptCount, 1);
  assert.ok(h.data.appleJobRanking.reservations.some(item => item.jobId === jobId));
  assert.notEqual(h.data.appleJobRanking.jobs[baseId].queueStatus, "submitted");
}

function assertReadOnly(h) {
  assert.ok(h.observed.messages.every(message => ["APPLE_CAREERS_REVOKE_WORKFLOW",
    "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE", "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES",
    "APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS"].includes(message.type)));
  assert.equal(h.calls.created.length, 0);
  assert.equal(h.calls.updated.length, 0);
  assert.equal(h.calls.checkpoints.length, 0);
}

test("fresh exact Submitted controls plus one base-ID Active record confirm the original operation without replay", async () => {
  const h = await fixture();
  const result = await h.check();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.resolved, true);
  const job = h.data[workflowKey].jobs[jobId];
  assert.equal(job.state, "submitted");
  assert.equal(job.submissionOutcome, "confirmed");
  assert.equal(job.submissionAttemptCount, 1);
  assert.equal(job.recoveryProof.kind, "apple_submitted_controls");
  assert.equal(h.data[workflowKey].status, "paused");
  assert.equal(h.data[workflowKey].reconciliationRequired, false);
  assert.equal(h.data.appleJobRanking.reservations.length, 0);
  assert.equal(h.data.appleJobRanking.jobs[baseId].queueStatus, "submitted");
  assert.equal(h.observed.statusReads, 1);
  assert.deepEqual(h.calls.reloaded, [{ id: 1, bypassCache: true }]);
  await assert.rejects(h.sandbox.claimAppleApplicationSession([role]), /confirmed submission/);
  assertReadOnly(h);
});

test("a complete exact-full-ID Active record still resolves recovery directly without a control or Submit action", async () => {
  const h = await fixture({ inventory: inventory([activeRole(jobId)]) });
  const result = await h.check();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.resolved, true);
  assert.equal(h.data[workflowKey].jobs[jobId].submissionOutcome, "confirmed");
  assert.equal(h.data[workflowKey].jobs[jobId].submissionAttemptCount, 1);
  assert.equal(h.observed.statusReads, 0, "positive exact inventory already proves this submission");
  assert.equal(h.calls.reloaded.length, 0);
  assertReadOnly(h);
});

test("an exact-ID inventory arriving during control corroboration confirms the same operation without an error or replay", async () => {
  const h = await fixture({ inventoryResponse: read => ({ ok: true,
    data: inventory([activeRole(read === 1 ? baseId : jobId)]) }) });
  const result = await h.check();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.resolved, true);
  const job = h.data[workflowKey].jobs[jobId];
  assert.equal(job.state, "submitted");
  assert.equal(job.submissionOutcome, "confirmed");
  assert.equal(job.submissionAttemptCount, 1);
  assert.equal(job.stepId, "reviewed-step");
  assert.equal(job.submitAuthorizedStep, "reviewed-step");
  assert.notEqual(job.recoveryProof?.kind, "apple_submitted_controls",
    "the intervening exact inventory is the proof; do not manufacture a control-based resolution");
  assert.equal(h.data[workflowKey].reconciliationRequired, false);
  assert.equal(h.data[workflowKey].status, "paused");
  assert.equal(h.data.appleJobRanking.reservations.length, 0);
  assert.equal(h.observed.statusReads, 1);
  assert.ok(h.observed.inventoryReads >= 2);
  assertReadOnly(h);
});

for (const changed of ["step", "owner"]) {
  test(`an intervening exact inventory cannot make a changed ${changed} look like the original pending operation`, async () => {
    const h = await fixture({ inventoryResponse: read => ({ ok: true,
      data: inventory([activeRole(read === 1 ? baseId : jobId)]) }), status: ({ h, proof }) => {
      if (changed === "step") h.data[workflowKey].jobs[jobId].stepId = "replacement-reviewed-step";
      else h.data[workflowKey].owner = "replacement-worker-owner";
      return { ok: true, data: proof };
    } });
    const result = await h.check();
    assert.equal(result.ok, false);
    const job = h.data[workflowKey].jobs[jobId];
    assert.equal(job.submissionAttemptCount, 1);
    assert.notEqual(job.recoveryProof?.kind, "apple_submitted_controls");
    if (changed === "step") assert.equal(job.stepId, "replacement-reviewed-step");
    else assert.equal(h.data[workflowKey].owner, "replacement-worker-owner");
    assertReadOnly(h);
  });
}

test("Active and reviewed titles may differ only by case and whitespace during control corroboration", async () => {
  const h = await fixture({ inventory: inventory([activeRole(baseId, "  ml   engineer, APPLE foundation models \n ")]) });
  const result = await h.check();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.resolved, true);
  assert.equal(h.data[workflowKey].jobs[jobId].submissionOutcome, "confirmed");
  assertReadOnly(h);
});

for (const [description, roles] of [
  ["a different explicit location suffix", [activeRole("200670922-9999")]],
  ["two distinct same-base variants", [activeRole(baseId), activeRole("200670922-9999")]],
  ["two explicit same-base location variants", [activeRole("200670922-9999"), activeRole("200670922-7777")]],
  ["a same-base record with another title", [activeRole(baseId, "Software Engineer, Other Team")]],
  ["an empty Active inventory", []],
  ["only an unrelated active job", [activeRole("200000002", "Another Engineer")]]
]) {
  test(`exact Submitted controls cannot resolve unknown from ${description}`, async () => {
    const h = await fixture({ inventory: inventory(roles) });
    const result = await h.check();
    assert.ok(!result.ok || result.data.resolved === false, JSON.stringify(result));
    assertUnknown(h);
    assert.equal(h.data[workflowKey].jobs[jobId].recoveryProof, undefined);
    await assert.rejects(h.sandbox.claimAppleApplicationSession([role]), /reconcil|unknown/i);
    assertReadOnly(h);
  });
}

test("duplicate identical Active job IDs cannot make controls sufficient by hiding an incomplete inventory", async () => {
  const h = await fixture({ inventory: inventory([activeRole(baseId), activeRole(baseId)]) });
  const result = await h.check();
  assert.equal(result.ok, false);
  assertUnknown(h);
  assert.equal(h.observed.statusReads, 0);
  assertReadOnly(h);
});

for (const [description, inventoryResponse] of [
  ["failed", () => ({ ok: false, error: "Apple inventory unavailable" })],
  ["incomplete", () => ({ ok: true, data: { ...inventory([activeRole(baseId)]), pageCount: 2 } })]
]) {
  test(`${description} complete-inventory read prevents Submitted-control recovery`, async () => {
    const h = await fixture({ inventoryResponse });
    const result = await h.check();
    assert.equal(result.ok, false);
    assertUnknown(h);
    assert.equal(h.observed.statusReads, 0);
    assertReadOnly(h);
  });
}

for (const [description, patch] of [
  ["unknown outcome", { submissionOutcome: "unknown" }],
  ["generic Submitted text", { proof: "generic_submitted_label" }],
  ["missing signal", { signal: null }],
  ["wrong control evidence source", { signal: { jobId, text: "Submitted", source: "generic_submitted_label" } }],
  ["base-only control identity", { signal: { jobId: baseId, text: "Submitted", source: "apple_submitted_controls" } }],
  ["another full control identity", { signal: { jobId: "200670922-9999", text: "Submitted", source: "apple_submitted_controls" } }],
  ["stale request", { requestId: "obsolete-recovery-proof" }],
  ["stale document", { documentStartedAt: 1 }],
  ["stale observation", { observedAt: 1 }],
  ["unverified page identity", { identityVerified: false }]
]) {
  test(`${description} cannot authorize Submitted-control reconciliation`, async () => {
    const h = await fixture({ status: ({ proof }) => ({ ok: true, data: { ...proof, ...patch } }) });
    const result = await h.check();
    assert.ok(!result.ok || result.data.resolved === false, JSON.stringify(result));
    assertUnknown(h);
    assertReadOnly(h);
  });
}

test("a delayed control read must refresh Active inventory again before it can confirm", async () => {
  const h = await fixture({ status: ({ proof, clock }) => {
    clock.now += 5 * 60 * 1000;
    return { ok: true, data: { ...proof, observedAt: clock.now } };
  } });
  const result = await h.check();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.resolved, true);
  assert.equal(h.data[workflowKey].jobs[jobId].submissionOutcome, "confirmed");
  assert.equal(h.observed.inventoryReads, 3, "the old pre-read snapshot alone cannot prove the outcome");
  assertReadOnly(h);
});

test("Active absence in the fresh post-control read cannot confirm an old Submitted control", async () => {
  const h = await fixture({ inventoryResponse: read => ({ ok: true,
    data: inventory(read === 1 ? [activeRole(baseId)] : []) }) });
  const result = await h.check();
  assert.ok(!result.ok || result.data.resolved === false, JSON.stringify(result));
  assertUnknown(h);
  assert.equal(h.data[workflowKey].jobs[jobId].recoveryProof, undefined);
  assert.ok(h.observed.inventoryReads >= 2);
  assertReadOnly(h);
});

test("same-base variants introduced in the post-control inventory keep the outcome unknown", async () => {
  const h = await fixture({ inventoryResponse: read => ({ ok: true,
    data: inventory(read === 1 ? [activeRole(baseId)] : [activeRole(baseId), activeRole("200670922-9999")]) }) });
  const result = await h.check();
  assert.ok(!result.ok || result.data.resolved === false, JSON.stringify(result));
  assertUnknown(h);
  assert.equal(h.data[workflowKey].jobs[jobId].recoveryProof, undefined);
  assertReadOnly(h);
});

for (const failure of ["network", "incomplete"]) {
  test(`${failure} post-control inventory verification preserves the unresolved operation`, async () => {
    const h = await fixture({ inventoryResponse: read => read === 1 ? { ok: true, data: inventory([activeRole(baseId)]) }
      : failure === "network" ? { ok: false, error: "Fresh Active read failed" }
        : { ok: true, data: { ...inventory([activeRole(baseId)]), pageCount: 2 } } });
    const result = await h.check();
    assert.ok(!result.ok || result.data.resolved === false, JSON.stringify(result));
    assertUnknown(h);
    assert.equal(h.data[workflowKey].jobs[jobId].recoveryProof, undefined);
    assertReadOnly(h);
  });
}

test("a locally withdrawn role cannot be confirmed from Submitted controls", async () => {
  const h = await fixture();
  h.data.appleJobRanking.withdrawnIds = [baseId];
  const result = await h.check();
  assert.ok(!result.ok || result.data.resolved === false, JSON.stringify(result));
  assertUnknown(h);
  assert.equal(h.data[workflowKey].jobs[jobId].recoveryProof, undefined);
  assertReadOnly(h);
});

for (const outcome of ["inactive", "unknown"]) {
  test(`an ${outcome} withdrawal journal blocks direct Submitted-control corroboration`, async () => {
    const h = await fixture();
    // Exercise the actual corroboration helper directly so an explicit Sync's
    // separate withdrawal-reconciliation navigation cannot mask this guard.
    h.data.appleWithdrawalWorkflow.records[baseId] = { jobId: baseId, outcome };
    const proof = { controlEvidence: submittedControlEvidence(),
      signal: { jobId, text: `Submitted: ${role.title} ${jobId}`, title: role.title, source: "apple_submitted_controls" } };
    const state = { withdrawnIds: [], capacitySnapshot: { complete: true, accountVerified: true,
      inventoryState: "confirmed", scannedAt: h.clock.now, roles: [activeRole(baseId)] } };
    assert.equal(await h.sandbox.appleSubmittedControlsCorroborated(state, role, proof), false);
    assert.equal(h.data[workflowKey].jobs[jobId].submissionOutcome, "unknown");
    assert.equal(h.observed.statusReads, 0);
    assertReadOnly(h);
  });
}

for (const [description, patch] of [
  ["missing control snapshot", null],
  ["unauthenticated control snapshot", { authenticated: false }],
  ["wrong role number", { roleNumber: baseId }],
  ["changed page title", { title: "Another Engineering Role" }],
  ["missing footer control", { controls: [] }]
]) {
  test(`${description} is revalidated by the worker rather than trusting the proof label`, async () => {
    const h = await fixture({ status: ({ proof }) => ({ ok: true, data: { ...proof,
      controlEvidence: patch === null ? null : { ...proof.controlEvidence, ...patch } } }) });
    const result = await h.check();
    assert.ok(!result.ok || result.data.resolved === false, JSON.stringify(result));
    assertUnknown(h);
    assertReadOnly(h);
  });
}

test("cancellation while Submitted controls are being read rejects late confirmation", async () => {
  const h = await fixture({ status: async ({ h, proof }) => {
    await h.sandbox.cancelAppleApplicationSession();
    return { ok: true, data: proof };
  } });
  const result = await h.check();
  assert.equal(result.ok, false);
  assertUnknown(h);
  assert.equal(h.data[workflowKey].status, "cancelled");
  assert.equal(h.data[workflowKey].stopRequested, true);
  assertReadOnly(h);
});

test("a changed pending step rejects otherwise valid Submitted-control evidence", async () => {
  const h = await fixture({ status: ({ h, proof }) => {
    h.data[workflowKey].jobs[jobId].stepId = "replacement-step";
    return { ok: true, data: proof };
  } });
  const result = await h.check();
  assert.equal(result.ok, false);
  assertUnknown(h);
  assert.equal(h.data[workflowKey].jobs[jobId].stepId, "replacement-step");
  assertReadOnly(h);
});

test("checking an already cancelled operation can confirm status without restoring run permission", async () => {
  const h = await fixture();
  await h.sandbox.cancelAppleApplicationSession();
  const result = await h.check();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.resolved, true);
  assert.equal(h.data[workflowKey].status, "cancelled");
  assert.equal(h.data[workflowKey].stopRequested, true);
  assert.equal(h.data[workflowKey].jobs[jobId].submissionAttemptCount, 1);
  assertReadOnly(h);
});
