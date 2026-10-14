const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness, createContentHarness, radioQuestion, installQuestions } = require("./helpers/appleWorkflowHarness.cjs");

const job = { jobId: "200123456-0836", title: "Software Engineer", url: "https://jobs.apple.com/en-us/details/200123456-0836/engineer" };
const otherJob = { ...job, jobId: "200987654-0836", title: "Other Engineer" };
const key = "appleApplicationWorkflow";
const baseId = "200123456";

async function session(jobs = [job, otherJob]) {
  const h = createBackgroundHarness();
  await h.ready;
  h.data.appleJobRanking = { version: 1, running: true, jobs: Object.fromEntries(jobs.map(role =>
    [role.jobId.split("-")[0], { ...role, queueStatus: "queued" }])), searches: {}, applicationFailures: {}, reservations: [] };
  h.id = await h.sandbox.claimAppleApplicationSession(jobs, { sourceTabId: 1, sourceWindowId: 1 });
  return h;
}

async function step(h) {
  h.stepId = await h.sandbox.checkpointAppleWorkflowStep(h.id, job, 1);
  await h.sandbox.beginKnownSiteActivityCycle([], [], job, "Applying");
  return h.stepId;
}

const action = (h, kind = "form") => ({ type: "APPLE_CAREERS_AUTHORIZE_WORKFLOW_ACTION", action: kind,
  workflowSessionId: h.id, workflowStepId: h.stepId, expectedJobId: job.jobId });

async function restart(h, content = null) {
  const next = createBackgroundHarness(h.tabs, { data: h.data, sendMessage: (_id, message) => {
    assert.equal(message.type, "APPLE_CAREERS_REVOKE_WORKFLOW", "recovery must never issue a mutating workflow step");
    return content ? content.dispatch(message) : { ok: true, workflowSessionId: message.workflowSessionId };
  } });
  await next.ready;
  return next;
}

function result(h, overrides = {}) {
  return { expectedJobId: job.jobId, identityVerified: true, url: h.tabs[0].url,
    clicked: true, done: false, submissionOutcome: "not_attempted", steps: [{ step: "Continue application step", status: "clicked" }],
    summary: "Continued", ...overrides };
}

const inventory = (roles = []) => ({ complete: true, inventoryState: roles.length ? "confirmed" : "confirmed_empty", roles });

test("restart before application begins preserves not-started jobs and never auto-starts them", async () => {
  const h = await session();
  const recovered = await restart(h);
  assert.equal(h.data[key].status, "paused");
  assert.equal(h.data[key].reconciliationRequired, true);
  assert.equal(h.data[key].jobs[job.jobId].state, "not_started");
  assert.equal(h.data.appleJobRanking.jobs[baseId].queueStatus, "queued");
  assert.equal(recovered.calls.messages.length, 0);
  await assert.rejects(recovered.sandbox.claimAppleApplicationSession([job]), /Sync Submissions/);
});

test("restart during ordinary filling preserves exact identity and in-progress state", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h), { tab: h.tabs[0] });
  await h.sandbox.checkpointAppleWorkflowResult(h.id, job.jobId, h.stepId, result(h));
  const recovered = await restart(h);
  const current = h.data[key].jobs[job.jobId];
  assert.equal(current.state, "in_progress");
  assert.equal(current.submissionAttemptCount, 0);
  assert.equal(current.submissionOutcome, "not_attempted");
  assert.equal(h.data.appleCareersScanStatus.currentJob.jobId, job.jobId);
  assert.equal(h.data.appleJobRanking.applicationFailures[baseId].submissionOutcomeUnknown, false);
  assert.equal(h.data.appleCareersKnownSiteActivity.running, false);
  assert.equal(h.data.appleCareersKnownSiteActivity.cycles[0].status, "attention");
  await assert.rejects(recovered.sandbox.authorizeAppleWorkflowAction(action(h), { tab: h.tabs[0] }), /stopped|replaced/);
});

test("restart immediately before Submit treats committed permission as uncertain even without click acknowledgement", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  const next = await restart(h);
  const current = h.data[key].jobs[job.jobId];
  assert.equal(current.state, "uncertain");
  assert.equal(current.submissionOutcome, "unknown");
  assert.equal(current.submissionAttemptCount, 1);
  assert.equal(h.data.appleJobRanking.jobs[baseId].queueStatus, "uncertain");
  assert.equal(h.data.appleJobRanking.reservations[0].jobId, job.jobId);
  assert.ok(next.calls.messages.every(message => message.type === "APPLE_CAREERS_REVOKE_WORKFLOW"));
  await assert.rejects(next.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] }));
});

test("restart after Submit but before confirmation reserves the slot and pauses remaining jobs", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  await h.sandbox.checkpointAppleWorkflowResult(h.id, job.jobId, h.stepId, result(h, {
    submissionOutcome: "unknown", steps: [{ step: "Submit application", status: "clicked" }] }));
  await restart(h);
  assert.equal(h.data[key].jobs[job.jobId].state, "uncertain");
  assert.equal(h.data[key].jobs[otherJob.jobId].state, "not_started");
  assert.equal(h.data.appleJobRanking.lastBatchSummary.submitted, 0);
  assert.equal(h.data.appleCareersKnownSiteActivity.cycles[0].status, "attention");
});

test("restart after confirmed submission restores confirmed progress without replay or duplicate counting", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  await h.sandbox.checkpointAppleWorkflowResult(h.id, job.jobId, h.stepId, result(h, {
    done: true, submissionOutcome: "confirmed", steps: [{ step: "Submit application", status: "clicked" },
      { step: "Confirm application submitted", status: "detected" }] }));
  await restart(h);
  assert.equal(h.data[key].jobs[job.jobId].state, "submitted");
  assert.equal(h.data.appleJobRanking.jobs[baseId].queueStatus, "submitted");
  assert.equal(h.data.appleJobRanking.lastBatchSummary.submitted, 1);
  assert.equal(h.data.appleCareersAppliedJobs[`apple:${job.jobId}`].status, "applied");
  assert.equal(h.data.appleCareersScanStatus.savedAppliedCount, 1);
  assert.equal(h.data.appleCareersKnownSiteActivity.cycles[0].status, "success");
  assert.equal(h.data[key].jobs[otherJob.jobId].state, "not_started");
});

test("repeated recovery is idempotent and fences even late result writes from the old worker", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  const next = await restart(h);
  const recoveredAt = h.data[key].recoveredAt;
  await next.sandbox.recoverAppleApplicationSession();
  await restart(next);
  assert.equal(h.data[key].recoveredAt, recoveredAt);
  assert.equal(h.data[key].jobs[job.jobId].submissionAttemptCount, 1);
  assert.equal(h.data.appleJobRanking.reservations.length, 1);
  await assert.rejects(h.sandbox.checkpointAppleWorkflowResult(h.id, job.jobId, h.stepId, result(h, { done: true })), /replaced/);
  await assert.rejects(h.sandbox.finishAppleApplicationSession(h.id), /replaced/);
  assert.equal(h.data[key].status, "paused");
});

test("cancellation during recovery persists across another restart without freeing an uncertain slot", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  const next = await restart(h);
  await next.sandbox.stopAppleJobRanking();
  await restart(next);
  assert.equal(h.data[key].stopRequested, true);
  assert.equal(h.data[key].status, "cancelled");
  assert.equal(h.data[key].reconciliationRequired, true);
  assert.equal(h.data.appleJobRanking.reservations.length, 1);
});

test("explicit stop before Submit is retained and cannot become an automatic resume", async () => {
  const h = await session();
  await step(h);
  h.sandbox.chrome.tabs.sendMessage = async (_id, message) => ({ ok: true, workflowSessionId: message.workflowSessionId });
  await h.sandbox.stopScan();
  const next = await restart(h);
  assert.equal(h.data[key].status, "cancelled");
  assert.equal(h.data[key].stopRequested, true);
  assert.equal(h.data[key].jobs[job.jobId].submissionAttemptCount, 0);
  assert.equal(h.data.appleCareersScanStatus.running, false);
  assert.equal(next.calls.checkpoints.length, 0);
});

test("a changed full job ID after recovery cannot authorize actions or reconcile another suffix", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  const next = await restart(h);
  h.tabs[0].url = h.tabs[0].url.replace("0836", "9999");
  await assert.rejects(next.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] }));
  await assert.rejects(next.sandbox.reconcileAppleApplicationSession(inventory([{ jobId: "200123456-9999" }])), /full Apple job ID/);
  assert.equal(h.data[key].jobs[job.jobId].submissionOutcome, "unknown");
  assert.equal(h.data[key].reconciliationRequired, true);
});

test("incomplete, failed, and cached inventories cannot unlock recovery", async () => {
  const h = await session();
  await step(h);
  const next = await restart(h);
  for (const invalid of [{ complete: false, inventoryState: "unknown", roles: [] },
    { complete: true, roles: [] }, { complete: true, inventoryState: "unknown", roles: [] }]) {
    await assert.rejects(next.sandbox.reconcileAppleApplicationSession(invalid), /complete authenticated/);
  }
  assert.equal(h.data[key].reconciliationRequired, true);
});

test("complete reconciliation records presence or absence without resuming or claiming failure from absence", async () => {
  for (const present of [false, true]) {
    const h = await session();
    await step(h);
    await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
    const next = await restart(h);
    await next.sandbox.reconcileAppleApplicationSession(inventory(present ? [{ jobId: job.jobId }] : []));
    assert.equal(h.data[key].reconciliationRequired, false);
    assert.equal(h.data[key].status, "paused");
    assert.equal(h.data[key].jobs[job.jobId].reconciliation, present ? "present" : "absent");
    assert.equal(h.data[key].jobs[job.jobId].state, present ? "submitted" : "uncertain");
    assert.equal(next.calls.checkpoints.length, 0);
    assert.ok(next.calls.messages.every(message => message.type === "APPLE_CAREERS_REVOKE_WORKFLOW"));
  }
});

test("competing session claims and duplicate step ownership cannot both succeed", async () => {
  const h = createBackgroundHarness();
  await h.ready;
  const claims = await Promise.allSettled([h.sandbox.claimAppleApplicationSession([job]), h.sandbox.claimAppleApplicationSession([job])]);
  assert.equal(claims.filter(result => result.status === "fulfilled").length, 1);
  h.id = h.data[key].id;
  await step(h);
  await assert.rejects(h.sandbox.checkpointAppleWorkflowStep(h.id, job, 1), /already executing/);
});

test("Submit intent is committed before permission resolves, and only explicit rejection permits a bounded retry", async () => {
  const h = await session();
  for (let count = 1; count <= 3; count++) {
    await step(h);
    await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
    assert.equal(h.data[key].jobs[job.jobId].submissionAttemptCount, count);
    assert.equal(h.data[key].jobs[job.jobId].submissionOutcome, "unknown");
    await assert.rejects(h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] }), /unresolved/);
    await h.sandbox.checkpointAppleWorkflowResult(h.id, job.jobId, h.stepId, result(h, {
      submissionOutcome: "rejected", steps: [{ step: "Submit application", status: "clicked" }] }));
  }
  await step(h);
  await assert.rejects(h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] }), /limit/);
  assert.equal(h.data[key].jobs[job.jobId].submissionAttemptCount, 3);
});

test("revocation blocks a granted-but-delayed page action before it clicks Submit", async () => {
  const h = await session();
  await step(h);
  const content = createContentHarness();
  let release;
  const granted = new Promise(resolve => { release = resolve; });
  let grantedSignal;
  const wasGranted = new Promise(resolve => { grantedSignal = resolve; });
  content.chrome.runtime.sendMessage = async message => {
    const reply = await h.sandbox.authorizeAppleWorkflowAction(message, { tab: h.tabs[0] });
    grantedSignal();
    await granted;
    return reply;
  };
  const clicks = [];
  const button = { innerText: "Submit", scrollIntoView() {}, click: () => clicks.push("submit") };
  content.getVisibleValidationErrors = () => [];
  const options = { ...action(h), assertIdentity() {} };
  options.assertOwnership = kind => content.assertAppleWorkflowOwnership(options, kind);
  const pending = content.clickAndDetectSubmission(button, [], options);
  await wasGranted;
  const next = await restart(h, content);
  release();
  await assert.rejects(pending, /stopped|restarted/);
  assert.deepEqual(clicks, []);
  assert.equal(h.data[key].jobs[job.jobId].state, "uncertain");
  assert.ok(next.calls.messages.some(message => message.type === "APPLE_CAREERS_REVOKE_WORKFLOW"));
});

test("a page-side answer waiting on its owner cannot write after restart", async () => {
  const h = await session();
  await step(h);
  const content = createContentHarness();
  const question = radioQuestion("Are you authorized to work?");
  installQuestions(content, [question]);
  const options = { ...action(h), assertIdentity() {} };
  content.chrome.runtime.sendMessage = message => h.sandbox.dispatch(message, { tab: h.tabs[0] });
  options.assertOwnership = kind => content.assertAppleWorkflowOwnership(options, kind);
  await restart(h, content);
  await assert.rejects(content.answerSavedWorkQuestion(question.container, [], { workAuthorized: "yes" }, options), /stopped|restarted/);
  assert.equal(question.radios.reduce((sum, radio) => sum + radio.clicks, 0), 0);
});

test("an unreachable surviving application tab blocks reconciliation until it is closed", async () => {
  const h = await session();
  await step(h);
  const next = await restart(h);
  next.sandbox.chrome.tabs.sendMessage = async () => { throw new Error("No receiver"); };
  await assert.rejects(next.sandbox.quiesceRecoveredAppleWorkflow(), /Close that tab/);
  assert.equal(h.data[key].reconciliationRequired, true);
  h.tabs.splice(0);
  await next.sandbox.quiesceRecoveredAppleWorkflow();
});

test("completed sessions survive restart without being relabeled as interrupted", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.checkpointAppleWorkflowResult(h.id, job.jobId, h.stepId, result(h, { done: true, submissionOutcome: "confirmed" }));
  await h.sandbox.finishAppleApplicationSession(h.id);
  const next = await restart(h);
  assert.equal(h.data[key].status, "completed");
  assert.equal(h.data[key].reconciliationRequired, false);
  assert.equal(h.data.appleJobRanking.running, false);
  assert.equal(h.data.appleCareersKnownSiteActivity.running, false);
  assert.equal(h.data.appleJobRanking.lastBatchSummary.submitted, 1);
  assert.equal(h.data.appleCareersScanStatus.currentJob, null);
  assert.equal(h.data.appleJobRanking.error, null);
  assert.equal(next.calls.messages.length, 0);
});

test("stale IPC commands lack authority even if they reach a restarted content script", async () => {
  const content = createContentHarness();
  assert.equal((await content.dispatch({ type: "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW_STEP", expectedJobId: job.jobId })).ok, false);
  let calls = 0;
  content.runBoundApplicationWorkflowStep = async () => { calls++; return { clicked: false, done: false, steps: [] }; };
  const command = { type: "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW_STEP", expectedJobId: job.jobId, workflowSessionId: "session", workflowStepId: "step" };
  await content.dispatch(command);
  assert.equal((await content.dispatch(command)).ok, false);
  assert.equal(calls, 1);
});

test("restart after an actual synthetic Submit click does not replay it, even on a new document", async () => {
  const h = await session();
  await step(h);
  const content = createContentHarness();
  let releaseOutcome, signalClick;
  const outcome = new Promise(resolve => { releaseOutcome = resolve; });
  const clicked = new Promise(resolve => { signalClick = resolve; });
  let count = 0;
  const button = { innerText: "Submit", scrollIntoView() {}, click() { count++; signalClick(); } };
  content.getVisibleValidationErrors = () => [];
  content.waitForSubmissionOutcome = () => outcome;
  const options = { ...action(h), assertIdentity() {} };
  options.assertOwnership = kind => content.assertAppleWorkflowOwnership(options, kind);
  content.chrome.runtime.sendMessage = message => h.sandbox.dispatch(message, { tab: h.tabs[0] });
  const pending = content.clickAndDetectSubmission(button, [], options);
  await clicked;
  const next = await restart(h, content);
  releaseOutcome(null);
  const unconfirmed = await pending;
  assert.equal(unconfirmed.submissionOutcome, "unknown");
  assert.equal(count, 1);
  const newDocument = createContentHarness();
  newDocument.getVisibleValidationErrors = () => [];
  newDocument.chrome.runtime.sendMessage = message => next.sandbox.dispatch(message, { tab: h.tabs[0] });
  const staleOptions = { ...action(h), assertIdentity() {} };
  staleOptions.assertOwnership = kind => newDocument.assertAppleWorkflowOwnership(staleOptions, kind);
  await assert.rejects(newDocument.clickAndDetectSubmission(button, [], staleOptions), /stopped|replaced/);
  assert.equal(count, 1);
  assert.equal(h.data[key].jobs[job.jobId].submissionAttemptCount, 1);
});

test("full inventory sync reconciles recovery and capacity; failures retain the recovery gate", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  const next = await restart(h);
  next.sandbox.createTaskTab = async () => ({ id: 2, url: "https://jobs.apple.com/app/en-us/profile/roles" });
  next.sandbox.waitForTabComplete = async () => {};
  next.sandbox.sendMessageWithFallback = async () => ({ ok: false, error: "Session expired" });
  await assert.rejects(next.sandbox.refreshAppleQueueCapacity(await next.sandbox.readAppleRankingState(), 1), /Session expired/);
  assert.equal(h.data[key].reconciliationRequired, true);
  assert.equal(h.data.appleJobRanking.reservations.length, 1);
  next.sandbox.sendMessageWithFallback = async () => ({ ok: true, data: { pageCount: 1, pages: [{
    pageIndex: 1, pageCount: 1, hasNextPage: false, accountVerified: true, withdrawalConfirmationOpen: false,
    inventoryState: "confirmed", roles: [{ ...job, active: true }]
  }] } });
  const state = await next.sandbox.readAppleRankingState();
  await next.sandbox.refreshAppleQueueCapacity(state, 1);
  assert.equal(h.data[key].reconciliationRequired, false);
  assert.equal(h.data[key].status, "paused", "inventory sync must never resume the runner");
  assert.equal(h.data.appleJobRanking.reservations.length, 0);
  assert.equal((await next.sandbox.appleRankingCapacity(state)).remaining, 49);
  await assert.rejects(next.sandbox.claimAppleApplicationSession([job]), /confirmed submission/);
  assert.equal(h.data.appleJobRanking.jobs[baseId].queueStatus, "submitted");
});

test("confirmed form rejection stays failed rather than unknown across recovery", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  await h.sandbox.checkpointAppleWorkflowResult(h.id, job.jobId, h.stepId, result(h, { pausedForReview: true,
    submissionOutcome: "rejected", steps: [{ step: "Submit application", status: "clicked" }], summary: "Required field rejected" }));
  await restart(h);
  assert.equal(h.data[key].jobs[job.jobId].state, "failed");
  assert.equal(h.data[key].jobs[job.jobId].submissionOutcome, "rejected");
  assert.equal(h.data.appleJobRanking.applicationFailures[baseId].submissionOutcomeUnknown, false);
  assert.equal(h.data.appleCareersAppliedJobs, undefined);
});

test("a stop racing a pending ownership claim remains durable and grants no permission", async () => {
  const h = createBackgroundHarness();
  await h.ready;
  let resumeClaim;
  const original = h.sandbox.CareerPeelerJobStore.updateMetadata;
  h.sandbox.CareerPeelerJobStore.updateMetadata = async (collection, update) => {
    if (!resumeClaim && collection === key) await new Promise(resolve => { resumeClaim = resolve; });
    return original(collection, update);
  };
  const claim = h.sandbox.claimAppleApplicationSession([job]);
  const stop = h.sandbox.stopAppleJobRanking();
  resumeClaim();
  await Promise.all([claim, stop]);
  assert.equal(h.data[key].status, "cancelled");
  assert.equal(h.data[key].stopRequested, true);
  assert.equal(h.data[key].jobs[job.jobId].state, "not_started");
  await assert.rejects(h.sandbox.checkpointAppleWorkflowStep(h.data[key].id, job, 1), /stopped/);
});

test("absence allows other reviewed roles to proceed, but never resets an unresolved Submit for the same role", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  const next = await restart(h);
  await next.sandbox.reconcileAppleApplicationSession(inventory());
  await assert.rejects(next.sandbox.claimAppleApplicationSession([job]), /unknown.*absence.*replay/i);
  const newId = await next.sandbox.claimAppleApplicationSession([otherJob]);
  assert.notEqual(newId, h.id);
  assert.equal(h.data[key].jobs[job.jobId].state, "uncertain");
  assert.equal(h.data[key].jobs[job.jobId].workflowSessionId, h.id);
  await next.sandbox.finishAppleApplicationSession(newId);
  const third = await restart(next);
  await assert.rejects(third.sandbox.claimAppleApplicationSession([job]), /unknown/);
});

test("a mismatched tab after successful reconciliation stops before claiming a new application", async () => {
  const h = await session();
  await step(h);
  const next = await restart(h);
  await next.sandbox.reconcileAppleApplicationSession(inventory());
  h.tabs[0].url = h.tabs[0].url.replace(job.jobId, otherJob.jobId);
  const response = await next.sandbox.runApplicationWorkflow(h.tabs[0], { jobContext: job, closeOnDone: false });
  assert.equal(response.ok, false);
  assert.equal(response.data.errorType, "job_identity_mismatch");
  assert.equal(h.data[key].currentJobId, job.jobId);
  assert.ok(next.calls.messages.every(message => message.type === "APPLE_CAREERS_REVOKE_WORKFLOW"));
});

test("inventory absence retains an uncertain slot until a later inventory positively confirms that role", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  const next = await restart(h);
  next.sandbox.createTaskTab = async () => ({ id: 2 });
  next.sandbox.waitForTabComplete = async () => {};
  let roles = [];
  next.sandbox.sendMessageWithFallback = async () => ({ ok: true, data: { pageCount: 1, pages: [{
    pageIndex: 1, pageCount: 1, hasNextPage: false, accountVerified: true, withdrawalConfirmationOpen: false,
    inventoryState: roles.length ? "confirmed" : "confirmed_empty", roles
  }] } });
  let state = await next.sandbox.readAppleRankingState();
  await next.sandbox.refreshAppleQueueCapacity(state, 1);
  assert.equal(h.data[key].jobs[job.jobId].state, "uncertain");
  assert.equal(h.data[key].jobs[job.jobId].reconciliation, "absent");
  assert.equal(state.reservations.length, 1);
  assert.equal((await next.sandbox.appleRankingCapacity(state)).remaining, 49);
  roles = [{ ...job, active: true }];
  state = await next.sandbox.readAppleRankingState();
  await next.sandbox.refreshAppleQueueCapacity(state, 1);
  assert.equal(h.data[key].jobs[job.jobId].state, "submitted");
  assert.equal(state.reservations.length, 0);
  assert.equal((await next.sandbox.appleRankingCapacity(state)).remaining, 49);
  await assert.rejects(next.sandbox.claimAppleApplicationSession([job]), /confirmed submission/);
});

test("a reused Continue button changing to Submit cannot bypass durable Submit permission", async () => {
  const h = await session();
  await step(h);
  const content = createContentHarness();
  let clicks = 0;
  const button = { innerText: "Continue", scrollIntoView() {}, click() {
    assert.equal(h.data[key].jobs[job.jobId].submissionOutcome, "unknown");
    assert.equal(h.data[key].jobs[job.jobId].submissionAttemptCount, 1);
    clicks++;
  } };
  content.delay = async () => { button.innerText = "Submit"; };
  content.findPrimaryActionButton = () => button;
  content.getAlreadyAppliedSignal = () => null;
  content.getVisibleValidationErrors = () => [];
  content.waitForSubmissionOutcome = async () => ({ type: "submitted", signal: { text: "Application submitted" } });
  content.chrome.runtime.sendMessage = message => h.sandbox.dispatch(message, { tab: h.tabs[0] });
  const options = { ...action(h), assertIdentity() {} };
  options.assertOwnership = kind => content.assertAppleWorkflowOwnership(options, kind);
  const response = await content.clickPrimaryAction({ finalSubmitPattern: /^submit$/i }, [], options);
  assert.equal(response.submissionOutcome, "confirmed");
  assert.equal(clicks, 1);
});

test("ownership and reconciliation errors pause the whole queue even when no Submit was attempted", async () => {
  const h = createBackgroundHarness();
  await h.ready;
  for (const errorType of ["workflow_recovery_required", "workflow_owner_conflict", "workflow_owner_revoked"]) {
    const disposition = h.sandbox.appleQueueFailureDisposition({ ok: false, error: "Ownership stopped",
      data: { errorType, submissionAttempted: false, submissionOutcomeUnknown: false } });
    assert.equal(disposition.unknown, false);
    assert.equal(disposition.pauseQueue, true);
  }
});

test("confirmed rejection is durable before same-step field recovery and survives ordinary steps without an outcome field", async () => {
  const h = await session();
  await step(h);
  const content = createContentHarness();
  const question = radioQuestion("Are you authorized to work?");
  installQuestions(content, [question]);
  content.getVisibleValidationErrors = () => [];
  content.waitForSubmissionOutcome = async () => ({ type: "validation", errors: ["Required field missing"] });
  content.chrome.runtime.sendMessage = message => h.sandbox.dispatch(message, { tab: h.tabs[0] });
  const options = { ...action(h), assertIdentity() {} };
  options.assertOwnership = kind => content.assertAppleWorkflowOwnership(options, kind);
  const button = { innerText: "Submit", scrollIntoView() {}, click() {} };
  const rejected = await content.clickAndDetectSubmission(button, [], options);
  assert.equal(rejected.submissionOutcome, "rejected");
  assert.equal(h.data[key].jobs[job.jobId].submissionOutcome, "rejected");
  const filled = await content.answerSavedWorkQuestion(question.container, [], { workAuthorized: "yes" }, options);
  assert.equal(filled.answered, true);
  await h.sandbox.checkpointAppleWorkflowResult(h.id, job.jobId, h.stepId, result(h, { submissionOutcome: "rejected" }));
  await step(h);
  const ordinary = result(h);
  delete ordinary.submissionOutcome;
  await h.sandbox.checkpointAppleWorkflowResult(h.id, job.jobId, h.stepId, ordinary);
  assert.equal(h.data[key].jobs[job.jobId].submissionOutcome, "rejected");
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  assert.equal(h.data[key].jobs[job.jobId].submissionAttemptCount, 2);
});

test("a confirmed Submit observation survives restart before the outer workflow reply", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  await h.sandbox.dispatch({ ...action(h), type: "APPLE_CAREERS_RECORD_WORKFLOW_SUBMIT_OUTCOME",
    submissionOutcome: "confirmed", identityVerified: true }, { tab: h.tabs[0] });
  assert.equal(h.data[key].jobs[job.jobId].stepPending, true);
  await restart(h);
  assert.equal(h.data[key].jobs[job.jobId].state, "submitted");
  assert.equal(h.data[key].jobs[job.jobId].submissionAttemptCount, 1);
  assert.equal(h.data.appleCareersAppliedJobs[`apple:${job.jobId}`].status, "applied");
  assert.equal(h.data.appleJobRanking.lastBatchSummary.submitted, 1);
});

test("Submit observations require the matching pending intent, full identity, and an explicit known result", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  const observation = { ...action(h), type: "APPLE_CAREERS_RECORD_WORKFLOW_SUBMIT_OUTCOME",
    submissionOutcome: "confirmed", identityVerified: true };
  for (const altered of [{ workflowStepId: "stale" }, { expectedJobId: otherJob.jobId },
    { submissionOutcome: "unknown" }, { identityVerified: false }]) {
    const reply = await h.sandbox.dispatch({ ...observation, ...altered }, { tab: h.tabs[0] });
    assert.equal(reply.ok, false);
  }
  const mismatchedTab = { ...h.tabs[0], url: h.tabs[0].url.replace(job.jobId, otherJob.jobId) };
  assert.equal((await h.sandbox.dispatch(observation, { tab: mismatchedTab })).ok, false);
  assert.equal(h.data[key].jobs[job.jobId].submissionOutcome, "unknown");
});

test("a conflicting saved suffix cannot replace the recovered identity, review link, or reserved slot", async () => {
  const h = await session();
  await step(h);
  await h.sandbox.authorizeAppleWorkflowAction(action(h, "submit"), { tab: h.tabs[0] });
  const conflicting = { ...job, jobId: "200123456-9999", url: job.url.replace("0836", "9999"), queueStatus: "queued" };
  h.data.appleJobRanking.jobs[baseId] = conflicting;
  const next = await restart(h);
  const view = await next.sandbox.getAppleRankingView();
  assert.equal(view.currentJob.jobId, job.jobId);
  assert.equal(view.errorJob.jobId, job.jobId);
  assert.equal(view.errorJob.url, job.url);
  assert.equal(h.data.appleJobRanking.jobs[baseId].jobId, conflicting.jobId);
  assert.equal(h.data.appleJobRanking.jobs[baseId].queueStatus, "queued");
  assert.equal(h.data.appleJobRanking.reservations[0].jobId, job.jobId);
});
