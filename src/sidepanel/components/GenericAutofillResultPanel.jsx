import { ItemList } from "./ItemList";

function buildSummary(data) {
  const parts = data.clickedApplyEntry
    ? [`No form found yet -- clicked "${data.applyEntryLabel}" to start the application. Click Autofill again once it loads.`]
    : [`Filled ${data.filledFields.length} field(s) on ${data.hostname}.`];

  if (data.flaggedFields.length) {
    parts.push(`${data.flaggedFields.length} field(s) need your review.`);
  }
  if (data.needsResumeUpload) {
    parts.push(data.resumeUploaded ? "Resume attached." : "Resume was not attached.");
  }
  if (data.submitted) {
    parts.push("Submitted.");
  }

  return parts.join(" ");
}

export function GenericAutofillResultPanel({ data }) {
  if (!data) {
    return null;
  }

  return (
    <section id="genericAutofillResult" className="result">
      <div className="summary-grid">
        <span>Filled</span>
        <strong>{data.filledFields.length}</strong>
        <span>Needs review</span>
        <strong>{data.flaggedFields.length}</strong>
      </div>
      <p className="muted">{buildSummary(data)}</p>

      <h2>Activity Log</h2>
      <ItemList
        className="trace-log"
        items={data.trace || []}
        emptyMessage="No trace recorded."
        renderItem={(line) => line}
      />

      <details className="progress-details">
        <summary>Filled fields</summary>
        <ItemList
          items={data.filledFields}
          emptyMessage="No fields were filled."
          renderItem={(field) => `${field.label}: ${field.value}`}
        />
      </details>

      <details className="progress-details">
        <summary>Flagged for review</summary>
        <ItemList items={data.flaggedFields} emptyMessage="Nothing flagged." renderItem={(field) => field.reason} />
      </details>
    </section>
  );
}
