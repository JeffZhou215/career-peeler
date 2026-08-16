import { ItemList } from "./ItemList";
import { JobLink } from "./JobLink";
import { cleanJobTitle, formatRelativeTime } from "../lib/format";

function renderRecentItem(record) {
  const reason = record.failureReason ? ` - ${record.failureReason}` : "";
  const llmDetails =
    record.matchSource === "llm" && record.llmMatch
      ? ` · LLM ${record.llmMatch.score}%${
          record.llmMatch.matchedSkills?.length ? ` · ${record.llmMatch.matchedSkills.slice(0, 3).join(", ")}` : ""
        }`
      : "";
  return [
    `${record.status}: `,
    <JobLink key="link" jobId={record.jobId} title={record.title} url={record.url} />,
    `${llmDetails}${reason}`
  ];
}

function renderFailureItem(failure) {
  const lastAttempt = failure.workflow?.attempts?.at(-1);
  const actions = lastAttempt?.visibleActions?.length
    ? ` Visible buttons at failure: ${lastAttempt.visibleActions.join(", ")}.`
    : "";
  const heading = lastAttempt?.heading ? ` Page: ${lastAttempt.heading}.` : "";
  const role = failure.jobId ? `Role ${failure.jobId}` : "Role unknown";
  return `${failure.status}: ${role} - ${cleanJobTitle(failure.title)}. ${failure.reason}.${heading}${actions}`;
}

function renderSkippedUnqualifiedItem(entry) {
  const site = entry.siteLabel ? ` ${entry.siteLabel}.` : "";
  const when = entry.skippedAt ? ` (${formatRelativeTime(entry.skippedAt)})` : "";
  return [
    `Skipped:${site} `,
    <JobLink key="link" jobId={entry.jobId} title={entry.title} url={entry.url} />,
    ` - ${entry.reason}${when}`
  ];
}

function renderErrorItem(error) {
  const attempt = error.lastAttempt || error.workflow?.attempts?.at(-1);
  const site = error.siteLabel ? ` ${error.siteLabel}.` : "";
  const errorType = error.errorType || error.type || "error";
  const heading = attempt?.heading ? ` Page: ${attempt.heading}.` : "";
  const summary = attempt?.summary ? ` Last step: ${attempt.summary}.` : "";
  const buttons = attempt?.visibleActions?.length ? ` Visible buttons: ${attempt.visibleActions.join(", ")}.` : "";
  const when = error.happenedAt ? ` (${formatRelativeTime(error.happenedAt)})` : "";
  return [
    `${errorType}:${site} `,
    <JobLink key="link" jobId={error.jobId} title={error.title} url={error.manualReviewUrl || error.url} />,
    ` - ${error.message}.${heading}${summary}${buttons}${when}`
  ];
}

function renderNeedsReviewItem(entry) {
  const site = entry.siteLabel ? ` ${entry.siteLabel}.` : "";
  const when = entry.flaggedAt ? ` (${formatRelativeTime(entry.flaggedAt)})` : "";
  return [
    `Needs review:${site} `,
    <JobLink key="link" jobId={entry.jobId} title={entry.title} url={entry.url} />,
    ` - ${entry.reason}${when}`
  ];
}

export function ScanStatusPanel({ status }) {
  const stats = status.stats || {};

  return (
    <section id="scanStatus" className="result">
      <h2>Scan Progress</h2>
      <div className="summary-grid">
        <span>Phase</span>
        <strong>{status.phase || "Idle"}</strong>
        <span>Applied</span>
        <strong>{stats.applied || 0}</strong>
        <span>Reviewed</span>
        <strong>{stats.reviewed ?? stats.review ?? 0}</strong>
        <span>Errors</span>
        <strong>{stats.errors || 0}</strong>
      </div>
      <p className="last-applied">
        {status.lastApplied
          ? `Last applied: ${cleanJobTitle(status.lastApplied.title)} (${status.lastApplied.jobId}), ${formatRelativeTime(status.lastApplied.appliedAt)}`
          : "No jobs applied yet."}
      </p>
      <p className="muted">
        {status.currentJob ? `Current: ${status.currentJob.title || status.currentJob.jobId}` : status.lastError || "No current job."}
      </p>

      <details className="progress-details">
        <summary>Errors ({stats.errors || 0})</summary>
        <ItemList items={status.errors || []} emptyMessage="No errors logged yet." renderItem={renderErrorItem} />
      </details>

      <details className="progress-details">
        <summary>Needs Review ({stats.needsReview || 0})</summary>
        <ItemList
          items={status.needsReview || []}
          emptyMessage="No roles need review right now."
          renderItem={renderNeedsReviewItem}
        />
      </details>

      <details className="progress-details">
        <summary>Detailed stats and logs</summary>
        <div className="scan-grid">
          <span>Pages</span>
          <strong>{status.pageCount || 0}</strong>
          <span>Scanned</span>
          <strong>{status.scanned || 0}</strong>
          <span>Queued</span>
          <strong>{status.queued || 0}</strong>
          <span>Page total</span>
          <strong>{status.currentPageStats?.total || 0}</strong>
          <span>Page unapplied</span>
          <strong>{status.currentPageStats?.unapplied || 0}</strong>
          <span>Page applied</span>
          <strong>{status.currentPageStats?.applied || 0}</strong>
          <span>Submitted</span>
          <strong>{stats.submitted || 0}</strong>
          <span>Likely match</span>
          <strong>{stats.likelyMatch || 0}</strong>
          <span>Likely skip</span>
          <strong>{stats.likelySkip || 0}</strong>
          <span>Seen</span>
          <strong>{stats.seen ?? stats.unknown ?? 0}</strong>
          <span>Skipped (stored)</span>
          <strong>{stats.skippedStored || 0}</strong>
          <span>Skipped (unqualified)</span>
          <strong>{stats.skippedUnqualified || 0}</strong>
          <span>Apply failed</span>
          <strong>{stats.applyFailed || 0}</strong>
          <span>Needs review</span>
          <strong>{stats.needsReview || 0}</strong>
        </div>
        <h2>Recent Failures</h2>
        <ItemList items={status.failures || []} emptyMessage="No apply failures logged yet." renderItem={renderFailureItem} />
        <h2>Recently Skipped (Unqualified)</h2>
        <ItemList
          items={status.skippedUnqualified || []}
          emptyMessage="No unqualified roles skipped yet."
          renderItem={renderSkippedUnqualifiedItem}
        />
        <h2>Recent Jobs</h2>
        <ItemList items={status.recent || []} emptyMessage="No scanned jobs yet." renderItem={renderRecentItem} />
      </details>
    </section>
  );
}
