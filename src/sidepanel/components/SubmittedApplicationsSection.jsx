import { useEffect, useMemo, useRef, useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { getActiveTab, sendMessageWithFallback } from "../lib/format";
import { withdrawSubmittedRolesSequentially } from "../lib/submittedWithdrawals.mjs";

const SAVED_REVIEWS_KEY = "appleSubmittedRoleReviews";
const SAVED_SCORES_KEY = "appleSubmittedRoleScoresCache";

function rankSubmittedRoles(roles) {
  const activeRoles = roles.filter((role) => role.active !== false);
  const lowMatches = activeRoles
    .filter((role) => role.protectedFromBatchWithdrawal === false)
    .sort((left, right) => (left.score ?? 101) - (right.score ?? 101));
  const protectedRoles = activeRoles
    .filter((role) => role.protectedFromBatchWithdrawal !== false)
    .sort((left, right) => String(left.title || "").localeCompare(String(right.title || "")));
  return [...lowMatches, ...protectedRoles];
}

export function SubmittedApplicationsSection({ profile, setStatusMessage }) {
  const [roles, setRoles] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [withdrawProgress, setWithdrawProgress] = useState(null);
  const [error, setError] = useState("");
  const [reviewContext, setReviewContext] = useState(null);
  const [postingCacheStats, setPostingCacheStats] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [savedPages, setSavedPages] = useState({});
  const [selectedPageIndex, setSelectedPageIndex] = useState(null);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const activeAnalysisIdRef = useRef(null);

  const selectedRoles = useMemo(
    () => roles.filter((role) => selectedIds.includes(role.jobId)),
    [roles, selectedIds]
  );
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleRoles = roles.filter((role) =>
    !normalizedSearch ||
    String(role.title || "").toLowerCase().includes(normalizedSearch) ||
    String(role.jobId || "").toLowerCase().includes(normalizedSearch)
  );
  const lowMatchRoles = visibleRoles.filter((role) => role.protectedFromBatchWithdrawal === false && Number.isFinite(role.score));
  const unscoredRoles = visibleRoles.filter((role) => role.protectedFromBatchWithdrawal === false && !Number.isFinite(role.score));
  const protectedRoles = visibleRoles.filter((role) => role.protectedFromBatchWithdrawal !== false);
  const savedPageIndices = Object.keys(savedPages).map(Number).sort((left, right) => left - right);

  function showReview(review, tabId = null) {
    if (!review) return;
    setRoles(rankSubmittedRoles(review.roles || []));
    setSelectedIds([]);
    setSelectedPageIndex(review.pageIndex);
    setReviewContext({ tabId, pageIndex: review.pageIndex, pageCount: review.pageCount });
    setError(review.warning || "");
    setPostingCacheStats({
      fetched: review.descriptionsFetched || 0,
      reused: review.descriptionsReused || 0,
      unavailable: review.descriptionsUnavailable || 0,
      saveFailed: Boolean(review.cacheSaveFailed),
      scoresReused: review.scoresReused || 0,
      scoresFetched: review.scoresFetched || 0
    });
    setSavedPages((current) => ({ ...current, [review.pageIndex]: review }));
  }

  async function showCurrentPageFromStorage(cancelled = () => false) {
    const tab = await getActiveTab();
    if (!tab?.id || !/^https:\/\/jobs\.apple\.com\/app\/[^/]+\/profile\/roles\/?(?:[?#]|$)/i.test(tab.url || "")) {
      throw new Error("Open Apple Careers → Your Roles → Submissions → Active to load this page.");
    }
    const response = await sendMessageWithFallback(tab.id, { type: "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE" });
    if (!response?.ok) throw new Error(response?.error || "Apple's current submissions page could not be read.");
    if (cancelled() || activeAnalysisIdRef.current) return;
    const stored = await chrome.storage.local.get([SAVED_REVIEWS_KEY, SAVED_SCORES_KEY]);
    const archive = stored[SAVED_REVIEWS_KEY] || { version: 1, pages: {} };
    const page = response.data;
    const oldById = new Map((archive.pages?.[page.pageIndex]?.roles || []).map((role) => [String(role.jobId), role]));
    const scoreCache = stored[SAVED_SCORES_KEY] || {};
    const roles = page.roles.filter((role) => role.active !== false).map((role) => {
      const prior = oldById.get(String(role.jobId));
      const cached = scoreCache[String(role.jobId).split("-")[0]]?.result;
      const score = prior?.title === role.title && Number.isFinite(prior.score) ? prior : cached;
      return score && Number.isFinite(score.score)
        ? { ...role, score: score.score, reason: score.reason, matchBasis: score.matchBasis,
            descriptionAvailable: score.descriptionAvailable, scoreSource: "previous_review" }
        : role;
    });
    const review = {
      ...(archive.pages?.[page.pageIndex] || {}),
      pageIndex: page.pageIndex,
      pageCount: page.pageCount,
      roles,
      updatedAt: Date.now()
    };
    const pages = { ...(archive.pages || {}), [page.pageIndex]: review };
    try {
      await chrome.storage.local.set({ [SAVED_REVIEWS_KEY]: { version: 1, pages, lastPageIndex: page.pageIndex } });
    } catch (_error) {
      review.cacheSaveFailed = true;
    }
    if (!cancelled() && !activeAnalysisIdRef.current) showReview(review, tab.id);
    return review;
  }

  useEffect(() => {
    let cancelled = false;
    async function loadSavedResults() {
      const stored = await chrome.storage.local.get(SAVED_REVIEWS_KEY);
      if (cancelled || activeAnalysisIdRef.current) return;
      const archive = stored[SAVED_REVIEWS_KEY] || { version: 1, pages: {} };
      setSavedPages(archive.pages || {});
      const saved = archive.pages?.[archive.lastPageIndex] || Object.values(archive.pages || {})[0];
      if (saved) showReview(saved);

      await showCurrentPageFromStorage(() => cancelled).catch(() => {});
    }
    loadSavedResults().catch(() => {});
    function handleProgress(message) {
      if (message?.type !== "APPLE_CAREERS_SUBMITTED_ROLES_PROGRESS" ||
        message.analysisId !== activeAnalysisIdRef.current) return;
      showReview(message.data, message.tabId);
    }
    chrome.runtime.onMessage.addListener(handleProgress);
    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(handleProgress);
    };
  }, []);

  async function loadCurrentPage() {
    setBusy(true);
    setError("");
    try {
      const review = await showCurrentPageFromStorage();
      if (review) setStatusMessage(`Loaded ${review.roles.length} roles on Apple page ${review.pageIndex} from saved results. No OpenAI matching was run.`);
    } catch (loadError) {
      setError(loadError?.message || "Could not load this Apple submissions page.");
    } finally {
      setBusy(false);
    }
  }

  async function analyzeRoles() {
    setBusy(true);
    setError("");
    setConfirmationOpen(false);
    setStatusMessage("Reading Apple’s active submitted roles...");

    try {
      const tab = await getActiveTab();
      if (!tab?.id || !/^https:\/\/jobs\.apple\.com\/app\/[^/]+\/profile\/roles\/?(?:[?#]|$)/i.test(tab.url || "")) {
        throw new Error("Open Apple Careers → Profile → Your Roles, then choose Submissions and Active.");
      }

      setSelectedIds([]);
      const analysisId = crypto.randomUUID();
      activeAnalysisIdRef.current = analysisId;
      setAnalysisRunning(true);
      setStopRequested(false);
      setStatusMessage("Matching submissions on the visible Apple page with your saved profile...");
      const response = await chrome.runtime.sendMessage({
        type: "APPLE_CAREERS_ANALYZE_SUBMITTED_ROLES",
        tabId: tab.id,
        userProfile: profile,
        analysisId
      });
      if (!response?.ok) throw new Error(response?.error || "Could not score the submitted roles.");
      showReview(response.data, tab.id);
      setStatusMessage(`${response.data.roles.length} submissions saved from page ${response.data.pageIndex}. ${response.data.warning || "Select roles you want to review for withdrawal."}`);
    } catch (analyzeError) {
      setError(analyzeError?.message || "Could not analyze Apple submitted roles.");
      setStatusMessage("Analysis stopped. Saved results remain available for review.");
    } finally {
      activeAnalysisIdRef.current = null;
      setAnalysisRunning(false);
      setStopRequested(false);
      setBusy(false);
    }
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

  function renderRoleCard(role, protectedFromBatch = false) {
    const favoriteStatusLabel =
      String(role.jobId).split("-")[0] === "200654506"
        ? "Interview in progress · protected from batch withdrawal"
        : role.favorite === true
          ? "Starred · protected from batch withdrawal"
          : role.favorite === false
            ? null
            : "Star status unavailable · protected from batch withdrawal";

    return (
      <li key={role.jobId} className={`submitted-role-card${protectedFromBatch ? " submitted-role-card-protected" : ""}`}>
        <label className="submitted-role-select">
          <input
            type="checkbox"
            checked={selectedIds.includes(role.jobId)}
            onChange={() => toggleRole(role.jobId)}
            disabled={busy || !reviewContext || confirmationOpen || protectedFromBatch}
          />
          <span>{role.score === null || role.score === undefined ? "Not scored · review manually" : `${role.score}% fit`}</span>
        </label>
        <a href={role.url} target="_blank" rel="noopener noreferrer" className="submitted-role-title">{role.title}</a>
        <span className="submitted-role-id">Job ID {role.jobId}</span>
        <span className="submitted-role-protected-label">
          {role.scoreSource === "previous_review" ? "Saved score from an earlier review" : role.descriptionAvailable ? "Scored against job description" : "Matching unavailable · review the posting yourself"}
        </span>
        {favoriteStatusLabel && <span className="submitted-role-protected-label">{favoriteStatusLabel}</span>}
        <p>{role.reason || "No explanation was returned."}</p>
        {role.submittedDate && <span className="muted">Submitted {role.submittedDate}</span>}
      </li>
    );
  }

  async function removeSavedRole(jobId) {
    const stored = await chrome.storage.local.get(SAVED_REVIEWS_KEY);
    const archive = stored[SAVED_REVIEWS_KEY];
    if (!archive?.pages) return;
    const pages = Object.fromEntries(Object.entries(archive.pages).map(([pageIndex, review]) => [
      pageIndex,
      { ...review, roles: (review.roles || []).filter((role) => String(role.jobId) !== String(jobId)) }
    ]));
    await chrome.storage.local.set({ [SAVED_REVIEWS_KEY]: { ...archive, pages } });
    setSavedPages(pages);
  }

  async function withdrawSelected() {
    if (!selectedRoles.length || !reviewContext) return;
    const targets = selectedRoles.map(({ jobId, title }) => ({ jobId, title }));
    let confirmedCount = 0;
    setBusy(true);
    setError("");
    setStatusMessage(`Preparing to withdraw ${targets.length} selected Apple applications...`);
    try {
      const tab = await getActiveTab();
      if (!tab?.id || (reviewContext.tabId && tab.id !== reviewContext.tabId)) {
        throw new Error("Return to the Apple tab containing this saved submissions page.");
      }
      const page = await sendMessageWithFallback(tab.id, {
        type: "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE"
      });
      if (!page?.ok) throw new Error(page?.error || "Apple's active submissions page could not be read.");
      if (page.data?.pageIndex !== reviewContext.pageIndex) {
        throw new Error("The visible Apple submissions page changed. Open the saved page and load it from saved results before withdrawing.");
      }
      if (page.data?.withdrawalConfirmationOpen) {
        throw new Error("An Apple withdrawal confirmation is already open. Resolve it before starting another batch.");
      }
      if (targets.some((role) => !page.data.roles.some((current) =>
        String(current.jobId) === String(role.jobId) && current.active && current.protectedFromBatchWithdrawal === false
      ))) {
        throw new Error("A selected role is no longer an unstarred active submission on this page. Load the current page from saved results again.");
      }

      const withdrawalPageState = new Map();
      await withdrawSubmittedRolesSequentially(targets, {
        withdrawOne: async (role) => {
          // Apple pulls a role from the next page after each withdrawal. Read the
          // settled page again before every click instead of reusing its first snapshot.
          const currentPage = await sendMessageWithFallback(tab.id, {
            type: "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE"
          });
          if (!currentPage?.ok) throw new Error(currentPage?.error || "Apple's submissions page could not be read after the previous withdrawal.");
          if (currentPage.data?.pageIndex !== reviewContext.pageIndex) {
            throw new Error("Apple changed the visible submissions page during the batch.");
          }
          if (currentPage.data?.withdrawalConfirmationOpen) {
            throw new Error("Apple's previous withdrawal confirmation is still open.");
          }
          const currentRole = currentPage.data.roles.find((item) => String(item.jobId) === String(role.jobId));
          if (!currentRole?.active || currentRole.protectedFromBatchWithdrawal !== false) {
            throw new Error("The next selected role is missing, starred, or no longer active on this page.");
          }
          withdrawalPageState.set(String(role.jobId), {
            beforeCount: currentPage.data.roles.filter((item) => item.active).length,
            hadNextPage: currentPage.data.hasNextPage
          });
          return chrome.tabs.sendMessage(tab.id, {
            type: "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES",
            roles: [role],
            expectedPageIndex: reviewContext.pageIndex
          });
        },
        verifyRoleStatus: async (role) => {
          const pageState = withdrawalPageState.get(String(role.jobId));
          if (!pageState) throw new Error("The role was not clicked, so its withdrawal cannot be verified.");
          const response = await sendMessageWithFallback(tab.id, {
            type: "APPLE_CAREERS_CHECK_SUBMITTED_ROLE_STATUS",
            jobId: role.jobId,
            title: role.title,
            expectedPageIndex: reviewContext.pageIndex,
            ...pageState
          });
          if (!response?.ok) throw new Error(response?.error || "Apple's current role status could not be read.");
          return response.data;
        },
        onRoleStart: (role, index, total) => {
          setWithdrawProgress({ index: index + 1, total, title: role.title });
          setStatusMessage(`Withdrawing ${index + 1} of ${total}: ${role.title}...`);
        },
        onRoleConfirmed: async ({ role, verifiedAfterInterruption }, index, total) => {
          confirmedCount += 1;
          setRoles((current) => rankSubmittedRoles(current.filter((item) => String(item.jobId) !== String(role.jobId))));
          setSelectedIds((current) => current.filter((jobId) => String(jobId) !== String(role.jobId)));
          await removeSavedRole(role.jobId);
          setStatusMessage(`${confirmedCount} of ${total} no longer active${verifiedAfterInterruption ? " · verified after Apple refreshed the page" : ""}.`);
        }
      });
      setConfirmationOpen(false);
      setSelectedIds([]);
      setStatusMessage(`${confirmedCount} selected applications are no longer active. Saved results were updated; refresh this page when you want current scores.`);
    } catch (withdrawError) {
      setConfirmationOpen(false);
      setError(`Batch stopped after ${confirmedCount} of ${targets.length} were confirmed inactive. ${withdrawError?.message || "The next role could not be verified."}`);
      setStatusMessage(`Batch stopped after ${confirmedCount} of ${targets.length}. Saved roles remain available; Apple will be checked again before any retry.`);
    } finally {
      setWithdrawProgress(null);
      setBusy(false);
    }
  }

  return (
    <section className="submitted-history">
      <div className="submitted-history-heading">
        <div>
          <p className="eyebrow">APPLE CAREERS</p>
          <div className="submitted-history-title-row">
            <h2>Submitted Application Review</h2>
            <HelpTooltip text="Reviews only the active submissions visible on your current Apple Your Roles page. Scores use your saved resume and each available posting. Posting details and matching results are reused when possible. Select any unstarred roles yourself before batch withdrawal." />
          </div>
        </div>
        {analysisRunning ? (
          <button type="button" onClick={stopAnalysis} disabled={stopRequested}>{stopRequested ? "Stopping…" : "Stop analysis"}</button>
        ) : (
          <button type="button" onClick={analyzeRoles} disabled={busy}>
            {busy ? "Working…" : roles.length ? "Refresh this page" : "Analyze this page"}
          </button>
        )}
      </div>

      <p className="muted">
        Open Your Roles → Submissions → Active and choose the page you want to review. Saved pages and partial results remain available if matching stops. No roles are selected automatically.
      </p>
      <button type="button" className="secondary-button" onClick={loadCurrentPage} disabled={busy}>
        Show current page from saved results
      </button>

      {savedPageIndices.length > 1 && (
        <label className="submitted-history-search">
          <span>Saved submissions page</span>
          <select value={selectedPageIndex || ""} onChange={(event) => showReview(savedPages[event.target.value])} disabled={busy}>
            {savedPageIndices.map((pageIndex) => (
              <option key={pageIndex} value={pageIndex}>Page {pageIndex} · {savedPages[pageIndex].roles.length} saved roles</option>
            ))}
          </select>
        </label>
      )}

      {postingCacheStats && (
        <p className="muted" role="status">
          Posting details: {postingCacheStats.reused} reused from Chrome storage · {postingCacheStats.fetched} fetched this review
          {postingCacheStats.unavailable ? ` · ${postingCacheStats.unavailable} unavailable` : ""}
          {postingCacheStats.saveFailed ? " · some cached results could not be saved" : ""}
          {` · scores: ${postingCacheStats.scoresReused} reused, ${postingCacheStats.scoresFetched} newly matched`}
        </p>
      )}

      {error && <p className="submitted-history-error" role="alert">{error}</p>}

      {roles.length > 0 && (
        <>
          <div className="submitted-history-summary">
            <span>{roles.length} saved submissions from page {reviewContext?.pageIndex || "?"} of {reviewContext?.pageCount || "?"}</span>
          </div>
          <p className="muted">
            Starred roles and job 200654506 are excluded from the low-match ranking and protected from batch withdrawal. Search by title or job ID to check any application before reviewing a withdrawal batch.
          </p>
          <label className="submitted-history-search">
            <span>Search submitted roles</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Job title or job ID"
              aria-label="Search submitted roles by job title or job ID"
              disabled={busy}
            />
          </label>
          {reviewContext ? (
            <>
              <p className="muted">{selectedIds.length} role{selectedIds.length === 1 ? "" : "s"} selected from this page. Review the titles and job IDs before confirming.</p>

              {confirmationOpen ? (
                <div className="submitted-history-confirm" role="alertdialog" aria-modal="true" aria-labelledby="withdraw-confirm-title">
                  <h3 id="withdraw-confirm-title">Confirm application withdrawals</h3>
                  <p>
                    This will withdraw {selectedRoles.length} Apple applications from your account. That changes your candidacy for those roles. Confirm only if you want to withdraw every role listed here.
                  </p>
                  <p>
                    Apple will show a confirmation for each role. The extension will click Proceed one at a time and stop if a confirmation or withdrawal cannot be verified.
                  </p>
                  {withdrawProgress && (
                    <p role="status">Withdrawing {withdrawProgress.index} of {withdrawProgress.total}: {withdrawProgress.title}</p>
                  )}
                  <ul>
                    {selectedRoles.map((role) => (
                      <li key={role.jobId}>{role.title} · {role.jobId}</li>
                    ))}
                  </ul>
                  <div className="row">
                    <button type="button" className="secondary-button" onClick={() => setConfirmationOpen(false)} disabled={busy}>Cancel</button>
                    <button type="button" className="danger-button" onClick={withdrawSelected} disabled={busy || !selectedRoles.length}>
                      {busy ? "Withdrawing…" : `Confirm withdraw ${selectedRoles.length}`}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="danger-button"
                  disabled={busy || selectedRoles.length === 0}
                  onClick={() => setConfirmationOpen(true)}
                >
                  Review withdrawal of {selectedRoles.length} selected roles
                </button>
              )}
            </>
          ) : (
            <p className="muted">Choose a saved page or analyze the visible page to review withdrawals.</p>
          )}

          {visibleRoles.length === 0 ? (
            <p className="muted">No submitted roles match that title or job ID.</p>
          ) : (
            <>
              {lowMatchRoles.length > 0 && (
                <>
                  <h3 className="submitted-role-group-heading">Lower-match roles on this page · unstarred</h3>
                  <ol className="submitted-role-list">
                    {lowMatchRoles.map((role) => renderRoleCard(role))}
                  </ol>
                </>
              )}
              {unscoredRoles.length > 0 && (
                <>
                  <h3 className="submitted-role-group-heading">Not scored · review manually</h3>
                  <ol className="submitted-role-list">
                    {unscoredRoles.map((role) => renderRoleCard(role))}
                  </ol>
                </>
              )}
              {protectedRoles.length > 0 && (
                <>
                  <h3 className="submitted-role-group-heading">Starred or protected roles</h3>
                  <p className="muted">These roles are not ranked as low matches and cannot be selected for batch withdrawal. Job 200654506 remains protected even if it is unstarred.</p>
                  <ol className="submitted-role-list">
                    {protectedRoles.map((role) => renderRoleCard(role, true))}
                  </ol>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
