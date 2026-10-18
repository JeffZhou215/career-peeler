import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

let server, createController, ModelPickerSheet, AppleSetupSection, profileApi, catalog;
before(async () => {
  server = await createServer({ configFile: false, plugins: [react()], appType: "custom", logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ createModelPickerController: createController } = await server.ssrLoadModule("/src/sidepanel/lib/modelDiscovery.js"));
  ({ ModelPickerSheet } = await server.ssrLoadModule("/src/sidepanel/components/ModelPicker.jsx"));
  ({ AppleSetupSection } = await server.ssrLoadModule("/src/sidepanel/components/AppleSetupSection.jsx"));
  profileApi = await server.ssrLoadModule("/src/sidepanel/lib/profile.js");
  ({ modelCatalog: catalog } = await server.ssrLoadModule("/src/sidepanel/lib/modelCatalog.js"));
});
after(async () => { await server?.close(); });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const response = ids => ({ ok: true, data: { models: ids.map(id => ({ id })), checkedAt: "2026-10-18T12:00:00Z" } });
function setup({ initial = {}, request, save } = {}) {
  const context = { apiKey: "fixture-key", keyValid: true, currentModel: "gpt-4o", ...initial };
  const requests = [], writes = [];
  const picker = createController({ getContext: () => ({ ...context }),
    requestModels: input => { requests.push(input); return request ? request(input) : Promise.resolve(response(["gpt-4o", "gpt-4.1", "gpt-5.5"])); },
    saveModel: async id => { writes.push(id); return save ? save(id, context) : { llmModel: id }; } });
  return { picker, context, requests, writes, state: () => picker.getSnapshot() };
}

test("Setup uses a compact model row and native sheet without an editable model id", () => {
  const html = renderToStaticMarkup(createElement(AppleSetupSection, { profile: profileApi.createDefaultProfile(), save: async () => {} }));
  assert.match(html, /class="model-picker-setting"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /GPT-4o/);
  assert.match(html, /<dialog[^>]*class="ios-sheet"/);
  assert.match(html, /Choose A Model/);
  assert.doesNotMatch(html, /<input[^>]*(?:id|name)="llmModel"/);
});

test("model discovery only starts on sheet open and requires a validated current key", async () => {
  const h = setup({ initial: { keyValid: false } });
  assert.equal(h.requests.length, 0);
  h.picker.open(); await tick();
  assert.equal(h.requests.length, 0);
  assert.equal(h.state().status, "needs_key");
  h.context.keyValid = true; h.picker.syncContext(); await tick();
  assert.equal(h.requests.length, 1);
  assert.equal(h.state().status, "ready");
});

test("only returned compatible full models are selectable and recommended metadata is local", async () => {
  const h = setup({ request: async () => response(["gpt-4o", "gpt-4o", "gpt-4o-mini", "gpt-4.1-nano", "gpt-future-unknown", "gpt-4.1"]) });
  h.picker.open(); await tick();
  assert.deepEqual(h.state().models.map(model => model.id), ["gpt-4o", "gpt-4.1"]);
  assert.equal(h.state().models[0].recommended, true);
  h.picker.choose("gpt-4o-mini");
  assert.equal(h.state().draftId, "gpt-4o");
  h.picker.choose("gpt-5.5");
  assert.equal(h.state().draftId, "gpt-4o");
});

test("draft choice is not saved until Done and Cancel preserves the original setting", async () => {
  const h = setup(); h.picker.open(); await tick(); h.picker.choose("gpt-4.1");
  assert.deepEqual(h.writes, []);
  assert.equal(h.state().draftId, "gpt-4.1");
  h.picker.close();
  assert.equal(h.state().draftId, "gpt-4o");
  assert.deepEqual(h.writes, []);
  h.picker.open(); await tick(); h.picker.choose("gpt-4.1"); await h.picker.confirm();
  assert.deepEqual(h.writes, ["gpt-4.1"]);
  assert.equal(h.state().open, false);
});

test("late responses from an old API key cannot populate or authorize the new key", async () => {
  const old = deferred(), fresh = deferred();
  const h = setup({ request: ({ apiKey }) => apiKey === "fixture-key" ? old.promise : fresh.promise });
  h.picker.open(); h.context.apiKey = "different-key"; h.picker.syncContext();
  assert.equal(h.requests.length, 2);
  old.resolve(response(["gpt-5.5"])); await tick();
  assert.equal(h.state().status, "loading"); assert.deepEqual(h.state().models, []);
  fresh.resolve(response(["gpt-4.1"])); await tick();
  assert.deepEqual(h.state().models.map(model => model.id), ["gpt-4.1"]);
  await h.picker.confirm(); assert.deepEqual(h.writes, []);
});

test("key changes invalidate selectable models before effects run and missing validation clears results", async () => {
  const h = setup(); h.picker.open(); await tick(); h.picker.choose("gpt-4.1");
  h.context.apiKey = "another-key"; h.context.keyValid = false;
  await h.picker.confirm(); await tick();
  assert.deepEqual(h.writes, []); assert.deepEqual(h.state().models, []);
  assert.equal(h.state().status, "needs_key"); assert.equal(h.state().draftId, "gpt-4o");
});

test("an externally changed current model during discovery restarts the request instead of sticking loading", async () => {
  const old = deferred(); let call = 0;
  const h = setup({ request: () => ++call === 1 ? old.promise : Promise.resolve(response(["gpt-4o", "gpt-4.1"])) });
  h.picker.open(); h.context.currentModel = "gpt-4.1"; h.picker.syncContext(); await tick();
  assert.equal(h.requests.length, 2); assert.equal(h.state().status, "ready");
  assert.equal(h.state().draftId, "gpt-4.1");
  old.resolve(response(["gpt-5.5"])); await tick();
  assert.deepEqual(h.state().models.map(model => model.id), ["gpt-4o", "gpt-4.1"]);
});

test("an external model edit before Done cannot be overwritten by a stale draft", async () => {
  const h = setup(); h.picker.open(); await tick(); h.picker.choose("gpt-4.1");
  h.context.currentModel = "gpt-5.5"; await h.picker.confirm(); await tick();
  assert.deepEqual(h.writes, []); assert.equal(h.state().draftId, "gpt-5.5");
});

test("closing or unmounting invalidates in-flight discovery without saving", async () => {
  for (const action of ["close", "dispose"]) {
    const pending = deferred(); const h = setup({ request: () => pending.promise });
    h.picker.open(); h.picker[action](); pending.resolve(response(["gpt-5.5"])); await tick();
    assert.notEqual(h.state().status, "ready"); assert.deepEqual(h.writes, []);
  }
});

test("React StrictMode cleanup and setup keep discovery usable and ignore the cancelled generation", async () => {
  const old = deferred(); let call = 0;
  const h = setup({ request: () => ++call === 1 ? old.promise : Promise.resolve(response(["gpt-4.1"])) });
  h.picker.open(); h.picker.dispose(); h.picker.activate(); h.picker.close(); h.picker.open(); await tick();
  old.resolve(response(["gpt-5.5"])); await tick();
  assert.equal(h.state().status, "ready"); assert.deepEqual(h.state().models.map(model => model.id), ["gpt-4.1"]);
});

test("failed or absent worker responses retain the current setting and allow an explicit retry", async () => {
  for (const failure of [undefined, { ok: false, error: "No model-list permission" }]) {
    let call = 0;
    const h = setup({ request: async () => ++call === 1 ? failure : response(["gpt-4o"]) });
    h.picker.open(); await tick();
    assert.equal(h.state().status, "error"); assert.deepEqual(h.writes, []); assert.equal(h.state().draftId, "gpt-4o");
    await h.picker.refresh(); assert.equal(h.state().status, "ready"); assert.equal(h.requests[1].force, true);
  }
});

test("repeated open or refresh clicks cannot issue overlapping discovery messages", async () => {
  const pending = deferred(); const h = setup({ request: () => pending.promise });
  h.picker.open(); h.picker.open(); h.picker.refresh(); h.picker.refresh();
  assert.equal(h.requests.length, 1);
  pending.resolve(response(["gpt-4o"])); await tick();
});

test("Done uses one save and cannot be dismissed or reselected while storage is pending", async () => {
  const pending = deferred(); const h = setup({ save: () => pending.promise });
  h.picker.open(); await tick(); h.picker.choose("gpt-4.1");
  const done = h.picker.confirm(); h.picker.confirm(); h.picker.close(); h.picker.choose("gpt-5.5"); h.picker.refresh();
  assert.deepEqual(h.writes, ["gpt-4.1"]); assert.equal(h.state().saving, true); assert.equal(h.state().open, true);
  pending.resolve({ llmModel: "gpt-4.1" }); await done;
  assert.equal(h.state().open, false); assert.equal(h.state().saving, false);
});

test("persistence failures retain the draft and a missing save result does not claim success", async () => {
  for (const save of [async () => { throw new Error("Storage failed"); }, async () => undefined]) {
    const h = setup({ save }); h.picker.open(); await tick(); h.picker.choose("gpt-4.1"); await h.picker.confirm();
    assert.equal(h.state().open, true); assert.equal(h.state().draftId, "gpt-4.1"); assert.equal(h.state().saving, false); assert.ok(h.state().error);
  }
});

test("an optimistic profile update followed by storage failure still retries the failed write", async () => {
  let call = 0;
  const h = setup({ save: async (id, context) => { context.currentModel = id; if (++call === 1) throw new Error("Storage failed"); return { llmModel: id }; } });
  h.picker.open(); await tick(); h.picker.choose("gpt-4.1"); await h.picker.confirm();
  assert.equal(h.state().open, true);
  await h.picker.confirm();
  assert.deepEqual(h.writes, ["gpt-4.1", "gpt-4.1"]); assert.equal(h.state().open, false);
});

test("legacy mini and unavailable selections remain visible without an automatic fallback", async () => {
  const h = setup({ initial: { currentModel: "gpt-4o-mini" } }); h.picker.open(); await tick();
  assert.equal(h.state().draftId, "gpt-4o-mini"); await h.picker.confirm(); assert.deepEqual(h.writes, []);
  const html = renderToStaticMarkup(createElement(ModelPickerSheet, { state: h.state(), currentModel: h.context.currentModel, search: "", onSearch() {}, picker: h.picker }));
  assert.match(html, /gpt-4o-mini/); assert.match(html, /outside Rolebeam/); assert.match(html, /It has not been changed/);
  assert.match(html, /disabled="">Done/);
});

test("search is case-insensitive, recommendations are deduplicated, and empty searches are clear", () => {
  const state = { open: true, status: "ready", models: ["gpt-4o", "gpt-4.1", "gpt-5.5"].map(id => catalog.getModel(id)), draftId: "gpt-4o" };
  const render = search => renderToStaticMarkup(createElement(ModelPickerSheet, { state, currentModel: "gpt-4o", search, onSearch() {}, picker: {} }));
  const all = render("");
  assert.match(all, /Recommended/); assert.match(all, /More Compatible Models/);
  assert.equal((all.match(/class="model-picker-option"/g) || []).length, 3);
  const searched = render("GPT-4.1");
  assert.equal((searched.match(/class="model-picker-option"/g) || []).length, 1);
  assert.doesNotMatch(searched, />Recommended</);
  assert.match(render("not-a-model"), /No matching models/);
  assert.match(all, /Availability does not guarantee quota/);
});
