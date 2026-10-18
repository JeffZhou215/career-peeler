const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core.js');
const { createContentHarness, radioQuestion, installQuestions } = require('./helpers/appleWorkflowHarness.cjs');

const roleId = '200123456-0836';
const criminalQuestion = 'Have you ever been convicted of a felony?';

function nativeQuestion(sandbox, question, values, selected = '') {
  const entries = ['', ...values].map(value => ({ textContent: value || 'Select', value }));
  let changes = 0;
  const field = { tagName: 'FIELDSET', innerText: `${question}\n${entries.map(option => option.textContent).join('\n')}`,
    required: true, isConnected: true, parentElement: null,
    getAttribute: name => name === 'data-form-field-i18n-name' ? question : null,
    getBoundingClientRect: () => ({ width: 500, height: 100 }), contains: other => other === select,
    querySelector: selector => selector === 'legend' ? null : selector.includes('required') ? select : null,
    querySelectorAll: selector => selector === 'select' ? [select] : [] };
  const select = { tagName: 'SELECT', required: true, disabled: false, isConnected: true, parentElement: field,
    options: entries, selectedIndex: Math.max(0, entries.findIndex(option => option.value === selected)),
    getAttribute: name => name === 'type' ? 'select' : null,
    getBoundingClientRect: () => ({ width: 200, height: 30 }), closest: selector => selector === '#apply-parsing-feedback' ? null : field,
    matches: () => false, querySelector: () => null, querySelectorAll: () => [],
    dispatchEvent() { changes++; } };
  Object.defineProperty(select, 'value', { get() { return this.options[this.selectedIndex]?.value || ''; },
    set(value) { this.selectedIndex = this.options.findIndex(option => option.value === value); } });
  Object.defineProperty(select, 'selectedOptions', { get() { return [this.options[this.selectedIndex]].filter(Boolean); } });
  sandbox.document.querySelectorAll = selector => selector === 'fieldset, section, div, li' ? [field]
    : selector.includes('select') && selector.includes('textarea') ? [select] : [];
  return { field, select, changes: () => changes };
}

function installResolver(sandbox, profile) {
  sandbox.chrome.runtime.sendMessage = message => {
    assert.equal(message.type, 'APPLE_CAREERS_RESOLVE_APPLICATION_QUESTION');
    return core.resolveApplicationQuestion({ questionText: message.questionText, options: message.options,
      fieldKind: message.fieldKind, userProfile: profile });
  };
}

function reviewQuestion(sandbox, question, answer) {
  const node = { tagName: 'DIV', innerText: `${question}\n${answer}\nEdit`,
    getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null,
    getBoundingClientRect: () => ({ width: 500, height: 100 }), contains: () => false };
  sandbox.document.querySelectorAll = selector => selector === 'fieldset, section, div, li' ? [node] : [];
  return node;
}

function actionable(sandbox, label = 'Continue') {
  let clicks = 0;
  sandbox.waitForApplicationFormToSettle = async () => ({ ready: true });
  sandbox.findPrimaryActionButton = () => ({ innerText: label, getAttribute: () => null });
  sandbox.clickPrimaryAction = async () => { clicks++; return { clicked: true, done: false, summary: 'Synthetic action' }; };
  return () => clicks;
}

test('age eligibility and prior Apple employment use independent explicit answers', async () => {
  for (const [label, key] of [['Are you 18 years of age or older?', 'ageOver18'],
    ['Have you ever been employed by Apple?', 'previousAppleEmployment']]) {
    for (const saved of ['yes', 'no']) {
      const sandbox = createContentHarness();
      const question = radioQuestion(label);
      installQuestions(sandbox, [question]);
      const result = await sandbox.answerQuestionnaire([], { [key]: saved });
      assert.equal(result.unresolvedReason, undefined);
      assert.equal(question.radios.find(option => option.value === saved).checked, true);
      assert.equal(question.radios.find(option => option.value !== saved).clicks, 0);
    }
  }
});

test('missing age or prior employment stops even when Apple prefilled an answer', async () => {
  for (const label of ['Are you 18 years of age or older?', 'Have you ever been employed by Apple?']) {
    const sandbox = createContentHarness();
    const question = radioQuestion(label, 'yes');
    installQuestions(sandbox, [question]);
    const result = await sandbox.answerQuestionnaire([], {});
    assert.match(result.unresolvedReason, /explicit|save|review/i);
    assert.equal(question.radios.reduce((sum, option) => sum + option.clicks, 0), 0);
  }
});

test('a contractor question requires its exact saved answer rather than the employee setting', async () => {
  const label = 'Have you ever worked for Apple as a temporary agency worker, consultant, or an independent contractor?';
  for (const saved of [{ previousAppleEmployment: 'no' }, { applicationQuestionAnswers: { [label.toLowerCase()]: 'yes' } }]) {
    const sandbox = createContentHarness();
    const question = radioQuestion(label);
    installQuestions(sandbox, [question]);
    const result = await sandbox.answerQuestionnaire([], saved);
    assert.equal(Boolean(result.unresolvedReason), !saved.applicationQuestionAnswers);
    assert.equal(question.radios[0].checked, Boolean(saved.applicationQuestionAnswers));
  }
});

test('criminal history has no default and honors only the exact saved question', async () => {
  for (const profile of [{}, { applicationQuestionAnswers: { [criminalQuestion.toLowerCase()]: 'yes' } },
    { applicationQuestionAnswers: { 'have you ever been arrested?': 'no' } }]) {
    const sandbox = createContentHarness();
    const question = radioQuestion(criminalQuestion);
    installQuestions(sandbox, [question]);
    const result = await sandbox.answerQuestionnaire([], profile);
    assert.equal(Boolean(result.unresolvedReason), profile.applicationQuestionAnswers?.[criminalQuestion.toLowerCase()] !== 'yes');
    assert.equal(question.radios[0].checked, !result.unresolvedReason);
    assert.equal(question.radios[1].clicks, 0);
  }
});

test('existing conflicting age and criminal answers are preserved', async () => {
  for (const [label, profile] of [['Are you 18 years of age or older?', { ageOver18: 'no' }],
    [criminalQuestion, { applicationQuestionAnswers: { [criminalQuestion]: 'yes' } }]]) {
    const sandbox = createContentHarness();
    const question = radioQuestion(label, label === criminalQuestion ? 'no' : 'yes');
    installQuestions(sandbox, [question]);
    const result = await sandbox.answerQuestionnaire([], profile);
    assert.match(result.unresolvedReason, /conflict|review/i);
    assert.equal(question.radios.reduce((sum, option) => sum + option.clicks, 0), 0);
  }
});

test('start-date select uses the explicit saved date rather than nearest availability', async () => {
  const sandbox = createContentHarness();
  const profile = { availableStartDate: '2099-06-01' };
  installResolver(sandbox, profile);
  const fixture = nativeQuestion(sandbox, 'What is your earliest available start date?', ['Immediately', 'June 1, 2099', 'July 1, 2099']);
  const result = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: profile });
  assert.equal(result.unresolvedReason, null);
  assert.equal(fixture.select.value, 'June 1, 2099');
  assert.equal(fixture.changes(), 2);
});

test('missing, expired, and unoffered start dates pause without field writes', async () => {
  for (const value of ['', '2000-01-01', '2099-07-01']) {
    const sandbox = createContentHarness();
    const profile = { availableStartDate: value };
    installResolver(sandbox, profile);
    const fixture = nativeQuestion(sandbox, 'What is your earliest available start date?', ['Immediately', 'June 1, 2099']);
    const result = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: profile });
    assert.match(result.unresolvedReason, /saved|explicit|review/i);
    assert.equal(fixture.select.value, '');
    assert.equal(fixture.changes(), 0);
  }
});

test('prefilled start dates require agreement with the saved setting', async () => {
  for (const selected of ['June 1, 2099', 'Immediately']) {
    const sandbox = createContentHarness();
    const profile = { availableStartDate: '2099-06-01' };
    installResolver(sandbox, profile);
    const fixture = nativeQuestion(sandbox, 'What is your earliest available start date?', ['Immediately', 'June 1, 2099'], selected);
    const result = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: profile });
    assert.equal(Boolean(result.unresolvedReason), selected === 'Immediately');
    assert.equal(fixture.select.value, selected);
    assert.equal(fixture.changes(), 0);
  }
});

test('required prefilled EEO answers are validated and never silently overwritten', async () => {
  for (const saved of ['', 'female', 'male']) {
    const sandbox = createContentHarness();
    const profile = { eeoGender: saved };
    installResolver(sandbox, profile);
    const fixture = nativeQuestion(sandbox, 'Gender', ['Male', 'Female'], 'Female');
    const result = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: profile });
    assert.equal(Boolean(result.unresolvedReason), saved !== 'female');
    assert.equal(fixture.select.value, 'Female');
    assert.equal(fixture.changes(), 0);
  }
});

test('read-only review requires the observed personal answer to match the explicit saved answer', async () => {
  for (const saved of ['', 'yes', 'no']) {
    const sandbox = createContentHarness();
    const actions = actionable(sandbox, 'Submit');
    reviewQuestion(sandbox, 'Are you 18 years of age or older?', 'Yes');
    const result = await sandbox.runApplicationWorkflowStep({ expectedJobId: roleId, applicationAnswers: { ageOver18: saved } });
    assert.equal(Boolean(result.pausedForReview), saved !== 'yes');
    assert.equal(actions(), saved === 'yes' ? 1 : 0);
  }
});

test('unverifiable read-only personal rows pause, while a page with no such questions is allowed', async () => {
  const sandbox = createContentHarness();
  const actions = actionable(sandbox, 'Submit');
  reviewQuestion(sandbox, 'Are you 18 years of age or older?', 'Answer unavailable');
  const result = await sandbox.runApplicationWorkflowStep({ expectedJobId: roleId, applicationAnswers: { ageOver18: 'yes' } });
  assert.equal(result.pausedForReview, true);
  assert.equal(actions(), 0);
  sandbox.document.querySelectorAll = () => [];
  const noQuestions = await sandbox.runApplicationWorkflowStep({ expectedJobId: roleId, applicationAnswers: {} });
  assert.equal(Boolean(noQuestions.pausedForReview), false);
  assert.equal(actions(), 1);
});

test('read-only required EEO rows require the users own saved answer', async () => {
  for (const saved of ['', 'female', 'male']) {
    const sandbox = createContentHarness();
    const profile = { eeoGender: saved };
    installResolver(sandbox, profile);
    reviewQuestion(sandbox, 'Gender', 'Female');
    const result = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: profile }, { readOnlyReview: true });
    assert.equal(Boolean(result.unresolvedReason), saved !== 'female');
  }
});

test('an answer that disappears after a controlled-input update prevents navigation', async () => {
  const sandbox = createContentHarness();
  const profile = { availableStartDate: '2099-06-01' };
  installResolver(sandbox, profile);
  const fixture = nativeQuestion(sandbox, 'What is your earliest available start date?', ['June 1, 2099']);
  fixture.select.dispatchEvent = () => { fixture.select.selectedIndex = 0; };
  const result = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: profile });
  assert.match(result.unresolvedReason, /remain|review/i);
});

test('the last saved-answer check runs after asynchronous Submit ownership and blocks a changed answer', async () => {
  const sandbox = createContentHarness();
  const profile = { eeoGender: 'female' };
  installResolver(sandbox, profile);
  const fixture = nativeQuestion(sandbox, 'Gender', ['Male', 'Female'], 'Female');
  let clicks = 0;
  const button = { innerText: 'Submit', scrollIntoView() {}, getAttribute: () => null, click() { clicks++; } };
  const result = await sandbox.clickAndDetectSubmission(button, [], {
    assertSavedAnswers: async () => {
      const audit = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: profile });
      if (audit.unresolvedReason) throw new Error(audit.unresolvedReason);
    },
    assertOwnership: async () => { fixture.select.value = 'Male'; }
  }).catch(error => ({ error: error.message }));
  assert.match(result.error, /conflict|review/i);
  assert.equal(clicks, 0);
  assert.equal(fixture.select.value, 'Male');
});

test('replacing a personal control while resolving its saved answer stops without writes', async () => {
  const sandbox = createContentHarness();
  const fixture = nativeQuestion(sandbox, 'What is your earliest available start date?', ['June 1, 2099']);
  sandbox.chrome.runtime.sendMessage = async () => {
    fixture.select.isConnected = false;
    return { ok: true, data: { action: 'choose_option', value: 'June 1, 2099' } };
  };
  const result = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: { availableStartDate: '2099-06-01' } });
  assert.match(result.unresolvedReason, /changed|review/i);
  assert.equal(fixture.changes(), 0);
});

test('optional personal choices remain untouched without a saved answer', async () => {
  const sandbox = createContentHarness();
  const fixture = nativeQuestion(sandbox, 'Gender (optional)', ['Male', 'Female'], 'Female');
  let requests = 0;
  sandbox.chrome.runtime.sendMessage = async () => { requests++; throw new Error('Should not resolve optional questions'); };
  const result = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: {} });
  assert.equal(result.unresolvedReason, null);
  assert.equal(requests, 0);
  assert.equal(fixture.changes(), 0);
});

test('a generic personal screening prefill needs its own saved answer and preserves conflicts', async () => {
  const label = 'Are you willing to relocate?';
  for (const saved of ['', 'yes', 'no']) {
    const sandbox = createContentHarness();
    const profile = { applicationQuestionAnswers: saved ? { [label]: saved } : {} };
    const fixture = nativeQuestion(sandbox, label, ['Yes', 'No'], 'Yes');
    const result = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: profile });
    assert.equal(Boolean(result.unresolvedReason), saved !== 'yes');
    assert.equal(fixture.select.value, 'Yes');
    assert.equal(fixture.changes(), 0);
  }
});

test('an explicit saved answer to otherwise unclassified wording is also verified', async () => {
  const label = 'Relocation agreement confirmed?';
  for (const saved of ['yes', 'no']) {
    const sandbox = createContentHarness();
    const fixture = nativeQuestion(sandbox, label, ['Yes', 'No'], 'Yes');
    const result = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: { applicationQuestionAnswers: { [label]: saved } } });
    assert.equal(Boolean(result.unresolvedReason), saved !== 'yes');
    assert.equal(fixture.changes(), 0);
  }
});

test('a combined read-only section cannot drop multiple recognized personal questions', async () => {
  const sandbox = createContentHarness();
  const actions = actionable(sandbox, 'Submit');
  // Ordinary p/span descendants do not individually match the existing semantic container
  // selector; their rendered text belongs to this single section, just as in a browser.
  const section = { tagName: 'SECTION', innerText: 'Are you 18 years of age or older?\nYes\nHave you ever been employed by Apple?\nNo',
    getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null,
    getBoundingClientRect: () => ({ width: 500, height: 200 }), contains: () => false };
  sandbox.document.querySelectorAll = selector => selector === 'fieldset, section, div, li' ? [section] : [];
  for (const profile of [{}, { ageOver18: 'yes', previousAppleEmployment: 'no' }]) {
    const result = await sandbox.runApplicationWorkflowStep({ expectedJobId: roleId, applicationAnswers: profile });
    assert.equal(result.pausedForReview, true);
    assert.match(result.summary, /associated|verified|manual/i);
    assert.equal(actions(), 0);
  }
});

test('an ancestor with multiple questions is allowed when every child row is independently verified', async () => {
  const sandbox = createContentHarness();
  const first = reviewQuestion(sandbox, 'Are you 18 years of age or older?', 'Yes');
  const second = reviewQuestion(sandbox, 'Have you ever been employed by Apple?', 'No');
  const parent = { tagName: 'SECTION', innerText: `${first.innerText}\n${second.innerText}`,
    getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null,
    getBoundingClientRect: () => ({ width: 500, height: 200 }), contains: node => node === first || node === second };
  sandbox.document.querySelectorAll = selector => selector === 'fieldset, section, div, li' ? [parent, first, second] : [];
  const result = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: { ageOver18: 'yes', previousAppleEmployment: 'no' } }, { readOnlyReview: true });
  assert.equal(result.unresolvedReason, null);
});

test('a same-node personal question label change during ownership stops before any write', async () => {
  const sandbox = createContentHarness();
  const label = 'What is your earliest available start date?';
  const profile = { availableStartDate: '2099-06-01' };
  installResolver(sandbox, profile);
  const fixture = nativeQuestion(sandbox, label, ['June 1, 2099']);
  let currentQuestion = label;
  fixture.field.getAttribute = name => name === 'data-form-field-i18n-name' ? currentQuestion : null;
  const result = await sandbox.verifySavedApplicationAnswers([], { applicationAnswers: profile,
    assertOwnership: async () => { currentQuestion = 'When did you previously start employment at Apple?'; } });
  assert.match(result.unresolvedReason, /changed|manual/i);
  assert.equal(fixture.changes(), 0);
  assert.equal(fixture.select.value, '');
});

test('changing a connected Yes/No question during ownership cannot write the old saved answer', async () => {
  const sandbox = createContentHarness();
  const question = radioQuestion('Are you 18 years of age or older?');
  installQuestions(sandbox, [question]);
  const result = await sandbox.answerQuestionnaire([], { ageOver18: 'yes' }, {
    assertOwnership: async () => { question.container.innerText = 'Have you ever been convicted of a felony?\nYes\nNo'; } });
  assert.match(result.unresolvedReason, /changed|manual/i);
  assert.equal(question.radios.reduce((sum, option) => sum + option.clicks, 0), 0);
});

test('a voluntary demographic section cannot hide a separate mandatory review question', async () => {
  const sandbox = createContentHarness();
  const actions = actionable(sandbox, 'Submit');
  const section = { tagName: 'SECTION', innerText: 'Are you 18 years of age or older?\nYes\nVoluntary demographic survey\nGender\nFemale',
    getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null,
    getBoundingClientRect: () => ({ width: 500, height: 200 }), contains: () => false };
  sandbox.document.querySelectorAll = selector => selector === 'fieldset, section, div, li' ? [section] : [];
  const result = await sandbox.runApplicationWorkflowStep({ expectedJobId: roleId, applicationAnswers: {} });
  assert.equal(result.pausedForReview, true);
  assert.equal(actions(), 0);
});

