export function isProtectedSubmission(role) {
  return String(role.jobId).split("-")[0] === "200654506" || role.favorite !== false || role.protectedFromBatchWithdrawal !== false;
}

export function submissionCollection(archive = {}) {
  const latest = archive.latestScan;
  const complete = latest?.complete === true && Array.isArray(latest.roles) &&
    (latest.roles.length > 0 || latest.inventoryState === "confirmed_empty" && latest.accountVerified === true);
  const prior = archive.lastCompleteScan;
  const byId = new Map();
  const merge = roles => {
    for (const role of roles || []) {
      const id = String(role.jobId || "");
      if (!id) continue;
      if (role.active === false) { byId.delete(id); continue; }
      const old = byId.get(id);
      const keepScore = old?.title === role.title && Number.isFinite(old.score) && !Number.isFinite(role.score);
      byId.set(id, { ...(old?.title === role.title ? old : {}), ...role, ...(keepScore ? { score: old.score, reason: old.reason,
        matchBasis: old.matchBasis, descriptionAvailable: old.descriptionAvailable, scoreSource: "previous_review" } : {}) });
    }
  };
  if (complete) {
    // A complete inventory is authoritative, including confirmed zero. Unioning
    // old pages here would resurrect applications removed by a successful sync.
    merge(latest.roles);
  } else {
    merge(prior?.roles);
    for (const page of Object.values(archive.pages || {}).sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))) merge(page.roles);
    merge(latest?.roles);
  }
  const seen = new Set((latest?.roles || []).map(role => String(role.jobId)));
  const roles = [...byId.values()].map(role => ({ ...role, protectedFromBatchWithdrawal: isProtectedSubmission(role),
    availabilityUnknown: !complete && !seen.has(String(role.jobId)) }))
    .sort((a, b) => Number(a.protectedFromBatchWithdrawal) - Number(b.protectedFromBatchWithdrawal) ||
      (a.protectedFromBatchWithdrawal ? String(a.title || "").localeCompare(String(b.title || "")) : (a.score ?? 101) - (b.score ?? 101)));
  return { roles, partial: !complete && Boolean(latest || prior || roles.length), updatedAt: latest?.updatedAt || prior?.updatedAt || null,
    warning: latest?.warning || null };
}

export function filterSubmissions(roles, filter, query = "") {
  const text = query.trim().toLowerCase();
  return roles.filter(role => (!text || String(role.title || "").toLowerCase().includes(text) || String(role.jobId).toLowerCase().includes(text)) &&
    (filter === "all" || filter === "protected" && isProtectedSubmission(role) ||
      filter === "scored" && Number.isFinite(role.score) || filter === "unscored" && !Number.isFinite(role.score)));
}

export function retainSubmissionSelection(ids, roles) {
  const selectable = new Set(roles.filter(role => !isProtectedSubmission(role)).map(role => String(role.jobId)));
  return ids.filter(id => selectable.has(String(id)));
}
