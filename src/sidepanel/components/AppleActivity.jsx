import { useEffect, useRef, useState } from "react";
import { AutofillActivityLog } from "./AutofillActivityLog";
import { formatRelativeTime, getActiveTab } from "../lib/format";

function FailureDetails({ job }) {
  return <>
    <p>{job.reason}</p>{job.lastStep && <span className="compact-role-meta">Last Step: {job.lastStep}</span>}
    {job.applicationHeading && <span className="compact-role-meta">Application Step: {job.applicationHeading}</span>}
    <span className="compact-role-meta">{formatRelativeTime(job.failedAt)}</span>
  </>;
}
export function ApplicationFailureList({ failures, selectedIds, busy, running, rowFeedback = {}, onSelect, onSelectAll,
  onClear, onReturn, onRetry, onCheck, onOpenSetup }) {
  const unresolved = failures.filter(job => !["submitted", "requeued"].includes(job.status));
  const selectable = unresolved.filter(job => job.canReturnToQueue === true);
  return <>
    {!!unresolved.length && <div className="compact-fold-body retry-selection-controls">
      <div className="compact-actions">
        <button type="button" className="secondary" disabled={busy || running || !selectable.length} onClick={onSelectAll}>Select Retryable</button>
        <button type="button" className="secondary" disabled={busy || running || !selectedIds.length} onClick={onClear}>Clear Selection</button>
      </div>
      <button type="button" className="secondary" disabled={busy || running || !selectedIds.length} onClick={onReturn}>
        {busy ? "Checking Applications…" : `Return Selected To Application Queue (${selectedIds.length})`}
      </button>
      <span className="compact-role-meta">Checks Availability And Capacity. Applications Still Require Review And Confirmation.</span>
    </div>}
    {!!failures.length && <ul className="queue-failure-list">{failures.map(job => {
      const resolved = ["submitted", "requeued"].includes(job.status);
      const unknown = !resolved && (job.submissionOutcomeUnknown !== false || job.retryBlockedType === "submission_outcome_unknown");
      return <li key={job.jobId}>
        <div className="retry-role-heading">
          {!resolved && <input type="checkbox" aria-label={`Select ${job.title || "Role"}, Job ID ${job.jobId}, To Return To Queue`}
            checked={selectedIds.includes(job.jobId)} disabled={busy || running || job.canReturnToQueue !== true}
            onChange={() => onSelect(job.jobId)} />}
        <a className="queue-failure-title" href={job.url} target="_blank" rel="noopener noreferrer">{job.title || "Open Job"}</a>
        </div>
        <span className="compact-role-meta">{job.jobId} · {job.status === "submitted" ? "Submitted Later" : job.status === "requeued" ? "Requeued" : unknown ? "Outcome Unknown" : "Needs Review"}</span>
        {resolved ? <details className="compact-fold"><summary>Previous Failure</summary><div className="compact-fold-body"><FailureDetails job={job} /></div></details> : <>
          <FailureDetails job={job} />
          {job.retryBlockedReason && <span className="compact-role-meta">{job.retryBlockedReason}</span>}
          <div className="compact-actions">
            {job.canReturnToQueue === true && <button type="button" className="secondary" disabled={busy || running}
              aria-label={`Review And Retry ${job.title || job.jobId}`} onClick={() => onRetry(job.jobId)}>Review &amp; Retry</button>}
            {(unknown || job.retryBlockedType === "workflow_recovery_required") && <button type="button" className="secondary" disabled={busy || running} onClick={() => onCheck(job)}>Check Application Status</button>}
            {/answer|eligibility_unresolved/.test(job.errorType || "") && <button type="button" className="secondary" disabled={busy || running} onClick={onOpenSetup}>Complete Answers</button>}
          </div>
        </>}
        {rowFeedback[job.jobId] && <p className="muted" role="status">{rowFeedback[job.jobId]}</p>}
      </li>;
    })}</ul>}
  </>;
}

export function AppleActivity({ view, save, setStatusMessage, onReviewRetry, onOpenSetup }) {
  const failures = view?.applicationFailures || [];
  const unresolved = failures.filter(job => !["submitted", "requeued"].includes(job.status));
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [rowFeedback, setRowFeedback] = useState({});
  useEffect(() => {
    const retryable = new Set(failures.filter(job => job.canReturnToQueue === true && job.status === "needs_review").map(job => job.jobId));
    setSelectedIds(ids => {
      const kept = ids.filter(id => retryable.has(id));
      return kept.length === ids.length ? ids : kept;
    });
  }, [view]);

  async function returnToQueue(ids = selectedIds, review = false) {
    if (busyRef.current || view?.running || !ids.length) return;
    busyRef.current = true; setBusy(true); setError(""); setRowFeedback({});
    const selection = [...new Set(ids)];
    try {
      const tab = await getActiveTab();
      const profile = await save();
      const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_RETURN_APPLICATIONS_TO_QUEUE",
        userProfile: profile, selectedIds: selection, tab });
      if (!response?.ok) throw new Error(response?.error || "These applications could not be returned to the queue.");
      const returned = (response.queuedIds || []).filter(id => selection.includes(id));
      setSelectedIds(ids => ids.filter(id => !returned.includes(id)));
      setRowFeedback(Object.fromEntries((response.blocked || []).map(job => [job.jobId, job.reason])));
      setStatusMessage?.(`${returned.length} ${returned.length === 1 ? "role returned" : "roles returned"} to Application Queue.${response.blocked?.length ? ` ${response.blocked.length} still need attention.` : ""} No applications started.`);
      if (review && selection.length === 1 && returned.includes(selection[0])) onReviewRetry?.(selection[0]);
    } catch (failure) { setError(failure.message || "The queue check failed."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function checkStatus(job) {
    if (busyRef.current || view?.running) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const tab = await getActiveTab();
      const response = await chrome.runtime.sendMessage(job.retryWorkflowSessionId
        ? { type: "APPLE_CAREERS_CHECK_INTERRUPTED_APPLICATION", workflowSessionId: job.retryWorkflowSessionId, jobId: job.jobId, tab }
        : { type: "APPLE_CAREERS_REFRESH_QUEUE_CAPACITY", tab });
      if (!response?.ok) throw new Error(response?.error || "Application status could not be checked.");
      setRowFeedback(current => ({ ...current, [job.jobId]: response.data?.message || "Active submissions checked. Unknown outcomes remain blocked unless Apple confirms the submission." }));
    } catch (failure) { setError(failure.message || "Application status could not be checked."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <details className="ios-activity"><summary><span>Activity</span><span className="function-meta">{unresolved.length ? `${unresolved.length} Needs Review` : view?.running ? "Running" : "Saved"}</span></summary>
    <div className="compact-fold-body">
      <ApplicationFailureList failures={failures} selectedIds={selectedIds} busy={busy} running={view?.running} rowFeedback={rowFeedback}
        onSelect={id => setSelectedIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])}
        onSelectAll={() => setSelectedIds(unresolved.filter(job => job.canReturnToQueue === true).map(job => job.jobId))}
        onClear={() => setSelectedIds([])} onReturn={() => returnToQueue()} onRetry={id => returnToQueue([id], true)}
        onCheck={checkStatus} onOpenSetup={onOpenSetup} />
      {error && <p className="submitted-history-error" role="alert">{error}</p>}
      <AutofillActivityLog storageKey="appleCareersKnownSiteActivity" />
      {!failures.length && !view?.phase && <p className="muted">No Activity Yet.</p>}
    </div>
  </details>;
}
