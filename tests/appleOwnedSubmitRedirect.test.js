const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBackgroundHarness } = require('./helpers/appleWorkflowHarness.cjs');

const jobId = '200685673-0836';
const baseId = '200685673';
const job = { jobId, title: 'Systems Software Engineer, Platform Architecture',
  url: `https://jobs.apple.com/en-us/details/${jobId}/systems-software-engineer` };
const journalKey = 'appleApplicationWorkflow';

function controls() {
  const control = location => ({ id: `jobdetails-jobdetails-jobdetail${location}-actions-jobdetailssubmitresume`,
    tagName: 'A', role: 'link', ariaDisabled: 'true', tabIndex: '-1', href: null,
    text: 'Submitted', ariaLabel: `Submitted: ${job.title} ${jobId}`, disabledClass: true,
    visible: true, connected: true });
  return { url: job.url, authenticated: true, title: job.title, roleNumber: jobId,
    controls: [control('header'), control('footer')] };
}

function capacitySnapshot(scannedAt, ids = []) {
  return { complete: true, accountVerified: true, scannedAt, updatedAt: scannedAt,
    inventoryState: ids.length ? 'confirmed' : 'confirmed_empty',
    roles: ids.map(id => ({ ...job, jobId: id, url: job.url.replace(jobId, id), active: true })) };
}

async function fixture(options = {}) {
  let h;
  const observed = { proofReads: 0, inventoryReads: 0 };
  const tabs = [{ id: 1, windowId: 1, status: 'complete',
    url: `https://jobs.apple.com/app/en-us/apply/${jobId}` },
  { id: 2, windowId: 1, status: 'complete', url: 'https://jobs.apple.com/app/en-us/profile/roles' }];
  h = createBackgroundHarness(tabs, { sendMessage: async (tabId, message) => {
    if (message.type === 'APPLE_CAREERS_REVOKE_WORKFLOW') return { ok: true, workflowSessionId: message.workflowSessionId };
    if (/SUBMITTED_HISTORY/.test(message.type)) {
      observed.inventoryReads++;
      assert.fail('An owned Submit must not rescan the Active submissions inventory');
    }
    if (message.type === 'APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS') {
      observed.proofReads++;
      const proof = { requestId: message.requestId, jobId, url: job.url, identityVerified: true,
        submissionOutcome: 'confirmed', proof: 'apple_submitted_controls',
        documentStartedAt: message.notBefore, observedAt: Date.now(),
        signal: { jobId, title: job.title, source: 'apple_submitted_controls', text: `Submitted: ${job.title} ${jobId}` },
        controlEvidence: controls() };
      await options.onProof?.(h, proof, message, tabId);
      return options.proofResponse || { ok: true, data: { ...proof, ...(options.proof || {}) } };
    }
    assert.fail(`Post-Submit verification must be read-only: ${message.type}`);
  } });
  await h.ready;
  h.sandbox.delay = async () => {};
  h.sandbox.callOpenAi = async () => assert.fail('Outcome verification never uses OpenAI');
  const sessionId = await h.sandbox.claimAppleApplicationSession([job], { sourceTabId: 1, sourceWindowId: 1 });
  const stepId = await h.sandbox.checkpointAppleWorkflowStep(sessionId, job, 1);
  await h.sandbox.authorizeAppleWorkflowAction({ workflowSessionId: sessionId, workflowStepId: stepId,
    expectedJobId: jobId, action: 'submit' }, { tab: tabs[0] });
  tabs[0].url = 'https://jobs.apple.com/app/en-us/profile/info';
  h.data.appleWithdrawalWorkflow = { version: 1, records: {} };
  h.data.appleJobRanking = { version: 1, jobs: { [baseId]: { ...job, queueStatus: 'applying' } },
    searches: {}, applicationFailures: {}, reservations: [{ jobId, startedAt: Date.now() }],
    capacitySnapshot: capacitySnapshot(h.data[journalKey].startedAt, options.cachedIds) };
  const readMetadata = h.sandbox.CareerPeelerJobStore.getMetadata;
  h.sandbox.CareerPeelerJobStore.getMetadata = async key => {
    if (key === 'appleWithdrawalWorkflow') await options.beforeCommit?.(h);
    return readMetadata(key);
  };
  const input = { workflowSessionId: sessionId, workflowStepId: stepId, job, tabId: 1, windowId: 1 };
  h.verify = async patch => {
    assert.equal(typeof h.sandbox.verifyAppleOwnedSubmitAfterRedirect, 'function');
    try { return await h.sandbox.verifyAppleOwnedSubmitAfterRedirect({ ...input, ...patch }); }
    catch (error) { return { confirmed: false, error: error.message, errorType: error.code }; }
  };
  return Object.assign(h, { observed, input });
}

function pending(h) { return h.data[journalKey].jobs[jobId]; }
function assertUnknown(h) {
  assert.equal(pending(h).submissionOutcome, 'unknown');
  assert.equal(pending(h).state, 'uncertain');
  assert.equal(pending(h).submissionAttemptCount, 1);
  assert.ok(h.data.appleJobRanking.reservations.some(item => item.jobId === jobId));
}
function assertReadOnly(h) {
  const allowed = new Set(['APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS', 'APPLE_CAREERS_REVOKE_WORKFLOW']);
  assert.ok(h.calls.messages.every(message => allowed.has(message.type)));
  assert.equal(h.observed.inventoryReads, 0, 'normal owned confirmation never reads inventory pages');
  assert.equal(h.calls.checkpoints.length, 0, 'verification cannot fabricate a newly submitted application checkpoint');
  assert.ok(h.calls.created.every(tab => tab.active === false && tab.url === job.url),
    'verification may open only an inactive exact-job detail tab');
  assert.ok(h.calls.removed.every(id => id !== 1 && id !== 2), 'user/form tabs are preserved');
}

for (const cachedIds of [[], ['200000555']]) test(`owned Submit confirms exact fresh controls without resyncing pre-Submit inventory (${cachedIds.join(',') || 'empty'})`, async () => {
  const h = await fixture({ cachedIds });
  const result = await h.verify();
  assert.equal(result.confirmed, true, result.error);
  assert.equal(pending(h).state, 'submitted');
  assert.equal(pending(h).submissionOutcome, 'confirmed');
  assert.equal(pending(h).submissionAttemptCount, 1);
  assert.equal(h.data[journalKey].id, h.input.workflowSessionId);
  assert.equal(h.data[journalKey].status, 'running', 'confirming the current operation cannot claim or restart a batch');
  assert.equal(h.observed.proofReads, 1);
  assert.equal(h.observed.inventoryReads, 0);
  assert.equal(h.data.appleJobRanking.reservations.length, 1, 'confirmation preserves the capacity reservation');
  assertReadOnly(h);
});

for (const [name, proof] of [
  ['different full ID', { jobId: jobId.replace('0836', '0157') }],
  ['wrong page URL', { url: job.url.replace('0836', '0157') }],
  ['stale request', { requestId: 'previous-request' }],
  ['stale document', { documentStartedAt: 1 }],
  ['stale observation', { observedAt: 1 }],
  ['unverified identity', { identityVerified: false }],
  ['generic label', { proof: 'generic_submitted_label', controlEvidence: undefined }],
  ['unknown state', { submissionOutcome: 'unknown' }],
  ['contradictory controls', { controlEvidence: { ...controls(), roleNumber: jobId.replace('0836', '0157') } }],
  ['unauthenticated controls', { controlEvidence: { ...controls(), authenticated: false } }],
]) test(`owned Submit outcome stays unknown with ${name} proof`, async () => {
  const h = await fixture({ proof });
  const result = await h.verify();
  assert.equal(result.confirmed, false);
  assertUnknown(h);
  assertReadOnly(h);
});

for (const [name, mutate] of [
  ['missing snapshot', h => { delete h.data.appleJobRanking.capacitySnapshot; }],
  ['incomplete count', h => { h.data.appleJobRanking.capacitySnapshot.complete = false; }],
  ['unauthenticated count', h => { h.data.appleJobRanking.capacitySnapshot.accountVerified = false; }],
  ['unknown inventory', h => { h.data.appleJobRanking.capacitySnapshot.inventoryState = 'unknown'; }],
  ['malformed roles', h => { Object.assign(h.data.appleJobRanking.capacitySnapshot, { inventoryState: 'confirmed', roles: [{}] }); }],
  ['numeric role ID', h => { Object.assign(h.data.appleJobRanking.capacitySnapshot,
    { inventoryState: 'confirmed', roles: [{ active: true, jobId: 200000555 }] }); }],
  ['duplicate role IDs', h => { Object.assign(h.data.appleJobRanking.capacitySnapshot,
    { inventoryState: 'confirmed', roles: [{ active: true, jobId: '200000555' }, { active: true, jobId: '200000555' }] }); }],
  ['count preceding this session', h => { h.data.appleJobRanking.capacitySnapshot.scannedAt = h.data[journalKey].startedAt - 1; }],
  ['count after Submit intent', h => { h.data.appleJobRanking.capacitySnapshot.scannedAt = pending(h).submitIntentAt + 1; }],
]) test(`owned Submit outcome stays unknown without valid initial batch capacity: ${name}`, async () => {
  const h = await fixture();
  mutate(h);
  const result = await h.verify();
  assert.equal(result.confirmed, false);
  assert.equal(h.observed.proofReads, 0);
  assertUnknown(h);
  assertReadOnly(h);
});

for (const phase of ['onProof', 'beforeCommit']) test(`cancellation during ${phase} cannot confirm or replay the pending Submit`, async () => {
  const h = await fixture({ [phase]: async current => {
    await current.sandbox.cancelAppleApplicationSession();
  } });
  const result = await h.verify();
  assert.equal(result.confirmed, false);
  assert.equal(h.data[journalKey].status, 'cancelled');
  assert.equal(h.data[journalKey].stopRequested, true);
  assertUnknown(h);
  assertReadOnly(h);
});

for (const phase of ['onProof', 'beforeCommit']) test(`worker ownership change during ${phase} cannot confirm another operation`, async () => {
  const h = await fixture({ [phase]: async current => {
    current.data[journalKey].owner = 'replacement-worker';
  } });
  const result = await h.verify();
  assert.equal(result.confirmed, false);
  assert.equal(h.data[journalKey].owner, 'replacement-worker');
  assertUnknown(h);
  assertReadOnly(h);
});

for (const [name, mutate] of [
  ['Submit intent', entry => { entry.submitIntentAt += 1; }],
  ['attempt count', entry => { entry.submissionAttemptCount += 1; }],
  ['workflow step', entry => { entry.stepId = 'replacement-step'; }],
  ['pending action', entry => { entry.stepPending = false; }],
]) test(`changed ${name} cannot inherit post-Submit proof`, async () => {
  const h = await fixture({ onProof: current => mutate(pending(current)) });
  const result = await h.verify();
  assert.equal(result.confirmed, false);
  assert.equal(pending(h).submissionOutcome, 'unknown');
  assert.equal(pending(h).state, 'uncertain');
  assertReadOnly(h);
});

test('a failed exact job read cannot be replaced by a cached active role', async () => {
  const h = await fixture({ proofResponse: { ok: false, error: 'Fresh exact job read unavailable' }, cachedIds: [jobId] });
  const result = await h.verify();
  assert.equal(result.confirmed, false);
  assert.equal(h.observed.proofReads, 1);
  assertUnknown(h);
  assertReadOnly(h);
});

for (const outcome of ['unknown', 'inactive']) test(`a concurrent ${outcome} withdrawal prevents post-Submit confirmation`, async () => {
  const h = await fixture({ beforeCommit: current => {
    current.data.appleWithdrawalWorkflow.records[jobId] = { jobId, outcome, updatedAt: Date.now() };
  } });
  const result = await h.verify();
  assert.equal(result.confirmed, false);
  assert.equal(h.data.appleWithdrawalWorkflow.records[jobId].outcome, outcome);
  assertUnknown(h);
  assertReadOnly(h);
});

test('a newly persisted withdrawn ID blocks confirmation even when the passed ranking snapshot is older', async () => {
  const h = await fixture({ beforeCommit: current => { current.data.appleJobRanking.withdrawnIds = [baseId]; } });
  const snapshot = structuredClone(h.data.appleJobRanking);
  const result = await h.verify({ rankingState: snapshot });
  assert.equal(result.confirmed, false);
  assertUnknown(h);
  assertReadOnly(h);
});

for (const phase of ['onProof', 'beforeCommit']) {
  for (const changed of ['job', 'window']) test(`source ${changed} changing during ${phase} preserves unknown`, async () => {
    const h = await fixture({ [phase]: current => {
      if (changed === 'job') current.tabs[0].url = 'https://jobs.apple.com/app/en-us/apply/200999999-0157';
      else current.tabs[0].windowId = 2;
    } });
    const result = await h.verify();
    assert.equal(result.confirmed, false);
    assertUnknown(h);
    assertReadOnly(h);
  });
}

async function workflowIntegration(options = {}) {
  let h;
  const tab = { id: 1, windowId: 1, status: 'complete', url: `https://jobs.apple.com/app/en-us/apply/${jobId}` };
  const calls = { commands: 0, proofs: 0 };
  h = createBackgroundHarness([tab], { sendMessage: async (_tabId, message) => {
    if (message.type === 'APPLE_CAREERS_VERIFY_WORKFLOW_IDENTITY') return { ok: true, data: {
      expectedJobId: jobId, identityVerified: true, url: tab.url } };
    assert.equal(message.type, 'APPLE_CAREERS_RUN_APPLICATION_WORKFLOW_STEP');
    calls.commands++;
    await h.sandbox.authorizeAppleWorkflowAction({ workflowSessionId: message.workflowSessionId,
      workflowStepId: message.workflowStepId, expectedJobId: jobId, action: 'submit' }, { tab });
    tab.url = options.liveUrl || 'https://jobs.apple.com/app/en-us/profile/info';
    return { ok: true, data: { url: 'https://jobs.apple.com/app/en-us/profile/info', title: job.title,
      expectedJobId: jobId, identityVerified: false, clicked: false, done: false, pausedForReview: true,
      submissionOutcome: 'unknown', errorType: 'job_identity_unverified', summary: 'The confirmation route has no job ID.',
      steps: [{ step: 'Submit application', status: 'clicked', label: 'Submit' }], ...options.response } };
  } });
  await h.ready;
  h.sandbox.delay = async () => {};
  h.sandbox.verifyAppleOwnedSubmitAfterRedirect = async input => {
    calls.proofs++;
    assert.equal(input.job.jobId, jobId);
    assert.equal(input.tabId, 1);
    assert.equal(input.workflowSessionId, h.data[journalKey].id);
    assert.equal(input.workflowStepId, pending(h).stepId);
    assert.equal(pending(h).submissionOutcome, 'unknown');
    assert.equal(pending(h).submissionAttemptCount, 1);
    return options.confirmed === false ? { confirmed: false } : { confirmed: true, proof: { url: job.url } };
  };
  const activitySteps = [];
  const result = await h.sandbox.runApplicationWorkflow(tab, { jobContext: { ...job, site: 'apple' },
    windowId: 1, closeOnDone: false, userProfile: {}, activitySteps });
  return { h, result, calls, activitySteps };
}

test('workflow confirms an owned generic redirect only after exact read-only verification and records the real Submit', async () => {
  const { h, result, calls } = await workflowIntegration();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.submitted, true);
  assert.equal(result.data.submissionOutcome, 'confirmed');
  assert.equal(calls.commands, 1);
  assert.equal(calls.proofs, 1);
  assert.equal(result.data.steps.filter(step => step.step === 'Submit application' && step.status === 'clicked').length, 1);
  assert.equal(result.data.steps.filter(step => step.step === 'Confirm application submitted' && step.status === 'detected').length, 1);
  assert.equal(pending(h).submissionOutcome, 'confirmed');
  assert.equal(pending(h).submissionAttemptCount, 1);
});

test('failed post-redirect proof preserves Submit activity and unknown without a second workflow command', async () => {
  const { h, result, calls } = await workflowIntegration({ confirmed: false });
  assert.equal(result.ok, false);
  assert.equal(result.data.submissionOutcomeUnknown, true);
  assert.equal(calls.commands, 1);
  assert.equal(calls.proofs, 1);
  assert.equal(result.data.steps.filter(step => step.step === 'Submit application' && step.status === 'clicked').length, 1);
  assert.equal(result.data.steps.some(step => step.step === 'Confirm application submitted' && step.status === 'detected'), false);
  assert.equal(pending(h).submissionOutcome, 'unknown');
  assert.equal(pending(h).submissionAttemptCount, 1);
});

for (const [name, options] of [
  ['different expected job', { response: { expectedJobId: jobId.replace('0836', '0157') } }],
  ['no tracked Submit', { response: { steps: [] } }],
  ['explicit job mismatch', { response: { errorType: 'job_identity_mismatch' } }],
  ['different response route', { response: { url: 'https://jobs.apple.com/en-us/details/200999999-0157/other' } }],
  ['different live route', { liveUrl: 'https://jobs.apple.com/en-us/details/200999999-0157/other' }],
]) test(`generic redirect verification is not invoked for ${name}`, async () => {
  const { h, result, calls } = await workflowIntegration(options);
  assert.equal(result.ok, false);
  assert.equal(calls.commands, 1);
  assert.equal(calls.proofs, 0);
  assert.equal(pending(h).submissionOutcome, 'unknown');
  assert.equal(pending(h).submissionAttemptCount, 1);
});

test('repeated post-Submit verification cannot issue a new Submit or reset the existing attempt count', async () => {
  const h = await fixture();
  assert.equal((await h.verify()).confirmed, true);
  await h.verify();
  assert.equal(pending(h).submissionOutcome, 'confirmed');
  assert.equal(pending(h).state, 'submitted');
  assert.equal(pending(h).submissionAttemptCount, 1);
  await assert.rejects(h.sandbox.authorizeAppleWorkflowAction({ workflowSessionId: h.input.workflowSessionId,
    workflowStepId: h.input.workflowStepId, expectedJobId: jobId, action: 'submit' }, { tab: h.tabs[0] }), /reviewed|unresolved|identity|permission/i);
  assertReadOnly(h);
});

for (const patch of [
  { workflowSessionId: 'other-session' }, { workflowStepId: 'other-step' },
  { job: { ...job, jobId: jobId.replace('0836', '0157') } }, { tabId: 99 }, { windowId: 2 },
]) test(`unbound post-Submit proof request cannot read or confirm (${JSON.stringify(patch)})`, async () => {
  const h = await fixture();
  const result = await h.verify(patch);
  assert.equal(result.confirmed, false);
  assertUnknown(h);
  assert.equal(h.observed.proofReads, 0);
  assert.equal(h.observed.inventoryReads, 0);
  assertReadOnly(h);
});

test('two reviewed roles complete owned redirect verification within one unchanged application session', async () => {
  const other = { jobId: '200000124-0157', title: 'Other Reviewed Software Engineer',
    url: 'https://jobs.apple.com/en-us/details/200000124-0157/other-engineer' };
  const roles = [job, other];
  const roleById = Object.fromEntries(roles.map(role => [role.jobId, role]));
  const submitted = [];
  const commands = [];
  const proofIds = [];
  const tabs = roles.map((role, index) => ({ id: index + 1, windowId: 1, status: 'complete',
    url: `https://jobs.apple.com/app/en-us/apply/${role.jobId}` }));
  tabs.push({ id: 3, windowId: 1, status: 'complete', url: 'https://jobs.apple.com/app/en-us/profile/roles' });
  let h;
  h = createBackgroundHarness(tabs, { sendMessage: async (tabId, message) => {
    const tab = h.tabs.find(item => item.id === tabId);
    if (message.type === 'APPLE_CAREERS_VERIFY_WORKFLOW_IDENTITY') return { ok: true, data: {
      expectedJobId: message.expectedJobId, identityVerified: true, url: tab.url } };
    if (message.type === 'APPLE_CAREERS_RUN_APPLICATION_WORKFLOW_STEP') {
      commands.push(message.expectedJobId);
      await h.sandbox.authorizeAppleWorkflowAction({ workflowSessionId: message.workflowSessionId,
        workflowStepId: message.workflowStepId, expectedJobId: message.expectedJobId, action: 'submit' }, { tab });
      submitted.push(message.expectedJobId);
      tab.url = 'https://jobs.apple.com/app/en-us/profile/info';
      return { ok: true, data: { url: tab.url, expectedJobId: message.expectedJobId, identityVerified: false,
        clicked: false, done: false, pausedForReview: true, submissionOutcome: 'unknown',
        errorType: 'job_identity_unverified', summary: 'Apple returned a generic profile route.',
        steps: [{ step: 'Submit application', status: 'clicked', label: 'Submit' }] } };
    }
    if (message.type === 'APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS') {
      const role = roleById[message.expectedJobId];
      proofIds.push(role.jobId);
      const evidence = controls();
      evidence.url = role.url;
      evidence.title = role.title;
      evidence.roleNumber = role.jobId;
      evidence.controls = evidence.controls.map(control => ({ ...control,
        ariaLabel: `Submitted: ${role.title} ${role.jobId}` }));
      return { ok: true, data: { requestId: message.requestId, jobId: role.jobId, url: role.url,
        identityVerified: true, submissionOutcome: 'confirmed', proof: 'apple_submitted_controls',
        documentStartedAt: message.notBefore, observedAt: Date.now(), controlEvidence: evidence,
        signal: { jobId: role.jobId, title: role.title, source: 'apple_submitted_controls',
          text: `Submitted: ${role.title} ${role.jobId}` } } };
    }
    assert.fail(`Unexpected shared-session browser action: ${message.type}`);
  } });
  await h.ready;
  h.sandbox.delay = async () => {};
  const sessionId = await h.sandbox.claimAppleApplicationSession(roles, { sourceTabId: 1, sourceWindowId: 1 });
  h.data.appleWithdrawalWorkflow = { version: 1, records: {} };
  h.data.appleJobRanking = { version: 1, jobs: Object.fromEntries(roles.map(role => [role.jobId.split('-')[0],
    { ...role, queueStatus: 'applying' }])), searches: {}, applicationFailures: {},
    reservations: roles.map(role => ({ jobId: role.jobId, startedAt: Date.now() })),
    capacitySnapshot: capacitySnapshot(h.data[journalKey].startedAt) };
  for (const [index, role] of roles.entries()) {
    const result = await h.sandbox.runApplicationWorkflow(tabs[index], { workflowSessionId: sessionId,
      jobContext: { ...role, site: 'apple' }, windowId: 1, closeOnDone: false, userProfile: {}, activitySteps: [] });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.data.submitted, true);
    assert.equal(result.data.submissionOutcome, 'confirmed');
    assert.equal(result.data.steps.filter(step => step.step === 'Submit application' && step.status === 'clicked').length, 1);
    const journal = h.data[journalKey];
    assert.equal(journal.id, sessionId, 'proof must preserve the original reviewed batch ownership');
    assert.equal(journal.status, 'running', 'the first confirmation must leave the shared session usable');
    assert.equal(journal.reconciliationRequired, false);
    const current = journal.jobs[role.jobId];
    assert.equal(current.state, 'submitted');
    assert.equal(current.submissionOutcome, 'confirmed');
    assert.equal(current.submissionAttemptCount, 1);
    assert.equal(current.stepPending, false, 'ordinary result checkpoint must acknowledge the proof-confirmed step');
    if (index === 0) {
      assert.equal(journal.jobs[other.jobId].state, 'not_started');
      assert.equal(journal.jobs[other.jobId].submissionAttemptCount, 0);
    }
  }
  assert.deepEqual(commands, roles.map(role => role.jobId));
  assert.deepEqual(proofIds, roles.map(role => role.jobId));
  assert.deepEqual(h.calls.checkpoints, roles.map(role => role.jobId));
  assert.ok(h.calls.messages.every(message => !/WITHDRAW|LOCAL_MATCH|ANALYZE/.test(message.type)));
  assert.equal(h.calls.messages.some(message => /SUBMITTED_HISTORY/.test(message.type)), false,
    'neither owned Submit performs another inventory scan');
  assert.equal(h.data.appleJobRanking.reservations.length, 2, 'each confirmed role retains its reserved slot');
});
