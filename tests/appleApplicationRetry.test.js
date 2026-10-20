const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core.js');
const ranking = require('../lib/jobRanking.js');
const fs = require('node:fs');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');
const { createBackgroundHarness } = require('./helpers/appleWorkflowHarness.cjs');

const ids = ['200000101-0836', '200000102-9999'];
const source = { id: 1, windowId: 1, status: 'complete', url: 'https://jobs.apple.com/app/en-us/profile/roles' };
const pdf = 'data:application/pdf;base64,offline';
const profile = core.normalizeUserProfile({ resumeFileDataUrl: pdf, resumeText: 'Built Python backend APIs.',
  resumeTextFingerprint: core.fingerprintText(pdf), userYearsOfExperience: 1.5,
  llmEnabled: true, llmModel: 'gpt-4o', llmApiKey: 'sk-offline', llmApiKeyValidationStatus: 'valid',
  llmApiKeyValidatedFingerprint: core.fingerprintText('sk-offline'), workAuthorized: 'yes', requiresSponsorship: 'no',
  eeoGender: 'male', eeoRaceEthnicity: ['asian'], eeoVeteranStatus: 'not_protected_veteran', eeoDisabilityStatus: 'no_current_or_past' });
const details = { title: 'Software Engineer', description: 'Build Python APIs.', minimumQualifications: 'Computer Science degree.',
  preferredQualifications: '', requiredExperience: [] };

async function fixture(options = {}) {
  let h, now = Date.now();
  const modes = {};
  const page = { pageIndex: 1, pageCount: 1, hasNextPage: false, roles: options.activeRoles || [],
    inventoryState: options.activeRoles?.length ? 'confirmed' : 'confirmed_empty', accountVerified: true, withdrawalConfirmationOpen: false };
  h = createBackgroundHarness([{ ...source }], { sendMessage: async (tabId, message) => {
    const tab = h.tabs.find(item => item.id === tabId);
    if (message.type === 'APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE') return { ok: true, data: page };
    if (message.type === 'APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES') return options.failedInventory
      ? { ok: false, error: 'Synthetic incomplete inventory.' } : { ok: true, data: { pages: [page], pageCount: 1 } };
    if (message.type === 'APPLE_CAREERS_REVOKE_WORKFLOW') return { ok: !options.failedRevocation, workflowSessionId: message.workflowSessionId };
    const jobId = core.getJobIdFromUrl(tab.url);
    if (message.type === 'APPLE_CAREERS_EXTRACT_SUBMITTED_ROLE_DETAILS') {
      await options.onDetail?.(jobId, h);
      if (modes[jobId] === 'unavailable') return { ok: true, data: { jobId, url: tab.url, ready: false, postingUnavailable: true } };
      return { ok: true, data: { ...details, ready: true, jobId: modes[jobId] === 'identity' ? '200999999-0836' : jobId,
        url: tab.url, ...(modes[jobId] === 'changed' ? { description: 'A substantially changed posting.' } : {}) } };
    }
    if (message.type === 'APPLE_CAREERS_EXTRACT_JOB') return { ok: true, data: { jobId, url: tab.url,
      identityVerified: true, canApply: modes[jobId] !== 'disabled', alreadySubmitted: modes[jobId] === 'submitted' } };
    throw new Error(`Mutating or unexpected message ${message.type}`);
  } });
  await h.ready;
  h.sandbox.Date = class extends Date { static now() { return now; } };
  h.sandbox.delay = async ms => { now += ms; };
  h.data.appleJobRanking = { jobs: Object.fromEntries(ids.map(jobId => [ranking.idOf(jobId), {
    jobId, title: details.title, url: `https://jobs.apple.com/en-us/details/${jobId}/engineer`, score: 90,
    eligible: true, queueStatus: 'needs_review', profileSignature: h.sandbox.appleRankingProfileSignature(profile),
    postingSignature: core.fingerprintText(JSON.stringify(ranking.postingInput(details))), autoQueuedFrom: { scanId: 'old-scan' }
  }])), searches: {}, reservations: [], applicationFailures: Object.fromEntries(ids.map(jobId => [ranking.idOf(jobId), {
    jobId, title: details.title, url: `https://jobs.apple.com/en-us/details/${jobId}/engineer`,
    status: 'needs_review', submissionOutcomeUnknown: false, reason: 'A saved answer was missing.',
    errorType: 'saved_application_answer_unresolved', failedAt: 123, attempts: 2
  }])) };
  h.return = (selectedIds = ids, userProfile = profile, sender = {}) => h.sandbox.dispatch({
    type: 'APPLE_CAREERS_RETURN_APPLICATIONS_TO_QUEUE', selectedIds, userProfile, tab: source }, sender);
  h.check = (jobId = ids[0], sender = {}) => h.sandbox.dispatch({ type: 'APPLE_CAREERS_CHECK_REVIEW_JOB_PAGE', jobId, tab: source }, sender);
  h.unknown = (jobId = ids[0]) => {
    const job = h.data.appleJobRanking.jobs[ranking.idOf(jobId)];
    job.queueStatus = 'uncertain';
    const failure = h.data.appleJobRanking.applicationFailures[ranking.idOf(jobId)];
    Object.assign(failure, { status: 'uncertain', submissionOutcomeUnknown: true, verifiedAbsentAt: Date.now() });
    h.data.appleApplicationWorkflow = { id: 'old-owner', status: 'paused', reconciliationRequired: false,
      jobs: { [jobId]: { ...job, state: 'uncertain', workflowSessionId: 'old-owner', submissionOutcome: 'unknown',
        submissionAttemptCount: 1, submitIntentAt: Date.now(), stepPending: false } } };
    h.data.appleJobRanking.reservations.push({ jobId, startedAt: Date.now() });
  };
  return Object.assign(h, { modes });
}

test('batch return revalidates only selected roles, preserves history and queues without starting applications', async () => {
  const h = await fixture();
  const response = await h.return();
  assert.equal(response.ok, true, response.error);
  assert.deepEqual([...response.queuedIds], ids);
  for (const id of ids) {
    const job = h.data.appleJobRanking.jobs[ranking.idOf(id)], failure = h.data.appleJobRanking.applicationFailures[ranking.idOf(id)];
    assert.equal(job.queueStatus, 'queued'); assert.equal(job.autoQueuedFrom, undefined);
    assert.equal(failure.status, 'requeued'); assert.equal(failure.attempts, 2); assert.equal(failure.failedAt, 123);
    assert.equal(failure.reason, 'A saved answer was missing.');
  }
  assert.equal(h.data.appleJobRanking.capacitySnapshot, undefined, 'returning to queue does not scan Active submissions');
  assert.ok(!h.calls.messages.some(m => /GET_.*SUBMITTED_HISTORY/.test(m.type)));
  assert.equal(h.data.appleApplicationWorkflow.id, undefined, 'no application owner was claimed');
  assert.equal(h.data.appleJobRanking.reservations.length, 0);
  assert.ok(h.calls.created.every(tab => tab.active === false));
  assert.ok(!h.calls.messages.some(m => /RUN_APPLICATION|AUTHORIZE/.test(m.type)));
});

test('one-role retry preparation does not queue or include unselected failures', async () => {
  const h = await fixture();
  const response = await h.return([ids[0]]);
  assert.deepEqual([...response.queuedIds], [ids[0]]);
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[1])].queueStatus, 'needs_review');
  const batch = await h.sandbox.prepareAppleApplicationBatch(profile, [ids[0]], source);
  assert.equal(batch.ok, true, batch.error);
  assert.deepEqual([...batch.data.jobs.map(job => job.jobId)], [ids[0]]);
  assert.ok(batch.data.batchToken);
  assert.equal(batch.data.jobs[0].previousApplicationFailure.reason, 'A saved answer was missing.');
  assert.ok(!h.calls.messages.some(m => /RUN_APPLICATION|AUTHORIZE/.test(m.type)));
});

test('unknown outcome remains blocked despite a prior verified absence and a newly selected batch', async () => {
  const h = await fixture(); h.unknown();
  const before = structuredClone(h.data.appleApplicationWorkflow);
  const response = await h.return([ids[0]]);
  assert.equal(response.queuedIds.length, 0);
  assert.equal(response.blocked[0].errorType, 'submission_outcome_unknown');
  assert.equal(h.calls.created.length, 0);
  assert.deepEqual(h.data.appleApplicationWorkflow, before);
  assert.equal(h.data.appleJobRanking.reservations.length, 1);
});

test('a pending ordinary form is distinguished from an unknown Submit and still requires reconciliation', async () => {
  const h = await fixture();
  h.data.appleApplicationWorkflow = { id: 'pending-form', status: 'paused', jobs: { [ids[0]]: {
    jobId: ids[0], state: 'in_progress', stepPending: true, submissionOutcome: 'not_attempted', submissionAttemptCount: 0
  } } };
  const result = await h.return([ids[0]]);
  assert.equal(result.queuedIds.length, 0);
  assert.equal(result.blocked[0].errorType, 'workflow_recovery_required');
  assert.equal(h.calls.created.length, 0);
});

test('mixed selection returns a known failure while leaving an absent unknown outcome reserved and blocked', async () => {
  const h = await fixture(); h.unknown();
  const response = await h.return();
  assert.deepEqual([...response.queuedIds], [ids[1]]);
  assert.equal(response.blocked[0].jobId, ids[0]);
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].submissionOutcome, 'unknown');
  assert.notEqual(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'queued');
  assert.equal(h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])].submissionOutcomeUnknown, true);
  const view = await h.sandbox.getAppleRankingView(profile);
  assert.equal(view.applicationFailures.find(job => job.jobId === ids[0]).canReturnToQueue, false);
  assert.equal(h.data.appleJobRanking.reservations[0].jobId, ids[0]);
});

test('worker restart and repeated return requests cannot clear an unknown Submit', async () => {
  const h = await fixture(); h.unknown();
  h.data.appleApplicationWorkflow.jobs[ids[0]].retryReviewedAt = Date.now() - 1000;
  const restarted = createBackgroundHarness([{ ...source }], { data: h.data });
  await restarted.ready;
  for (let i = 0; i < 2; i++) {
    const result = await restarted.sandbox.returnAppleApplicationsToQueue(profile, [ids[0]], source);
    assert.equal(result.queuedIds.length, 0);
    assert.equal(result.blocked[0].errorType, 'submission_outcome_unknown');
  }
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].submissionOutcome, 'unknown');
  assert.equal(restarted.calls.created.length, 0);
});

for (const mode of ['unavailable', 'changed', 'disabled', 'submitted']) {
  test(`${mode} posting cannot be queued while a safe selection can return`, async () => {
    const h = await fixture(); h.modes[ids[0]] = mode;
    const response = await h.return();
    assert.deepEqual([...response.queuedIds], [ids[1]], response.error);
    assert.equal(response.blocked[0].jobId, ids[0]);
    assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus,
      mode === 'unavailable' ? 'unavailable' : mode === 'submitted' ? 'page_submitted' : 'needs_review');
  });
}

test('an identity mismatch aborts the check without returning any roles', async () => {
  const h = await fixture(); h.modes[ids[1]] = 'identity';
  const response = await h.return();
  assert.equal(response.ok, false); assert.equal(response.errorType, 'job_identity_mismatch');
  assert.ok(ids.every(id => h.data.appleJobRanking.jobs[ranking.idOf(id)].queueStatus === 'needs_review'));
});

test('returning jobs to queue does not request inventory even when capacity synchronization would fail', async () => {
  const h = await fixture({ failedInventory: true });
  const response = await h.return();
  assert.equal(response.ok, true); assert.deepEqual([...response.queuedIds], ids);
  assert.ok(!h.calls.messages.some(m => /GET_.*SUBMITTED_HISTORY/.test(m.type)));
  assert.equal(h.data.appleJobRanking.capacitySnapshot, undefined);
});

test('Submitted on the exact job page excludes it without reading inventory or claiming active confirmation', async () => {
  const h = await fixture(); h.modes[ids[0]] = 'submitted';
  const response = await h.return([ids[0]]);
  assert.equal(response.queuedIds.length, 0); assert.equal(response.blocked[0].errorType, 'already_applied');
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'page_submitted');
  assert.ok(!h.calls.messages.some(m => /GET_.*SUBMITTED_HISTORY/.test(m.type)));
});

test('changed resume, missing answers, and mismatched full IDs cannot be requeued', async () => {
  for (const change of ['resume', 'answer', 'id', 'legacy']) {
    const h = await fixture(); let p = profile, selected = [ids[0]];
    if (change === 'resume') p = { ...profile, userYearsOfExperience: 7 };
    if (change === 'answer') p = { ...profile, workAuthorized: '' };
    if (change === 'id') selected = [ids[0].replace('0836', '9999')];
    if (change === 'legacy') h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])].legacy = true;
    const response = await h.return(selected, p);
    assert.ok(!response.ok || !response.queuedIds.length, change);
    assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'needs_review');
    if (change !== 'answer') assert.equal(h.calls.created.length, 0);
  }
});

test('a persistence failure does not report success or discard the failure record', async () => {
  const h = await fixture();
  h.sandbox.CareerPeelerJobStore.updateCollections = async () => { throw new Error('Synthetic retry write failure'); };
  const response = await h.return([ids[0]]);
  assert.equal(response.ok, false); assert.match(response.error, /write failure/);
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'needs_review');
  assert.equal(h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])].status, 'needs_review');
});

test('concurrent requests and cancellation during a delayed read do not start or queue an application', async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { entered = resolve; });
  const h = await fixture({ onDetail: async () => { entered(); await gate; } });
  const pending = h.return([ids[0]]); await reached;
  assert.equal((await h.return([ids[0]])).ok, false);
  await h.sandbox.stopAppleJobRanking(); release();
  const response = await pending;
  assert.equal(response.ok, false); assert.equal(response.errorType, 'stopped_by_user');
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'needs_review');
});

test('a late durable unknown outcome overrides earlier safe metadata before committing the queue', async () => {
  const h = await fixture({ onDetail: (_id, f) => { f.unknown(); } });
  const response = await h.return([ids[0]]);
  assert.equal(response.queuedIds.length, 0); assert.equal(response.blocked[0].errorType, 'submission_outcome_unknown');
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'uncertain');
});

test('requeued history cannot hide a newly discovered durable unknown outcome', async () => {
  const h = await fixture(); await h.return([ids[0]]); h.unknown();
  h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])].status = 'requeued';
  const view = await h.sandbox.getAppleRankingView(profile);
  const failure = view.applicationFailures.find(job => job.jobId === ids[0]);
  assert.equal(failure.status, 'uncertain'); assert.equal(failure.canReturnToQueue, false);
  assert.equal(failure.retryBlockedType, 'submission_outcome_unknown');
});

test('an unknown outcome arriving immediately before the atomic queue commit cannot be overwritten', async () => {
  const h = await fixture();
  const commit = h.sandbox.CareerPeelerJobStore.updateCollections;
  h.sandbox.CareerPeelerJobStore.updateCollections = async (...args) => { h.unknown(); return commit(...args); };
  const result = await h.return([ids[0]]);
  assert.equal(result.queuedIds.length, 0); assert.equal(result.blocked[0].errorType, 'submission_outcome_unknown');
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].submissionOutcome, 'unknown');
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'uncertain');
});

test('real IndexedDB transactions retain a late unknown journal and do not commit a stale requeue', async () => {
  const h = await fixture();
  const indexedDB = new IDBFactory(), databases = [];
  const open = indexedDB.open.bind(indexedDB);
  indexedDB.open = (...args) => { const request = open(...args); request.addEventListener('success', () => databases.push(request.result)); return request; };
  const realm = { indexedDB, console, chrome: h.sandbox.chrome };
  vm.createContext(realm);
  vm.runInContext(fs.readFileSync(require.resolve('../lib/appleJobStore.js'), 'utf8'), realm);
  const store = realm.CareerPeelerJobStore;
  try {
    await store.ready();
    h.sandbox.CareerPeelerJobStore = { ...store, updateCollections: async (keys, update) => {
      // A second owner/observer commits while the browser verification's old
      // snapshot is still held. The real transaction must read this new value.
      await store.updateMetadata('appleApplicationWorkflow', () => ({ id: 'late-owner', status: 'paused', jobs: {
        [ids[0]]: { jobId: ids[0], state: 'uncertain', submissionOutcome: 'unknown', submissionAttemptCount: 1 }
      } }));
      return store.updateCollections(keys, update);
    } };
    const response = await h.return([ids[0]]);
    assert.equal(response.queuedIds.length, 0);
    assert.equal(response.blocked[0].errorType, 'submission_outcome_unknown');
    const saved = (await store.get('appleJobRanking')).appleJobRanking;
    assert.equal(saved.jobs[ranking.idOf(ids[0])].queueStatus, 'needs_review');
    assert.equal(saved.applicationFailures[ranking.idOf(ids[0])].status, 'needs_review');
    assert.equal((await store.getMetadata('appleApplicationWorkflow')).jobs[ids[0]].submissionOutcome, 'unknown');
  } finally { for (const database of databases) database.close(); }
});

test('repeated successful returns deduplicate roles and preserve previous failure details', async () => {
  const h = await fixture();
  for (let i = 0; i < 2; i++) assert.deepEqual([...(await h.return([ids[0], ids[0]])).queuedIds], [ids[0]]);
  const view = await h.sandbox.getAppleRankingView(profile);
  assert.equal(view.queued.filter(job => job.jobId === ids[0]).length, 1);
  assert.equal(view.applicationFailures.find(f => f.jobId === ids[0]).status, 'requeued');
});

test('a reviewed retry survives worker restart after an interrupted ordinary form without changing cancellation', async () => {
  const h = await fixture();
  const job = h.data.appleJobRanking.jobs[ranking.idOf(ids[0])];
  Object.assign(h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])], { errorType: 'worker_interrupted', legacy: true });
  h.data.appleApplicationWorkflow = { id: 'stopped-form', owner: 'previous-worker', status: 'cancelled', stopRequested: true,
    reconciliationRequired: false, jobs: { [ids[0]]: { ...job, state: 'failed', stepPending: false,
      submissionOutcome: 'not_attempted', submissionAttemptCount: 0, reconciliation: 'not_attempted' } } };
  assert.deepEqual([...(await h.return([ids[0]])).queuedIds], [ids[0]]);
  const restarted = createBackgroundHarness([{ ...source }], { data: h.data });
  await restarted.ready;
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'queued');
  assert.equal(h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])].status, 'requeued');
  assert.equal(h.data.appleApplicationWorkflow.status, 'cancelled');
  assert.equal(h.data.appleApplicationWorkflow.stopRequested, true);
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].submissionOutcome, 'not_attempted');
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].resultAt, undefined, 'a retry review is not an invented application outcome');
  assert.equal(restarted.calls.created.length, 0);
});

test('content scripts cannot request returning applications to the queue', async () => {
  const h = await fixture();
  const response = await h.return(ids, profile, { tab: source });
  assert.equal(response.ok, false); assert.match(response.error, /extension panel/);
  assert.equal(h.calls.created.length, 0);
});

for (const [mode, state] of [['apply', 'submit'], ['submitted', 'submitted'], ['unavailable', 'unavailable']]) {
  test(`Check Job Status reads ${mode} directly without Active inventory, scoring, or application actions`, async () => {
    const h = await fixture(); h.modes[ids[0]] = mode;
    const response = await h.check();
    assert.equal(response.ok, true, response.error);
    assert.equal(response.data.state, state);
    assert.equal(h.data.appleJobRanking.capacitySnapshot, undefined);
    assert.equal(h.calls.created.length, 1); assert.equal(h.calls.created[0].active, false);
    assert.ok(!h.calls.messages.some(m => /SUBMITTED_HISTORY|RUN_APPLICATION|AUTHORIZE|SCORE/.test(m.type)));
    assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[1])].queueStatus, 'needs_review');
    if (state === 'submit') assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'needs_review');
    else {
      const view = await h.sandbox.getAppleRankingView(profile);
      for (const key of ['ranked', 'candidates', 'queued', 'staleMatches', 'excludedMatches']) {
        assert.ok(!view[key].some(job => job.jobId === ids[0]), key);
      }
      assert.equal(view.applicationFailures.find(job => job.jobId === ids[0]).canReturnToQueue, false);
      const before = h.calls.created.length;
      assert.equal((await h.return([ids[0]])).queuedIds.length, 0);
      assert.equal(h.calls.created.length, before, 'fresh batch cannot bypass the persisted exclusion');
    }
  });
}

for (const mode of ['submitted', 'unavailable']) {
  test(`${mode} on a job page excludes an uncertain role without resolving its prior Submit or releasing capacity`, async () => {
    const h = await fixture(); h.unknown(); h.modes[ids[0]] = mode;
    const journal = structuredClone(h.data.appleApplicationWorkflow), reservations = structuredClone(h.data.appleJobRanking.reservations);
    assert.equal((await h.check()).ok, true);
    assert.deepEqual(h.data.appleApplicationWorkflow, journal);
    assert.deepEqual(h.data.appleJobRanking.reservations, reservations);
    assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'uncertain');
    const view = await h.sandbox.getAppleRankingView(profile);
    const failure = view.applicationFailures.find(job => job.jobId === ids[0]);
    assert.equal(failure.status, 'uncertain'); assert.equal(failure.submissionOutcomeUnknown, true);
    assert.equal(failure.retryBlockedType, 'submission_outcome_unknown');
    assert.equal((await h.return([ids[0]])).queuedIds.length, 0);
  });
}

test('page exclusion survives worker restart, stale queue status, profile changes, and direct batch messages', async () => {
  const h = await fixture(); h.modes[ids[0]] = 'unavailable'; await h.check();
  h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus = 'queued';
  const restarted = createBackgroundHarness([{ ...source }], { data: h.data }); await restarted.ready;
  for (const p of [profile, { ...profile, userYearsOfExperience: 5 }]) {
    const view = await restarted.sandbox.getAppleRankingView(p);
    for (const key of ['queued', 'ranked', 'excludedMatches', 'staleMatches']) assert.ok(!view[key].some(job => job.jobId === ids[0]), key);
  }
  await assert.rejects(restarted.sandbox.readAppleSelectedApplicationBatch(profile, [ids[0]]), /selected roles|available|queued/i);
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].submissionQueueExclusion.state, 'unavailable');
});

test('legacy unavailable diagnostic is excluded immediately without rescanning or a matching profile', async () => {
  const h = await fixture();
  const id = ranking.idOf(ids[0]);
  h.data.appleJobRanking.jobs[id].queueStatus = 'queued';
  h.data.appleJobRanking.applicationFailures[id].errorType = 'job_unavailable';
  await assert.rejects(h.sandbox.readAppleSelectedApplicationBatch(profile, [ids[0]]), /selected roles|available|queued/i);
  const view = await h.sandbox.getAppleRankingView({ ...profile, userYearsOfExperience: 9 });
  assert.ok(!view.staleMatches.some(job => job.jobId === ids[0]));
  assert.equal(view.applicationFailures.find(job => job.jobId === ids[0]).status, 'unavailable');
  assert.equal(h.calls.created.length, 0);
});

test('a different full-ID variant cannot exclude the stored job sharing its base ID', async () => {
  const h = await fixture();
  const other = ids[0].replace('0836', '9999');
  await h.sandbox.recordAppleJobPageExclusion(other, `https://jobs.apple.com/en-us/details/${other}/engineer`, 'unavailable');
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].submissionQueueExclusion, undefined);
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'needs_review');
});

test('a failed page-status persistence is reported without claiming removal or changing capacity', async () => {
  const h = await fixture(); h.modes[ids[0]] = 'submitted';
  h.sandbox.CareerPeelerJobStore.updateCollections = async () => { throw new Error('Synthetic exclusion write failure'); };
  const response = await h.check();
  assert.equal(response.ok, false); assert.match(response.error, /write failure/);
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].submissionQueueExclusion, undefined);
  assert.equal(h.data.appleJobRanking.capacitySnapshot, undefined);
});

test('unverified, disabled, or different-ID job pages never become removed or submitted', async () => {
  for (const mode of ['disabled', 'identity']) {
    const h = await fixture(); h.modes[ids[0]] = mode;
    assert.equal((await h.check()).ok, false);
    assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].submissionQueueExclusion, undefined);
  }
});

test('repeated status checks and Stop cannot start competing work or queue an application', async () => {
  let entered, release;
  const gate = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { entered = resolve; });
  const h = await fixture({ onDetail: async () => { entered(); await gate; } });
  const pending = h.check(); await reached;
  assert.equal((await h.check()).ok, false);
  await h.sandbox.stopAppleJobRanking(); release();
  const response = await pending;
  assert.equal(response.ok, false); assert.equal(response.errorType, 'stopped_by_user');
  assert.equal(h.calls.created.length, 1);
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'needs_review');
});

test('content scripts cannot request the extension-only job-page check', async () => {
  const h = await fixture();
  assert.equal((await h.check(ids[0], { tab: source })).ok, false);
  assert.equal(h.calls.created.length, 0);
});

async function interruptedOrdinaryForm(options = {}) {
  const h = await fixture(options);
  const jobId = ids[0], id = ranking.idOf(jobId), job = h.data.appleJobRanking.jobs[id];
  const failure = h.data.appleJobRanking.applicationFailures[id];
  Object.assign(failure, { submissionOutcomeUnknown: true, status: 'uncertain',
    workflowSessionId: 'interrupted-form', errorType: 'apply_failed' });
  job.queueStatus = 'uncertain';
  h.data.appleJobRanking.reservations.push({ jobId, startedAt: 123 });
  h.data.appleApplicationWorkflow = { id: 'interrupted-form', owner: 'prior-worker', status: 'paused',
    reconciliationRequired: true, currentJobId: jobId, jobs: { [jobId]: { ...job,
      workflowSessionId: 'interrupted-form', state: 'in_progress', stepId: 'form-step', stepPending: true,
      submissionOutcome: 'not_attempted', submissionAttemptCount: 0, tabId: source.id } } };
  h.verify = () => h.sandbox.dispatch({ type: 'APPLE_CAREERS_CHECK_INTERRUPTED_APPLICATION',
    workflowSessionId: 'interrupted-form', jobId, tab: source });
  return h;
}

test('page-only checks cannot unlock interrupted forms; explicit verified no-Submit reconciliation makes them selectable', async () => {
  const h = await interruptedOrdinaryForm();
  const before = structuredClone(h.data.appleApplicationWorkflow);
  assert.equal((await h.check()).data.state, 'submit');
  assert.deepEqual(h.data.appleApplicationWorkflow, before);
  assert.equal((await h.sandbox.getAppleRankingView(profile)).applicationFailures.find(f => f.jobId === ids[0]).canReturnToQueue, false);
  assert.equal(h.calls.messages.some(m => /GET_.*SUBMITTED_HISTORY/.test(m.type)), false);
  const verified = await h.verify();
  assert.equal(verified.ok, true, verified.error);
  assert.equal(verified.data.resolved, true);
  const failure = h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])];
  assert.equal(failure.submissionOutcomeUnknown, false);
  assert.equal(failure.status, 'needs_review');
  assert.equal((await h.sandbox.getAppleRankingView(profile)).applicationFailures.find(f => f.jobId === ids[0]).canReturnToQueue, true);
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].reconciliation, 'not_attempted');
  assert.equal(h.data.appleJobRanking.reservations.some(r => r.jobId === ids[0]), false);
  assert.equal(h.calls.messages.some(m => /RUN_APPLICATION|AUTHORIZE_WORKFLOW/.test(m.type)), false);
  const returned = await h.return([ids[0]]);
  assert.deepEqual([...returned.queuedIds], [ids[0]]);
});

for (const options of [{ failedInventory: true }, { failedRevocation: true }]) {
  test(`${Object.keys(options)[0]} cannot unlock an interrupted application or release its reservation`, async () => {
    const h = await interruptedOrdinaryForm(options);
    const result = await h.verify();
    assert.equal(result.ok, false);
    assert.equal(h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])].submissionOutcomeUnknown, true);
    assert.ok(h.data.appleJobRanking.reservations.some(r => r.jobId === ids[0]));
    assert.equal((await h.sandbox.getAppleRankingView(profile)).applicationFailures.find(f => f.jobId === ids[0]).canReturnToQueue, false);
    assert.equal(h.calls.messages.some(m => /RUN_APPLICATION|AUTHORIZE_WORKFLOW/.test(m.type)), false);
  });
}

test('a genuinely unknown Submit stays locked after explicit empty-inventory verification and a fresh batch', async () => {
  const h = await interruptedOrdinaryForm();
  Object.assign(h.data.appleApplicationWorkflow.jobs[ids[0]], { state: 'uncertain', submissionOutcome: 'unknown',
    submissionAttemptCount: 1, submitAuthorizedStep: 'form-step', submitIntentAt: Date.now() });
  const verified = await h.verify();
  assert.equal(verified.ok, true, verified.error); assert.equal(verified.data.resolved, false);
  assert.equal(h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])].submissionOutcomeUnknown, true);
  assert.equal(h.data.appleApplicationWorkflow.jobs[ids[0]].submissionOutcome, 'unknown');
  assert.ok(h.data.appleJobRanking.reservations.some(r => r.jobId === ids[0]));
  assert.equal((await h.return([ids[0]])).queuedIds.length, 0);
  assert.equal(h.calls.messages.some(m => /RUN_APPLICATION|AUTHORIZE_WORKFLOW/.test(m.type)), false);
});

test('verified ordinary-form recovery preserves explicit cancellation and does not automatically requeue', async () => {
  const h = await interruptedOrdinaryForm();
  Object.assign(h.data.appleApplicationWorkflow, { status: 'cancelled', stopRequested: true });
  const verified = await h.verify();
  assert.equal(verified.ok, true, verified.error);
  assert.equal(h.data.appleApplicationWorkflow.status, 'cancelled');
  assert.equal(h.data.appleApplicationWorkflow.stopRequested, true);
  assert.equal(h.data.appleJobRanking.jobs[ranking.idOf(ids[0])].queueStatus, 'needs_review');
  assert.equal(h.calls.messages.some(m => /RUN_APPLICATION|AUTHORIZE_WORKFLOW/.test(m.type)), false);
});

test('a no-Submit reconciliation repairs only a failure bound to that same operation', async () => {
  for (const scenario of ['missing session', 'other session', 'other full ID', 'explicit Submit error']) {
    const h = await interruptedOrdinaryForm();
    const failure = h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])];
    if (scenario === 'missing session') delete failure.workflowSessionId;
    if (scenario === 'other session') failure.workflowSessionId = 'another-attempt';
    if (scenario === 'other full ID') failure.jobId = ids[0].replace('0836', '9999');
    if (scenario === 'explicit Submit error') failure.errorType = 'clicked_but_unconfirmed';
    await h.verify();
    assert.equal(h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])].submissionOutcomeUnknown, true, scenario);
  }
});

test('legacy worker-interruption metadata needs its exact recovery event and full job identity', async () => {
  for (const matches of [true, false]) {
    const h = await interruptedOrdinaryForm();
    const failure = h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])];
    delete failure.workflowSessionId;
    Object.assign(failure, { errorType: 'worker_interrupted', failedAt: matches ? 321 : 654, legacy: true });
    h.data.appleApplicationWorkflow.recoveredAt = 321;
    await h.verify();
    assert.equal(h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])].submissionOutcomeUnknown, !matches);
  }
});

test('reconciliation metadata repair rechecks the durable journal atomically before clearing an unknown flag', async () => {
  for (const scenario of ['late unknown', 'new owner', 'write failure']) {
    const h = await interruptedOrdinaryForm();
    const update = h.sandbox.CareerPeelerJobStore.updateCollections;
    h.sandbox.CareerPeelerJobStore.updateCollections = async (keys, callback) => {
      if (scenario === 'write failure') throw new Error('Synthetic verification write failure.');
      if (scenario === 'new owner') h.data.appleApplicationWorkflow.id = 'new-owner';
      else Object.assign(h.data.appleApplicationWorkflow.jobs[ids[0]], { state: 'uncertain', submissionOutcome: 'unknown',
        submissionAttemptCount: 1, submitAuthorizedStep: 'late-step', submitIntentAt: Date.now() });
      return update(keys, callback);
    };
    await h.verify();
    assert.equal(h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])].submissionOutcomeUnknown, true, scenario);
    assert.equal((await h.sandbox.getAppleRankingView(profile)).applicationFailures.find(f => f.jobId === ids[0]).canReturnToQueue, false, scenario);
  }
});

test('no-Submit proof rejects pending, attempted, unreconciled, or inconsistent operation records', async () => {
  const h = await interruptedOrdinaryForm();
  const journal = h.data.appleApplicationWorkflow;
  const failure = h.data.appleJobRanking.applicationFailures[ranking.idOf(ids[0])];
  const safe = { ...journal.jobs[ids[0]], state: 'failed', stepPending: false,
    reconciliation: 'not_attempted', reconciledAt: Date.now() };
  assert.equal(h.sandbox.appleFailureHasReconciledNoSubmit(failure, safe, journal), true);
  for (const changes of [{ stepPending: true }, { submissionOutcome: 'unknown' }, { submissionAttemptCount: 1 },
    { acknowledgedAttemptCount: 1 }, { submitIntentAt: 1 }, { submitAuthorizedStep: 'submit-step' },
    { reconciliation: 'absent' }, { reconciledAt: undefined }, { jobId: ids[1] }, { url: 'https://example.com' }]) {
    assert.equal(h.sandbox.appleFailureHasReconciledNoSubmit(failure, { ...safe, ...changes }, journal), false, JSON.stringify(changes));
  }
  assert.equal(h.sandbox.appleFailureHasReconciledNoSubmit(failure, safe, { ...journal, status: 'running' }), false);
});
