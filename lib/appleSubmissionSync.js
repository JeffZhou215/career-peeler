// Passive checks never interrupt ranking, application, or withdrawal workflows.
let appleWithdrawalBatchUntil = 0;
let appleWithdrawalBatchId = null;
let lastPassiveSubmissionSync = 0;

async function observeAppleSubmission(message, sender) {
  if (!sender.tab || !/^https:\/\/jobs\.apple\.com\/[^/]+\/details\//i.test(sender.tab.url || "")) return { ok: false };
  const jobId = getJobIdFromUrl(sender.tab.url);
  if (!jobId || CareerPeelerRanking.idOf(jobId) !== CareerPeelerRanking.idOf(message.jobId)) return { ok: false };
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
      await saveAppleRankingState(state);
    }
    lastPassiveSubmissionSync = 0;
    return { ok: true };
  } finally { appleRankingActiveRun = null; }
}

async function passivelySyncAppleSubmissions(tab, { confirmed = false } = {}) {
  if (confirmed) lastPassiveSubmissionSync = 0;
  if (!tab?.id || (!confirmed && !/^https:\/\/jobs\.apple\.com\/app\/[^/]+\/profile\/roles\/?(?:[?#]|$)/i.test(tab.url || "")) || getSiteConfig(tab.url)?.id !== "apple") return;
  if (Date.now() - lastPassiveSubmissionSync < 60000 || scanState.running || appleRankingIsRunning() ||
    submittedRoleAnalysisRuns.size || Date.now() < appleWithdrawalBatchUntil) return;
  lastPassiveSubmissionSync = Date.now();
  appleRankingActiveRun = { syncing: true };
  try {
    const state = await readAppleRankingState();
    await refreshAppleQueueCapacity(state, await getTaskWindowId(tab), { passive: true });
  } catch (error) {
    console.debug("Apple submission count could not be refreshed:", error.message);
  } finally { appleRankingActiveRun = null; }
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  scanStateReady.then(async () => passivelySyncAppleSubmissions(await chrome.tabs.get(tabId))).catch(() => {});
});
