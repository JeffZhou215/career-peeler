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
const renderActivity = failures => renderToStaticMarkup(createElement(Activity, { view: { applicationFailures: failures, running: false } }));
const historyStatuses = ['submitted', 'requeued', 'unavailable', 'page_submitted'];
function groupList(html, label) {
  return html.match(new RegExp(`<ul\\b(?=[^>]*aria-label="${label}")[^>]*>([\\s\\S]*?)<\\/ul>`))?.[1] || '';
}
function needsReviewSection(html) {
  const section = html.match(/<section\b(?=[^>]*aria-label="Needs Review")[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(section, 'Needs Review has a labelled section');
  return section[1];
}
function assertCollapsedHistory(html, count) {
  const openingTag = html.match(/<details\b(?=[^>]*class="[^"]*\bapplication-history\b)[^>]*>/)?.[0];
  assert.ok(openingTag, 'History uses its own details disclosure');
  assert.doesNotMatch(openingTag, /\bopen(?:\s|=|>)/, 'History starts collapsed');
  const summary = html.slice(html.indexOf(openingTag) + openingTag.length).match(/^<summary\b[^>]*>([\s\S]*?)<\/summary>/)?.[1];
  assert.ok(summary, 'History has a summary');
  const summaryText = summary.replace(/<[^>]*>/g, ' ');
  assert.match(summaryText, /\bHistory\b/);
  assert.match(summaryText, new RegExp(`\\b${count}\\b`));
}

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
  for (const overrides of [{}, { retryWorkflowSessionId: 'previous-session', canReturnToQueue: true, retryBlockedType: 'workflow_recovery_required' },
    { retryWorkflowSessionId: 'previous-session', retryBlockedType: 'assessment_stale' }]) {
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

test('mixed applications separate review actions from collapsed history and count only unresolved roles', () => {
  const review = failure(ids[0]);
  const blocked = { ...failure(ids[1]), canReturnToQueue: false, submissionOutcomeUnknown: true,
    retryBlockedType: 'submission_outcome_unknown', retryWorkflowSessionId: 'previous-session' };
  const history = historyStatuses.map((status, index) => ({ ...failure(`20000020${index}-0836`), status,
    lastStep: 'Questions', applicationHeading: 'Application Answers', retryWorkflowSessionId: 'old-session' }));
  const failures = [history[0], review, history[1], blocked, ...history.slice(2)];
  const html = render({ failures, selectedIds: [review.jobId, history[0].jobId] });
  const reviewList = groupList(html, 'Applications Needing Review');
  const historyList = groupList(html, 'Application History');
  const section = needsReviewSection(html);
  assertCollapsedHistory(html, history.length);
  assert.equal((reviewList.match(/<li\b/g) || []).length, 2);
  assert.equal((historyList.match(/<li\b/g) || []).length, 4);
  assert.match(section, /Return Selected To Application Queue \(1\)/);
  assert.match(section, /1 Retryable · 1 Not Ready To Retry/);
  for (const job of [review, blocked]) {
    assert.ok(reviewList.includes(job.jobId));
    assert.ok(!historyList.includes(job.jobId));
  }
  for (const job of history) {
    assert.ok(historyList.includes(job.jobId), 'History keeps the full job ID');
    assert.ok(historyList.includes(job.title), 'History keeps the role title');
    assert.ok(historyList.includes(`href="${job.url}"`), 'History keeps the original role link');
    assert.ok(!reviewList.includes(job.jobId));
    assert.ok(!section.includes(job.jobId));
  }
  for (const label of ['Submitted Later', 'Requeued', 'Posting Removed', 'Submitted On Apple']) assert.ok(historyList.includes(label));
  assert.equal((historyList.match(/<summary>Previous Failure<\/summary>/g) || []).length, 4);
  assert.match(historyList, /An explicit answer was missing\./);
  assert.match(historyList, /Last Step: Questions/);
  assert.match(historyList, /Application Step: Application Answers/);
  assert.doesNotMatch(historyList, /<input\b|<button\b|Review &amp; Retry|Check Job Status|Verify Previous Application|Complete Answers/);
  assert.match(renderActivity(failures), /2 Needs Review/);
});

test('all history leaves an empty Needs Review message and no review controls or unresolved count', () => {
  const failures = historyStatuses.map((status, index) => ({ ...failure(`20000030${index}-9999`), status,
    retryWorkflowSessionId: 'previous-session', retryBlockedType: 'workflow_recovery_required' }));
  const html = render({ failures, selectedIds: failures.map(job => job.jobId) });
  assertCollapsedHistory(html, failures.length);
  assert.match(needsReviewSection(html), /No Applications Need Review\./);
  assert.equal(groupList(html, 'Applications Needing Review'), '');
  assert.doesNotMatch(html, /<input\b|<button\b|Review &amp; Retry|Return Selected|Check Job Status|Verify Previous Application|Complete Answers/);
  assert.doesNotMatch(renderActivity(failures), /\d+ Needs Review/);
});

test('review-only and empty application sets do not render a History disclosure', () => {
  const reviewOnly = render({ failures: ids.map(failure) });
  assert.ok(groupList(reviewOnly, 'Applications Needing Review'));
  assert.doesNotMatch(reviewOnly, /application-history|aria-label="Application History"/);
  assert.match(needsReviewSection(reviewOnly), /Select Retryable \(2\)/);
  const empty = render({ failures: [] });
  assert.equal(empty, '');
});

test('explicit unknown outcomes keep conflicting resolved statuses in Needs Review for verification', () => {
  for (const status of historyStatuses) {
    for (const unknown of [{ submissionOutcomeUnknown: true }, { retryBlockedType: 'submission_outcome_unknown' }]) {
      const job = { ...failure(ids[0]), status, canReturnToQueue: false,
        retryBlockedType: 'submission_outcome_unknown', retryWorkflowSessionId: 'previous-session', ...unknown };
      if (!unknown.retryBlockedType) job.retryBlockedType = 'workflow_recovery_required';
      const html = render({ failures: [job] });
      const reviewList = groupList(html, 'Applications Needing Review');
      assert.ok(reviewList.includes(job.jobId));
      assert.match(reviewList, /Outcome Unknown/);
      assert.match(reviewList, /Verify Previous Application/);
      assert.match(reviewList, /Check Job Status/);
      assert.match(reviewList, /type="checkbox"[^>]*disabled=""/);
      assert.doesNotMatch(html, /application-history|Previous Failure|Review &amp; Retry/);
      assert.match(renderActivity([job]), /1 Needs Review/);
    }
  }
});

test('unknown outcomes cannot be selected or retried when stale metadata still claims retry readiness', () => {
  for (const unknown of [{ submissionOutcomeUnknown: true }, { retryBlockedType: 'submission_outcome_unknown' }]) {
    const job = { ...failure(ids[0]), status: 'submitted', retryBlockedType: 'workflow_recovery_required',
      retryWorkflowSessionId: 'previous-session', ...unknown };
    const html = render({ failures: [job], selectedIds: [job.jobId] });
    assert.match(needsReviewSection(html), /0 Retryable · 1 Not Ready To Retry/);
    assert.match(html, /type="checkbox"[^>]*disabled=""/);
    assert.doesNotMatch(html.match(/<input\b[^>]*>/)?.[0] || '', /\bchecked=""/);
    assert.match(html, /Return Selected To Application Queue \(0\)/);
    assert.match(html, /Verify Previous Application/);
    assert.doesNotMatch(html, /Review &amp; Retry|application-history/);
  }
});

test('resolved roles move from Needs Review into History when Activity refreshes', () => {
  for (const status of historyStatuses) {
    const before = ids.map(failure);
    assert.equal((groupList(render({ failures: before }), 'Applications Needing Review').match(/<li\b/g) || []).length, 2);
    const after = [{ ...before[0], status }, before[1]];
    const html = render({ failures: after });
    assert.ok(!groupList(html, 'Applications Needing Review').includes(ids[0]));
    assert.ok(groupList(html, 'Applications Needing Review').includes(ids[1]));
    assert.ok(groupList(html, 'Application History').includes(ids[0]));
    assertCollapsedHistory(html, 1);
    assert.match(renderActivity(after), /1 Needs Review/);
  }
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

function selectionHarness(failures) {
  const state = { selected: [...ids] };
  const sandbox = { failures, setSelectedIds: update => { state.selected = update(state.selected); } };
  vm.createContext(sandbox);
  const helpersStart = source.indexOf('const resolvedStatuses');
  const helpersEnd = source.indexOf('\nfunction FailureDetails', helpersStart);
  const start = source.indexOf('  useEffect(() => {');
  const end = source.indexOf('\n  }, [view]);', start);
  assert.ok(helpersStart > 0 && helpersEnd > helpersStart && start > helpersEnd && end > start);
  vm.runInContext(`${source.slice(helpersStart, helpersEnd)}\nglobalThis.refreshSelection = () => { ${source.slice(start + '  useEffect(() => {'.length, end)} };`, sandbox);
  return { sandbox, state };
}

test('Activity refresh removes resolved and newly blocked roles from the selected retry set', () => {
  for (const status of historyStatuses) {
    const h = selectionHarness(ids.map(failure));
    const initialSelection = h.state.selected;
    h.sandbox.refreshSelection();
    assert.equal(h.state.selected, initialSelection, 'Unchanged retryable selections keep their existing state');
    h.sandbox.failures = [{ ...failure(ids[0]), status }, failure(ids[1])];
    h.sandbox.refreshSelection();
    assert.deepEqual([...h.state.selected], [ids[1]], `${status} is removed from the retry selection`);
  }
  for (const unknown of [{ submissionOutcomeUnknown: true }, { retryBlockedType: 'submission_outcome_unknown' }]) {
    const h = selectionHarness([{ ...failure(ids[0]), status: 'submitted', ...unknown }, failure(ids[1])]);
    h.sandbox.refreshSelection();
    assert.deepEqual([...h.state.selected], [ids[1]], 'Unknown outcomes are removed even when stale metadata says they are retryable');
  }
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
  const helpers = source.slice(source.indexOf('const resolvedStatuses'), source.indexOf('\nfunction FailureDetails'));
  vm.runInContext(`${helpers}\n${source.slice(begin, end)}\nglobalThis.returnJobs = returnToQueue; globalThis.checkJob = checkStatus; globalThis.verifyJob = verifyPreviousApplication;`, sandbox);
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
  for (const [retryBlockedType, resolved, overrides] of [['submission_outcome_unknown', false, {}],
    ['workflow_recovery_required', true, {}], ['submission_outcome_unknown', false, { status: 'submitted', canReturnToQueue: true }]]) {
    const h = handlerHarness({ save: () => assert.fail('Verification must not save the profile'),
      sendMessage: async () => ({ ok: true, data: { resolved, message: 'Previous application verified; review its status.' } }) });
    await h.sandbox.verifyJob({ ...failure(ids[1]), canReturnToQueue: false, retryBlockedType,
      retryWorkflowSessionId: 'previous-session', ...overrides });
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
    { retryBlockedType: 'assessment_stale' }, { canReturnToQueue: true, retryBlockedType: 'workflow_recovery_required' }]) {
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
