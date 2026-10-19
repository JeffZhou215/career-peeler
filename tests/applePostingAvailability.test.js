const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createContentHarness, createBackgroundHarness } = require('./helpers/appleWorkflowHarness.cjs');

const jobId = '200636174-0836';
const url = `https://jobs.apple.com/en-us/details/${jobId}/machine-learning-researcher-foundation-models?team=SFTWR`;
const unavailableText = 'Sorry, this role does not exist or is no longer available.';

// Structure observed on the live Apple posting; no application is opened.
function unavailablePage({ marker = true, heading = 'Page not found.', message = unavailableText,
  visible = true, postingWrapper = false } = {}) {
  const h = createContentHarness({ url });
  const container = { isConnected: true,
    querySelector: selector => selector === 'h1' ? { innerText: heading }
      : selector === 'p' ? { innerText: message } : null };
  const button = { isConnected: true, parentElement: container,
    getBoundingClientRect: () => ({ width: visible ? 200 : 0, height: visible ? 40 : 0 }) };
  h.document.querySelector = selector => selector === '#jobdetails-open-positions-button' ? marker ? button : null
    : selector === '#jobdetails-wrapper' ? postingWrapper ? {} : null : null;
  return h;
}

test('content recognizes the verified Apple unavailable-posting page without treating its URL as live details', async () => {
  const h = unavailablePage();
  const result = await h.dispatch({ type: 'APPLE_CAREERS_EXTRACT_SUBMITTED_ROLE_DETAILS' });
  assert.equal(result.data.jobId, jobId);
  assert.equal(result.data.ready, false);
  assert.equal(result.data.postingUnavailable, true);
  assert.equal(result.data.unavailableReason, unavailableText);
  assert.equal(h.observationCalls.messages.length, 0);
});

for (const [scenario, options] of [
  ['loading shell', { marker: false }],
  ['network failure', { message: 'We were unable to retrieve your information.' }],
  ['unrelated heading', { heading: 'Search Jobs' }],
  ['hidden stale notice', { visible: false }],
  ['a competing posting wrapper', { postingWrapper: true }]
]) {
  test(`content does not classify ${scenario} as a confirmed unavailable posting`, () => {
    assert.notEqual(unavailablePage(options).extractAppleSubmittedRoleDetails().postingUnavailable, true);
  });
}

async function pollFixture(responses, { currentUrl = url } = {}) {
  let reads = 0, clock = 0;
  const h = createBackgroundHarness([{ id: 1, windowId: 1, status: 'complete', url: currentUrl }], {
    sendMessage: async (_tabId, message) => {
      assert.equal(message.type, 'APPLE_CAREERS_EXTRACT_SUBMITTED_ROLE_DETAILS');
      const response = responses[Math.min(reads++, responses.length - 1)];
      if (response instanceof Error) throw response;
      return structuredClone(response);
    }
  });
  await h.ready;
  h.sandbox.Date = class extends Date { static now() { return clock; } };
  h.sandbox.delay = async ms => { clock += ms; };
  return { ...h, read: () => h.sandbox.waitForAppleSubmittedRoleDetails(1, jobId, 1500, { forApplication: true }),
    reads: () => reads };
}
const unavailable = { ok: true, data: { jobId, url, ready: false,
  postingUnavailable: true, unavailableReason: unavailableText } };
const ready = { ok: true, data: { jobId, url, ready: true, description: 'A verified job description.' } };

test('application detail polling reports a stable explicit unavailable page instead of an identity error', async () => {
  const h = await pollFixture([unavailable]);
  await assert.rejects(h.read(), error => error.code === 'job_unavailable' && /no longer available/i.test(error.message));
  assert.equal(h.reads(), 3);
});

test('a transient unavailable rerender can settle into the correct posting', async () => {
  const h = await pollFixture([unavailable, ready]);
  assert.equal((await h.read()).jobId, jobId);
  assert.equal(h.reads(), 2);
});

test('intervening loading resets unavailable-page stability observations', async () => {
  const h = await pollFixture([unavailable, unavailable,
    { ok: true, data: { jobId, url, ready: false } }, unavailable, ready]);
  assert.equal((await h.read()).jobId, jobId);
  assert.equal(h.reads(), 5);
});

test('a delayed description on the exact URL is read when ready', async () => {
  const h = await pollFixture([{ ok: true, data: { jobId, url, ready: false } }, ready]);
  assert.equal((await h.read()).description, ready.data.description);
});

test('an unfinished page remains unverified rather than being declared unavailable', async () => {
  const h = await pollFixture([{ ok: true, data: { jobId, url, ready: false } }]);
  await assert.rejects(h.read(), error => error.code === 'job_identity_unverified' && /description.*load/i.test(error.message));
});

test('contradictory unavailable and ready evidence never verifies the posting', async () => {
  const h = await pollFixture([{ ok: true, data: { ...ready.data, postingUnavailable: true } }]);
  await assert.rejects(h.read(), error => error.code === 'job_identity_unverified');
});

test('failed detail reads retain the actual failure reason without implying unavailable or submitted', async () => {
  const h = await pollFixture([{ ok: false, error: 'Synthetic Apple information retrieval failed.' }]);
  await assert.rejects(h.read(), error => error.code === 'job_identity_unverified' && /Synthetic Apple information retrieval failed/.test(error.message));
});

for (const scenario of ['different response job', 'different response URL', 'changed live tab']) {
  test(`application detail polling stops for ${scenario}`, async () => {
    const otherUrl = url.replace(jobId, '200636174-9999');
    const response = structuredClone(scenario === 'changed live tab' ? unavailable : ready);
    if (scenario === 'different response job') response.data.jobId = '200636174-9999';
    if (scenario === 'different response URL') response.data.url = otherUrl;
    const h = await pollFixture([response], { currentUrl: scenario === 'changed live tab' ? otherUrl : url });
    await assert.rejects(h.read(), error => error.code === 'job_identity_mismatch');
  });
}

test('submission-description callers preserve the existing null result for unavailable details', async () => {
  const h = await pollFixture([unavailable]);
  assert.equal(await h.sandbox.waitForAppleSubmittedRoleDetails(1, jobId, 1500), null);
});
