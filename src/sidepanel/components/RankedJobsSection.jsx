import { useCallback, useEffect, useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { getActiveTab, formatRelativeTime } from "../lib/format";

export function RankedJobsSection({ profile, save, setStatusMessage }) {
  const [view, setView] = useState(null);
  const [topN, setTopN] = useState(50);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_GET_JOB_RANKING", userProfile: profile, topN });
    if (response?.ok) setView(response.data);
  }, [profile, topN]);

  useEffect(() => {
    refresh().catch(console.error);
    const listener = (changes, area) => {
      if (area === "local" && ["appleJobRanking", "appleSubmittedRoleReviews", "appleCareersAppliedJobs"]
        .some((key) => changes[key])) refresh().catch(console.error);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [refresh]);

  useEffect(() => {
    if (!view?.running) return undefined;
    const timer = setInterval(() => refresh().catch(console.error), 1000);
    return () => clearInterval(timer);
  }, [view?.running, refresh]);

  async function act(type) {
    setBusy(true);
    setError("");
    try {
      const savedProfile = await save();
      const response = await chrome.runtime.sendMessage({ type, userProfile: savedProfile, topN, tab: await getActiveTab() });
      if (!response?.ok) throw new Error(response?.error || "The job queue could not be updated.");
      await refresh();
      setStatusMessage(type === "APPLE_CAREERS_QUEUE_TOP_JOBS" ? `${response.count} strong matches saved to the application queue.`
        : type === "APPLE_CAREERS_REFRESH_QUEUE_CAPACITY" ? "Active submission count refreshed without LLM matching."
        : type === "APPLE_CAREERS_APPLY_JOB_QUEUE" ? "Checking Apple submission count, then applying the best queued matches."
          : type === "APPLE_CAREERS_STOP_JOB_RANKING" ? "Stopping after the current action; saved matches remain available."
            : "Ranking all pages of the current filtered Apple search. Results appear as jobs are scored.");
    } catch (failure) {
      setError(failure?.message || "The job queue could not be updated.");
    } finally { setBusy(false); }
  }

  async function remove(jobId) {
    const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_REMOVE_QUEUED_JOB", jobId });
    if (!response?.ok) setError(response?.error || "Could not remove the queued job.");
    await refresh();
  }

  const capacity = view?.capacity;
  const n = Math.max(topN || 50, capacity?.remaining || 0);
  const jobs = [...new Map([...(view?.candidates || []), ...(view?.queued || [])]
    .map((job) => [String(job.jobId), job])).values()].sort((a, b) => b.score - a.score);
  const search = query.trim().toLowerCase();
  const visible = jobs.filter((job) => `${job.jobId} ${job.title}`.toLowerCase().includes(search));

  function jobCard(job, review = false) {
    return <li key={job.jobId} className="submitted-role-card">
      <div className="submitted-role-select">
        <a className="submitted-role-title" href={job.url} target="_blank" rel="noreferrer">{job.title}</a>
        <strong>{Number.isFinite(job.score) ? `${job.score}%` : "Unscored"}</strong>
      </div>
      <span className="submitted-role-id">Job ID {job.jobId} · {job.queueStatus === "queued" ? "Queued" : review ? "Needs Review" : "Strong Match"}</span>
      <p>{job.reason}</p>
      {job.breakdown && <details className="ranking-evidence"><summary>Fit Evidence</summary>
        <p>Responsibilities {job.breakdown.responsibilities} · Qualifications {job.breakdown.qualifications} · Level {job.breakdown.level} · Domain {job.breakdown.domain}</p>
        {(job.evidence || []).map((item, index) => <div key={index}>
          <p><strong>Role:</strong> {item.job_quote}</p><p><strong>Resume:</strong> {item.resume_quote}</p>
        </div>)}
        {(job.minimumChecks || []).map((item, index) => <p key={`minimum-${index}`}>
          <strong>Minimum Qualification ({item.status}):</strong> {item.requirement_quote}
          {item.resume_quote && <> · Resume: {item.resume_quote}</>}
        </p>)}
        {(job.blockers || []).map((blocker, index) => <p key={index}>{blocker}</p>)}
      </details>}
      {job.queueStatus === "queued" && <button type="button" className="secondary" disabled={view?.running} onClick={() => remove(job.jobId)}>Remove From Queue</button>}
    </li>;
  }

  return <section className="submitted-history" aria-labelledby="ranked-job-title">
    <div className="submitted-history-heading">
      <div className="submitted-history-title-row"><h2 id="ranked-job-title">Ranked Job Queue</h2>
        <HelpTooltip text="Rank every page of your current Apple search against your saved resume. Scores weigh responsibilities (40%), minimum qualifications (35%), level (15%) and domain (10%). Automatic applications require 80% overall, verified resume evidence, compatible experience and satisfied minimum qualifications. Repeat with different filters to combine results. Descriptions, scores and the queue are saved locally. Apply Queue refreshes your active submission count without repeating matching and stops at the conservative 50-submission target; Apple may exempt some roles from its cap." />
      </div>
    </div>
    <div className="submitted-history-summary">
      <span>{capacity?.known ? `${capacity.submitted} Submitted · ${capacity.remaining} Open Slots` : "Submission Count Not Yet Verified"}</span>
      <span>{view?.queued?.length || 0} Queued</span>
    </div>
    {capacity?.checkedAt && <span className="submitted-role-id">Count checked {formatRelativeTime(capacity.checkedAt)}; checked again before applying.</span>}
    <div className="ranking-controls">
      <label className="submitted-history-search">Top Matches (N)
        <input type="number" min={Math.max(1, capacity?.remaining || 0)} max="1000" value={topN}
          onChange={(event) => setTopN(Math.min(1000, Math.max(1, Number(event.target.value) || 50)))} />
      </label>
      <button type="button" className="primary" disabled={busy || view?.running} onClick={() => act("APPLE_CAREERS_START_JOB_RANKING")}>Rank Filtered Search</button>
    </div>
    {view?.phase && <div className="submitted-history-progress" aria-live="polite"><strong>{view.phase}</strong>
      <span>{view.reviewedCount || 0} Reviewed · {view.eligibleCount || 0} Strong Matches · {view.scoresReused || 0} Scores Reused</span>
    </div>}
    {view?.recovered && <p className="muted">The previous run was interrupted. Saved scores and queued jobs are available; rank the filter again to finish it.</p>}
    {view?.staleCount > 0 && <p className="muted">{view.staleCount} saved jobs need matching against your current resume/settings.</p>}
    {!view?.running && view?.reviewedCount > 0 && view.eligibleCount < n && <p className="muted">{view.eligibleCount} strong matches found for a target of {n}. Try another filter to add more.</p>}
    {(error || view?.error) && <p className="submitted-history-error" role="alert">{error || view.error}</p>}
    <div className="actions">
      <button type="button" className="secondary" disabled={busy || view?.running}
        onClick={() => act("APPLE_CAREERS_REFRESH_QUEUE_CAPACITY")}>Refresh Submission Count</button>
      <button type="button" className="secondary" disabled={busy || view?.running || !view?.candidates?.length}
        onClick={() => act("APPLE_CAREERS_QUEUE_TOP_JOBS")}>Queue Top {n}</button>
      <button type="button" className="primary" disabled={busy || view?.running || !view?.queued?.length || !profile.autoApplyConsent}
        onClick={() => act("APPLE_CAREERS_APPLY_JOB_QUEUE")}>Apply Queue</button>
      {view?.running && <button type="button" className="danger" disabled={busy} onClick={() => act("APPLE_CAREERS_STOP_JOB_RANKING")}>Stop</button>}
    </div>
    <label className="checkbox-row consent-row"><input type="checkbox" checked={profile.autoApplyConsent}
      onChange={(event) => save({ autoApplyConsent: event.target.checked })} />
      <span>I Understand Apply Queue Can Submit Applications</span>
    </label>
    {jobs.length > 0 && <><label className="submitted-history-search">Find Job ID Or Title
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Job ID or title" />
    </label><ul className="submitted-role-list">{visible.map((job) => jobCard(job))}</ul></>}
    {!!view?.needsReview?.length && <details><summary>Applications Needing Review ({view.needsReview.length})</summary>
      <ul className="submitted-role-list">{view.needsReview.map((job) => jobCard(job, true))}</ul>
    </details>}
    {!!view?.otherMatches?.length && <details><summary>Below Queue Threshold (Up To 100)</summary>
      <ul className="submitted-role-list">{view.otherMatches.map((job) => jobCard(job, true))}</ul>
    </details>}
    {!!Object.keys(view?.searches || {}).length && <details><summary>Scanned Filters</summary>
      {Object.values(view.searches).map((item) => <p className="muted" key={item.url}>
        <a href={item.url} target="_blank" rel="noreferrer">Open Filter</a> · {item.jobsRead} Jobs · {item.pagesRead} Pages · {item.complete ? "Complete" : "Partial"}
      </p>)}
    </details>}
  </section>;
}
