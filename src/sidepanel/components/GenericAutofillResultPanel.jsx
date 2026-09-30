import { ItemList } from "./ItemList";

function buildSummary(data) {
  const parts = data.clickedApplyEntry
    ? [`No form found yet -- clicked "${data.applyEntryLabel}" to start the application. Click Autofill again once it loads.`]
    : [
        `Filled ${data.filledFields.length} field(s) on ${data.hostname}${
          data.workdayPagesProcessed ? ` across ${data.workdayPagesProcessed} Workday page(s)` : ""
        }.`
      ];

  if (data.flaggedFields.length) {
    parts.push(`${data.flaggedFields.length} field(s) need your review.`);
  }
  if (data.needsResumeUpload) {
    parts.push(data.resumeUploaded ? "Resume attached." : "Resume was not attached.");
  }
  if (data.confirmationPending) {
    parts.push("Submit clicked; confirmation pending.");
  } else if (data.submitAttempted && !data.submitClicked) {
    parts.push("Submit button could not be clicked.");
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
        <span>Needs Review</span>
        <strong>{data.flaggedFields.length}</strong>
      </div>
      <p className="muted">{buildSummary(data)}</p>

      <details className="progress-details">
        <summary>Filled Fields</summary>
        <ItemList
          items={data.filledFields}
          emptyMessage="No fields were filled."
          renderItem={(field) => `${field.label}: ${field.value}`}
        />
      </details>

      <details className="progress-details">
        <summary>Flagged For Review</summary>
        <ItemList items={data.flaggedFields} emptyMessage="Nothing flagged." renderItem={(field) => field.reason} />
      </details>
    </section>
  );
}
