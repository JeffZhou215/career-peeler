import { HelpTooltip } from "./HelpTooltip";

export function CompactRoleCard({ role, status, selectable = false, selected = false, disabled = false, onSelect, actions, children }) {
  return <li className="compact-role">
    <details>
      <summary className="compact-role-heading">
        {selectable && <input type="checkbox" checked={selected} disabled={disabled}
          aria-label={`Select ${role.title}, Job ID ${role.jobId}`}
          onClick={(event) => event.stopPropagation()} onChange={onSelect} />}
        <span className="compact-role-copy"><span className="compact-role-title">{role.title}</span>
          <span className="compact-role-meta">{role.jobId}{status && <> · {status}</>}</span>
        </span>
        <strong className="compact-role-score">{Number.isFinite(role.score) ? `${role.score}%` : "Unscored"}</strong>
      </summary>
      <div className="compact-role-body">
        <div className="compact-role-actions" role="group" aria-label={`Actions For ${role.title}`}>
          <a className="job-page-link" href={role.url} target="_blank" rel="noopener noreferrer">Open Job Page</a>
          {actions}
        </div>
        <details className="compact-fold match-explanation">
          <summary>Match Details<HelpTooltip label="Match Details" text="Expand for the explanation. Review qualifications and candidate evidence before deciding on this role. Scores are an aid to review, not a guarantee of eligibility." /></summary>
          <div className="compact-fold-body"><p>{role.reason || "Matching has not finished for this role."}</p></div>
        </details>
        {children}
      </div>
    </details>
  </li>;
}
