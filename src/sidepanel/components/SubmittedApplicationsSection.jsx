import { useMemo, useState } from "react";
import { getActiveTab, sendMessageWithFallback } from "../lib/format";

const TARGET_ACTIVE_APPLICATIONS = 50;

export function SubmittedApplicationsSection({ profile, setStatusMessage }) {
  const [roles, setRoles] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [error, setError] = useState("");
  const [pagesRead, setPagesRead] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

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

      const history = await sendMessageWithFallback(tab.id, {
        type: "APPLE_CAREERS_COLLECT_SUBMITTED_HISTORY"
      });
      if (!history?.ok) throw new Error(history?.error || "Could not read the submitted roles.");
      setPagesRead(history.data?.pagesRead || 0);

      setStatusMessage(`Matching ${history.data.roles.length} roles with your saved profile...`);
      const response = await chrome.runtime.sendMessage({
        type: "APPLE_CAREERS_SCORE_SUBMITTED_ROLES",
        roles: history.data.roles,
        userProfile: profile
      });
      if (!response?.ok) throw new Error(response?.error || "Could not score the submitted roles.");

      const scoreById = new Map((response.data || []).map((match) => [match.jobId, match]));
      const scoredRoles = history.data.roles
        .map((role) => ({ ...role, ...(scoreById.get(role.jobId) || {}) }))
        .filter((role) => role.active !== false);
      const rankedLowMatches = scoredRoles
        .filter((role) => role.protectedFromBatchWithdrawal === false)
        .sort((left, right) => (left.score ?? 101) - (right.score ?? 101));
      const protectedFromBatch = scoredRoles
        .filter((role) => role.protectedFromBatchWithdrawal !== false)
        .sort((left, right) => String(left.title || "").localeCompare(String(right.title || "")));
      const ranked = [...rankedLowMatches, ...protectedFromBatch];
      setRoles(ranked);
      setSelectedIds(
        rankedLowMatches
          .filter((role) => Number.isFinite(role.score))
          .slice(0, neededCount(ranked.length))
          .map((role) => role.jobId)
      );
      setStatusMessage(`Analyzed ${ranked.length} active submitted roles. Lowest preliminary matches are listed first.`);
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
            disabled={busy || confirmationOpen || protectedFromBatch || !Number.isFinite(role.score)}
          />
          <span>{role.score === null || role.score === undefined ? "No score" : `${role.score}% fit`}</span>
        </label>
        <a href={role.url} target="_blank" rel="noopener noreferrer" className="submitted-role-title">{role.title}</a>
        <span className="submitted-role-id">Job ID {role.jobId}</span>
        {favoriteStatusLabel && <span className="submitted-role-protected-label">{favoriteStatusLabel}</span>}
        <p>{role.reason || "No explanation was returned."}</p>
        {role.submittedDate && <span className="muted">Submitted {role.submittedDate}</span>}
      </li>
    );
  }

  async function withdrawSelected() {
    if (!selectedRoles.length) return;
    setBusy(true);
    setError("");
    setStatusMessage(`Withdrawing ${selectedRoles.length} selected Apple applications...`);
    try {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error("The Apple Careers tab is no longer available.");
      const result = await sendMessageWithFallback(tab.id, {
        type: "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES",
        roles: selectedRoles.map(({ jobId, title }) => ({ jobId, title }))
      });
      if (!result?.ok) throw new Error(result?.error || "The withdrawal batch could not be completed.");
      setConfirmationOpen(false);
      const withdrawnCount = result.data?.withdrawn?.length || 0;
      const failedRole = result.data?.failed?.[0];
      setStatusMessage(
        failedRole
          ? `Withdrew ${withdrawnCount}; stopped at ${failedRole.title || failedRole.jobId}: ${failedRole.error}`
          : `Withdrew ${withdrawnCount} applications. Refreshing the active list...`
      );
      await analyzeRoles();
      if (failedRole) {
        setError(`Partial batch: withdrew ${withdrawnCount}. Stopped at ${failedRole.title || failedRole.jobId}: ${failedRole.error}`);
        setStatusMessage(`Partial batch completed: ${withdrawnCount} withdrawn; one role needs manual review.`);
      }
    } catch (withdrawError) {
      setError(withdrawError?.message || "The withdrawal batch stopped before completion.");
      setStatusMessage("The withdrawal batch stopped; review the reported progress before retrying.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="submitted-history">
      <div className="submitted-history-heading">
        <div>
          <p className="eyebrow">APPLE CAREERS</p>
          <h2>Submitted application review</h2>
        </div>
        <button type="button" onClick={analyzeRoles} disabled={busy}>
          {busy ? "Working…" : roles.length ? "Refresh roles" : "Analyze roles"}
        </button>
      </div>

      <p className="muted">
        Reads the Active submissions pages and uses your saved resume profile with OpenAI. Scores use role title and department only; Apple’s full job descriptions are not fetched in this first pass.
      </p>
      <p className="muted">
        Apple says some roles are exempt from its 50-role cap. The count and suggested batch here target exactly 50 entries in the visible Active submissions list; they may differ from Apple’s cap-eligible count.
      </p>

      {error && <p className="submitted-history-error" role="alert">{error}</p>}

      {roles.length > 0 && (
        <>
          <div className="submitted-history-summary">
            <span>{roles.length} active submissions across {pagesRead} pages</span>
            <span>{neededToReachTarget} withdrawals needed to reach {TARGET_ACTIVE_APPLICATIONS}</span>
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
          <p className="muted">
            {selectedIds.length} eligible role{selectedIds.length === 1 ? " is" : "s are"} preselected; {neededToReachTarget} withdrawal{neededToReachTarget === 1 ? " is" : "s are"} needed to reach {TARGET_ACTIVE_APPLICATIONS}.
            {selectedIds.length < neededToReachTarget && " There are not enough scorable, unstarred roles to fill that batch."}
          </p>

          {confirmationOpen ? (
            <div className="submitted-history-confirm" role="alertdialog" aria-modal="true" aria-labelledby="withdraw-confirm-title">
              <h3 id="withdraw-confirm-title">Confirm application withdrawals</h3>
              <p>
                This will withdraw {selectedRoles.length} Apple applications from your account. That changes your candidacy for those roles. Confirm only if you want to withdraw every role listed here.
              </p>
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

          {visibleRoles.length === 0 ? (
            <p className="muted">No submitted roles match that title or job ID.</p>
          ) : (
            <>
              {lowMatchRoles.length > 0 && (
                <>
                  <h3 className="submitted-role-group-heading">Low-match roles · unstarred</h3>
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
