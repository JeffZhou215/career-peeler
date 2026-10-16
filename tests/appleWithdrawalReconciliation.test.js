const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBackgroundHarness, createContentHarness } = require('./helpers/appleWorkflowHarness.cjs');
const { createAppleWithdrawalDom } = require('./helpers/appleWithdrawalDomHarness.cjs');
const jobId = '209900001';
const source = { id: 7, windowId: 4, status: 'complete', active: true,
  url: 'https://jobs.apple.com/app/en-us/profile/roles' };
const role = id => ({ jobId: id, title: 'Software Engineer', active: true,
  url: `https://jobs.apple.com/en-us/details/${id}/Software-Engineer` });
function evidence(ids, clock) {
  const pass = () => {
    const start = ++clock.now;
    const roles = ids.map(role);
    const inventoryState = roles.length ? 'confirmed' : 'confirmed_empty';
    return { complete: true, accountVerified: true, inventoryState, pageCount: 1,
      pages: [{ pageIndex: 1, pageCount: 1, accountVerified: true, hasNextPage: false,
        withdrawalConfirmationOpen: false, inventoryState, roles }],
      readStartedAt: start, readCompletedAt: ++clock.now };
  };
  const passes = [pass(), pass()];
  return { ...passes[1], passes };
}
async function harness() {
  const h = createBackgroundHarness([{ ...source }]);
  await h.ready;
  const clock = { now: Date.now() };
  h.sandbox.Date = class extends Date { static now() { return clock.now; } };
  h.sandbox.waitForTabComplete = async () => {};
  const identity = { jobId, batchId: 'batch', requestId: 'request', tabId: source.id,
    documentId: 'document', reviewedAt: clock.now };
  await h.sandbox.beginAppleWithdrawalIntent(identity);
  return { ...h, clock, identity };
}

test('fresh withdrawal verification creates one inactive same-window document and closes it', async () => {
  const h = await harness();
  h.sandbox.sendMessageWithFallback = async (tabId, message) => {
    assert.notEqual(tabId, source.id);
    assert.equal(message.type, 'APPLE_CAREERS_GET_STABLE_SUBMITTED_HISTORY_INVENTORY');
    assert.equal(message.openActive, true);
    assert.ok(message.notBefore >= h.clock.now);
    return { ok: true, data: evidence([], h.clock) };
  };
  const proof = await h.sandbox.readFreshAppleWithdrawalInventory(source.id, h.clock.now);
  assert.equal(proof.complete, true);
  assert.equal(proof.roles.length, 0);
  assert.equal(h.calls.created.length, 1);
  assert.equal(h.calls.created[0].active, false);
  assert.equal(h.calls.created[0].windowId, source.windowId);
  assert.deepEqual(h.calls.updated, []);
  assert.equal(h.calls.removed.length, 1);
});

test('failed, stale or incomplete fresh-document evidence never resolves or leaks a tab', async () => {
  for (const mode of ['failure', 'incomplete', 'stale']) {
    const h = await harness();
    h.sandbox.sendMessageWithFallback = async () => {
      if (mode === 'failure') throw new Error('Sign in required');
      const proof = evidence([], h.clock);
      if (mode === 'incomplete') proof.passes[1].pages = [];
      if (mode === 'stale') for (const pass of proof.passes) {
        pass.readStartedAt -= 120000; pass.readCompletedAt -= 120000;
      }
      return { ok: true, data: proof };
    };
    await assert.rejects(h.sandbox.readFreshAppleWithdrawalInventory(source.id, h.clock.now));
    assert.equal((await h.sandbox.readAppleWithdrawalRecord(jobId)).outcome, 'unknown');
    assert.equal(h.calls.removed.length, 1);
  }
});

for (const present of [true, false]) {
  test(`explicit Sync resolves an unknown withdrawal as ${present ? 'active' : 'inactive'} from fresh complete evidence`, async () => {
    const h = await harness();
    h.sandbox.sendMessageWithFallback = async (_tabId, message) => {
      assert.equal(message.type, 'APPLE_CAREERS_GET_STABLE_SUBMITTED_HISTORY_INVENTORY');
      return { ok: true, data: evidence(present ? [jobId] : [], h.clock) };
    };
    const state = await h.sandbox.readAppleRankingState();
    await h.sandbox.refreshAppleQueueCapacity(state, source.windowId, source.id);
    const record = await h.sandbox.readAppleWithdrawalRecord(jobId);
    assert.equal(record.outcome, present ? 'active' : 'inactive');
    assert.equal(h.calls.created[0].active, false);
    assert.equal(h.calls.removed.length, 1);
    assert.equal(h.calls.updated.length, 0);
    assert.equal(h.calls.messages.some(message => /WITHDRAW.*CLICK/.test(message.type)), false);
    if (present) {
      await assert.rejects(h.sandbox.assertAppleWithdrawalRetryAllowed([jobId], h.identity.reviewedAt), /Review and confirm/);
      await h.sandbox.assertAppleWithdrawalRetryAllowed([jobId], ++h.clock.now);
    } else {
      await assert.rejects(h.sandbox.assertAppleWithdrawalRetryAllowed([jobId], ++h.clock.now), /inactive/);
    }
  });
}

test('explicit Sync failure preserves unknown state and prior active records', async () => {
  const h = await harness();
  const previous = { complete: true, accountVerified: true, roles: [role(jobId)], updatedAt: h.clock.now };
  h.data.appleSubmittedRoleReviews = { latestScan: previous, lastCompleteScan: previous, pages: {} };
  h.sandbox.sendMessageWithFallback = async () => { throw new Error('Network unavailable'); };
  const state = await h.sandbox.readAppleRankingState();
  state.reservations = [{ jobId: '209900002' }];
  await assert.rejects(h.sandbox.refreshAppleQueueCapacity(state, source.windowId, source.id), /Network unavailable/);
  assert.equal((await h.sandbox.readAppleWithdrawalRecord(jobId)).outcome, 'unknown');
  assert.equal(h.data.appleSubmittedRoleReviews.latestScan.roles[0].jobId, jobId);
  assert.equal(state.reservations.length, 1);
  assert.equal(state.capacitySnapshot.complete, false);
});

test('resolved active withdrawal does not break ordinary passive count synchronization', async () => {
  const h = await harness();
  await h.sandbox.resolveAppleWithdrawalInventory(evidence([jobId], h.clock));
  const record = await h.sandbox.readAppleWithdrawalRecord(jobId);
  h.sandbox.chrome.tabs.sendMessage = async () => ({ ok: true, data: evidence([jobId], h.clock).passes[1].pages[0] });
  const state = await h.sandbox.readAppleRankingState();
  await h.sandbox.refreshAppleQueueCapacity(state, source.windowId, source.id, { passive: true });
  assert.equal(state.capacitySnapshot.complete, true);
  assert.equal(state.capacitySnapshot.roles[0].jobId, jobId);
  assert.equal((await h.sandbox.readAppleWithdrawalRecord(jobId)).reconciledAt, record.reconciledAt,
    'a passive count is not fresh retry permission');
  assert.equal(h.calls.created.length, 0);
});

test('contradictory passive active evidence revokes an inactive withdrawal receipt', async () => {
  const h = await harness();
  await h.sandbox.resolveAppleWithdrawalInventory(evidence([], h.clock));
  h.sandbox.chrome.tabs.sendMessage = async () => ({ ok: true, data: evidence([jobId], h.clock).passes[1].pages[0] });
  await h.sandbox.refreshAppleQueueCapacity(await h.sandbox.readAppleRankingState(), source.windowId, source.id, { passive: true });
  assert.equal((await h.sandbox.readAppleWithdrawalRecord(jobId)).outcome, 'unknown');
  await assert.rejects(h.sandbox.verifyAppleWithdrawalReceipt(h.identity), /not durably confirmed/);
});

test('a stale inactive receipt cannot authorize removing local active records', async () => {
  const h = await harness();
  await h.sandbox.resolveAppleWithdrawalInventory(evidence([], h.clock));
  assert.equal((await h.sandbox.verifyAppleWithdrawalReceipt(h.identity)).ok, true);
  h.clock.now += 61000;
  await assert.rejects(h.sandbox.verifyAppleWithdrawalReceipt(h.identity), /not durably confirmed/);
});

test('fresh background inventory uses the verified Submissions and Active menu selectors', async () => {
  const dom = createAppleWithdrawalDom();
  const content = createContentHarness({ url: source.url });
  dom.install(content);
  dom.document.querySelector('h2').textContent = 'Your favorite roles';
  const submissions = new dom.Node('button', { 'data-autom': 'Submissions' }, 'Submissions');
  const active = new dom.Node('button', { 'data-autom': 'Active' }, 'Active');
  const clicks = [];
  submissions.defaultAction = () => { clicks.push('Submissions'); dom.document.body.appendChild(active); };
  active.defaultAction = () => { clicks.push('Active'); dom.document.querySelector('h2').textContent = 'Your active submitted roles'; };
  dom.document.body.appendChild(submissions);
  await content.openAppleActiveSubmissionsForInventory();
  assert.deepEqual(clicks, ['Submissions', 'Active']);
  assert.equal(dom.calls.clicks.length, 0, 'view navigation cannot invoke Withdraw or Proceed');
});

test('an upgrade with saved submissions requires fresh reconciliation before a new batch can bypass legacy uncertainty', async () => {
  const h = createBackgroundHarness([{ ...source }]);
  await h.ready;
  h.data.appleSubmittedRoleReviews = { latestScan: { complete: true, roles: [role(jobId)] }, pages: {} };
  const review = { active: true, confirmed: true, batchId: 'new-batch', tabId: source.id,
    roles: [role(jobId)], reviewedAt: Date.now() };
  await assert.rejects(h.sandbox.setAppleWithdrawalBatch(review, {}), /Sync Submissions once after updating/);
  assert.equal(h.calls.created.length, 0);
  assert.equal(h.calls.messages.some(message => /WITHDRAW.*CLICK/.test(message.type)), false);
  const clock = { now: Date.now() };
  h.sandbox.Date = class extends Date { static now() { return clock.now; } };
  h.sandbox.waitForTabComplete = async () => {};
  h.sandbox.sendMessageWithFallback = async (_tabId, message) => {
    assert.equal(message.type, 'APPLE_CAREERS_GET_STABLE_SUBMITTED_HISTORY_INVENTORY');
    return { ok: true, data: evidence([jobId], clock) };
  };
  await h.sandbox.refreshAppleQueueCapacity(await h.sandbox.readAppleRankingState(), source.windowId, source.id);
  assert.equal(h.data.appleWithdrawalWorkflow.version, 1);
  assert.equal(h.calls.created.length, 1);
  assert.equal((await h.sandbox.setAppleWithdrawalBatch({ ...review, reviewedAt: ++clock.now }, {})).ok, true);
});
