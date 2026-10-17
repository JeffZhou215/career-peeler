import { jobStore } from "../lib/jobStore";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { FunctionSection } from "./FunctionSection";
import { CompactRoleCard } from "./CompactRoleCard";
import { fingerprintText, resolveResumeProfileText } from "../lib/profile";
import { getActiveTab, sendMessageWithFallback } from "../lib/format";
import { submissionCollection, filterSubmissions, retainSubmissionSelection } from "../lib/submissionCollection.mjs";
import { SubmissionSyncIndicator } from "./SubmissionSyncIndicator";
import { withdrawSubmittedRolesSequentially } from "../lib/submittedWithdrawals.mjs";

const SAVED_REVIEWS_KEY = "appleSubmittedRoleReviews";

function rankSubmittedRoles(roles) {
  const activeRoles = roles.filter((role) => role.active !== false).map(role => ({ ...role,
    protectedFromBatchWithdrawal: String(role.jobId).split("-")[0] === "200654506" || role.favorite !== false || role.protectedFromBatchWithdrawal !== false }));
  const lowMatches = activeRoles
    .filter((role) => role.protectedFromBatchWithdrawal === false)
    .sort((left, right) => (left.score ?? 101) - (right.score ?? 101));
  const protectedRoles = activeRoles
    .filter((role) => role.protectedFromBatchWithdrawal !== false)
    .sort((left, right) => String(left.title || "").localeCompare(String(right.title || "")));
  return [...lowMatches, ...protectedRoles];
}

export function SubmittedApplicationsSection({ profile, setStatusMessage, embedded = false, syncStatus, syncNow }) {
  const roleGroupId = useId();
  const [roles, setRoles] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); busyRef.current = busy;
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationSelection, setConfirmationSelection] = useState([]);
  const confirmationSelectionRef = useRef(null);
  const confirmationReviewedAtRef = useRef(null);
  const withdrawalInFlightRef = useRef(false);
  const [withdrawProgress, setWithdrawProgress] = useState(null);
  const [error, setError] = useState("");
  const [postingCacheStats, setPostingCacheStats] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [savedArchive, setSavedArchive] = useState({});
  const savedArchiveRef = useRef({});
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const confirmationRef = useRef(null);
  const [stopRequested, setStopRequested] = useState(false);
  const activeAnalysisIdRef = useRef(null);
  const allScanReviewsRef = useRef(new Map());

  const selectedRoles = useMemo(
    () => roles.filter((role) => selectedIds.includes(role.jobId)),
    [roles, selectedIds]
  );
  const collection = submissionCollection(savedArchive);
  const savedSnapshot = savedArchive.latestScan;
  const visibleRoles = filterSubmissions(roles, statusFilter, searchQuery);
  const hiddenSelectedCount = selectedRoles.filter(role => !visibleRoles.some(visible => visible.jobId === role.jobId)).length;

  function showArchive(archive) {
    const next = submissionCollection(archive);
    savedArchiveRef.current = archive;
    setSavedArchive(archive);
    setRoles(next.roles);
    setSelectedIds(current => retainSubmissionSelection(current, next.roles));
  }

  async function reloadArchive() {
    const stored = await jobStore.get(SAVED_REVIEWS_KEY);
    showArchive(stored[SAVED_REVIEWS_KEY] || {});
  }

  useEffect(() => {
    let cancelled = false;
    async function loadSavedResults() {
      const stored = await jobStore.get(SAVED_REVIEWS_KEY);
      if (cancelled || activeAnalysisIdRef.current) return;
      showArchive(stored[SAVED_REVIEWS_KEY] || {});
    }
    loadSavedResults().catch(error => { if (!cancelled) setError(error?.message || "Saved submissions could not be loaded from the job database."); });
    function handleProgress(message) {
      if (message?.type !== "APPLE_CAREERS_SUBMITTED_ROLES_PROGRESS" ||
        message.analysisId !== activeAnalysisIdRef.current) return;
      if (message.scope !== "all" || !message.data?.review) return;
      allScanReviewsRef.current.set(message.data.review.pageIndex, message.data.review);
      const reviews = Array.from(allScanReviewsRef.current.values());
      const prior = savedArchiveRef.current;
      showArchive({ ...prior, lastCompleteScan: prior.lastCompleteScan || (prior.latestScan?.complete ? prior.latestScan : null),
        pages: { ...prior.pages, ...Object.fromEntries(reviews.map(review => [review.pageIndex, review])) },
        latestScan: { ...(prior.latestScan || {}), complete: false, roles: reviews.flatMap(review => review.roles || []),
          updatedAt: Date.now(), pagesRead: reviews.length, pageCount: message.data.pageCount } });
      setPostingCacheStats({ reused: reviews.reduce((sum, review) => sum + (review.descriptionsReused || 0), 0),
        fetched: reviews.reduce((sum, review) => sum + (review.descriptionsFetched || 0), 0),
        scoresReused: reviews.reduce((sum, review) => sum + (review.scoresReused || 0), 0),
        scoresFetched: reviews.reduce((sum, review) => sum + (review.scoresFetched || 0), 0) });
    }
    const storageListener = (changes, area) => { if ((area === "local" || area === "indexeddb") && changes[SAVED_REVIEWS_KEY] && !activeAnalysisIdRef.current && !busyRef.current) loadSavedResults().catch(console.error); };
    jobStore.onChanged.addListener(storageListener);
    chrome.runtime.onMessage.addListener(handleProgress);
    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(handleProgress);
      jobStore.onChanged.removeListener(storageListener);
    };
  }, []);

  async function analyzeAllRoles() {
    setBusy(true);
    setError("");
    setConfirmationOpen(false);
    try {
      const tab = await getActiveTab();
      if (!tab?.id || !/^https:\/\/jobs\.apple\.com\/app\/[^/]+\/profile\/roles\/?(?:[?#]|$)/i.test(tab.url || "")) {
        throw new Error("Open Apple Careers → Your Roles → Submissions → Active before scanning all pages.");
      }
      allScanReviewsRef.current = new Map();
      setSelectedIds([]);
      const analysisId = crypto.randomUUID();
      activeAnalysisIdRef.current = analysisId;
      setAnalysisRunning(true);
      setStopRequested(false);
      setStatusMessage("Analyzing All Submissions…");
      const response = await chrome.runtime.sendMessage({
        type: "APPLE_CAREERS_ANALYZE_ALL_SUBMITTED_ROLES",
        tabId: tab.id,
        userProfile: profile,
        analysisId
      });
      if (!response?.ok) throw new Error(response?.error || "Could not scan all Apple submissions.");
      await reloadArchive();
      setError(response.data.warning || "");
      setStatusMessage(response.data.stopped ? "Analysis Stopped. Saved Results Remain Available." : "Submissions Analyzed. Review The Lowest Matches Before Selecting Withdrawals.");
    } catch (scanError) {
      await reloadArchive().catch(() => {});
      setError(scanError?.message || "The all-submissions scan stopped.");
      setStatusMessage("All-submissions scan stopped. Saved pages remain available.");
    } finally {
      activeAnalysisIdRef.current = null;
      setAnalysisRunning(false);
      setStopRequested(false);
      setBusy(false);
    }
  }

  async function syncSubmissions() {
    setBusy(true); setError("");
    try {
      const tab = await getActiveTab();
      const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_REFRESH_QUEUE_CAPACITY", tab });
      if (!response?.ok) throw new Error(response?.error || "Could not sync submissions.");
      await reloadArchive();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function stopAnalysis() {
    if (!activeAnalysisIdRef.current || stopRequested) return;
    setStopRequested(true);
    setStatusMessage("Stopping after the current posting or OpenAI batch finishes...");
    await chrome.runtime.sendMessage({
      type: "APPLE_CAREERS_STOP_SUBMITTED_ROLES_ANALYSIS",
      analysisId: activeAnalysisIdRef.current
    }).catch(() => {});
  }

  function toggleRole(jobId) {
    setSelectedIds((current) =>
      current.includes(jobId) ? current.filter((id) => id !== jobId) : [...current, jobId]
    );
  }

  function reviewWithdrawals() {
    if (busyRef.current || !selectedRoles.length) return;
    const reviewed = selectedRoles.map(({ jobId, title }) => ({ jobId: String(jobId), title }));
    confirmationSelectionRef.current = reviewed;
    confirmationReviewedAtRef.current = Date.now();
    setConfirmationSelection(reviewed);
    setConfirmationOpen(true);
  }

  function closeWithdrawalConfirmation() {
    if (withdrawalInFlightRef.current) return;
    confirmationSelectionRef.current = null;
    setConfirmationSelection([]);
    setConfirmationOpen(false);
  }

  useEffect(() => {
    const dialog = confirmationRef.current;
    if (!dialog) return;
    if (confirmationOpen && !dialog.open) dialog.showModal();
    if (!confirmationOpen && dialog.open) dialog.close();
  }, [confirmationOpen]);

  function renderRoleCard(role, protectedFromBatch = false) {
    const protectedLabel = String(role.jobId).split("-")[0] === "200654506"
      ? "Interview In Progress · Protected"
      : role.favorite === true ? "Starred · Protected" : "Star Status Unknown · Protected";
    return <CompactRoleCard key={role.jobId} role={role} disclosureGroup={`${roleGroupId}-submissions`}
      status={protectedFromBatch ? protectedLabel : role.availabilityUnknown ? "Saved · Availability Unverified" : role.submittedDate ? `Submitted ${role.submittedDate}` : "Submitted"}
      selectable={!protectedFromBatch} selected={selectedIds.includes(role.jobId)}
      disabled={busy || confirmationOpen} onSelect={() => toggleRole(role.jobId)}>
      <span className="submitted-role-id">{role.scoreSource === "previous_review" ? "Saved Score" : role.descriptionAvailable ? "Scored Against Job Description" : "Review Posting Manually"}</span>
    </CompactRoleCard>;
  }


  async function withdrawSelected() {
    if (withdrawalInFlightRef.current || !confirmationOpen || !confirmationSelectionRef.current?.length) return;
    withdrawalInFlightRef.current = true;
    const targets = confirmationSelectionRef.current.map(({ jobId, title }) => ({ jobId, title }));
    confirmationSelectionRef.current = null;
    const reviewedAt = confirmationReviewedAtRef.current;
    confirmationReviewedAtRef.current = null;
    const batchId = crypto.randomUUID();
    let lockAcquired = false;
    const pending = new Map(targets.map((role) => [String(role.jobId), role]));
    const skipped = [];
    let confirmedCount = 0;
    setBusy(true);
    setError("");
    setStatusMessage(`Preparing to withdraw ${targets.length} selected Apple applications...`);
    try {
      const ranking = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_GET_JOB_RANKING" });
      if (ranking?.data?.running) throw new Error("Stop the job ranking or application queue before withdrawing applications.");
      const tab = await getActiveTab();
      if (!tab?.id) {
        throw new Error("Return to the Apple tab containing your submissions.");
      }
      if (!/^https:\/\/jobs\.apple\.com\/app\/[^/]+\/profile\/roles\/?(?:[?#]|$)/i.test(tab.url || "")) {
        throw new Error("Open Apple Careers → Your Roles → Submissions → Active before withdrawing.");
      }
      const lock = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_WITHDRAWAL_BATCH_STATE", active: true,
        batchId, tabId: tab.id, roles: targets, confirmed: true, reviewedAt });
      if (!lock?.ok) throw new Error(lock?.error || "Another workflow is running.");
      lockAcquired = true;
      const readApplePage = async (type, payload = {}) => {
        const response = await sendMessageWithFallback(tab.id, { type, ...payload });
        if (!response?.ok) throw new Error(response?.error || "Apple's active submissions page could not be read.");
        return response.data;
      };
      const readSettledPage = async () => {
        const deadline = Date.now() + 15000;
        let previousSignature = "";
        let stableReads = 0;
        let lastError;
        while (Date.now() < deadline) {
          try {
            const page = await readApplePage("APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE");
            const signature = `${page.pageIndex}|${page.pageCount}|${page.roles.map((role) => role.jobId).join("|")}`;
            stableReads = signature === previousSignature ? stableReads + 1 : 1;
            previousSignature = signature;
            if (stableReads >= 3) {
              return page;
            }
          } catch (error) {
            lastError = error;
            stableReads = 0;
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        throw lastError || new Error("Apple's submissions list did not settle after the withdrawal.");
      };
      let page = await readSettledPage();
      const visitedPages = new Set();
      let navigationRecoveries = 0;
      while (pending.size) {
        if (page.withdrawalConfirmationOpen) {
          throw new Error("An Apple withdrawal confirmation is already open. Resolve it before continuing.");
        }
        if (visitedPages.has(page.pageIndex)) break;
        visitedPages.add(page.pageIndex);
        const matchingCard = page.roles.find((card) =>
          pending.has(String(card.jobId)) && card.active && card.protectedFromBatchWithdrawal === false
        );
        if (matchingCard) {
          const role = pending.get(String(matchingCard.jobId));
          const matchedPageIndex = page.pageIndex;
          page = await readSettledPage();
          if (page.pageIndex !== matchedPageIndex ||
            !page.roles.some((card) => String(card.jobId) === String(role.jobId))) {
            visitedPages.clear();
            continue;
          }
          const liveCard = page.roles.find((card) => String(card.jobId) === String(role.jobId));
          if (!liveCard?.active || liveCard.protectedFromBatchWithdrawal !== false) {
            visitedPages.clear();
            continue;
          }
          const requestId = crypto.randomUUID();
          await withdrawSubmittedRolesSequentially([role], {
            batchId,
            requestId,
            withdrawOne: () => chrome.tabs.sendMessage(tab.id, {
              type: "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES",
              batchId,
              requestId,
              roles: [role],
              expectedPageIndex: page.pageIndex
            }),
            verifyRoleStatus: async () => {
              const response = await chrome.tabs.sendMessage(tab.id, {
                type: "APPLE_CAREERS_GET_WITHDRAWAL_STATUS", batchId, requestId, jobId: role.jobId
              });
              if (!response?.ok) throw new Error(response?.error || "The withdrawal outcome could not be verified.");
              return response.data;
            },
            onRoleStart: () => {
              setWithdrawProgress({ index: confirmedCount + 1, total: targets.length, title: role.title });
              setStatusMessage(`Withdrawing ${confirmedCount + 1} of ${targets.length}: ${role.title}...`);
            },
            onRoleConfirmed: async ({ verifiedAfterInterruption }) => {
              setStatusMessage(`Updating the visible submissions page after ${role.title}...`);
              let refreshError = null;
              try { page = await readSettledPage(); }
              catch (error) { refreshError = error; }
              if (!refreshError && page.roles.some(item => String(item.jobId) === String(role.jobId) && item.active === true)) {
                await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_INVALIDATE_WITHDRAWAL_OUTCOME", batchId, requestId,
                  jobId: role.jobId, reason: "The exact selected job is still active before local withdrawal records could be updated." });
                throw new Error("Apple still shows this exact job as active. Sync Submissions before reviewing another attempt.");
              }
              // The worker checks the current durable outcome and commits local
              // cleanup together. A receipt checked before this awaited page read
              // could have been revoked by recovery or contradictory evidence.
              const finalized = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_FINALIZE_WITHDRAWAL",
                batchId, requestId, jobId: role.jobId, livePage: refreshError ? null : page });
              if (!finalized?.ok || finalized.data?.jobId !== role.jobId || finalized.data.batchId !== batchId ||
                  finalized.data.requestId !== requestId || finalized.data.outcome !== "inactive" ||
                  finalized.data.cleanupConfirmed !== true || finalized.data.proofVersion !== 3) {
                throw new Error(finalized?.error || "The withdrawal proof changed before saved records could be updated. Sync Submissions again.");
              }
              confirmedCount += 1;
              setRoles((current) => rankSubmittedRoles(current.filter((item) => String(item.jobId) !== String(role.jobId))));
              setSelectedIds((current) => current.filter((jobId) => String(jobId) !== String(role.jobId)));
              await reloadArchive();
              if (refreshError) throw new Error(`${role.title}: Apple confirmed the withdrawal, but its current page could not be read. ${refreshError?.message || "Sign in again to continue."}`);
              setStatusMessage(`${confirmedCount} of ${targets.length} withdrawn${verifiedAfterInterruption ? " · verified after Apple refreshed the page" : ""}.`);
            }
          });
          pending.delete(String(role.jobId));
          visitedPages.clear();
          navigationRecoveries = 0;
          continue;
        }
        for (const card of page.roles) {
          if (!pending.has(String(card.jobId))) continue;
          if (card.active && card.protectedFromBatchWithdrawal === false) continue;
          const role = pending.get(String(card.jobId));
          pending.delete(String(card.jobId));
          skipped.push(`${role.title} (${role.jobId}) is no longer active or is protected`);
        }
        if (!pending.size) break;
        if (page.hasNextPage) {
          try {
            const next = await readApplePage("APPLE_CAREERS_ADVANCE_SUBMITTED_HISTORY_PAGE");
            if (!next.advanced) break;
            page = next.page;
          } catch (navigationError) {
            const recovered = await readSettledPage();
            if (recovered.pageIndex === page.pageIndex || navigationRecoveries >= 2) throw navigationError;
            page = recovered;
            visitedPages.clear();
            navigationRecoveries += 1;
          }
        } else if (!visitedPages.has(1)) {
          page = await readApplePage("APPLE_CAREERS_SET_SUBMITTED_HISTORY_PAGE", { pageIndex: 1 });
        } else {
          break;
        }
      }
      if (pending.size) {
        throw new Error(`Selected job IDs were not found in Apple's active submissions: ${Array.from(pending.keys()).join(", ")}.`);
      }
      setConfirmationOpen(false);
      setSelectedIds([]);
      setError(skipped.length ? `Skipped ${skipped.length} role(s): ${skipped.join("; ")}.` : "");
      setStatusMessage(`${confirmedCount} application${confirmedCount === 1 ? "" : "s"} withdrawn. ${skipped.length ? `${skipped.length} skipped.` : "The saved ranking was updated."}`);
    } catch (withdrawError) {
      setConfirmationOpen(false);
      setError(`Batch stopped after ${confirmedCount} of ${targets.length} were confirmed inactive. ${withdrawError?.message || "The next role could not be verified."}`);
      setStatusMessage(`Batch stopped after ${confirmedCount} of ${targets.length}. Saved roles remain available; Apple will be checked again before any retry.`);
    } finally {
      if (lockAcquired) await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_WITHDRAWAL_BATCH_STATE", active: false, batchId }).catch(() => {});
      setWithdrawProgress(null);
      setConfirmationSelection([]);
      withdrawalInFlightRef.current = false;
      setBusy(false);
    }
  }

  return (
    <FunctionSection embedded={embedded} title="Review Your Submissions" meta={analysisRunning ? "Scanning" : `${roles.length} Saved`}
      running={analysisRunning}
      help="Open Apple Your Roles → Submissions → Active. Scan all pages once, then use saved results without repeating matching. Select roles across pages; Apple checks every role before withdrawal. No roles are selected automatically.">
      <SubmissionSyncIndicator status={syncStatus} now={syncNow} onRetry={syncSubmissions} disabled={busy || syncStatus?.state === "syncing"} />
      {roles.some(role => Number.isFinite(role.score)) && (savedSnapshot?.scorePolicyVersion !== 2 || !savedSnapshot?.matchSignature || savedSnapshot.matchSignature !== fingerprintText(resolveResumeProfileText(profile) + "|" + profile.userYearsOfExperience)) && <p className="muted" role="status">Saved Scores Need Updating For The Current Resume Or Matching Rules. Analyze & Rank All To Update Them.</p>}
      <div className="compact-actions">
        <button type="button" className="primary" onClick={analyzeAllRoles} disabled={busy || syncStatus?.state === "syncing"}>Analyze & Rank All</button>
        <button type="button" className="secondary" onClick={syncSubmissions} disabled={busy || syncStatus?.state === "syncing"}>Sync Submissions</button>
      </div>
      {analysisRunning && <div className="compact-progress" role="status">
        <span><strong>{stopRequested ? "Stopping…" : "Scanning Submissions"}</strong>
          <span className="compact-role-meta">{roles.length} Saved · Matching</span>
        </span>
        <button type="button" className="danger" onClick={stopAnalysis} disabled={stopRequested}>Stop</button>
      </div>}
      {collection.partial && <p className="muted submission-data-status" role="status">Partial Update · Older Saved Roles May Be Included. Sync Submissions To Verify The Full Inventory.</p>}
      {collection.warning && collection.warning !== error && <p className="muted submission-data-status">{collection.warning}</p>}
      <div className="submission-filters" role="group" aria-label="Submission Status Filter">
        {[["all", "All"], ["scored", "Scored"], ["unscored", "Unscored"], ["protected", "Protected"]].map(([value, label]) =>
          <button type="button" key={value} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}</button>)}
      </div>
      {postingCacheStats && <details className="compact-fold"><summary>Scan Details<HelpTooltip label="Scan Details" text="Descriptions and scores are cached locally. These counts show which results were reused and which needed new reads or matching." /></summary>
        <div className="compact-fold-body"><span>{postingCacheStats.reused} Descriptions Reused · {postingCacheStats.fetched} Fetched</span>
          <span>{postingCacheStats.scoresReused} Scores Reused · {postingCacheStats.scoresFetched} Matched</span>
          {!!postingCacheStats.unavailable && <span>{postingCacheStats.unavailable} Postings Unavailable</span>}
          {postingCacheStats.saveFailed && <p role="alert">Some cached results could not be saved.</p>}
        </div>
      </details>}
      {error && <p className="submitted-history-error" role="alert">{error}</p>}
      {roles.length > 0 ? <>
        <input className="compact-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Find Job ID Or Title" aria-label="Find Submitted Roles By Job ID Or Title" disabled={busy} />
        <div className="compact-list-heading"><strong>Submitted Roles</strong><span>Lowest Fit First</span></div>
        {!visibleRoles.length && <p className="muted">No submitted roles match that title or job ID.</p>}
        <ol className="submitted-role-list compact-role-list">{visibleRoles.map(role => renderRoleCard(role, role.protectedFromBatchWithdrawal))}</ol>
        <div className="compact-selection-bar"><span>{selectedIds.length} Selected{hiddenSelectedCount ? ` · ${hiddenSelectedCount} Hidden By Filters` : ""}</span>
          <button type="button" className="danger-button" disabled={busy || !selectedRoles.length} onClick={reviewWithdrawals}>Review Withdrawal</button>
          <HelpTooltip label="Review Withdrawal" text="Review every selected job title and ID before confirming. Apple withdrawals cannot be undone, and you cannot reapply to those roles." />
        </div>
      </> : !analysisRunning && <p className="muted">{savedArchive.latestScan?.complete && !collection.partial ? "No Active Submissions." : "No Saved Submissions Yet."}</p>}
      <dialog ref={confirmationRef} className="submitted-history-confirm ios-sheet" aria-labelledby="withdraw-confirm-title"
        onCancel={(event) => { if (withdrawalInFlightRef.current) event.preventDefault(); else closeWithdrawalConfirmation(); }} onClose={closeWithdrawalConfirmation}>
        <h3 id="withdraw-confirm-title">Confirm Application Withdrawals</h3>
        <p>This will withdraw {confirmationSelection.length} Apple applications. Withdrawals cannot be undone, and you cannot reapply to these roles.</p>
        <ul>{confirmationSelection.map((role) => <li key={role.jobId}>{role.title} · {role.jobId}</li>)}</ul>
        {withdrawProgress && <p role="status">Withdrawing {withdrawProgress.index} Of {withdrawProgress.total}: {withdrawProgress.title}</p>}
        <div className="compact-actions">
          <button type="button" className="secondary" onClick={closeWithdrawalConfirmation} disabled={busy}>Cancel</button>
          <button type="button" className="danger-button" onClick={withdrawSelected} disabled={busy || !confirmationSelection.length}>
            {busy ? "Withdrawing…" : `Confirm Withdrawal (${confirmationSelection.length})`}
          </button>
        </div>
      </dialog>
    </FunctionSection>
  );
}
