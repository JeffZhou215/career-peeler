import { useCallback, useEffect, useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { FunctionSection } from "./FunctionSection";
import { CompactRoleCard } from "./CompactRoleCard";
import { getActiveTab, formatRelativeTime } from "../lib/format";

export function RankedJobsSection({ profile, save, setStatusMessage, onSummaryChange }) {
  const [view, setView] = useState(null);
  const [topN, setTopN] = useState(50);
  const [topNDraft, setTopNDraft] = useState("50");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [reviewedQueueToken, setReviewedQueueToken] = useState(null);
  const refresh = useCallback(async (requestedTopN = topN) => {
    const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_GET_JOB_RANKING", userProfile: profile, topN: requestedTopN });
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

  useEffect(() => { setReviewedQueueToken(null); }, [view?.queueReviewToken]);

  function commitTopN() {
    // Keep the displayed draft as text so clearing or replacing digits is possible.
    // Normalize only on commit; an empty/invalid draft restores the last chosen value.
    const parsed = Number(topNDraft);
    const minimum = Math.max(1, view?.capacity?.remaining || 0);
    const requestedTopN = Math.min(1000, Math.max(minimum,
      Math.floor(topNDraft.trim() && Number.isFinite(parsed) ? parsed : topN)));
    setTopN(requestedTopN);
    setTopNDraft(String(requestedTopN));
    return requestedTopN;
  }

  async function act(type) {
    // Use the committed draft directly, including when clicking immediately after editing.
    const requestedTopN = commitTopN();
    setBusy(true);
    setError("");
    try {
      const savedProfile = await save();
      const response = await chrome.runtime.sendMessage({ type, userProfile: savedProfile, topN: requestedTopN,
        reviewAcknowledgement: reviewedQueueToken, tab: await getActiveTab() });
      if (!response?.ok) throw new Error(response?.error || "The job queue could not be updated.");
      await refresh(requestedTopN);
      if (type === "APPLE_CAREERS_QUEUE_TOP_JOBS") setQueueOpen(true);
      setStatusMessage(type === "APPLE_CAREERS_QUEUE_TOP_JOBS" ? `${response.count} top-ranked jobs saved to the application queue.${response.reviewCount ? ` ${response.reviewCount} have match concerns to review before applying.` : ""}`
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

  useEffect(() => {
    if (view) onSummaryChange?.({ capacity: view.capacity, queued: view.queued?.length || 0 });
  }, [view, onSummaryChange]);

  const capacity = view?.capacity;
  const n = Math.max(topN || 50, capacity?.remaining || 0);
  const jobs = [...new Map([...(view?.ranked || []), ...(view?.candidates || [])]
    .map((job) => [String(job.jobId), job])).values()].filter((job) => job.queueStatus !== "queued").sort((a, b) => b.score - a.score);
  const search = query.trim().toLowerCase();
  const matchesSearch = (job) => `${job.jobId} ${job.title}`.toLowerCase().includes(search);
  const visible = jobs.filter(matchesSearch);
  const shownIds = new Set([...jobs, ...(view?.queued || [])].map((job) => String(job.jobId)));
  const otherMatches = (view?.otherMatches || []).filter((job) => !shownIds.has(String(job.jobId)) && matchesSearch(job));
  const latestSearch = Object.values(view?.searches || {}).sort((a, b) => b.startedAt - a.startedAt)[0];
  const diagnosticLabels = { qualifications: "Minimum Qualifications Missing Or Unverified",
    evidence: "Insufficient Responsibility Evidence", confidence: "Confidence Below High",
    score: "Below Strong Match Threshold", hardSkip: "Excluded By Title, Experience Or Keywords",
    unscored: "Matching Unfinished Or Posting Unavailable", alreadyApplied: "Previously Applied Or Withdrawn",
    applicationReview: "Application Needs Review" };
  const hasMatchDiagnostics = view?.diagnostics && Object.keys(diagnosticLabels).some((key) => view.diagnostics[key] > 0);
  const canQueue = !!view?.candidates?.length;

  const needsQueueReview = !!view?.queueReviewToken;
  const queueReviewAcknowledged = !needsQueueReview || reviewedQueueToken === view.queueReviewToken;
  const progressLabel = view?.running
    ? /^(Applying|Checking Apple submission)/i.test(view.phase || "") ? "Applying Saved Queue"
      : /page (\d+)/i.test(view.phase || "") ? `Ranking Page ${view.phase.match(/page (\d+)/i)[1]}` : "Ranking Jobs"
    : view?.error ? "Ranking Paused" : view?.phase ? "Rankings Saved" : "Ready To Rank";

  function jobCard(job) {
    const status = ["needs_review", "uncertain", "applying"].includes(job.queueStatus) ? "Application Needs Review"
      : job.queueStatus === "queued" ? job.eligible ? "Queued" : "Queued · Match Concerns"
        : job.breakdown ? job.eligible ? "Strong Match" : "Match Concerns" : "Excluded Or Unscored";
    return <CompactRoleCard key={job.jobId} role={job} status={status}>
      {!job.eligible && !!job.blockers?.length && <div>
        <strong>Match Concerns</strong><ul>{job.blockers.map((blocker, index) => <li key={index}>
          {blocker === "Fit is below the threshold for automatic applications." ? "Fit is below the strong match threshold." : blocker}
        </li>)}</ul>
      </div>}
      {job.breakdown && <details className="compact-fold ranking-evidence"><summary>Fit Evidence
        <HelpTooltip label="Fit Evidence" text="Scores weigh responsibilities (40%), minimum qualifications (35%), level (15%) and domain (10%). Strong matches have at least 80 overall, strong individual scores, high confidence and verified minimum qualifications. Other scored jobs can also be queued and applied after you acknowledge their match concerns." />
      </summary><div className="compact-fold-body">
        <div className="score-breakdown">{Object.entries(job.breakdown).map(([key, value]) => <span key={key}>{key.charAt(0).toUpperCase() + key.slice(1)} <strong>{value}</strong></span>)}</div>
        {(job.evidence || []).map((item, index) => <div key={index}>
          <p><strong>Role:</strong> {item.job_quote}</p><p><strong>Resume:</strong> {item.resume_quote}</p>
        </div>)}
        {(job.minimumChecks || []).map((item, index) => <div key={`minimum-${index}`}>
          <strong>Minimum Qualification ({item.status})</strong><p>{item.requirement_quote}</p>
          {item.resume_quote && <p><strong>Resume:</strong> {item.resume_quote}</p>}
        </div>)}
      </div></details>}
      {job.queueStatus === "queued" && <button type="button" className="secondary" disabled={busy || view?.running} onClick={() => remove(job.jobId)}>Remove From Queue</button>}
    </CompactRoleCard>;
  }

  return <FunctionSection title="Ranked Job Queue" meta={view?.running ? "Running" : `${view?.queued?.length || 0} Queued`}
    defaultOpen running={view?.running}
    headerAction={view?.running && <button type="button" className="danger" disabled={busy} onClick={() => act("APPLE_CAREERS_STOP_JOB_RANKING")}>Stop</button>}
    help="Rank every page of the current filtered Apple search against your saved resume. Descriptions, scores and the queue are stored locally. Queue Top N saves the highest-ranked scored jobs, including jobs with match concerns. Review the saved queue and acknowledge concerns before Apply Queue submits applications. Previously applied, withdrawn, excluded and unscored jobs are omitted. Applying checks active submissions and stops at the conservative 50-submission target. Apple may exempt some roles from its cap.">
    <div className="compact-progress" aria-live="polite"><span><strong>{progressLabel}</strong>
      <span className="compact-role-meta">{view?.reviewedCount || 0} Saved · {view?.queueableCount || 0} Ranked · {view?.eligibleCount || 0} Strong Matches</span>
    </span>
      {view?.running ? <button type="button" className="danger" disabled={busy} onClick={() => act("APPLE_CAREERS_STOP_JOB_RANKING")}>Stop</button>
        : <button type="button" className="primary" disabled={busy} onClick={() => act("APPLE_CAREERS_START_JOB_RANKING")}>Rank Filtered Search</button>}
    </div>
    {(error || view?.error) && <p className="submitted-history-error" role="alert">{error || view.error}</p>}
    <details className="compact-fold"><summary>Scan Details<HelpTooltip label="Scan Details" text="Inspect the current job, cache use, saved filter history and the last active submission count. Refresh Submission Count reads Apple without repeating OpenAI matching." /></summary>
      <div className="compact-fold-body">
        {view?.phase && <span>{view.phase}</span>}
        <span>{view?.scoresReused || 0} Scores Reused</span>
        {capacity?.checkedAt && <span>Count checked {formatRelativeTime(capacity.checkedAt)}.</span>}
        {latestSearch && <span>{latestSearch.jobsRead || 0} Found In Latest Filter
          {Number.isFinite(latestSearch.alreadyApplied) && <> · {latestSearch.alreadyApplied} Previously Applied</>}
          {!!latestSearch.applicationReview && <> · {latestSearch.applicationReview} Applications Needing Review</>}.</span>}
        {view?.recovered && <p>The previous run was interrupted. Saved scores and queued jobs remain available.</p>}
        {view?.staleCount > 0 && <p>{view.staleCount} saved jobs need matching against your current resume/settings.</p>}
        <button type="button" className="secondary" disabled={busy || view?.running} onClick={() => act("APPLE_CAREERS_REFRESH_QUEUE_CAPACITY")}>Refresh Submission Count</button>
        {!!Object.keys(view?.searches || {}).length && <details className="compact-fold"><summary>Scanned Filters</summary>
          {Object.values(view.searches).map((item) => <p key={item.url}>
            <a href={item.url} target="_blank" rel="noreferrer">Open Filter</a> · {item.jobsRead} Jobs · {item.pagesRead} Pages · {item.complete ? "Complete" : "Partial"}
            {!!item.alreadyApplied && <> · {item.alreadyApplied} Previously Applied</>}
          </p>)}
        </details>}
      </div>
    </details>
    <div className="compact-list-heading"><strong>Top Ranked Jobs</strong>
      <HelpTooltip label="Top Ranked Jobs" text="Queue Top N saves the highest-ranked scored jobs across saved filters, in score order. Search only filters this display. Expand a role to review qualifications and match concerns. Concern flags do not prevent queueing; acknowledge them in Saved Queue before applying." />
      <label className="top-matches-control">Top <input type="number" min={Math.max(1, capacity?.remaining || 0)} max="1000" step="1" value={topNDraft} aria-label="Top Matches"
        onChange={(event) => setTopNDraft(event.target.value)} onBlur={commitTopN}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
    </div>
    <input className="compact-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find Job ID Or Title" aria-label="Find Ranked Jobs By Job ID Or Title" />
    {visible.length ? <ul className="submitted-role-list compact-role-list">{visible.map(jobCard)}</ul> : <p className="muted">{search ? "No ranked jobs match this search." : "No ranked jobs yet."}</p>}
    {hasMatchDiagnostics &&
      <details className="compact-fold"><summary>Match Concerns And Exclusions <span className="function-meta">{view.eligibleCount || 0} Strong</span>
        <HelpTooltip label="Match Concerns And Exclusions" text="Qualifications, evidence, confidence and score concerns are advisory for scored jobs you choose to queue. Title/experience/keyword exclusions, unfinished matching, prior applications and uncertain application outcomes remain excluded. Counts overlap; expand a job for specific evidence." /></summary>
        <div className="compact-fold-body"><p>Scored jobs with match concerns can be queued. Review their qualifications and resume evidence before applying.</p>
          {Object.entries(diagnosticLabels).filter(([key]) => view.diagnostics[key] > 0)
          .map(([key, label]) => <div className="compact-stat-row" key={key}><span>{label}</span><strong>{view.diagnostics[key]}</strong></div>)}</div>
      </details>}
    {!!view?.needsReview?.length && <details className="compact-fold"><summary>Applications Needing Review <span className="function-meta">{view.needsReview.length}</span></summary>
      <ul className="submitted-role-list compact-role-list">{view.needsReview.filter(matchesSearch).map(jobCard)}</ul>
    </details>}
    {!!otherMatches.length && <details className="compact-fold"><summary>Other Excluded Or Unscored Jobs <span className="function-meta">{otherMatches.length}</span></summary>
      <ul className="submitted-role-list compact-role-list">{otherMatches.map(jobCard)}</ul>
    </details>}
    <details className="compact-fold" open={queueOpen || undefined} onToggle={(event) => setQueueOpen(event.currentTarget.open)}><summary>Saved Queue <span className="function-meta">{view?.queued?.length || 0} Jobs</span>
      <HelpTooltip label="Saved Queue" text="Queue Top N adds the highest-ranked scored jobs. Expand queued roles to review evidence or remove them. Acknowledge match concerns if present, then Apply Queue submits saved jobs in score order until the 50-submission target. Extra jobs stay queued." /></summary>
      <div className="compact-fold-body">
        {view?.queued?.length ? <ul className="submitted-role-list compact-role-list">{view.queued.filter(matchesSearch).map(jobCard)}</ul> : <span>No jobs queued.</span>}
        {needsQueueReview && <label className="checkbox-row consent-row"><input type="checkbox" checked={queueReviewAcknowledged}
          disabled={busy || view?.running} onChange={(event) => setReviewedQueueToken(event.target.checked ? view.queueReviewToken : null)} />
          <span>I Reviewed Match Concerns For {view.queueReviewCount} Queued Jobs And Want To Apply</span>
          <HelpTooltip label="Review Match Concerns" text="These queued jobs do not meet every strong-match check. Review their qualifications, evidence and scores before acknowledging. This applies to the current assessments only; changed concerns require another acknowledgement." />
        </label>}
        <label className="checkbox-row consent-row"><input type="checkbox" checked={profile.autoApplyConsent} onChange={(event) => save({ autoApplyConsent: event.target.checked })} />
          <span>I Allow Application Submission</span><HelpTooltip label="Application Submission" text="This acknowledgement enables the separate Apply Queue action. Ranking and queueing alone do not submit applications." />
        </label>
      </div>
    </details>
    {needsQueueReview && !queueReviewAcknowledged && !view?.running && <p className="muted" role="status">Review and acknowledge match concerns in Saved Queue to enable Apply Queue.</p>}
    <div className="compact-actions queue-actions">
      <button type="button" className="secondary" disabled={busy || view?.running || !canQueue} onClick={() => act("APPLE_CAREERS_QUEUE_TOP_JOBS")}>Queue Top {n}</button>
      <button type="button" className="primary" disabled={busy || view?.running || !view?.queued?.length || !profile.autoApplyConsent || !queueReviewAcknowledged} onClick={() => act("APPLE_CAREERS_APPLY_JOB_QUEUE")}>Apply Queue</button>
      <HelpTooltip label="Apply Queue" text="Applies saved jobs in score order after you acknowledge any match concerns and allow submission in Saved Queue. Requires a validated API key, a current resume and required application answers. Previously applied jobs and changed/unavailable postings are skipped. It verifies active submissions and stops at 50." />
    </div>
  </FunctionSection>;
}
