const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness, createContentHarness } = require("./helpers/appleWorkflowHarness.cjs");

// Exercise the actual action helpers with connected DOM-like nodes and the real
// durable permission handler. No Apple pages or network requests are involved.
async function fixture(label = "Continue") {
  const job = { jobId: "200123456-0836", title: "Offline Action Race",
    url: "https://jobs.apple.com/app/en-us/apply/200123456-0836" };
  const h = createBackgroundHarness();
  await h.ready;
  const sessionId = await h.sandbox.claimAppleApplicationSession([job], { sourceTabId: 1, sourceWindowId: 1 });
  const stepId = await h.sandbox.checkpointAppleWorkflowStep(sessionId, job, 1);
  const content = createContentHarness({ url: job.url });
  const config = content.getSiteConfig();
  const calls = { permissions: [], clicks: [] };
  const node = text => ({ id: config.primaryActionId, tagName: "BUTTON", innerText: text,
    isConnected: true, disabled: false, getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 180, height: 40, top: 0 }), scrollIntoView() {},
    click() {
      assert.equal(this.isConnected, true, "a detached control must never be clicked");
      assert.equal(current, this, "a replaced control must never be clicked");
      assert.equal(this.disabled, false, "a disabled control must never be clicked");
      const pending = h.data.appleApplicationWorkflow.jobs[job.jobId];
      if (this.innerText === "Submit") {
        assert.equal(pending.submissionOutcome, "unknown", "Submit needs durable unknown intent before the click");
        assert.equal(pending.submissionAttemptCount, 1, "Submit needs exactly one durable permission");
        assert.equal(calls.permissions.at(-1), "submit", "a form permission cannot authorize Submit");
      }
      calls.clicks.push({ node: this, label: this.innerText });
    } });
  let current = node(label);
  const original = current;
  content.document.getElementById = id => id === config.primaryActionId ? current : null;
  content.document.querySelectorAll = selector => /button|input\[type=/.test(selector) ? [current] : [];
  content.getAlreadyAppliedSignal = () => null;
  content.getVisibleValidationErrors = () => [];
  content.waitForSubmissionOutcome = async () => ({ type: "submitted", signal: { text: "Application submitted" } });
  content.chrome.runtime.sendMessage = message => {
    if (message.type === "APPLE_CAREERS_AUTHORIZE_WORKFLOW_ACTION") calls.permissions.push(message.action);
    return h.sandbox.dispatch(message, { tab: h.tabs[0] });
  };
  const sendToTab = h.sandbox.chrome.tabs.sendMessage;
  h.sandbox.chrome.tabs.sendMessage = (tabId, message) => message.type === "APPLE_CAREERS_REVOKE_WORKFLOW"
    ? content.dispatch(message) : sendToTab(tabId, message);
  const options = { expectedJobId: job.jobId, workflowSessionId: sessionId, workflowStepId: stepId,
    assertIdentity() {}, async assertSavedAnswers() {} };
  options.assertOwnership = kind => content.assertAppleWorkflowOwnership(options, kind);
  const steps = [];
  const replace = text => { current.isConnected = false; current = node(text); return current; };
  return { h, content, config, calls, options, steps, original, replace,
    current: () => current, primary: () => content.clickPrimaryAction(config, steps, options) };
}

async function allowSafeStop(action) {
  try { return await action(); }
  catch (error) {
    if (!["workflow_action_changed", "workflow_owner_revoked"].includes(error.code)) throw error;
    return { pausedForReview: true, errorType: error.code };
  }
}

for (const phase of ["saved-answer audit", "ownership reply"]) {
  test(`Continue becoming Submit during ${phase} cannot use form permission or be logged as Continue`, async () => {
    const f = await fixture();
    if (phase === "saved-answer audit") f.options.assertSavedAnswers = async () => { f.current().innerText = "Submit"; };
    else {
      const authorize = f.options.assertOwnership;
      f.options.assertOwnership = async kind => {
        await authorize(kind);
        if (!kind || kind === "form") f.current().innerText = "Submit";
      };
    }
    const result = await allowSafeStop(f.primary);
    if (f.calls.clicks.length) {
      assert.equal(f.calls.clicks.length, 1);
      assert.equal(f.calls.clicks[0].label, "Submit");
      assert.ok(f.steps.some(step => step.step === "Submit application" && step.status === "clicked"));
      assert.equal(f.steps.some(step => step.step === "Continue application step" && step.status === "clicked"), false);
      assert.equal(result.submissionOutcome, "confirmed");
    } else assert.equal(result.pausedForReview, true);
  });
}

test("a primary node replaced during saved-answer audit is never clicked through its stale reference", async () => {
  const f = await fixture();
  f.options.assertSavedAnswers = async () => { f.replace("Continue"); };
  await allowSafeStop(f.primary);
  assert.equal(f.calls.clicks.some(call => call.node === f.original), false);
});

test("a primary disabled during saved-answer audit is not clicked", async () => {
  const f = await fixture();
  f.options.assertSavedAnswers = async () => { f.current().disabled = true; };
  await allowSafeStop(f.primary);
  assert.equal(f.calls.clicks.length, 0);
});

test("a final Submit node replaced after its permission reply is never clicked through its stale reference", async () => {
  const f = await fixture("Submit");
  let audits = 0;
  f.options.assertSavedAnswers = async () => { if (++audits === 2) f.replace("Submit"); };
  await allowSafeStop(() => f.content.clickAndDetectSubmission(f.original, f.steps, f.options));
  assert.equal(f.calls.clicks.length, 0);
  assert.equal(f.h.data.appleApplicationWorkflow.jobs[f.options.expectedJobId].submissionAttemptCount <= 1, true);
});

test("a final Submit becoming Continue after permission cannot click the changed action", async () => {
  const f = await fixture("Submit");
  let audits = 0;
  f.options.assertSavedAnswers = async () => { if (++audits === 2) f.current().innerText = "Continue"; };
  await allowSafeStop(() => f.content.clickAndDetectSubmission(f.original, f.steps, f.options));
  assert.equal(f.calls.clicks.length, 0);
});

for (const mutation of ["Submit", "replaced", "disabled"]) {
  test(`fallback Continue rechecks ${mutation} after its saved-answer audit`, async () => {
    const f = await fixture();
    f.options.assertSavedAnswers = async () => {
      if (mutation === "replaced") f.replace("Continue");
      else if (mutation === "disabled") f.current().disabled = true;
      else f.current().innerText = "Submit";
    };
    await allowSafeStop(() => f.content.clickAction(/^continue$/i, "Continue application step", f.steps,
      { ...f.options, timeoutMs: 100, afterClickDelayMs: 1 }));
    assert.equal(f.calls.clicks.length, 0);
    assert.equal(f.h.data.appleApplicationWorkflow.jobs[f.options.expectedJobId].submissionAttemptCount, 0);
  });
}

for (const action of ["Submit", "primary Continue", "fallback Continue"]) {
  test(`workflow revocation during the final saved-answer audit blocks ${action}`, async () => {
    const f = await fixture(action === "Submit" ? "Submit" : "Continue");
    let audits = 0;
    f.options.assertSavedAnswers = async () => {
      // Final Submit audits once before permission and once after permission.
      // Continue audits after its ordinary form permission has returned.
      if (++audits === (action === "Submit" ? 2 : 1)) await f.h.sandbox.cancelAppleApplicationSession();
    };
    const invoke = action === "Submit"
      ? () => f.content.clickAndDetectSubmission(f.original, f.steps, f.options)
      : action === "primary Continue" ? f.primary
        : () => f.content.clickAction(/^continue$/i, "Continue application step", f.steps,
          { ...f.options, timeoutMs: 100, afterClickDelayMs: 1 });
    const result = await allowSafeStop(invoke);
    assert.equal(f.h.data.appleApplicationWorkflow.status, "cancelled");
    assert.equal(f.h.data.appleApplicationWorkflow.stopRequested, true);
    assert.equal(f.calls.clicks.length, 0, "a revoked permission cannot authorize an action after the audit returns");
    assert.equal(result.pausedForReview, true);
    assert.equal(result.errorType, "workflow_owner_revoked");
    assert.equal(f.h.data.appleApplicationWorkflow.jobs[f.options.expectedJobId].submissionAttemptCount,
      action === "Submit" ? 1 : 0, "revocation cannot grant another Submit permission");
  });
}

test("primary-action fallback preserves revocation identity during the final saved-answer audit", async () => {
  const f = await fixture("Continue");
  // Exercise the wrapper that builds fallback options, rather than passing the
  // complete workflow identity directly to clickAction as the unit tests do.
  f.content.findPrimaryActionButton = () => null;
  f.content.clickFinalSubmit = async () => ({ clicked: false, done: false, pending: false });
  f.options.assertSavedAnswers = async () => { await f.h.sandbox.cancelAppleApplicationSession(); };
  const result = await allowSafeStop(f.primary);
  assert.equal(f.h.data.appleApplicationWorkflow.status, "cancelled");
  assert.equal(f.h.data.appleApplicationWorkflow.stopRequested, true);
  assert.equal(f.calls.clicks.length, 0, "fallback option construction cannot discard the revoked workflow identity");
  assert.equal(result.pausedForReview, true);
  assert.equal(result.errorType, "workflow_owner_revoked");
  assert.equal(f.h.data.appleApplicationWorkflow.jobs[f.options.expectedJobId].submissionAttemptCount, 0);
});
