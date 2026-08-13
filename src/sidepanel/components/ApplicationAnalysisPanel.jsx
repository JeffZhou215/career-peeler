import { ItemList } from "./ItemList";

export function ApplicationAnalysisPanel({ data }) {
  if (!data) {
    return null;
  }

  return (
    <section id="applicationAnalysis" className="result">
      <h2>Application Page Analysis</h2>
      <div className="scan-grid">
        <span>Fields</span>
        <strong>{data.fieldCount}</strong>
        <span>Required</span>
        <strong>{data.requiredCount}</strong>
        <span>Unsupported/unknown</span>
        <strong>{data.unsupportedCount}</strong>
        <span>Forms</span>
        <strong>{data.formCount}</strong>
      </div>
      <p className="muted">{data.summary}</p>
      <h2>Detected Fields</h2>
      <ItemList
        items={data.fields}
        emptyMessage="No visible fields detected."
        renderItem={(field) => {
          const required = field.required ? "required" : "optional";
          const options = field.options?.length ? ` options: ${field.options.join(", ")}` : "";
          return `${field.index}. ${field.label} (${field.kind}, ${field.category}, ${required})${options}`;
        }}
      />
      <h2>Visible Buttons</h2>
      <ItemList items={data.buttons} emptyMessage="No visible buttons detected." renderItem={(button) => button} />
    </section>
  );
}
