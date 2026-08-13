import { ItemList } from "./ItemList";

export function ExtractResultPanel({ data }) {
  if (!data) {
    return null;
  }

  return (
    <section id="result" className="result">
      <div className="row">
        <span>Decision</span>
        <strong>{data.alreadySubmitted ? "Already submitted" : data.decision}</strong>
      </div>
      <div className="row">
        <span>Required YOE</span>
        <strong>{data.requiredYears === null ? "Unknown" : `${data.requiredYears} years`}</strong>
      </div>
      <div className="row">
        <span>Job ID</span>
        <strong>{data.jobId}</strong>
      </div>
      <div className="row">
        <span>Local fit score</span>
        <strong>{data.matchScore ? `${data.matchScore.percentage}%` : "Unknown"}</strong>
      </div>
      <div className="row stacked">
        <span>Matched keywords</span>
        <strong>{data.resumeMatch?.keywords?.length ? data.resumeMatch.keywords.join(", ") : "None"}</strong>
      </div>
      <div className="row stacked">
        <span>Scoring reasons</span>
        <strong>{data.matchScore?.reasons?.length ? data.matchScore.reasons.join("; ") : "None"}</strong>
      </div>

      <h2>Matched Sentences</h2>
      <ItemList
        items={data.matches || []}
        emptyMessage="No years-of-experience sentences found."
        renderItem={(match) => `${match.type}: ${match.sentence}`}
      />

      <h2>Requirement Preview</h2>
      <pre>{data.preview || "No preview text found."}</pre>
    </section>
  );
}
