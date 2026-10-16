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
