const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness } = require("./helpers/appleWorkflowHarness.cjs");

const workflowKey = "appleApplicationWorkflow";
const rankingKey = "appleJobRanking";
const archiveKey = "appleSubmittedRoleReviews";
const rolesUrl = "https://jobs.apple.com/app/en-us/profile/roles";
const selected = { jobId: "200123456-0836", title: "Reviewed Engineer",
  url: "https://jobs.apple.com/en-us/details/200123456-0836/reviewed-engineer" };
const other = { jobId: "200987654-0836", title: "Other Engineer",
  url: "https://jobs.apple.com/en-us/details/200987654-0836/other-engineer" };
const baseId = selected.jobId.split("-")[0];
const activeRole = jobId => ({ jobId, title: "Active Engineer", active: true, favorite: false,
  protectedFromBatchWithdrawal: false, url: `https://jobs.apple.com/en-us/details/${jobId}/active-engineer` });
const page = (roles, pageIndex = 1, pageCount = 1) => ({ roles, pageIndex, pageCount,
  hasNextPage: pageIndex < pageCount, accountVerified: true, withdrawalConfirmationOpen: false,
  inventoryState: roles.length ? "confirmed" : "confirmed_empty" });
const inventory = roles => ({ pages: [page(roles)], pageCount: 1 });

async function worker(data, tabs, initialInventory) {
  let currentInventory = initialInventory;
  let failure = null;
  const h = createBackgroundHarness(tabs, { data, sendMessage: async (_tabId, message) => {
    if (message.type === "APPLE_CAREERS_REVOKE_WORKFLOW") return { ok: true, workflowSessionId: message.workflowSessionId };
    if (["APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE", "APPLE_CAREERS_PEEK_SUBMITTED_HISTORY_PAGE"].includes(message.type)) {
      return { ok: true, data: currentInventory.pages[0] };
    }
    if (message.type === "APPLE_CAREERS_SET_SUBMITTED_HISTORY_PAGE") {
      return { ok: true, data: currentInventory.pages[message.pageIndex - 1] };
    }
    if (message.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES") {
      if (failure) return { ok: false, error: failure };
      return { ok: true, data: currentInventory };
    }
    assert.fail(`Unexpected browser action: ${message.type}`);
  } });
  await h.ready;
  h.sandbox.waitForTabComplete = async () => {};
  h.sandbox.callOpenAi = async () => { assert.fail("Count synchronization must never run LLM analysis"); };
  h.setInventory = value => { currentInventory = value; };
  h.setFailure = value => { failure = value; };
  return h;
}

async function interruptedApplication(activeJobId = baseId) {
  const data = { appleWithdrawalWorkflow: { version: 1, records: {} },
    [rankingKey]: { version: 1, jobs: { [baseId]: { ...selected, queueStatus: "queued" },
      [other.jobId.split("-")[0]]: { ...other, queueStatus: "queued" } }, searches: {},
    applicationFailures: {}, reservations: [] } };
  const tabs = [{ id: 1, windowId: 1, status: "complete", url: selected.url },
    { id: 2, windowId: 1, status: "complete", url: rolesUrl }];
  const initialInventory = inventory([activeRole(activeJobId)]);
  const original = await worker(data, tabs, initialInventory);
  const sessionId = await original.sandbox.claimAppleApplicationSession([selected, other], { sourceTabId: 1, sourceWindowId: 1 });
  const stepId = await original.sandbox.checkpointAppleWorkflowStep(sessionId, selected, 1);
  await original.sandbox.authorizeAppleWorkflowAction({ workflowSessionId: sessionId,
    workflowStepId: stepId, expectedJobId: selected.jobId, action: "submit" }, { tab: tabs[0] });
  await original.sandbox.finishAppleApplicationSession(sessionId);
  const h = await worker(data, tabs, initialInventory);
  h.restart = () => worker(data, tabs, initialInventory);
  return h;
}

async function explicitSync(h) {
  return h.sandbox.dispatch({ type: "APPLE_CAREERS_REFRESH_QUEUE_CAPACITY", tab: h.tabs[1] });
}

function assertUnresolved(h) {
  const workflow = h.data[workflowKey];
  const job = workflow.jobs[selected.jobId];
  assert.equal(workflow.reconciliationRequired, true);
  assert.equal(workflow.status, "paused");
  assert.equal(job.state, "uncertain");
  assert.equal(job.submissionOutcome, "unknown");
  assert.equal(job.submissionAttemptCount, 1);
  assert.ok(h.data[rankingKey].reservations.some(item => item.jobId === selected.jobId), "retain the original exact-ID reservation");
  assert.notEqual(h.data[rankingKey].jobs[baseId].queueStatus, "submitted", "same-base inventory is not confirmation of the reviewed role");
  assert.notEqual(h.data[rankingKey].applicationFailures[baseId].status, "submitted");
  assert.equal(h.data.appleCareersAppliedJobs?.[`apple:${selected.jobId}`], undefined);
  assert.ok(h.calls.messages.every(message => !["APPLE_CAREERS_RUN_APPLICATION_WORKFLOW", "APPLE_CAREERS_AUTHORIZE_WORKFLOW_ACTION"].includes(message.type)),
    "inventory and recovery must not start application actions");
}

for (const activeJobId of [baseId, "200123456-9999"]) {
  test(`verified capacity sync remains successful while recovery cannot match exact ID (${activeJobId})`, async () => {
    const h = await interruptedApplication(activeJobId);
    const response = await explicitSync(h);
    assert.equal(response.ok, true, response.error);
    const state = await h.sandbox.readAppleRankingState();
    const capacity = await h.sandbox.appleRankingCapacity(state);
    assert.equal(capacity.known, true);
    assert.equal(capacity.submitted, 1);
    assert.equal(capacity.remaining, 49);
    assert.equal(state.capacitySnapshot.complete, true);
    assert.equal(h.data[archiveKey].latestScan.complete, true);
    assert.equal(h.data[archiveKey].lastCompleteScan.roles[0].jobId, activeJobId);
    assert.equal(h.data.appleSubmissionSyncStatus.state, "synced");
    assert.ok(h.data.appleSubmissionSyncStatus.lastSuccessAt);
    assert.match(h.data.appleSubmissionSyncStatus.recoveryWarning?.message || "", /exact job ID|full Apple job ID|identity|reconcil/i);
    assertUnresolved(h);
    await assert.rejects(h.sandbox.claimAppleApplicationSession([selected]), /reconcil|interrupted|unknown/i);
    await assert.rejects(h.sandbox.claimAppleApplicationSession([other]), /reconcil|interrupted/i);
  });
}

test("a blocked identity does not contaminate unrelated exact inventory records", async () => {
  const h = await interruptedApplication();
  h.setInventory(inventory([activeRole(baseId), activeRole(other.jobId)]));
  assert.equal((await explicitSync(h)).ok, true);
  assertUnresolved(h);
  assert.equal(h.data[rankingKey].jobs[other.jobId.split("-")[0]].queueStatus, "submitted");
  assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).remaining, 48);
});

test("repeated synchronization and worker restarts preserve unknown identity and never replay Submit", async () => {
  let h = await interruptedApplication();
  for (let count = 0; count < 3; count++) {
    assert.equal((await explicitSync(h)).ok, true);
    assertUnresolved(h);
    assert.equal(h.data[rankingKey].reservations.filter(item => item.jobId === selected.jobId).length, 1);
    const syncedAt = h.data.appleSubmissionSyncStatus.lastSuccessAt;
    h = await worker(h.data, h.tabs, inventory([activeRole(baseId)]));
    assert.equal(h.data.appleSubmissionSyncStatus.lastSuccessAt, syncedAt);
    assert.equal(h.data.appleSubmissionSyncStatus.state, "synced");
    assertUnresolved(h);
    await assert.rejects(h.sandbox.claimAppleApplicationSession([selected]), /reconcil|interrupted|unknown/i);
  }
});

test("identity recovery warning preserves an explicit cancellation while capacity synchronizes", async () => {
  const h = await interruptedApplication();
  await h.sandbox.cancelAppleApplicationSession();
  assert.equal((await explicitSync(h)).ok, true);
  assert.equal(h.data[workflowKey].status, "cancelled");
  assert.equal(h.data[workflowKey].stopRequested, true);
  assert.equal(h.data[workflowKey].reconciliationRequired, true);
  assert.equal(h.data[workflowKey].jobs[selected.jobId].submissionOutcome, "unknown");
  assert.equal(h.data[workflowKey].jobs[selected.jobId].submissionAttemptCount, 1);
  assert.equal(h.data.appleSubmissionSyncStatus.state, "synced");
  assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).known, true);
  await assert.rejects(h.sandbox.claimAppleApplicationSession([other]), /reconcil|interrupted/i);
});

test("a later exact-ID inventory resolves recovery and clears its warning without replay", async () => {
  const h = await interruptedApplication();
  assert.equal((await explicitSync(h)).ok, true);
  assertUnresolved(h);
  h.setInventory(inventory([activeRole(selected.jobId)]));
  assert.equal((await explicitSync(h)).ok, true);
  assert.equal(h.data[workflowKey].reconciliationRequired, false);
  assert.equal(h.data[workflowKey].status, "paused", "resolution must not resume the workflow");
  assert.equal(h.data[workflowKey].jobs[selected.jobId].state, "submitted");
  assert.equal(h.data[workflowKey].jobs[selected.jobId].submissionOutcome, "confirmed");
  assert.equal(h.data[workflowKey].jobs[selected.jobId].submissionAttemptCount, 1);
  assert.equal(h.data[rankingKey].reservations.length, 0);
  assert.equal(h.data[rankingKey].jobs[baseId].queueStatus, "submitted");
  assert.equal(h.data.appleSubmissionSyncStatus.state, "synced");
  assert.equal(h.data.appleSubmissionSyncStatus.recoveryWarning == null, true);
  await assert.rejects(h.sandbox.claimAppleApplicationSession([selected]), /confirmed submission/i);
});

test("later ambiguous presence reinstates recovery after a previous verified absence", async () => {
  let h = await interruptedApplication();
  h.setInventory(inventory([]));
  assert.equal((await explicitSync(h)).ok, true);
  assert.equal(h.data[workflowKey].reconciliationRequired, false);
  assert.equal(h.data[workflowKey].jobs[selected.jobId].state, "uncertain");
  assert.equal(h.data[workflowKey].jobs[selected.jobId].reconciliation, "absent");
  h = await worker(h.data, h.tabs, inventory([activeRole(baseId)]));
  assert.equal(h.data[workflowKey].reconciliationRequired, false, "restart must not fabricate a fresh workflow interruption");
  assert.equal((await explicitSync(h)).ok, true);
  assert.equal(h.data.appleSubmissionSyncStatus.state, "synced");
  assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).known, true);
  assertUnresolved(h);
  await assert.rejects(h.sandbox.claimAppleApplicationSession([other]), /reconcil|interrupted/i);
});

test("a newly claimed queue stops before applications when its capacity check reopens identity recovery", async () => {
  const h = await interruptedApplication();
  h.setInventory(inventory([]));
  assert.equal((await explicitSync(h)).ok, true);
  assert.equal(h.data[workflowKey].reconciliationRequired, false);
  h.setInventory(inventory([activeRole(baseId)]));
  const run = { sourceTabId: 2, sourceWindowId: 1, applying: true, stopRequested: false,
    selectedJobIds: new Set([other.jobId]) };
  await h.sandbox.runAppleJobQueue(run, h.sandbox.normalizeUserProfile({}));
  assert.notEqual(run.workflowSessionId, undefined, "the new batch claimed ownership before discovering ambiguous inventory");
  assert.equal(h.data[workflowKey].id, run.workflowSessionId);
  assert.equal(h.data[workflowKey].jobs[other.jobId].state, "not_started");
  assert.equal(h.data[workflowKey].jobs[other.jobId].submissionAttemptCount, 0);
  assert.equal(h.data.appleSubmissionSyncStatus.state, "synced");
  assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).known, true);
  assertUnresolved(h);
});

for (const failure of ["network", "incomplete"]) {
  test(`${failure} inventory read still invalidates capacity and preserves recovery`, async () => {
    const h = await interruptedApplication();
    assert.equal((await explicitSync(h)).ok, true);
    const syncedAt = h.data.appleSubmissionSyncStatus.lastSuccessAt;
    if (failure === "network") h.setFailure("Apple inventory network read failed");
    else h.setInventory({ pages: [page([activeRole(baseId)], 1, 2)], pageCount: 2 });
    const response = await explicitSync(h);
    assert.equal(response.ok, false);
    assert.equal(h.data.appleSubmissionSyncStatus.state, "failed");
    assert.equal(h.data.appleSubmissionSyncStatus.lastSuccessAt, syncedAt, "a failed read must not look newly verified");
    assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).known, false);
    assert.equal(h.data[archiveKey].lastCompleteScan.roles[0].jobId, baseId, "preserve the previous verified archive");
    assertUnresolved(h);
  });
}

test("successful count sync cannot authorize batch review while recovery identity is unresolved", async () => {
  const h = await interruptedApplication();
  const response = await h.sandbox.dispatch({ type: "APPLE_CAREERS_PREPARE_APPLICATION_BATCH",
    tab: h.tabs[1], selectedIds: [other.jobId], userProfile: {}, reviewRequestId: "blocked-recovery-check" });
  assert.equal(response.ok, false);
  assert.equal(response.errorType, "workflow_recovery_required");
  assert.equal(h.data.appleSubmissionSyncStatus.state, "synced");
  assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).known, true);
  assertUnresolved(h);
});

test("Analyze All retains its complete ranking and capacity when only recovery identity is blocked", async () => {
  const h = await interruptedApplication();
  const scored = [];
  h.sandbox.scoreAppleSubmittedRoles = async roles => {
    scored.push(...roles.map(role => role.jobId));
    return { roles: roles.map(role => ({ ...role, score: 72, reason: "Synthetic cached match" })) };
  };
  const response = await h.sandbox.dispatch({ type: "APPLE_CAREERS_ANALYZE_ALL_SUBMITTED_ROLES",
    tabId: 2, userProfile: {}, analysisId: "analysis-with-recovery-mismatch" });
  assert.equal(response.ok, true, response.error);
  assert.equal(response.data.pagesRead, 1);
  assert.equal(response.data.stopped, false);
  assert.deepEqual(scored, [baseId]);
  assert.equal(h.data[archiveKey].latestScan.complete, true);
  assert.equal(h.data[archiveKey].latestScan.roles[0].score, 72);
  assert.equal(h.data.appleSubmissionSyncStatus.state, "synced");
  assert.ok(h.data.appleSubmissionSyncStatus.recoveryWarning);
  assert.equal((await h.sandbox.appleRankingCapacity(await h.sandbox.readAppleRankingState())).known, true);
  assertUnresolved(h);
});
