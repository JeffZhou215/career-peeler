const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../lib/core.js");
const ranking = require("../lib/jobRanking.js");
const { createBackgroundHarness } = require("./helpers/appleWorkflowHarness.cjs");

const sourceTab = { id: 1, windowId: 1, status: "complete", active: true,
  url: "https://jobs.apple.com/app/en-us/profile/roles", title: "Your Roles" };
const ids = ["200000101-0836", "200000102-9999", "200000103-3543"];
const resumeText = "Built Python backend APIs. Bachelor of Computer Science.";
const resumeFileDataUrl = "data:application/pdf;base64,offline-fixture";
const profile = core.normalizeUserProfile({ resumeText, resumeFileDataUrl,
  resumeTextFingerprint: core.fingerprintText(resumeFileDataUrl), userYearsOfExperience: 1.5,
  llmEnabled: true, llmApiKey: "sk-offline", llmModel: "gpt-4o", llmApiKeyValidationStatus: "valid",
  llmApiKeyValidatedFingerprint: core.fingerprintText("sk-offline"), autoApplyConsent: true,
  workAuthorized: "yes", requiresSponsorship: "no", eeoGender: "male", eeoRaceEthnicity: ["asian"],
  eeoVeteranStatus: "not_protected_veteran", eeoDisabilityStatus: "no_current_or_past" });
const details = { title: "Software Engineer", description: "Build Python backend APIs.",
  minimumQualifications: "Bachelor of Computer Science.", preferredQualifications: "", requiredExperience: [] };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function fixture(options = {}) {
  const entered = deferred();
  const gate = deferred();
  const stages = new Map();
  let h;
  const inventoryPage = { pageIndex: 1, pageCount: 1, roles: options.inventoryRoles || [], hasNextPage: false,
    accountVerified: true, withdrawalConfirmationOpen: false,
    inventoryState: options.inventoryRoles?.length ? "confirmed" : "confirmed_empty" };
  h = createBackgroundHarness([{ ...sourceTab }], {
    getPlatformInfo: options.getPlatformInfo,
    sendMessage: async (tabId, message) => {
      const tab = h.tabs.find(tab => tab.id === tabId);
      if (message.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE") return { ok: true, data: inventoryPage };
      if (message.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES") {
        if (options.blockCapacity) { entered.resolve(); await gate.promise; }
        if (options.capacityError) throw new Error(options.capacityError);
        if (options.failCapacity) return { ok: false,
          error: typeof options.failCapacity === "string" ? options.failCapacity : "Synthetic inventory network failure." };
        if (options.capacityResult) return options.capacityResult;
        return { ok: true, data: { pages: [inventoryPage], pageCount: 1 } };
      }
      if (message.type === "APPLE_CAREERS_EXTRACT_SUBMITTED_ROLE_DETAILS") {
        const jobId = h.sandbox.CareerPeelerApplicationSafety.jobIdFromUrl(tab.url);
        if (options.unavailableJob === jobId) return { ok: true, data: { jobId, url: tab.url,
          ready: false, postingUnavailable: true, unavailableReason: "Sorry, this role does not exist or is no longer available." } };
        if (options.changedDetailJob === jobId) return { ok: true, data: { ...details, ready: true,
          jobId: ids[2], url: `https://jobs.apple.com/en-us/details/${ids[2]}/engineer` } };
        return { ok: true, data: { ...details, jobId, url: tab.url, ready: true } };
      }
      if (message.type === "APPLE_CAREERS_EXTRACT_JOB") return { ok: true, data: {
        jobId: message.expectedJobId, url: tab.url, identityVerified: true, canApply: true, alreadySubmitted: false } };
      if (message.type === "APPLE_CAREERS_VERIFY_WORKFLOW_IDENTITY") return { ok: true,
        data: { expectedJobId: message.expectedJobId, identityVerified: true, url: tab.url } };
      if (message.type === "APPLE_CAREERS_REVOKE_WORKFLOW") return { ok: true, workflowSessionId: message.workflowSessionId };
      assert.equal(message.type, "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW_STEP");
      const id = message.expectedJobId;
      const stage = stages.get(id) || 0;
      stages.set(id, stage + 1);
      if (options.blockStage === stage && id === ids[0]) { entered.resolve(); await gate.promise; }
      if (options.lostReplyJob === id) throw new Error("Synthetic content reply was lost.");
      await h.sandbox.authorizeAppleWorkflowAction({ ...message, action: stage === 3 ? "submit" : "form" }, { tab });
      if (options.manualReviewJob === id && stage === 2) return { ok: true, data: {
        expectedJobId: id, identityVerified: true, url: tab.url, clicked: false, done: false,
        pausedForReview: true, submissionOutcome: "not_attempted", errorType: "saved_application_answer_unresolved",
        summary: "An explicit saved answer is missing.", heading: "Questions",
        steps: [{ step: "Verify saved application answers", status: "blocked", label: "An explicit saved answer is missing." }]
      } };
      if (options.unknownOutcomeJob === id && stage === 3) return { ok: true, data: {
        expectedJobId: id, identityVerified: true, url: tab.url, clicked: true, done: false,
        pausedForReview: true, submissionOutcome: "unknown", errorType: "clicked_but_unconfirmed",
        summary: "Synthetic Submit outcome is unknown.", heading: "Review & Submit",
        steps: [{ step: "Submit application", status: "clicked" }]
      } };
      const labels = ["Open application flow", "Continue application step", "Continue application step", "Submit application"];
      if (stage === 3) await h.sandbox.recordAppleSubmitObservation({ ...message,
        identityVerified: true, submissionOutcome: "confirmed" }, { tab });
      return { ok: true, data: { expectedJobId: id, identityVerified: true, url: tab.url,
        clicked: true, done: stage === 3, submissionOutcome: stage === 3 ? "confirmed" : "not_attempted",
        summary: `Synthetic stage ${stage + 1} complete`, heading: `Stage ${stage + 1}`,
        steps: [{ step: labels[stage], status: "clicked" }],
        ...(stage === 0 ? { openUrlInBackgroundTab: `https://jobs.apple.com/app/en-us/apply/${id}` } : {}) } };
    }
  });
  await h.ready;
  const signature = h.sandbox.appleRankingProfileSignature(profile);
  h.data.appleJobRanking = { jobs: Object.fromEntries(ids.map((id, index) => [ranking.idOf(id), {
    jobId: id, title: `Engineer ${index + 1}`, url: `https://jobs.apple.com/en-us/details/${id}/engineer`,
    score: 95 - index, eligible: true, queueStatus: "queued", profileSignature: signature,
    postingSignature: core.fingerprintText(JSON.stringify(ranking.postingInput(details)))
  }])), searches: {}, reservations: [], applicationFailures: {} };
  if (!options.liveDetailReads) h.sandbox.waitForAppleSubmittedRoleDetails = async (tabId, jobId) => ({ ...details, jobId,
    url: h.tabs.find(tab => tab.id === tabId).url });
  const originalRunner = h.sandbox.runAppleJobQueue;
  h.sandbox.runAppleJobQueue = (...args) => {
    h.run = args[0];
    h.finished = originalRunner(...args);
    return h.finished;
  };
  h.prepare = (selectedIds = ids.slice(0, 2), reviewRequestId = null) => h.sandbox.dispatch({
    type: "APPLE_CAREERS_PREPARE_APPLICATION_BATCH", userProfile: profile, selectedIds, tab: sourceTab, reviewRequestId });
  h.start = async (selectedIds = ids.slice(0, 2)) => {
    const prepared = await h.prepare(selectedIds);
    assert.equal(prepared.ok, true, prepared.error);
    assert.deepEqual([...prepared.data.jobs.map(job => job.jobId)], selectedIds);
    const started = await h.sandbox.dispatch({ type: "APPLE_CAREERS_APPLY_JOB_QUEUE", userProfile: profile,
      tab: sourceTab, selectedIds: prepared.data.jobs.map(job => String(job.jobId)),
      batchToken: prepared.data.batchToken, reviewAcknowledgement: prepared.data.reviewToken });
    assert.equal(started.ok, true, started.error);
    return prepared;
  };
  return Object.assign(h, { stages, inventoryPage, entered: entered.promise, unblock: gate.resolve });
}

async function interruptedSession(h, { jobId = ids[2], state = "in_progress", cancelled = false } = {}) {
  const job = h.data.appleJobRanking.jobs[ranking.idOf(jobId)];
  const sessionId = await h.sandbox.claimAppleApplicationSession([job], {
    sourceTabId: sourceTab.id, sourceWindowId: sourceTab.windowId });
  const workflowTab = { id: 7, windowId: 1, status: "complete", active: false,
    url: `https://jobs.apple.com/app/en-us/apply/${jobId}` };
  h.tabs.push(workflowTab);
  await h.sandbox.updateAppleApplicationSession(sessionId, journal => {
    journal.status = cancelled ? "cancelled" : "paused";
    journal.stopRequested = cancelled;
    journal.reconciliationRequired = true;
    journal.currentJobId = jobId;
    Object.assign(journal.jobs[jobId], { state, tabId: workflowTab.id, workflowSessionId: sessionId,
      submissionOutcome: state === "uncertain" ? "unknown" : state === "submitted" ? "confirmed" : "not_attempted",
      submissionAttemptCount: state === "uncertain" || state === "submitted" ? 1 : 0 });
  });
  job.queueStatus = state === "uncertain" ? "uncertain" : state === "submitted" ? "submitted" : "needs_review";
  return sessionId;
}

const fullInventoryReads = h => h.calls.messages.filter(message => message.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES");

test("an explicitly unavailable posting is recorded without Submit and the remaining reviewed batch continues", async () => {
  const h = await fixture({ liveDetailReads: true, unavailableJob: ids[0] });
  await h.start();
  await h.finished;
  const failed = h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])];
  assert.equal(failed.errorType, "job_unavailable");
  assert.match(failed.reason, /no longer available/);
  assert.equal(failed.submissionOutcomeUnknown, false);
  assert.equal(h.stages.has(ids[0]), false, "no application step is sent for the unavailable role");
  assert.equal(h.stages.get(ids[1]), 4, "the next selected role completes all mocked application steps");
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, "unavailable");
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[1])].queueStatus, "submitted");
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[2])].queueStatus, "queued");
  assert.equal(h.data.appleJobRanking.lastBatchSummary.submitted, 1);
  assert.equal(h.data.appleJobRanking.lastBatchSummary.failed, 1);
  assert.equal(h.data.appleJobRanking.reservations.some(item => item.jobId === ids[0]), false);
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].submissionAttemptCount, 0);
});

test("a genuine posting identity change still pauses before any application in the batch", async () => {
  const h = await fixture({ liveDetailReads: true, changedDetailJob: ids[0] });
  await h.start();
  await h.finished;
  assert.equal(h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])].errorType, "job_identity_mismatch");
  assert.equal(h.stages.size, 0);
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[1])].queueStatus, "queued");
  assert.equal(h.data.appleJobRanking.reservations.length, 0);
  assert.equal(h.data.appleJobRanking.lastBatchSummary.submitted, 0);
});

test("an unavailable middle posting preserves prior confirmed results and continues the remaining reviewed selection", async () => {
  const h = await fixture({ liveDetailReads: true, unavailableJob: ids[1] });
  await h.start(ids);
  await h.finished;
  assert.equal(h.stages.get(ids[0]), 4);
  assert.equal(h.stages.has(ids[1]), false);
  assert.equal(h.stages.get(ids[2]), 4);
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, "submitted");
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[1])].queueStatus, "unavailable");
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[2])].queueStatus, "submitted");
  assert.equal(h.data.appleJobRanking.lastBatchSummary.submitted, 2);
  assert.equal(h.data.appleJobRanking.lastBatchSummary.failed, 1);
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[1]].submissionAttemptCount, 0);
});

test("a role paused for manual review keeps its application draft through queue cleanup", async () => {
  const h = await fixture({ manualReviewJob: ids[0] });
  await h.start([ids[0]]);
  await h.finished;
  const application = h.tabs.find(tab => tab.url === `https://jobs.apple.com/app/en-us/apply/${ids[0]}`);
  assert.ok(application, "the runner opened the selected role's application");
  assert.equal(h.calls.removed.includes(application.id), false, "cleanup must preserve the paused draft");
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].submissionOutcome, "not_attempted");
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].submissionAttemptCount, 0);
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, "needs_review");
  assert.equal(h.data.appleJobRanking.lastBatchSummary.submitted, 0);
});

test("an uncertain application stays open for reconciliation without releasing its reservation or replaying Submit", async () => {
  const h = await fixture({ unknownOutcomeJob: ids[0] });
  await h.start([ids[0]]);
  await h.finished;
  const application = h.tabs.find(tab => tab.url === `https://jobs.apple.com/app/en-us/apply/${ids[0]}`);
  assert.equal(h.calls.removed.includes(application.id), false);
  assert.equal(h.data.appleApplicationWorkflow.reconciliationRequired, true);
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].submissionOutcome, "unknown");
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].submissionAttemptCount, 1);
  assert.ok(h.data.appleJobRanking.reservations.some(item => item.jobId === ids[0]));
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, "uncertain");
  assert.equal(h.data.appleJobRanking.lastBatchSummary.submitted, 0);
  await assert.rejects(h.sandbox.claimAppleApplicationSession([{ jobId: ids[0] }]), /reconciliation/);
  assert.equal(h.stages.get(ids[0]), 4);
});

test("real reviewed multi-role batch completes four stages for each exact selected job and retains the unselected job", async () => {
  const h = await fixture();
  await h.start();
  await h.finished;
  assert.deepEqual([...h.stages.entries()], [[ids[0], 4], [ids[1], 4]]);
  assert.deepEqual(h.calls.checkpoints, ids.slice(0, 2));
  const journal = h.data.appleApplicationWorkflow;
  assert.equal(journal.status, "completed");
  assert.equal(journal.reconciliationRequired, false);
  assert.deepEqual(Object.keys(journal.jobs), ids.slice(0, 2));
  for (const id of ids.slice(0, 2)) {
    assert.equal(journal.jobs[id].state, "submitted");
    assert.equal(journal.jobs[id].submissionAttemptCount, 1);
    assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(id)].queueStatus, "submitted");
  }
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[2])].queueStatus, "queued");
  assert.equal(h.data.appleJobRanking.lastBatchSummary.submitted, 2);
  assert.deepEqual(h.calls.intervalDelays, [20000]);
  assert.equal(h.intervals.size, 0);
});

test("explicit active batch maintains worker activity during a blocked content response and releases it after success", async () => {
  const h = await fixture({ blockStage: 1 });
  await h.start();
  await h.entered;
  assert.equal(h.intervals.size, 1);
  const pulse = [...h.intervals.values()][0];
  const initial = h.calls.platformReads;
  await pulse();
  await pulse();
  assert.equal(h.calls.platformReads, initial + 2);
  assert.equal(h.data.appleApplicationWorkflow.status, "running");
  h.unblock();
  await h.finished;
  assert.equal(h.intervals.size, 0);
  const completed = h.calls.platformReads;
  await pulse();
  assert.equal(h.calls.platformReads, completed, "a released callback cannot keep an idle worker active");
});

test("capacity failure releases worker activity and preserves unknown inventory without applying", async () => {
  const h = await fixture({ failCapacity: true });
  await h.start();
  await h.finished;
  assert.equal(h.intervals.size, 0);
  assert.equal(h.stages.size, 0);
  assert.equal(h.data.appleJobRanking.capacitySnapshot.inventoryState, "unknown");
  assert.match(h.data.appleJobRanking.error, /inventory network failure/);
  assert.ok(ids.every(id => h.data.appleJobRanking.jobs[ranking.idOf(id)].queueStatus === "queued"));
});

test("a lost second-job content reply pauses uncertainty and releases activity without replaying Submit", async () => {
  const h = await fixture({ lostReplyJob: ids[1] });
  await h.start();
  await h.finished;
  assert.equal(h.intervals.size, 0);
  assert.equal(h.stages.get(ids[0]), 4);
  assert.equal(h.stages.get(ids[1]), 1);
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, "submitted");
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[1])].queueStatus, "uncertain");
  assert.equal(h.data.appleApplicationWorkflow.status, "paused");
  assert.equal(h.data.appleApplicationWorkflow.reconciliationRequired, true);
  assert.match(h.data.appleJobRanking.error, /outcome is unknown/);
});

test("explicit Stop releases activity immediately while an inventory reply is pending and does not resume afterward", async () => {
  const h = await fixture({ blockCapacity: true });
  await h.start();
  await h.entered;
  const pulse = [...h.intervals.values()][0];
  await h.sandbox.dispatch({ type: "APPLE_CAREERS_STOP_JOB_RANKING" });
  assert.equal(h.intervals.size, 0);
  const stopped = h.calls.platformReads;
  await pulse();
  assert.equal(h.calls.platformReads, stopped);
  h.unblock();
  await h.finished;
  assert.equal(h.stages.size, 0);
  assert.equal(h.data.appleApplicationWorkflow.status, "cancelled");
  assert.equal(h.data.appleApplicationWorkflow.stopRequested, true);
  assert.equal(h.intervals.size, 0);
});

test("repeated timer callbacks never overlap extension API calls and release is idempotent", async () => {
  const api = deferred();
  const h = createBackgroundHarness(undefined, { getPlatformInfo: () => api.promise });
  await h.ready;
  const run = { stopRequested: false };
  const release = h.sandbox.startAppleApplicationWorkerActivity(run);
  const pulse = [...h.intervals.values()][0];
  assert.equal(h.calls.platformReads, 1);
  await pulse();
  await pulse();
  assert.equal(h.calls.platformReads, 1, "pending API reads cannot overlap");
  api.resolve({ os: "mac", arch: "arm64" });
  await new Promise(setImmediate); // Drain the async runtime wrapper's promise adoption.
  await pulse();
  assert.equal(h.calls.platformReads, 2);
  release();
  release();
  assert.equal(h.intervals.size, 0);
  await pulse();
  assert.equal(h.calls.platformReads, 2);
});

test("worker startup and recovery never acquire worker activity or restart a paused batch", async () => {
  const data = { appleApplicationWorkflow: { id: "old-owner", owner: "previous-worker", status: "running",
    jobs: Object.fromEntries(ids.slice(0, 2).map(id => [id, { jobId: id, state: "not_started", submissionOutcome: "not_attempted" }])) } };
  const h = createBackgroundHarness([{ ...sourceTab }], { data });
  await h.ready;
  assert.equal(h.data.appleApplicationWorkflow.status, "paused");
  assert.equal(h.data.appleApplicationWorkflow.reconciliationRequired, true);
  assert.equal(h.calls.platformReads, 0);
  assert.equal(h.intervals.size, 0);
  assert.deepEqual(h.calls.intervalDelays, []);
  assert.ok(h.calls.messages.every(message => message.type === "APPLE_CAREERS_REVOKE_WORKFLOW"));
});

test("preparing a reviewed batch reconciles a paused owner against complete inventory without claiming or applying", async () => {
  const h = await fixture();
  const sessionId = await interruptedSession(h);
  const prepared = await h.prepare();
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.data.reconciliationPerformed, true);
  assert.deepEqual([...prepared.data.jobs.map(job => job.jobId)], ids.slice(0, 2));
  assert.equal(fullInventoryReads(h).length, 1);
  assert.equal(h.data.appleApplicationWorkflow.id, sessionId, "review does not claim a new application owner");
  assert.equal(h.data.appleApplicationWorkflow.reconciliationRequired, false);
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[2]].reconciliation, "not_attempted");
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[2]].submissionOutcome, "not_attempted");
  assert.equal(prepared.data.capacity.known, true);
  assert.equal(prepared.data.capacity.submitted, 0);
  assert.equal(prepared.data.capacity.remaining, 50);
  assert.equal(h.data.appleJobRanking.capacitySnapshot.inventoryState, "confirmed_empty");
  assert.equal(h.stages.size, 0);
  assert.equal(h.calls.checkpoints.length, 0);
});

test("an absent uncertain job remains reserved while a different reviewed batch is prepared", async () => {
  const h = await fixture();
  const sessionId = await interruptedSession(h, { state: "uncertain" });
  const prepared = await h.prepare();
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.data.reconciliationPerformed, true);
  assert.equal(h.data.appleApplicationWorkflow.id, sessionId);
  const outstanding = h.data.appleApplicationWorkflow.jobs[ids[2]];
  assert.equal(outstanding.state, "uncertain");
  assert.equal(outstanding.submissionOutcome, "unknown");
  assert.equal(outstanding.reconciliation, "absent");
  assert.equal(h.data.appleJobRanking.reservations[0].jobId, ids[2]);
  assert.equal(prepared.data.capacity.submitted, 1);
  assert.equal(prepared.data.capacity.remaining, 49);
  assert.equal(h.stages.size, 0);
});

test("authentication, network, and incomplete preflight inventories retain recovery guards and unknown capacity", async () => {
  const role = { jobId: "200001234-0836", active: true };
  for (const options of [{ failCapacity: "Please sign in to Apple Careers before synchronizing." },
    { capacityError: "Synthetic network failure while reading inventory." },
    { capacityResult: { ok: true, data: { pages: [{ pageIndex: 1, pageCount: 2, roles: [role], hasNextPage: true,
      accountVerified: true, withdrawalConfirmationOpen: false, inventoryState: "confirmed" }], pageCount: 2 } } },
    { capacityResult: { ok: true, data: { pages: [], pageCount: 0 } } }]) {
    const h = await fixture(options);
    const sessionId = await interruptedSession(h, { state: "uncertain" });
    h.data.appleJobRanking.capacitySnapshot = { complete: true, inventoryState: "confirmed", roles: [role],
      scannedAt: 1, updatedAt: 1 };
    const prepared = await h.prepare();
    assert.equal(prepared.ok, false);
    assert.equal(prepared.errorType, "submission_sync_failed");
    assert.ok(prepared.error);
    assert.equal(h.data.appleApplicationWorkflow.id, sessionId);
    assert.equal(h.data.appleApplicationWorkflow.reconciliationRequired, true);
    assert.equal(h.data.appleApplicationWorkflow.jobs[ids[2]].state, "uncertain");
    assert.equal(h.data.appleJobRanking.capacitySnapshot.inventoryState, "unknown");
    const capacity = await h.sandbox.appleRankingCapacity(h.data.appleJobRanking);
    assert.equal(capacity.known, false);
    assert.equal(capacity.submitted, null, "failed reads cannot fabricate zero applications");
    assert.equal(h.stages.size, 0);
    assert.equal(h.calls.checkpoints.length, 0);
  }
});

test("concurrent batch preparations cannot acquire duplicate reconciliation work", async () => {
  const h = await fixture({ blockCapacity: true });
  const sessionId = await interruptedSession(h);
  const first = h.prepare();
  await h.entered;
  const second = await h.prepare();
  assert.equal(second.ok, false);
  assert.match(second.error, /current|running|progress|busy|wait/i);
  assert.equal(fullInventoryReads(h).length, 1);
  assert.equal(h.data.appleApplicationWorkflow.id, sessionId);
  h.unblock();
  const prepared = await first;
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.data.reconciliationPerformed, true);
  assert.equal(fullInventoryReads(h).length, 1);
  const subsequent = await h.prepare();
  assert.equal(subsequent.ok, true, subsequent.error);
  assert.equal(subsequent.data.reconciliationPerformed, false);
  assert.equal(fullInventoryReads(h).length, 1, "completed reconciliation is not repeated by later review requests");
  assert.equal(h.stages.size, 0);
});

test("normal reviewed preparation reads cached capacity without automatically synchronizing", async () => {
  const h = await fixture();
  h.data.appleJobRanking.capacitySnapshot = { complete: true, inventoryState: "confirmed_empty", roles: [],
    scannedAt: 1, updatedAt: 1 };
  const journalBefore = structuredClone(h.data.appleApplicationWorkflow);
  const prepared = await h.prepare();
  assert.equal(prepared.ok, true, prepared.error);
  assert.notEqual(prepared.data.reconciliationPerformed, true);
  assert.equal(prepared.data.capacity.known, true);
  assert.equal(prepared.data.capacity.remaining, 50);
  assert.equal(fullInventoryReads(h).length, 0);
  assert.deepEqual(h.data.appleApplicationWorkflow, journalBefore, "reviewing cached roles does not claim workflow ownership");
  assert.equal(h.stages.size, 0);
});

test("explicit Stop during batch-preparation reconciliation preserves cancellation and never applies", async () => {
  const h = await fixture({ blockCapacity: true });
  const sessionId = await interruptedSession(h, { state: "uncertain" });
  const pending = h.prepare();
  await h.entered;
  await h.sandbox.dispatch({ type: "APPLE_CAREERS_STOP_JOB_RANKING" });
  h.unblock();
  const prepared = await pending;
  assert.equal(prepared.ok, false);
  assert.equal(prepared.errorType, "stopped_by_user");
  assert.match(prepared.error, /stop|cancel/i);
  assert.equal(h.data.appleApplicationWorkflow.id, sessionId);
  assert.equal(h.data.appleApplicationWorkflow.status, "cancelled");
  assert.equal(h.data.appleApplicationWorkflow.stopRequested, true);
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[2]].state, "uncertain");
  assert.equal(h.stages.size, 0);
  assert.equal(h.calls.checkpoints.length, 0);
});

test("verified absence never authorizes selection of the exact job with an unknown Submit outcome", async () => {
  const h = await fixture();
  await interruptedSession(h, { jobId: ids[0], state: "uncertain" });
  const prepared = await h.prepare(ids.slice(0, 2));
  assert.equal(prepared.ok, false);
  assert.equal(prepared.errorType, "submission_outcome_unknown");
  assert.match(prepared.error, /unknown|uncertain|review|queued|selection|selected/i);
  assert.equal(fullInventoryReads(h).length, 1);
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].state, "uncertain");
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].submissionOutcome, "unknown");
  assert.ok(h.data.appleJobRanking.reservations.some(item => item.jobId === ids[0]));
  assert.equal(h.stages.size, 0);
});

test("an inventory-confirmed selected submission requires reselecting the batch rather than silently shrinking it", async () => {
  const h = await fixture({ inventoryRoles: [{ jobId: ids[0], active: true }] });
  await interruptedSession(h, { jobId: ids[0], state: "uncertain" });
  const prepared = await h.prepare(ids.slice(0, 2));
  assert.equal(prepared.ok, false);
  assert.equal(prepared.errorType, "batch_review_failed");
  assert.match(prepared.error, /review|select|queued|already|submitted/i);
  assert.equal(fullInventoryReads(h).length, 1);
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].state, "submitted");
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, "submitted");
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[1])].queueStatus, "queued");
  assert.equal(h.stages.size, 0);
});

test("a reconciled batch still waits for explicit confirmation and performs mandatory capacity verification before applying", async () => {
  const h = await fixture();
  const previousOwner = await interruptedSession(h, { state: "uncertain" });
  const prepared = await h.prepare();
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.data.reconciliationPerformed, true);
  assert.equal(h.stages.size, 0, "automatic reconciliation cannot initiate applications");
  const started = await h.sandbox.dispatch({ type: "APPLE_CAREERS_APPLY_JOB_QUEUE", userProfile: profile,
    tab: sourceTab, selectedIds: ids.slice(0, 2), batchToken: prepared.data.batchToken,
    reviewAcknowledgement: prepared.data.reviewToken });
  assert.equal(started.ok, true, started.error);
  await h.finished;
  assert.equal(fullInventoryReads(h).length, 2, "preparing recovery cannot replace the fresh pre-application capacity check");
  assert.notEqual(h.data.appleApplicationWorkflow.id, previousOwner);
  assert.deepEqual([...h.stages.entries()], [[ids[0], 4], [ids[1], 4]]);
  assert.deepEqual(h.calls.checkpoints, ids.slice(0, 2));
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[2]].state, "uncertain");
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[2]].submissionOutcome, "unknown");
  assert.ok(h.data.appleJobRanking.reservations.some(item => item.jobId === ids[2]));
  assert.equal((await h.sandbox.appleRankingCapacity(h.data.appleJobRanking)).remaining, 47);
});

test("review cancellation binds its request identity and a stale cancel cannot stop a later application owner", async () => {
  const h = await fixture({ blockCapacity: true });
  const previousOwner = await interruptedSession(h);
  const pending = h.prepare(ids.slice(0, 2), "review-A");
  await h.entered;
  const journalBefore = structuredClone(h.data.appleApplicationWorkflow);
  const unrelated = await h.sandbox.dispatch({ type: "APPLE_CAREERS_STOP_JOB_RANKING", reviewRequestId: "review-B" });
  assert.equal(unrelated.ok, true);
  assert.equal(unrelated.ignored, true);
  assert.deepEqual(h.data.appleApplicationWorkflow, journalBefore, "a mismatched review cannot revoke the current owner");
  assert.equal(fullInventoryReads(h).length, 1);
  assert.equal(h.data.appleJobRanking.running, true, "the matching preflight remains pending");
  assert.equal(h.stages.size, 0);
  const cancelled = await h.sandbox.dispatch({ type: "APPLE_CAREERS_STOP_JOB_RANKING", reviewRequestId: "review-A" });
  assert.equal(cancelled.ok, true);
  assert.notEqual(cancelled.ignored, true);
  h.unblock();
  const prepared = await pending;
  assert.equal(prepared.ok, false);
  assert.equal(prepared.errorType, "stopped_by_user");
  assert.equal(h.data.appleApplicationWorkflow.id, previousOwner);
  assert.equal(h.data.appleApplicationWorkflow.status, "cancelled");
  assert.equal(h.data.appleApplicationWorkflow.stopRequested, true);
  assert.equal(h.stages.size, 0);

  const entered = deferred();
  const gate = deferred();
  const send = h.sandbox.chrome.tabs.sendMessage;
  h.sandbox.chrome.tabs.sendMessage = async (tabId, message) => {
    if (message.type === "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW_STEP" && message.expectedJobId === ids[0] &&
      h.stages.get(ids[0]) === 1) { entered.resolve(); await gate.promise; }
    return send(tabId, message);
  };
  await h.start();
  await entered.promise;
  const activeOwner = structuredClone(h.data.appleApplicationWorkflow);
  assert.notEqual(activeOwner.id, previousOwner);
  assert.equal(activeOwner.status, "running");
  const stale = await h.sandbox.dispatch({ type: "APPLE_CAREERS_STOP_JOB_RANKING", reviewRequestId: "review-A" });
  assert.equal(stale.ok, true);
  assert.equal(stale.ignored, true);
  assert.equal(h.run.stopRequested, false, "an old review request cannot cancel a new application run");
  assert.deepEqual(h.data.appleApplicationWorkflow, activeOwner);
  gate.resolve();
  await h.finished;
  assert.deepEqual([...h.stages.entries()], [[ids[0], 4], [ids[1], 4]]);
  assert.equal(h.data.appleApplicationWorkflow.status, "completed");
  assert.equal(h.data.appleJobRanking.lastBatchSummary.submitted, 2);
});
