import { modelCatalog } from "./modelCatalog";

// The key and availability list stay in memory. A list from another key or a closed
// sheet can never authorize saving a choice, even if its response arrives late.
export function createModelPickerController({ getContext, requestModels, saveModel }) {
  let state = { open: false, status: "idle", models: [], checkedAt: null, draftId: "", error: "", saving: false };
  let context = getContext();
  let generation = 0;
  let disposed = false;
  let saving = false;
  let failedSaveId = "";
  const listeners = new Set();
  const emit = (updates) => {
    if (disposed) return;
    state = { ...state, ...updates };
    listeners.forEach(listener => listener());
  };
  const sameContext = (a, b) => a.apiKey === b.apiKey && a.keyValid === b.keyValid && a.currentModel === b.currentModel;

  function syncContext() {
    const next = getContext();
    if (sameContext(next, context)) return false;
    const keyChanged = next.apiKey !== context.apiKey || next.keyValid !== context.keyValid;
    context = next;
    generation += 1;
    emit({ draftId: next.currentModel, error: "", ...(keyChanged ? { models: [], checkedAt: null, status: "idle" } : {}) });
    if (state.open && !saving) void load();
    return true;
  }

  async function load(force = false) {
    const next = getContext();
    context = next;
    const ticket = ++generation;
    if (!next.apiKey || !next.keyValid) {
      emit({ status: "needs_key", models: [], checkedAt: null, error: "" });
      return;
    }
    emit({ status: "loading", error: "", models: [], checkedAt: null });
    try {
      const response = await requestModels({ apiKey: next.apiKey, force });
      if (disposed || ticket !== generation || !state.open || !sameContext(getContext(), next)) return;
      if (response?.ok !== true || !Array.isArray(response?.data?.models)) {
        throw new Error(response?.error || response?.message || "Could not load models. Try Refresh Models.");
      }
      const seen = new Set();
      const models = response.data.models.filter(model => {
        if (!modelCatalog.isSupportedModel(model?.id) || seen.has(model.id)) return false;
        seen.add(model.id);
        return true;
      }).map(model => ({ ...modelCatalog.getModel(model.id), id: model.id }));
      emit({ status: "ready", models, checkedAt: response.data.checkedAt || null });
    } catch (error) {
      if (!disposed && ticket === generation && state.open && sameContext(getContext(), next)) {
        emit({ status: "error", models: [], checkedAt: null, error: error?.message || "Could not load models. Try Refresh Models." });
      }
    }
  }

  function open() {
    if (saving || disposed || state.open) return;
    context = getContext();
    emit({ open: true, draftId: context.currentModel, error: "" });
    void load();
  }
  function close() {
    if (saving || disposed) return;
    generation += 1;
    emit({ open: false, draftId: getContext().currentModel, error: "", status: "idle" });
  }
  function choose(id) {
    if (saving || !state.open || state.status !== "ready" || syncContext()) return;
    if (state.models.some(model => model.id === id)) emit({ draftId: id, error: "" });
  }
  async function confirm() {
    if (saving || disposed || !state.open) return;
    if (syncContext()) {
      emit({ error: "Your settings changed. Review the current selection before saving." });
      return;
    }
    if (!context.keyValid || state.status !== "ready" || !state.models.some(model => model.id === state.draftId)) return;
    const selected = state.draftId;
    const savingContext = context;
    if (selected === context.currentModel && failedSaveId !== selected) { close(); return; }
    saving = true;
    emit({ saving: true, error: "" });
    try {
      const saved = await saveModel(selected);
      if (!saved || saved.llmModel !== selected) throw new Error("The model selection was not saved. Try again.");
      failedSaveId = "";
      if (!disposed) {
        const latest = getContext();
        if (latest.apiKey !== savingContext.apiKey || latest.keyValid !== savingContext.keyValid || ![savingContext.currentModel, selected].includes(latest.currentModel)) {
          emit({ error: "Your settings changed while saving. Review the current model before continuing.", draftId: latest.currentModel });
          return;
        }
        generation += 1;
        context = getContext();
        emit({ open: false, status: "idle", draftId: context.currentModel });
      }
    } catch (error) {
      // useUserProfile updates React optimistically before storage completes. A
      // rejected write must still be retried, even if the row now shows this id.
      failedSaveId = selected;
      const latest = getContext();
      if (latest.apiKey === savingContext.apiKey && latest.keyValid === savingContext.keyValid && latest.currentModel === selected) context = latest;
      emit({ error: error?.message || "The model selection could not be saved. Try again." });
    } finally {
      saving = false;
      emit({ saving: false });
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    open, close, choose, confirm, syncContext,
    refresh: () => { if (!saving && state.open && state.status !== "loading") { if (syncContext()) return; return load(true); } },
    activate() { disposed = false; },
    dispose() { generation += 1; disposed = true; listeners.clear(); }
  };
}
