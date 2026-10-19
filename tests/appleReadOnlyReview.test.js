const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core.js');
const { createContentHarness } = require('./helpers/appleWorkflowHarness.cjs');

// Structural shape captured from Apple's Review and Submit page. Values below
// are synthetic; no saved user profile or application is used by these tests.
function reviewRow(label, answer, kind = 'demographic') {
  const question = { innerText: label, children: [], matches: s => s === (kind === 'demographic' ? 'label' : 'h3.question') };
  const value = { innerText: answer, children: [], matches: s => s === (kind === 'demographic' ? 'span.info' : 'p.answer') };
  const row = { children: [question, value], isConnected: true,
    get innerText() { return `${question.innerText}\n${value.innerText}`; },
    getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 500, height: 80 }), contains: node => node === question || node === value };
  return { row, question, value };
}

function fixture(rows, profile, { outside = [] } = {}) {
  const h = createContentHarness();
  const root = { isConnected: true, get innerText() { return rows.map(r => r.row.innerText).join('\n'); },
    querySelectorAll: selector => selector === 'fieldset, section, div, li' ? rows.map(r => r.row) : [] };
  h.document.querySelector = selector => selector === '#apply-reviewAndSubmit-form' ? root : null;
  h.document.querySelectorAll = selector => selector === 'fieldset, section, div, li' ? [...rows.map(r => r.row), ...outside] : [];
  h.chrome.runtime.sendMessage = message => core.resolveApplicationQuestion({ questionText: message.questionText,
    options: message.options, fieldKind: message.fieldKind, userProfile: profile });
  h.audit = () => h.verifySavedApplicationAnswers([], { applicationAnswers: profile }, { readOnlyReview: true });
  return h;
}

test('Apple veteran review answer is not mistaken for a second personal question', async () => {
  const h = fixture([reviewRow('Protected Veteran Status', 'I am not a protected veteran')],
    { eeoVeteranStatus: 'not_protected_veteran' });
  assert.equal((await h.audit()).unresolvedReason, null);
});

test('Apple section question/p.answer rows verify independent exact saved answers', async () => {
  const contractor = 'Have you ever worked for Apple as a temporary agency worker, consultant, or an independent contractor?';
  const h = fixture([
    reviewRow('Are you 18 years of age or older?', 'Yes', 'question'),
    reviewRow('Have you ever been employed by Apple?', 'No', 'question'),
    reviewRow(contractor, 'No', 'question'),
    reviewRow('Are you legally authorized to work in the United States?', 'Yes', 'question'),
    reviewRow('Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?', 'No', 'question')
  ], { ageOver18: 'yes', previousAppleEmployment: 'no', workAuthorized: 'yes', requiresSponsorship: 'no',
    applicationQuestionAnswers: { [contractor]: 'no' } });
  assert.equal((await h.audit()).unresolvedReason, null);
});

test('Apple footer employment notices outside the verified review form are not personal-answer rows', async () => {
  const footer = { ...reviewRow('Apple is an equal opportunity employer regardless of gender, race, or veteran status.', '').row };
  const h = fixture([reviewRow('Gender', 'Female')], { eeoGender: 'female' }, { outside: [footer] });
  assert.equal((await h.audit()).unresolvedReason, null);
});

test('a long employment description is profile data rather than an age screening question', async () => {
  const pair = reviewRow('Job Description', `Built a pipeline processing over 12000 images. ${'Implemented image analysis. '.repeat(60)}`);
  pair.row.closest = selector => selector === 'section' ? { id: 'apply-employments' } : null;
  const h = fixture([pair], {});
  assert.equal((await h.audit()).unresolvedReason, null);
});

test('an unknown personal row inside Employment Summary is still blocked', async () => {
  const pair = reviewRow('Other Personal Information', 'I am not a protected veteran');
  pair.row.closest = selector => selector === 'section' ? { id: 'apply-employments' } : null;
  const h = fixture([pair], {});
  assert.ok((await h.audit()).unresolvedReason);
});

test('a screening section cannot use the profile-data exemption for its answer', async () => {
  const pair = reviewRow('Job Description', `Work processing over 12000 images. ${'Image analysis. '.repeat(100)}`);
  pair.row.closest = selector => selector === 'section' ? { id: 'apply-questionnaire' } : null;
  const h = fixture([pair], {});
  assert.ok((await h.audit()).unresolvedReason);
});

for (const saved of ['', 'protected_veteran']) {
  test(`missing or conflicting saved veteran answers still block (${saved || 'unset'})`, async () => {
    const h = fixture([reviewRow('Protected Veteran Status', 'I am not a protected veteran')], { eeoVeteranStatus: saved });
    assert.ok((await h.audit()).unresolvedReason);
  });
}

test('an unexpected extra question in a semantic row cannot be hidden by its answer', async () => {
  const pair = reviewRow('Protected Veteran Status', 'I am not a protected veteran');
  const extra = { innerText: 'Have you ever been employed by Apple?\nNo' };
  pair.row.children.push(extra);
  Object.defineProperty(pair.row, 'innerText', { get: () => `${pair.question.innerText}\n${pair.value.innerText}\n${extra.innerText}` });
  const h = fixture([pair], { eeoVeteranStatus: 'not_protected_veteran', previousAppleEmployment: 'no' });
  assert.match((await h.audit()).unresolvedReason, /associated|verified|manual/i);
});

test('two questions packed into one semantic label still require independent verification', async () => {
  const pair = reviewRow('Protected Veteran Status\nAre you 18 years of age or older?', 'I am not a protected veteran');
  const h = fixture([pair], { eeoVeteranStatus: 'not_protected_veteran', ageOver18: 'no' });
  assert.match((await h.audit()).unresolvedReason, /associated|verified|manual/i);
});

test('a replaced semantic answer during its saved-answer lookup stops final review', async () => {
  const pair = reviewRow('Gender', 'Female');
  const h = fixture([pair], { eeoGender: 'female' });
  h.chrome.runtime.sendMessage = async () => { pair.value.innerText = 'Male'; return { ok: true, data: { action: 'choose_option', value: 'Female' } }; };
  assert.match((await h.audit()).unresolvedReason, /changed|review/i);
});

test('a new personal question added during an asynchronous lookup stops final review', async () => {
  const rows = [reviewRow('Gender', 'Female')];
  const h = fixture(rows, { eeoGender: 'female' });
  h.chrome.runtime.sendMessage = async () => {
    rows.push(reviewRow('Have you ever been employed by Apple?', 'Yes', 'question'));
    return { ok: true, data: { action: 'choose_option', value: 'Female' } };
  };
  assert.match((await h.audit()).unresolvedReason, /changed the application review/i);
});
