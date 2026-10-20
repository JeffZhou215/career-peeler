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

function inventory(ids = [baseId]) {
  return { pageCount: 1, pages: [{ pageIndex: 1, pageCount: 1, hasNextPage: false,
    accountVerified: true, withdrawalConfirmationOpen: false,
    inventoryState: ids.length ? 'confirmed' : 'confirmed_empty', roles: ids.map(id => ({
      ...job, jobId: id, url: job.url.replace(jobId, id), active: true })) }] };
}

async function fixture(options = {}) {
  let h;
  const observed = { proofReads: 0, inventoryReads: 0 };
  const currentInventory = () => options.inventory || inventory(options.activeIds);
  const tabs = [{ id: 1, windowId: 1, status: 'complete',
    url: `https://jobs.apple.com/app/en-us/apply/${jobId}` },
  { id: 2, windowId: 1, status: 'complete', url: 'https://jobs.apple.com/app/en-us/profile/roles' }];
  h = createBackgroundHarness(tabs, { sendMessage: async (tabId, message) => {
    if (message.type === 'APPLE_CAREERS_REVOKE_WORKFLOW') return { ok: true, workflowSessionId: message.workflowSessionId };
    if (message.type === 'APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE') return { ok: true, data: currentInventory().pages[0] };
    if (message.type === 'APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES') {
      observed.inventoryReads++;
      await options.onInventory?.(h);
      return options.inventoryResponse || { ok: true, data: currentInventory() };
    }
    if (message.type === 'APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS') {
      observed.proofReads++;
      const proof = { requestId: message.requestId, jobId, url: job.url, identityVerified: true,
        submissionOutcome: 'confirmed', proof: 'apple_submitted_controls',
        documentStartedAt: message.notBefore, observedAt: Date.now(),
        signal: { jobId, title: job.title, source: 'apple_submitted_controls', text: `Submitted: ${job.title} ${jobId}` },
        controlEvidence: controls() };
      await options.onProof?.(h, proof, message, tabId);
      return { ok: true, data: { ...proof, ...(options.proof || {}) } };
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
    searches: {}, applicationFailures: {}, reservations: [{ jobId, startedAt: Date.now() }] };
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
  const allowed = new Set(['APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS', 'APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE',
    'APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES', 'APPLE_CAREERS_REVOKE_WORKFLOW']);
  assert.ok(h.calls.messages.every(message => allowed.has(message.type)));
  assert.equal(h.calls.checkpoints.length, 0, 'verification cannot fabricate a newly submitted application checkpoint');
  assert.ok(h.calls.created.every(tab => tab.active === false &&
    [job.url, 'https://jobs.apple.com/app/en-us/profile/roles'].includes(tab.url)),
  'verification may open only inactive exact-job details or inventory tabs');
  assert.ok(h.calls.removed.every(id => id !== 1 && id !== 2), 'user/form tabs are preserved');
}

for (const activeId of [jobId, baseId]) test(`owned Submit redirect confirms fresh exact controls with Active inventory ${activeId}`, async () => {
  const h = await fixture({ activeIds: [activeId] });
  const result = await h.verify();
  assert.equal(result.confirmed, true, result.error);
  assert.equal(pending(h).state, 'submitted');
  assert.equal(pending(h).submissionOutcome, 'confirmed');
  assert.equal(pending(h).submissionAttemptCount, 1);
  assert.equal(h.data[journalKey].id, h.input.workflowSessionId);
  assert.equal(h.data[journalKey].status, 'running', 'confirming the current operation cannot claim or restart a batch');
  assert.equal(h.observed.proofReads, 1);
  assert.ok(h.observed.inventoryReads >= 1);
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
]) test(`owned Submit outcome stays unknown with ${name} proof`, async () => {
  const h = await fixture({ proof });
  const result = await h.verify();
  assert.equal(result.confirmed, false);
  assertUnknown(h);
  assertReadOnly(h);
});

for (const [name, options] of [
  ['missing selected role', { activeIds: [] }],
  ['different location', { activeIds: [jobId.replace('0836', '0157')] }],
  ['failed read', { inventoryResponse: { ok: false, error: 'Synthetic inventory failure' } }],
  ['incomplete pagination', { inventory: { ...inventory(), pageCount: 2 } }],
  ['unauthenticated inventory', { inventory: { pageCount: 1, pages: [{ ...inventory().pages[0], accountVerified: false }] } }],
]) test(`owned Submit outcome stays unknown with ${name} inventory`, async () => {
  const h = await fixture(options);
  const result = await h.verify();
  assert.equal(result.confirmed, false);
  assertUnknown(h);
  assertReadOnly(h);
});

for (const phase of ['onProof', 'onInventory']) test(`cancellation during ${phase} cannot confirm or replay the pending Submit`, async () => {
  const h = await fixture({ activeIds: [jobId], [phase]: async current => {
    await current.sandbox.cancelAppleApplicationSession();
  } });
  const result = await h.verify();
  assert.equal(result.confirmed, false);
  assert.equal(h.data[journalKey].status, 'cancelled');
  assert.equal(h.data[journalKey].stopRequested, true);
  assertUnknown(h);
  assertReadOnly(h);
});

for (const phase of ['onProof', 'onInventory']) test(`worker ownership change during ${phase} cannot confirm another operation`, async () => {
  const h = await fixture({ activeIds: [jobId], [phase]: async current => {
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

test('a stale cached complete inventory cannot replace a failed fresh post-Submit read', async () => {
  const h = await fixture({ inventoryResponse: { ok: false, error: 'Fresh read unavailable' } });
  h.data.appleJobRanking.capacitySnapshot = { roles: inventory([jobId]).pages[0].roles, complete: true,
    accountVerified: true, inventoryState: 'confirmed', scannedAt: 1, updatedAt: 1 };
  const result = await h.verify();
  assert.equal(result.confirmed, false);
  assert.ok(h.observed.inventoryReads > 0);
  assertUnknown(h);
  assertReadOnly(h);
});

for (const outcome of ['unknown', 'inactive']) test(`a concurrent ${outcome} withdrawal prevents post-Submit confirmation`, async () => {
  const h = await fixture({ onInventory: current => {
    current.data.appleWithdrawalWorkflow.records[jobId] = { jobId, outcome, updatedAt: Date.now() };
  } });
  const result = await h.verify();
  assert.equal(result.confirmed, false);
  assert.equal(h.data.appleWithdrawalWorkflow.records[jobId].outcome, outcome);
  assertUnknown(h);
  assertReadOnly(h);
});

for (const phase of ['onProof', 'onInventory']) {
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
  const activeInventory = () => ({ pageCount: 1, pages: [{ pageIndex: 1, pageCount: 1, hasNextPage: false,
    accountVerified: true, withdrawalConfirmationOpen: false,
    inventoryState: submitted.length ? 'confirmed' : 'confirmed_empty',
    roles: submitted.map(id => ({ ...roleById[id], jobId: id.split('-')[0], active: true })) }] });
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
    if (message.type === 'APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE') return { ok: true, data: activeInventory().pages[0] };
    if (message.type === 'APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES') return { ok: true, data: activeInventory() };
    assert.fail(`Unexpected shared-session browser action: ${message.type}`);
  } });
  await h.ready;
  h.sandbox.delay = async () => {};
  const sessionId = await h.sandbox.claimAppleApplicationSession(roles, { sourceTabId: 1, sourceWindowId: 1 });
  h.data.appleWithdrawalWorkflow = { version: 1, records: {} };
  h.data.appleJobRanking = { version: 1, jobs: Object.fromEntries(roles.map(role => [role.jobId.split('-')[0],
    { ...role, queueStatus: 'applying' }])), searches: {}, applicationFailures: {},
  reservations: roles.map(role => ({ jobId: role.jobId, startedAt: Date.now() })) };
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
});
