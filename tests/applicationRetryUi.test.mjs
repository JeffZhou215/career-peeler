import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

let server, List, Activity, BatchReview, source, rankingSource;
const ids = ['200000101-0836', '200000102-9999'];
const failure = jobId => ({ jobId, title: `Engineer ${jobId}`, url: `https://jobs.apple.com/en-us/details/${jobId}/engineer`,
  status: 'needs_review', submissionOutcomeUnknown: false, canReturnToQueue: true,
  reason: 'An explicit answer was missing.', errorType: 'saved_application_answer_unresolved', failedAt: 123 });
before(async () => {
  server = await createServer({ configFile: false, plugins: [react()], appType: 'custom', logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ ApplicationFailureList: List, AppleActivity: Activity } = await server.ssrLoadModule('/src/sidepanel/components/AppleActivity.jsx'));
  ({ ApplicationBatchReview: BatchReview } = await server.ssrLoadModule('/src/sidepanel/components/RankedJobsSection.jsx'));
  source = await readFile(new URL('../src/sidepanel/components/AppleActivity.jsx', import.meta.url), 'utf8');
  rankingSource = await readFile(new URL('../src/sidepanel/components/RankedJobsSection.jsx', import.meta.url), 'utf8');
});
after(async () => { await server?.close(); });
const render = props => renderToStaticMarkup(createElement(List, { failures: ids.map(failure), selectedIds: [], busy: false,
  running: false, onSelect() {}, onSelectAll() {}, onClear() {}, onReturn() {}, onRetry() {}, onCheck() {}, onVerify() {}, onOpenSetup() {}, ...props }));

test('known failures provide batch selection, setup, and individual Review & Retry without a Submit button', () => {
  const html = render({ selectedIds: [ids[0]] });
  assert.match(html, /Return Selected To Application Queue \(1\)/);
  assert.match(html, /Review &amp; Retry/); assert.match(html, /Complete Answers/);
  assert.match(html, /Applications Require Review And Confirmation/);
  assert.match(html, /Select Retryable \(2\)/);
  assert.match(html, /2 Retryable · 0 Not Ready To Retry/);
  assert.doesNotMatch(html, /Confirm And Apply|Apply Selected/);
  for (const id of ids) assert.ok(html.includes(`Job ID ${id}, To Return To Queue`));
});

test('unknown outcomes remain visibly blocked even after inventory absence was recorded', () => {
  const html = render({ failures: [{ ...failure(ids[0]), status: 'needs_review', canReturnToQueue: false,
    submissionOutcomeUnknown: true, verifiedAbsentAt: Date.now(), retryBlockedReason: 'The outcome is still unknown.' }] });
  assert.match(html, /Outcome Unknown/); assert.match(html, /Check Job Status/);
  assert.match(html, /type="checkbox"[^>]*disabled=""/);
  assert.doesNotMatch(html, /Review &amp; Retry/);
});

test('blocked and retryable rows have separate counts and explain disabled selection', () => {
  const html = render({ failures: [failure(ids[0]), { ...failure(ids[1]), canReturnToQueue: false,
    submissionOutcomeUnknown: true, retryBlockedType: 'submission_outcome_unknown', retryWorkflowSessionId: 'previous-session',
    retryBlockedReason: 'The previous submission outcome is unknown.' }] });
  assert.match(html, /Select Retryable \(1\)/);
  assert.match(html, /1 Retryable · 1 Not Ready To Retry/);
  const checkboxes = html.match(/<input\b[^>]*>/g);
  const blocked = checkboxes.find(input => input.includes(ids[1]));
  assert.match(blocked, /disabled=""/);
  assert.match(blocked, /title="The previous submission outcome is unknown\."/);
  assert.doesNotMatch(checkboxes.find(input => input.includes(ids[0])), /disabled=""/);
  assert.match(html, /Verify Previous Application/);
  assert.match(html, /checks Active submissions/);
  assert.match(html, /An uncertain Submit cannot be retried/);
});

test('explicit previous-application verification is offered only for blocked recovery rows with a session', () => {
  for (const retryBlockedType of ['submission_outcome_unknown', 'workflow_recovery_required']) {
    const html = render({ failures: [{ ...failure(ids[0]), canReturnToQueue: false, retryBlockedType,
      retryWorkflowSessionId: 'previous-session' }] });
    assert.match(html, /<button[^>]*>Verify Previous Application<\/button>/);
    assert.match(html, /<button[^>]*>Check Job Status<\/button>/);
    assert.match(html, /type="checkbox"[^>]*disabled=""/);
    assert.doesNotMatch(html, /Review &amp; Retry/);
  }
  for (const overrides of [{}, { retryWorkflowSessionId: 'previous-session', canReturnToQueue: true },
    { retryWorkflowSessionId: 'previous-session', retryBlockedType: 'assessment_stale' },
    { retryWorkflowSessionId: 'previous-session', status: 'submitted' }]) {
    const html = render({ failures: [{ ...failure(ids[0]), canReturnToQueue: false,
      retryBlockedType: 'submission_outcome_unknown', ...overrides }] });
    assert.doesNotMatch(html, /Verify Previous Application/);
  }
});

test('running and busy states disable explicit previous-application verification', () => {
  const failures = [{ ...failure(ids[0]), canReturnToQueue: false, retryBlockedType: 'submission_outcome_unknown',
    retryWorkflowSessionId: 'previous-session' }];
  for (const state of [{ running: true }, { busy: true }]) {
    const html = render({ failures, ...state });
    assert.match(html, /button[^>]*disabled=""[^>]*>Verify Previous Application/);
  }
});

test('a durable unknown override stays visible when old failure metadata claimed a known result', () => {
  const html = render({ failures: [{ ...failure(ids[0]), canReturnToQueue: false, retryBlockedType: 'submission_outcome_unknown' }] });
  assert.match(html, /Outcome Unknown|Check Job Status/);
  assert.doesNotMatch(html, /Review &amp; Retry/);
});

test('requeued and submitted failures remain available as folded history without unresolved counts', () => {
  const failures = [{ ...failure(ids[0]), status: 'requeued' }, { ...failure(ids[1]), status: 'submitted' }];
  const html = render({ failures });
  assert.match(html, /Requeued/); assert.match(html, /Submitted Later/); assert.match(html, /Previous Failure/);
  assert.doesNotMatch(html, /type="checkbox"|Review &amp; Retry|Return Selected To Application Queue/);
  const activity = renderToStaticMarkup(createElement(Activity, { view: { applicationFailures: failures, running: false } }));
  assert.doesNotMatch(activity, /\d+ Needs Review/);
});

test('removed and page-submitted jobs are folded history without retry or selection controls', () => {
  const failures = [{ ...failure(ids[0]), status: 'unavailable', canReturnToQueue: false },
    { ...failure(ids[1]), status: 'page_submitted', canReturnToQueue: false }];
  const html = render({ failures });
  assert.match(html, /Posting Removed/); assert.match(html, /Submitted On Apple/);
  assert.match(html, /Previous Failure/);
  assert.doesNotMatch(html, /type="checkbox"|Review &amp; Retry|Return Selected|Check Job Status/);
  const activity = renderToStaticMarkup(createElement(Activity, { view: { applicationFailures: failures } }));
  assert.doesNotMatch(activity, /\d+ Needs Review/);
});

test('running workflows disable every return, retry, and selection action', () => {
  const html = render({ running: true, selectedIds: [ids[0]] });
  assert.match(html, /button[^>]*disabled=""[^>]*>Return Selected/);
  assert.match(html, /button[^>]*disabled=""[^>]*>Review &amp; Retry/);
  assert.match(html, /type="checkbox"[^>]*disabled=""/);
});

test('retry confirmation shows the previous failure and still requires the explicit submission confirmation', () => {
  const job = { ...failure(ids[0]), score: 90, eligible: true, previousApplicationFailure: { reason: 'A saved answer was missing.', lastStep: 'Questions' } };
  const html = renderToStaticMarkup(createElement(BatchReview, { batch: { jobs: [job], capacity: { known: true, remaining: 8 } },
    selectedCount: 1, preparing: false, starting: false, busy: false, error: '', allowSubmission: false, reviewAcknowledged: true }));
  assert.match(html, /Previous Application Failure|A saved answer was missing/);
  assert.match(html, /Last Step: Questions/);
  assert.match(html, /button[^>]*disabled=""[^>]*>Confirm And Apply \(1\)/);
});

function handlerHarness(options = {}) {
  const messages = [], reviews = [], statuses = [];
  const state = { selected: [...ids], error: '', rows: {}, busy: false };
  const sandbox = { selectedIds: [...ids], busyRef: { current: false }, view: { running: false },
    setBusy: value => { state.busy = value; }, setError: value => { state.error = value; },
    setRowFeedback: value => { state.rows = typeof value === 'function' ? value(state.rows) : value; },
    setSelectedIds: update => { state.selected = update(state.selected); },
    getActiveTab: options.getActiveTab || (async () => ({ id: 7, windowId: 1, url: 'https://jobs.apple.com/en-us/search' })),
    save: options.save || (async () => ({ workAuthorized: 'yes' })),
    chrome: { runtime: { sendMessage: async message => { messages.push(message); return options.sendMessage
      ? options.sendMessage(message) : { ok: true, queuedIds: [...message.selectedIds], blocked: [] }; } } },
    setStatusMessage: value => statuses.push(value), onReviewRetry: id => reviews.push(id) };
  vm.createContext(sandbox);
  const begin = source.indexOf('  async function returnToQueue('), end = source.indexOf('\n\n  return <details', begin);
  assert.ok(begin > 0 && end > begin);
  vm.runInContext(`${source.slice(begin, end)}\nglobalThis.returnJobs = returnToQueue; globalThis.checkJob = checkStatus; globalThis.verifyJob = verifyPreviousApplication;`, sandbox);
  return { sandbox, state, messages, reviews, statuses };
}

test('bulk return sends the exact frozen selection and does not request an application', async () => {
  const h = handlerHarness(); const selected = [...ids];
  await h.sandbox.returnJobs(selected); selected.splice(0);
  assert.equal(h.messages.length, 1); assert.equal(h.messages[0].type, 'APPLE_CAREERS_RETURN_APPLICATIONS_TO_QUEUE');
  assert.deepEqual([...h.messages[0].selectedIds], ids); assert.equal(h.messages[0].tab.id, 7);
  assert.equal(h.reviews.length, 0); assert.equal(h.state.selected.length, 0);
  assert.match(h.statuses[0], /No applications started/);
});

test('individual retry requests the existing one-role review only after successful requeue', async () => {
  const h = handlerHarness(); await h.sandbox.returnJobs([ids[0]], true);
  assert.deepEqual(h.reviews, [ids[0]]);
  assert.ok(!h.messages.some(m => /APPLY_JOB_QUEUE|APPLY_CURRENT_ROLE/.test(m.type)));
});

test('partial requeue preserves blocked selections and their individual reasons', async () => {
  const h = handlerHarness({ sendMessage: async () => ({ ok: true, queuedIds: [ids[0]], blocked: [{ jobId: ids[1], reason: 'Outcome unknown.' }] }) });
  await h.sandbox.returnJobs();
  assert.deepEqual(h.state.selected, [ids[1]]); assert.equal(h.state.rows[ids[1]], 'Outcome unknown.');
});

test('failed or unknown individual retries never open an application review sheet', async () => {
  for (const response of [{ ok: false, error: 'Could not save the queue.' }, { ok: true, queuedIds: [], blocked: [{ jobId: ids[0], reason: 'Outcome unknown.' }] }]) {
    const h = handlerHarness({ sendMessage: async () => response });
    await h.sandbox.returnJobs([ids[0]], true);
    assert.equal(h.reviews.length, 0); assert.equal(h.state.selected.length, 2);
  }
});

test('repeated clicks during an outstanding return dispatch only one request', async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { entered = resolve; });
  const h = handlerHarness({ sendMessage: async () => { entered(); await gate; return { ok: true, queuedIds: [ids[0]], blocked: [] }; } });
  const first = h.sandbox.returnJobs([ids[0]], true); await reached;
  await h.sandbox.returnJobs([ids[0]], true); release(); await first;
  assert.equal(h.messages.length, 1); assert.deepEqual(h.reviews, [ids[0]]);
});

test('Check Job Status remains page-only even for an unknown result with a recovery session', async () => {
  const h = handlerHarness({ save: () => assert.fail('Read-only reconciliation must not save the profile'),
    sendMessage: async () => ({ ok: true, data: { resolved: false, message: 'Still unknown; no retry authorized.' } }) });
  await h.sandbox.checkJob({ ...failure(ids[0]), canReturnToQueue: false, submissionOutcomeUnknown: true,
    retryBlockedType: 'submission_outcome_unknown', retryWorkflowSessionId: 'old-owner' });
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].type, 'APPLE_CAREERS_CHECK_REVIEW_JOB_PAGE');
  assert.equal(h.messages[0].jobId, ids[0]); assert.equal(h.messages[0].userProfile, undefined);
  assert.equal(h.messages[0].workflowSessionId, undefined);
  assert.equal(h.reviews.length, 0); assert.match(h.state.rows[ids[0]], /Still unknown/);
});

test('explicit verification sends only the exact previous session and job without saving, requeuing, or applying', async () => {
  for (const [retryBlockedType, resolved] of [['submission_outcome_unknown', false], ['workflow_recovery_required', true]]) {
    const h = handlerHarness({ save: () => assert.fail('Verification must not save the profile'),
      sendMessage: async () => ({ ok: true, data: { resolved, message: 'Previous application verified; review its status.' } }) });
    await h.sandbox.verifyJob({ ...failure(ids[1]), canReturnToQueue: false, retryBlockedType,
      retryWorkflowSessionId: 'previous-session' });
    assert.equal(h.messages.length, 1);
    assert.deepEqual({ ...h.messages[0] }, { type: 'APPLE_CAREERS_CHECK_INTERRUPTED_APPLICATION',
      workflowSessionId: 'previous-session', jobId: ids[1], tab: h.messages[0].tab });
    assert.equal(h.messages[0].tab.id, 7);
    assert.equal(h.messages[0].userProfile, undefined);
    assert.equal(h.reviews.length, 0);
    assert.deepEqual(h.state.selected, ids);
    assert.equal(h.state.rows[ids[1]], 'Previous application verified; review its status.');
    assert.equal(h.state.busy, false);
  }
});

test('verification refuses missing sessions and rows that are not blocked for recovery', async () => {
  for (const overrides of [{ retryWorkflowSessionId: undefined }, { retryWorkflowSessionId: '' },
    { retryBlockedType: 'assessment_stale' }, { canReturnToQueue: true }]) {
    const h = handlerHarness({ getActiveTab: () => assert.fail('Invalid verification must not read a tab'),
      save: () => assert.fail('Verification must not save the profile') });
    await h.sandbox.verifyJob({ ...failure(ids[0]), canReturnToQueue: false,
      retryBlockedType: 'submission_outcome_unknown', retryWorkflowSessionId: 'previous-session', ...overrides });
    assert.equal(h.messages.length, 0);
    assert.match(h.state.rows[ids[0]], /no matching previous record|Refresh Activity/);
    assert.equal(h.reviews.length, 0);
    assert.equal(h.state.busy, false);
  }
});

test('verification freezes the exact operation before awaiting the active tab', async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { entered = resolve; });
  const h = handlerHarness({ getActiveTab: async () => { entered(); await gate; return { id: 7 }; },
    sendMessage: async () => ({ ok: true, data: { resolved: false } }) });
  const job = { ...failure(ids[0]), canReturnToQueue: false, retryBlockedType: 'submission_outcome_unknown',
    retryWorkflowSessionId: 'previous-session' };
  const pending = h.sandbox.verifyJob(job); await reached;
  job.jobId = ids[1]; job.retryWorkflowSessionId = 'changed-session';
  release(); await pending;
  assert.equal(h.messages[0].jobId, ids[0]);
  assert.equal(h.messages[0].workflowSessionId, 'previous-session');
  assert.match(h.state.rows[ids[0]], /uncertain Submit cannot be retried/);
  assert.equal(h.state.rows[ids[1]], undefined);
});

test('duplicate verification and other Activity actions share the outstanding-operation guard', async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { entered = resolve; });
  const h = handlerHarness({ save: () => assert.fail('Busy Activity must not save the profile'),
    sendMessage: async () => { entered(); await gate; return { ok: true, data: { resolved: false } }; } });
  const job = { ...failure(ids[0]), canReturnToQueue: false, retryBlockedType: 'submission_outcome_unknown',
    retryWorkflowSessionId: 'previous-session' };
  const pending = h.sandbox.verifyJob(job); await reached;
  assert.equal(h.state.busy, true);
  await h.sandbox.verifyJob(job);
  await h.sandbox.checkJob(job);
  await h.sandbox.returnJobs([ids[1]], true);
  release(); await pending;
  assert.equal(h.messages.length, 1);
  assert.equal(h.reviews.length, 0);
  assert.deepEqual(h.state.selected, ids);
  assert.equal(h.state.busy, false);
});

test('a running workflow refuses verification and verification failures stay beside the selected row', async () => {
  const job = { ...failure(ids[0]), canReturnToQueue: false, retryBlockedType: 'workflow_recovery_required',
    retryWorkflowSessionId: 'previous-session' };
  const running = handlerHarness(); running.sandbox.view.running = true;
  await running.sandbox.verifyJob(job);
  assert.equal(running.messages.length, 0);
  for (const response of [{ ok: false, error: 'The previous workflow changed.' }, { ok: true, data: {} }]) {
    const h = handlerHarness({ sendMessage: async () => response });
    await h.sandbox.verifyJob(job);
    assert.match(h.state.rows[ids[0]], /previous workflow changed|could not be verified/);
    assert.equal(h.state.error, '');
    assert.equal(h.state.busy, false);
    assert.equal(h.reviews.length, 0);
  }
});

test('external single-role retry consumes its request once and invokes preparation rather than Apply', async () => {
  const events = [];
  const sandbox = { reviewRetryRequest: { jobId: ids[0], requestId: 'retry-1' }, handledRetryRequest: { current: null },
    onRetryRequestHandled: () => events.push('consumed'), busy: false, view: { running: false }, applyOpen: false,
    setStatusMessage: message => events.push(message), setQueueOpen: () => {}, setSelectedQueueIds: value => events.push([...value]),
    reviewSelectedBatch: value => events.push({ prepared: [...value] }) };
  vm.createContext(sandbox);
  const start = rankingSource.indexOf('    if (!reviewRetryRequest || handledRetryRequest.current');
  const end = rankingSource.indexOf('\n  }, [reviewRetryRequest]);', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(`globalThis.handle = () => { ${rankingSource.slice(start, end)} };`, sandbox);
  sandbox.handle(); sandbox.handle();
  assert.deepEqual(events, ['consumed', [ids[0]], { prepared: [ids[0]] }]);
  assert.doesNotMatch(rankingSource.slice(start, end), /APPLY_JOB_QUEUE|\.apply\(/);
});
