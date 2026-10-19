// Passive checks read the existing Active page only. Pagination and recovery
// reconciliation remain part of explicitly authorized workflows.
let appleWithdrawalBatchUntil = 0;
let appleWithdrawalBatchId = null;

async function observeAppleSubmission(message, sender) {
  if (!sender.tab || !/^https:\/\/jobs\.apple\.com\/[^/]+\/details\//i.test(sender.tab.url || "")) return { ok: false };
  const jobId = getJobIdFromUrl(sender.tab.url);
  if (!jobId || CareerPeelerRanking.idOf(jobId) !== CareerPeelerRanking.idOf(message.jobId)) return { ok: false };
  const recovery = await CareerPeelerJobStore.getMetadata(APPLE_WORKFLOW_KEY);
  if (Object.values(recovery?.jobs || {}).some(job =>
    CareerPeelerRanking.idOf(job.jobId) === CareerPeelerRanking.idOf(jobId) &&
    (job.state === "uncertain" || job.submissionOutcome === "unknown"))) {
    // A passive, unbound Submitted label cannot resolve a pending final action
    // or release its reservation. Use the explicit exact-job recovery check.
    return { ok: true, deferred: true };
  }
  if (Date.now() < appleWithdrawalBatchUntil) return { ok: true, deferred: true };
  if (scanState.running || appleRankingIsRunning() || submittedRoleAnalysisRuns.size) {
    const ownJob = appleRankingActiveRun?.currentJobId || scanState.currentJob?.jobId;
    if (ownJob && CareerPeelerRanking.idOf(ownJob) === CareerPeelerRanking.idOf(jobId)) return { ok: true, deferred: true };
    const existing = Object.values(appliedJobLedger).some(job => job.site === "apple" && CareerPeelerRanking.idOf(job.jobId) === CareerPeelerRanking.idOf(jobId));
    if (!existing) {
      rememberAppliedJob({ site: "apple", siteLabel: "Apple Careers", jobId, title: String(message.title || "").slice(0, 300),
        url: sender.tab.url, appliedAt: new Date().toISOString(), source: "observed_submission" }, "applied");
      await saveScanState();
    }
    return { ok: true };
  }
  appleRankingActiveRun = { syncing: true };
  try {
    const state = await readAppleRankingState();
    const id = CareerPeelerRanking.idOf(jobId);
    if (!(state.withdrawnIds || []).includes(id)) {
      const existing = Object.values(appliedJobLedger).find(job => job.site === "apple" && CareerPeelerRanking.idOf(job.jobId) === id);
      if (!existing) {
        rememberAppliedJob({ site: "apple", siteLabel: "Apple Careers", jobId, title: String(message.title || "").slice(0, 300),
          url: sender.tab.url, appliedAt: new Date().toISOString(), source: "observed_submission" }, "applied");
        await saveScanState();
      }
      if (state.jobs[id]) state.jobs[id].queueStatus = "submitted";
      if (state.applicationFailures[id]) {
        state.applicationFailures[id].status = "submitted";
        state.applicationFailures[id].resolvedAt = Date.now();
      }
      state.reservations = (state.reservations || []).filter(item => CareerPeelerRanking.idOf(item.jobId) !== id);
      await saveAppleRankingState(state, { jobs: state.jobs[id] ? [id] : [], applicationFailures: state.applicationFailures[id] ? [id] : [] });
    }
    return { ok: true };
  } finally { appleRankingActiveRun = null; }
}

const APPLE_SUBMISSION_SYNC_STATUS_KEY = "appleSubmissionSyncStatus";
const APPLE_PASSIVE_SYNC_INTERVAL = 60000;
let appleSubmissionSyncInFlight = false;
let applePassiveSyncRunning = false;

async function readAppleSubmissionSyncStatus() {
  return (await chrome.storage.local.get(APPLE_SUBMISSION_SYNC_STATUS_KEY))[APPLE_SUBMISSION_SYNC_STATUS_KEY] || {};
}

async function setAppleSubmissionSyncStatus(patch, shouldWrite = null) {
  const previous = await readAppleSubmissionSyncStatus();
  if (shouldWrite && !shouldWrite()) return previous;
  const status = { ...previous, ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ [APPLE_SUBMISSION_SYNC_STATUS_KEY]: status });
  return status;
}

async function completeAppleSubmissionSync(inventory, { recoveryWarning = null, tabId = null } = {}) {
  if (inventory.complete !== true || !["confirmed", "confirmed_empty"].includes(inventory.inventoryState)) {
    throw new Error("Submission synchronization requires a verified complete inventory.");
  }
  const now = Date.now();
  await setAppleSubmissionSyncStatus({ state: "synced", reason: null, message: null,
    lastSuccessAt: now, lastAttemptAt: now,
    ...(Number.isInteger(tabId) ? { lastAttemptTabId: tabId } : {}),
    lastVerifiedCount: inventory.roles.length, recoveryWarning });
}

async function deferAppleSubmissionSync(reason, message) {
  const status = await readAppleSubmissionSyncStatus();
  if (status.state !== "deferred" || status.reason !== reason) {
    await setAppleSubmissionSyncStatus({ state: "deferred", reason, message }, () => {
      // Restoring the user's page can notify us before analysis releases its
      // ownership. It must not replace that analysis's verified sync result.
      return reason !== "workflow" || scanState.running || appleRankingIsRunning() || !submittedRoleAnalysisRuns.size ||
        !Array.from(submittedRoleAnalysisRuns.values()).every(run => run.inventoryVerified === true);
    });
  }
  return { ok: true, deferred: true };
}

async function recoverAppleSubmissionSync() {
  const status = await readAppleSubmissionSyncStatus();
  if (status.state !== "syncing") return;
  const state = await readAppleRankingState();
  state.capacitySnapshot = { ...state.capacitySnapshot, complete: false, inventoryState: "unknown",
    updatedAt: Date.now(), warning: "Synchronization was interrupted. Retry to verify capacity." };
  await saveAppleRankingState(state, { jobs: [], applicationFailures: [] });
  await setAppleSubmissionSyncStatus({ state: "failed", reason: "interrupted",
    message: "Synchronization was interrupted. Retry to verify capacity." });
}

async function passivelySyncAppleSubmissions(tab, signature = null) {
  if (!tab?.id || tab.active === false || !/^https:\/\/jobs\.apple\.com\/app\/[^/]+\/profile\/roles\/?(?:[?#]|$)/i.test(tab.url || "")) return { ok: true, ignored: true };
  if (appleSubmissionSyncInFlight || applePassiveSyncRunning) return { ok: true, coalesced: true };
  if (scanState.running || appleRankingIsRunning() || submittedRoleAnalysisRuns.size) {
    return deferAppleSubmissionSync("workflow", "Another workflow is running. Automatic sync will check again when you return to Active Submissions.");
  }
  const run = { syncing: true, sourceTabId: tab.id };
  applePassiveSyncRunning = true;
  appleRankingActiveRun = run;
  try {
    const recovery = await CareerPeelerJobStore.getMetadata(APPLE_WORKFLOW_KEY);
    if (recovery?.reconciliationRequired || recovery?.status === "running") {
      return await deferAppleSubmissionSync("recovery", "An application needs reconciliation. Use Sync Submissions to review the complete inventory.");
    }
    const status = await readAppleSubmissionSyncStatus();
    if (status.lastAttemptTabId === tab.id && Date.now() - Number(status.lastAttemptAt || 0) < APPLE_PASSIVE_SYNC_INTERVAL &&
      !(status.state === "failed" && signature && signature !== status.lastFailedReadySignature) &&
      status.reason !== "workflow") return { ok: true, skipped: true };
    return await refreshAppleQueueCapacity(await readAppleRankingState(), tab.windowId, tab.id, { passive: true });
  } catch (error) {
    await setAppleSubmissionSyncStatus({ state: "failed", reason: "read_failed", message: error.message,
      lastAttemptAt: Date.now(), lastAttemptTabId: tab.id, lastFailedReadySignature: signature || null }).catch(console.error);
    return { ok: false, error: error.message };
  } finally {
    if (appleRankingActiveRun === run) appleRankingActiveRun = null;
    applePassiveSyncRunning = false;
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => appleWorkflowReady.then(async () => {
  await passivelySyncAppleSubmissions(await chrome.tabs.get(tabId));
}).catch(() => {}));
chrome.tabs.onUpdated.addListener((_tabId, changes, tab) => {
  if (changes.url || changes.status === "complete") {
    return appleWorkflowReady.then(() => passivelySyncAppleSubmissions(tab)).catch(() => {});
  }
});
