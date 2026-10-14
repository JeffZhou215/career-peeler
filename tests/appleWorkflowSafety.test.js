const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../lib/core.js");
const { createContentHarness, createBackgroundHarness, radioQuestion, installQuestions } = require("./helpers/appleWorkflowHarness.cjs");

test("work eligibility resolver uses explicit saved No answers without an LLM", async () => {
  for (const questionText of ["Are you legally authorized to work in the United States?", "Will you require visa sponsorship?"]) {
    const result = await core.resolveApplicationQuestion({ questionText, options: ["Yes", "No"], fieldKind: "option_group",
      userProfile: { workAuthorized: "no", requiresSponsorship: "no" } });
    assert.equal(result.ok, true);
    assert.equal(result.data.value, "No");
  }
});

test("missing saved eligibility stops instead of guessing or invoking an LLM", async () => {
  for (const questionText of ["Are you authorized to work?", "Do you require visa sponsorship?"]) {
    const result = await core.resolveApplicationQuestion({ questionText, options: ["Yes", "No"], fieldKind: "option_group", userProfile: {} });
    assert.equal(result.ok, false);
    assert.match(result.error, /saved|save|review/i);
  }
});

test("categorical right-to-work status cannot be inferred from saved Yes", async () => {
  const result = await core.resolveApplicationQuestion({ questionText: "Current right-to-work status in Singapore", options: ["Singapore Citizen", "Singapore Permanent Resident", "Foreigner"], fieldKind: "select",
    userProfile: { workAuthorized: "yes" } });
  assert.equal(result.ok, false);
});

test("Apple questionnaire selects saved No for authorization and sponsorship", async () => {
  const sandbox = createContentHarness();
  const authorization = radioQuestion("Are you legally authorized to work?");
  const sponsorship = radioQuestion("Will you require visa sponsorship?");
  installQuestions(sandbox, [authorization, sponsorship]);
  const result = await sandbox.answerQuestionnaire([], { workAuthorized: "no", requiresSponsorship: "no" });
  assert.equal(result.unresolvedReason || null, null);
  assert.equal(authorization.radios[1].checked, true);
  assert.equal(sponsorship.radios[1].checked, true);
  assert.equal(authorization.radios[0].clicks + sponsorship.radios[0].clicks, 0);
});

test("conflicting Apple answers are preserved and surfaced for review", async () => {
  const sandbox = createContentHarness();
  const question = radioQuestion("Are you authorized to work?", "no");
  installQuestions(sandbox, [question]);
  const result = await sandbox.answerQuestionnaire([], { workAuthorized: "yes" });
  assert.match(result.unresolvedReason, /conflict|different|review/i);
  assert.equal(question.radios[1].checked, true);
  assert.equal(question.radios.reduce((sum, option) => sum + option.clicks, 0), 0);
});

test("saved Yes/No answers are independent and existing matching answers are not clicked", async () => {
  const sandbox = createContentHarness();
  const authorization = radioQuestion("Are you authorized to work?", "yes");
  const sponsorship = radioQuestion("Do you require sponsorship for employment?");
  installQuestions(sandbox, [authorization, sponsorship]);
  const result = await sandbox.answerQuestionnaire([], { workAuthorized: "yes", requiresSponsorship: "no" });
  assert.equal(result.unresolvedReason || null, null);
  assert.equal(authorization.radios.reduce((sum, option) => sum + option.clicks, 0), 0);
  assert.equal(sponsorship.radios[1].checked, true);
});

test("missing or unmappable saved answers never fall through to LLM screening choices", async () => {
  for (const questionText of ["Are you authorized to work?", "Do you require visa sponsorship?"]) {
    const result = await core.resolveApplicationQuestion({ questionText, options: ["Yes"], fieldKind: "select",
      userProfile: { workAuthorized: "no", requiresSponsorship: "no", llmEnabled: true, llmApiKey: "not-a-real-key" } });
    assert.equal(result.ok, false);
    assert.match(result.error, /explicit saved|review/i);
  }
});

test("the legacy sponsorship fallback also refuses an unset answer", async () => {
  const sandbox = createContentHarness();
  const question = radioQuestion("Do you require visa sponsorship?");
  installQuestions(sandbox, [question]);
  const result = await sandbox.clickSponsorshipAnswer([], {});
  assert.match(result.unresolvedReason, /explicit.*sponsorship/i);
  assert.equal(question.radios.reduce((sum, option) => sum + option.clicks, 0), 0);
});

test("negative, historical, and visa-status wording is unresolved rather than mapped to a saved Yes/No", async () => {
  for (const questionText of ["Are you not authorized to work?", "Do you already hold a work visa?",
    "Have you ever required visa sponsorship?", "Are you authorized to work without sponsorship?"]) {
    const result = await core.resolveApplicationQuestion({ questionText, options: ["Yes", "No"],
      userProfile: { workAuthorized: "yes", requiresSponsorship: "yes" } });
    assert.equal(result.ok, false, questionText);
  }
});

test("native select uses and verifies only the saved answer, preserving conflicts", async () => {
  for (const selected of ["", "yes", "no"]) {
    const sandbox = createContentHarness();
    const question = radioQuestion("Are you authorized to work?");
    const events = [];
    const select = { tagName: "SELECT", options: [{ textContent: "Select", value: "" },
      { textContent: "Yes", value: "yes" }, { textContent: "No", value: "no" }],
      selectedIndex: selected === "yes" ? 1 : selected === "no" ? 2 : 0,
      getAttribute: () => null, getBoundingClientRect: () => ({ width: 200, height: 30 }),
      dispatchEvent: event => events.push(event) };
    Object.defineProperty(select, "value", { get() { return this.options[this.selectedIndex].value; },
      set(value) { this.selectedIndex = this.options.findIndex(option => option.value === value); } });
    question.container.querySelectorAll = selector => selector === "select" ? [select] : [];
    const result = await sandbox.answerSavedWorkQuestion(question.container, [], { workAuthorized: "no" });
    assert.equal(select.value, selected === "yes" ? "yes" : "no");
    assert.equal(Boolean(result.unresolvedReason), selected === "yes");
    assert.equal(events.length, selected === "" ? 2 : 0);
  }
});

test("custom dropdown picks only an offered saved answer and verifies the displayed selection", async () => {
  for (const offeredNo of [true, false]) {
    const sandbox = createContentHarness();
    const question = radioQuestion("Will you require visa sponsorship?");
    const control = { innerText: "Select" };
    let clicks = 0;
    const option = { innerText: offeredNo ? "No" : "Yes", getAttribute: () => null,
      scrollIntoView() {}, click() { clicks++; control.innerText = this.innerText; } };
    question.container.querySelector = () => control;
    question.container.querySelectorAll = selector => selector.includes("combobox") ? [control] : [];
    sandbox.openAndReadAgentDropdownOptions = async () => [option];
    const result = await sandbox.answerSavedWorkQuestion(question.container, [], { requiresSponsorship: "no" });
    assert.equal(clicks, offeredNo ? 1 : 0);
    assert.equal(Boolean(result.unresolvedReason), !offeredNo);
  }
});

function submitFixture(sandbox, outcome = null) {
  let clicks = 0;
  sandbox.waitForSubmissionOutcome = async () => outcome;
  sandbox.getVisibleValidationErrors = () => [];
  sandbox.getLoadingSignal = () => null;
  const button = { innerText: "Submit", value: "", getAttribute: () => null,
    scrollIntoView() {}, click() { clicks++; } };
  return { button, clicks: () => clicks };
}

test("a still-loading Submit result is unknown and pauses instead of entering another click iteration", async () => {
  const sandbox = createContentHarness();
  const fixture = submitFixture(sandbox);
  sandbox.getLoadingSignal = () => "Submitting…";
  const result = await sandbox.clickAndDetectSubmission(fixture.button, []);
  assert.equal(fixture.clicks(), 1);
  assert.equal(result.pausedForReview, true);
  assert.equal(result.pending, false);
  assert.equal(result.submissionOutcome, "unknown");
});

test("the final Submit cap is checked before clicking, including the primary-button path", async () => {
  const sandbox = createContentHarness();
  const fixture = submitFixture(sandbox);
  sandbox.findPrimaryActionButton = () => fixture.button;
  const result = await sandbox.clickPrimaryAction({ finalSubmitPattern: /^submit$/i }, [],
    { submissionAttemptCount: 3, submissionOutcome: "rejected" });
  assert.equal(fixture.clicks(), 0);
  assert.equal(result.errorType, "submission_retry_limit");
});

test("a repeated request cannot click again while the same page's Submit outcome is unknown", async () => {
  const sandbox = createContentHarness();
  const fixture = submitFixture(sandbox);
  const first = await sandbox.clickAndDetectSubmission(fixture.button, []);
  const second = await sandbox.clickAndDetectSubmission(fixture.button, []);
  assert.equal(first.submissionOutcome, "unknown");
  assert.equal(second.submissionOutcome, "unknown");
  assert.equal(fixture.clicks(), 1);
});

test("concurrent workflow requests reserve only one final Submit", async () => {
  const sandbox = createContentHarness();
  const fixture = submitFixture(sandbox);
  const results = await Promise.all([sandbox.clickAndDetectSubmission(fixture.button, []),
    sandbox.clickAndDetectSubmission(fixture.button, [])]);
  assert.equal(fixture.clicks(), 1);
  assert.ok(results.every(result => result.submissionOutcome === "unknown"));
});

test("unknown prior outcome and unanswered fields alone never authorize a retry", async () => {
  const sandbox = createContentHarness();
  const fixture = submitFixture(sandbox);
  sandbox.auditRequiredApplicationFields = () => ({ unanswered: [{ label: "Required answer" }], totalRequired: 1 });
  const first = await sandbox.clickAndDetectSubmission(fixture.button, []);
  assert.equal(first.submissionOutcome, "unknown");
  await sandbox.clickAndDetectSubmission(fixture.button, [], { submissionAttemptCount: 1, submissionOutcome: "unknown" });
  assert.equal(fixture.clicks(), 1);
});

test("unknown metadata cannot be overridden by a stale local rejection or a missing count", async () => {
  for (const staleRejection of [true, false]) {
    const sandbox = createContentHarness();
    const fixture = submitFixture(sandbox, { type: "validation", errors: ["Rejected"] });
    if (staleRejection) await sandbox.clickAndDetectSubmission(fixture.button, []);
    const priorClicks = fixture.clicks();
    const result = await sandbox.clickAndDetectSubmission(fixture.button, [],
      { submissionAttemptCount: staleRejection ? 2 : 0, submissionOutcome: "unknown" });
    assert.equal(result.submissionOutcome, "unknown");
    assert.equal(fixture.clicks(), priorClicks);
  }
});

test("only explicit validation rejection permits another Submit, and never more than three", async () => {
  const sandbox = createContentHarness();
  const fixture = submitFixture(sandbox, { type: "validation", errors: ["Required answer is missing"] });
  for (let index = 0; index < 3; index++) {
    const result = await sandbox.clickAndDetectSubmission(fixture.button, []);
    assert.equal(result.submissionOutcome, "rejected");
  }
  const blocked = await sandbox.clickAndDetectSubmission(fixture.button, []);
  assert.equal(blocked.errorType, "submission_retry_limit");
  assert.equal(blocked.submissionOutcome, "rejected");
  assert.equal(fixture.clicks(), 3);
});

test("confirmed submission is distinct from rejection and cannot be replayed", async () => {
  const sandbox = createContentHarness();
  const fixture = submitFixture(sandbox, { type: "submitted", signal: { text: "Application submitted" } });
  const confirmed = await sandbox.clickAndDetectSubmission(fixture.button, []);
  assert.equal(confirmed.done, true);
  assert.equal(confirmed.submissionOutcome, "confirmed");
  const repeated = await sandbox.clickAndDetectSubmission(fixture.button, []);
  assert.equal(repeated.alreadySubmitted, true);
  assert.equal(fixture.clicks(), 1);
});

test("a generic network alert is not evidence that Submit was rejected", async () => {
  const sandbox = createContentHarness();
  const alert = { innerText: "Network connection timed out. Try again.", className: "",
    getBoundingClientRect: () => ({ width: 200, height: 30 }) };
  sandbox.document.querySelectorAll = selector => selector === "[role='alert']" ? [alert] : [];
  sandbox.getSubmittedSignal = () => null;
  sandbox.getAlreadyAppliedSignal = () => null;
  const result = await sandbox.waitForSubmissionOutcome({ timeoutMs: 1 });
  assert.equal(result, null);
});

test("observed field-validation feedback is a confirmed rejection signal", async () => {
  const sandbox = createContentHarness();
  const alert = { innerText: "This answer is required.", className: "ud-formily-item-feedback-error",
    getBoundingClientRect: () => ({ width: 200, height: 30 }) };
  sandbox.document.querySelectorAll = selector => selector.includes("feedback-error") ? [alert] : [];
  sandbox.getSubmittedSignal = () => null;
  sandbox.getAlreadyAppliedSignal = () => null;
  const result = await sandbox.waitForSubmissionOutcome({ timeoutMs: 10 });
  assert.equal(result.type, "validation");
  assert.equal(result.errors[0], alert.innerText);
});

test("existing validation feedback is recovered before any final Submit click", async () => {
  const sandbox = createContentHarness();
  const fixture = submitFixture(sandbox);
  sandbox.getVisibleValidationErrors = () => ["A required field is missing"];
  const result = await sandbox.clickAndDetectSubmission(fixture.button, []);
  assert.equal(fixture.clicks(), 0);
  assert.equal(result.submissionOutcome, "not_attempted");
  assert.equal(result.errorType, "blocked_by_validation");
});

function mockStep(harness, response) {
  harness.sandbox.chrome.tabs.sendMessage = async (_id, message) => {
    if (message.type === "APPLE_CAREERS_VERIFY_WORKFLOW_IDENTITY") return { ok: true,
      data: { identityVerified: true, expectedJobId: message.expectedJobId, url: harness.tabs[0].url } };
    harness.calls.messages.push(message);
    const result = typeof response === "function" ? await response(message) : structuredClone(response);
    if (result?.data) {
      result.data.identityVerified ??= true;
      result.data.expectedJobId ??= message.expectedJobId;
    }
    return result;
  };
}

function actionablePage(sandbox) {
  let actions = 0;
  sandbox.getSessionRequiredSignal = () => null;
  sandbox.getAlreadyAppliedSignal = () => null;
  sandbox.getSubmittedSignal = () => null;
  sandbox.waitForApplicationFormToSettle = async () => ({ ready: true });
  sandbox.findPrimaryActionButton = () => ({ innerText: "Continue" });
  sandbox.getLoadingSignal = () => null;
  sandbox.clickPrimaryAction = async () => { actions++; return { clicked: true, done: false, summary: "Continued" }; };
  return () => actions;
}

test("content refuses an application step belonging to a different or unverified role", async () => {
  for (const url of ["https://jobs.apple.com/app/en-us/apply/200987654-0836", "https://jobs.apple.com/app/en-us/profile/info"]) {
    const sandbox = createContentHarness();
    const actions = actionablePage(sandbox);
    sandbox.window.location = new URL(url);
    const result = await sandbox.runApplicationWorkflowStep({ expectedJobId: "200123456-0836" });
    assert.equal(actions(), 0);
    assert.match(result.errorType, /job_identity/);
    assert.equal(result.done, false);
  }
});

test("job identity is re-read after awaiting the application form", async () => {
  const sandbox = createContentHarness();
  const actions = actionablePage(sandbox);
  sandbox.waitForApplicationFormToSettle = async () => {
    sandbox.window.location = new URL("https://jobs.apple.com/app/en-us/apply/200987654-0836");
    return { ready: true };
  };
  const result = await sandbox.runApplicationWorkflowStep({ expectedJobId: "200123456-0836" });
  assert.equal(actions(), 0);
  assert.equal(result.errorType, "job_identity_mismatch");
});

test("background binds initial tab identity to the selected role before any workflow command", async () => {
  const harness = createBackgroundHarness();
  await harness.ready;
  mockStep(harness, { ok: true, data: { url: harness.tabs[0].url, done: true, steps: [], summary: "Submitted" } });
  const result = await harness.sandbox.runApplicationWorkflow(harness.tabs[0], { closeOnDone: false,
    jobContext: { jobId: "200987654-0836" }, userProfile: {} });
  assert.equal(result.ok, false);
  assert.match(result.data.errorType, /job_identity/);
  assert.equal(harness.calls.messages.length, 0);
  assert.equal(harness.calls.checkpoints.length, 0);
});

test("workflow messages expose only explicit eligibility answers, never the API key or resume/profile", async () => {
  const harness = createBackgroundHarness();
  await harness.ready;
  mockStep(harness, { ok: true, data: { url: harness.tabs[0].url, clicked: false, done: false,
    pausedForReview: true, steps: [], summary: "Synthetic manual review", submissionOutcome: "not_attempted" } });
  await harness.sandbox.runApplicationWorkflow(harness.tabs[0], { closeOnDone: false, userProfile: {
    workAuthorized: "no", requiresSponsorship: "yes", llmApiKey: "synthetic-private-key",
    resumeText: "Synthetic private resume evidence", firstName: "Private Candidate"
  } });
  assert.equal(harness.calls.messages.length, 1);
  const message = harness.calls.messages[0];
  assert.deepEqual(structuredClone(message.applicationAnswers), { workAuthorized: "no", requiresSponsorship: "yes" });
  assert.equal(message.expectedJobId, "200123456-0836");
  assert.doesNotMatch(JSON.stringify(message), /synthetic-private-key|Synthetic private resume|Private Candidate/);
  assert.equal(message.userProfile, undefined);
});

test("background rechecks identity between application stages and never checkpoints another job", async () => {
  const harness = createBackgroundHarness();
  await harness.ready;
  mockStep(harness, () => {
    const url = harness.tabs[0].url;
    harness.tabs[0].url = "https://jobs.apple.com/app/en-us/apply/200987654-0836";
    return { ok: true, data: { url, clicked: true, done: false,
      steps: [{ step: "Continue application step", status: "clicked" }], summary: "Continued" } };
  });
  const result = await harness.sandbox.runApplicationWorkflow(harness.tabs[0], { closeOnDone: false,
    jobContext: { jobId: "200123456-0836" }, userProfile: {} });
  assert.equal(result.ok, false);
  assert.equal(result.data.errorType, "job_identity_mismatch");
  assert.equal(harness.calls.messages.length, 1);
  assert.equal(harness.calls.checkpoints.length, 0);
});

test("background pauses an unknown/pending Submit response before a second workflow iteration", async () => {
  const harness = createBackgroundHarness();
  await harness.ready;
  mockStep(harness, { ok: true, data: { url: harness.tabs[0].url, clicked: true, done: false, pending: true,
    steps: [{ step: "Submit application", status: "clicked" }], summary: "Loading" } });
  const result = await harness.sandbox.runApplicationWorkflow(harness.tabs[0], { closeOnDone: false, userProfile: {} });
  assert.equal(harness.calls.messages.length, 1);
  assert.equal(result.data.submissionOutcome, "unknown");
  assert.equal(result.data.submissionOutcomeUnknown, true);
  assert.equal(result.data.pausedForReview, true);
  assert.equal(harness.calls.checkpoints.length, 0);
});

test("a lost workflow reply is unknown and the mutating command is never reinjected or replayed", async () => {
  const harness = createBackgroundHarness();
  await harness.ready;
  mockStep(harness, () => { throw new Error("The message port closed after an action."); });
  const result = await harness.sandbox.runApplicationWorkflow(harness.tabs[0], { closeOnDone: false, userProfile: {} });
  assert.equal(harness.calls.messages.length, 1);
  assert.equal(harness.calls.injected.length, 0);
  assert.equal(result.data.submissionOutcome, "unknown");
  assert.equal(result.data.submissionOutcomeUnknown, true);
});

test("the actual content workflow stops before Continue/Submit when a saved answer is missing", async () => {
  const sandbox = createContentHarness();
  const actions = actionablePage(sandbox);
  const question = radioQuestion("Work Authorization");
  installQuestions(sandbox, [question]);
  const result = await sandbox.runApplicationWorkflowStep({ expectedJobId: "200123456-0836", applicationAnswers: {} });
  assert.equal(result.errorType, "work_eligibility_unresolved");
  assert.equal(actions(), 0);
  assert.equal(question.radios.reduce((sum, option) => sum + option.clicks, 0), 0);
});

test("identity is checked immediately before a delayed Continue click", async () => {
  const sandbox = createContentHarness();
  const fixture = submitFixture(sandbox);
  fixture.button.innerText = "Continue";
  sandbox.findPrimaryActionButton = () => fixture.button;
  sandbox.delay = async () => { sandbox.window.location = new URL("https://jobs.apple.com/app/en-us/apply/200987654-0836"); };
  await assert.rejects(() => sandbox.clickPrimaryAction({ finalSubmitPattern: /^submit$/ }, [], {
    assertIdentity: () => sandbox.assertAppleWorkflowIdentity({ expectedJobId: "200123456-0836" })
  }), /job identity changed/i);
  assert.equal(fixture.clicks(), 0);
});

test("identity is checked after an agent reply and before any field write", async () => {
  const sandbox = createContentHarness();
  let writes = 0;
  sandbox.readAgentChoiceDescriptor = () => ({ kind: "select", label: "Required Answer", element: {}, options: ["Example"] });
  sandbox.requestApplicationQuestionDecision = async () => {
    sandbox.window.location = new URL("https://jobs.apple.com/app/en-us/apply/200987654-0836");
    return { action: "choose_option", value: "Example" };
  };
  sandbox.setNativeSelectValues = () => { writes++; return true; };
  await assert.rejects(() => sandbox.answerAdditionalChoiceQuestions([], {
    assertIdentity: () => sandbox.assertAppleWorkflowIdentity({ expectedJobId: "200123456-0836" })
  }), /job identity changed/i);
  assert.equal(writes, 0);
});

test("both required-field recovery call paths retain the job identity guard", async () => {
  for (const rejected of [true, false]) {
    const sandbox = createContentHarness();
    actionablePage(sandbox);
    sandbox.clickPrimaryAction = async () => rejected
      ? { clicked: true, done: false, errorType: "blocked_by_validation", submissionOutcome: "rejected" }
      : { clicked: false, done: false };
    let writes = 0;
    sandbox.resolveRequiredFieldAudit = async (_steps, options) => {
      sandbox.window.location = new URL("https://jobs.apple.com/app/en-us/apply/200987654-0836");
      options.assertIdentity?.();
      writes++;
      return { answeredCount: 1, incomplete: false };
    };
    const result = await sandbox.runApplicationWorkflowStep({ expectedJobId: "200123456-0836" });
    assert.equal(writes, 0);
    assert.equal(result.errorType, "job_identity_mismatch");
  }
});

test("identity failures pause the queue even when Submit was never attempted", async () => {
  const harness = createBackgroundHarness();
  await harness.ready;
  for (const errorType of ["job_identity_unverified", "job_identity_mismatch"]) {
    const disposition = harness.sandbox.appleQueueFailureDisposition({ data: { errorType,
      submissionAttempted: false, submissionOutcomeUnknown: false, steps: [] } }, true);
    assert.equal(disposition.unknown, false);
    assert.equal(disposition.pauseQueue, true);
  }
});

test("numeric job identity uses the complete ID, not substring or location-suffix guesses", () => {
  const safety = require("../lib/appleApplicationSafety.js");
  assert.equal(safety.matchesJob("200123456-0836", "https://jobs.apple.com/en-us/details/200123456-0836/software-engineer"), true);
  assert.equal(safety.matchesJob("200123456-0836", "https://jobs.apple.com/app/en-us/apply/200123456-0836"), true);
  for (const url of ["https://jobs.apple.com/app/en-us/apply/200123456-9999", "https://jobs.apple.com/app/en-us/apply/200123456",
    "https://jobs.apple.com/app/en-us/apply/200123456-08360", "https://example.com/app/en-us/apply/200123456-0836"]) {
    assert.equal(safety.matchesJob("200123456-0836", url), false);
  }
});

function confirmationAlert(sandbox, jobId) {
  const alert = { innerText: "Your information has been submitted for Software Engineer.",
    getBoundingClientRect: () => ({ width: 400, height: 40 }),
    querySelectorAll: () => jobId ? [{ href: `https://jobs.apple.com/en-us/details/${jobId}/software-engineer` }] : [] };
  sandbox.document.querySelectorAll = selector => /global-alert/.test(selector) ? [alert] : [];
}

test("confirmation redirects require the submitted role in the confirmation itself", async () => {
  for (const jobId of [null, "200987654-0836", "200123456-0836"]) {
    const sandbox = createContentHarness();
    sandbox.window.location = new URL("https://jobs.apple.com/app/en-us/profile/info");
    confirmationAlert(sandbox, jobId);
    const result = await sandbox.runApplicationWorkflowStep({ expectedJobId: "200123456-0836", allowConfirmation: true,
      submissionAttemptCount: 1, submissionOutcome: "unknown" });
    assert.equal(result.done, jobId === "200123456-0836");
    if (!result.done) assert.match(result.errorType, /job_identity/);
  }
});

test("an explicitly different confirmation job cannot be accepted even on the expected URL", async () => {
  const sandbox = createContentHarness();
  actionablePage(sandbox);
  const alert = { innerText: "Your application was submitted. Job ID: 200987654-0836",
    getBoundingClientRect: () => ({ width: 200, height: 30 }), querySelectorAll: () => [] };
  sandbox.document.querySelectorAll = selector => selector.startsWith("#global-alert") ? [alert] : [];
  sandbox.getSubmittedSignal = () => ({ text: alert.innerText });
  const result = await sandbox.runApplicationWorkflowStep({ expectedJobId: "200123456-0836" });
  assert.equal(result.done, false);
  assert.equal(result.errorType, "job_identity_mismatch");
});

test("background rejects a confirmation for another role and keeps the Submit outcome unknown", async () => {
  const harness = createBackgroundHarness();
  await harness.ready;
  mockStep(harness, { ok: true, data: { url: "https://jobs.apple.com/app/en-us/apply/200987654-0836", clicked: true, done: true,
    expectedJobId: "200987654-0836", identityVerified: true,
    steps: [{ step: "Submit application", status: "clicked" }], summary: "Submitted" } });
  const result = await harness.sandbox.runApplicationWorkflow(harness.tabs[0], { closeOnDone: false,
    jobContext: { jobId: "200123456-0836" }, userProfile: {} });
  assert.equal(result.ok, false);
  assert.equal(result.data.submissionOutcome, "unknown");
  assert.equal(harness.calls.checkpoints.length, 0);
});

test("four synthetic Apple stages use saved answers and confirm exactly one submission", async () => {
  const harness = createBackgroundHarness();
  await harness.ready;
  const sandbox = createContentHarness();
  const authorization = radioQuestion("Are you legally authorized to work?");
  const sponsorship = radioQuestion("Will you require visa sponsorship?");
  let stage = 0;
  let submitClicks = 0;
  const button = { get innerText() { return stage === 3 ? "Submit" : "Continue"; }, value: "", getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 40 }), scrollIntoView() {},
    click() { if (stage === 3) submitClicks++; stage++; } };
  sandbox.getSessionRequiredSignal = () => null;
  sandbox.getAlreadyAppliedSignal = () => null;
  sandbox.getSubmittedSignal = () => stage === 4 ? { text: "Application submitted" } : null;
  sandbox.waitForApplicationFormToSettle = async () => ({ ready: true });
  sandbox.findPrimaryActionButton = () => button;
  sandbox.getLoadingSignal = () => null;
  sandbox.hasVisibleApplicationQuestionControls = () => stage === 2;
  sandbox.document.querySelectorAll = selector => selector === "fieldset, section, div, li" && stage === 2
    ? [authorization.container, sponsorship.container] : [];
  sandbox.chrome.runtime.sendMessage = message => harness.sandbox.dispatch(message, { tab: harness.tabs[0] });
  mockStep(harness, async message => ({ ok: true, data: await sandbox.runApplicationWorkflowStep(message) }));
  const result = await harness.sandbox.runApplicationWorkflow(harness.tabs[0], { closeOnDone: false,
    jobContext: { jobId: "200123456-0836", site: "apple" }, userProfile: { workAuthorized: "yes", requiresSponsorship: "no" } });
  assert.equal(result.ok, true);
  assert.equal(result.data.submitted, true);
  assert.equal(result.data.submissionOutcome, "confirmed");
  assert.equal(harness.calls.messages.length, 4);
  assert.equal(submitClicks, 1);
  assert.equal(authorization.radios[0].checked, true);
  assert.equal(sponsorship.radios[1].checked, true);
  assert.deepEqual(harness.calls.checkpoints, ["200123456-0836"]);
  assert.equal(harness.data.appleApplicationWorkflow.status, "completed");
  assert.equal(harness.data.appleApplicationWorkflow.jobs["200123456-0836"].state, "submitted");
  assert.equal(harness.data.appleApplicationWorkflow.jobs["200123456-0836"].submissionAttemptCount, 1);
});

test("confirmed submission remains confirmed if its local history save fails", async () => {
  const harness = createBackgroundHarness();
  await harness.ready;
  mockStep(harness, { ok: true, data: { url: harness.tabs[0].url, clicked: true, done: true,
    submissionOutcome: "confirmed", steps: [{ step: "Submit application", status: "clicked" }], summary: "Submitted" } });
  harness.sandbox.recordAppliedCheckpoint = async () => { throw new Error("Synthetic write failure"); };
  const result = await harness.sandbox.runApplicationWorkflow(harness.tabs[0], { closeOnDone: false,
    jobContext: { jobId: "200123456-0836" }, userProfile: {} });
  assert.equal(result.ok, true);
  assert.equal(result.data.submissionOutcome, "confirmed");
  assert.equal(result.data.checkpointed, false);
  assert.match(result.data.warning, /confirmed.*could not be saved/);
  assert.equal(harness.calls.messages.length, 1);
});
