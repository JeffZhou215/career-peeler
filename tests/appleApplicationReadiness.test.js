const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createContentHarness } = require('./helpers/appleWorkflowHarness.cjs');

function applicationShell() {
  const h = createContentHarness();
  let now = 0;
  const DateClass = Date;
  h.Date = class extends DateClass { static now() { return now; } };
  const button = { innerText: 'Submit', disabled: true, isConnected: true,
    getAttribute: name => name === 'disabled' && button.disabled ? '' : null,
    getBoundingClientRect: () => ({ width: 200, height: 40 }) };
  const spinner = { getBoundingClientRect: () => ({ width: 30, height: 30 }) };
  let loading = true, heading = 'Add Resume';
  h.document.getElementById = id => id === 'apply-step-continue-button' ? button : null;
  h.document.querySelector = selector => selector === 'h1' ? { innerText: heading } : null;
  h.document.querySelectorAll = selector => selector.startsWith('main ') ? loading ? [spinner] : []
    : selector.startsWith('[data-form-field-i18n-name]') ? [button] : [];
  h.getAlreadyAppliedSignal = () => null;
  h.findClickableByText = () => null;
  h.getRequiredFieldAuditControls = () => [];
  h.delay = async ms => { now += ms; };
  return { h, button, time: () => now, loading: value => { loading = value; }, heading: value => { heading = value; } };
}

test('a stable disabled Submit shell is not ready while Apple loads the saved resume', async () => {
  const f = applicationShell();
  const result = await f.h.waitForApplicationFormToSettle({ timeoutMs: 2000 });
  assert.equal(result.ready, false);
  assert.equal(f.time(), 2000);
});

test('readiness waits for delayed resume loading and an enabled Continue action', async () => {
  const f = applicationShell();
  // Drive the fake clock independently of reads, as a real timer would.
  let tick = 0;
  f.h.Date.now = () => tick;
  f.h.delay = async ms => {
    tick += ms;
    if (tick >= 12000) { f.loading(false); f.button.disabled = false; f.button.innerText = 'Continue'; }
  };
  const result = await f.h.waitForApplicationFormToSettle();
  assert.equal(result.ready, true);
  assert.ok(tick >= 13000, 'stable checks begin after the action is usable');
  assert.ok(tick < 30000);
});

test('a loader disappearing does not make a disabled action ready', async () => {
  const f = applicationShell();
  f.loading(false);
  assert.equal((await f.h.waitForApplicationFormToSettle({ timeoutMs: 2000 })).ready, false);
});

test('an enabled action beneath a visible loading indicator is not ready', async () => {
  const f = applicationShell();
  f.button.disabled = false;
  assert.equal((await f.h.waitForApplicationFormToSettle({ timeoutMs: 2000 })).ready, false);
});

test('loaded questions can be filled when Continue is disabled until required answers exist', async () => {
  const f = applicationShell();
  f.loading(false); f.button.innerText = 'Continue';
  f.h.getRequiredFieldAuditControls = () => [{ closest: () => ({ tagName: 'FORM' }) }];
  assert.equal((await f.h.waitForApplicationFormToSettle()).ready, true);
  assert.equal(f.button.disabled, true, 'readiness never enables or clicks the action');
  assert.equal(f.h.observationCalls.messages.length, 0);
});

test('SPA heading or primary-action changes reset the readiness stability window', async () => {
  const f = applicationShell();
  f.loading(false); f.button.disabled = false; f.button.innerText = 'Continue';
  let tick = 0;
  f.h.Date.now = () => tick;
  f.h.delay = async ms => { tick += ms; if (tick === 800) { f.heading('Profile Information'); f.button.innerText = 'Submit'; } };
  const result = await f.h.waitForApplicationFormToSettle();
  assert.equal(result.ready, true);
  assert.ok(tick >= 1800);
});

test('identity is checked throughout readiness polling and no action is issued', async () => {
  const f = applicationShell();
  let checks = 0;
  await assert.rejects(f.h.waitForApplicationFormToSettle({ assertObservationIdentity() {
    if (++checks === 3) throw new Error('Job identity changed');
  } }), /Job identity changed/);
  assert.equal(f.h.observationCalls.messages.length, 0);
});
