import { jobStore } from "../lib/jobStore";
import { Sheet } from "./Sheet";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { FunctionSection } from "./FunctionSection";
import { CompactRoleCard } from "./CompactRoleCard";
import { SelectionCapacitySummary } from "./SelectionCapacitySummary";
import { CurrentRoleApplication } from "./CurrentRoleApplication";
import { getActiveTab, formatRelativeTime } from "../lib/format";

const RANKING_VIEW_KEY = "appleCareersRankingView";

export function RankedJobsSection({ profile, save, setStatusMessage, onSummaryChange, embedded = false, onOpenSetup }) {
  const roleGroupId = useId();
  const [view, setView] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedQueueIds, setSelectedQueueIds] = useState([]);
  const [applicationBatch, setApplicationBatch] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const initializedTop = useRef(false);
  const [topN, setTopN] = useState(50);
  const [topNDraft, setTopNDraft] = useState("50");
  const [query, setQuery] = useState("");
  const [listView, setListView] = useState("ranked");
  const [viewPreferencesLoaded, setViewPreferencesLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [error, setError] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [rankedOpen, setRankedOpen] = useState(true);
  const [reviewedQueueToken, setReviewedQueueToken] = useState(null);

  useEffect(() => {
    let cancelled = false;
    chrome.storage.local.get(RANKING_VIEW_KEY).then(stored => {
      if (cancelled) return;
      const saved = stored[RANKING_VIEW_KEY] || {};
      if (Number.isInteger(saved.topN) && saved.topN >= 1 && saved.topN <= 1000) {
        initializedTop.current = true;
        setTopN(saved.topN); setTopNDraft(String(saved.topN));
      }
      if (typeof saved.query === "string") setQuery(saved.query);
      if (["ranked", "excluded", "stale"].includes(saved.listView)) setListView(saved.listView);
    }).catch(console.error).finally(() => { if (!cancelled) setViewPreferencesLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!viewPreferencesLoaded) return;
    chrome.storage.local.set({ [RANKING_VIEW_KEY]: { topN: initializedTop.current ? topN : null, query, listView } }).catch(console.error);
  }, [viewPreferencesLoaded, topN, query, listView]);

  const refresh = useCallback(async (requestedTopN = topN) => {
    // Restore the view before fetching; a default Top 50 request can expose
    // lower-ranked cached roles for a moment after every panel reload.
    if (!viewPreferencesLoaded) return;
    const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_GET_JOB_RANKING", userProfile: profile, topN: initializedTop.current ? requestedTopN : null });
    if (response?.ok) {
      if (!initializedTop.current && response.data.capacity?.known) {
        initializedTop.current = true;
        setTopN(response.data.topN); setTopNDraft(String(response.data.topN));
      }
      setView(response.data);
    }
    else setError(response?.error || "Saved jobs could not be loaded.");
  }, [profile, topN, viewPreferencesLoaded]);

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

  useEffect(() => {
    if (!view) return;
    const queuedIds = new Set(view.queued.map(job => job.jobId));
    setSelectedQueueIds(ids => {
      const retained = ids.filter(id => queuedIds.has(id));
      return retained.length === ids.length ? ids : retained;
    });
    const rankedIds = new Set(view.candidates.filter(job => job.queueStatus !== "queued").map(job => job.jobId));
    setSelectedIds(ids => {
      const retained = ids.filter(id => rankedIds.has(id));
      return retained.length === ids.length ? ids : retained;
    });
  }, [view]);
  function commitTopN() {
    // Keep the displayed draft as text so clearing or replacing digits is possible.
    // Normalize only on commit; an empty/invalid draft restores the last chosen value.
    const parsed = Number(topNDraft);
    const requestedTopN = Math.min(1000, Math.max(1,
      Math.floor(topNDraft.trim() && Number.isFinite(parsed) ? parsed : topN)));
    initializedTop.current = true;
    setTopN(requestedTopN);
    setTopNDraft(String(requestedTopN));
    return requestedTopN;
  }

  async function act(type) {
    // Use the committed draft directly, including when clicking immediately after editing.
    const requestedTopN = commitTopN();
    setBusy(true);
    setPendingAction(type);
    setError("");
    try {
      const tab = await getActiveTab();
      const savedProfile = await save();
      const response = await chrome.runtime.sendMessage({ type: type === "APPLE_CAREERS_RESUME_JOB_RANKING" ? "APPLE_CAREERS_START_JOB_RANKING" : type, userProfile: savedProfile, topN: requestedTopN,
        reviewAcknowledgement: reviewedQueueToken, tab,
        selectedIds: type === "APPLE_CAREERS_APPLY_JOB_QUEUE" ? applicationBatch?.jobs.map(job => String(job.jobId)) : selectedIds,
        candidateIds: type === "APPLE_CAREERS_QUEUE_TOP_JOBS" ? visible.map(job => String(job.jobId)) : undefined,
        batchToken: type === "APPLE_CAREERS_APPLY_JOB_QUEUE" ? applicationBatch?.batchToken : undefined,
        resume: type === "APPLE_CAREERS_RESUME_JOB_RANKING",
        autoApply: savedProfile.afterRanking === "auto" });
      if (!response?.ok) throw new Error(response?.error || "The job queue could not be updated.");
      if (type === "APPLE_CAREERS_QUEUE_TOP_JOBS") { setQueueOpen(true); setSelectedIds([]); }
      if (type === "APPLE_CAREERS_APPLY_JOB_QUEUE") {
        setApplyOpen(false); setSelectedQueueIds([]);
        setView(current => current ? { ...current, running: true, phase: "Checking Apple submission capacity" } : current);
      }
      setStatusMessage(type === "APPLE_CAREERS_QUEUE_TOP_JOBS" ? `${response.count} top-ranked jobs saved to the application queue.${response.reviewCount ? ` ${response.reviewCount} have match concerns to review before applying.` : ""}`
        : type === "APPLE_CAREERS_REFRESH_QUEUE_CAPACITY" ? "Active submission count refreshed without LLM matching."
        : type === "APPLE_CAREERS_APPLY_JOB_QUEUE" ? "Checking Apple submission count, then applying only the selected roles in score order."
          : type === "APPLE_CAREERS_STOP_JOB_RANKING" ? "Stopping after the current action; saved matches remain available."
            : "Ranking all pages of the current filtered Apple search. Results appear as jobs are scored.");
      if (type === "APPLE_CAREERS_APPLY_JOB_QUEUE") refresh(requestedTopN).catch(console.error);
      else await refresh(requestedTopN);
    } catch (failure) {
      setError(failure?.message || "The job queue could not be updated.");
    } finally { setBusy(false); setPendingAction(null); }
  }

  async function remove(jobId) {
    const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_REMOVE_QUEUED_JOB", jobId });
    if (!response?.ok) setError(response?.error || "Could not remove the queued job.");
    await refresh();
  }

  async function reviewSelectedBatch() {
    setBusy(true);
    setPendingAction("prepare");
    setError("");
    setReviewedQueueToken(null);
    try {
      const savedProfile = await save();
      const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_PREPARE_APPLICATION_BATCH", userProfile: savedProfile, selectedIds: selectedQueueIds });
      if (!response?.ok) throw new Error(response?.error || "The selected batch could not be prepared.");
      setApplicationBatch(response.data);
      setView(current => current ? { ...current, capacity: response.data.capacity } : current);
      setApplyOpen(true);
    } catch (failure) {
      setError(failure?.message || "The selected batch could not be prepared.");
      await refresh();
    } finally { setBusy(false); setPendingAction(null); }
  }

  useEffect(() => {
    if (view) onSummaryChange?.(view);
  }, [view, onSummaryChange]);

  const capacity = view?.capacity;
  const jobs = [...new Map([...(view?.ranked || []), ...(view?.candidates || [])]
    .map((job) => [String(job.jobId), job])).values()].filter((job) => job.queueStatus !== "queued").sort((a, b) => b.score - a.score);
  const search = query.trim().toLowerCase();
  const matchesSearch = (job) => `${job.jobId} ${job.title}`.toLowerCase().includes(search);
  const listJobs = listView === "excluded" ? view?.excludedMatches || []
    : listView === "stale" ? view?.staleMatches || [] : jobs;
  const visible = listJobs.filter(matchesSearch);
  const n = Math.min(visible.length, topN, capacity?.known ? capacity.remaining : topN);
  const latestSearch = Object.values(view?.searches || {}).sort((a, b) => b.startedAt - a.startedAt)[0];
  const canQueue = listView === "ranked" && (selectedIds.length > 0 || n > 0);

  const visibleQueued = (view?.queued || []).filter(matchesSearch);
  const selectedQueued = (view?.queued || []).filter(job => selectedQueueIds.includes(job.jobId));
  const needsQueueReview = !!applicationBatch?.reviewToken;
  const queueReviewAcknowledged = !needsQueueReview || reviewedQueueToken === applicationBatch.reviewToken;
  const interruptedRanking = view?.recovered && latestSearch && !latestSearch.complete && /^Ranking\b/i.test(view.phase || "");
  const progressLabel = view?.running
    ? /^Checking Apple submission/i.test(view.phase || "") ? "Checking Submission Capacity"
      : /^Applying/i.test(view.phase || "") ? view.workflowMode === "current_role" ? "Applying This Role" : "Applying Application Queue"
      : /page (\d+)/i.test(view.phase || "") ? `Ranking Page ${view.phase.match(/page (\d+)/i)[1]}` : "Ranking Jobs"
    : view?.recovery?.stopRequested ? "Application Stopped"
      : view?.recovered ? interruptedRanking ? "Scan Interrupted" : "Workflow Interrupted"
      : view?.error ? /Application queue/i.test(view.phase || "") ? view.workflowMode === "current_role" ? "Application Needs Review" : "Application Queue Paused" : "Ranking Paused"
      : /Application queue/i.test(view?.phase || "") ? view.workflowMode === "current_role" ? /stopped/i.test(view.phase) ? "Application Stopped" : "Application Finished" : /stopped/i.test(view.phase) ? "Application Queue Stopped" : "Application Queue Finished"
        : /50-application target/i.test(view?.phase || "") ? "Application Limit Reached"
          : /Ranking stopped/i.test(view?.phase || "") ? "Scan Stopped"
            : latestSearch?.complete && /rank/i.test(view?.phase || "") ? "Ranking Complete"
              : view?.phase ? "Rankings Saved" : "Ready To Rank";

  function jobCard(job, disclosureGroup) {
    const queued = job.queueStatus === "queued";
    const status = job.stale ? "Saved Score · Update Required" : ["needs_review", "uncertain", "applying"].includes(job.queueStatus) ? "Application Needs Review"
      : job.queueStatus === "queued" ? job.eligible ? "Queued" : "Queued · Match Concerns"
        : job.breakdown ? job.eligible ? "Strong Match" : "Match Concerns" : "Excluded Or Unscored";
    return <CompactRoleCard key={job.jobId} role={job} status={status} disclosureGroup={disclosureGroup}
      selectable={!job.stale && Boolean(job.breakdown) && !["needs_review","uncertain","applying"].includes(job.queueStatus)}
      selected={(queued ? selectedQueueIds : selectedIds).includes(job.jobId)} disabled={busy || view?.running || applyOpen}
      actions={job.queueStatus === "queued" && <button type="button" className="secondary"
        aria-label={`Remove ${job.title} From Queue`} disabled={busy || view?.running}
        onClick={() => remove(job.jobId)}>Remove From Queue</button>}
      onSelect={() => (queued ? setSelectedQueueIds : setSelectedIds)(ids => ids.includes(job.jobId) ? ids.filter(id => id !== job.jobId) : [...ids, job.jobId])}>
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
        {(job.evidence || []).map((item, index) => <div className="evidence-item" key={index}>
          <p><strong>Role:</strong> {item.job_quote}</p><p><strong>Candidate Evidence:</strong> {item.resume_quote}</p>
        </div>)}
        {(job.minimumChecks || []).map((item, index) => <div className="evidence-item" key={`minimum-${index}`}>
          <strong>{job.neutralQualifications?.some(qualification => qualification.id === Number(item.id)) ? "Coding Workflow · Not Scored" : `Minimum Qualification (${item.status})`}</strong><p>{item.requirement_quote}</p>
          {item.resume_quote && <p><strong>Candidate Evidence:</strong> {item.resume_quote}</p>}
        </div>)}
      </div></details>}
    </CompactRoleCard>;
  }

  return <FunctionSection embedded={embedded} title="Find Your Best Matches" meta={view?.running ? "Running" : `${view?.queued?.length || 0} Queued`}
    defaultOpen running={view?.running}
    headerAction={view?.running && <button type="button" className="danger" disabled={busy} onClick={() => act("APPLE_CAREERS_STOP_JOB_RANKING")}>Stop</button>}
    help="Rank the complete filtered search against your resume, then choose roles for Application Queue. Applying checks available slots before submission.">
    <CurrentRoleApplication save={save} running={busy || view?.running || applyOpen} setStatusMessage={setStatusMessage} onOpenSetup={onOpenSetup}
      onStarted={() => { setView(current => current ? { ...current, running: true, workflowMode: "current_role", phase: "Checking Apple submission capacity" } : current); refresh().catch(console.error); }} />
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
      {!view?.running && view?.lastBatchSummary && <span className="compact-role-meta">{view.workflowMode === "current_role" ? "Last Application" : "Last Batch"}: {view.lastBatchSummary.submitted} Submitted · {view.lastBatchSummary.failed} Need Review
        {!!view.lastBatchSummary.alreadySubmitted && <> · {view.lastBatchSummary.alreadySubmitted} Already Submitted</>}
        {!!view.lastBatchSummary.remainingQueued && <> · {view.lastBatchSummary.remainingQueued} Selected Roles Still Queued</>}
      </span>}
      {latestSearch && <span className="compact-role-meta">{latestSearch.pagesRead || 0} Pages Finished · {latestSearch.complete ? "All Pages Ranked" : "Partial Scan"}</span>}
      {view?.currentJob && <a className="compact-role-meta" href={view.currentJob.url} target="_blank" rel="noopener noreferrer">{view.currentJob.title} · {view.currentJob.jobId}</a>}</span>
    </div>
    {view?.recovered && <p className="submitted-history-error" role="alert">{interruptedRanking
      ? `The previous scan was interrupted on page ${(latestSearch.pageIndex || 0) + 1}. Choose Resume Scan to continue using saved scores.`
      : view?.recovery?.reconciliationRequired
        ? "The application workflow was interrupted. Sync Submissions, then review your selection before starting again. No applications resumed automatically."
        : "The previous workflow was interrupted. Saved scores and queued jobs remain available. Check Activity for applications needing review."}</p>}
    {(error || view?.error) && <p className="submitted-history-error" role="alert">{error || view.error}
      {!error && view?.errorJob && <> <a href={view.errorJob.url} target="_blank" rel="noopener noreferrer">
        Review {view.errorJob.title} (Job ID {view.errorJob.jobId})
      </a></>}
    </p>}
    <details className="compact-fold"><summary>Scan Details</summary>
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
    <input className="compact-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find Job ID Or Title" aria-label="Find Jobs By Job ID Or Title" />
    <details className="compact-fold job-list-section" open={rankedOpen} onToggle={(event) => {
      if (event.target === event.currentTarget) setRankedOpen(event.currentTarget.open);
    }}><summary>Ranked Jobs <span className="function-meta">{visible.length} Jobs</span></summary>
      <div className="compact-fold-body">
        <div className="compact-list-heading">
          <label className="field-label" htmlFor="ranked-jobs-view">View</label>
        {listView === "ranked" && <label className="top-matches-control">Top <input type="number" min="1" max="1000" step="1" value={topNDraft} aria-label="Top Matches"
            onChange={(event) => setTopNDraft(event.target.value)} onBlur={commitTopN}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label>}
        </div>
        <select id="ranked-jobs-view" value={listView} onChange={event => { setListView(event.target.value); setSelectedIds([]); }}>
          <option value="ranked">Top Matches</option>
          <option value="excluded">Excluded Or Unscored</option>
          <option value="stale">Saved Scores To Update ({view?.staleCount || 0})</option>
        </select>
        {listView === "stale" && !!view?.staleCount && <p className="muted">Scan And Rank to update these scores against your current resume and matching settings.</p>}
        {visible.length ? <ul className="submitted-role-list compact-role-list">{visible.map(job => jobCard(job, `${roleGroupId}-ranked`))}</ul> : <p className="muted">{search ? "No jobs match this search in the selected view."
          : listView === "excluded" ? "No excluded or unscored jobs."
            : listView === "stale" ? "No saved scores need updating." : "No ranked jobs yet."}</p>}
        {listView === "ranked" && <div className="compact-actions role-list-actions">
          <button type="button" className="secondary" disabled={busy || view?.running || !canQueue} onClick={() => act("APPLE_CAREERS_QUEUE_TOP_JOBS")}>{selectedIds.length ? `Queue Selected (${selectedIds.length})` : `Queue Top ${n}`}</button>
        </div>}
      </div>
    </details>
    <details className="compact-fold job-list-section" open={queueOpen} onToggle={(event) => {
      if (event.target === event.currentTarget) setQueueOpen(event.currentTarget.open);
    }}><summary>Application Queue <span className="function-meta">{view?.queued?.length || 0} Jobs</span>
      <HelpTooltip label="Application Queue" text="Check roles, then choose Apply Selected to review and confirm the batch. Unselected roles stay queued." /></summary>
      <div className="compact-fold-body application-queue-body">
        {!!view?.queued?.length && <>
          <div className="compact-actions">
            <button type="button" className="secondary" disabled={busy || view?.running || applyOpen || !visibleQueued.length} onClick={() => setSelectedQueueIds(ids => [...new Set([...ids, ...visibleQueued.map(job => job.jobId)])])}>{search ? "Select All Visible" : "Select All"}</button>
            <button type="button" className="secondary" disabled={busy || view?.running || applyOpen || !selectedQueued.length} onClick={() => setSelectedQueueIds([])}>Clear Selection</button>
          </div>
          <div className="queue-selection-summary">
            <SelectionCapacitySummary selectedCount={selectedQueued.length} capacity={capacity} hiddenCount={selectedQueued.filter(job => !matchesSearch(job)).length} />
          </div>
        </>}
        {visibleQueued.length ? <ul className="submitted-role-list compact-role-list">{visibleQueued.map(job => jobCard(job, `${roleGroupId}-queue`))}</ul> : <span>{view?.queued?.length ? "No queued jobs match this search." : "No jobs queued."}</span>}
        <div className="compact-actions role-list-actions">
          <button type="button" className="primary" disabled={busy || view?.running || !selectedQueued.length} onClick={reviewSelectedBatch}>{pendingAction === "prepare" ? "Preparing Batch…" : `Apply Selected (${selectedQueued.length})`}</button>
        </div>
      </div>
    </details>
    <Sheet open={applyOpen} onClose={() => setApplyOpen(false)} title="Review Application Batch" busy={busy}>
      <SelectionCapacitySummary selectedCount={applicationBatch?.jobs.length || 0} capacity={capacity || applicationBatch?.capacity} />
      <p className="muted">Capacity Is Verified Before Applying. Selected Roles Are Processed In Score Order Until Slots Are Filled. Extra Selections Can Be Used If An Application Fails; Unprocessed Roles Stay Queued.</p>
      <ul className="sheet-job-list">{applicationBatch?.jobs.map(job => <li key={job.jobId}><a href={job.url} target="_blank" rel="noopener noreferrer">{job.title}</a><span className="compact-role-meta">{job.jobId} · {job.score}% · {job.eligible ? "Strong Match" : "Match Concerns"}</span>{!job.eligible && <p className="muted">{job.reason}</p>}</li>)}</ul>
      {needsQueueReview && <label className="checkbox-row consent-row"><input type="checkbox" checked={queueReviewAcknowledged} disabled={busy} onChange={(event) => setReviewedQueueToken(event.target.checked ? applicationBatch.reviewToken : null)} /><span>I Reviewed The Match Concerns For These {applicationBatch.reviewCount} Jobs</span></label>}
      <label className="checkbox-row consent-row"><input type="checkbox" checked={profile.autoApplyConsent} disabled={busy} onChange={(event) => save({autoApplyConsent:event.target.checked})} /><span>I Allow These Applications To Be Submitted</span></label>
      <div className="compact-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setApplyOpen(false)}>Cancel</button><button type="button" className="primary" disabled={busy || view?.running || !applicationBatch?.jobs.length || !profile.autoApplyConsent || !queueReviewAcknowledged} onClick={() => act("APPLE_CAREERS_APPLY_JOB_QUEUE")}>{pendingAction === "APPLE_CAREERS_APPLY_JOB_QUEUE" ? "Starting…" : `Confirm And Apply (${applicationBatch?.jobs.length || 0})`}</button></div>
      {error && <p role="alert" className="submitted-history-error">{error}</p>}<button type="button" className="text-action" disabled={busy} onClick={() => {setApplyOpen(false);onOpenSetup?.();}}>Open Setup</button>
    </Sheet>
  </FunctionSection>;
}
