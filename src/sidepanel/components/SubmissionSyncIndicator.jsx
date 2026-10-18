export function SubmissionSyncIndicator({ status = {}, now = Date.now(), onRetry, disabled = false }) {
  const age = Math.max(0, now - Number(status.lastSuccessAt || 0));
  const lastSync = status.lastSuccessAt ? age < 60000 ? "Synced just now" : `Last synced ${Math.floor(age / 60000)} minutes ago` : "Count not verified";
  const label = status.state === "syncing" ? "Syncing… — checking Apple Careers"
    : status.state === "failed" ? "Sync failed — capacity unknown"
      : status.state === "deferred" ? "Sync deferred" : lastSync;
  return <div className="submission-sync-status" role="status" aria-live="polite" aria-atomic="true">
    <div>{status.state === "syncing" && <span className="submission-sync-spinner" aria-hidden="true" />}<span>{label}</span>
      {status.state === "failed" && <button type="button" className="sync-retry" onClick={onRetry} disabled={disabled}>Retry</button>}
    </div>
    {status.lastSuccessAt && <time dateTime={new Date(status.lastSuccessAt).toISOString()} title={new Date(status.lastSuccessAt).toLocaleString()}>
      {status.state === "synced" || !status.state ? `Verified ${new Date(status.lastSuccessAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : `Last successful sync: ${new Date(status.lastSuccessAt).toLocaleString()}`}
    </time>}
    {status.message && (status.state === "failed" || status.state === "deferred") && <span>{status.message}</span>}
    {status.state === "synced" && status.recoveryWarning && <span className="submission-recovery-warning">
      {status.recoveryWarning.message}
      {status.recoveryWarning.url && <> <a href={status.recoveryWarning.url} target="_blank" rel="noopener noreferrer">
        Review {status.recoveryWarning.title} (Job ID {status.recoveryWarning.jobId})
      </a></>}
    </span>}
  </div>;
}
