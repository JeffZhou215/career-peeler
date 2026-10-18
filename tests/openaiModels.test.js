const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const catalog = require("../lib/openaiModelCatalog.js");
const core = require("../lib/core.js");
const { createBackgroundHarness } = require("./helpers/appleWorkflowHarness.cjs");

async function withFetch(fetch, run) {
  const original = global.fetch;
  global.fetch = fetch;
  try { return await run(); } finally { global.fetch = original; }
}
const modelsResponse = data => ({ ok: true, status: 200, json: async () => ({ object: "list", data }) });

test("the model policy loads in both classic-script and CommonJS contexts", () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../lib/openaiModelCatalog.js"), "utf8"), sandbox);
  assert.equal(sandbox.RolebeamOpenAiModels.isSupportedModel("gpt-4o"), true);
  assert.equal(core.isSupportedOpenAiModel("gpt-4o"), true);
  assert.equal(catalog.getModel("gpt-4o").recommended, true);
});

test("available models intersect explicit compatibility policy, deduplicate and retain only accessible recommendations", () => {
  const ids = ["gpt-4o", "gpt-4o", "gpt-6.1-sol", "gpt-4.1-2025-04-14", "gpt-5.2",
    "gpt-4o-mini", "gpt-5-nano", "gpt-6-luna", "gpt-4o-audio-preview", "chatgpt-4o-latest",
    "gpt-5.5-codex", "gpt-5.5-pro", "gpt-4o-search-preview", "o3", "text-embedding-3-large",
    "ft:gpt-4o:private", "gpt-7", "gpt-4o-2024-05-13"];
  const models = catalog.filterAvailableModels({ data: [...ids.map(id => ({ id })), null, {}, { id: 17 }] });
  assert.deepEqual(models.map(model => model.id), ["gpt-6.1-sol", "gpt-4o", "gpt-5.2", "gpt-4.1-2025-04-14"]);
  assert.deepEqual(models.filter(model => model.recommended).map(model => model.id), ["gpt-6.1-sol", "gpt-4o"]);
  assert.equal(models.some(model => model.id === "gpt-5.5"), false, "catalog membership alone does not prove key access");
});

test("shutdown models are excluded even if otherwise supported", () => {
  const models = catalog.filterAvailableModels({ data: [
    { id: "gpt-4o", shutdown_date: "2026-10-18" },
    { id: "gpt-5.5", shutdown_date: Date.parse("2026-10-17T00:00:00Z") / 1000 },
    { id: "gpt-4.1", shutdown_date: "bad-date" },
    { id: "gpt-5.2", shutdown_date: "2027-01-01" }
  ] }, new Date("2026-10-18T12:00:00Z"));
  assert.deepEqual(models.map(model => model.id), ["gpt-5.2"]);
  assert.deepEqual(catalog.filterAvailableModels({ data: [] }, "bad-date"), []);
});

test("chat parameters preserve GPT-4 temperature and omit unsupported reasoning-family sampling parameters", () => {
  assert.deepEqual(catalog.chatParameters("gpt-4o", 0), { model: "gpt-4o", temperature: 0 });
  assert.deepEqual(catalog.chatParameters("gpt-4.1-2025-04-14", 0.1), { model: "gpt-4.1-2025-04-14", temperature: 0.1 });
  for (const id of ["gpt-5", "gpt-5.5-2026-04-23", "gpt-6.1-sol", "gpt-6-astra"]) {
    assert.deepEqual(catalog.chatParameters(id, 0), { model: id });
  }
});

test("legacy mini, nano and unknown saved models fail before a generation request or counter increment", async () => {
  const previousCount = core.getOpenAiCallCount();
  let calls = 0;
  await withFetch(async () => { calls++; throw new Error("must not request"); }, async () => {
    for (const model of ["gpt-4o-mini", "gpt-5-mini", "gpt-5-nano", "gpt-unknown", ""]) {
      await assert.rejects(core.callOpenAi([], { model, apiKey: "sk-offline" }), /supported|compatible/i);
    }
  });
  assert.equal(calls, 0);
  assert.equal(core.getOpenAiCallCount(), previousCount);
});

test("a selected full reasoning model sends a compatible JSON/PDF chat payload", async () => {
  let body;
  await withFetch(async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "{}" } }] }) };
  }, async () => {
    await core.callOpenAi([{ role: "user", content: [{ type: "file", file: { file_data: "synthetic-pdf", filename: "resume.pdf" } }] }],
      { model: "gpt-6.1-sol", apiKey: "sk-offline" });
  });
  assert.equal(body.model, "gpt-6.1-sol");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.messages[0].content[0].type, "file");
  assert.equal(Object.hasOwn(body, "temperature"), false);
  assert.equal(Object.hasOwn(body, "reasoning_effort"), false);
});

test("model discovery authenticates only GET /v1/models and preserves its checked timestamp while cached", async () => {
  let calls = 0;
  const key = "sk-model-discovery-cache";
  const count = core.getOpenAiCallCount();
  await withFetch(async (url, options) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/models");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.body, undefined);
    return modelsResponse([{ id: "gpt-4o" }, { id: "gpt-4o-mini" }]);
  }, async () => {
    const first = await core.listAvailableOpenAiModels(key, { now: 1000 });
    first.models[0].id = "corrupted-caller-copy";
    const cached = await core.listAvailableOpenAiModels(key, { now: 2000 });
    assert.equal(cached.checkedAt, new Date(1000).toISOString());
    assert.equal(cached.models[0].id, "gpt-4o");
    assert.equal(calls, 1);
    await core.listAvailableOpenAiModels(key, { now: 301000 });
    assert.equal(calls, 2, "five-minute expiry requires a fresh access read");
    assert.equal(JSON.stringify(cached).includes(key), false);
  });
  assert.equal(core.getOpenAiCallCount(), count, "listing models never counts as generation");
});

test("duplicate model requests coalesce while separate keys never share availability", async () => {
  let release;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await withFetch(async (_url, options) => {
    calls++;
    await gate;
    return modelsResponse([{ id: options.headers.Authorization.endsWith("-a") ? "gpt-4o" : "gpt-5.5" }]);
  }, async () => {
    const a = core.listAvailableOpenAiModels("sk-coalesce-a");
    const again = core.listAvailableOpenAiModels("sk-coalesce-a");
    const b = core.listAvailableOpenAiModels("sk-coalesce-b");
    assert.equal(calls, 2);
    release();
    const results = await Promise.all([a, again, b]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0].models[0].id, "gpt-4o");
    assert.equal(results[2].models[0].id, "gpt-5.5");
  });
});

test("explicit Refresh bypasses a fresh cache and coalesces with another forced refresh", async () => {
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const key = "sk-force-refresh";
  await withFetch(async () => {
    calls++;
    if (calls > 1) await gate;
    return modelsResponse([{ id: calls > 1 ? "gpt-5.5" : "gpt-4o" }]);
  }, async () => {
    const cached = await core.listAvailableOpenAiModels(key, { now: 1000 });
    assert.equal(cached.models[0].id, "gpt-4o");
    const refreshed = core.listAvailableOpenAiModels(key, { force: true, now: 2000 });
    const duplicate = core.listAvailableOpenAiModels(key, { force: true, now: 2000 });
    assert.equal(calls, 2);
    release();
    const [first, second] = await Promise.all([refreshed, duplicate]);
    assert.deepEqual(first, second);
    assert.equal(first.models[0].id, "gpt-5.5");
    assert.equal(first.checkedAt, new Date(2000).toISOString());
    const later = await core.listAvailableOpenAiModels(key, { now: 3000 });
    assert.equal(later.checkedAt, first.checkedAt);
    assert.equal(calls, 2);
  });
});

test("model-discovery failures are actionable, redacted, and never cached as successful empty lists", async () => {
  for (const [name, responder, pattern] of [
    ["authentication", async () => ({ ok: false, status: 401 }), /key/i],
    ["rate-limit", async () => ({ ok: false, status: 429 }), /429/],
    ["malformed", async () => ({ ok: true, json: async () => ({ object: "list" }) }), /invalid model list/i],
    ["network", async () => { throw new Error("network failure sk-failure-network"); }, /network failure \[redacted\]/]
  ]) {
    const key = `sk-failure-${name}`;
    await withFetch(responder, async () => {
      await assert.rejects(core.listAvailableOpenAiModels(key), error => {
        assert.match(error.message, pattern);
        assert.equal(error.message.includes(key), false);
        return true;
      });
    });
    await withFetch(async () => modelsResponse([{ id: "gpt-4o" }]), async () => {
      assert.equal((await core.listAvailableOpenAiModels(key)).models[0].id, "gpt-4o");
    });
  }
  await assert.rejects(core.listAvailableOpenAiModels(""), /API key/i);
});

test("a valid key with no compatible full models has a genuine empty available list", async () => {
  await withFetch(async () => modelsResponse([{ id: "gpt-4o-mini" }]), async () => {
    assert.deepEqual((await core.listAvailableOpenAiModels("sk-only-mini")).models, []);
  });
});

test("model discovery times out and permits a later retry", async () => {
  await withFetch(async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")));
  }), async () => {
    await assert.rejects(core.listAvailableOpenAiModels("sk-timeout", { timeoutMs: 5 }), /timed out/i);
  });
  await withFetch(async () => modelsResponse([{ id: "gpt-4o" }]), async () => {
    assert.equal((await core.listAvailableOpenAiModels("sk-timeout")).models.length, 1);
  });
});

test("the worker model endpoint accepts its own extension page and rejects content/foreign senders", async () => {
  const { sandbox, ready } = createBackgroundHarness();
  await ready;
  sandbox.chrome.runtime.id = "rolebeam-test";
  sandbox.AbortController = AbortController;
  let calls = 0;
  sandbox.fetch = async () => { calls++; return modelsResponse([{ id: "gpt-4o" }]); };
  for (const sender of [
    { tab: { id: 1 }, id: "rolebeam-test" },
    { id: "other-extension" },
    { id: "rolebeam-test", url: "https://jobs.apple.com/app/en-us/profile/roles" },
    { id: "rolebeam-test", url: "chrome-extension://other-extension/sidepanel.html" }
  ]) {
    const response = await sandbox.dispatch({ type: "APPLE_CAREERS_LIST_OPENAI_MODELS", apiKey: "sk-worker-models" }, sender);
    assert.equal(response.ok, false);
    assert.match(response.error, /Setup page/i);
  }
  assert.equal(calls, 0);
  const response = await sandbox.dispatch({ type: "APPLE_CAREERS_LIST_OPENAI_MODELS", apiKey: "sk-worker-models" },
    { id: "rolebeam-test", url: "chrome-extension://rolebeam-test/sidepanel.html" });
  assert.equal(response.ok, true);
  assert.equal(response.data.models[0].id, "gpt-4o");
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(response).includes("sk-worker-models"), false);
  await sandbox.dispatch({ type: "APPLE_CAREERS_LIST_OPENAI_MODELS", apiKey: "sk-worker-models", force: true },
    { id: "rolebeam-test", url: "chrome-extension://rolebeam-test/sidepanel.html" });
  assert.equal(calls, 2, "the explicit refresh flag reaches the discovery cache");
});

test("cached auto-apply and submitted-role analysis cannot bypass an unsupported saved model", async () => {
  const { sandbox, ready } = createBackgroundHarness();
  await ready;
  const profile = core.normalizeUserProfile({ scanMode: "auto_apply", llmEnabled: true,
    llmApiKey: "sk-never-request", llmModel: "gpt-4o-mini",
    eeoGender: "male", eeoRaceEthnicity: ["asian"], eeoVeteranStatus: "not_protected_veteran", eeoDisabilityStatus: "no_current_or_past" });
  assert.match(sandbox.getAutoApplyReadinessError(profile), /supported full/i);
  await assert.rejects(sandbox.scoreAppleSubmittedRoles([{ jobId: "200123456", title: "Synthetic role" }], profile), /supported full/i);
});
