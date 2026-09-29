import { useEffect, useMemo, useRef, useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { getActiveTab, sendMessageWithFallback } from "../lib/format";
import { withdrawSubmittedRolesSequentially } from "../lib/submittedWithdrawals.mjs";

const TARGET_ACTIVE_APPLICATIONS = 50;

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
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [withdrawProgress, setWithdrawProgress] = useState(null);
  const [error, setError] = useState("");
  const [pagesRead, setPagesRead] = useState(0);
  const [scanProgress, setScanProgress] = useState(null);
  const [postingCacheStats, setPostingCacheStats] = useState(null);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const scanActiveRef = useRef(false);
  const activeAnalysisIdRef = useRef(null);

  const selectedRoles = useMemo(
    () => roles.filter((role) => selectedIds.includes(role.jobId)),
    [roles, selectedIds]
  );
  const neededToReachTarget = Math.max(0, roles.length - TARGET_ACTIVE_APPLICATIONS);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleRoles = roles.filter((role) =>
    !normalizedSearch ||
    String(role.title || "").toLowerCase().includes(normalizedSearch) ||
    String(role.jobId || "").toLowerCase().includes(normalizedSearch)
  );
  const lowMatchRoles = visibleRoles.filter((role) => role.protectedFromBatchWithdrawal === false);
  const protectedRoles = visibleRoles.filter((role) => role.protectedFromBatchWithdrawal !== false);
  const canWithdrawFromResults = analysisComplete || scanProgress?.stopped === true;

  useEffect(() => {
    function handleSubmittedRoleProgress(message) {
      if (message?.type !== "APPLE_CAREERS_SUBMITTED_ROLES_PROGRESS") return;
      if (!scanActiveRef.current) return;
      const progress = message.data || {};
      const { roles: pageRoles, ...progressStatus } = progress;
      setPagesRead(progress.page || 0);
      setPostingCacheStats({ fetched: progress.descriptionsFetched || 0, reused: progress.descriptionsReused || 0 });
      setScanProgress((current) => ({ ...progressStatus, stopRequested: current?.stopRequested || false }));
      if (Array.isArray(pageRoles) && pageRoles.length) {
        setRoles((current) => {
          const byId = new Map(current.map((role) => [String(role.jobId), role]));
          for (const role of pageRoles) byId.set(String(role.jobId), role);
          return rankSubmittedRoles(Array.from(byId.values()));
        });
      }
      setStatusMessage(
        `Reviewing Apple submissions page ${progress.page}${progress.pageCount ? ` of ${progress.pageCount}` : ""} · ${progress.rolesAnalyzed || 0} roles matched so far.`
      );
    }
    chrome.runtime.onMessage.addListener(handleSubmittedRoleProgress);
    return () => chrome.runtime.onMessage.removeListener(handleSubmittedRoleProgress);
  }, [setStatusMessage]);

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

      setRoles([]);
      setSelectedIds([]);
      setPagesRead(0);
      setScanProgress({ page: 0, pageCount: 0, rolesAnalyzed: 0 });
      setPostingCacheStats(null);
      setAnalysisComplete(false);
      scanActiveRef.current = true;
      setAnalysisRunning(true);
      const analysisId = crypto.randomUUID();
      activeAnalysisIdRef.current = analysisId;
      setStatusMessage("Reviewing Apple submissions page by page and matching postings with your saved profile...");
      const response = await chrome.runtime.sendMessage({
        type: "APPLE_CAREERS_ANALYZE_SUBMITTED_ROLES",
        tabId: tab.id,
        userProfile: profile,
        analysisId
      });
      if (!response?.ok) throw new Error(response?.error || "Could not score the submitted roles.");

      const ranked = rankSubmittedRoles(response.data?.roles || []);
      const rankedLowMatches = ranked.filter((role) => role.protectedFromBatchWithdrawal === false);
      setPagesRead(response.data?.pagesRead || 0);
      setPostingCacheStats({
        fetched: response.data?.descriptionsFetched || 0,
        reused: response.data?.descriptionsReused || 0,
        unavailable: response.data?.descriptionsUnavailable || 0,
        saveFailed: Boolean(response.data?.cacheSaveFailed)
      });
      setRoles(ranked);
      if (response.data?.stopped) {
        setAnalysisComplete(false);
        setScanProgress({
          stopped: true,
          page: response.data.pagesRead || 0,
          pageCount: response.data.pageCount || 0,
          rolesAnalyzed: ranked.length
        });
        setSelectedIds([]);
        setStatusMessage(`Stopped after page ${response.data.pagesRead || 0}. You can review and withdraw selected roles from these partial results.`);
      } else {
        setAnalysisComplete(true);
        setScanProgress(null);
        setSelectedIds(
          rankedLowMatches
            .filter((role) => Number.isFinite(role.score) && role.descriptionAvailable)
            .slice(0, neededCount(ranked.length))
            .map((role) => role.jobId)
        );
        setStatusMessage(
          `Analyzed ${ranked.length} roles across ${response.data.pagesRead || 0} pages: fetched ${response.data.descriptionsFetched || 0} postings, reused ${response.data.descriptionsReused || 0} cached, unavailable ${response.data.descriptionsUnavailable || 0}.${response.data.truncated ? " Capped at 250 roles." : ""}${response.data.cacheSaveFailed ? " Some details could not be saved to extension storage." : ""}`
        );
      }
    } catch (analyzeError) {
      setError(analyzeError?.message || "Could not analyze Apple submitted roles.");
      if (scanActiveRef.current) {
        setScanProgress((current) => ({ ...current, failed: true }));
      }
      setStatusMessage("Could not analyze Apple submitted roles.");
    } finally {
      scanActiveRef.current = false;
      activeAnalysisIdRef.current = null;
      setAnalysisRunning(false);
      setBusy(false);
    }
  }

  async function stopAnalysis() {
    const analysisId = activeAnalysisIdRef.current;
    if (!analysisId) return;
    setScanProgress((current) => ({ ...current, stopRequested: true }));
    setStatusMessage("Stopping after the current submissions page finishes...");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "APPLE_CAREERS_STOP_SUBMITTED_ROLES_ANALYSIS",
        analysisId
      });
      if (!response?.ok) throw new Error(response?.error || "The scan could not be stopped.");
    } catch (stopError) {
      setScanProgress((current) => ({ ...current, stopRequested: false }));
      setError(stopError?.message || "The scan could not be stopped.");
    }
  }

  function toggleRole(jobId) {
    setSelectedIds((current) =>
      current.includes(jobId) ? current.filter((id) => id !== jobId) : [...current, jobId]
    );
  }

  function renderRoleCard(role, protectedFromBatch = false) {
    const favoriteStatusLabel =
      role.jobId === "200654506"
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
            disabled={busy || !canWithdrawFromResults || confirmationOpen || protectedFromBatch || !Number.isFinite(role.score)}
          />
          <span>{role.score === null || role.score === undefined ? "No score" : `${role.score}% fit`}</span>
        </label>
        <a href={role.url} target="_blank" rel="noopener noreferrer" className="submitted-role-title">{role.title}</a>
        <span className="submitted-role-id">Job ID {role.jobId}</span>
        <span className="submitted-role-protected-label">
          {role.descriptionAvailable ? "Scored against job description" : "Low confidence · posting unavailable"}
        </span>
        {favoriteStatusLabel && <span className="submitted-role-protected-label">{favoriteStatusLabel}</span>}
        <p>{role.reason || "No explanation was returned."}</p>
        {role.submittedDate && <span className="muted">Submitted {role.submittedDate}</span>}
      </li>
    );
  }

  async function withdrawSelected() {
    if (!selectedRoles.length) return;
    const targets = selectedRoles.map(({ jobId, title }) => ({ jobId, title }));
    let confirmedCount = 0;
    let actionStarted = false;
    setBusy(true);
    setError("");
    setStatusMessage(`Preparing to withdraw ${targets.length} selected Apple applications...`);
    try {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error("The Apple Careers tab is no longer available.");
      const page = await sendMessageWithFallback(tab.id, {
        type: "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE"
      });
      if (!page?.ok) throw new Error(page?.error || "Apple's active submissions page could not be read.");
      if (page.data?.withdrawalConfirmationOpen) {
        throw new Error("An Apple withdrawal confirmation is already open. Resolve it before starting another batch.");
      }

      await withdrawSubmittedRolesSequentially(targets, {
        withdrawOne: (role) => {
          actionStarted = true;
          return chrome.tabs.sendMessage(tab.id, {
            type: "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES",
            roles: [role]
          });
        },
        verifyRoleStatus: async (role) => {
          const response = await sendMessageWithFallback(tab.id, {
            type: "APPLE_CAREERS_CHECK_SUBMITTED_ROLE_STATUS",
            jobId: role.jobId
          });
          if (!response?.ok) throw new Error(response?.error || "Apple's current role status could not be read.");
          return response.data;
        },
        onRoleStart: (role, index, total) => {
          setWithdrawProgress({ index: index + 1, total, title: role.title });
          setStatusMessage(`Withdrawing ${index + 1} of ${total}: ${role.title}...`);
        },
        onRoleConfirmed: ({ role, verifiedAfterInterruption }, index, total) => {
          confirmedCount += 1;
          setRoles((current) => rankSubmittedRoles(current.filter((item) => String(item.jobId) !== String(role.jobId))));
          setSelectedIds((current) => current.filter((jobId) => String(jobId) !== String(role.jobId)));
          setStatusMessage(`${confirmedCount} of ${total} no longer active${verifiedAfterInterruption ? " · verified after Apple refreshed the page" : ""}.`);
        }
      });
      setConfirmationOpen(false);
      setSelectedIds([]);
      setStatusMessage(`${confirmedCount} selected applications are no longer active. Updated this list without rescanning; refresh roles to verify Apple's current list.`);
    } catch (withdrawError) {
      setConfirmationOpen(false);
      if (actionStarted) {
        setAnalysisComplete(false);
        setScanProgress({
          failed: true,
          page: pagesRead,
          pageCount: scanProgress?.pageCount || 0,
          rolesAnalyzed: Math.max(0, roles.length - confirmedCount)
        });
      }
      setError(`Batch stopped after ${confirmedCount} of ${targets.length} were confirmed inactive. ${withdrawError?.message || "The next role could not be verified."}`);
      setStatusMessage(`Batch stopped after ${confirmedCount} of ${targets.length}. ${actionStarted ? "Refresh roles before retrying." : "Resolve the Apple page issue before retrying."}`);
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
            <HelpTooltip text="Reviews active Apple submissions page by page, compares each posting's description and qualifications with your saved resume, and caches details for 180 days. If Apple signs you out, sign back in and analyze again; cached details are reused. Unavailable postings are low confidence and aren't preselected for withdrawal." />
          </div>
        </div>
        {analysisRunning ? (
          <button type="button" onClick={stopAnalysis} disabled={scanProgress?.stopRequested}>
            {scanProgress?.stopRequested ? "Stopping…" : "Stop scan"}
          </button>
        ) : (
          <button type="button" onClick={analyzeRoles} disabled={busy}>
            {busy ? "Working…" : roles.length ? "Refresh roles" : "Analyze roles"}
          </button>
        )}
      </div>

      <p className="muted">
        Apple says some roles are exempt from its 50-role cap. The count and suggested batch here target exactly 50 entries in the visible Active submissions list; they may differ from Apple’s cap-eligible count.
      </p>

      {postingCacheStats && (
        <p className="muted" role="status">
          Posting details: {postingCacheStats.reused} reused from Chrome storage · {postingCacheStats.fetched} fetched this review
          {postingCacheStats.unavailable ? ` · ${postingCacheStats.unavailable} unavailable` : ""}
          {postingCacheStats.saveFailed ? " · some fetched details could not be saved" : ""}
        </p>
      )}

      {error && <p className="submitted-history-error" role="alert">{error}</p>}

      {scanProgress && (
        <div className="submitted-history-progress" role="status" aria-live="polite">
          <strong>
            {scanProgress.stopped
              ? "Scan stopped"
              : scanProgress.failed
                ? "Scan stopped before completion"
              : busy
                ? "Reviewing submissions"
                : "Scan incomplete"}
          </strong>
          <span>
            {scanProgress.rolesAnalyzed || 0} roles scored
            {scanProgress.pageCount ? ` · page ${scanProgress.page || 0} of ${scanProgress.pageCount}` : " · preparing first page"}
          </span>
          {!analysisComplete && (
            <span>
              {scanProgress.stopped
                ? "Partial results are ready for manual review. The count cannot confirm how many withdrawals are needed to reach 50."
                : scanProgress.failed
                  ? "Refresh to complete the ranking. Withdrawal selection is unavailable."
                  : scanProgress.stopRequested
                    ? "Finishing the current page before stopping."
                    : "Roles appear as each page finishes. Withdrawal selection unlocks after the full scan."}
            </span>
          )}
        </div>
      )}

      {roles.length > 0 && (
        <>
          <div className="submitted-history-summary">
            <span>
              {analysisComplete
                ? `${roles.length} active submissions across ${pagesRead} pages`
                : `${roles.length} submissions scored so far across ${pagesRead} pages`}
            </span>
            {analysisComplete && <span>{neededToReachTarget} withdrawals needed to reach {TARGET_ACTIVE_APPLICATIONS}</span>}
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
          {canWithdrawFromResults ? (
            <>
              {analysisComplete ? (
                <p className="muted">
                  {selectedIds.length} eligible role{selectedIds.length === 1 ? " is" : "s are"} preselected; {neededToReachTarget} withdrawal{neededToReachTarget === 1 ? " is" : "s are"} needed to reach {TARGET_ACTIVE_APPLICATIONS}.
                  {selectedIds.length < neededToReachTarget && " There are not enough description-scored, unstarred roles to fill that batch."}
                </p>
              ) : (
                <p className="muted">Partial scan: no roles are preselected. Choose each role carefully; this result cannot confirm the count needed to reach 50.</p>
              )}

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
            <p className="muted">Live ranking preview · complete or stop the scan to review withdrawal selections.</p>
          )}

          {visibleRoles.length === 0 ? (
            <p className="muted">No submitted roles match that title or job ID.</p>
          ) : (
            <>
              {lowMatchRoles.length > 0 && (
                <>
                  <h3 className="submitted-role-group-heading">Low-match roles · unstarred{analysisComplete ? "" : " · so far"}</h3>
                  <ol className="submitted-role-list">
                    {lowMatchRoles.map((role) => renderRoleCard(role))}
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

function neededCount(count) {
  return Math.max(0, count - TARGET_ACTIVE_APPLICATIONS);
}
