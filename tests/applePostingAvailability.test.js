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

function applicabilityPage(sequence = ['loading'], { frozenClock = false } = {}) {
  const h = unavailablePage();
  const unavailableSelector = h.document.querySelector;
  let position = 0, clock = 0, delays = 0;
  const mode = () => sequence[Math.min(position, sequence.length - 1)];
  const actions = Object.fromEntries(['submit', 'submitted', 'disabled'].map(state => [state, {
    tagName: 'A', isConnected: true, disabled: state === 'disabled',
    innerText: state === 'submitted' ? 'Submitted' : 'Submit Resume',
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 180, height: 40, top: 0 }),
    click() { throw new Error('A status check must never click an application control.'); }
  }]));
  Object.defineProperty(h.document.body, 'innerText', { get: () => mode() === 'auth'
    ? 'Please sign in to continue' : mode() === 'network' ? 'We were unable to retrieve your information.' : '' });
  h.document.querySelector = selector => {
    if (selector === '#jobdetails-open-positions-button') return mode() === 'unavailable' ? unavailableSelector(selector) : null;
    if (selector === '#jobdetails-wrapper') return null;
    if (selector.startsWith('#jobdetails-jobdescription')) throw new Error('Applicability must not require description extraction.');
    return null;
  };
  h.document.querySelectorAll = selector => [
    "button, input[type='button'], input[type='submit'], a, [role='button']",
    "button, [role='button'], a, [aria-label], span, div"
  ].includes(selector) && actions[mode()] ? [actions[mode()]] : [];
  h.Date = class extends Date { static now() { return clock; } };
  h.delay = async ms => {
    delays += 1;
    if (!frozenClock) clock += ms;
    position += 1;
    if (mode() === 'mismatched') h.window.location = new URL(url.replace(jobId, '200636174-9999'));
  };
  return { h, read: () => h.dispatch({ type: 'APPLE_CAREERS_EXTRACT_JOB', verifyApplicability: true, expectedJobId: jobId }),
    delays: () => delays };
}

test('applicability confirms Submitted immediately without descriptions or inventory navigation', async () => {
  const fixture = applicabilityPage(['submitted']);
  const result = await fixture.read();
  assert.equal(result.ok, true);
  assert.equal(result.data.jobId, jobId);
  assert.equal(result.data.identityVerified, true);
  assert.equal(result.data.alreadySubmitted, true);
  assert.equal(result.data.canApply, false);
  assert.equal(result.data.postingUnavailable, false);
  assert.equal(fixture.delays(), 0);
  assert.equal(fixture.h.observationCalls.messages.length, 0);
});

test('applicability confirms an enabled Submit Resume control before descriptions load', async () => {
  const fixture = applicabilityPage(['submit']);
  const result = await fixture.read();
  assert.equal(result.ok, true);
  assert.equal(result.data.canApply, true);
  assert.equal(result.data.alreadySubmitted, false);
  assert.equal(fixture.delays(), 0);
});

test('applicability requires three exact unavailable-page observations', async () => {
  const fixture = applicabilityPage(['unavailable']);
  const result = await fixture.read();
  assert.equal(result.ok, true);
  assert.equal(result.data.postingUnavailable, true);
  assert.equal(result.data.errorType, 'job_unavailable');
  assert.equal(result.data.canApply, false);
  assert.equal(result.data.alreadySubmitted, false);
  assert.equal(fixture.delays(), 2);
});

test('applicability resets transient unavailable observations and accepts a settled apply control', async () => {
  const fixture = applicabilityPage(['unavailable', 'unavailable', 'loading', 'unavailable', 'unavailable', 'submit']);
  const result = await fixture.read();
  assert.equal(result.data.canApply, true);
  assert.equal(result.data.postingUnavailable, false);
  assert.equal(fixture.delays(), 5);
});

for (const state of ['loading', 'network', 'disabled']) {
  test(`applicability leaves a ${state} page unknown instead of removed or submitted`, async () => {
    const fixture = applicabilityPage([state]);
    const result = await fixture.read();
    assert.equal(result.ok, true);
    assert.equal(result.data.postingUnavailable, false);
    assert.equal(result.data.alreadySubmitted, false);
    assert.equal(result.data.canApply, false);
    assert.equal(fixture.delays(), 20);
  });
}

test('applicability observes a delayed Submitted control without waiting for a description', async () => {
  const fixture = applicabilityPage(['loading', 'loading', 'submitted']);
  const result = await fixture.read();
  assert.equal(result.data.alreadySubmitted, true);
  assert.equal(fixture.delays(), 2);
});

test('applicability stops when authentication is lost during polling', async () => {
  const fixture = applicabilityPage(['unavailable', 'auth']);
  const result = await fixture.read();
  assert.equal(result.data.errorType, 'session_or_login_required');
  assert.equal(result.data.postingUnavailable, false);
  assert.equal(result.data.canApply, false);
  assert.equal(fixture.delays(), 1);
});

test('applicability never accepts unavailable evidence after the exact job identity changes', async () => {
  const fixture = applicabilityPage(['unavailable', 'mismatched']);
  const result = await fixture.read();
  assert.equal(result.ok, false);
  assert.equal(result.data.errorType, 'job_identity_mismatch');
  assert.equal(fixture.delays(), 1);
});

test('applicability polling is bounded even if the clock does not advance', async () => {
  const fixture = applicabilityPage(['loading'], { frozenClock: true });
  const result = await fixture.read();
  assert.equal(result.data.canApply, false);
  assert.equal(result.data.postingUnavailable, false);
  assert.equal(fixture.delays(), 20);
});

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
