import { AutofillActivityLog } from "./AutofillActivityLog";
import { formatRelativeTime } from "../lib/format";
export function AppleActivity({ view }) {
  const failures = view?.applicationFailures || [];
  const unresolved = failures.filter((job) => job.status !== "submitted");
  return <details className="ios-activity"><summary><span>Activity</span><span className="function-meta">{unresolved.length ? `${unresolved.length} Needs Review` : view?.running ? "Running" : "Saved"}</span></summary>
    <div className="compact-fold-body">
      {!!failures.length && <ul className="queue-failure-list">{failures.map((job) => <li key={job.jobId}>
        <a className="queue-failure-title" href={job.url} target="_blank" rel="noopener noreferrer">{job.title || "Open Job"}</a>
        <span className="compact-role-meta">{job.jobId} · {job.status === "submitted" ? "Submitted Later" : job.submissionOutcomeUnknown && !job.verifiedAbsentAt ? "Outcome Unknown" : "Manual Review"}</span>
        <p>{job.reason}</p>{job.lastStep && <span className="compact-role-meta">Last Step: {job.lastStep}</span>}
        {job.applicationHeading && <span className="compact-role-meta">Application Step: {job.applicationHeading}</span>}
        <span className="compact-role-meta">{formatRelativeTime(job.failedAt)}</span>
      </li>)}</ul>}
      <AutofillActivityLog storageKey="appleCareersKnownSiteActivity" />
      {!failures.length && !view?.phase && <p className="muted">No Activity Yet.</p>}
    </div>
  </details>;
}
