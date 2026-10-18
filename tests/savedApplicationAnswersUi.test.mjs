import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const core = require("../lib/core.js");
const safety = require("../lib/appleApplicationSafety.js");
const source = await readFile(new URL("../src/sidepanel/components/RequiredApplicationAnswers.jsx", import.meta.url), "utf8");
let server, profileApi, AppleSetupSection, SavedQuestionAnswers;

before(async () => {
  server = await createServer({ configFile: false, plugins: [react()], appType: "custom", logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  profileApi = await server.ssrLoadModule("/src/sidepanel/lib/profile.js");
  ({ AppleSetupSection } = await server.ssrLoadModule("/src/sidepanel/components/AppleSetupSection.jsx"));
  ({ SavedQuestionAnswers } = await server.ssrLoadModule("/src/sidepanel/components/RequiredApplicationAnswers.jsx"));
});
after(async () => { await server?.close(); });

const explicitFields = ["workAuthorized", "requiresSponsorship", "ageOver18", "previousAppleEmployment", "availableStartDate"];
const question = "Have you ever been convicted of a felony?";

test("a clean profile does not inherit anyone's personal application answers", () => {
  for (const profile of [profileApi.createDefaultProfile(), profileApi.normalizeProfile({}), core.normalizeUserProfile({})]) {
    for (const key of explicitFields) assert.equal(profile[key], "", key);
    assert.deepEqual(profile.applicationQuestionAnswers, {});
  }
});

test("panel and worker preserve explicit answers with identical normalization", () => {
  for (const raw of [
    { ageOver18: "yes", previousAppleEmployment: "no", availableStartDate: "2030-04-15", applicationQuestionAnswers: { [question]: "no" } },
    { ageOver18: "no", previousAppleEmployment: "yes", availableStartDate: "immediate", applicationQuestionAnswers: { [question]: "yes" } },
    { ageOver18: true, previousAppleEmployment: false, availableStartDate: "tomorrow", applicationQuestionAnswers: { [question]: true } },
    { ageOver18: "", previousAppleEmployment: "", availableStartDate: "", applicationQuestionAnswers: [] }
  ]) {
    const ui = profileApi.normalizeProfile(raw), worker = core.normalizeUserProfile(raw);
    for (const key of [...explicitFields, "applicationQuestionAnswers"]) assert.deepEqual(ui[key], worker[key], key);
    assert.deepEqual(ui.applicationQuestionAnswers, safety.normalizeApplicationQuestionAnswers(raw.applicationQuestionAnswers));
  }
});

test("dates are saved exactly and malformed calendar values never become an invented date", () => {
  for (const raw of ["", null, "2030-01-02", "2028-02-29", "2027-02-29", "2030-02-31", "1900-01-01", "1899-12-31", "01/02/2030", "immediate", "Immediately", "next week"]) {
    assert.equal(profileApi.normalizeSavedStartDate(raw), safety.normalizeSavedStartDate(raw));
  }
  assert.equal(profileApi.normalizeSavedStartDate("2027-02-29"), "");
  assert.equal(profileApi.normalizeSavedStartDate("immediate"), "immediate");
});

test("exact question normalization retains different scopes and rejects non-explicit answers", () => {
  const raw = JSON.parse('{" Have you ever been convicted of a felony? ":"NO","Have you ever been arrested?":"yes","Unanswered question?":"","Invalid answer?":false,"__proto__":"no"}');
  const answers = profileApi.normalizeApplicationQuestionAnswers(raw);
  assert.deepEqual(answers, safety.normalizeApplicationQuestionAnswers(raw));
  assert.equal(answers[question.toLowerCase()], "no");
  assert.equal(answers["have you ever been arrested?"], "yes");
  assert.equal(Object.hasOwn(answers, "unanswered question?"), false);
  assert.equal(Object.hasOwn(answers, "invalid answer?"), false);
  assert.equal(Object.getPrototypeOf(answers), Object.prototype);
  assert.equal(Object.hasOwn(answers, "__proto__"), true);
  assert.notEqual(profileApi.normalizeApplicationQuestionKey("Question?"), profileApi.normalizeApplicationQuestionKey("Question"));
});

test("resume replacement and extracted candidate edits cannot overwrite saved personal answers", () => {
  const original = profileApi.normalizeProfile({ ageOver18: "no", previousAppleEmployment: "yes", availableStartDate: "2031-03-04",
    applicationQuestionAnswers: { [question]: "yes" }, workAuthorized: "yes", requiresSponsorship: "no" });
  const replacement = profileApi.normalizeProfile({ ...original, resumeFileDataUrl: "data:application/pdf;base64,new", resumeFileName: "new.pdf" });
  const extracted = profileApi.normalizeProfile({ ...replacement, candidateProfile: { basicInfo: { fullName: "Another Extracted Name" },
    ageOver18: "yes", previousAppleEmployment: "no", applicationQuestionAnswers: { [question]: "no" } } });
  for (const key of [...explicitFields, "applicationQuestionAnswers"]) assert.deepEqual(extracted[key], original[key]);
  const cleared = profileApi.normalizeProfile({ ...extracted, ageOver18: "", previousAppleEmployment: "", availableStartDate: "", applicationQuestionAnswers: {} });
  assert.equal(cleared.ageOver18, "");
  assert.equal(cleared.previousAppleEmployment, "");
  assert.equal(cleared.availableStartDate, "");
  assert.deepEqual(cleared.applicationQuestionAnswers, {});
});

test("Setup exposes clearable personal choices and no default immediate start", () => {
  const html = renderToStaticMarkup(createElement(AppleSetupSection, { profile: profileApi.createDefaultProfile(), save: async () => {} }));
  for (const id of ["authorized", "sponsorship", "age-over-18", "previous-apple-employment"]) {
    const control = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>(.*?)</select>`))?.[1];
    assert.ok(control, id);
    assert.match(control, /<option value="" selected="">Not Set<\/option>/);
  }
  assert.match(html, /id="available-start-date"[^>]*type="date"|type="date"[^>]*id="available-start-date"/);
  assert.match(html, /I Can Start Immediately/);
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked=""/);
  assert.match(html, /Missing or ambiguous personal answers stop the application for manual review/);
});

test("saved exact answers are displayed with a removal action, and unsaved draft has no selected Yes/No", () => {
  const html = renderToStaticMarkup(createElement(SavedQuestionAnswers, {
    profile: profileApi.normalizeProfile({ applicationQuestionAnswers: { [question]: "no" } }), save: async () => {}, idPrefix: "apple-"
  }));
  assert.match(html, /have you ever been convicted of a felony\?/);
  assert.match(html, /Remove Saved Answer:/);
  assert.match(html, /<span>No<\/span>/);
  assert.match(html, /<option value="" selected="">Not Set<\/option>/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Save Answer<\/button>/);
});

function savedAnswerHandlers({ draftQuestion = question, draftAnswer = "no", initial = {}, save } = {}) {
  const states = [draftQuestion, draftAnswer, "", false];
  const writes = [];
  let hook = 0;
  const sandbox = { profile: { applicationQuestionAnswers: initial }, save: save || (async update => { writes.push(update); }),
    useState() { const index = hook++; return [states[index], value => { states[index] = value; }]; },
    useRef: value => ({ current: value }),
    normalizeApplicationQuestionKey: profileApi.normalizeApplicationQuestionKey,
    normalizeApplicationQuestionAnswers: profileApi.normalizeApplicationQuestionAnswers };
  const start = source.indexOf("export function SavedQuestionAnswers(");
  const body = source.slice(start, source.indexOf("\n  return <details", start)).replace("export function", "function");
  vm.createContext(sandbox);
  vm.runInContext(`${body}\n return { saveAnswer, removeAnswer }; }\nglobalThis.handlers = SavedQuestionAnswers({profile, save});`, sandbox);
  return { ...sandbox.handlers, states, writes };
}

test("the real save handler saves only explicit exact answers and remove clears one entry", async () => {
  const initial = { "other question?": "yes" };
  const h = savedAnswerHandlers({ draftQuestion: `  ${question}  `, initial });
  await h.saveAnswer();
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0])), { applicationQuestionAnswers: { "other question?": "yes", [question.toLowerCase()]: "no" } });
  assert.equal(h.states[0], "");
  assert.equal(h.states[1], "");
  const removing = savedAnswerHandlers({ initial: { ...initial, [question]: "no" } });
  await removing.removeAnswer(question.toLowerCase());
  assert.deepEqual(JSON.parse(JSON.stringify(removing.writes[0])), { applicationQuestionAnswers: initial });
  for (const draftAnswer of ["", "maybe"]) {
    const unset = savedAnswerHandlers({ draftAnswer });
    await unset.saveAnswer();
    assert.equal(unset.writes.length, 0);
  }
});

test("duplicate clicks cannot overlap saved-answer updates and persistence failures retain the draft", async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const writes = [];
  const h = savedAnswerHandlers({ save: async update => { writes.push(update); await pending; } });
  const saving = h.saveAnswer();
  await h.removeAnswer("other question?");
  await h.saveAnswer();
  assert.equal(writes.length, 1);
  finish();
  await saving;
  const failed = savedAnswerHandlers({ save: async () => { throw new Error("Storage failed"); } });
  await failed.saveAnswer();
  assert.equal(failed.states[0], question);
  assert.equal(failed.states[1], "no");
  assert.equal(failed.states[2], "Storage failed");
});
