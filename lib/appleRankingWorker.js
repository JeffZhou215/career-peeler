// Loaded as a classic service-worker script after core.js and jobRanking.js.
const APPLE_JOB_RANKING_KEY = "appleJobRanking";
const APPLE_JOB_RANKING_WRITE_FAILURE_KEY = "appleJobRankingWriteFailure";
let appleRankingWriteFailure = null;
let appleRankingActiveRun = null;
function appleRankingIsRunning() { return Boolean(appleRankingActiveRun) || Date.now() < appleWithdrawalBatchUntil; }

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

async function prepareAppleApplicationBatch(userProfile, selectedIds) {
  if (scanState.running || appleRankingIsRunning() || submittedRoleAnalysisRuns.size) return { ok: false, error: "Stop the current run before reviewing an application batch." };
  const profile = normalizeUserProfile(userProfile);
  return { ok: true, data: await readAppleSelectedApplicationBatch(profile, selectedIds) };
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
  const systemic = ["session_or_login_required", "career_window_unavailable"].includes(errorType) ||
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
    submissionOutcomeUnknown: disposition.unknown, attempts: (prior?.attempts || 0) + 1 };
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
  const snapshot = state.capacitySnapshot && (!saved || state.capacitySnapshot.updatedAt > saved.updatedAt)
    ? state.capacitySnapshot : saved;
  return CareerPeelerRanking.applicationCapacity(snapshot, Object.values(stored[APPLIED_JOBS_KEY] || {}),
    state.reservations || [], state.withdrawnIds || []);
}

async function getAppleRankingView(userProfile, topN = 50) {
  topN = Math.min(1000, Math.max(1, Math.floor(Number(topN) || 50)));
  const state = await readAppleRankingState();
  const session = await chrome.storage.session.get(APPLE_JOB_RANKING_WRITE_FAILURE_KEY);
  const writeFailure = appleRankingWriteFailure || session[APPLE_JOB_RANKING_WRITE_FAILURE_KEY];
  const storageFailure = writeFailure && writeFailure.updatedAt >= Number(state.updatedAt || 0) ? writeFailure : null;
  const profile = normalizeUserProfile(userProfile || (await CareerPeelerJobStore.get(USER_PROFILE_KEY))[USER_PROFILE_KEY]);
  const profileSignature = appleRankingProfileSignature(profile);
  const capacity = await appleRankingCapacity(state);
  const jobs = Object.values(state.jobs || {});
  const profileJobs = jobs.filter(job => job.profileSignature === profileSignature);
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
  const applicationFailures = Object.values(state.applicationFailures).sort((a, b) => b.failedAt - a.failedAt);
  const errorJob = state.errorJobId ? state.jobs?.[CareerPeelerRanking.idOf(state.errorJobId)]
    || state.applicationFailures[CareerPeelerRanking.idOf(state.errorJobId)]
    : state.error && /Application queue paused/i.test(state.phase || "") && applicationFailures.filter((job) => job.status === "uncertain").length === 1
      ? applicationFailures.find((job) => job.status === "uncertain") : null;
  return { ...state, ...(storageFailure || {}), jobs: undefined, capacity,
    applicationFailures, errorJob: storageFailure?.currentJob || (errorJob ? { jobId: errorJob.jobId, title: errorJob.title, url: errorJob.url } : null),
    running: appleRankingIsRunning(),
    recovered: Boolean(state.running && !appleRankingIsRunning() && !storageFailure),
    topN,
    candidates: CareerPeelerRanking.rankedCandidates(current, topN, 0, excluded),
    ranked: CareerPeelerRanking.rankedCandidates(current, topN, 0, excluded),
    queued,
    queueableCount: queueable.length,
    queueReviewCount: queued.filter((job) => !job.eligible).length,
    queueReviewToken: appleQueueReviewToken(queued),
    eligibleCount: CareerPeelerRanking.topCandidates(current, current.length || 1, 0, excluded).length,
    excludedMatches: current.filter(job => !job.breakdown && !excludedIds.has(CareerPeelerRanking.idOf(job.jobId)))
      .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 100),
    reviewedCount: current.length,
    staleCount: jobs.length - current.length,
    staleMatches: jobs.filter(job => job.profileSignature !== profileSignature).sort((a,b) => (b.score || 0) - (a.score || 0)).slice(0, topN).map(job => ({ ...job, stale: true, queueStatus: "stale" })),
    minimumScore: CareerPeelerRanking.MIN_SCORE };
}

function appleRankingReadiness(profile) {
  if (!profile.resumeFileDataUrl) return "Upload a PDF resume in Setup before ranking jobs.";
  if (!resolveResumeProfileText(profile)) return "Extract your uploaded PDF in Setup before ranking jobs.";
  if (!profile.llmEnabled || !hasLlmProviderConfigured(profile) || !isApiKeyValidated(profile)) {
    return "Enable AI Matching and test your OpenAI API key before ranking jobs.";
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
  url.searchParams.delete("page");
  const searchUrl = url.href;
  const run = { stopRequested: false, sourceTabId: tab.id, searchUrl, autoApply: Boolean(options.autoApply),
    topN: Math.min(1000, Math.max(1, Math.floor(Number(options.topN) || 50))), resume: Boolean(options.resume) };
  appleRankingActiveRun = run;
  try {
    run.sourceWindowId = await getTaskWindowId(tab);
    runAppleJobRanking(run, profile).catch((error) => { appleRankingActiveRun = null; console.error(error); });
    return { ok: true };
  } catch (failure) {
    appleRankingActiveRun = null;
    return { ok: false, error: failure?.message || "The careers window could not be found." };
  }
}

async function runAppleJobRanking(run, profile) {
  const state = await readAppleRankingState();
  const profileSignature = appleRankingProfileSignature(profile);
  const searchKey = fingerprintText(run.searchUrl);
  const priorSearch = state.searches[searchKey];
  const continuing = run.resume && priorSearch && !priorSearch.complete && priorSearch.profileSignature === profileSignature;
  const search = continuing ? { ...priorSearch, complete: false } : { url: run.searchUrl, pagesRead: 0, jobsRead: 0, alreadyApplied: 0,
    applicationReview: 0, complete: false, startedAt: Date.now(), profileSignature, pageIndex: 0, discoveredIds: [] };
  state.searches[searchKey] = search;
  state.running = true;
  state.phase = "Ranking filtered Apple jobs";
  state.error = null;
  state.errorJobId = null;
  state.currentJob = null;
  state.scoresReused = 0;
  state.scoresFetched = 0;
  let listTab;
  const saveProgress = (jobId = null) => saveAppleRankingState(state, {
    jobs: jobId ? [jobId] : [], searches: [searchKey]
  });
  try {
    await saveAppleRankingState(state);
    run.sourceWindowId ??= await getTaskWindowId(run.sourceTabId);
    const resumeUrl = new URL(run.searchUrl);
    if (continuing && search.pageIndex) resumeUrl.searchParams.set("page", String(search.pageIndex + 1));
    listTab = await createTaskTab(resumeUrl.href, run.sourceWindowId);
    await waitForTabComplete(listTab.id);
    const visited = new Set();
    const seen = new Set();
    const discovered = new Set(search.discoveredIds || []);
    const stored = await CareerPeelerJobStore.get(APPLIED_JOBS_KEY);
    const applied = new Set(Object.values(stored[APPLIED_JOBS_KEY] || {}).filter((job) => job.site === "apple").map((job) => CareerPeelerRanking.idOf(job.jobId)));
    for (let pageIndex = continuing ? search.pageIndex || 0 : 0; pageIndex < 1000 && !run.stopRequested; pageIndex += 1) {
      const response = await sendMessageWithFallback(listTab.id, { type: "APPLE_CAREERS_COLLECT_JOB_LINKS" });
      if (!response?.ok) throw new Error("The filtered Apple jobs list could not be read.");
      const page = response.data;
      search.pageIndex = pageIndex;
      if (!page.links?.length) throw new Error("No jobs were found on this search page. Check the filters or sign in again.");
      const signature = page.links.map((job) => CareerPeelerRanking.idOf(job.jobId)).sort().join("|");
      if (visited.has(signature)) throw new Error("Apple repeated a search page before the full filtered list was ranked.");
      visited.add(signature);
      for (const link of page.links) {
        if (run.stopRequested) break;
        const id = CareerPeelerRanking.idOf(link.jobId);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        discovered.add(id);
        search.discoveredIds = [...discovered];
        search.jobsRead = discovered.size;
        state.phase = `Ranking page ${pageIndex + 1}: ${link.title}`;
        state.currentJob = { jobId: link.jobId, title: link.title, url: link.url };
        const prior = state.jobs[id];
        if (applied.has(id) || link.alreadyAppliedFromList || ["submitted", "withdrawn"].includes(prior?.queueStatus)) {
          search.alreadyApplied += 1;
          continue;
        }
        if (["uncertain", "applying"].includes(prior?.queueStatus)) {
          search.applicationReview += 1;
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
          await saveProgress(id);
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
          const reusable = prior?.profileSignature === profileSignature && prior.postingSignature === postingSignature &&
            Date.now() - Number(prior.scoredAt || 0) < 30 * 86400000;
          const result = reusable ? revalidateAppleRankingJob(prior, details, profile) : await scoreAppleRankingPosting(details, profile, run);
          if (reusable) state.scoresReused += 1;
          else state.scoresFetched += 1;
          state.jobs[id] = { ...link, ...result, title: details.title || link.title, url: details.url || link.url,
            profileSignature, postingSignature, localMatch: local?.ok ? local.data : null, scoredAt: reusable ? prior.scoredAt : Date.now(),
            sourceKey: searchKey, queueStatus: prior?.queueStatus === "queued" && result.breakdown ? "queued" : "available" };
        }
        await saveProgress(id);
        if (!prior || prior.profileSignature !== profileSignature) await delay(1500);
      }
      if (run.stopRequested) break;
      search.pagesRead = pageIndex + 1;
      await saveProgress();
      if (!page.hasNextPage) { search.complete = true; break; }
      const next = await sendMessageWithFallback(listTab.id, { type: "APPLE_CAREERS_GO_TO_NEXT_PAGE" });
      if (!next?.ok) throw new Error("Apple's next search page could not be opened. Saved rankings are available.");
      if (next.action === "navigate") await waitForTabComplete(listTab.id);
      search.pageIndex = pageIndex + 1;
      await saveProgress();
      await delay(750);
    }
    if (!search.complete && !run.stopRequested) throw new Error("The search reached the page limit before finishing; saved results are partial.");
    state.phase = run.stopRequested ? "Ranking stopped; results saved" : "Filtered search ranked";
  } catch (error) {
    state.error = error?.message || "Ranking stopped unexpectedly.";
    state.errorJobId = state.currentJob?.jobId || null;
    state.phase = "Ranking paused; results saved";
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
        const candidates = CareerPeelerRanking.topCandidates(Object.values(state.jobs).filter(job =>
          job.profileSignature === profileSignature && job.sourceKey === searchKey), run.topN, 0, excluded);
        if (candidates.length) {
          run.autoJobIds = new Set(candidates.map(job => CareerPeelerRanking.idOf(job.jobId)));
          run.reviewedJobs = {};
          run.applying = true;
          for (const job of candidates) state.jobs[CareerPeelerRanking.idOf(job.jobId)].queueStatus = "queued";
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

async function refreshAppleQueueCapacity(state, windowId) {
  let tab;
  try {
    // Reading submissions must leave the user's filtered search active. The same
    // temporary-tab lifecycle applies to manual sync and queue capacity checks.
    tab = await createTaskTab("https://jobs.apple.com/app/en-us/profile/roles", windowId, false);
    await waitForTabComplete(tab.id);
    await delay(750);
    const result = await sendMessageWithFallback(tab.id, { type: "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES", restoreFirstPage: false });
    if (!result?.ok || !Array.isArray(result.data?.pages) || result.data.pages.length !== result.data.pageCount) {
      throw new Error("Sign in to Apple Your Roles so the queue can verify your active submission count.");
    }
    state.capacitySnapshot = { complete: true, roles: result.data.pages.flatMap((page) => page.roles),
      scannedAt: Date.now(), updatedAt: Date.now() };
    const ids = new Set(state.capacitySnapshot.roles.filter((role) => role.active !== false).map((role) => CareerPeelerRanking.idOf(role.jobId)));
    const changedJobs = new Set();
    const changedFailures = new Set();
    for (const job of Object.values(state.jobs)) {
      const id = CareerPeelerRanking.idOf(job.jobId);
      if (ids.has(id)) {
        if (job.queueStatus !== "submitted") changedJobs.add(id);
        job.queueStatus = "submitted";
        if (state.applicationFailures[id]) {
          state.applicationFailures[id].status = "submitted";
          state.applicationFailures[id].resolvedAt = Date.now();
          changedFailures.add(id);
        }
        continue;
      }
      if (["uncertain", "applying"].includes(job.queueStatus)) { job.queueStatus = "needs_review"; changedJobs.add(id); }
      if (state.applicationFailures[id]?.submissionOutcomeUnknown) {
        state.applicationFailures[id].status = job.queueStatus;
        state.applicationFailures[id].verifiedAbsentAt = Date.now();
        changedFailures.add(id);
      }
    }
    state.reservations = [];
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
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
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
    runAppleJobQueue(run, profile).catch((error) => { appleRankingActiveRun = null; console.error(error); });
    return { ok: true };
  } catch (failure) {
    appleRankingActiveRun = null;
    return { ok: false, error: failure?.message || "The saved queue could not be read." };
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
    await refreshAppleQueueCapacity(state, run.sourceWindowId);
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

async function runAppleJobQueue(run, profile) {
  const state = await readAppleRankingState();
  const saveProgress = (job = null) => {
    const id = job && CareerPeelerRanking.idOf(job.jobId);
    return saveAppleRankingState(state, { jobs: id ? [id] : [], applicationFailures: id && state.applicationFailures[id] ? [id] : [] });
  };
  const signature = appleRankingProfileSignature(profile);
  state.running = true;
  state.phase = "Checking Apple submission capacity";
  state.error = null;
  state.errorJobId = null;
  state.currentJob = null;
  let failedCount = 0;
  try {
    await saveProgress();
    run.sourceWindowId ??= await getTaskWindowId(run.sourceTabId);
    await refreshAppleQueueCapacity(state, run.sourceWindowId);
    if (run.stopRequested) return;
    const cache = await CareerPeelerJobStore.getRecords(APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY,
      Object.values(state.jobs).filter(job => job.profileSignature === signature && job.queueStatus === "queued" &&
        (!run.selectedJobIds || run.selectedJobIds.has(String(job.jobId))))
        .flatMap(job => [CareerPeelerRanking.idOf(job.jobId), String(job.jobId)]));
    const revalidatedIds = [];
    for (const [id, job] of Object.entries(state.jobs)) {
      if (job.profileSignature !== signature || job.queueStatus !== "queued" ||
        (run.selectedJobIds && !run.selectedJobIds.has(String(job.jobId)))) continue;
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
    const queued = CareerPeelerRanking.rankedCandidates(Object.values(state.jobs).filter((job) =>
      job.queueStatus === "queued" && job.profileSignature === signature &&
      (!run.selectedJobIds || run.selectedJobIds.has(String(job.jobId))) &&
      (!run.autoJobIds || (run.autoJobIds.has(CareerPeelerRanking.idOf(job.jobId)) && job.eligible))), Object.keys(state.jobs).length || 1, 0, excluded);
    for (const job of queued) {
      if (run.stopRequested || !scanState.running) break;
      if (run.selectedAssessments && run.selectedAssessments[String(job.jobId)] !== appleQueuedJobReviewSignature(job)) {
        throw new Error("A selected role's assessment changed. Review the selected batch again before applying.");
      }
      if (!job.eligible && run.reviewedJobs?.[CareerPeelerRanking.idOf(job.jobId)] !== appleQueuedJobReviewSignature(job)) {
        throw new Error("A queued job's match concerns changed. Review and acknowledge the saved queue again before applying.");
      }
      const capacity = await appleRankingCapacity(state);
      if (!capacity.known || capacity.remaining <= 0) { state.phase = "50-application target reached; remaining jobs stay queued"; break; }
      state.phase = `Applying ${job.title} (${job.score}%)`;
      run.currentJobId = CareerPeelerRanking.idOf(job.jobId);
      state.currentJob = { jobId: job.jobId, title: job.title, url: job.url };
      scanState.currentJob = state.currentJob;
      await saveProgress();
      await saveScanState();
      let workflowInvoked = false;
      let stage = "Open Job Page";
      try {
        await closeOwnedWorkflowTabs();
        const detailTab = await createActiveWorkflowTab(job.url, run.sourceWindowId);
        await waitForTabComplete(detailTab.id);
        stage = "Verify Job Description";
        const live = await waitForAppleSubmittedRoleDetails(detailTab.id, job.jobId);
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
        const status = await sendMessageWithFallback(detailTab.id, { type: "APPLE_CAREERS_EXTRACT_JOB",
          resumeProfileText: resolveResumeProfileText(profile), userYearsOfExperience: profile.userYearsOfExperience });
        if (!status?.ok) throw new Error("The job's current application status could not be checked.");
        if (run.stopRequested || !scanState.running) break;
        job.queueStatus = "applying";
        state.reservations.push({ jobId: job.jobId, startedAt: Date.now() });
        await saveProgress(job); // Reserve before clicking; interrupted submissions are never replayed automatically.
        if (status.data.alreadySubmitted) {
          job.queueStatus = "submitted";
        } else {
          stage = "Application Workflow";
          workflowInvoked = true;
          const result = await runApplicationWorkflow(detailTab, { userProfile: profile, stopIfScanStopped: true, windowId: run.sourceWindowId,
            activitySteps: currentScanActivitySteps, jobContext: { ...job, site: "apple", siteLabel: "Apple Careers" } });
          if (result.ok && (result.data?.submitted || result.data?.alreadySubmitted)) {
            job.queueStatus = "submitted";
          } else {
            throw Object.assign(new Error(result.error || result.data?.summary || "Application needs manual review."), { workflowResult: result });
          }
        }
        const record = state.applicationFailures[CareerPeelerRanking.idOf(job.jobId)];
        if (record) { record.status = "submitted"; record.resolvedAt = Date.now(); }
        await saveProgress(job);
      } catch (failure) {
        const result = failure.workflowResult || { ok: false, error: failure?.message || "The application failed.",
          data: { errorType: failure?.code || "apply_failed", submissionOutcomeUnknown: workflowInvoked } };
        const disposition = appleQueueFailureDisposition(result, workflowInvoked);
        if ((run.stopRequested || !scanState.running) && !disposition.unknown) {
          job.queueStatus = "queued";
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
      }
    }
    if (!state.phase.includes("target reached")) state.phase = run.stopRequested ? "Application queue stopped"
      : failedCount ? `Application queue finished; ${failedCount} jobs need manual review` : "Application queue finished";
  } catch (error) {
    state.error = error?.message || "Application queue stopped unexpectedly.";
    state.phase = "Application queue paused";
  } finally {
    state.running = false;
    run.currentJobId = null;
    state.currentJob = null;
    scanState.running = false;
    scanState.currentJob = null;
    scanState.phase = state.phase;
    await saveScanState().catch(console.error);
    await finishKnownSiteScanRun().catch(console.error);
    await activateTab(run.sourceTabId).catch(() => {});
    await saveProgress().catch(console.error);
    appleRankingActiveRun = null;
  }
}

async function stopAppleJobRanking() {
  if (appleRankingActiveRun) {
    appleRankingActiveRun.stopRequested = true;
    if (appleRankingActiveRun.applying) scanState.running = false;
  }
  return { ok: true };
}
