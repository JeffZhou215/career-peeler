import { useId, useState } from "react";
import { Sheet } from "./Sheet";
import { useModelDiscovery } from "../hooks/useModelDiscovery";
import { modelCatalog } from "../lib/modelCatalog";

export function ModelPickerSheet({ state, currentModel, search, onSearch, picker }) {
  const searchId = useId();
  const query = search.trim().toLowerCase();
  const matches = state.models.filter(model => `${model.label} ${model.id} ${model.description || ""}`.toLowerCase().includes(query));
  const recommended = matches.filter(model => model.recommended);
  const other = matches.filter(model => !model.recommended);
  const current = modelCatalog.getModel(currentModel);
  const currentAvailable = state.status === "ready" && state.models.some(model => model.id === currentModel);
  const canSave = !state.saving && state.status === "ready" && state.models.some(model => model.id === state.draftId);
  function rows(models) {
    return <div className="model-picker-list" role="group">{models.map(model => <button type="button" key={model.id}
      className="model-picker-option" aria-pressed={state.draftId === model.id} disabled={state.saving} onClick={() => picker.choose(model.id)}>
      <span className="model-picker-copy"><strong>{model.label}</strong><span className="model-picker-id">{model.id}</span></span>
      <span className="model-picker-check" aria-hidden="true">{state.draftId === model.id ? "✓" : ""}</span>
    </button>)}</div>;
  }
  return <Sheet open={state.open} onClose={picker.close} title="Choose A Model" busy={state.saving}>
    <div className="model-picker-content">
    <p className="model-picker-current"><span className="muted">Current Model</span><strong>{current?.label || currentModel || "Not Set"}</strong>{currentModel && <span>{currentModel}</span>}</p>
    {currentModel && !modelCatalog.isSupportedModel(currentModel) && <p className="model-picker-warning">This saved model is outside Rolebeam’s GPT-4o quality baseline. Choose a supported model to continue using AI matching.</p>}
    {state.status === "ready" && currentModel && !currentAvailable && <p className="model-picker-warning">Your saved model is not in the available compatible list for this key. It has not been changed.</p>}
    <label className="visually-hidden" htmlFor={searchId}>Search Compatible Models</label>
    <input id={searchId} type="search" className="model-picker-search" value={search} onChange={event => onSearch(event.target.value)} placeholder="Search Models" autoComplete="off" disabled={state.saving} />
    <div className="model-picker-status" aria-live="polite">
      {state.status === "loading" && <span><span className="submission-sync-spinner" aria-hidden="true" />Loading Models…</span>}
      {state.status === "needs_key" && <p>Add and test your OpenAI API key in AI Matching, then reopen this sheet.</p>}
      {state.status === "ready" && state.models.length > 0 && <span>Available To This Key · {state.models.length} Compatible Models</span>}
      {state.status === "ready" && state.models.length === 0 && <p>No compatible full models are available to this key. Check the project’s model permissions, then refresh.</p>}
      {state.error && <p className="model-picker-warning" role="alert">{state.error}</p>}
    </div>
    {state.status === "ready" && <>
      {recommended.length > 0 && <section className="model-picker-section"><h3>Recommended</h3>{rows(recommended)}</section>}
      {other.length > 0 && <section className="model-picker-section"><h3>{recommended.length ? "More Compatible Models" : "Compatible Models"}</h3>{rows(other)}</section>}
      {state.models.length > 0 && matches.length === 0 && <p className="muted">No matching models.</p>}
    </>}
    <p className="muted model-picker-footer">Full models from the GPT-4o baseline. Mini and nano excluded. Availability does not guarantee quota.</p>
    <div className="model-picker-refresh"><button type="button" className="text-action" disabled={state.saving || state.status === "loading" || state.status === "needs_key"} onClick={picker.refresh}>Refresh Models</button></div>
    </div>
    <div className="model-picker-actions"><button type="button" className="secondary" disabled={state.saving} onClick={picker.close}>Cancel</button><button type="button" className="primary" disabled={!canSave} onClick={picker.confirm}>{state.saving ? "Saving…" : "Done"}</button></div>
  </Sheet>;
}

export function ModelPicker({ profile, save }) {
  const { state, picker } = useModelDiscovery({ profile, save });
  const [search, setSearch] = useState("");
  const model = modelCatalog.getModel(profile.llmModel);
  return <>
    <button type="button" className="model-picker-setting" aria-haspopup="dialog" aria-expanded={state.open} onClick={() => { setSearch(""); picker.open(); }}>
      <span>Model</span><span className="model-picker-current-value"><strong>{model?.label || profile.llmModel || "Choose A Model"}</strong><span>{model ? profile.llmModel : "Choose A Supported Model"}</span></span><span aria-hidden="true">›</span>
    </button>
    <ModelPickerSheet state={state} currentModel={profile.llmModel} search={search} onSearch={setSearch} picker={picker} />
  </>;
}
