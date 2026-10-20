const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core.js');
const ranking = require('../lib/jobRanking.js');
const { createBackgroundHarness } = require('./helpers/appleWorkflowHarness.cjs');

const fullId = '200685673-0836';
const siblingId = '200685673-0157';
const source = { id: 1, windowId: 1, status: 'complete', url: 'https://jobs.apple.com/en-us/search?team=MLAI' };
const originalUrl = `https://jobs.apple.com/en-us/details/${siblingId}/systems-software-engineer?team=SFTWR#requirements`;
const expectedUrl = originalUrl.replace(siblingId, fullId);
const resumeFileDataUrl = 'data:application/pdf;base64,synthetic-location-test';
const profile = core.normalizeUserProfile({ resumeFileDataUrl, resumeText: 'Built Python backend services.',
  resumeTextFingerprint: core.fingerprintText(resumeFileDataUrl), userYearsOfExperience: 1.5,
  llmEnabled: true, llmModel: 'gpt-4o', llmApiKey: 'sk-offline', llmApiKeyValidationStatus: 'valid',
  llmApiKeyValidatedFingerprint: core.fingerprintText('sk-offline'), autoApplyConsent: true,
  workAuthorized: 'yes', requiresSponsorship: 'no',
  eeoGender: 'male', eeoRaceEthnicity: ['asian'], eeoVeteranStatus: 'not_protected_veteran',
  eeoDisabilityStatus: 'no_current_or_past' });

async function fixture(overrides = {}) {
  const h = createBackgroundHarness([{ ...source }], { sendMessage: async (_tab, message) => {
    assert.fail(`Location-link repair must not automate Apple: ${message.type}`);
  } });
  await h.ready;
  const job = { jobId: fullId, title: 'Systems Software Engineer, Platform Architecture', url: originalUrl,
    queueStatus: 'queued', score: 86, eligible: true, evaluationVersion: ranking.EVALUATION_VERSION,
    profileSignature: h.sandbox.appleRankingProfileSignature(profile), postingSignature: 'reviewed-posting',
    breakdown: { responsibilities: 90, qualifications: 85, level: 85, domain: 80 },
    reason: 'Relevant backend experience.', blockers: [],
    queuedReviewSignature: 'existing-review', ...overrides };
  h.data.appleJobRanking = { jobs: { [ranking.idOf(fullId)]: job }, searches: {}, applicationFailures: {},
    reservations: [], withdrawnIds: [] };
  return Object.assign(h, { job });
}

function persistedJob(h) { return h.data.appleJobRanking.jobs[ranking.idOf(fullId)]; }
function serial(value) { return JSON.parse(JSON.stringify(value)); }

test('legacy queued location-link repair preserves the selected full ID, assessment, and URL components durably', async () => {
  const h = await fixture();
  const before = structuredClone(h.job);
  const state = await h.sandbox.readAppleRankingState();
  assert.deepEqual(serial(state.jobs[ranking.idOf(fullId)]), { ...before, url: expectedUrl });
  assert.deepEqual(persistedJob(h), { ...before, url: expectedUrl });
  assert.equal(h.calls.created.length, 0);
  assert.equal(h.calls.messages.length, 0);
  const restarted = createBackgroundHarness([{ ...source }], { data: h.data });
  await restarted.ready;
  const restored = await restarted.sandbox.readAppleRankingState();
  assert.equal(restored.jobs[ranking.idOf(fullId)].url, expectedUrl);
  assert.equal(restored.jobs[ranking.idOf(fullId)].jobId, fullId);
});

test('queued location-link repair is idempotent and does not keep writing repaired records', async () => {
  const h = await fixture();
  const store = h.sandbox.CareerPeelerJobStore;
  const commit = store.updateCollections;
  let commits = 0;
  store.updateCollections = async (...args) => { commits++; return commit(...args); };
  await h.sandbox.readAppleRankingState();
  const firstCommits = commits;
  await h.sandbox.readAppleRankingState();
  assert.ok(firstCommits > 0, 'the repaired URL must be persisted');
  assert.equal(commits, firstCommits, 'reopening the panel does not repeatedly migrate an exact link');
});

test('available and legacy available records retain their full ID during link repair', async () => {
  for (const queueStatus of ['available', undefined]) {
    const h = await fixture({ queueStatus });
    await h.sandbox.readAppleRankingState();
    assert.equal(persistedJob(h).url, expectedUrl);
    assert.equal(persistedJob(h).jobId, fullId);
    assert.equal(persistedJob(h).queueStatus, queueStatus);
  }
});

test('link repair leaves uncertain, applying, failed, and terminal records untouched', async () => {
  for (const queueStatus of ['uncertain', 'applying', 'needs_review', 'submitted', 'withdrawn', 'page_submitted', 'unavailable']) {
    const h = await fixture({ queueStatus });
    const before = structuredClone(h.job);
    await h.sandbox.readAppleRankingState();
    assert.deepEqual(persistedJob(h), before, queueStatus);
  }
});

test('repair does not mutate unresolved journals, prior failure identity, reservations, or reviewed selection', async () => {
  const h = await fixture();
  const failure = { jobId: fullId, url: originalUrl, status: 'uncertain', submissionOutcomeUnknown: true, failedAt: 123 };
  const journal = { id: 'old-session', owner: 'old-owner', status: 'paused', reconciliationRequired: true,
    jobs: { [fullId]: { jobId: fullId, url: originalUrl, state: 'uncertain', submissionOutcome: 'unknown', submissionAttemptCount: 1 } } };
  h.data.appleJobRanking.applicationFailures[ranking.idOf(fullId)] = failure;
  h.data.appleJobRanking.reservations = [{ jobId: fullId, startedAt: 123 }];
  h.data.appleApplicationWorkflow = journal;
  await h.sandbox.readAppleRankingState();
  assert.deepEqual(h.data.appleApplicationWorkflow, journal);
  assert.deepEqual(h.data.appleJobRanking.applicationFailures[ranking.idOf(fullId)], failure);
  assert.deepEqual(h.data.appleJobRanking.reservations, [{ jobId: fullId, startedAt: 123 }]);
  assert.equal(persistedJob(h).jobId, fullId);
});

test('exact cached job links remain byte-for-byte unchanged', async () => {
  const h = await fixture({ url: expectedUrl });
  const before = structuredClone(h.job);
  await h.sandbox.readAppleRankingState();
  assert.deepEqual(persistedJob(h), before);
});

test('foreign, unrelated, credentialed, malformed, and base-only cached links are not guessed', async () => {
  for (const url of [
    originalUrl.replace('https://jobs.apple.com', 'https://example.com'),
    originalUrl.replace('https:', 'http:'),
    originalUrl.replace('https://', 'https://someone:secret@'),
    originalUrl.replace(siblingId, '200999999-0157'),
    originalUrl.replace(siblingId, ranking.idOf(fullId)),
    originalUrl.replace('/en-us/details/', '/app/en-us/apply/'),
    originalUrl.replace('/en-us/details/', '/en-us/search/'),
    'not a URL', '',
  ]) {
    const h = await fixture({ url });
    await h.sandbox.readAppleRankingState();
    assert.equal(persistedJob(h).url, url, url);
    assert.equal(persistedJob(h).jobId, fullId);
  }
  const h = await fixture({ jobId: ranking.idOf(fullId) });
  await h.sandbox.readAppleRankingState();
  assert.equal(persistedJob(h).url, originalUrl, 'a base-only reviewed ID cannot acquire an inferred location');
});

test('batch preparation uses and persists the repaired exact location without claiming a workflow', async () => {
  const h = await fixture();
  const result = await h.sandbox.prepareAppleApplicationBatch(profile, [fullId], source);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.jobs.length, 1);
  assert.equal(result.data.jobs[0].jobId, fullId);
  assert.equal(result.data.jobs[0].url, expectedUrl);
  assert.equal(persistedJob(h).url, expectedUrl);
  assert.equal(h.data.appleApplicationWorkflow?.id, undefined);
  assert.equal(h.calls.created.length, 0);
  assert.equal(h.calls.messages.length, 0);
});

test('unrepairable selected links stop batch preparation with the exact full ID before any application', async () => {
  for (const url of ['https://example.com/en-us/details/200685673-0836/engineer',
    'https://jobs.apple.com/en-us/details/200999999-0157/engineer', 'malformed']) {
    const h = await fixture({ url });
    const result = await h.sandbox.prepareAppleApplicationBatch(profile, [fullId], source);
    assert.equal(result.ok, false, url);
    assert.match(result.error, new RegExp(fullId));
    assert.match(result.error, /rank|scan|identity|link|job ID/i);
    assert.equal(h.data.appleApplicationWorkflow?.id, undefined);
    assert.equal(h.calls.created.length, 0);
    assert.equal(h.calls.messages.length, 0);
  }
});

test('a sibling full ID cannot enter a batch selected for the original queued role', async () => {
  const h = await fixture({ jobId: siblingId, url: originalUrl });
  const result = await h.sandbox.prepareAppleApplicationBatch(profile, [fullId], source);
  assert.equal(result.ok, false);
  assert.equal(persistedJob(h).jobId, siblingId);
  assert.equal(persistedJob(h).url, originalUrl);
  assert.equal(h.data.appleApplicationWorkflow?.id, undefined);
});

test('a link that changes to an unrelated job after review stops before workflow ownership is claimed', async () => {
  const h = await fixture();
  const prepared = await h.sandbox.prepareAppleApplicationBatch(profile, [fullId], source);
  assert.equal(prepared.ok, true, prepared.error);
  persistedJob(h).url = 'https://jobs.apple.com/en-us/details/200999999-0157/unrelated-engineer';
  const result = await h.sandbox.startAppleJobQueue(source, profile, prepared.data.reviewToken,
    [fullId], prepared.data.batchToken);
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(fullId));
  assert.equal(h.data.appleApplicationWorkflow?.id, undefined);
  assert.equal(h.calls.created.length, 0);
  assert.equal(h.calls.messages.length, 0);
});

test('repairing a queued link never bypasses an unresolved previous Submit for the selected full ID', async () => {
  const h = await fixture();
  h.data.appleApplicationWorkflow = { id: 'previous-session', status: 'paused', reconciliationRequired: false,
    jobs: { [fullId]: { jobId: fullId, url: originalUrl, state: 'uncertain', submissionOutcome: 'unknown', submissionAttemptCount: 1 } } };
  await h.sandbox.readAppleRankingState();
  assert.equal(persistedJob(h).url, expectedUrl);
  const before = structuredClone(h.data.appleApplicationWorkflow);
  const result = await h.sandbox.prepareAppleApplicationBatch(profile, [fullId], source);
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown Submit outcome/i);
  assert.equal(result.errorType, 'submission_outcome_unknown');
  assert.deepEqual(h.data.appleApplicationWorkflow, before);
  assert.equal(h.calls.created.length, 0);
  assert.equal(h.calls.messages.length, 0);
});

test('atomic repair cannot overwrite a concurrent full-ID, URL, or queue-state replacement', async () => {
  for (const changed of [
    { jobId: siblingId },
    { url: `https://jobs.apple.com/en-us/details/${fullId}/new-reviewed-link` },
    { queueStatus: 'uncertain' },
    { queueStatus: 'submitted' },
    { queueStatus: 'needs_review' },
  ]) {
    const h = await fixture();
    const store = h.sandbox.CareerPeelerJobStore;
    const commit = store.updateCollections;
    let injected = false;
    store.updateCollections = async (keys, callback) => {
      if (!injected) { injected = true; Object.assign(persistedJob(h), changed); }
      return commit(keys, callback);
    };
    const before = { ...structuredClone(h.job), ...changed };
    const state = await h.sandbox.readAppleRankingState();
    assert.ok(injected, 'repair must use the atomic collection boundary');
    assert.deepEqual(persistedJob(h), before, JSON.stringify(changed));
    assert.deepEqual(serial(state.jobs[ranking.idOf(fullId)]), before, 'the caller must not receive a superseded queued snapshot');
  }
});

test('failed migration writes cannot return a repaired-but-unpersisted queue identity', async () => {
  const h = await fixture();
  h.sandbox.CareerPeelerJobStore.updateCollections = async () => { throw new Error('Synthetic migration write failure'); };
  await assert.rejects(h.sandbox.readAppleRankingState(), /Synthetic migration write failure/);
  assert.equal(persistedJob(h).url, originalUrl);
  assert.equal(h.calls.created.length, 0);
  assert.equal(h.calls.messages.length, 0);
});

test('atomic link repair cannot resurrect a queued role removed before the transaction', async () => {
  for (const removeCollection of [false, true]) {
    const h = await fixture();
    const store = h.sandbox.CareerPeelerJobStore;
    const commit = store.updateCollections;
    store.updateCollections = async (keys, callback) => {
      if (removeCollection) delete h.data.appleJobRanking;
      else delete h.data.appleJobRanking.jobs[ranking.idOf(fullId)];
      return commit(keys, callback);
    };
    const state = await h.sandbox.readAppleRankingState();
    assert.equal(state.jobs[ranking.idOf(fullId)], undefined, 'no stale queue entry may escape the repair boundary');
    assert.equal(h.data.appleJobRanking?.jobs?.[ranking.idOf(fullId)], undefined);
    assert.equal(h.calls.created.length, 0);
    assert.equal(h.calls.messages.length, 0);
  }
});
