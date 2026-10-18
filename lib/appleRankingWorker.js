// Loaded as a classic service-worker script after core.js and jobRanking.js.
const APPLE_JOB_RANKING_KEY = "appleJobRanking";
const APPLE_JOB_RANKING_WRITE_FAILURE_KEY = "appleJobRankingWriteFailure";
let appleRankingWriteFailure = null;
let appleRankingActiveRun = null;
let appleRankingScanSequence = 0;
function appleRankingIsRunning() { return Boolean(appleRankingActiveRun) || Date.now() < appleWithdrawalBatchUntil; }

function appleRankingSearchUrl(value) {
  const url = new URL(value);
  if (url.origin !== "https://jobs.apple.com" || !/^\/[a-z]{2}-[a-z]{2}\/search\/?$/i.test(url.pathname)) {
    throw new Error("The filtered Apple search identity could not be verified.");
  }
  url.searchParams.delete("page");
  url.searchParams.sort();
  url.pathname = url.pathname.toLowerCase().replace(/\/$/, "");
  url.hash = "";
  return url.href;
}

function latestAppleRankingSearch(state) {
  return state.searches[state.latestSearchKey] || Object.values(state.searches)
    .sort((a, b) => b.startedAt - a.startedAt)[0] || null;
}

function appleRankingDiscovery(job, search, observedIds = null) {
  const identified = Boolean(search?.scanId && Array.isArray(search.discoveredJobIds));
  const observed = identified && (observedIds ? observedIds.has(String(job.jobId)) : search.discoveredJobIds.includes(String(job.jobId)));
  const complete = identified && search.complete === true;
  // Absence from a partial/legacy scan proves nothing about filter membership,
  // and absence from a complete filter does not prove the posting is closed.
  return { discoveryStatus: observed ? "current_scan" : complete ? "historical_cache" : "unknown",
    filterMembership: observed ? "observed" : complete ? "absent" : "unknown",
    discoveryScanId: search?.scanId || null };
}

function appleAutoApplyJobs(state, run, profileSignature) {
  const scope = run.autoScope;
  const search = scope && state.searches[scope.searchKey];
  if (!scope || search?.complete !== true || !search.scanId || search.scanId !== scope.scanId || search.profileSignature !== profileSignature ||
    state.latestSearchKey !== scope.searchKey || !Array.isArray(search.discoveredJobIds) ||
    !Array.isArray(search.autoApplyJobIds) ||
    appleRankingSearchUrl(search.url) !== appleRankingSearchUrl(run.searchUrl) ||
    typeof run.autoJobIds?.has !== "function") {
    throw new Error("The automatic application scope is no longer a verified completed scan. Scan And Rank the intended filter again.");
  }
  const discovered = new Set(search.discoveredJobIds);
  const planned = new Set(search.autoApplyJobIds);
  return Object.values(state.jobs).filter(job => job.profileSignature === profileSignature && job.eligible &&
    discovered.has(String(job.jobId)) && planned.has(String(job.jobId)) && run.autoJobIds.has(String(job.jobId)) &&
    job.autoQueuedFrom?.scanId === scope.scanId && job.autoQueuedFrom?.searchKey === scope.searchKey);
}

function appleRankingProfileSignature(profile) {
  return fingerprintText(JSON.stringify({ resume: resolveResumeProfileText(profile),
    years: profile.userYearsOfExperience, model: profile.llmModel,
    version: CareerPeelerRanking.VERSION }));
}

async function readAppleRankingState() {
  const stored = await CareerPeelerJobStore.get(APPLE_JOB_RANKING_KEY);
  const state = stored[APPLE_JOB_RANKING_KEY] || { version: 1, jobs: {}, searches: {}, reservations: [] };
  state.applicationFailures ||= {};
  // Make jobs from older interrupted queues visible without asking for a rescan.
  const legacyJobs = Object.values(state.jobs || {}).filter((job) => ["uncertain", "needs_review"].includes(job.queueStatus) ||
    (job.queueStatus === "applying" && appleRankingActiveRun?.currentJobId !== CareerPeelerRanking.idOf(job.jobId)));
  const legacyUncertain = legacyJobs.filter((job) => ["uncertain", "applying"].includes(job.queueStatus));
  for (const job of legacyJobs) {
    const id = CareerPeelerRanking.idOf(job.jobId);
    if (state.applicationFailures[id]) continue;
    const unknown = ["uncertain", "applying"].includes(job.queueStatus);
    state.applicationFailures[id] = { jobId: job.jobId, title: job.title, url: job.url,
      reason: unknown ? legacyUncertain.length === 1 && state.error && /Application queue paused/i.test(state.phase || "") ? state.error
        : "The previous run did not confirm this application. Check Apple Your Roles before retrying."
        : job.reason || "This application needs manual review.",
      errorType: unknown ? "submission_unconfirmed" : "manual_review_required",
      submissionOutcomeUnknown: unknown, status: unknown ? "uncertain" : job.queueStatus,
      failedAt: state.updatedAt || Date.now(), legacy: true };
  }
  return state;
}

async function saveAppleRankingState(state, changedFields = null) {
  try {
    const saved = { ...state, updatedAt: Date.now() };
    if (changedFields) await CareerPeelerJobStore.patch(APPLE_JOB_RANKING_KEY, saved, changedFields);
    else await CareerPeelerJobStore.set({ [APPLE_JOB_RANKING_KEY]: saved });
  } catch (failure) {
    const message = /quota|kQuotaBytes/i.test(failure?.message || "")
      ? "The job database could not save more data. Check available disk space, then Resume Scan. Previously saved scores are still available."
      : `The scan could not save its progress: ${failure?.message || "Job database write failed."} Previously saved scores are still available.`;
    // A full database cannot hold its own error. Keep a small independent status
    // in session storage so worker restarts do not disguise this as a finished scan.
    const phase = /Applying|Application queue|Checking Apple submission/i.test(state.phase || "")
      ? "Application queue paused; progress could not be saved" : "Ranking paused; progress could not be saved";
    appleRankingWriteFailure = { error: message, running: false, phase,
      currentJob: state.currentJob || null, updatedAt: Date.now() };
    await chrome.storage.session.set({ [APPLE_JOB_RANKING_WRITE_FAILURE_KEY]: appleRankingWriteFailure }).catch(console.error);
    throw new Error(message);
  }
  appleRankingWriteFailure = null;
  await chrome.storage.session.remove(APPLE_JOB_RANKING_WRITE_FAILURE_KEY).catch(console.error);
}

function revalidateAppleRankingJob(job, details, profile) {
  if (!job.breakdown || !details || job.evaluationVersion === CareerPeelerRanking.EVALUATION_VERSION ||
    job.postingSignature !== fingerprintText(JSON.stringify(CareerPeelerRanking.postingInput(details)))) return job;
  try {
    return { ...job, ...CareerPeelerRanking.evaluateRankingResult({ ...job.breakdown,
      minimum_checks: job.minimumChecks, evidence: job.evidenceChecks || job.evidence,
      confidence: job.confidence, reason: job.reason }, details, resolveResumeProfileText(profile)) };
  } catch (_error) { return job; }
}

// Bind acknowledgement to the actual saved assessment, not a persistent permission
// to override future matching results or a changed resume/posting.
function appleQueuedJobReviewSignature(job) {
  return fingerprintText(JSON.stringify({ jobId: CareerPeelerRanking.idOf(job.jobId),
    profileSignature: job.profileSignature, postingSignature: job.postingSignature,
    score: job.score, eligible: job.eligible, breakdown: job.breakdown,
    blockers: job.blockers, minimumChecks: job.minimumChecks,
    evidence: job.evidence, confidence: job.confidence, reason: job.reason }));
}

function appleQueueReviewToken(queued) {
  const concerns = queued.filter((job) => !job.eligible);
  return concerns.length ? fingerprintText(JSON.stringify(concerns.map((job) =>
    [CareerPeelerRanking.idOf(job.jobId), appleQueuedJobReviewSignature(job)]).sort((a, b) => a[0].localeCompare(b[0])))) : null;
}

function appleSelectedApplicationIds(selectedIds) {
  if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some(id => typeof id !== "string" || !id.trim())) {
    throw new Error("Select at least one role in Application Queue before applying.");
  }
  return new Set(selectedIds);
}

function appleSelectedApplicationBatch(queued, selectedIds) {
  const ids = appleSelectedApplicationIds(selectedIds);
  const jobs = queued.filter(job => ids.has(String(job.jobId)));
  if (jobs.length !== ids.size) throw new Error("Some selected roles are no longer queued for your current resume. Review your selection again.");
  return { jobs, reviewCount: jobs.filter(job => !job.eligible).length,
    reviewToken: appleQueueReviewToken(jobs),
    batchToken: fingerprintText(JSON.stringify(jobs.map(job =>
      [String(job.jobId), appleQueuedJobReviewSignature(job)]).sort((a, b) => a[0].localeCompare(b[0])))) };
}

async function prepareAppleApplicationBatch(userProfile, selectedIds, tab = null, reviewRequestId = null) {
  if (scanState.running || appleRankingIsRunning() || submittedRoleAnalysisRuns.size) return { ok: false, error: "Stop the current run before reviewing an application batch." };
  const profile = normalizeUserProfile(userProfile);
  const run = { editing: true, stopRequested: false, sourceTabId: tab?.id,
    reviewRequestId: typeof reviewRequestId === "string" && reviewRequestId ? reviewRequestId : null };
  appleRankingActiveRun = run;
  let state;
  let checkingRecovery = false;
  let reconciliationPerformed = false;
  const assertNotStopped = () => {
    if (run.stopRequested) throw Object.assign(new Error("The application check was stopped. Review your selection before trying again."), { code: "stopped_by_user" });
  };
  try {
    appleSelectedApplicationIds(selectedIds);
    const journal = await CareerPeelerJobStore.getMetadata(APPLE_WORKFLOW_KEY);
    assertNotStopped();
    if (journal?.reconciliationRequired) {
      checkingRecovery = true;
      if (!tab?.id || getSiteConfig(tab.url)?.id !== "apple") {
        throw Object.assign(new Error("Open Apple Careers so the previous applications can be checked, then Retry Check."),
          { code: "recovery_tab_required" });
      }
      run.sourceWindowId = await getTaskWindowId(tab);
      assertNotStopped();
      run.releaseWorkerActivity = startAppleApplicationWorkerActivity(run);
      state = await readAppleRankingState();
      state.running = true;
      state.phase = "Checking Apple submission capacity";
      await saveAppleRankingState(state, {});
      assertNotStopped();
      // Reconcile the old owner before claiming a new batch. This read cannot
      // grant permission to replay its pending Submit or start the selected jobs.
      const sync = await refreshAppleQueueCapacity(state, run.sourceWindowId, run.sourceTabId);
      assertNotStopped();
      if ((await CareerPeelerJobStore.getMetadata(APPLE_WORKFLOW_KEY))?.reconciliationRequired) {
        throw appleWorkflowError(sync.recoveryWarning?.message || "The previous application still needs review on Apple Careers. Automatic applications remain paused.");
      }
      reconciliationPerformed = true;
      checkingRecovery = false;
      state.error = null;
      state.errorType = null;
      state.errorJobId = null;
      state.currentJob = null;
      state.phase = "Previous applications checked; review selected batch";
    }
    assertNotStopped();
    const outstanding = await CareerPeelerJobStore.getMetadata(APPLE_WORKFLOW_KEY);
    if (selectedIds.some(id => outstanding?.jobs?.[String(id)]?.state === "uncertain")) {
      throw Object.assign(new Error("A selected role still has an unknown Submit outcome. Review it on Apple Careers and select other queued roles; a verified absence does not authorize resubmitting it."),
        { code: "submission_outcome_unknown" });
    }
    const batch = await readAppleSelectedApplicationBatch(profile, selectedIds);
    return { ok: true, data: { ...batch, reconciliationPerformed } };
  } catch (failure) {
    const error = failure?.message || "The application batch could not be checked.";
    const errorType = failure?.code || (checkingRecovery ? "submission_sync_failed" : "batch_review_failed");
    if (state) { state.error = error; state.errorType = errorType; state.phase = "Application queue check paused"; }
    return { ok: false, error, errorType };
  } finally {
    run.releaseWorkerActivity?.();
    if (state) {
      state.running = false;
      await saveAppleRankingState(state, {}).catch(console.error);
    }
    appleRankingActiveRun = null;
  }
}

async function readAppleSelectedApplicationBatch(profile, selectedIds) {
  const ids = [...appleSelectedApplicationIds(selectedIds)];
  // Confirming a handful of roles must not deserialize every saved ranking.
  const [metadata, records, stored] = await Promise.all([
    CareerPeelerJobStore.getMetadata(APPLE_JOB_RANKING_KEY),
    CareerPeelerJobStore.getRecords(APPLE_JOB_RANKING_KEY, ids.map(CareerPeelerRanking.idOf), "jobs"),
    CareerPeelerJobStore.get([APPLE_SUBMITTED_ROLE_REVIEWS_KEY, APPLIED_JOBS_KEY])
  ]);
  const state = metadata || {};
  const signature = appleRankingProfileSignature(profile);
  const jobs = Object.values(records).filter(job => job.profileSignature === signature && job.queueStatus === "queued");
  const cache = await CareerPeelerJobStore.getRecords(APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY,
    jobs.filter(job => job.breakdown && job.evaluationVersion !== CareerPeelerRanking.EVALUATION_VERSION)
      .flatMap(job => [CareerPeelerRanking.idOf(job.jobId), String(job.jobId)]));
  const current = jobs.map(job => revalidateAppleRankingJob(job,
    cache[CareerPeelerRanking.idOf(job.jobId)] || cache[String(job.jobId)], profile));
  const excluded = [...Object.values(stored[APPLIED_JOBS_KEY] || {}).filter(job => job.site === "apple").map(job => job.jobId), ...(state.withdrawnIds || [])];
  const queued = CareerPeelerRanking.rankedCandidates(current, ids.length, 0, excluded);
  return { ...appleSelectedApplicationBatch(queued, ids), capacity: await appleRankingCapacity(state, stored) };
}

function appleRecoveryOperationIdentity(journal, job) {
  return JSON.stringify([journal.id, journal.owner, journal.stopRequested, job?.jobId,
    job?.workflowSessionId, job?.stepId, job?.submitAuthorizedStep, job?.submitIntentAt,
    job?.submissionAttemptCount, job?.submissionOutcome, job?.state]);
}

async function checkInterruptedAppleApplication({ workflowSessionId, jobId, tab: sourceTab }) {
  if (scanState.running || appleRankingIsRunning() || submittedRoleAnalysisRuns.size || appleSubmissionSyncInFlight) {
    return { ok: false, error: "Stop the current workflow before checking an interrupted application." };
  }
  const run = { editing: true, stopRequested: false };
  appleRankingActiveRun = run;
  const cancelGeneration = appleWorkflowCancelGeneration;
  let state;
  const assertCurrent = () => {
    if (run.stopRequested || cancelGeneration !== appleWorkflowCancelGeneration) {
      throw appleWorkflowError("The application status check was stopped. No application was resumed.", "stopped_by_user");
    }
  };
  try {
    const original = await CareerPeelerJobStore.getMetadata(APPLE_WORKFLOW_KEY);
    const selected = original?.jobs?.[String(jobId)];
    if (!original?.id || original.id !== workflowSessionId || !selected ||
        original.status === "running" || !CareerPeelerApplicationSafety.matchesJob(jobId, selected.url)) {
      throw appleWorkflowError("The interrupted application changed. Refresh the panel and review the current role.", "job_identity_mismatch");
    }
    const source = sourceTab?.id && await chrome.tabs.get(sourceTab.id);
    if (!source || getSiteConfig(source.url)?.id !== "apple") {
      throw appleWorkflowError("Open Apple Careers, then check the interrupted application again.", "recovery_tab_required");
    }
    run.sourceTabId = source.id;
    run.sourceWindowId = await getTaskWindowId(source);
    run.releaseWorkerActivity = startAppleApplicationWorkerActivity(run);
    assertCurrent();
    await quiesceRecoveredAppleWorkflow();
    assertCurrent();
    state = await readAppleRankingState();
    // A fresh complete inventory may itself reconcile the exact job. It also
    // provides authenticated account/capacity evidence before a detail read.
    await refreshAppleQueueCapacity(state, run.sourceWindowId, source.id);
    assertCurrent();
    const journal = await CareerPeelerJobStore.getMetadata(APPLE_WORKFLOW_KEY);
    const job = journal?.jobs?.[String(jobId)];
    if (journal?.id !== workflowSessionId || !job || journal.status === "running") {
      throw appleWorkflowError("The interrupted workflow changed during the check. Review it again.");
    }
    if (job.state !== "uncertain" && job.submissionOutcome !== "unknown") {
      if (!journal.reconciliationRequired) {
        state.error = null; state.errorType = null; state.errorJobId = null; state.currentJob = null;
        state.phase = "Previous application checked; review a new batch";
        await saveAppleRankingState(state, {});
      }
      return { ok: true, data: { resolved: !journal.reconciliationRequired,
        message: journal.reconciliationRequired ? "This application is checked. Another interrupted application still needs review."
          : "Previous application checked. Review and confirm a new batch to continue; no applications resumed." } };
    }
    const identity = appleRecoveryOperationIdentity(journal, job);
    const tabs = await chrome.tabs.query({ windowId: run.sourceWindowId });
    const isDetail = tab => CareerPeelerApplicationSafety.matchesJob(jobId, tab.url) &&
      getSiteConfig(tab.url)?.isJobDetailUrl(new URL(tab.url));
    const exactTab = tabs.find(tab => tab.id === source.id && isDetail(tab)) || tabs.find(isDetail);
    if (!exactTab) return { ok: true, data: { resolved: false,
      message: "Open the reviewed job link, then Check Application Status again. No application will be submitted by this check." } };
    const requestId = `${appleWorkerOwner}-recovery-${++appleRankingScanSequence}`;
    const startedAt = Date.now();
    // Only refresh a detail page explicitly selected for this check, never an
    // application form. A newly loaded document must attest to its own freshness.
    await chrome.tabs.reload(exactTab.id, { bypassCache: true });
    await waitForTabComplete(exactTab.id);
    assertCurrent();
    const response = await sendMessageWithFallback(exactTab.id, {
      type: "APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS", expectedJobId: String(jobId), requestId, notBefore: startedAt });
    assertCurrent();
    const liveTab = await chrome.tabs.get(exactTab.id);
    const proof = response?.data;
    if (!response?.ok || proof?.requestId !== requestId || proof.identityVerified !== true ||
        proof.jobId !== String(jobId) || !CareerPeelerApplicationSafety.matchesJob(jobId, proof.url) ||
        !CareerPeelerApplicationSafety.matchesJob(jobId, liveTab.url) ||
        liveTab.windowId !== run.sourceWindowId || proof.observedAt < startedAt ||
        !Number.isFinite(proof.observedAt) || proof.observedAt > Date.now() ||
        !Number.isFinite(proof.documentStartedAt) || proof.documentStartedAt < startedAt || proof.documentStartedAt > proof.observedAt) {
      throw appleWorkflowError(response?.error || "The exact reviewed job page could not be verified. Automatic applications remain paused.", "job_identity_unverified");
    }
    if (proof.submissionOutcome !== "confirmed" || proof.proof !== "job_identified_submission" ||
        proof.signal?.jobId !== String(jobId)) {
      return { ok: true, data: { resolved: false,
        message: journal.reconciliationRequired
          ? "Apple did not provide submission confirmation identifying this exact job. The outcome stays unknown and automatic applications remain paused. A generic Submitted label or Apply button cannot safely clear it."
          : "The complete Active inventory was checked, but this role's Submit outcome remains unknown. This role cannot be retried. Other queued roles can be reviewed in a new batch." } };
    }
    await CareerPeelerJobStore.updateMetadata(APPLE_WORKFLOW_KEY, current => {
      assertCurrent();
      const pending = current?.jobs?.[String(jobId)];
      if (!current || !pending || appleRecoveryOperationIdentity(current, pending) !== identity || current.status === "running") {
        throw appleWorkflowError("The interrupted application changed while its status was checked. No recovery state was replaced.");
      }
      pending.state = "submitted";
      pending.submissionOutcome = "confirmed";
      pending.stepPending = false;
      pending.resultAt = Date.now();
      pending.recoveryProof = { kind: proof.proof, requestId, observedAt: proof.observedAt, url: proof.url };
      // Do not clear the session gate or release reservations here. The next
      // complete inventory reconciles every remaining operation independently.
      return current;
    });
    await refreshAppleQueueCapacity(state, run.sourceWindowId, source.id);
    assertCurrent();
    const remaining = await CareerPeelerJobStore.getMetadata(APPLE_WORKFLOW_KEY);
    if (!remaining.reconciliationRequired) {
      state.error = null; state.errorType = null; state.errorJobId = null; state.currentJob = null;
      state.phase = "Previous application confirmed; review a new batch";
      await saveAppleRankingState(state, {});
    }
    return { ok: true, data: { resolved: !remaining.reconciliationRequired,
      message: remaining.reconciliationRequired ? "This submission is confirmed. Another interrupted application still needs review."
        : "The interrupted submission is confirmed. Review and confirm a new batch to continue; no applications resumed." } };
  } catch (error) {
    return { ok: false, error: error.message, errorType: error.code || "recovery_check_failed" };
  } finally {
    run.releaseWorkerActivity?.();
    if (appleRankingActiveRun === run) appleRankingActiveRun = null;
  }
}

function appleQueueFailureDisposition(result, workflowInvoked = false) {
  const data = result?.data || {};
  const reason = result?.error || data.summary || "The application workflow did not finish.";
  const errorType = data.errorType || "apply_failed";
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const submitClicked = data.submissionAttempted === true || steps.some((step) =>
    step.step === "Submit application" && step.status === "clicked");
  const unknown = errorType === "clicked_but_unconfirmed" || (typeof data.submissionOutcomeUnknown === "boolean"
    ? data.submissionOutcomeUnknown
    : submitClicked ? !data.submissionRejected
      : typeof data.submissionAttempted === "boolean" || Array.isArray(data.steps) ? false : workflowInvoked);
  const systemic = ["session_or_login_required", "career_window_unavailable", "job_identity_mismatch", "job_identity_unverified",
    "workflow_recovery_required", "workflow_owner_conflict", "workflow_owner_revoked"].includes(errorType) ||
    /\bsign[ -]?in\b|\blog[ -]?in\b|\bsession.{0,30}(expired|required)|insufficient_quota|API.{0,30}(credits|key)|rate.limit|\b429\b/i.test(reason);
  return { reason, errorType, unknown, pauseQueue: unknown || systemic,
    lastStep: steps.at(-1)?.step || data.attempts?.at(-1)?.heading || null };
}

async function recordAppleQueueFailure(state, job, result, disposition, stage) {
  const id = CareerPeelerRanking.idOf(job.jobId);
  const prior = state.applicationFailures[id];
  job.queueStatus = disposition.unknown ? "uncertain" : "needs_review";
  const record = { jobId: job.jobId, title: job.title, url: job.url,
    reason: String(disposition.reason).slice(0, 2000), errorType: disposition.errorType,
    lastStep: disposition.lastStep || stage, failedAt: Date.now(), status: job.queueStatus,
    submissionOutcomeUnknown: disposition.unknown, attempts: (prior?.attempts || 0) + 1,
    applicationHeading: result?.data?.attempts?.at(-1)?.heading || null,
    visibleActions: result?.data?.attempts?.at(-1)?.visibleActions || [] };
  state.applicationFailures[id] = record;
  state.lastFailureJobId = job.jobId;
  if (!disposition.unknown) state.reservations = (state.reservations || []).filter((item) =>
    CareerPeelerRanking.idOf(item.jobId) !== id);
  await saveAppleRankingState(state, { jobs: [id], applicationFailures: [id] });
  // Keep the existing Activity And Advanced Tools error ledger useful as well.
  if (typeof rememberError === "function") {
    rememberError({ ...record, site: "apple", siteLabel: "Apple Careers", message: record.reason,
      type: record.errorType, status: "ranked_queue_apply_failed", workflow: result?.data });
    scanState.stats.errors += 1;
    scanState.stats.needsReview += 1;
    await saveScanState();
  }
  return record;
}

async function appleRankingCapacity(state, stored = null) {
  stored ||= await CareerPeelerJobStore.get([APPLE_SUBMITTED_ROLE_REVIEWS_KEY, APPLIED_JOBS_KEY]);
  const archive = stored[APPLE_SUBMITTED_ROLE_REVIEWS_KEY];
  const saved = archive?.latestScan?.complete ? archive.latestScan : archive?.lastCompleteScan;
  const snapshot = state.capacitySnapshot && (state.capacitySnapshot.inventoryState === "unknown" ||
    !saved || state.capacitySnapshot.updatedAt >= saved.updatedAt)
    ? state.capacitySnapshot : saved;
  return CareerPeelerRanking.applicationCapacity(snapshot, Object.values(stored[APPLIED_JOBS_KEY] || {}),
    state.reservations || [], state.withdrawnIds || []);
}

async function getAppleRankingView(userProfile, topN = null) {
  const state = await readAppleRankingState();
  const recovery = await CareerPeelerJobStore.getMetadata(APPLE_WORKFLOW_KEY);
  const syncStatus = await readAppleSubmissionSyncStatus();
  const session = await chrome.storage.session.get(APPLE_JOB_RANKING_WRITE_FAILURE_KEY);
  const writeFailure = appleRankingWriteFailure || session[APPLE_JOB_RANKING_WRITE_FAILURE_KEY];
  const storageFailure = writeFailure && writeFailure.updatedAt >= Number(state.updatedAt || 0) ? writeFailure : null;
  const profile = normalizeUserProfile(userProfile || (await CareerPeelerJobStore.get(USER_PROFILE_KEY))[USER_PROFILE_KEY]);
  const profileSignature = appleRankingProfileSignature(profile);
  const capacity = await appleRankingCapacity(state);
  topN = Math.min(1000, Math.max(1, Number(topN) > 0 && Number.isFinite(Number(topN))
    ? Math.floor(Number(topN)) : capacity.remaining || 50));
  const jobs = Object.values(state.jobs || {});
  const latestSearch = latestAppleRankingSearch(state);
  const observedIds = new Set(latestSearch?.discoveredJobIds || []);
  const profileJobs = jobs.filter(job => job.profileSignature === profileSignature)
    .map(job => ({ ...job, ...appleRankingDiscovery(job, latestSearch, observedIds) }));
  const recheckIds = profileJobs.filter(job => job.breakdown && job.evaluationVersion !== CareerPeelerRanking.EVALUATION_VERSION)
    .flatMap(job => [CareerPeelerRanking.idOf(job.jobId), String(job.jobId)]);
  const cache = await CareerPeelerJobStore.getRecords(APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY, recheckIds);
  const current = profileJobs.map((job) =>
    revalidateAppleRankingJob(job, cache[CareerPeelerRanking.idOf(job.jobId)] || cache[String(job.jobId)], profile));
  const stored = await CareerPeelerJobStore.get(APPLIED_JOBS_KEY);
  const excluded = [...Object.values(stored[APPLIED_JOBS_KEY] || {}).filter((job) => job.site === "apple").map((job) => job.jobId),
    ...(state.withdrawnIds || [])];
  const excludedIds = new Set(excluded.map(CareerPeelerRanking.idOf));
  const queueable = CareerPeelerRanking.rankedCandidates(current, current.length || 1, 0, excluded);
  const queued = queueable.filter((job) => job.queueStatus === "queued");
  // Queued jobs have their own list; they must not consume the ranked shortlist.
  const ranked = queueable.filter((job) => job.queueStatus !== "queued").slice(0, topN);
  const applicationFailures = Object.values(state.applicationFailures).sort((a, b) => b.failedAt - a.failedAt);
  const legacyErrors = Object.values(errorJobLedger);
  for (const failure of applicationFailures) {
    if (failure.applicationHeading) continue;
    const savedError = legacyErrors.find(error => error.site === "apple" && CareerPeelerRanking.idOf(error.jobId) === CareerPeelerRanking.idOf(failure.jobId));
    const attempt = savedError?.lastAttempt || savedError?.workflow?.attempts?.at(-1);
    if (attempt) failure.applicationHeading = attempt.heading || null;
  }
  const errorJob = state.errorJobId ? state.jobs?.[CareerPeelerRanking.idOf(state.errorJobId)]
    || state.applicationFailures[CareerPeelerRanking.idOf(state.errorJobId)]
    : state.error && /Application queue paused/i.test(state.phase || "") && applicationFailures.filter((job) => job.status === "uncertain").length === 1
      ? applicationFailures.find((job) => job.status === "uncertain") : null;
  const recoveryJob = recovery?.reconciliationRequired && (recovery.jobs?.[syncStatus.recoveryWarning?.jobId] ||
    Object.values(recovery.jobs || {}).find(job => job.state === "uncertain") || recovery.jobs?.[recovery.currentJobId]);
  const reviewJob = recoveryJob || storageFailure?.currentJob || errorJob;
  return { ...state, ...(storageFailure || {}), jobs: undefined, capacity,
    currentJob: recoveryJob || storageFailure?.currentJob || state.currentJob,
    applicationFailures, errorJob: reviewJob ? { jobId: reviewJob.jobId, title: reviewJob.title, url: reviewJob.url } : null,
    running: appleRankingIsRunning(),
    recovered: Boolean(recovery?.recoveredAt && recovery.reconciliationRequired || state.running && !appleRankingIsRunning() && !storageFailure),
    recovery: recovery?.recoveredAt || recovery?.reconciliationRequired ? { sessionId: recovery.id, status: recovery.status, reconciliationRequired: recovery.reconciliationRequired,
      jobId: recoveryJob?.jobId || recovery.currentJobId, title: recoveryJob?.title, url: recoveryJob?.url, stopRequested: recovery.stopRequested,
      message: recovery.reconciliationRequired ? syncStatus.recoveryWarning?.message || null : null } : null,
    topN,
    latestSearch,
    candidates: ranked,
    ranked,
    queued,
    queueableCount: queueable.length,
    queueReviewCount: queued.filter((job) => !job.eligible).length,
    queueReviewToken: appleQueueReviewToken(queued),
    eligibleCount: CareerPeelerRanking.topCandidates(current, current.length || 1, 0, excluded).length,
    latestSearchStrongCount: latestSearch?.scanId && latestSearch.profileSignature === profileSignature && Array.isArray(latestSearch.discoveredJobIds)
      ? CareerPeelerRanking.topCandidates(current.filter(job => observedIds.has(String(job.jobId))), current.length || 1, 0, excluded).length : null,
    savedJobCount: jobs.length,
    excludedMatches: current.filter(job => !job.breakdown && !excludedIds.has(CareerPeelerRanking.idOf(job.jobId)))
      .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 100),
    reviewedCount: current.length,
    staleCount: jobs.length - current.length,
    staleMatches: jobs.filter(job => job.profileSignature !== profileSignature).sort((a,b) => (b.score || 0) - (a.score || 0)).slice(0, topN)
      .map(job => ({ ...job, ...appleRankingDiscovery(job, latestSearch, observedIds), stale: true, queueStatus: "stale" })),
    minimumScore: CareerPeelerRanking.MIN_SCORE };
}

function appleRankingReadiness(profile) {
  if (!profile.resumeFileDataUrl) return "Upload a PDF resume in Setup before ranking jobs.";
  if (!resolveResumeProfileText(profile)) return "Extract your uploaded PDF in Setup before ranking jobs.";
  if (!profile.llmEnabled || !hasLlmProviderConfigured(profile) || !isApiKeyValidated(profile)) {
    return "Enable AI Matching and test your OpenAI API key before ranking jobs.";
  }
  if (!isSupportedOpenAiModel(profile.llmModel)) {
    return "Choose a compatible full-size model in Setup before ranking jobs. Mini and nano models are excluded.";
  }
  if (profile.resumeFileDataUrl && !isCandidateProfileFreshForResume(profile) &&
    !(profile.resumeText?.trim() && profile.resumeTextFingerprint === fingerprintText(profile.resumeFileDataUrl))) {
    return "Extract your current resume before ranking jobs; the saved candidate profile is out of date.";
  }
  return null;
}

async function scoreAppleRankingPosting(details, profile, run) {
  const titleSkip = getHardSkipTitleReason(details.title);
  const requiredYears = Math.max(0, ...(details.requiredExperience || []).map((item) => Number(item.years) || 0));
  const hardSkip = titleSkip || (requiredYears > profile.userYearsOfExperience
    ? `Requires ${requiredYears} years; your resume setting is ${profile.userYearsOfExperience} years.` : null);
  if (hardSkip) return { score: 0, eligible: false, reason: hardSkip, blockers: [hardSkip], evidence: [] };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (run.stopRequested) throw new Error("Ranking stopped. Saved matches are available.");
    try {
      const content = await callOpenAi(CareerPeelerRanking.buildRankingPrompt(details,
        resolveResumeProfileText(profile), profile.userYearsOfExperience),
      { apiKey: profile.llmApiKey, model: profile.llmModel, temperature: 0 });
      return CareerPeelerRanking.evaluateRankingResult(parseLlmJson(content), details, resolveResumeProfileText(profile));
    } catch (error) {
      // Only temporary rate limits can be retried. Billing/quota failures need user action.
      const temporary = error.httpStatus === 429 && /^(rate_limit_exceeded|rate_limit_error|slow_down)$/.test(error.code);
      const waitMs = Math.max(error.retryAfterMs || 0, 2000 * 2 ** attempt);
      if (!temporary || attempt === 2 || waitMs > 30000) throw error;
      const deadline = Date.now() + waitMs + 250;
      while (Date.now() < deadline && !run.stopRequested) await delay(Math.min(300, deadline - Date.now()));
    }
  }
}

async function startAppleJobRanking(tab, userProfile, options = {}) {
  if (scanState.running || appleRankingIsRunning() || submittedRoleAnalysisRuns.size) return { ok: false, error: "Stop the current scan before ranking jobs." };
  const profile = normalizeUserProfile({ ...userProfile, ...(options.autoApply ? { scanMode: "auto_apply", llmEnabled: true } : {}) });
  const error = appleRankingReadiness(profile) || (options.autoApply ? getAutoApplyReadinessError(profile) || (!profile.autoApplyConsent ? "Allow automatic submission before starting Auto Apply." : null) : null);
  if (error) return { ok: false, error };
  const url = parseUrl(tab?.url);
  if (!tab?.id || url?.origin !== "https://jobs.apple.com" || !/^\/[a-z]{2}-[a-z]{2}\/search\/?$/i.test(url.pathname)) {
    return { ok: false, error: "Open an Apple jobs search with your chosen filters before ranking." };
  }
  const searchUrl = appleRankingSearchUrl(url.href);
  const run = { stopRequested: false, sourceTabId: tab.id, searchUrl, autoApply: Boolean(options.autoApply),
    topN: Math.min(1000, Math.max(1, Math.floor(Number(options.topN) || 50))), resume: Boolean(options.resume) };
  appleRankingActiveRun = run;
  try {
    if (run.resume) {
      const latest = latestAppleRankingSearch(await readAppleRankingState());
      if (!latest || latest.complete || appleRankingSearchUrl(latest.url) !== searchUrl) {
        throw new Error("Resume Scan belongs to the last interrupted filter. Open that filtered search and choose Resume Scan, or use Scan And Rank for this filter.");
      }
      if (latest.profileSignature !== appleRankingProfileSignature(profile)) {
        throw new Error("Your resume or matching settings changed. Choose Scan And Rank to start a new scan; valid cached scores remain saved.");
      }
    }
    run.sourceWindowId = await getTaskWindowId(tab);
    if (run.stopRequested) throw new Error("Ranking stopped. Saved matches are available.");
    runAppleJobRanking(run, profile).catch((error) => { appleRankingActiveRun = null; console.error(error); });
    return { ok: true };
  } catch (failure) {
    appleRankingActiveRun = null;
    return { ok: false, error: failure?.message || "The careers window could not be found." };
  }
}

function appleRankingPageFailure(result, fallback) {
  const error = result instanceof Error ? result : new Error(result?.message || result?.error || result?.reason || fallback);
  error.errorType ||= result?.errorType || result?.data?.errorType || "search_navigation_failed";
  error.retryable ??= result?.retryable ?? result?.data?.retryable !== false;
  return error;
}

function verifyAppleRankingPage(page, run, expectedPage, previousSignature = null) {
  let filterMatches = false;
  try { filterMatches = appleRankingSearchUrl(page?.url) === run.searchUrl; } catch (_error) {}
  if (!filterMatches) {
    throw Object.assign(new Error("Apple's search filters changed. Reopen the intended filter and start Scan And Rank again."),
      { errorType: "search_filter_changed", retryable: false });
  }
  if (page.paginationVerified !== true || page.currentPage !== expectedPage ||
    !Number.isInteger(page.pageCount) || page.pageCount < expectedPage ||
    page.hasNextPage !== (expectedPage < page.pageCount) || !page.links?.length) {
    throw Object.assign(new Error(`Apple's search page ${expectedPage} and pagination could not be verified.`),
      { errorType: "search_page_unverified", retryable: true });
  }
  const signature = page.links.map(job => String(job.jobId)).sort().join("|");
  if (signature === previousSignature) {
    throw Object.assign(new Error(`Apple repeated the previous results on search page ${expectedPage}.`),
      { errorType: "search_page_unchanged", retryable: true });
  }
  return page;
}

async function readAppleRankingPage(tabId, run, expectedPage, previousSignature = null, attempts = 2) {
  let failure;
  for (let attempt = 0; attempt < attempts && !run.stopRequested; attempt += 1) {
    try {
      const response = await sendMessageWithFallback(tabId, { type: "APPLE_CAREERS_COLLECT_JOB_LINKS",
        verifySearchPagination: true, expectedSearchUrl: run.searchUrl, expectedPage, previousPageSignature: previousSignature });
      if (!response?.ok) throw appleRankingPageFailure(response, `Apple's search page ${expectedPage} could not be read.`);
      return verifyAppleRankingPage(response.data, run, expectedPage, previousSignature);
    } catch (error) {
      failure = appleRankingPageFailure(error, "The filtered Apple jobs list could not be read.");
      if (!failure.retryable) throw failure;
      if (attempt + 1 < attempts) await delay(1000);
    }
  }
  throw failure || new Error("Ranking stopped. Saved matches are available.");
}

async function advanceAppleRankingPage(tabId, run, fromPage, previousSignature) {
  if (run.stopRequested) throw new Error("Ranking stopped. Saved matches are available.");
  const expectedPage = fromPage + 1;
  const reasons = [];
  const remember = error => {
    const failure = appleRankingPageFailure(error, "Apple's next search page could not be opened.");
    if (!reasons.includes(failure.message)) reasons.push(failure.message);
    if (!failure.retryable) throw failure;
    return failure;
  };
  try {
    // A lost response can follow an executed click. Never let injection fallback
    // replay Next; reconcile the exact target page before any recovery navigation.
    const next = await chrome.tabs.sendMessage(tabId, { type: "APPLE_CAREERS_GO_TO_NEXT_PAGE",
      expectedSearchUrl: run.searchUrl, expectedFromPage: fromPage, expectedPage, previousPageSignature: previousSignature });
    if (!next?.ok) remember(next);
    if (next?.action === "navigate") await waitForTabComplete(tabId);
  } catch (error) { remember(error); }
  if (run.stopRequested) throw new Error("Ranking stopped. Saved matches are available.");
  try { return await readAppleRankingPage(tabId, run, expectedPage, previousSignature, 1); }
  catch (error) { remember(error); }
  const target = new URL(run.searchUrl);
  target.searchParams.set("page", String(expectedPage));
  for (let attempt = 0; attempt < 2 && !run.stopRequested; attempt += 1) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (run.stopRequested) throw new Error("Ranking stopped. Saved matches are available.");
      let filterMatches = false;
      try { filterMatches = appleRankingSearchUrl(tab.url) === run.searchUrl; } catch (_error) {}
      if (!filterMatches || tab.windowId !== run.sourceWindowId) {
        throw Object.assign(new Error("The scan tab no longer belongs to the original Apple search and window."),
          { errorType: "search_filter_changed", retryable: false });
      }
      // Only the owned scan tab is navigated, to one idempotent target URL. Even
      // if the original SPA transition finishes late this cannot skip a page.
      await chrome.tabs.update(tabId, { url: target.href });
      if (run.stopRequested) throw new Error("Ranking stopped. Saved matches are available.");
      await waitForTabComplete(tabId);
      return await readAppleRankingPage(tabId, run, expectedPage, previousSignature, 1);
    } catch (error) { remember(error); }
    if (attempt === 0 && !run.stopRequested) await delay(1000);
  }
  throw Object.assign(new Error(`Could not verify Apple search page ${expectedPage} after bounded recovery: ${reasons.join(" ")} ` +
    `Saved scores are available. Reopen the same filtered search, check that page ${expectedPage} loads, then choose Resume Scan. Automatic application remains paused.`),
  { errorType: "search_navigation_retry_exhausted", retryable: true });
}

async function runAppleJobRanking(run, profile) {
  const state = await readAppleRankingState();
  const profileSignature = appleRankingProfileSignature(profile);
  run.searchUrl = appleRankingSearchUrl(run.searchUrl);
  const searchKey = fingerprintText(run.searchUrl);
  const priorSearch = state.searches[searchKey];
  const continuing = run.resume && priorSearch?.scanId && Array.isArray(priorSearch.discoveredJobIds) &&
    !priorSearch.complete && priorSearch.profileSignature === profileSignature;
  const search = continuing ? { ...priorSearch, complete: false } : { url: run.searchUrl, pagesRead: 0, jobsRead: 0, alreadyApplied: 0,
    applicationReview: 0, complete: false, startedAt: Date.now(), profileSignature, pageIndex: 0, discoveredIds: [],
    discoveredJobIds: [], processedJobIds: [], pageSignatures: {}, scanId: `${appleWorkerOwner}-scan-${++appleRankingScanSequence}` };
  const processed = new Set(search.processedJobIds || []);
  search.pageSignatures = { ...search.pageSignatures };
  const checkpoint = continuing ? Math.max(0, Number(search.pagesRead) || 0) : 0;
  search.pageIndex = checkpoint;
  state.searches[searchKey] = search;
  state.latestSearchKey = searchKey;
  state.running = true;
  state.phase = "Ranking filtered Apple jobs";
  state.error = null;
  state.errorType = null;
  state.errorJobId = null;
  state.currentJob = null;
  state.scoresReused = 0;
  state.scoresFetched = 0;
  let listTab;
  const saveProgress = (jobId = null) => saveAppleRankingState(state, {
    jobs: jobId ? [jobId] : [], searches: [searchKey]
  });
  const finishJob = async (fullId, jobId = null) => {
    processed.add(fullId);
    search.processedJobIds = [...processed];
    await saveProgress(jobId);
  };
  try {
    await saveAppleRankingState(state);
    run.sourceWindowId ??= await getTaskWindowId(run.sourceTabId);
    const resumeUrl = new URL(run.searchUrl);
    if (checkpoint) resumeUrl.searchParams.set("page", String(checkpoint + 1));
    listTab = await createTaskTab(resumeUrl.href, run.sourceWindowId);
    await waitForTabComplete(listTab.id);
    const discovered = new Set(search.discoveredIds || []);
    const observedJobIds = new Set(search.discoveredJobIds);
    const stored = await CareerPeelerJobStore.get(APPLIED_JOBS_KEY);
    const applied = new Set(Object.values(stored[APPLIED_JOBS_KEY] || {}).filter((job) => job.site === "apple").map((job) => CareerPeelerRanking.idOf(job.jobId)));
    let readyPage = null;
    for (let pageIndex = checkpoint; pageIndex < 1000 && !run.stopRequested; pageIndex += 1) {
      const previousSignature = search.pageSignatures[pageIndex] || null;
      const page = readyPage || await readAppleRankingPage(listTab.id, run, pageIndex + 1, previousSignature);
      readyPage = null;
      if (run.stopRequested) break;
      if (search.pageCount && page.pageCount !== search.pageCount) {
        throw Object.assign(new Error("Apple's total search page count changed during this scan. Start Scan And Rank again on the same filter; saved matching results will be reused."),
          { errorType: "search_page_count_changed", retryable: false });
      }
      search.pageCount = page.pageCount;
      search.pageIndex = pageIndex;
      const signature = page.links.map((job) => String(job.jobId)).sort().join("|");
      if (Object.entries(search.pageSignatures).some(([ordinal, saved]) => Number(ordinal) !== pageIndex + 1 && saved === signature)) {
        throw Object.assign(new Error("Apple repeated a search page before the full filtered list was ranked. Check the filtered search, then Resume Scan."),
          { errorType: "search_page_repeated", retryable: false });
      }
      search.pageSignatures[pageIndex + 1] = signature;
      for (const link of page.links) {
        if (run.stopRequested) break;
        const id = CareerPeelerRanking.idOf(link.jobId);
        const fullId = String(link.jobId);
        if (!/^\d+(?:-\d+)?$/.test(fullId) || !CareerPeelerApplicationSafety.matchesJob(fullId, link.url)) {
          throw new Error("A search result did not verify its full Apple job ID.");
        }
        if (processed.has(fullId)) continue;
        discovered.add(id);
        observedJobIds.add(fullId);
        search.discoveredIds = [...discovered];
        search.discoveredJobIds = [...observedJobIds];
        search.jobsRead = discovered.size;
        state.phase = `Ranking page ${pageIndex + 1}: ${link.title}`;
        state.currentJob = { jobId: link.jobId, title: link.title, url: link.url };
        const prior = state.jobs[id];
        if (applied.has(id) || link.alreadyAppliedFromList || ["submitted", "withdrawn"].includes(prior?.queueStatus)) {
          search.alreadyApplied += 1;
          await finishJob(fullId);
          continue;
        }
        if (["uncertain", "applying"].includes(prior?.queueStatus)) {
          search.applicationReview += 1;
          await finishJob(fullId);
          continue;
        }
        if (!prior || prior.profileSignature !== profileSignature) {
          state.jobs[id] = { ...link, profileSignature, eligible: false, score: null,
            reason: "Matching has not finished for this job.", sourceKey: searchKey };
          await saveProgress(id);
        }
        const titleSkip = getHardSkipTitleReason(link.title);
        if (titleSkip) {
          state.jobs[id] = { ...link, profileSignature, eligible: false, score: 0, reason: titleSkip, blockers: [titleSkip], sourceKey: searchKey };
          await finishJob(fullId, id);
          continue;
        }
        const extracted = await fetchAppleSubmittedRoleDetails([link], {
          shouldStop: () => run.stopRequested, windowId: run.sourceWindowId
        });
        if (run.stopRequested) break;
        const details = extracted.detailsByJobId.get(String(link.jobId));
        if (!details?.description || !details.minimumQualifications) {
          state.jobs[id] = { ...link, profileSignature, eligible: false, score: null,
            reason: "Full description or minimum qualifications could not be retrieved; automatic application is disabled.", sourceKey: searchKey };
        } else {
          const local = await sendMessageWithFallback(listTab.id, { type: "APPLE_CAREERS_LOCAL_MATCH_POSTING", details,
            resumeProfileText: resolveResumeProfileText(profile), userYearsOfExperience: profile.userYearsOfExperience,
            nonScoringWorkflowQualifications: CareerPeelerRanking.qualificationItems(details).filter(item => item.scoring === "neutral_coding_workflow").map(item => item.text) });
          const postingSignature = fingerprintText(JSON.stringify(CareerPeelerRanking.postingInput(details)));
          const reusable = String(prior?.jobId) === fullId && prior?.profileSignature === profileSignature && prior.postingSignature === postingSignature &&
            Date.now() - Number(prior.scoredAt || 0) < 30 * 86400000;
          const result = reusable ? revalidateAppleRankingJob(prior, details, profile) : await scoreAppleRankingPosting(details, profile, run);
          if (reusable) state.scoresReused += 1;
          else state.scoresFetched += 1;
          state.jobs[id] = { ...link, ...result, title: details.title || link.title, url: details.url || link.url,
            profileSignature, postingSignature, localMatch: local?.ok ? local.data : null, scoredAt: reusable ? prior.scoredAt : Date.now(),
            sourceKey: searchKey, queueStatus: String(prior?.jobId) === fullId && prior?.queueStatus === "queued" && result.breakdown ? "queued" : "available" };
        }
        await finishJob(fullId, id);
        if (!prior || prior.profileSignature !== profileSignature) await delay(1500);
      }
      if (run.stopRequested) break;
      search.pagesRead = pageIndex + 1;
      search.pageIndex = pageIndex + 1;
      search.complete = !page.hasNextPage;
      await saveProgress();
      if (search.complete) break;
      readyPage = await advanceAppleRankingPage(listTab.id, run, pageIndex + 1, signature);
    }
    if (!search.complete && !run.stopRequested) throw new Error("The search reached the page limit before finishing; saved results are partial.");
    state.phase = run.stopRequested ? "Ranking stopped; results saved" : "Filtered search ranked";
  } catch (error) {
    state.error = run.stopRequested ? null : error?.message || "Ranking stopped unexpectedly.";
    state.errorType = run.stopRequested ? null : error?.errorType || "ranking_failed";
    if (state.error && /^search_/.test(state.errorType) && !/Resume Scan|Scan And Rank again/.test(state.error)) {
      state.error += " Saved scores remain available. Check that the same filtered search loads, then choose Resume Scan. Automatic application remains paused.";
    }
    state.errorJobId = /^search_/.test(state.errorType || "") ? null : state.currentJob?.jobId || null;
    state.phase = run.stopRequested ? "Ranking stopped; results saved" : "Ranking paused; results saved";
  } finally {
    state.running = false;
    if (!state.error) state.currentJob = null;
    search.finishedAt = Date.now();
    if (listTab?.id) await chrome.tabs.remove(listTab.id).catch(() => {});
    await activateTab(run.sourceTabId).catch(() => {});
    const progressSaved = await saveProgress().then(() => true, error => { console.error(error); return false; });
    try {
      if (run.autoApply && search.complete && !run.stopRequested && !state.error && progressSaved) {
        const applied = (await CareerPeelerJobStore.get(APPLIED_JOBS_KEY))[APPLIED_JOBS_KEY] || {};
        const excluded = [...Object.values(applied).filter(job => job.site === "apple").map(job => job.jobId), ...(state.withdrawnIds || [])];
        const discovered = new Set(search.discoveredJobIds);
        const candidates = CareerPeelerRanking.topCandidates(Object.values(state.jobs).filter(job =>
          job.profileSignature === profileSignature && discovered.has(String(job.jobId))), run.topN, 0, excluded);
        if (candidates.length) {
          run.autoJobIds = new Set(candidates.map(job => String(job.jobId)));
          run.autoScope = { searchKey, scanId: search.scanId };
          search.autoApplyJobIds = [...run.autoJobIds];
          run.reviewedJobs = {};
          run.applying = true;
          for (const job of candidates) Object.assign(state.jobs[CareerPeelerRanking.idOf(job.jobId)],
            { queueStatus: "queued", autoQueuedFrom: { ...run.autoScope } });
          await saveAppleRankingState(state);
          await runAppleJobQueue(run, profile);
        } else {
          state.phase = "Ranking complete; no strong matches. Review the saved rankings.";
          await saveAppleRankingState(state);
        }
      }
    } catch (error) {
      state.error = error.message; state.phase = "Automatic application paused"; state.running = false;
      await saveAppleRankingState(state).catch(console.error);
    } finally { appleRankingActiveRun = null; }
  }
}

async function queueTopAppleJobs(userProfile, topN, selectedIds = [], candidateIds = null) {
  return editAppleJobQueue(async () => {
    const view = await getAppleRankingView(userProfile, topN);
    const available = view.candidates.filter(job => job.queueStatus !== "queued");
    const limit = Math.min(view.topN, view.capacity.known ? view.capacity.remaining : view.topN);
    // Use the displayed shortlist so a search cannot silently queue hidden roles.
    const candidates = selectedIds.length ? available.filter(job => selectedIds.includes(job.jobId))
      : available.filter(job => !Array.isArray(candidateIds) || candidateIds.includes(String(job.jobId))).slice(0, limit);
    if (!selectedIds.length && view.capacity.known && !view.capacity.remaining) return { ok: false, error: "There are no open application slots. Review your existing submissions before queuing more top matches." };
    if (!candidates.length) return { ok: false,
      error: "No scored, unapplied jobs are available to queue for your current resume. Rank a filtered search first; excluded and unfinished jobs cannot be queued." };
    const state = await readAppleRankingState();
    for (const job of candidates) state.jobs[CareerPeelerRanking.idOf(job.jobId)] = { ...job, queueStatus: "queued" };
    await saveAppleRankingState(state);
    return { ok: true, count: candidates.length, reviewCount: candidates.filter((job) => !job.eligible).length };
  });
}

async function removeQueuedAppleJob(jobId) {
  return editAppleJobQueue(async () => {
    const state = await readAppleRankingState();
    const job = state.jobs[CareerPeelerRanking.idOf(jobId)];
    if (job?.queueStatus === "queued") job.queueStatus = "available";
    await saveAppleRankingState(state);
    return { ok: true };
  });
}

async function editAppleJobQueue(edit) {
  if (scanState.running || appleRankingIsRunning()) return { ok: false, error: "Stop the current run before changing the queue." };
  appleRankingActiveRun = { editing: true };
  try { return await edit(); }
  finally { appleRankingActiveRun = null; }
}

async function findAppleCapacityTab(windowId, sourceTabId) {
  const tabs = await chrome.tabs.query({ windowId });
  const candidates = tabs.filter(tab => tab.windowId === windowId && tab.status === "complete" &&
    /^https:\/\/jobs\.apple\.com\/app\/[^/]+\/profile\/roles\/?(?:[?#]|$)/i.test(tab.url || ""));
  candidates.sort((a, b) => Number(b.id === sourceTabId) - Number(a.id === sourceTabId));
  for (const tab of candidates) {
    // Your Roles also has non-submission views. Reuse only a ready, authenticated
    // Active list without a withdrawal dialog; this probe never paginates.
    const result = await sendMessageWithFallback(tab.id, { type: "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE" }).catch(() => null);
    const page = result?.data;
    if (result?.ok && page?.accountVerified === true && page.withdrawalConfirmationOpen === false &&
      ["confirmed", "confirmed_empty"].includes(page.inventoryState) && Array.isArray(page.roles) &&
      Number.isInteger(page.pageCount) && page.pageCount >= 1 && page.pageCount <= 100 &&
      Number.isInteger(page.pageIndex) && page.pageIndex >= 1 && page.pageIndex <= page.pageCount) return tab;
  }
  return null;
}

async function refreshAppleQueueCapacity(state, windowId, sourceTabId, { passive = false } = {}) {
  if (appleSubmissionSyncInFlight) throw new Error("Submission synchronization is already running.");
  appleSubmissionSyncInFlight = true;
  let tab;
  let temporaryTab = false;
  let previousStatus;
  try {
    previousStatus = await readAppleSubmissionSyncStatus();
    await setAppleSubmissionSyncStatus({ state: "syncing", source: passive ? "automatic" : "workflow",
      reason: null, message: null, lastAttemptAt: Date.now(), lastAttemptTabId: sourceTabId });
    const withdrawalJournal = await readAppleWithdrawalJournal();
    const legacyWithdrawalArchive = !passive &&
      await CareerPeelerJobStore.getMetadata(APPLE_WITHDRAWAL_WORKFLOW_KEY) === undefined &&
      Boolean((await CareerPeelerJobStore.get(APPLE_SUBMITTED_ROLE_REVIEWS_KEY))[APPLE_SUBMITTED_ROLE_REVIEWS_KEY]);
    const reconcileWithdrawals = !passive && (legacyWithdrawalArchive || Object.keys(withdrawalJournal.records).length > 0);
    if (passive && Object.values(withdrawalJournal.records).some(record => record.outcome === "unknown")) return await deferAppleSubmissionSync("withdrawal_recovery",
      "A withdrawal needs fresh inventory verification. Use Sync Submissions before reviewing another attempt.");
    let result;
    if (passive) {
      tab = await chrome.tabs.get(sourceTabId);
      if (!/^https:\/\/jobs\.apple\.com\/app\/[^/]+\/profile\/roles\/?(?:[?#]|$)/i.test(tab.url || "")) {
        await chrome.storage.local.set({ [APPLE_SUBMISSION_SYNC_STATUS_KEY]: previousStatus });
        return { ok: true, ignored: true };
      }
      // Never inject scripts, create tabs or paginate for an automatic check.
      result = await chrome.tabs.sendMessage(tab.id, { type: "APPLE_CAREERS_PEEK_SUBMITTED_HISTORY_PAGE" });
      if (result?.ok && result.data?.activeContext === false) {
        await chrome.storage.local.set({ [APPLE_SUBMISSION_SYNC_STATUS_KEY]: previousStatus });
        return { ok: true, ignored: true };
      }
      if (result?.ok) {
        const page = result.data;
        await setAppleSubmissionSyncStatus({ lastPageSignature: `${page.pageIndex}|${page.pageCount}|${(page.roles || []).map(role => role.jobId).join("|")}` });
        if (page.withdrawalConfirmationOpen) return await deferAppleSubmissionSync("dialog", "Resolve Apple's open withdrawal dialog before synchronizing.");
        if (page.pageCount > 1) return await deferAppleSubmissionSync("pagination", "Automatic sync cannot verify all submissions from this page. Sync Submissions visits all pages and restores your place.");
        result = { ok: true, data: { pages: [page], pageCount: page.pageCount } };
      }
    } else {
      await quiesceRecoveredAppleWorkflow();
      tab = reconcileWithdrawals ? null : await findAppleCapacityTab(windowId, sourceTabId);
      if (!tab) {
        // Never navigate the user's filtered search or take a tab from another window.
        tab = await createTaskTab("https://jobs.apple.com/app/en-us/profile/roles", windowId, false);
        temporaryTab = true;
        await waitForTabComplete(tab.id);
        await delay(750);
      }
      result = await sendMessageWithFallback(tab.id, {
        type: reconcileWithdrawals ? "APPLE_CAREERS_GET_STABLE_SUBMITTED_HISTORY_INVENTORY" : "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES",
        notBefore: reconcileWithdrawals ? Date.now() : undefined, openActive: reconcileWithdrawals,
        restoreFirstPage: false, restoreOriginalPage: !temporaryTab });
    }
    if (!result?.ok) throw new Error(result?.error || "Sign in to Apple Your Roles so the queue can verify your active submission count.");
    const inventory = reconcileWithdrawals
      ? CareerPeelerApplicationSafety.validateWithdrawalInventoryEvidence(result.data)
      : CareerPeelerApplicationSafety.validateSubmittedHistoryInventory(result.data);
    if (reconcileWithdrawals) await resolveAppleWithdrawalInventory(result.data);
    else if (!passive) await CareerPeelerJobStore.updateMetadata(APPLE_WITHDRAWAL_WORKFLOW_KEY,
      previous => previous === undefined ? { version: 1, records: {} } : previous);
    if (passive) for (const record of Object.values(withdrawalJournal.records)) {
      if (record.outcome === "inactive" && inventory.roles.some(role => role.jobId === record.jobId)) {
        await invalidateAppleWithdrawalResolution(record, "Apple's current inventory contradicts an earlier inactive withdrawal result. Sync before retrying.");
      }
    }
    const reconciliation = passive ? { workflow: null, blockedJobIds: [], recoveryWarning: null }
      : await reconcileAppleApplicationInventory(inventory);
    const { workflow, recoveryWarning } = reconciliation;
    const blockedRecoveryIds = new Set(reconciliation.blockedJobIds.map(CareerPeelerRanking.idOf));
    // A base-only inventory can verify capacity while a never-submitted
    // interrupted workflow still needs a fresh applicability review. Do not
    // promote its ranking/failure records using broader base-ID membership.
    const unverifiedRecoveryIds = new Set(Object.values(workflow?.jobs || {}).filter(job =>
      job.reconciliation === "not_attempted" && appleWorkflowNeverAuthorizedSubmit(job, workflow) &&
      !inventory.roles.some(role => String(role.jobId) === String(job.jobId))).map(job => CareerPeelerRanking.idOf(job.jobId)));
    state.capacitySnapshot = { ...inventory,
      scannedAt: Date.now(), updatedAt: Date.now() };
    const ids = new Set(state.capacitySnapshot.roles.filter((role) => role.active !== false).map((role) => CareerPeelerRanking.idOf(role.jobId)));
    const changedJobs = new Set();
    const changedFailures = new Set();
    if (!passive) {
      for (const job of Object.values(state.jobs)) {
        const id = CareerPeelerRanking.idOf(job.jobId);
        if (blockedRecoveryIds.has(id)) continue;
        if (ids.has(id) && !unverifiedRecoveryIds.has(id)) {
          if (job.queueStatus !== "submitted") changedJobs.add(id);
          job.queueStatus = "submitted";
          continue;
        }
        if (["uncertain", "applying"].includes(job.queueStatus)) { job.queueStatus = "needs_review"; changedJobs.add(id); }
        if (state.applicationFailures[id]?.submissionOutcomeUnknown) {
          state.applicationFailures[id].status = job.queueStatus;
          state.applicationFailures[id].verifiedAbsentAt = Date.now();
          changedFailures.add(id);
        }
      }
      // Failure history can outlive its ranking record; reconcile both independently.
      for (const [id, failure] of Object.entries(state.applicationFailures)) {
        if (blockedRecoveryIds.has(CareerPeelerRanking.idOf(failure.jobId || id))) continue;
        if (ids.has(id) && !unverifiedRecoveryIds.has(id) && failure.status !== "submitted") {
          failure.status = "submitted";
          failure.resolvedAt = Date.now();
          changedFailures.add(id);
        }
      }
      state.reservations = unresolvedAppleWorkflowReservations(workflow);
    }
    const stored = await CareerPeelerJobStore.get(APPLE_SUBMITTED_ROLE_REVIEWS_KEY);
    const archive = stored[APPLE_SUBMITTED_ROLE_REVIEWS_KEY] || { version: 1, pages: {} };
    const priorRoles = new Map([...(archive.lastCompleteScan?.roles || []), ...(archive.latestScan?.roles || []),
      ...Object.values(archive.pages || {}).flatMap(page => page.roles || [])].map(role => [CareerPeelerRanking.idOf(role.jobId), role]));
    const pages = Object.fromEntries(result.data.pages.map(page => [page.pageIndex, { ...page, updatedAt: Date.now(),
      roles: page.roles.map(role => ({ ...priorRoles.get(CareerPeelerRanking.idOf(role.jobId)), ...role })) }]));
    const snapshot = { ...state.capacitySnapshot, roles: Object.values(pages).flatMap(page => page.roles),
      pagesRead: result.data.pages.length, pageCount: result.data.pageCount, matchSignature: archive.latestScan?.matchSignature, scorePolicyVersion: archive.latestScan?.scorePolicyVersion };
    await CareerPeelerJobStore.set({ [APPLE_SUBMITTED_ROLE_REVIEWS_KEY]: { ...archive, pages, latestScan: snapshot, lastCompleteScan: snapshot } });
    await saveAppleRankingState(state, { jobs: [...changedJobs], applicationFailures: [...changedFailures] });
    await completeAppleSubmissionSync(inventory, { recoveryWarning });
    return { ok: true, recoveryWarning };
  } catch (error) {
    // Keep saved role rankings, but never present a failed fresh read as a verified count.
    state.capacitySnapshot = { ...state.capacitySnapshot, roles: state.capacitySnapshot?.roles || [], complete: false, inventoryState: "unknown",
      updatedAt: Date.now(), warning: error?.message || "Submission inventory could not be verified." };
    await saveAppleRankingState(state, { jobs: [], applicationFailures: [] }).catch(console.error);
    await setAppleSubmissionSyncStatus({ state: "failed", reason: "read_failed", message: error.message });
    throw error;
  } finally {
    appleSubmissionSyncInFlight = false;
    if (temporaryTab && tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function startAppleJobQueue(tab, userProfile, reviewAcknowledgement = null, selectedIds = [], batchToken = null) {
  if (scanState.running || appleRankingIsRunning() || submittedRoleAnalysisRuns.size) return { ok: false, error: "Stop the current scan before applying the queue." };
  const profile = normalizeUserProfile({ ...userProfile, scanMode: "auto_apply", llmEnabled: true });
  const error = appleRankingReadiness(profile) || getAutoApplyReadinessError(profile) || (!profile.autoApplyConsent ? "Allow submission before applying the queue." : null);
  if (error) return { ok: false, error };
  if (!tab?.id || getSiteConfig(tab.url)?.id !== "apple") return { ok: false, error: "Open Apple Careers before starting the queue." };
  const run = { stopRequested: false, sourceTabId: tab.id, applying: true };
  appleRankingActiveRun = run;
  try {
    run.sourceWindowId = await getTaskWindowId(tab);
    const batch = await readAppleSelectedApplicationBatch(profile, selectedIds);
    if (!batchToken || batchToken !== batch.batchToken) {
      appleRankingActiveRun = null;
      return { ok: false, error: "The selected batch or its assessment changed. Close this sheet and review your selection again." };
    }
    if (batch.reviewToken && reviewAcknowledgement !== batch.reviewToken) {
      appleRankingActiveRun = null;
      return { ok: false, error: "Review and acknowledge the selected roles' match concerns before applying." };
    }
    run.selectedJobIds = new Set(batch.jobs.map(job => String(job.jobId)));
    run.selectedAssessments = Object.fromEntries(batch.jobs.map(job => [String(job.jobId), appleQueuedJobReviewSignature(job)]));
    run.reviewedJobs = Object.fromEntries(batch.jobs.filter((job) => !job.eligible)
      .map((job) => [CareerPeelerRanking.idOf(job.jobId), appleQueuedJobReviewSignature(job)]));
    run.workflowSessionId = await claimAppleApplicationSession(batch.jobs, run);
    runAppleJobQueue(run, profile).catch((error) => { appleRankingActiveRun = null; console.error(error); });
    return { ok: true };
  } catch (failure) {
    appleRankingActiveRun = null;
    return { ok: false, error: failure?.message || "The saved queue could not be read.", errorType: failure?.code || "application_batch_failed" };
  }
}

async function readAppleCurrentRole(tabId, profile) {
  const tab = await chrome.tabs.get(tabId);
  const site = getSiteConfig(tab.url);
  if (site?.id !== "apple" || !site.isJobDetailUrl(new URL(tab.url))) {
    throw new Error("Open an Apple job detail page, then choose Apply This Role.");
  }
  const jobId = getJobIdFromUrl(tab.url);
  const details = await waitForAppleSubmittedRoleDetails(tab.id, jobId);
  if (!details || CareerPeelerRanking.idOf(details.jobId) !== CareerPeelerRanking.idOf(jobId)) {
    throw new Error("The job description has not loaded. Wait for the page, then try again.");
  }
  const id = CareerPeelerRanking.idOf(jobId);
  const records = await CareerPeelerJobStore.getRecords(APPLE_JOB_RANKING_KEY, [id], "jobs");
  const saved = records[id];
  const postingSignature = fingerprintText(JSON.stringify(CareerPeelerRanking.postingInput(details)));
  const profileSignature = appleRankingProfileSignature(profile);
  const currentAssessment = saved?.postingSignature === postingSignature && saved.profileSignature === profileSignature;
  const job = { ...(currentAssessment ? saved : {}), jobId, title: details.title, url: tab.url,
    profileSignature, postingSignature, eligible: currentAssessment ? saved.eligible : false };
  // Bind this one-off confirmation to the page and answers being reviewed; it
  // grants no permission to apply other queue entries or future assessments.
  const token = fingerprintText(JSON.stringify({ tabId, url: tab.url, profile,
    assessment: appleQueuedJobReviewSignature(job) }));
  return { tab, job, token };
}

async function prepareAppleCurrentRole(tabId, userProfile) {
  if (scanState.running || appleRankingIsRunning() || submittedRoleAnalysisRuns.size) {
    return { ok: false, error: "Stop the current workflow before applying this role." };
  }
  appleRankingActiveRun = { editing: true };
  try {
    const profile = normalizeUserProfile({ ...userProfile, scanMode: "auto_apply", llmEnabled: true });
    const prepared = await readAppleCurrentRole(tabId, profile);
    return { ok: true, data: { tabId, job: prepared.job, token: prepared.token } };
  } finally { appleRankingActiveRun = null; }
}

async function startAppleCurrentRole(tabId, userProfile, token, confirmed) {
  if (scanState.running || appleRankingIsRunning() || submittedRoleAnalysisRuns.size) {
    return { ok: false, error: "Stop the current workflow before applying this role." };
  }
  if (confirmed !== true) return { ok: false, error: "Confirm submission of this role first." };
  const profile = normalizeUserProfile({ ...userProfile, scanMode: "auto_apply", llmEnabled: true });
  const readiness = getAutoApplyReadinessError(profile);
  if (readiness) return { ok: false, error: readiness };
  const run = { stopRequested: false, sourceTabId: tabId, applying: true };
  appleRankingActiveRun = run;
  try {
    const prepared = await readAppleCurrentRole(tabId, profile);
    if (!token || token !== prepared.token) throw new Error("The page, profile, or assessment changed. Review this role again.");
    run.sourceWindowId = prepared.tab.windowId;
    run.singleJob = prepared.job;
    run.workflowSessionId = await claimAppleApplicationSession([prepared.job], run);
    runAppleJobQueue(run, profile).catch(error => { appleRankingActiveRun = null; console.error(error); });
    return { ok: true };
  } catch (error) {
    appleRankingActiveRun = null;
    return { ok: false, error: error?.message || "This application could not be started." };
  }
}

async function refreshAppleJobQueueCount(tab) {
  if (scanState.running || appleRankingIsRunning() || submittedRoleAnalysisRuns.size) return { ok: false, error: "Stop the current run before refreshing the count." };
  if (!tab?.id || getSiteConfig(tab.url)?.id !== "apple") return { ok: false, error: "Open Apple Careers before refreshing the submission count." };
  const run = { stopRequested: false, sourceTabId: tab.id };
  appleRankingActiveRun = run;
  let state;
  try {
    run.sourceWindowId = await getTaskWindowId(tab);
    state = await readAppleRankingState();
    state.running = true;
    state.phase = "Refreshing active submission count";
    state.error = null;
    await saveAppleRankingState(state, {});
    await refreshAppleQueueCapacity(state, run.sourceWindowId, run.sourceTabId);
    state.phase = "Active submission count refreshed";
    return { ok: true };
  } catch (error) {
    const message = error?.message || "The submission count could not be checked.";
    if (state) { state.error = message; state.phase = "Submission count unavailable"; }
    return { ok: false, error: message };
  } finally {
    if (state) { state.running = false; await saveAppleRankingState(state, {}).catch(console.error); }
    appleRankingActiveRun = null;
  }
}

function startAppleApplicationWorkerActivity(run) {
  let stopped = false;
  let pending = false;
  let timer;
  const release = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
  const pulse = async () => {
    if (stopped) return;
    if (run.stopRequested) { release(); return; }
    if (pending) return;
    pending = true;
    try {
      // Waiting for an Apple content reply does not itself provide extension API
      // activity. Hold only this explicitly started operation, never idle/recovered work.
      await chrome.runtime.getPlatformInfo();
    } catch (error) { console.error("[Rolebeam] Application worker activity failed:", error?.message || error); }
    finally { pending = false; }
  };
  timer = setInterval(pulse, 20000);
  pulse();
  return release;
}

async function runAppleJobQueue(run, profile) {
  const state = await readAppleRankingState();
  const saveProgress = (job = null) => {
    const id = job && CareerPeelerRanking.idOf(job.jobId);
    return saveAppleRankingState(state, { jobs: id ? [id] : [], applicationFailures: id && state.applicationFailures[id] ? [id] : [] });
  };
  const signature = appleRankingProfileSignature(profile);
  state.running = true;
  state.phase = "Checking Apple submission capacity";
  state.workflowMode = run.singleJob ? "current_role" : "queue";
  state.error = null;
  state.errorJobId = null;
  state.currentJob = null;
  state.lastBatchSummary = null;
  let failedCount = 0;
  let submittedCount = 0;
  let alreadySubmittedCount = 0;
  let queued = [];
  let releaseWorkerActivity;
  try {
    releaseWorkerActivity = startAppleApplicationWorkerActivity(run);
    run.releaseWorkerActivity = releaseWorkerActivity;
    const automaticJobs = run.autoApply || run.autoScope || run.autoJobIds ? appleAutoApplyJobs(state, run, signature) : null;
    const automaticIds = automaticJobs && new Set(automaticJobs.map(job => String(job.jobId)));
    run.workflowSessionId ||= await claimAppleApplicationSession(Object.values(state.jobs).filter(job =>
      run.singleJob ? String(job.jobId) === String(run.singleJob.jobId) : job.queueStatus === "queued" &&
      (!run.selectedJobIds || run.selectedJobIds.has(String(job.jobId))) &&
      (!automaticIds || automaticIds.has(String(job.jobId)))), run);
    if (run.stopRequested) { state.phase = "Application queue stopped"; return; }
    await saveProgress();
    run.sourceWindowId ??= await getTaskWindowId(run.sourceTabId);
    const sync = await refreshAppleQueueCapacity(state, run.sourceWindowId, run.sourceTabId);
    if ((await CareerPeelerJobStore.getMetadata(APPLE_WORKFLOW_KEY))?.reconciliationRequired) {
      throw appleWorkflowError(sync.recoveryWarning?.message || "The previous application still needs review on Apple Careers. Automatic applications remain paused.");
    }
    if (run.stopRequested) return;
    let singleJob = null;
    if (run.singleJob) {
      const id = CareerPeelerRanking.idOf(run.singleJob.jobId);
      const active = state.capacitySnapshot.roles.some(role => role.active !== false && CareerPeelerRanking.idOf(role.jobId) === id);
      if (active) {
        alreadySubmittedCount = 1;
        await updateAppleApplicationSession(run.workflowSessionId, journal => {
          const entry = journal.jobs[String(run.singleJob.jobId)];
          entry.state = "submitted"; entry.submissionOutcome = "confirmed"; entry.alreadySubmitted = true;
        });
      }
      else {
        const capacity = await appleRankingCapacity(state);
        if (!capacity.known || capacity.remaining <= 0) throw new Error("No verified application slots are available. Review your submissions first.");
        if ((state.withdrawnIds || []).some(jobId => CareerPeelerRanking.idOf(jobId) === id)) throw new Error("This role was withdrawn and cannot be reapplied to.");
        run.singlePreviousQueueStatus = state.jobs[id]?.queueStatus || "available";
        singleJob = state.jobs[id] = { ...run.singleJob, queueStatus: run.singlePreviousQueueStatus };
      }
    }
    const requestedIds = run.selectedJobIds || automaticIds;
    if (requestedIds) alreadySubmittedCount = Object.values(state.jobs)
      .filter(job => requestedIds.has(String(job.jobId)) && job.queueStatus === "submitted").length;
    const cache = await CareerPeelerJobStore.getRecords(APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY,
      Object.values(state.jobs).filter(job => job.profileSignature === signature && job.queueStatus === "queued" &&
        !run.singleJob &&
        (!run.selectedJobIds || run.selectedJobIds.has(String(job.jobId))) &&
        (!automaticIds || automaticIds.has(String(job.jobId))))
        .flatMap(job => [CareerPeelerRanking.idOf(job.jobId), String(job.jobId)]));
    const revalidatedIds = [];
    for (const [id, job] of Object.entries(state.jobs)) {
      if (job.profileSignature !== signature || job.queueStatus !== "queued" ||
        run.singleJob ||
        (run.selectedJobIds && !run.selectedJobIds.has(String(job.jobId))) ||
        (automaticIds && !automaticIds.has(String(job.jobId)))) continue;
      const checked = revalidateAppleRankingJob(job, cache[id] || cache[String(job.jobId)], profile);
      state.jobs[id] = { ...checked, queueStatus: "queued" };
      revalidatedIds.push(id);
    }
    await saveAppleRankingState(state, { jobs: revalidatedIds });
    await initializeKnownSiteScanActivity(profile);
    scanState = { ...createIdleState(), running: true, phase: "Applying ranked queue", userProfile: profile,
      listTabId: run.sourceTabId, listWindowId: run.sourceWindowId, site: "apple", siteLabel: "Apple Careers" };
    await saveScanState();
    const stored = await CareerPeelerJobStore.get(APPLIED_JOBS_KEY);
    const excluded = [...Object.values(stored[APPLIED_JOBS_KEY] || {}).filter((job) => job.site === "apple").map((job) => job.jobId),
      ...(state.withdrawnIds || [])];
    queued = run.singleJob ? (singleJob ? [singleJob] : []) : CareerPeelerRanking.rankedCandidates(Object.values(state.jobs).filter((job) =>
      job.queueStatus === "queued" && job.profileSignature === signature &&
      (!run.selectedJobIds || run.selectedJobIds.has(String(job.jobId))) &&
      (!automaticIds || (automaticIds.has(String(job.jobId)) && job.eligible))), Object.keys(state.jobs).length || 1, 0, excluded);
    for (const job of queued) {
      if (run.stopRequested || !scanState.running) break;
      if (run.selectedAssessments && run.selectedAssessments[String(job.jobId)] !== appleQueuedJobReviewSignature(job)) {
        throw new Error("A selected role's assessment changed. Review the selected batch again before applying.");
      }
      if (!run.singleJob && !job.eligible && run.reviewedJobs?.[CareerPeelerRanking.idOf(job.jobId)] !== appleQueuedJobReviewSignature(job)) {
        throw new Error("A queued job's match concerns changed. Review and acknowledge the saved queue again before applying.");
      }
      const capacity = await appleRankingCapacity(state);
      if (!capacity.known || capacity.remaining <= 0) { state.phase = "50-application target reached; remaining jobs stay queued"; break; }
      state.phase = `Applying ${job.title}${Number.isFinite(job.score) ? ` (${job.score}%)` : ""}`;
      run.currentJobId = CareerPeelerRanking.idOf(job.jobId);
      await updateAppleApplicationSession(run.workflowSessionId, journal => {
        journal.currentJobId = String(job.jobId);
      });
      state.currentJob = { jobId: job.jobId, title: job.title, url: job.url };
      scanState.currentJob = state.currentJob;
      await saveProgress();
      await saveScanState();
      let workflowInvoked = false;
      let confirmedSubmission = false;
      let stage = "Open Job Page";
      const cycleId = await beginKnownSiteActivityCycle(currentScanActivitySteps, currentScanActivityCycles,
        { ...job, site: "apple", siteLabel: "Apple Careers" }, "Applying");
      try {
        if (!run.singleJob) await closeOwnedWorkflowTabs();
        const detailTab = run.singleJob ? await chrome.tabs.get(run.sourceTabId) : await createActiveWorkflowTab(job.url, run.sourceWindowId);
        if (run.singleJob && (detailTab.windowId !== run.sourceWindowId || detailTab.url !== job.url)) {
          throw new Error("The reviewed job tab changed. Open its job page and review it again.");
        }
        await waitForTabComplete(detailTab.id);
        stage = "Verify Job Description";
        const live = await waitForAppleSubmittedRoleDetails(detailTab.id, job.jobId);
        if (String(live?.jobId) !== String(job.jobId) || !CareerPeelerApplicationSafety.matchesJob(job.jobId, live?.url)) {
          throw Object.assign(new Error("The live posting did not verify the selected full Apple job ID."),
            { code: live?.jobId ? "job_identity_mismatch" : "job_identity_unverified" });
        }
        if (!live || fingerprintText(JSON.stringify(CareerPeelerRanking.postingInput(live))) !== job.postingSignature) {
          job.eligible = false;
          await CareerPeelerJobStore.putRecords(APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY, {
            [CareerPeelerRanking.idOf(job.jobId)]: undefined, [String(job.jobId)]: undefined
          });
          const reason = "The posting changed or is unavailable; rank it again before applying.";
          throw Object.assign(new Error(reason), { workflowResult: { ok: false, error: reason,
            data: { errorType: "posting_changed", submissionAttempted: false, submissionOutcomeUnknown: false } } });
        }
        stage = "Check Application Status";
        const status = await sendMessageWithFallback(detailTab.id, { type: "APPLE_CAREERS_EXTRACT_JOB", verifyApplicability: true,
          expectedJobId: String(job.jobId) });
        if (!status?.ok) throw Object.assign(new Error(status?.error || "The job's current application status could not be checked."),
          { code: status?.data?.errorType || "application_status_unverified" });
        if (status.data?.identityVerified !== true || String(status.data.jobId) !== String(job.jobId) ||
          !CareerPeelerApplicationSafety.matchesJob(job.jobId, status.data.url)) {
          throw Object.assign(new Error("The application status did not verify the selected full Apple job ID."), { code: "job_identity_mismatch" });
        }
        if (!status.data.alreadySubmitted && status.data.canApply !== true) {
          throw Object.assign(new Error(status.data.errorType === "session_or_login_required" ? "Sign in to Apple Careers before continuing the application queue."
            : "Apple did not expose an enabled apply action for this role. Review the job page before trying again."), { code: status.data.errorType || "job_not_applicable" });
        }
        if (run.stopRequested || !scanState.running) break;
        job.queueStatus = "applying";
        state.reservations.push({ jobId: job.jobId, startedAt: Date.now() });
        await saveProgress(job); // Reserve before clicking; interrupted submissions are never replayed automatically.
        if (status.data.alreadySubmitted) {
          confirmedSubmission = true;
          job.queueStatus = "submitted";
          alreadySubmittedCount += 1;
        } else {
          stage = "Application Workflow";
          workflowInvoked = true;
          const result = await runApplicationWorkflow(detailTab, { userProfile: profile, stopIfScanStopped: true, windowId: run.sourceWindowId,
            workflowSessionId: run.workflowSessionId,
            closeOnDone: !run.singleJob,
            activitySteps: currentScanActivitySteps, jobContext: { ...job, site: "apple", siteLabel: "Apple Careers" } });
          if (result.ok && (result.data?.submitted || result.data?.alreadySubmitted)) {
            confirmedSubmission = true;
            job.queueStatus = "submitted";
            if (result.data.alreadySubmitted) alreadySubmittedCount += 1;
            else submittedCount += 1;
          } else {
            throw Object.assign(new Error(result.error || result.data?.summary || "Application needs manual review."), { workflowResult: result });
          }
        }
        stage = "Save Confirmed Submission";
        const record = state.applicationFailures[CareerPeelerRanking.idOf(job.jobId)];
        await updateAppleApplicationSession(run.workflowSessionId, journal => {
          const entry = journal.jobs[String(job.jobId)];
          entry.state = "submitted"; entry.submissionOutcome = "confirmed"; entry.resultAt = Date.now();
          if (status.data.alreadySubmitted) entry.alreadySubmitted = true;
        }, { allowStopped: true });
        if (record) { record.status = "submitted"; record.resolvedAt = Date.now(); }
        await saveProgress(job);
      } catch (failure) {
        if (confirmedSubmission) {
          // A local journal/cache failure cannot undo Apple's confirmed outcome.
          // Retain the reserved slot and pause bookkeeping instead of replaying Submit.
          const id = CareerPeelerRanking.idOf(job.jobId);
          job.queueStatus = "submitted";
          state.applicationFailures[id] = { jobId: job.jobId, title: job.title, url: job.url,
            reason: `Apple confirmed this submission, but local bookkeeping failed: ${failure?.message || "The result could not be saved."}`,
            errorType: "submission_bookkeeping_failed", submissionOutcomeUnknown: false,
            status: "submitted", lastStep: stage, failedAt: Date.now(), resolvedAt: Date.now() };
          state.errorJobId = job.jobId;
          await saveProgress(job).catch(console.error);
          throw new Error(`Job ${job.jobId}: ${state.applicationFailures[id].reason} Sync Submissions before starting another batch. This role must not be submitted again.`);
        }
        const result = failure.workflowResult || { ok: false, error: failure?.message || "The application failed.",
          data: { errorType: failure?.code || "apply_failed", submissionOutcomeUnknown: workflowInvoked } };
        const disposition = appleQueueFailureDisposition(result, workflowInvoked);
        if ((run.stopRequested || !scanState.running) && !disposition.unknown) {
          job.queueStatus = run.singleJob ? run.singlePreviousQueueStatus : "queued";
          state.reservations = state.reservations.filter((item) => CareerPeelerRanking.idOf(item.jobId) !== CareerPeelerRanking.idOf(job.jobId));
          await saveProgress(job);
          break;
        }
        await recordAppleQueueFailure(state, job, result, disposition, stage);
        failedCount += 1;
        if (disposition.pauseQueue) {
          state.errorJobId = job.jobId;
          const message = disposition.unknown
            ? `${disposition.reason} Submission outcome is unknown; this slot stays reserved until you refresh the Apple submission count.`
            : disposition.reason;
          throw new Error(`Job ${job.jobId}: ${message}`);
        }
      } finally {
        await finishKnownSiteActivityCycle(currentScanActivitySteps, cycleId, job.queueStatus === "submitted"
          ? { status: "success", outcome: "Submitted" }
          : { status: "attention", outcome: job.queueStatus === "uncertain" ? "Outcome Unknown" : run.stopRequested ? "Stopped" : "Needs Review" });
      }
    }
    if (!state.phase.includes("target reached")) state.phase = run.stopRequested ? "Application queue stopped"
      : failedCount ? `Application queue finished; ${failedCount} jobs need manual review` : "Application queue finished";
  } catch (error) {
    state.error = error?.message || "Application queue stopped unexpectedly.";
    state.phase = "Application queue paused";
  } finally {
    releaseWorkerActivity?.();
    run.releaseWorkerActivity = null;
    if (run.workflowSessionId) await finishAppleApplicationSession(run.workflowSessionId).catch(console.error);
    state.running = false;
    state.lastBatchSummary = { submitted: submittedCount, alreadySubmitted: alreadySubmittedCount, failed: failedCount,
      remainingQueued: queued.filter(job => job.queueStatus === "queued").length, finishedAt: Date.now() };
    run.currentJobId = null;
    state.currentJob = null;
    scanState.running = false;
    scanState.currentJob = null;
    scanState.phase = state.phase;
    await saveScanState().catch(console.error);
    await finishKnownSiteScanRun().catch(console.error);
    if (!run.singleJob) await activateTab(run.sourceTabId).catch(() => {});
    await saveProgress().catch(console.error);
    appleRankingActiveRun = null;
  }
}

async function stopAppleJobRanking(reviewRequestId = null) {
  // A sheet can close after its check finished but before the reply arrived.
  // Its stale cancellation must never revoke a different scan or application.
  if (reviewRequestId !== null && (typeof reviewRequestId !== "string" || !reviewRequestId ||
    !appleRankingActiveRun?.editing || appleRankingActiveRun.reviewRequestId !== reviewRequestId)) return { ok: true, ignored: true };
  if (appleRankingActiveRun) {
    appleRankingActiveRun.stopRequested = true;
    appleRankingActiveRun.releaseWorkerActivity?.();
    if (appleRankingActiveRun.applying) scanState.running = false;
  }
  await cancelAppleApplicationSession();
  return { ok: true };
}
