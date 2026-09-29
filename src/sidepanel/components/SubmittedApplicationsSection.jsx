import { useMemo, useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { getActiveTab, sendMessageWithFallback } from "../lib/format";
import { withdrawSubmittedRolesSequentially } from "../lib/submittedWithdrawals.mjs";

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
  const lowMatchRoles = visibleRoles.filter((role) => role.protectedFromBatchWithdrawal === false);
  const protectedRoles = visibleRoles.filter((role) => role.protectedFromBatchWithdrawal !== false);

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
      setReviewContext(null);
      setPostingCacheStats(null);
      setStatusMessage("Matching submissions on the visible Apple page with your saved profile...");
      const response = await chrome.runtime.sendMessage({
        type: "APPLE_CAREERS_ANALYZE_SUBMITTED_ROLES",
        tabId: tab.id,
        userProfile: profile
      });
      if (!response?.ok) throw new Error(response?.error || "Could not score the submitted roles.");

      const ranked = rankSubmittedRoles(response.data?.roles || []);
      setPostingCacheStats({
        fetched: response.data?.descriptionsFetched || 0,
        reused: response.data?.descriptionsReused || 0,
        unavailable: response.data?.descriptionsUnavailable || 0,
        saveFailed: Boolean(response.data?.cacheSaveFailed),
        scoresReused: response.data?.scoresReused || 0,
        scoresFetched: response.data?.scoresFetched || 0
      });
      setRoles(ranked);
      setReviewContext({ tabId: tab.id, pageIndex: response.data.pageIndex, pageCount: response.data.pageCount });
      setStatusMessage(`Analyzed ${ranked.length} submissions on page ${response.data.pageIndex} of ${response.data.pageCount}. Select any roles you want to review for withdrawal.`);
    } catch (analyzeError) {
      setError(analyzeError?.message || "Could not analyze Apple submitted roles.");
      setStatusMessage("Could not analyze Apple submitted roles.");
    } finally {
      setBusy(false);
    }
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
            disabled={busy || !reviewContext || confirmationOpen || protectedFromBatch || !Number.isFinite(role.score)}
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
    if (!selectedRoles.length || !reviewContext) return;
    const targets = selectedRoles.map(({ jobId, title }) => ({ jobId, title }));
    let confirmedCount = 0;
    let actionStarted = false;
    setBusy(true);
    setError("");
    setStatusMessage(`Preparing to withdraw ${targets.length} selected Apple applications...`);
    try {
      const tab = await getActiveTab();
      if (tab?.id !== reviewContext.tabId) throw new Error("Return to the Apple tab you analyzed, or analyze this page again.");
      const page = await sendMessageWithFallback(tab.id, {
        type: "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE"
      });
      if (!page?.ok) throw new Error(page?.error || "Apple's active submissions page could not be read.");
      if (page.data?.pageIndex !== reviewContext.pageIndex) {
        throw new Error("The visible Apple submissions page changed. Analyze this page again before withdrawing.");
      }
      if (page.data?.withdrawalConfirmationOpen) {
        throw new Error("An Apple withdrawal confirmation is already open. Resolve it before starting another batch.");
      }
      if (targets.some((role) => !page.data.roles.some((current) =>
        String(current.jobId) === String(role.jobId) && current.active && current.protectedFromBatchWithdrawal === false
      ))) {
        throw new Error("A selected role is no longer an unstarred active submission on this page. Analyze this page again.");
      }

      await withdrawSubmittedRolesSequentially(targets, {
        withdrawOne: (role) => {
          actionStarted = true;
          return chrome.tabs.sendMessage(tab.id, {
            type: "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES",
            roles: [role],
            expectedPageIndex: reviewContext.pageIndex
          });
        },
        verifyRoleStatus: async (role) => {
          const response = await sendMessageWithFallback(tab.id, {
            type: "APPLE_CAREERS_CHECK_SUBMITTED_ROLE_STATUS",
            jobId: role.jobId,
            expectedPageIndex: reviewContext.pageIndex
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
      setStatusMessage(`${confirmedCount} selected applications are no longer active. Analyze the visible page again to refresh its ranking.`);
    } catch (withdrawError) {
      setConfirmationOpen(false);
      setReviewContext(null);
      setError(`Batch stopped after ${confirmedCount} of ${targets.length} were confirmed inactive. ${withdrawError?.message || "The next role could not be verified."}`);
      setStatusMessage(`Batch stopped after ${confirmedCount} of ${targets.length}. ${actionStarted ? "Analyze the visible page again before retrying." : "Resolve the Apple page issue and analyze again."}`);
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
        <button type="button" onClick={analyzeRoles} disabled={busy}>
          {busy ? "Working…" : roles.length ? "Refresh this page" : "Analyze this page"}
        </button>
      </div>

      <p className="muted">
        Open Your Roles → Submissions → Active and choose the page you want to review. Only that page is scored and eligible for batch withdrawal. No roles are selected automatically.
      </p>

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
            <span>{roles.length} active submissions on page {reviewContext?.pageIndex || "?"} of {reviewContext?.pageCount || "?"}</span>
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
            <p className="muted">Analyze the visible page again before selecting withdrawals.</p>
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
