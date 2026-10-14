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
  const inventoryPage = { pageIndex: 1, pageCount: 1, roles: [], hasNextPage: false,
    accountVerified: true, withdrawalConfirmationOpen: false, inventoryState: "confirmed_empty" };
  h = createBackgroundHarness([{ ...sourceTab }], {
    getPlatformInfo: options.getPlatformInfo,
    sendMessage: async (tabId, message) => {
      const tab = h.tabs.find(tab => tab.id === tabId);
      if (message.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE") return { ok: true, data: inventoryPage };
      if (message.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES") {
        if (options.blockCapacity) { entered.resolve(); await gate.promise; }
        if (options.failCapacity) return { ok: false, error: "Synthetic inventory network failure." };
        return { ok: true, data: { pages: [inventoryPage], pageCount: 1 } };
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
  h.sandbox.waitForAppleSubmittedRoleDetails = async (tabId, jobId) => ({ ...details, jobId,
    url: h.tabs.find(tab => tab.id === tabId).url });
  const originalRunner = h.sandbox.runAppleJobQueue;
  h.sandbox.runAppleJobQueue = (...args) => {
    h.run = args[0];
    h.finished = originalRunner(...args);
    return h.finished;
  };
  h.start = async (selectedIds = ids.slice(0, 2)) => {
    const prepared = await h.sandbox.dispatch({ type: "APPLE_CAREERS_PREPARE_APPLICATION_BATCH", userProfile: profile, selectedIds });
    assert.equal(prepared.ok, true, prepared.error);
    assert.deepEqual([...prepared.data.jobs.map(job => job.jobId)], selectedIds);
    const started = await h.sandbox.dispatch({ type: "APPLE_CAREERS_APPLY_JOB_QUEUE", userProfile: profile,
      tab: sourceTab, selectedIds: prepared.data.jobs.map(job => String(job.jobId)),
      batchToken: prepared.data.batchToken, reviewAcknowledgement: prepared.data.reviewToken });
    assert.equal(started.ok, true, started.error);
    return prepared;
  };
  return Object.assign(h, { stages, entered: entered.promise, unblock: gate.resolve });
}

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
