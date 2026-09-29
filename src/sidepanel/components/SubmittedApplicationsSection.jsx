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
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const [savedCompleteSnapshot, setSavedCompleteSnapshot] = useState(null);
  const [selectedPageIndex, setSelectedPageIndex] = useState(null);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const activeAnalysisIdRef = useRef(null);
  const allScanReviewsRef = useRef(new Map());

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

  function showAllReviews(reviews) {
    const byId = new Map();
    for (const review of reviews) {
      for (const role of review.roles || []) {
        if (role.active !== false) byId.set(String(role.jobId), { ...role, sourcePageIndex: review.pageIndex });
      }
    }
    setRoles(rankSubmittedRoles(Array.from(byId.values())));
    setSelectedIds([]);
    setSelectedPageIndex(null);
    setReviewContext(null);
    setSavedPages((current) => Object.assign({}, current,
      ...reviews.map((review) => ({ [review.pageIndex]: review }))));
    setPostingCacheStats({
      fetched: reviews.reduce((sum, review) => sum + (review.descriptionsFetched || 0), 0),
      reused: reviews.reduce((sum, review) => sum + (review.descriptionsReused || 0), 0),
      unavailable: reviews.reduce((sum, review) => sum + (review.descriptionsUnavailable || 0), 0),
      saveFailed: reviews.some((review) => review.cacheSaveFailed),
      scoresReused: reviews.reduce((sum, review) => sum + (review.scoresReused || 0), 0),
      scoresFetched: reviews.reduce((sum, review) => sum + (review.scoresFetched || 0), 0)
    });
  }

  function showSnapshot(snapshot) {
    if (!snapshot?.roles?.length) return;
    setRoles(rankSubmittedRoles(snapshot.roles));
    setSelectedIds([]);
    setSelectedPageIndex(null);
    setReviewContext(null);
    setPostingCacheStats(null);
    setError([snapshot.complete ? "" : "This saved ranking is partial; the last scan did not reach every submissions page.", snapshot.warning].filter(Boolean).join(" "));
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
      setSavedSnapshot(archive.latestScan || null);
      setSavedCompleteSnapshot(archive.lastCompleteScan || (archive.latestScan?.complete ? archive.latestScan : null));
      if (archive.latestScan?.roles?.length) {
        showSnapshot(archive.latestScan);
      } else {
        const previousPages = Object.values(archive.pages || {});
        if (previousPages.length > 1) {
          showAllReviews(previousPages.sort((left, right) => (left.updatedAt || 0) - (right.updatedAt || 0)));
          setError("These saved pages predate the combined snapshot. Apple will verify every selected role before withdrawal.");
        } else if (previousPages[0]) {
          showReview(previousPages[0]);
        }
      }
    }
    loadSavedResults().catch(() => {});
    function handleProgress(message) {
      if (message?.type !== "APPLE_CAREERS_SUBMITTED_ROLES_PROGRESS" ||
        message.analysisId !== activeAnalysisIdRef.current) return;
      if (message.scope === "all") {
        allScanReviewsRef.current.set(message.data.review.pageIndex, message.data.review);
        showAllReviews(Array.from(allScanReviewsRef.current.values()));
        setStatusMessage(`Scanned ${message.data.pagesRead} of ${message.data.pageCount} Apple submissions pages.`);
      } else {
        showReview(message.data, message.tabId);
      }
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

  function showAllSavedPages() {
    if (savedSnapshot?.roles?.length) {
      showSnapshot(savedSnapshot);
      return;
    }
    showAllReviews(Object.values(savedPages).sort((left, right) => (left.updatedAt || 0) - (right.updatedAt || 0)));
    setError("Saved pages may include roles that have since moved or been withdrawn. Open a page and refresh it before selecting withdrawals.");
  }

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
      setReviewContext(null);
      const analysisId = crypto.randomUUID();
      activeAnalysisIdRef.current = analysisId;
      setAnalysisRunning(true);
      setStopRequested(false);
      setStatusMessage("Scanning Apple submissions one page at a time...");
      const response = await chrome.runtime.sendMessage({
        type: "APPLE_CAREERS_ANALYZE_ALL_SUBMITTED_ROLES",
        tabId: tab.id,
        userProfile: profile,
        analysisId
      });
      if (!response?.ok) throw new Error(response?.error || "Could not scan all Apple submissions.");
      showAllReviews(response.data.reviews || []);
      const stored = await chrome.storage.local.get(SAVED_REVIEWS_KEY);
      setSavedSnapshot(stored[SAVED_REVIEWS_KEY]?.latestScan || null);
      setSavedCompleteSnapshot(stored[SAVED_REVIEWS_KEY]?.lastCompleteScan || null);
      setSavedPages(stored[SAVED_REVIEWS_KEY]?.pages || {});
      setError(response.data.warning || "");
      setStatusMessage(`${response.data.stopped ? "Stopped after" : "Scanned"} ${response.data.pagesRead} of ${response.data.pageCount} pages. Select roles from the saved ranking to queue withdrawals.`);
    } catch (scanError) {
      const stored = await chrome.storage.local.get(SAVED_REVIEWS_KEY).catch(() => ({}));
      setSavedSnapshot(stored[SAVED_REVIEWS_KEY]?.latestScan || null);
      setSavedCompleteSnapshot(stored[SAVED_REVIEWS_KEY]?.lastCompleteScan || null);
      setError(scanError?.message || "The all-submissions scan stopped.");
      setStatusMessage("All-submissions scan stopped. Saved pages remain available.");
    } finally {
      activeAnalysisIdRef.current = null;
      setAnalysisRunning(false);
      setStopRequested(false);
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
            disabled={busy || confirmationOpen || protectedFromBatch}
          />
          <span>{role.score === null || role.score === undefined ? "Not scored · review manually" : `${role.score}% fit`}</span>
        </label>
        <a href={role.url} target="_blank" rel="noopener noreferrer" className="submitted-role-title">{role.title}</a>
        <span className="submitted-role-id">Job ID {role.jobId}</span>
        {role.sourcePageIndex && <span className="submitted-role-id">Saved page {role.sourcePageIndex}</span>}
        <span className="submitted-role-protected-label">
          {role.scoreSource === "previous_review" ? "Saved score from an earlier review" : role.descriptionAvailable ? "Scored against job description" : "Matching unavailable · review the posting yourself"}
        </span>
        {favoriteStatusLabel && <span className="submitted-role-protected-label">{favoriteStatusLabel}</span>}
        <p>{role.reason || "No explanation was returned."}</p>
        {role.submittedDate && <span className="muted">Submitted {role.submittedDate}</span>}
      </li>
    );
  }

  async function removeSavedRole(jobId, livePage = null) {
    const stored = await chrome.storage.local.get(SAVED_REVIEWS_KEY);
    const archive = stored[SAVED_REVIEWS_KEY];
    if (!archive) return;
    const pages = Object.fromEntries(Object.entries(archive.pages || {}).map(([pageIndex, review]) => [
      pageIndex,
      { ...review, roles: (review.roles || []).filter((role) => String(role.jobId) !== String(jobId)) }
    ]));
    const snapshot = archive.latestScan
      ? { ...archive.latestScan, roles: (archive.latestScan.roles || []).filter((role) => String(role.jobId) !== String(jobId)), updatedAt: Date.now() }
      : null;
    const completeSnapshot = archive.lastCompleteScan
      ? { ...archive.lastCompleteScan,
          roles: (archive.lastCompleteScan.roles || []).filter((role) => String(role.jobId) !== String(jobId)),
          updatedAt: Date.now() }
      : null;
    if (livePage?.roles?.length) {
      const savedById = new Map((snapshot?.roles || []).map((role) => [String(role.jobId), role]));
      const currentRoles = livePage.roles.filter((role) =>
        role.active !== false && String(role.jobId) !== String(jobId)
      ).map((role) => {
        const saved = savedById.get(String(role.jobId));
        const merged = saved?.title === role.title
          ? { ...role, score: saved.score, reason: saved.reason, matchBasis: saved.matchBasis,
              descriptionAvailable: saved.descriptionAvailable, scoreSource: saved.scoreSource }
          : role;
        savedById.set(String(role.jobId), { ...saved, ...merged, sourcePageIndex: livePage.pageIndex });
        return merged;
      });
      pages[livePage.pageIndex] = {
        ...(pages[livePage.pageIndex] || {}), pageIndex: livePage.pageIndex,
        pageCount: livePage.pageCount, roles: currentRoles, updatedAt: Date.now()
      };
      if (snapshot) snapshot.roles = Array.from(savedById.values());
    }
    await chrome.storage.local.set({ [SAVED_REVIEWS_KEY]: { ...archive, pages,
      ...(snapshot ? { latestScan: snapshot } : {}),
      ...(completeSnapshot ? { lastCompleteScan: completeSnapshot } : {}) } });
    setSavedPages(pages);
    if (snapshot) setSavedSnapshot(snapshot);
    if (completeSnapshot) setSavedCompleteSnapshot(completeSnapshot);
    return snapshot;
  }

  async function withdrawSelected() {
    if (!selectedRoles.length) return;
    const targets = selectedRoles.map(({ jobId, title }) => ({ jobId, title }));
    const pending = new Map(targets.map((role) => [String(role.jobId), role]));
    const skipped = [];
    let confirmedCount = 0;
    setBusy(true);
    setError("");
    setStatusMessage(`Preparing to withdraw ${targets.length} selected Apple applications...`);
    try {
      const tab = await getActiveTab();
      if (!tab?.id || (reviewContext?.tabId && tab.id !== reviewContext.tabId)) {
        throw new Error("Return to the Apple tab containing your submissions.");
      }
      if (!/^https:\/\/jobs\.apple\.com\/app\/[^/]+\/profile\/roles\/?(?:[?#]|$)/i.test(tab.url || "")) {
        throw new Error("Open Apple Careers → Your Roles → Submissions → Active before withdrawing.");
      }
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
      const verifyAcrossPages = async (role) => {
        const currentPage = await readApplePage("APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE");
        if (currentPage.withdrawalConfirmationOpen) return { confirmationOpen: true, active: null };
        const result = await readApplePage("APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES");
        if (!Array.isArray(result.pages) || result.pages.length !== result.pageCount) {
          throw new Error("Apple did not return every active submissions page.");
        }
        return { confirmationOpen: false, active: result.pages.some((page) => page.roles.some((current) =>
          String(current.jobId) === String(role.jobId) && current.active
        )) };
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
          await withdrawSubmittedRolesSequentially([role], {
            withdrawOne: () => chrome.tabs.sendMessage(tab.id, {
              type: "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES",
              roles: [role],
              expectedPageIndex: page.pageIndex
            }),
            verifyRoleStatus: verifyAcrossPages,
            onRoleStart: () => {
              setWithdrawProgress({ index: confirmedCount + 1, total: targets.length, title: role.title });
              setStatusMessage(`Withdrawing ${confirmedCount + 1} of ${targets.length}: ${role.title}...`);
            },
            onRoleConfirmed: async ({ verifiedAfterInterruption }) => {
              confirmedCount += 1;
              setStatusMessage(`Updating the visible submissions page after ${role.title}...`);
              try {
                page = await readSettledPage();
              } catch (refreshError) {
                await removeSavedRole(role.jobId);
                setRoles((current) => rankSubmittedRoles(current.filter((item) => String(item.jobId) !== String(role.jobId))));
                setSelectedIds((current) => current.filter((jobId) => String(jobId) !== String(role.jobId)));
                throw new Error(`${role.title}: Apple confirmed the withdrawal, but its current page could not be read. ${refreshError?.message || "Sign in again to continue."}`);
              }
              const snapshot = await removeSavedRole(role.jobId, page);
              setRoles((current) => rankSubmittedRoles(snapshot?.roles || current.filter((item) => String(item.jobId) !== String(role.jobId))));
              setSelectedIds((current) => current.filter((jobId) => String(jobId) !== String(role.jobId)));
              setReviewContext(null);
              setSelectedPageIndex(null);
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
            <HelpTooltip text="Scan the current page or all active submissions. The full ranking is saved in Chrome storage and loads without another scan. Select unstarred roles across pages; each withdrawal is checked against Apple's live submissions before clicking." />
          </div>
        </div>
        {analysisRunning ? (
          <button type="button" onClick={stopAnalysis} disabled={stopRequested}>{stopRequested ? "Stopping…" : "Stop analysis"}</button>
        ) : (
          <button type="button" onClick={analyzeRoles} disabled={busy}>
            {busy ? "Working…" : "Analyze this page"}
          </button>
        )}
      </div>

      <p className="muted">
        Open Your Roles → Submissions → Active. Scan all pages for a saved ranking, then select roles across pages. Apple will be checked before each withdrawal. No roles are selected automatically.
      </p>
      <button type="button" onClick={analyzeAllRoles} disabled={busy}>Scan all submissions</button>
      <button type="button" className="secondary-button" onClick={loadCurrentPage} disabled={busy}>
        Show current page from saved results
      </button>
      {savedPageIndices.length > 1 && (
        <button type="button" className="secondary-button" onClick={showAllSavedPages} disabled={busy}>
          Show all saved rankings
        </button>
      )}
      {!savedSnapshot?.complete && savedCompleteSnapshot?.roles?.length > 0 && (
        <button type="button" className="secondary-button" onClick={() => {
          showSnapshot(savedCompleteSnapshot);
          setError("This is the last complete saved scan. Apple will verify each selected role before withdrawal.");
        }} disabled={busy}>
          Show last complete scan
        </button>
      )}

      {savedPageIndices.length > 1 && (
        <label className="submitted-history-search">
          <span>Saved submissions page</span>
          <select value={selectedPageIndex || ""} onChange={(event) => event.target.value ? showReview(savedPages[event.target.value]) : showAllSavedPages()} disabled={busy}>
            <option value="">All saved pages</option>
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
            <span>{roles.length} saved submissions {reviewContext ? `from page ${reviewContext.pageIndex} of ${reviewContext.pageCount}` : "across scanned pages"}</span>
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
          <>
              <p className="muted">{selectedIds.length} role{selectedIds.length === 1 ? "" : "s"} selected. Review every title and job ID before confirming.</p>

              {confirmationOpen ? (
                <div className="submitted-history-confirm" role="alertdialog" aria-modal="true" aria-labelledby="withdraw-confirm-title">
                  <h3 id="withdraw-confirm-title">Confirm application withdrawals</h3>
                  <p>
                    This will withdraw {selectedRoles.length} Apple applications from your account. That changes your candidacy for those roles. Confirm only if you want to withdraw every role listed here.
                  </p>
                  <p>
                    The extension will walk your active submissions pages and withdraw selected roles as it finds them. It will stop if a withdrawal cannot be verified.
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

          {visibleRoles.length === 0 ? (
            <p className="muted">No submitted roles match that title or job ID.</p>
          ) : (
            <>
              {lowMatchRoles.length > 0 && (
                <>
                  <h3 className="submitted-role-group-heading">Lower-match roles · unstarred</h3>
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
