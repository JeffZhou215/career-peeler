import { jobStore } from "../lib/jobStore";
import { Sheet } from "./Sheet";
import { useCallback, useEffect, useRef, useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { FunctionSection } from "./FunctionSection";
import { CompactRoleCard } from "./CompactRoleCard";
import { getActiveTab, formatRelativeTime } from "../lib/format";

export function RankedJobsSection({ profile, save, setStatusMessage, onSummaryChange, embedded = false, onOpenSetup }) {
  const [view, setView] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [applyOpen, setApplyOpen] = useState(false);
  const initializedTop = useRef(false);
  const [topN, setTopN] = useState(50);
  const [topNDraft, setTopNDraft] = useState("50");
  const [query, setQuery] = useState("");
  const [listView, setListView] = useState("ranked");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [reviewedQueueToken, setReviewedQueueToken] = useState(null);
  const refresh = useCallback(async (requestedTopN = topN) => {
    const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_GET_JOB_RANKING", userProfile: profile, topN: requestedTopN });
    if (response?.ok) setView(response.data);
    else setError(response?.error || "Saved jobs could not be loaded.");
  }, [profile, topN]);

  useEffect(() => {
    refresh().catch(console.error);
    const listener = (changes, area) => {
      if (((area === "local" || area === "indexeddb") && ["appleJobRanking", "appleSubmittedRoleReviews", "appleCareersAppliedJobs"]
        .some((key) => changes[key])) || (area === "session" && changes.appleJobRankingWriteFailure)) refresh().catch(console.error);
    };
    jobStore.onChanged.addListener(listener);
    return () => jobStore.onChanged.removeListener(listener);
  }, [refresh]);

  useEffect(() => {
    if (!view?.running) return undefined;
    const timer = setInterval(() => refresh().catch(console.error), 1000);
    return () => clearInterval(timer);
  }, [view?.running, refresh]);

  useEffect(() => { setReviewedQueueToken(null); }, [view?.queueReviewToken]);
  useEffect(() => {
    if (!initializedTop.current && view?.capacity?.known) {
      initializedTop.current = true;
      const value = Math.max(1, view.capacity.remaining || 50); setTopN(value); setTopNDraft(String(value));
    }
  }, [view?.capacity?.known]);

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
      const tab = await getActiveTab();
      const savedProfile = await save();
      const response = await chrome.runtime.sendMessage({ type: type === "APPLE_CAREERS_RESUME_JOB_RANKING" ? "APPLE_CAREERS_START_JOB_RANKING" : type, userProfile: savedProfile, topN: requestedTopN,
        reviewAcknowledgement: reviewedQueueToken, tab, selectedIds,
        resume: type === "APPLE_CAREERS_RESUME_JOB_RANKING",
        autoApply: savedProfile.afterRanking === "auto" });
      if (!response?.ok) throw new Error(response?.error || "The job queue could not be updated.");
      await refresh(requestedTopN);
      if (type === "APPLE_CAREERS_QUEUE_TOP_JOBS") { setQueueOpen(true); setSelectedIds([]); }
      if (type === "APPLE_CAREERS_APPLY_JOB_QUEUE") setApplyOpen(false);
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
    if (view) onSummaryChange?.(view);
  }, [view, onSummaryChange]);

  const capacity = view?.capacity;
  const n = Math.max(topN || 50, capacity?.remaining || 0);
  const jobs = [...new Map([...(view?.ranked || []), ...(view?.candidates || [])]
    .map((job) => [String(job.jobId), job])).values()].filter((job) => job.queueStatus !== "queued").sort((a, b) => b.score - a.score);
  const search = query.trim().toLowerCase();
  const matchesSearch = (job) => `${job.jobId} ${job.title}`.toLowerCase().includes(search);
  const listJobs = listView === "excluded" ? view?.excludedMatches || []
    : listView === "stale" ? view?.staleMatches || [] : jobs;
  const visible = listJobs.filter(matchesSearch);
  const applicationFailures = view?.applicationFailures || [];
  const latestSearch = Object.values(view?.searches || {}).sort((a, b) => b.startedAt - a.startedAt)[0];
  const canQueue = listView === "ranked" && !!view?.candidates?.length;

  const needsQueueReview = !!view?.queueReviewToken;
  const queueReviewAcknowledged = !needsQueueReview || reviewedQueueToken === view.queueReviewToken;
  const interruptedRanking = view?.recovered && latestSearch && !latestSearch.complete && /^Ranking\b/i.test(view.phase || "");
  const progressLabel = view?.running
    ? /^(Applying|Checking Apple submission)/i.test(view.phase || "") ? "Applying Application Queue"
      : /page (\d+)/i.test(view.phase || "") ? `Ranking Page ${view.phase.match(/page (\d+)/i)[1]}` : "Ranking Jobs"
    : view?.recovered ? interruptedRanking ? "Scan Interrupted" : "Workflow Interrupted"
      : view?.error ? /Application queue/i.test(view.phase || "") ? "Application Queue Paused" : "Ranking Paused"
      : /Application queue/i.test(view?.phase || "") ? /stopped/i.test(view.phase) ? "Application Queue Stopped" : "Application Queue Finished"
        : /50-application target/i.test(view?.phase || "") ? "Application Limit Reached"
          : /Ranking stopped/i.test(view?.phase || "") ? "Scan Stopped"
            : latestSearch?.complete && /rank/i.test(view?.phase || "") ? "Ranking Complete"
              : view?.phase ? "Rankings Saved" : "Ready To Rank";

  function jobCard(job) {
    const status = job.stale ? "Saved Score · Update Required" : ["needs_review", "uncertain", "applying"].includes(job.queueStatus) ? "Application Needs Review"
      : job.queueStatus === "queued" ? job.eligible ? "Queued" : "Queued · Match Concerns"
        : job.breakdown ? job.eligible ? "Strong Match" : "Match Concerns" : "Excluded Or Unscored";
    return <CompactRoleCard key={job.jobId} role={job} status={status}
      selectable={!job.stale && job.queueStatus !== "queued" && Boolean(job.breakdown) && !["needs_review","uncertain","applying"].includes(job.queueStatus)}
      selected={selectedIds.includes(job.jobId)} disabled={busy || view?.running}
      onSelect={() => setSelectedIds(ids => ids.includes(job.jobId) ? ids.filter(id => id !== job.jobId) : [...ids, job.jobId])}>
      {job.localMatch && <details className="compact-fold"><summary>Local Resume Match</summary><div className="compact-fold-body"><span>{job.localMatch.percentage}% Local Overlap</span><p>{job.localMatch.reasons?.join("; ")}</p></div></details>}
      {!job.eligible && !!job.blockers?.length && <details className="compact-fold">
        <summary>Match Concerns <span className="function-meta">{job.blockers.length}</span></summary><div className="compact-fold-body"><ul>{job.blockers.map((blocker, index) => <li key={index}>
          {blocker === "Fit is below the threshold for automatic applications." ? "Fit is below the strong match threshold." : blocker}
        </li>)}</ul></div>
      </details>}
      {job.breakdown && <details className="compact-fold ranking-evidence"><summary>Fit Evidence
        <HelpTooltip label="Fit Evidence" text="Scores weigh responsibilities (40%), minimum qualifications (35%), level (15%) and domain (10%). Strong matches have at least 80 overall, strong individual scores, high confidence and verified substantive minimum qualifications. Routine coding-assistant usage is not scored or blocking. Other scored jobs can also be queued and applied after you acknowledge their match concerns." />
      </summary><div className="compact-fold-body">
        <div className="score-breakdown">{Object.entries(job.breakdown).map(([key, value]) => <span key={key}>{key.charAt(0).toUpperCase() + key.slice(1)} <strong>{value}</strong></span>)}</div>
        {(job.evidence || []).map((item, index) => <div key={index}>
          <p><strong>Role:</strong> {item.job_quote}</p><p><strong>Candidate Evidence:</strong> {item.resume_quote}</p>
        </div>)}
        {(job.minimumChecks || []).map((item, index) => <div key={`minimum-${index}`}>
          <strong>{job.neutralQualifications?.some(qualification => qualification.id === Number(item.id)) ? "Coding Workflow · Not Scored" : `Minimum Qualification (${item.status})`}</strong><p>{item.requirement_quote}</p>
          {item.resume_quote && <p><strong>Candidate Evidence:</strong> {item.resume_quote}</p>}
        </div>)}
      </div></details>}
      {job.queueStatus === "queued" && <button type="button" className="secondary" disabled={busy || view?.running} onClick={() => remove(job.jobId)}>Remove From Queue</button>}
    </CompactRoleCard>;
  }

  return <FunctionSection embedded={embedded} title="Find Your Best Matches" meta={view?.running ? "Running" : `${view?.queued?.length || 0} Queued`}
    defaultOpen running={view?.running}
    headerAction={view?.running && <button type="button" className="danger" disabled={busy} onClick={() => act("APPLE_CAREERS_STOP_JOB_RANKING")}>Stop</button>}
    help="Rank every page of the current filtered Apple search against your saved resume. Queue Top N adds the highest-ranked scored jobs to one Application Queue. Expand a role for its match concerns. Review and acknowledge the chosen batch before applying. Previously applied, withdrawn, excluded and unscored jobs cannot be queued. Applying verifies active submissions and stops at the conservative 50-submission target. Apple may exempt some roles from its cap.">
    <div className="ranking-controls">
      <label className="field-label" htmlFor="after-ranking">After Ranking<HelpTooltip label="After Ranking" text="Both modes finish the entire filtered search first. Auto Apply submits strong matches only after checking capacity. Review Then Apply lets you choose scored jobs and acknowledge their concerns." /></label>
      <select id="after-ranking" disabled={view?.running} value={profile.afterRanking} onChange={(event) => save({ afterRanking: event.target.value })}><option value="review">Review Then Apply</option><option value="auto">Auto Apply Strong Matches</option></select>
      {profile.afterRanking === "auto" && <label className="checkbox-row consent-row"><input type="checkbox" checked={profile.autoApplyConsent} disabled={view?.running} onChange={(event) => save({autoApplyConsent:event.target.checked})} /><span>I Allow Strong Match Applications After Ranking</span></label>}
      <div className="compact-actions">
        <button type="button" className="primary" disabled={busy || view?.running || (profile.afterRanking === "auto" && !profile.autoApplyConsent)} onClick={() => act("APPLE_CAREERS_START_JOB_RANKING")}>Scan And Rank</button>
        {latestSearch && !latestSearch.complete && <button type="button" className="secondary" disabled={busy || view?.running} onClick={() => act("APPLE_CAREERS_RESUME_JOB_RANKING")}>Resume Scan</button>}
        {view?.running && <button type="button" className="danger" disabled={busy} onClick={() => act("APPLE_CAREERS_STOP_JOB_RANKING")}>Stop</button>}
      </div>
    </div>
    <div className="compact-progress" aria-live="polite"><span><strong>{progressLabel}</strong><span className="compact-role-meta">{view?.reviewedCount || 0} Saved · {view?.eligibleCount || 0} Strong Matches</span>
      {latestSearch && <span className="compact-role-meta">{latestSearch.pagesRead || 0} Pages Finished · {latestSearch.complete ? "All Pages Ranked" : "Partial Scan"}</span>}
      {view?.currentJob && <a className="compact-role-meta" href={view.currentJob.url} target="_blank" rel="noopener noreferrer">{view.currentJob.title} · {view.currentJob.jobId}</a>}</span>
    </div>
    {view?.recovered && <p className="submitted-history-error" role="alert">{interruptedRanking
      ? `The previous scan was interrupted on page ${(latestSearch.pageIndex || 0) + 1}. Choose Resume Scan to continue using saved scores.`
      : "The previous workflow was interrupted. Saved scores and queued jobs remain available. Check Activity for applications needing review."}</p>}
    {(error || view?.error) && <p className="submitted-history-error" role="alert">{error || view.error}
      {!error && view?.errorJob && <> <a href={view.errorJob.url} target="_blank" rel="noopener noreferrer">
        Review {view.errorJob.title} (Job ID {view.errorJob.jobId})
      </a></>}
    </p>}
    <details className="compact-fold"><summary>Scan Details<HelpTooltip label="Scan Details" text="Inspect the current job, cache use, saved filter history and the last active submission count. Refresh Submission Count reads Apple without repeating OpenAI matching." /></summary>
      <div className="compact-fold-body">
        {view?.phase && <span>{view.phase}</span>}
        <span>{view?.scoresReused || 0} Scores Reused</span>
        {capacity?.checkedAt && <span>Count checked {formatRelativeTime(capacity.checkedAt)}.</span>}
        {latestSearch && <span>{latestSearch.jobsRead || 0} Found In Latest Filter
          {Number.isFinite(latestSearch.alreadyApplied) && <> · {latestSearch.alreadyApplied} Previously Applied</>}
          {!!latestSearch.applicationReview && <> · {latestSearch.applicationReview} Applications Needing Review</>}.</span>}
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
    <div className="compact-list-heading"><strong>Ranked Jobs</strong>
      <HelpTooltip label="Ranked Jobs" text="One list holds saved job results. Use View to inspect top matches, excluded jobs or scores that need updating. Queue Top N adds the highest-ranked scored jobs across saved filters to the Application Queue. Expand a role for its evidence and match concerns." />
      {listView === "ranked" && <label className="top-matches-control">Top <input type="number" min={Math.max(1, capacity?.remaining || 0)} max="1000" step="1" value={topNDraft} aria-label="Top Matches"
        onChange={(event) => setTopNDraft(event.target.value)} onBlur={commitTopN}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label>}
    </div>
    <label className="field-label" htmlFor="ranked-jobs-view">View</label>
    <select id="ranked-jobs-view" value={listView} onChange={event => { setListView(event.target.value); setSelectedIds([]); }}>
      <option value="ranked">Top Matches</option>
      <option value="excluded">Excluded Or Unscored</option>
      <option value="stale">Saved Scores To Update ({view?.staleCount || 0})</option>
    </select>
    <input className="compact-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find Job ID Or Title" aria-label="Find Ranked Jobs By Job ID Or Title" />
    {listView === "stale" && !!view?.staleCount && <p className="muted">Scan And Rank to update these scores against your current resume and matching settings.</p>}
    {visible.length ? <ul className="submitted-role-list compact-role-list">{visible.map(jobCard)}</ul> : <p className="muted">{search ? "No jobs match this search in the selected view."
      : listView === "excluded" ? "No excluded or unscored jobs."
        : listView === "stale" ? "No saved scores need updating." : "No ranked jobs yet."}</p>}
    <details className="compact-fold" open={queueOpen || undefined} onToggle={(event) => setQueueOpen(event.currentTarget.open)}><summary>Application Queue <span className="function-meta">{view?.queued?.length || 0} Jobs</span>
      <HelpTooltip label="Application Queue" text="This is the only application queue. Expand chosen roles to review evidence or remove them. Review And Apply confirms this batch, acknowledges any match concerns and submits jobs in score order until the 50-submission target. Extra jobs stay queued." /></summary>
      <div className="compact-fold-body">
        {view?.queued?.length ? <ul className="submitted-role-list compact-role-list">{view.queued.filter(matchesSearch).map(jobCard)}</ul> : <span>No jobs queued.</span>}
      </div>
    </details>
    <div className="compact-actions queue-actions">
      <button type="button" className="secondary" disabled={busy || view?.running || !canQueue} onClick={() => act("APPLE_CAREERS_QUEUE_TOP_JOBS")}>{selectedIds.length ? `Queue Selected (${selectedIds.length})` : `Queue Top ${n}`}</button>
      <button type="button" className="primary" disabled={busy || view?.running || !view?.queued?.length} onClick={() => setApplyOpen(true)}>Review And Apply</button>
      <HelpTooltip label="Review And Apply" text="Review the actual saved batch in a confirmation sheet, acknowledge match concerns, then apply. Apple capacity is verified again before submission." />
    </div>
    {applicationFailures.some(job => job.status !== "submitted") && <p className="muted">Application Failures And Job Links Are In Activity.</p>}
    <Sheet open={applyOpen} onClose={() => setApplyOpen(false)} title="Review Application Batch" busy={busy}>
      <p>{view?.queued?.length || 0} Queued · {capacity?.known ? `${capacity.remaining} Available Slots` : "Capacity Will Be Verified"}</p>
      <ul className="sheet-job-list">{view?.queued?.map(job => <li key={job.jobId}><a href={job.url} target="_blank" rel="noopener noreferrer">{job.title}</a><span className="compact-role-meta">{job.jobId} · {job.score}% · {job.eligible ? "Strong Match" : "Match Concerns"}</span>{!job.eligible && <p className="muted">{job.reason}</p>}</li>)}</ul>
      {needsQueueReview && <label className="checkbox-row consent-row"><input type="checkbox" checked={queueReviewAcknowledged} disabled={busy} onChange={(event) => setReviewedQueueToken(event.target.checked ? view.queueReviewToken : null)} /><span>I Reviewed The Match Concerns For These {view.queueReviewCount} Jobs</span></label>}
      <label className="checkbox-row consent-row"><input type="checkbox" checked={profile.autoApplyConsent} disabled={busy} onChange={(event) => save({autoApplyConsent:event.target.checked})} /><span>I Allow These Applications To Be Submitted</span></label>
      <div className="compact-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setApplyOpen(false)}>Cancel</button><button type="button" className="primary" disabled={busy || view?.running || !view?.queued?.length || !profile.autoApplyConsent || !queueReviewAcknowledged} onClick={() => act("APPLE_CAREERS_APPLY_JOB_QUEUE")}>Apply Queue</button></div>
      {error && <p role="alert" className="submitted-history-error">{error}</p>}<button type="button" className="text-action" disabled={busy} onClick={() => {setApplyOpen(false);onOpenSetup?.();}}>Open Setup</button>
    </Sheet>
  </FunctionSection>;
}
