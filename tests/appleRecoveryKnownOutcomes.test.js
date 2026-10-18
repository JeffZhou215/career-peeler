const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness } = require("./helpers/appleWorkflowHarness.cjs");

const key = "appleApplicationWorkflow";
const selected = { jobId: "200670922-0836", title: "ML Engineer, Apple Foundation Models",
  url: "https://jobs.apple.com/en-us/details/200670922-0836/ml-engineer" };
const other = { jobId: "200000002-0836", title: "Another Engineer",
  url: "https://jobs.apple.com/en-us/details/200000002-0836/another" };
const baseId = selected.jobId.split("-")[0];
const inventory = ids => ({ complete: true, inventoryState: ids.length ? "confirmed" : "confirmed_empty",
  roles: ids.map(jobId => ({ jobId, active: true })) });

async function interrupted({ submit = false, confirmed = false } = {}) {
  const tab = { id: 1, windowId: 1, status: "complete", url: selected.url };
  const original = createBackgroundHarness([tab]);
  await original.ready;
  original.data.appleJobRanking = { version: 1, jobs: { [baseId]: { ...selected, queueStatus: "queued" } },
    applicationFailures: {}, searches: {}, reservations: [] };
  const sessionId = await original.sandbox.claimAppleApplicationSession([selected, other], { sourceTabId: 1, sourceWindowId: 1 });
  const stepId = await original.sandbox.checkpointAppleWorkflowStep(sessionId, selected, 1);
  const action = { workflowSessionId: sessionId, workflowStepId: stepId, expectedJobId: selected.jobId };
  await original.sandbox.authorizeAppleWorkflowAction({ ...action, action: submit ? "submit" : "form" }, { tab });
  if (confirmed) await original.sandbox.checkpointAppleWorkflowResult(sessionId, selected.jobId, stepId, {
    expectedJobId: selected.jobId, identityVerified: true, clicked: true, done: true, submissionOutcome: "confirmed",
    steps: [{ step: "Submit application", status: "clicked" }], summary: "Confirmed before restart" });
  const recovered = createBackgroundHarness(original.tabs, { data: original.data, sendMessage: async (_id, message) => {
    assert.equal(message.type, "APPLE_CAREERS_REVOKE_WORKFLOW", "recovery cannot issue form or Submit actions");
    return { ok: true, workflowSessionId: message.workflowSessionId };
  } });
  await recovered.ready;
  return { ...recovered, original, sessionId, stepId };
}

for (const activeId of [baseId, "200670922-9999"]) {
  test(`confirmed submission survives recovery against non-exact Active inventory (${activeId})`, async () => {
    const h = await interrupted({ submit: true, confirmed: true });
    const before = structuredClone(h.data[key].jobs[selected.jobId]);
    const ledgerBefore = structuredClone(h.data.appleCareersAppliedJobs);
    const result = await h.sandbox.reconcileAppleApplicationInventory(inventory([activeId]));
    assert.equal(result.recoveryWarning, null);
    assert.deepEqual(Array.from(result.blockedJobIds), []);
    assert.equal(h.data[key].reconciliationRequired, false);
    assert.equal(h.data[key].status, "paused");
    assert.deepEqual(h.data[key].jobs[selected.jobId], before);
    assert.deepEqual(h.data.appleCareersAppliedJobs, ledgerBefore);
    await assert.rejects(h.sandbox.claimAppleApplicationSession([selected]), /confirmed submission/);
    assert.ok(h.calls.messages.every(message => message.type === "APPLE_CAREERS_REVOKE_WORKFLOW"));
    assert.equal(h.calls.checkpoints.length, 0);
  });
}

test("ordinary interrupted form filling without Submit authorization needs fresh review rather than exact-ID outcome proof", async () => {
  const h = await interrupted();
  const result = await h.sandbox.reconcileAppleApplicationInventory(inventory([baseId]));
  const job = h.data[key].jobs[selected.jobId];
  assert.equal(result.recoveryWarning, null);
  assert.equal(h.data[key].reconciliationRequired, false);
  assert.equal(h.data[key].status, "paused");
  assert.equal(job.state, "failed");
  assert.equal(job.submissionOutcome, "not_attempted");
  assert.equal(job.submissionAttemptCount, 0);
  assert.equal(job.reconciliation, "not_attempted");
  assert.equal(job.stepPending, false);
  assert.equal(h.data.appleCareersAppliedJobs?.[`apple:${selected.jobId}`], undefined);
  await assert.rejects(h.original.sandbox.authorizeAppleWorkflowAction({ workflowSessionId: h.sessionId,
    workflowStepId: h.stepId, expectedJobId: selected.jobId, action: "submit" }, { tab: h.tabs[0] }), /stopped|replaced/);
  assert.equal(h.calls.checkpoints.length, 0);
  assert.ok(h.calls.messages.every(message => message.type === "APPLE_CAREERS_REVOKE_WORKFLOW"));
  const newlyReviewedSession = await h.sandbox.claimAppleApplicationSession([selected]);
  assert.notEqual(newlyReviewedSession, h.sessionId);
  assert.equal(h.data[key].jobs[selected.jobId].state, "not_started", "no old form filling is resumed");
});

test("explicit cancellation is preserved when a never-authorized Submit is reconciled", async () => {
  const h = await interrupted();
  await h.sandbox.cancelAppleApplicationSession();
  const result = await h.sandbox.reconcileAppleApplicationInventory(inventory([baseId]));
  assert.equal(result.recoveryWarning, null);
  assert.equal(h.data[key].status, "cancelled");
  assert.equal(h.data[key].stopRequested, true);
  assert.equal(h.data[key].jobs[selected.jobId].submissionOutcome, "not_attempted");
  assert.equal(h.calls.checkpoints.length, 0);
});

test("positive exact-ID Active evidence still confirms a role even if this workflow never authorized Submit", async () => {
  const h = await interrupted();
  const result = await h.sandbox.reconcileAppleApplicationInventory(inventory([selected.jobId]));
  assert.equal(result.recoveryWarning, null);
  assert.equal(h.data[key].jobs[selected.jobId].state, "submitted");
  assert.equal(h.data[key].jobs[selected.jobId].submissionOutcome, "confirmed");
  assert.equal(h.data[key].jobs[selected.jobId].alreadySubmitted, true);
  assert.equal(h.data[key].jobs[selected.jobId].submissionAttemptCount, 0);
  assert.equal(h.data[key].reconciliationRequired, false);
  assert.equal(h.data[key].status, "paused");
  assert.equal(h.calls.checkpoints.length, 0);
});

test("never-authorized form filling cannot reconcile before the old tab acknowledges revocation", async () => {
  const h = await interrupted();
  h.sandbox.chrome.tabs.sendMessage = async () => { throw new Error("Old form is unreachable"); };
  await assert.rejects(h.sandbox.reconcileAppleApplicationInventory(inventory([baseId])), /Close that tab/);
  assert.equal(h.data[key].reconciliationRequired, true);
  assert.equal(h.data[key].jobs[selected.jobId].state, "in_progress");
});

test("never-authorized form filling still requires a complete authenticated inventory", async () => {
  const h = await interrupted();
  await assert.rejects(h.sandbox.reconcileAppleApplicationInventory({ complete: false, inventoryState: "unknown", roles: [] }), /complete authenticated/);
  assert.equal(h.data[key].reconciliationRequired, true);
  assert.equal(h.data[key].jobs[selected.jobId].state, "in_progress");
});

for (const contradiction of [
  { submissionOutcome: "unknown" },
  { state: "uncertain" },
  { submissionAttemptCount: 1 },
  { acknowledgedAttemptCount: 1 },
  { submitIntentAt: 1 },
  { submitAuthorizedStep: "prior-submit-step" },
  { submissionAttemptCount: undefined },
  { submissionOutcome: "confirmed" }
]) {
  test(`contradictory or incomplete no-Submit state cannot bypass exact-ID recovery (${JSON.stringify(contradiction)})`, async () => {
    const h = await interrupted();
    Object.assign(h.data[key].jobs[selected.jobId], contradiction);
    const result = await h.sandbox.reconcileAppleApplicationInventory(inventory([baseId]));
    assert.ok(result.recoveryWarning);
    assert.equal(h.data[key].reconciliationRequired, true);
    assert.notEqual(h.data[key].jobs[selected.jobId].state, "submitted");
    assert.equal(h.data.appleCareersAppliedJobs?.[`apple:${selected.jobId}`], undefined);
    await assert.rejects(h.sandbox.claimAppleApplicationSession([other]), /reconciliation/);
    assert.equal(h.calls.checkpoints.length, 0);
  });
}

test("a pending Submit still blocks exact-ID mismatch and retains its reservation", async () => {
  const h = await interrupted({ submit: true });
  const result = await h.sandbox.reconcileAppleApplicationInventory(inventory([baseId]));
  assert.ok(result.recoveryWarning);
  assert.equal(h.data[key].jobs[selected.jobId].state, "uncertain");
  assert.equal(h.data[key].jobs[selected.jobId].submissionOutcome, "unknown");
  assert.equal(h.data[key].jobs[selected.jobId].submissionAttemptCount, 1);
  assert.equal(h.data[key].reconciliationRequired, true);
  assert.ok(h.data.appleJobRanking.reservations.some(item => item.jobId === selected.jobId));
  assert.equal(h.calls.checkpoints.length, 0);
});

test("confirmed roles are excluded from a different uncertain role's blocked recovery identities", async () => {
  const h = await interrupted({ submit: true, confirmed: true });
  h.data[key].jobs[other.jobId] = { ...h.data[key].jobs[other.jobId], state: "uncertain", submissionOutcome: "unknown",
    submissionAttemptCount: 1, submitIntentAt: Date.now() };
  const result = await h.sandbox.reconcileAppleApplicationInventory(inventory([baseId, other.jobId.split("-")[0]]));
  assert.deepEqual(Array.from(result.blockedJobIds), [other.jobId]);
  assert.equal(h.data[key].jobs[selected.jobId].submissionOutcome, "confirmed");
  assert.equal(h.data[key].jobs[other.jobId].submissionOutcome, "unknown");
  assert.equal(h.data[key].reconciliationRequired, true);
});

for (const mode of ["never_submitted", "confirmed", "unknown"]) {
  for (const activeId of [baseId, "200670922-9999"]) {
    test(`explicit Sync keeps ${mode} recovery isolated from non-exact ranking promotion (${activeId})`, async () => {
      const h = await interrupted({ submit: mode !== "never_submitted", confirmed: mode === "confirmed" });
      h.data.appleWithdrawalWorkflow = { version: 1, records: {} };
      const otherBaseId = other.jobId.split("-")[0];
      h.data.appleJobRanking.jobs[otherBaseId] = { ...other, queueStatus: "queued" };
      const rolesTab = { id: 2, windowId: 1, status: "complete", url: "https://jobs.apple.com/app/en-us/profile/roles" };
      h.tabs.push(rolesTab);
      const page = { pageIndex: 1, pageCount: 1, hasNextPage: false, accountVerified: true,
        withdrawalConfirmationOpen: false, inventoryState: "confirmed",
        roles: [activeId, other.jobId].map(jobId => ({ jobId, title: "Active Engineer", active: true })) };
      const messages = [];
      h.sandbox.chrome.tabs.sendMessage = async (_tabId, message) => {
        messages.push(message);
        if (message.type === "APPLE_CAREERS_REVOKE_WORKFLOW") return { ok: true, workflowSessionId: message.workflowSessionId };
        if (message.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE") return { ok: true, data: page };
        if (message.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES") return { ok: true, data: { pages: [page], pageCount: 1 } };
        assert.fail(`Unrequested browser action during capacity verification: ${message.type}`);
      };
      const response = await h.sandbox.dispatch({ type: "APPLE_CAREERS_REFRESH_QUEUE_CAPACITY", tab: rolesTab });
      assert.equal(response.ok, true, response.error);
      const state = await h.sandbox.readAppleRankingState();
      const capacity = await h.sandbox.appleRankingCapacity(state);
      assert.equal(capacity.known, true);
      assert.equal(capacity.submitted, 2);
      assert.equal(capacity.remaining, 48);
      assert.equal(h.data.appleSubmissionSyncStatus.state, "synced");
      assert.equal(state.jobs[otherBaseId].queueStatus, "submitted", "unrelated exact roles still reconcile");
      const recovered = h.data[key].jobs[selected.jobId];
      if (mode === "confirmed") {
        assert.equal(recovered.state, "submitted");
        assert.equal(recovered.submissionOutcome, "confirmed");
        assert.equal(state.jobs[baseId].queueStatus, "submitted");
        assert.equal(h.data[key].reconciliationRequired, false);
      } else {
        assert.notEqual(state.jobs[baseId].queueStatus, "submitted");
        assert.notEqual(state.applicationFailures[baseId].status, "submitted");
        assert.equal(state.applicationFailures[baseId].resolvedAt, undefined);
        assert.equal(h.data.appleCareersAppliedJobs?.[`apple:${selected.jobId}`], undefined);
        if (mode === "never_submitted") {
          assert.equal(recovered.state, "failed");
          assert.equal(recovered.submissionOutcome, "not_attempted");
          assert.equal(state.jobs[baseId].queueStatus, "needs_review");
          assert.equal(h.data[key].reconciliationRequired, false);
        } else {
          assert.equal(recovered.state, "uncertain");
          assert.equal(recovered.submissionOutcome, "unknown");
          assert.equal(h.data[key].reconciliationRequired, true);
          assert.ok(state.reservations.some(item => item.jobId === selected.jobId));
        }
      }
      assert.equal(messages.some(message => /RUN_APPLICATION|AUTHORIZE_WORKFLOW|WITHDRAW/.test(message.type)), false);
    });
  }
}
