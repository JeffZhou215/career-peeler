const test = require("node:test");
const assert = require("node:assert/strict");
const safety = require("../lib/appleApplicationSafety.js");
const core = require("../lib/core.js");
const currentDate = new Date("2026-10-17T12:00:00Z");
const profile = { llmEnabled: true, llmApiKey: "sk-offline", resumeText: "Engineer at Apple. No criminal history. Available immediately." };
const criminalQuestion = "Have you ever been convicted of a felony?";

test("saved personal answers are unset by default and are normalized without extracting PDF claims", () => {
  const normalized = core.normalizeUserProfile(profile);
  assert.equal(normalized.ageOver18, "");
  assert.equal(normalized.previousAppleEmployment, "");
  assert.equal(normalized.availableStartDate, "");
  assert.deepEqual(normalized.applicationQuestionAnswers, {});
  const saved = core.normalizeUserProfile({ ...profile, ageOver18: " YES ", previousAppleEmployment: "No",
    availableStartDate: "2026-11-17", applicationQuestionAnswers: { [criminalQuestion]: " No " } });
  assert.equal(saved.ageOver18, "yes");
  assert.equal(saved.previousAppleEmployment, "no");
  assert.equal(saved.availableStartDate, "2026-11-17");
  assert.equal(saved.applicationQuestionAnswers[criminalQuestion.toLowerCase()], "no");
  assert.equal(core.normalizeUserProfile(saved).applicationQuestionAnswers[criminalQuestion.toLowerCase()], "no");
});

test("strict saved date normalization rejects rollover, locale dates, inferred ASAP and malformed values", () => {
  for (const value of ["2026-02-30", "2025-02-29", "26-10-17", "10/17/2026", "ASAP", "tomorrow", "2026-1-01", "Immediately"]) {
    assert.equal(safety.normalizeSavedStartDate(value), "", value);
  }
  assert.equal(safety.normalizeSavedStartDate("2028-02-29"), "2028-02-29");
  assert.equal(safety.normalizeSavedStartDate("immediate"), "immediate");
});

test("criminal history answers apply only to the exact saved question wording", () => {
  const saved = { applicationQuestionAnswers: { [criminalQuestion]: "yes" } };
  assert.equal(safety.applicationQuestionPolicy(criminalQuestion, saved).desiredAnswer, "Yes");
  assert.equal(safety.applicationQuestionPolicy(`  ${criminalQuestion.toUpperCase()}  `, saved).desiredAnswer, "Yes");
  for (const other of ["Have you ever been arrested?", "Have you been convicted of a felony in the past five years?", "Do you have a criminal record?"]) {
    assert.match(safety.applicationQuestionPolicy(other, saved).error, /exact question|manually/i);
  }
  assert.match(safety.applicationQuestionPolicy("Do you consent to a background check?", saved).error, /exact question|manually/i,
    "criminal history cannot answer background-check consent");
});

test("simple age and Apple employment use saved answers; negated, contractor and combined wording require exact answers", () => {
  const saved = { ageOver18: "no", previousAppleEmployment: "yes" };
  assert.equal(safety.applicationQuestionPolicy("Are you 18 years of age or older?", saved).desiredAnswer, "No");
  assert.equal(safety.applicationQuestionPolicy("Have you ever been employed by Apple?", saved).desiredAnswer, "Yes");
  for (const question of ["Are you not 18 years of age or older?", "Are you at least 21 years old?",
    "Have you ever been employed by Apple or an affiliate?",
    "Have you ever worked for Apple as a temporary agency worker or independent contractor?"]) {
    assert.match(safety.applicationQuestionPolicy(question, saved).error, /exact question|manually/i);
    assert.equal(safety.applicationQuestionPolicy(question, { ...saved, applicationQuestionAnswers: { [question]: "no" } }).desiredAnswer, "No");
  }
});

test("saved exact start date never chooses a nearby date or an immediate option", () => {
  assert.equal(safety.findSavedStartDateOption(["October 18, 2026", "November 1, 2026", "As soon as possible"], "2026-10-19", currentDate), null);
  assert.equal(safety.findSavedStartDateOption(["October 19, 2026", "October 18, 2026"], "2026-10-19", currentDate), "October 19, 2026");
  assert.equal(safety.findSavedStartDateOption(["2026-10-19"], "2026-10-19", currentDate), "2026-10-19");
  assert.equal(safety.findSavedStartDateOption(["10/19/2026"], "2026-10-19", currentDate), null);
  assert.equal(safety.findSavedStartDateOption(["As soon as possible"], "immediate", currentDate), "As soon as possible");
  assert.equal(safety.findSavedStartDateOption(["Immediately or after notice period"], "immediate", currentDate), null);
  assert.equal(safety.findSavedStartDateOption(["October 16, 2026"], "2026-10-16", currentDate), null);
  assert.equal(safety.findSavedStartDateOption(["February 30, 2027"], "2027-03-02", currentDate), null);
  assert.equal(safety.findSavedStartDateOption(["Immediately", "As soon as possible"], "immediate", currentDate), null);
  assert.match(safety.applicationQuestionPolicy("Start Date", { availableStartDate: "immediate" }).error, /manually/,
    "employment history dates cannot be filled using candidate availability");
});

test("question map is bounded, rejects invalid answers, and cannot mutate an object prototype", () => {
  const answers = safety.normalizeApplicationQuestionAnswers(JSON.parse('{"__proto__":"yes","Question?":"maybe"," Another  Question? ":"NO"}'));
  assert.equal(Object.getPrototypeOf(answers), Object.prototype);
  assert.equal(Object.hasOwn(answers, "__proto__"), true);
  assert.equal(answers["__proto__"], "yes");
  assert.equal(answers["another question?"], "no");
  assert.equal(answers["question?"], undefined);
  assert.equal(Object.keys(safety.normalizeApplicationQuestionAnswers(Object.fromEntries(Array.from({ length: 110 }, (_, i) => [`Q${i}`, "no"])))).length, 100);
});

test("missing personal answers never invoke either LLM answer route despite strong resume claims", async () => {
  core.resetOpenAiCallCount();
  let starts = 0;
  for (const questionText of [criminalQuestion, "Are you 18 years of age or older?", "Have you ever been employed by Apple?",
    "Have you ever worked for Apple as a temporary agency worker or independent contractor?", "What is the earliest date you are available to start?",
    "Have you ever worked for Acme as an employee?", "Do you have a disability?", "Start Date", "What is your start date?",
    "What date can you start?", "When are you available to begin?", "Are you under 18?", "Are you 21 or older?",
    "Have you worked at Apple?", "Are you a temporary agency worker at Apple?"]) {
    const resolved = await core.resolveApplicationQuestion({ questionText, options: ["Yes", "No"], fieldKind: "select", userProfile: profile,
      currentDate, onLlmStart: () => { starts++; } });
    assert.equal(resolved.ok, false, questionText);
    const legacy = await core.generateFreeTextAnswer({ questionText, userProfile: profile });
    assert.equal(legacy.ok, false, `legacy ${questionText}`);
  }
  assert.equal(starts, 0);
  assert.equal(core.getOpenAiCallCount(), 0);
});

test("explicit personal choices resolve locally and unmatched saved values stop without model fallback", async () => {
  core.resetOpenAiCallCount();
  for (const desired of ["yes", "no"]) {
    const saved = { ...profile, applicationQuestionAnswers: { [criminalQuestion]: desired } };
    const result = await core.resolveApplicationQuestion({ questionText: criminalQuestion, options: ["No", "Yes"], fieldKind: "select", userProfile: saved });
    assert.equal(result.ok, true);
    assert.equal(result.data.value.toLowerCase(), desired);
    assert.equal(result.data.source, "saved_profile");
    const missing = await core.resolveApplicationQuestion({ questionText: criminalQuestion, options: ["Decline to answer"], fieldKind: "select", userProfile: saved });
    assert.equal(missing.ok, false);
  }
  const date = await core.resolveApplicationQuestion({ questionText: "What is your earliest start date?", options: [], fieldKind: "date",
    userProfile: { ...profile, availableStartDate: "2026-10-19" }, currentDate });
  assert.equal(date.ok, true);
  assert.equal(date.data.value, "2026-10-19");
  const unavailable = await core.resolveApplicationQuestion({ questionText: "What is your earliest start date?", options: ["October 20, 2026"], fieldKind: "select",
    userProfile: { ...profile, availableStartDate: "2026-10-19" }, currentDate });
  assert.equal(unavailable.ok, false);
  const stale = await core.resolveApplicationQuestion({ questionText: "What is your earliest start date?", options: [], fieldKind: "date",
    userProfile: { ...profile, availableStartDate: "2026-10-16" }, currentDate });
  assert.equal(stale.ok, false);
  assert.equal(core.getOpenAiCallCount(), 0);
});

test("binary availability never receives a date or inferred yes from the saved availability date", async () => {
  core.resetOpenAiCallCount();
  const saved = { ...profile, availableStartDate: "immediate" };
  for (const questionText of ["Are you available to start before January?", "Can you start on January 1?",
    "When are you available to start and do you have transport?"]) {
    assert.match(safety.applicationQuestionPolicy(questionText, saved).error, /exact question|manually/i);
    const result = await core.resolveApplicationQuestion({ questionText, options: [], fieldKind: "text", userProfile: saved });
    assert.equal(result.ok, false);
    assert.equal((await core.generateFreeTextAnswer({ questionText, userProfile: saved })).ok, false);
    const explicit = { ...saved, applicationQuestionAnswers: { [questionText]: "no" } };
    const answered = await core.resolveApplicationQuestion({ questionText, options: ["Yes", "No"], fieldKind: "select", userProfile: explicit });
    assert.equal(answered.data.value, "No");
  }
  assert.equal(core.getOpenAiCallCount(), 0);
});

test("saved personal answers are not part of a job matching prompt", () => {
  const messages = core.buildLlmPrompt({ title: "Engineer", matches: [] }, { resumeText: "Engineer", ageOver18: "yes", previousAppleEmployment: "yes",
    availableStartDate: "immediate", applicationQuestionAnswers: { [criminalQuestion]: "no" } });
  assert.doesNotMatch(messages[1].content, /applicationQuestionAnswers|ageOver18|previousAppleEmployment|availableStartDate|convicted of a felony/i);
});

test("any explicitly saved screening question is honored locally and missing binary answers stop before either LLM route", async () => {
  core.resetOpenAiCallCount();
  for (const questionText of ["Are you willing to relocate?", "Do you consent to a background check?", "Do you have experience with Python?"]) {
    const missing = await core.resolveApplicationQuestion({ questionText, options: ["Yes", "No"], fieldKind: "select", userProfile: profile });
    assert.equal(missing.ok, false);
    assert.equal((await core.generateFreeTextAnswer({ questionText, userProfile: profile })).ok, false);
    const saved = { ...profile, applicationQuestionAnswers: { [questionText]: "no" } };
    const result = await core.resolveApplicationQuestion({ questionText, options: ["Yes", "No"], fieldKind: "select", userProfile: saved });
    assert.equal(result.ok, true);
    assert.equal(result.data.value, "No");
    assert.equal((await core.generateFreeTextAnswer({ questionText, userProfile: saved })).data.answer, "No");
  }
  assert.equal(safety.applicationQuestionPolicy("Can you describe a project you built?", profile), null);
  assert.equal(safety.applicationQuestionPolicy("Why Apple?", profile), null);
  assert.equal(safety.applicationQuestionPolicy("Do you have a disability?", { applicationQuestionAnswers: { "do you have a disability?": "no" } }), null,
    "EEO settings retain priority over generic saved questions");
  assert.equal(core.getOpenAiCallCount(), 0);
});
