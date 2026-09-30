// Loaded as a classic service-worker script after core.js and jobRanking.js.
const APPLE_JOB_RANKING_KEY = "appleJobRanking";
let appleRankingActiveRun = null;
function appleRankingIsRunning() { return Boolean(appleRankingActiveRun); }

function appleRankingProfileSignature(profile) {
  return fingerprintText(JSON.stringify({ resume: resolveResumeProfileText(profile),
    years: profile.userYearsOfExperience, model: profile.llmModel, exclusions: profile.noMatchKeywords,
    version: CareerPeelerRanking.VERSION }));
}

async function readAppleRankingState() {
  const stored = await chrome.storage.local.get(APPLE_JOB_RANKING_KEY);
  return stored[APPLE_JOB_RANKING_KEY] || { version: 1, jobs: {}, searches: {}, reservations: [] };
}

async function saveAppleRankingState(state) {
  await chrome.storage.local.set({ [APPLE_JOB_RANKING_KEY]: { ...state, updatedAt: Date.now() } });
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

async function appleRankingCapacity(state) {
  const stored = await chrome.storage.local.get([APPLE_SUBMITTED_ROLE_REVIEWS_KEY, APPLIED_JOBS_KEY]);
  const archive = stored[APPLE_SUBMITTED_ROLE_REVIEWS_KEY];
  const saved = archive?.latestScan?.complete ? archive.latestScan : archive?.lastCompleteScan;
  const snapshot = state.capacitySnapshot && (!saved || state.capacitySnapshot.updatedAt > saved.updatedAt)
    ? state.capacitySnapshot : saved;
  return CareerPeelerRanking.applicationCapacity(snapshot, Object.values(stored[APPLIED_JOBS_KEY] || {}),
    state.reservations || [], state.withdrawnIds || []);
}

async function getAppleRankingView(userProfile, topN = 50) {
  const state = await readAppleRankingState();
  const profile = normalizeUserProfile(userProfile || (await chrome.storage.local.get(USER_PROFILE_KEY))[USER_PROFILE_KEY]);
  const profileSignature = appleRankingProfileSignature(profile);
  const capacity = await appleRankingCapacity(state);
  const jobs = Object.values(state.jobs || {});
  const cache = (await chrome.storage.local.get(APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY))[APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY] || {};
  const current = jobs.filter((job) => job.profileSignature === profileSignature).map((job) =>
    revalidateAppleRankingJob(job, cache[CareerPeelerRanking.idOf(job.jobId)] || cache[String(job.jobId)], profile));
  const stored = await chrome.storage.local.get(APPLIED_JOBS_KEY);
  const excluded = [...Object.values(stored[APPLIED_JOBS_KEY] || {}).filter((job) => job.site === "apple").map((job) => job.jobId),
    ...(state.withdrawnIds || [])];
  const queueable = CareerPeelerRanking.rankedCandidates(current, current.length || 1, 0, excluded);
  const queued = queueable.filter((job) => job.queueStatus === "queued");
  return { ...state, jobs: undefined, capacity,
    running: appleRankingIsRunning(),
    recovered: Boolean(state.running && !appleRankingIsRunning()),
    topN: Math.max(Number(topN) || 50, capacity.remaining || 0),
    candidates: CareerPeelerRanking.rankedCandidates(current, topN, capacity.remaining, excluded),
    ranked: CareerPeelerRanking.rankedCandidates(current, topN, capacity.remaining, excluded),
    diagnostics: CareerPeelerRanking.rankingDiagnostics(current, excluded),
    queued,
    queueableCount: queueable.length,
    queueReviewCount: queued.filter((job) => !job.eligible).length,
    queueReviewToken: appleQueueReviewToken(queued),
    needsReview: current.filter((job) => ["needs_review", "uncertain", "applying"].includes(job.queueStatus)),
    otherMatches: current.filter((job) => !job.eligible).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 100),
    eligibleCount: CareerPeelerRanking.topCandidates(current, current.length || 1, 0, excluded).length,
    reviewedCount: current.length,
    staleCount: jobs.length - current.length,
    minimumScore: CareerPeelerRanking.MIN_SCORE };
}

function appleRankingReadiness(profile) {
  if (!resolveResumeProfileText(profile)) return "Save your parsed resume or resume summary before ranking jobs.";
  if (!profile.llmEnabled || !hasLlmProviderConfigured(profile) || !isApiKeyValidated(profile)) {
    return "Enable AI Matching and test your OpenAI API key before ranking jobs.";
  }
  if (profile.resumeFileDataUrl && !isCandidateProfileFreshForResume(profile)) {
    return "Extract your current resume before ranking jobs; the saved candidate profile is out of date.";
  }
  return null;
}

async function scoreAppleRankingPosting(details, profile, run) {
  const titleSkip = getHardSkipTitleReason(details.title);
  const requiredYears = Math.max(0, ...(details.requiredExperience || []).map((item) => Number(item.years) || 0));
  const requiredText = `${details.title} ${details.description} ${details.minimumQualifications}`.toLowerCase();
  const exclusion = profile.noMatchKeywords.find((term) =>
    new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`, "i").test(requiredText));
  const hardSkip = titleSkip || (exclusion ? `Matches your excluded keyword: ${exclusion}.` : null) || (requiredYears > profile.userYearsOfExperience
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

async function startAppleJobRanking(tab, userProfile) {
  if (scanState.running || appleRankingIsRunning() || submittedRoleAnalysisRuns.size) return { ok: false, error: "Stop the current scan before ranking jobs." };
  const profile = normalizeUserProfile(userProfile);
  const error = appleRankingReadiness(profile);
  if (error) return { ok: false, error };
  const url = parseUrl(tab?.url);
  if (!tab?.id || url?.origin !== "https://jobs.apple.com" || !/^\/[a-z]{2}-[a-z]{2}\/search\/?$/i.test(url.pathname)) {
    return { ok: false, error: "Open an Apple jobs search with your chosen filters before ranking." };
  }
  url.searchParams.delete("page");
  const searchUrl = url.href;
  const run = { stopRequested: false, sourceTabId: tab.id, searchUrl };
  appleRankingActiveRun = run;
  runAppleJobRanking(run, profile).catch((error) => { appleRankingActiveRun = null; console.error(error); });
  return { ok: true };
}

async function runAppleJobRanking(run, profile) {
  const state = await readAppleRankingState();
  const profileSignature = appleRankingProfileSignature(profile);
  const searchKey = fingerprintText(run.searchUrl);
  const search = { url: run.searchUrl, pagesRead: 0, jobsRead: 0, alreadyApplied: 0,
    applicationReview: 0, complete: false, startedAt: Date.now() };
  state.searches[searchKey] = search;
  state.running = true;
  state.phase = "Ranking filtered Apple jobs";
  state.error = null;
  state.scoresReused = 0;
  state.scoresFetched = 0;
  let listTab;
  try {
    await saveAppleRankingState(state);
    listTab = await chrome.tabs.create({ url: run.searchUrl, active: true });
    await waitForTabComplete(listTab.id);
    const visited = new Set();
    const seen = new Set();
    const stored = await chrome.storage.local.get(APPLIED_JOBS_KEY);
    const applied = new Set(Object.values(stored[APPLIED_JOBS_KEY] || {}).filter((job) => job.site === "apple").map((job) => CareerPeelerRanking.idOf(job.jobId)));
    for (let pageIndex = 0; pageIndex < 1000 && !run.stopRequested; pageIndex += 1) {
      const response = await sendMessageWithFallback(listTab.id, { type: "APPLE_CAREERS_COLLECT_JOB_LINKS" });
      if (!response?.ok) throw new Error("The filtered Apple jobs list could not be read.");
      const page = response.data;
      if (!page.links?.length) throw new Error("No jobs were found on this search page. Check the filters or sign in again.");
      const signature = page.links.map((job) => CareerPeelerRanking.idOf(job.jobId)).sort().join("|");
      if (visited.has(signature)) throw new Error("Apple repeated a search page before the full filtered list was ranked.");
      visited.add(signature);
      for (const link of page.links) {
        if (run.stopRequested) break;
        const id = CareerPeelerRanking.idOf(link.jobId);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        search.jobsRead += 1;
        state.phase = `Ranking page ${pageIndex + 1}: ${link.title}`;
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
          await saveAppleRankingState(state);
        }
        const titleSkip = getHardSkipTitleReason(link.title);
        if (titleSkip) {
          state.jobs[id] = { ...link, profileSignature, eligible: false, score: 0, reason: titleSkip, blockers: [titleSkip], sourceKey: searchKey };
          await saveAppleRankingState(state);
          continue;
        }
        const extracted = await fetchAppleSubmittedRoleDetails([link], { shouldStop: () => run.stopRequested });
        if (run.stopRequested) break;
        const details = extracted.detailsByJobId.get(String(link.jobId));
        if (!details?.description || !details.minimumQualifications) {
          state.jobs[id] = { ...link, profileSignature, eligible: false, score: null,
            reason: "Full description or minimum qualifications could not be retrieved; automatic application is disabled.", sourceKey: searchKey };
        } else {
          const postingSignature = fingerprintText(JSON.stringify(CareerPeelerRanking.postingInput(details)));
          const reusable = prior?.profileSignature === profileSignature && prior.postingSignature === postingSignature &&
            Date.now() - Number(prior.scoredAt || 0) < 30 * 86400000;
          const result = reusable ? revalidateAppleRankingJob(prior, details, profile) : await scoreAppleRankingPosting(details, profile, run);
          if (reusable) state.scoresReused += 1;
          else state.scoresFetched += 1;
          state.jobs[id] = { ...link, ...result, title: details.title || link.title, url: details.url || link.url,
            profileSignature, postingSignature, scoredAt: reusable ? prior.scoredAt : Date.now(),
            sourceKey: searchKey, queueStatus: prior?.queueStatus === "queued" && result.breakdown ? "queued" : "available" };
        }
        await saveAppleRankingState(state);
        if (!prior || prior.profileSignature !== profileSignature) await delay(1500);
      }
      if (run.stopRequested) break;
      search.pagesRead += 1;
      await saveAppleRankingState(state);
      if (!page.hasNextPage) { search.complete = true; break; }
      const next = await sendMessageWithFallback(listTab.id, { type: "APPLE_CAREERS_GO_TO_NEXT_PAGE" });
      if (!next?.ok) throw new Error("Apple's next search page could not be opened. Saved rankings are available.");
      if (next.action === "navigate") await waitForTabComplete(listTab.id);
      await delay(750);
    }
    if (!search.complete && !run.stopRequested) throw new Error("The search reached the page limit before finishing; saved results are partial.");
    state.phase = run.stopRequested ? "Ranking stopped; results saved" : "Filtered search ranked";
  } catch (error) {
    state.error = error?.message || "Ranking stopped unexpectedly.";
    state.phase = "Ranking paused; results saved";
  } finally {
    state.running = false;
    search.finishedAt = Date.now();
    if (listTab?.id) await chrome.tabs.remove(listTab.id).catch(() => {});
    await activateTab(run.sourceTabId).catch(() => {});
    await saveAppleRankingState(state).catch(console.error);
    appleRankingActiveRun = null;
  }
}

async function queueTopAppleJobs(userProfile, topN) {
  return editAppleJobQueue(async () => {
    const view = await getAppleRankingView(userProfile, topN);
    if (!view.candidates.length) return { ok: false,
      error: "No scored, unapplied jobs are available to queue for your current resume. Rank a filtered search first; excluded and unfinished jobs cannot be queued." };
    const state = await readAppleRankingState();
    for (const job of view.candidates) state.jobs[CareerPeelerRanking.idOf(job.jobId)] = { ...job, queueStatus: "queued" };
    await saveAppleRankingState(state);
    return { ok: true, count: view.candidates.length, reviewCount: view.candidates.filter((job) => !job.eligible).length };
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

async function refreshAppleQueueCapacity(state) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: "https://jobs.apple.com/app/en-us/profile/roles", active: true });
    await waitForTabComplete(tab.id);
    await delay(750);
    const result = await sendMessageWithFallback(tab.id, { type: "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES" });
    if (!result?.ok || !Array.isArray(result.data?.pages) || result.data.pages.length !== result.data.pageCount) {
      throw new Error("Sign in to Apple Your Roles so the queue can verify your active submission count.");
    }
    state.capacitySnapshot = { complete: true, roles: result.data.pages.flatMap((page) => page.roles),
      scannedAt: Date.now(), updatedAt: Date.now() };
    const ids = new Set(state.capacitySnapshot.roles.filter((role) => role.active !== false).map((role) => CareerPeelerRanking.idOf(role.jobId)));
    for (const job of Object.values(state.jobs)) {
      if (ids.has(CareerPeelerRanking.idOf(job.jobId))) { job.queueStatus = "submitted"; continue; }
      if (["uncertain", "applying"].includes(job.queueStatus)) job.queueStatus = "needs_review";
    }
    state.reservations = [];
    await saveAppleRankingState(state);
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function startAppleJobQueue(tab, userProfile, reviewAcknowledgement = null) {
  if (scanState.running || appleRankingIsRunning() || submittedRoleAnalysisRuns.size) return { ok: false, error: "Stop the current scan before applying the queue." };
  const profile = normalizeUserProfile({ ...userProfile, scanMode: "auto_apply", llmEnabled: true });
  const error = appleRankingReadiness(profile) || getAutoApplyReadinessError(profile);
  if (error) return { ok: false, error };
  if (!tab?.id || getSiteConfig(tab.url)?.id !== "apple") return { ok: false, error: "Open Apple Careers before starting the queue." };
  const run = { stopRequested: false, sourceTabId: tab.id, applying: true };
  appleRankingActiveRun = run;
  try {
    const view = await getAppleRankingView(profile);
    if (!view.queued.length) {
      appleRankingActiveRun = null;
      return { ok: false, error: "Queue top-ranked jobs for your current resume first." };
    }
    if (view.queueReviewToken && reviewAcknowledgement !== view.queueReviewToken) {
      appleRankingActiveRun = null;
      return { ok: false, error: "Review the saved queue's match concerns and acknowledge them before applying. If the queue or assessment changed, review it again." };
    }
    run.reviewedJobs = Object.fromEntries(view.queued.filter((job) => !job.eligible)
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
  appleRankingActiveRun = { stopRequested: false, sourceTabId: tab.id };
  let state;
  try {
    state = await readAppleRankingState();
    state.running = true;
    state.phase = "Refreshing active submission count";
    state.error = null;
    await saveAppleRankingState(state);
    await refreshAppleQueueCapacity(state);
    state.phase = "Active submission count refreshed";
    return { ok: true };
  } catch (error) {
    const message = error?.message || "The submission count could not be checked.";
    if (state) { state.error = message; state.phase = "Submission count unavailable"; }
    return { ok: false, error: message };
  } finally {
    if (state) { state.running = false; await saveAppleRankingState(state).catch(console.error); }
    await activateTab(tab.id).catch(() => {});
    appleRankingActiveRun = null;
  }
}

async function runAppleJobQueue(run, profile) {
  const state = await readAppleRankingState();
  const signature = appleRankingProfileSignature(profile);
  state.running = true;
  state.phase = "Checking Apple submission capacity";
  state.error = null;
  try {
    await saveAppleRankingState(state);
    await refreshAppleQueueCapacity(state);
    if (run.stopRequested) return;
    const cache = (await chrome.storage.local.get(APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY))[APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY] || {};
    for (const [id, job] of Object.entries(state.jobs)) {
      if (job.profileSignature !== signature || job.queueStatus !== "queued") continue;
      const checked = revalidateAppleRankingJob(job, cache[id] || cache[String(job.jobId)], profile);
      state.jobs[id] = { ...checked, queueStatus: "queued" };
    }
    await saveAppleRankingState(state);
    await initializeKnownSiteScanActivity(profile);
    scanState = { ...createIdleState(), running: true, phase: "Applying ranked queue", userProfile: profile,
      listTabId: run.sourceTabId, site: "apple", siteLabel: "Apple Careers" };
    await saveScanState();
    const stored = await chrome.storage.local.get(APPLIED_JOBS_KEY);
    const excluded = [...Object.values(stored[APPLIED_JOBS_KEY] || {}).filter((job) => job.site === "apple").map((job) => job.jobId),
      ...(state.withdrawnIds || [])];
    const queued = CareerPeelerRanking.rankedCandidates(Object.values(state.jobs).filter((job) =>
      job.queueStatus === "queued" && job.profileSignature === signature), Object.keys(state.jobs).length || 1, 0, excluded);
    for (const job of queued) {
      if (run.stopRequested || !scanState.running) break;
      if (!job.eligible && run.reviewedJobs?.[CareerPeelerRanking.idOf(job.jobId)] !== appleQueuedJobReviewSignature(job)) {
        throw new Error("A queued job's match concerns changed. Review and acknowledge the saved queue again before applying.");
      }
      const capacity = await appleRankingCapacity(state);
      if (!capacity.known || capacity.remaining <= 0) { state.phase = "50-application target reached; remaining jobs stay queued"; break; }
      state.phase = `Applying ${job.title} (${job.score}%)`;
      await saveAppleRankingState(state);
      await closeOwnedWorkflowTabs();
      const detailTab = await createActiveWorkflowTab(job.url);
      await waitForTabComplete(detailTab.id);
      const live = await waitForAppleSubmittedRoleDetails(detailTab.id, job.jobId);
      if (!live || fingerprintText(JSON.stringify(CareerPeelerRanking.postingInput(live))) !== job.postingSignature) {
        job.eligible = false;
        job.queueStatus = "needs_review";
        job.reason = "The posting changed or is unavailable; rank it again before applying.";
        const cache = (await chrome.storage.local.get(APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY))[APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY] || {};
        delete cache[CareerPeelerRanking.idOf(job.jobId)];
        await chrome.storage.local.set({ [APPLE_SUBMITTED_ROLE_DETAILS_CACHE_KEY]: cache });
        await saveAppleRankingState(state);
        continue;
      }
      const status = await sendMessageWithFallback(detailTab.id, { type: "APPLE_CAREERS_EXTRACT_JOB",
        resumeProfileText: resolveResumeProfileText(profile), userYearsOfExperience: profile.userYearsOfExperience });
      if (!status?.ok) throw new Error("The job's current application status could not be checked.");
      if (run.stopRequested || !scanState.running) break;
      job.queueStatus = "applying";
      state.reservations.push({ jobId: job.jobId, startedAt: Date.now() });
      await saveAppleRankingState(state); // Reserve before clicking; interrupted submissions are never replayed automatically.
      if (status.data.alreadySubmitted) {
        job.queueStatus = "submitted";
        await saveAppleRankingState(state);
        continue;
      }
      const result = await runApplicationWorkflow(detailTab, { userProfile: profile, stopIfScanStopped: true,
        activitySteps: currentScanActivitySteps, jobContext: { ...job, site: "apple", siteLabel: "Apple Careers" } });
      if (result.ok && (result.data?.submitted || result.data?.alreadySubmitted)) {
        job.queueStatus = "submitted";
      } else if (result.ok && result.data?.pausedForReview) {
        job.queueStatus = "needs_review";
        job.reason = result.data.summary || "Application needs your review.";
        state.reservations = state.reservations.filter((item) => item.jobId !== job.jobId);
      } else {
        job.queueStatus = "uncertain";
        throw new Error(result.error || "Application outcome is uncertain. The queue stopped and reserved this slot until Apple is checked again.");
      }
      await saveAppleRankingState(state);
    }
    if (!state.phase.includes("target reached")) state.phase = run.stopRequested ? "Application queue stopped" : "Application queue finished";
  } catch (error) {
    state.error = error?.message || "Application queue stopped unexpectedly.";
    state.phase = "Application queue paused";
  } finally {
    state.running = false;
    scanState.running = false;
    scanState.phase = state.phase;
    await saveScanState().catch(console.error);
    await finishKnownSiteScanRun().catch(console.error);
    await activateTab(run.sourceTabId).catch(() => {});
    await saveAppleRankingState(state).catch(console.error);
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
