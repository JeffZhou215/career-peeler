// Durable withdrawal intent is separate from page-local, one-use click authority.
// Neither a new batch nor a worker restart may replay an unresolved Proceed.
const APPLE_WITHDRAWAL_WORKFLOW_KEY = "appleWithdrawalWorkflow";
const APPLE_WITHDRAWAL_INVENTORY_MAX_AGE_MS = 60000;

function appleWithdrawalRecoveryError(message, jobId = null) {
  const error = new Error(message);
  error.code = "withdrawal_reconciliation_required";
  if (jobId) error.jobId = jobId;
  return error;
}

function appleWithdrawalJournal(value) {
  if (value === undefined) return { version: 1, records: {} };
  if (!value || value.version !== 1 || !value.records || typeof value.records !== "object" || Array.isArray(value.records)) {
    throw appleWithdrawalRecoveryError("Saved withdrawal safety state could not be read. Reconcile Apple submissions before retrying.");
  }
  for (const [jobId, record] of Object.entries(value.records)) {
    if (!/^\d+(?:-\d+)?$/.test(jobId) || record?.jobId !== jobId ||
        !["unknown", "active", "inactive"].includes(record.outcome) ||
        !Number.isFinite(record.intentAt) || record.intentAt <= 0 || !record.batchId || !record.requestId ||
        !record.documentId || !Number.isInteger(record.tabId)) {
      throw appleWithdrawalRecoveryError("Saved withdrawal safety state is incomplete. Reconcile Apple submissions before retrying.", jobId);
    }
  }
  return value;
}

async function readAppleWithdrawalJournal() {
  return appleWithdrawalJournal(await CareerPeelerJobStore.getMetadata(APPLE_WITHDRAWAL_WORKFLOW_KEY));
}

async function readAppleWithdrawalRecord(jobId) {
  if (typeof jobId !== "string" || !/^\d+(?:-\d+)?$/.test(jobId)) {
    throw appleWithdrawalRecoveryError("The exact Apple withdrawal job ID is required.");
  }
  return (await readAppleWithdrawalJournal()).records[jobId] || null;
}

function appleWithdrawalRetryAllowed(record, reviewedAt) {
  if (!record) return;
  if (record.outcome === "unknown") {
    throw appleWithdrawalRecoveryError("This job has an unresolved withdrawal. Sync Submissions to verify the complete Apple inventory before reviewing another attempt.", record.jobId);
  }
  if (record.outcome === "inactive") {
    throw appleWithdrawalRecoveryError("Apple's verified inventory confirmed this job inactive. No additional withdrawal may be issued.", record.jobId);
  }
  const inventoryStartedAt = record.inventoryReadStartedAt;
  if (!Number.isFinite(inventoryStartedAt) || inventoryStartedAt > Date.now() ||
      Date.now() - inventoryStartedAt > APPLE_WITHDRAWAL_INVENTORY_MAX_AGE_MS) {
    throw appleWithdrawalRecoveryError("This job's previous active-inventory check is stale. Sync Submissions, then review a new withdrawal selection.", record.jobId);
  }
  if (!Number.isFinite(record.reconciledAt) || !Number.isFinite(reviewedAt) || reviewedAt <= record.reconciledAt) {
    throw appleWithdrawalRecoveryError("Apple confirmed this job still active. Review and confirm a new withdrawal selection after synchronization.", record.jobId);
  }
}

async function assertAppleWithdrawalRetryAllowed(jobIds, reviewedAt) {
  if (!Array.isArray(jobIds) || !jobIds.length || jobIds.some(id => typeof id !== "string" || !/^\d+(?:-\d+)?$/.test(id)) ||
      !Number.isFinite(reviewedAt) || reviewedAt <= 0) {
    throw appleWithdrawalRecoveryError("A freshly reviewed withdrawal selection with exact Apple job IDs is required.");
  }
  const journal = await readAppleWithdrawalJournal();
  for (const jobId of jobIds) appleWithdrawalRetryAllowed(journal.records[jobId], reviewedAt);
}

async function beginAppleWithdrawalIntent({ jobId, batchId, requestId, tabId, documentId, reviewedAt }) {
  if (typeof jobId !== "string" || !/^\d+(?:-\d+)?$/.test(jobId) || !batchId || !requestId ||
      !Number.isInteger(tabId) || !documentId || !Number.isFinite(reviewedAt) || reviewedAt <= 0) {
    throw appleWithdrawalRecoveryError("The reviewed Apple withdrawal identity could not be saved.");
  }
  const journal = await CareerPeelerJobStore.updateMetadata(APPLE_WITHDRAWAL_WORKFLOW_KEY, previous => {
    const state = appleWithdrawalJournal(previous);
    const record = state.records[jobId];
    appleWithdrawalRetryAllowed(record, reviewedAt);
    if (record?.batchId === batchId) {
      throw appleWithdrawalRecoveryError("A reconciled withdrawal requires a newly reviewed batch.", jobId);
    }
    state.records[jobId] = { jobId, batchId, requestId, tabId, documentId, reviewedAt,
      intentAt: Date.now(), outcome: "unknown", attempts: (record?.attempts || 0) + 1 };
    return state;
  });
  return journal.records[jobId];
}

async function invalidateAppleWithdrawalResolution({ jobId, batchId, requestId, documentId }, reason) {
  if (typeof jobId !== "string" || !/^\d+(?:-\d+)?$/.test(jobId) || !batchId || !requestId) {
    throw appleWithdrawalRecoveryError("The exact withdrawal operation is required to invalidate its resolution.");
  }
  const journal = await CareerPeelerJobStore.updateMetadata(APPLE_WITHDRAWAL_WORKFLOW_KEY, previous => {
    const state = appleWithdrawalJournal(previous);
    const record = state.records[jobId];
    if (!record || record.batchId !== batchId || record.requestId !== requestId ||
        (documentId !== undefined && record.documentId !== documentId)) {
      throw appleWithdrawalRecoveryError("The contradictory observation belongs to an older withdrawal operation.", jobId);
    }
    state.records[jobId] = { ...record, outcome: "unknown",
      uncertainAt: Math.max(Date.now(), record.inventoryReadCompletedAt || 0) + 1,
      uncertaintyReason: String(reason || "Apple's current inventory contradicts the previous withdrawal resolution.").slice(0, 500) };
    return state;
  });
  return journal.records[jobId];
}

async function resolveAppleWithdrawalInventory(evidence, { jobIds = null, expectedOperation = null } = {}) {
  if (jobIds !== null && (!Array.isArray(jobIds) || jobIds.some(id => typeof id !== "string" || !/^\d+(?:-\d+)?$/.test(id)))) {
    throw appleWithdrawalRecoveryError("Exact Apple job IDs are required for withdrawal reconciliation.");
  }
  if (expectedOperation && (typeof expectedOperation.jobId !== "string" || !expectedOperation.batchId ||
      !expectedOperation.requestId || !expectedOperation.documentId ||
      (jobIds && (jobIds.length !== 1 || jobIds[0] !== expectedOperation.jobId)))) {
    throw appleWithdrawalRecoveryError("The withdrawal reconciliation does not identify its exact pending operation.");
  }
  const journal = await CareerPeelerJobStore.updateMetadata(APPLE_WITHDRAWAL_WORKFLOW_KEY, previous => {
    const state = appleWithdrawalJournal(previous);
    const selectedIds = expectedOperation ? [expectedOperation.jobId] : jobIds || Object.keys(state.records);
    const updates = [];
    for (const jobId of selectedIds) {
      const record = state.records[jobId];
      if (expectedOperation && (!record || ["jobId", "batchId", "requestId", "documentId"].some(key =>
        record[key] !== expectedOperation[key]))) {
        throw appleWithdrawalRecoveryError("The inventory result belongs to an older withdrawal operation. The pending outcome remains unresolved.", jobId);
      }
      if (!record) continue;
      // The validator requires two stable complete reads begun after intent.
      // Running validation inside this transaction prevents an old proof from
      // resolving a newer intent installed by another worker context.
      const inventory = CareerPeelerApplicationSafety.validateWithdrawalInventoryEvidence(evidence, {
        notBefore: Math.max(record.intentAt, record.inventoryReadCompletedAt || 0, record.uncertainAt || 0)
      });
      const active = inventory.roles.some(role => role.jobId === jobId && role.active === true);
      updates.push([jobId, { ...record, outcome: active ? "active" : "inactive",
        reconciledAt: Date.now(), verifiedAt: inventory.readCompletedAt,
        inventoryReadStartedAt: inventory.readStartedAt, inventoryReadCompletedAt: inventory.readCompletedAt }]);
    }
    for (const [jobId, record] of updates) state.records[jobId] = record;
    return state;
  });
  return journal.records;
}

// This is the only path that consumes withdrawal proof to remove local active
// records. Checking a receipt in the panel before awaiting another page read is
// insufficient: a restarted worker may reconcile contradictory evidence meanwhile.
async function commitAppleWithdrawalCleanup({ jobId, batchId, requestId, documentId, livePage = null }) {
  if (typeof jobId !== "string" || !/^\d+(?:-\d+)?$/.test(jobId) || !batchId || !requestId) {
    throw appleWithdrawalRecoveryError("The exact reviewed withdrawal operation is required to update saved submissions.");
  }
  let alreadyFinalized = false;
  await CareerPeelerJobStore.updateCollections([
    APPLE_WITHDRAWAL_WORKFLOW_KEY, "appleSubmittedRoleReviews", "appleJobRanking"
  ], values => {
    const journal = appleWithdrawalJournal(values[APPLE_WITHDRAWAL_WORKFLOW_KEY]);
    const record = journal.records[jobId];
    const now = Date.now();
    if (!record || record.batchId !== batchId || record.requestId !== requestId ||
        (documentId !== undefined && documentId !== record.documentId) || record.outcome !== "inactive" ||
        !Number.isFinite(record.verifiedAt) || !Number.isFinite(record.inventoryReadStartedAt) ||
        !Number.isFinite(record.inventoryReadCompletedAt) || record.verifiedAt !== record.inventoryReadCompletedAt ||
        record.inventoryReadStartedAt < Math.max(record.intentAt, record.uncertainAt || 0) ||
        record.inventoryReadCompletedAt < record.inventoryReadStartedAt ||
        record.inventoryReadStartedAt > now || record.verifiedAt > now ||
        now - record.inventoryReadStartedAt > APPLE_WITHDRAWAL_INVENTORY_MAX_AGE_MS) {
      throw appleWithdrawalRecoveryError("The withdrawal proof changed or expired before saved records could be updated. Sync Submissions before reviewing another attempt.", jobId);
    }
    if (livePage?.roles?.some(role => role.jobId === jobId && role.active === true)) {
      throw appleWithdrawalRecoveryError("Apple still shows the selected job active. Sync Submissions before reviewing another attempt.", jobId);
    }
    if (record.cleanup) { alreadyFinalized = true; return {}; }
    const updates = {};
    const archive = values.appleSubmittedRoleReviews;
    const withoutTarget = roles => (roles || []).filter(role => String(role.jobId) !== jobId);
    if (archive) {
      const pages = Object.fromEntries(Object.entries(archive.pages || {}).map(([index, page]) =>
        [index, { ...page, roles: withoutTarget(page.roles) }]));
      const cleanedSnapshot = snapshot => snapshot ? { ...snapshot, roles: withoutTarget(snapshot.roles),
        scannedAt: snapshot.scannedAt || snapshot.updatedAt, updatedAt: now } : null;
      const latestScan = cleanedSnapshot(archive.latestScan);
      const lastCompleteScan = cleanedSnapshot(archive.lastCompleteScan);
      // Retain current-page metadata as a navigation hint only. It is never
      // promoted to a complete inventory or used to clear unrelated reservations.
      if (livePage?.accountVerified === true && livePage.withdrawalConfirmationOpen === false &&
          Number.isInteger(livePage.pageIndex) && Array.isArray(livePage.roles)) {
        const saved = new Map((latestScan?.roles || []).map(role => [String(role.jobId), role]));
        const currentRoles = withoutTarget(livePage.roles).filter(role => role.active === true).map(role => {
          const previous = saved.get(String(role.jobId));
          const merged = previous?.title === role.title ? { ...previous, ...role } : role;
          saved.set(String(role.jobId), { ...merged, sourcePageIndex: livePage.pageIndex });
          return merged;
        });
        pages[livePage.pageIndex] = { ...(pages[livePage.pageIndex] || {}), ...livePage, roles: currentRoles, updatedAt: now };
        if (latestScan) latestScan.roles = Array.from(saved.values());
      }
      updates.appleSubmittedRoleReviews = { ...archive, pages,
        ...(latestScan ? { latestScan } : {}), ...(lastCompleteScan ? { lastCompleteScan } : {}) };
    }
    const ranking = values.appleJobRanking;
    if (ranking) {
      const baseId = jobId.split("-")[0];
      ranking.withdrawnIds = [...new Set([...(ranking.withdrawnIds || []), baseId])];
      ranking.reservations = (ranking.reservations || []).filter(role => String(role.jobId).split("-")[0] !== baseId);
      if (ranking.jobs?.[baseId]) {
        ranking.jobs[baseId] = { ...ranking.jobs[baseId], queueStatus: "withdrawn", eligible: false };
      }
      if (ranking.capacitySnapshot) ranking.capacitySnapshot = { ...ranking.capacitySnapshot,
        roles: withoutTarget(ranking.capacitySnapshot.roles), updatedAt: now };
      updates.appleJobRanking = ranking;
    }
    record.cleanup = { completedAt: now, inventoryReadCompletedAt: record.inventoryReadCompletedAt };
    updates[APPLE_WITHDRAWAL_WORKFLOW_KEY] = journal;
    return updates;
  });
  return { jobId, batchId, requestId, outcome: "inactive", cleanupConfirmed: true, proofVersion: 3, alreadyFinalized };
}
