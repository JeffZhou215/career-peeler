import { useEffect, useMemo, useRef, useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { FunctionSection } from "./FunctionSection";
import { CompactRoleCard } from "./CompactRoleCard";
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
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [savedView, setSavedView] = useState("all");
  const [analysisProgress, setAnalysisProgress] = useState(null);
  const confirmationRef = useRef(null);
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
    setSavedView(`page:${review.pageIndex}`);
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
    setSavedView("all");
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
    setSavedView("all");
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
      setAnalysisProgress(message.scope === "all" ? { page: message.data.pagesRead, total: message.data.pageCount } : { page: message.data.pageIndex, total: message.data.pageCount });
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
      return review;
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
      setAnalysisProgress(null);
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
      setAnalysisProgress(null);
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

  useEffect(() => {
    const dialog = confirmationRef.current;
    if (!dialog) return;
    if (confirmationOpen && !dialog.open) dialog.showModal();
    if (!confirmationOpen && dialog.open) dialog.close();
  }, [confirmationOpen]);

  async function changeSavedView(value) {
    if (value === "current") {
      if (await loadCurrentPage()) setSavedView("current");
    } else if (value === "complete") {
      showSnapshot(savedCompleteSnapshot);
      setSavedView("complete");
      setError("This is the last complete saved scan. Apple will verify each selected role before withdrawal.");
    } else if (value.startsWith("page:")) {
      showReview(savedPages[value.slice(5)]);
    } else {
      showAllSavedPages();
      setSavedView("all");
    }
  }

  function renderRoleCard(role, protectedFromBatch = false) {
    const protectedLabel = String(role.jobId).split("-")[0] === "200654506"
      ? "Interview In Progress · Protected"
      : role.favorite === true ? "Starred · Protected" : "Star Status Unknown · Protected";
    return <CompactRoleCard key={role.jobId} role={role}
      status={protectedFromBatch ? protectedLabel : role.submittedDate ? `Submitted ${role.submittedDate}` : "Submitted"}
      selectable={!protectedFromBatch} selected={selectedIds.includes(role.jobId)}
      disabled={busy || confirmationOpen} onSelect={() => toggleRole(role.jobId)}>
      {role.sourcePageIndex && <span className="submitted-role-id">Saved Page {role.sourcePageIndex}</span>}
      <span className="submitted-role-id">{role.scoreSource === "previous_review" ? "Saved Score" : role.descriptionAvailable ? "Scored Against Job Description" : "Review Posting Manually"}</span>
    </CompactRoleCard>;
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
      ? { ...archive.latestScan, scannedAt: archive.latestScan.scannedAt || archive.latestScan.updatedAt,
          roles: (archive.latestScan.roles || []).filter((role) => String(role.jobId) !== String(jobId)), updatedAt: Date.now() }
      : null;
    const completeSnapshot = archive.lastCompleteScan
      ? { ...archive.lastCompleteScan,
          scannedAt: archive.lastCompleteScan.scannedAt || archive.lastCompleteScan.updatedAt,
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
    const ranking = (await chrome.storage.local.get("appleJobRanking")).appleJobRanking;
    if (ranking) {
      const baseId = String(jobId).split("-")[0];
      ranking.withdrawnIds = [...new Set([...(ranking.withdrawnIds || []), baseId])];
      ranking.reservations = (ranking.reservations || []).filter((role) => String(role.jobId).split("-")[0] !== baseId);
      if (ranking.jobs?.[baseId]) {
        ranking.jobs[baseId].queueStatus = "withdrawn";
        ranking.jobs[baseId].eligible = false;
      }
      if (ranking.capacitySnapshot) ranking.capacitySnapshot = { ...ranking.capacitySnapshot,
        roles: ranking.capacitySnapshot.roles.filter((role) => String(role.jobId) !== String(jobId)), updatedAt: Date.now() };
    }
    await chrome.storage.local.set({ ...(ranking ? { appleJobRanking: ranking } : {}), [SAVED_REVIEWS_KEY]: { ...archive, pages,
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
      const ranking = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_GET_JOB_RANKING" });
      if (ranking?.data?.running) throw new Error("Stop the job ranking or application queue before withdrawing applications.");
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
              setSavedView("all");
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
    <FunctionSection title="Submitted Application Review" meta={analysisRunning ? "Scanning" : `${roles.length} Saved`}
      running={analysisRunning}
      headerAction={analysisRunning && <button type="button" className="danger" onClick={stopAnalysis} disabled={stopRequested}>Stop</button>}
      help="Open Apple Your Roles → Submissions → Active. Scan all pages once, then use saved results without repeating matching. Select roles across pages; Apple checks every role before withdrawal. No roles are selected automatically.">
      <div className="compact-actions">
        <button type="button" className="primary" onClick={analyzeAllRoles} disabled={busy}>Scan All Submissions</button>
        <button type="button" className="secondary" onClick={analyzeRoles} disabled={busy}>Analyze This Page</button>
      </div>
      {analysisRunning && <div className="compact-progress" role="status">
        <span><strong>{stopRequested ? "Stopping…" : "Scanning Submissions"}</strong>
          <span className="compact-role-meta">{analysisProgress ? `Page ${analysisProgress.page} Of ${analysisProgress.total} · ` : ""}{roles.length} Saved</span>
        </span>
        <button type="button" className="danger" onClick={stopAnalysis} disabled={stopRequested}>Stop</button>
      </div>}
      <label className="saved-view-control"><span>View</span>
        <select aria-label="Saved Roles View" value={savedView} disabled={busy} onChange={(event) => changeSavedView(event.target.value)}>
          <option value="all">All Saved Roles</option>
          <option value="current">Current Page</option>
          {!savedSnapshot?.complete && savedCompleteSnapshot?.roles?.length > 0 && <option value="complete">Last Complete Scan</option>}
          {savedPageIndices.map((pageIndex) => <option key={pageIndex} value={`page:${pageIndex}`}>Saved Page {pageIndex} · {savedPages[pageIndex].roles.length} Roles</option>)}
        </select>
        <HelpTooltip label="Saved Roles" text="Choose all saved roles, the live current page using saved scores, or one saved page. Loading saved results does not run OpenAI matching. The last complete scan is available if a newer scan stopped early." />
      </label>
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
        {!!lowMatchRoles.length && <ol className="submitted-role-list compact-role-list">{lowMatchRoles.map((role) => renderRoleCard(role))}</ol>}
        {!!unscoredRoles.length && <details className="compact-fold"><summary>Unscored Roles <span className="function-meta">{unscoredRoles.length}</span>
          <HelpTooltip label="Unscored Roles" text="These roles could not be scored. Review each posting manually before selecting it for withdrawal." /></summary>
          <ol className="submitted-role-list compact-role-list">{unscoredRoles.map((role) => renderRoleCard(role))}</ol>
        </details>}
        {!!protectedRoles.length && <details className="compact-fold" open={normalizedSearch ? true : undefined}><summary>Protected Roles <span className="function-meta">{protectedRoles.length}</span>
          <HelpTooltip label="Protected Roles" text="Starred roles and job 200654506 are excluded from the withdrawal ranking and cannot be selected. Job 200654506 remains protected even if unstarred. Unknown star status is also protected." /></summary>
          <ol className="submitted-role-list compact-role-list">{protectedRoles.map((role) => renderRoleCard(role, true))}</ol>
        </details>}
        <div className="compact-selection-bar"><span>{selectedIds.length} Selected</span>
          <button type="button" className="danger-button" disabled={busy || !selectedRoles.length} onClick={() => setConfirmationOpen(true)}>Review Withdrawal</button>
          <HelpTooltip label="Review Withdrawal" text="Review every selected job title and ID before confirming. Apple withdrawals cannot be undone, and you cannot reapply to those roles." />
        </div>
      </> : !analysisRunning && <p className="muted">No saved submissions yet.</p>}
      <dialog ref={confirmationRef} className="submitted-history-confirm" aria-labelledby="withdraw-confirm-title"
        onCancel={(event) => { if (busy) event.preventDefault(); else setConfirmationOpen(false); }} onClose={() => setConfirmationOpen(false)}>
        <h3 id="withdraw-confirm-title">Confirm Application Withdrawals</h3>
        <p>This will withdraw {selectedRoles.length} Apple applications. Withdrawals cannot be undone, and you cannot reapply to these roles.</p>
        <ul>{selectedRoles.map((role) => <li key={role.jobId}>{role.title} · {role.jobId}</li>)}</ul>
        {withdrawProgress && <p role="status">Withdrawing {withdrawProgress.index} Of {withdrawProgress.total}: {withdrawProgress.title}</p>}
        <div className="compact-actions">
          <button type="button" className="secondary" onClick={() => setConfirmationOpen(false)} disabled={busy}>Cancel</button>
          <button type="button" className="danger-button" onClick={withdrawSelected} disabled={busy || !selectedRoles.length}>
            {busy ? "Withdrawing…" : `Confirm Withdrawal (${selectedRoles.length})`}
          </button>
        </div>
      </dialog>
    </FunctionSection>
  );
}
