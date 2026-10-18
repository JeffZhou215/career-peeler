// Shared compatibility policy for the classic MV3 worker and the bundled panel.
// /v1/models reports access, not input modalities or matching quality. Only models
// reviewed for Rolebeam's PDF + JSON chat workflow may be offered or executed.
(function (root) {
  "use strict";

  const definitions = [
    ["gpt-6.1-sol", "GPT-6.1 Sol", "General-purpose model for resume extraction and matching.", true],
    ["gpt-5.5", "GPT-5.5", "General-purpose model for resume extraction and matching.", true, "2026-04-23"],
    ["gpt-4o", "GPT-4o", "Rolebeam's default full model for resume extraction and matching.", true, "2024-08-06", "2024-11-20"],
    ["gpt-6-astra", "GPT-6 Astra", "General-purpose model for resume extraction and matching.", false],
    ["gpt-6-sol", "GPT-6 Sol", "General-purpose model for resume extraction and matching.", false],
    ["gpt-5.4", "GPT-5.4", "General-purpose model for resume extraction and matching.", false, "2026-03-05"],
    ["gpt-5.2", "GPT-5.2", "General-purpose model for resume extraction and matching.", false, "2025-12-11"],
    ["gpt-5.1", "GPT-5.1", "General-purpose model for resume extraction and matching.", false, "2025-11-13"],
    ["gpt-5", "GPT-5", "General-purpose model for resume extraction and matching.", false, "2025-08-07"],
    ["gpt-4.1", "GPT-4.1", "General-purpose model for resume extraction and matching.", false, "2025-04-14"]
  ];
  const models = definitions.flatMap(([id, label, description, recommended, ...snapshots]) => [
    Object.freeze({ id, label, description, recommended }),
    ...snapshots.map(date => Object.freeze({ id: `${id}-${date}`, label: `${label} (${date})`,
      description: "Dated model snapshot for resume extraction and matching.", recommended: false }))
  ]);
  const byId = new Map(models.map(model => [model.id, model]));

  function getModel(id) {
    return typeof id === "string" ? byId.get(id) || null : null;
  }

  function isSupportedModel(id) { return Boolean(getModel(id)); }

  function shutdownTime(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value * 1000;
    return typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
  }

  function filterAvailableModels(payload, currentDate = new Date()) {
    const now = new Date(currentDate).getTime();
    if (!Array.isArray(payload?.data) || !Number.isFinite(now)) return [];
    const available = new Set();
    for (const item of payload.data) {
      if (!item || typeof item !== "object" || !isSupportedModel(item.id)) continue;
      // A provider shutdown annotation overrides catalog membership. Malformed
      // non-null annotations are not enough evidence that a model is usable.
      if (item.shutdown_date != null) {
        const shutdownAt = shutdownTime(item.shutdown_date);
        if (!Number.isFinite(shutdownAt) || shutdownAt <= now) continue;
      }
      available.add(item.id);
    }
    return models.filter(model => available.has(model.id)).map(model => ({ ...model }));
  }

  function chatParameters(model, temperature = 0.1) {
    if (!isSupportedModel(model)) {
      throw new Error("This saved model is not compatible with Rolebeam. Choose a supported full model in Setup; mini and nano models are not supported.");
    }
    // The reasoning families reject sampling temperature in their default mode.
    // Do not change reasoning settings or force a mode unsupported by an alias.
    return /^gpt-[56](?:[.-]|$)/.test(model) ? { model } : { model, temperature };
  }

  const api = Object.freeze({ getModel, isSupportedModel, filterAvailableModels, chatParameters });
  root.RolebeamOpenAiModels = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
