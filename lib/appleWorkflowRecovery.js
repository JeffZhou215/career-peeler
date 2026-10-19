// The journal is separate from ranking snapshots so stale UI/queue writes cannot
// erase cancellation or permission already granted to a content script.
const APPLE_WORKFLOW_KEY = "appleApplicationWorkflow";
const appleWorkerOwner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let appleWorkflowSequence = 0;
let appleWorkflowCancelGeneration = 0;

function appleWorkflowError(message, code = "workflow_recovery_required") {
  return Object.assign(new Error(message), { code });
}

async function claimAppleApplicationSession(jobs = [], context = {}) {
  const id = `${appleWorkerOwner}-${++appleWorkflowSequence}`;
  const cancelGeneration = context.cancelGeneration ?? appleWorkflowCancelGeneration;
  await CareerPeelerJobStore.updateMetadata(APPLE_WORKFLOW_KEY, prior => {
    if (prior?.reconciliationRequired) throw appleWorkflowError("An interrupted application needs reconciliation. Sync Submissions before starting another application.");
    if (prior?.status === "running") throw appleWorkflowError("An application workflow already owns this session.", "workflow_owner_conflict");
    if (jobs.some(job => prior?.jobs?.[String(job.jobId)]?.state === "submitted" ||
      Object.values(appliedJobLedger).some(record => record.site === "apple" && String(record.jobId) === String(job.jobId)))) {
      throw appleWorkflowError("This reviewed Apple role already has a confirmed submission.", "already_applied");
    }
    const unresolved = Object.fromEntries(Object.entries(prior?.jobs || {}).filter(([, job]) => job.state === "uncertain"));
    if (jobs.some(job => unresolved[String(job.jobId)])) {
      throw appleWorkflowError("This role's previous Submit outcome remains unknown. Inventory absence does not authorize replay; review it manually on Apple Careers.");
    }
    const stopped = Boolean(context.stopRequested || cancelGeneration !== appleWorkflowCancelGeneration);
    return { version: 1, id, owner: appleWorkerOwner, status: stopped ? "cancelled" : "running", stopRequested: stopped,
      reconciliationRequired: false, startedAt: Date.now(), sourceTabId: context.sourceTabId,
      sourceWindowId: context.sourceWindowId, jobs: { ...unresolved, ...Object.fromEntries(jobs.map(job =>
        [String(job.jobId), { jobId: String(job.jobId), title: job.title, url: job.url, workflowSessionId: id,
          state: "not_started", submissionOutcome: "not_attempted", submissionAttemptCount: 0 }])) },
      currentJobId: null };
  });
  return id;
}

async function updateAppleApplicationSession(id, update, { allowStopped = false } = {}) {
  return CareerPeelerJobStore.updateMetadata(APPLE_WORKFLOW_KEY, state => {
    if (!state || state.id !== id || state.owner !== appleWorkerOwner ||
      (!allowStopped && (state.status !== "running" || state.stopRequested))) {
      throw appleWorkflowError("The application owner was stopped or replaced. Review the interrupted role before continuing.", "workflow_owner_revoked");
    }
    update(state);
    state.updatedAt = Date.now();
    return state;
  });
}

async function checkpointAppleWorkflowStep(id, job, tabId) {
  const stepId = `${id}-step-${++appleWorkflowSequence}`;
  await updateAppleApplicationSession(id, state => {
    const jobId = String(job.jobId);
    const prior = state.jobs[jobId];
    if (prior?.stepPending) throw appleWorkflowError("A workflow step is already executing for this role.", "workflow_owner_conflict");
    if (prior && ["submitted", "uncertain", "failed"].includes(prior.state)) {
      throw appleWorkflowError("This role already has an application result and cannot be processed again.");
    }
    state.currentJobId = jobId;
    state.jobs[jobId] = { ...prior, jobId, title: prior?.title || job.title, url: prior?.url || job.url,
      state: "in_progress", tabId, stepId,
      stepPending: true, submissionOutcome: prior?.submissionOutcome || "not_attempted",
      submissionAttemptCount: prior?.submissionAttemptCount || 0 };
  });
  return stepId;
}

async function authorizeAppleWorkflowAction(message, sender) {
  const { workflowSessionId: id, workflowStepId: stepId, expectedJobId: jobId } = message;
  await updateAppleApplicationSession(id, state => {
    const job = state.jobs[jobId];
    if (!job || state.currentJobId !== jobId || job.stepId !== stepId || !job.stepPending || job.tabId !== sender.tab?.id) {
      throw appleWorkflowError("The action does not belong to the active reviewed application.", "workflow_owner_conflict");
    }
    if (!CareerPeelerApplicationSafety.matchesJob(jobId, sender.tab.url)) {
      throw appleWorkflowError("The active page does not identify the reviewed Apple role.", "job_identity_mismatch");
    }
    if (job.submissionOutcome === "unknown" || job.state === "submitted") {
      throw appleWorkflowError("A previous Submit result is unresolved; no further application actions are allowed.");
    }
    if (message.action === "submit") {
      if (job.submitAuthorizedStep === stepId || job.submissionAttemptCount >= 3) {
        throw appleWorkflowError("Submit permission has already been used or its attempt limit was reached.");
      }
      job.submitAuthorizedStep = stepId;
      job.submissionAttemptCount += 1;
      job.submissionOutcome = "unknown";
      job.state = "uncertain";
      job.submitIntentAt = Date.now();
    }
  });
  return { ok: true };
}

async function checkpointAppleWorkflowResult(id, jobId, stepId, result) {
  await updateAppleApplicationSession(id, state => {
    const job = state.jobs[jobId];
    if (!job || job.stepId !== stepId || result.expectedJobId !== jobId || result.identityVerified !== true) {
      throw appleWorkflowError("The application result did not verify the original Apple job identity.", "job_identity_mismatch");
    }
    const clicked = (result.steps || []).filter(step => step.step === "Submit application" && step.status === "clicked").length;
    job.submissionAttemptCount = Math.max(job.submissionAttemptCount || 0,
      (job.acknowledgedAttemptCount || 0) + clicked);
    job.acknowledgedAttemptCount = job.submissionAttemptCount;
    job.submissionOutcome = result.done ? "confirmed" : result.submissionOutcome ||
      (clicked ? "unknown" : job.submissionOutcome || "not_attempted");
    job.state = result.done ? "submitted" : job.submissionOutcome === "unknown" ? "uncertain"
      : result.pausedForReview || !result.clicked ? "failed" : "in_progress";
    job.stepPending = false;
    job.lastStep = result.steps?.at(-1)?.step || null;
    job.reason = result.summary;
    job.errorType = result.errorType || null;
    job.applicationHeading = result.heading || null;
    job.visibleActions = result.visibleActions || [];
    job.alreadySubmitted = Boolean(result.alreadySubmitted);
    job.resultAt = Date.now();
    if (job.state === "uncertain") state.reconciliationRequired = true;
  }, { allowStopped: true });
}

async function recordAppleSubmitObservation(message, sender) {
  await updateAppleApplicationSession(message.workflowSessionId, state => {
    const job = state.jobs[message.expectedJobId];
    if (!job || state.currentJobId !== message.expectedJobId || job.tabId !== sender.tab?.id ||
      job.stepId !== message.workflowStepId || job.submitAuthorizedStep !== message.workflowStepId ||
      !job.stepPending || job.submissionOutcome !== "unknown" || message.identityVerified !== true ||
      !["confirmed", "rejected"].includes(message.submissionOutcome)) {
      throw appleWorkflowError("The Submit observation does not belong to the pending reviewed application.");
    }
    if (!CareerPeelerApplicationSafety.matchesJob(message.expectedJobId, sender.tab.url) &&
      !(message.submissionOutcome === "confirmed" && CareerPeelerApplicationSafety.isConfirmationUrl(sender.tab.url))) {
      throw appleWorkflowError("The Submit observation did not verify the reviewed Apple page.", "job_identity_mismatch");
    }
    job.submissionOutcome = message.submissionOutcome;
    job.state = message.submissionOutcome === "confirmed" ? "submitted" : "in_progress";
    job.resultAt = Date.now();
  });
  return { ok: true };
}

async function finishAppleApplicationSession(id) {
  await updateAppleApplicationSession(id, state => {
    const job = state.jobs[state.currentJobId];
    if (job?.stepPending) {
      if (job.submissionOutcome === "unknown") job.state = "uncertain";
      state.reconciliationRequired = true;
    }
    if (job?.state === "in_progress" && !job.stepPending) job.state = "failed";
    state.status = state.stopRequested ? "cancelled" : state.reconciliationRequired ? "paused" : "completed";
    state.finishedAt = Date.now();
  }, { allowStopped: true });
}

async function cancelAppleApplicationSession() {
  appleWorkflowCancelGeneration += 1;
  const journal = await CareerPeelerJobStore.updateMetadata(APPLE_WORKFLOW_KEY, state => {
    if (!state || !["running", "paused", "cancelled"].includes(state.status)) return state || {};
    state.stopRequested = true;
    state.status = "cancelled";
    state.cancelledAt ||= Date.now();
    const job = state.jobs[state.currentJobId];
    if (job?.submissionOutcome === "unknown") state.reconciliationRequired = true;
    return state;
  });
  await quiesceRecoveredAppleWorkflow();
  return journal;
}

async function quiesceRecoveredAppleWorkflow() {
  const journal = await CareerPeelerJobStore.getMetadata(APPLE_WORKFLOW_KEY);
  if (!journal?.id || journal.status === "running" || journal.status === "completed") return;
  for (const tabId of new Set(Object.values(journal.jobs || {}).map(job => job.tabId).filter(Boolean))) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) continue;
    const sessionIds = new Set(Object.values(journal.jobs).filter(job => job.tabId === tabId).map(job => job.workflowSessionId || journal.id));
    for (const workflowSessionId of sessionIds) {
      const reply = await chrome.tabs.sendMessage(tabId, { type: "APPLE_CAREERS_REVOKE_WORKFLOW", workflowSessionId }).catch(() => null);
      if (!reply?.ok || reply.workflowSessionId !== workflowSessionId) {
        throw appleWorkflowError("The interrupted application tab could not be stopped. Close that tab, then Sync Submissions.");
      }
    }
  }
}

async function recoverAppleApplicationSession() {
  let restore = false;
  const journal = await CareerPeelerJobStore.updateMetadata(APPLE_WORKFLOW_KEY, state => {
    if (!state?.id || state.owner === appleWorkerOwner) return state || {};
    restore = true;
    state.owner = appleWorkerOwner;
    state.recoveredAt ||= Date.now();
    if (["running", "paused", "cancelled"].includes(state.status)) {
      const interrupted = state.status === "running";
      state.status = state.stopRequested ? "cancelled" : "paused";
      state.reconciliationRequired ||= interrupted;
      for (const job of Object.values(state.jobs)) {
        if (job.submissionOutcome === "unknown") job.state = "uncertain";
      }
    }
    return state;
  });
  if (!journal.recoveredAt || !restore && !journal.reconciliationRequired) return journal;
  // A page may still be awaiting an LLM answer when its background owner dies.
  // Deny old commands now; inability to contact it keeps reconciliation blocked.
  await quiesceRecoveredAppleWorkflow().catch(error => console.warn(error.message));
  const state = await readAppleRankingState();
  const changed = [], failures = [];
  for (const job of Object.values(journal.jobs)) {
    if (job.state === "not_started") continue;
    const id = CareerPeelerRanking.idOf(job.jobId);
    const submitted = job.state === "submitted";
    const unknown = job.state === "uncertain";
    if (submitted && !appliedJobLedger[`apple:${job.jobId}`]) {
      rememberAppliedJob({ ...job, site: "apple", siteLabel: "Apple Careers",
        appliedAt: new Date(job.resultAt || journal.startedAt).toISOString() }, job.alreadySubmitted ? "submitted" : "applied");
    }
    if ((unknown || submitted) && !(state.reservations || []).some(item => String(item.jobId) === job.jobId)) {
      (state.reservations ||= []).push({ jobId: job.jobId, startedAt: job.resultAt || job.submitIntentAt || journal.startedAt });
    }
    if (state.jobs[id] && String(state.jobs[id].jobId) !== job.jobId) continue;
    // A completed, acknowledged failure is not a worker interruption. Preserve
    // its actual diagnosis, including when a later worker starts for other work.
    const knownFailure = job.state === "failed" && !job.stepPending && job.resultAt &&
      ["not_attempted", "rejected"].includes(job.submissionOutcome);
    if (knownFailure) {
      const prior = state.applicationFailures[id];
      if (!prior || (prior.jobId === job.jobId && (prior.legacy || prior.errorType === "worker_interrupted") &&
          !prior.resolvedAt && prior.status !== "submitted")) {
        state.applicationFailures[id] = { ...prior, jobId: job.jobId, title: job.title, url: job.url,
          status: "needs_review", errorType: job.errorType || "manual_review_required",
          reason: job.reason || "This application stopped for manual review; no submission was confirmed.",
          lastStep: job.lastStep || null, failedAt: job.resultAt, submissionOutcomeUnknown: false,
          applicationHeading: job.applicationHeading || prior?.applicationHeading || null,
          visibleActions: job.visibleActions || prior?.visibleActions || [] };
        failures.push(id);
      }
      if (state.jobs[id]?.queueStatus === "applying") {
        state.jobs[id].queueStatus = "needs_review";
        changed.push(id);
      }
      continue;
    }
    if (state.jobs[id]) {
      state.jobs[id].queueStatus = submitted ? "submitted" : unknown ? "uncertain" : "needs_review";
      changed.push(id);
    }
    if (!submitted) {
      state.applicationFailures[id] = { ...state.applicationFailures[id], jobId: job.jobId, title: job.title, url: job.url,
        status: unknown ? "uncertain" : "needs_review", errorType: "worker_interrupted",
        reason: "The extension worker restarted. Sync Submissions and review this role before applying again.",
        lastStep: job.lastStep || (job.submitIntentAt ? "Submit outcome unknown" : "Application interrupted"),
        failedAt: journal.recoveredAt, submissionOutcomeUnknown: unknown };
      failures.push(id);
    }
  }
  // An old completed application journal must not replace a newer scan's
  // progress or error. Its per-job results can still repair missing history.
  const restoreProgress = journal.status !== "completed" || !state.phase ||
    /^(?:Applying |Application queue|Checking Apple submission)/i.test(state.phase);
  if (!restoreProgress) {
    if (changed.length || failures.length) await saveAppleRankingState(state, { jobs: changed, applicationFailures: failures });
    return journal;
  }
  state.running = false;
  state.currentJob = journal.status === "completed" ? null : journal.jobs[journal.currentJobId] || null;
  state.errorJobId = journal.status === "completed" ? null : journal.currentJobId;
  state.phase = journal.stopRequested ? "Application stopped" : journal.status === "completed"
    ? "Application queue finished" : "Application interrupted; reconciliation required";
  state.error = journal.reconciliationRequired ? "The worker restarted. Sync Submissions before starting another application; no application was resumed." : null;
  const jobs = Object.values(journal.jobs).filter(job => !job.workflowSessionId || job.workflowSessionId === journal.id);
  state.lastBatchSummary = { submitted: jobs.filter(job => job.state === "submitted" && !job.alreadySubmitted).length,
    alreadySubmitted: jobs.filter(job => job.state === "submitted" && job.alreadySubmitted).length,
    failed: jobs.filter(job => job.state === "failed" || job.state === "uncertain").length,
    remainingQueued: jobs.filter(job => job.state === "not_started").length, finishedAt: journal.finishedAt || journal.recoveredAt };
  await saveAppleRankingState(state, { jobs: changed, applicationFailures: failures });
  scanState.running = false;
  scanState.currentJob = state.currentJob;
  scanState.phase = state.phase;
  await saveScanState();
  const saved = await CareerPeelerJobStore.get(KNOWN_SITE_ACTIVITY_KEY);
  const activity = saved[KNOWN_SITE_ACTIVITY_KEY];
  if (activity?.running) {
    activity.running = false;
    for (const cycle of activity.cycles || []) {
      if (cycle.status !== "running") continue;
      const job = journal.jobs[String(cycle.jobId)];
      cycle.status = job?.state === "submitted" ? "success" : "attention";
      cycle.outcome = job?.state === "submitted" ? "Submitted (Confirmed Before Restart)" : journal.stopRequested ? "Stopped" : "Interrupted; Reconciliation Required";
      cycle.completedAt = journal.recoveredAt;
    }
    for (const step of activity.steps || []) if (step.status === "pending") {
      step.status = "error"; step.detail = "Interrupted by worker restart; completion was not confirmed.";
    }
    await CareerPeelerJobStore.set({ [KNOWN_SITE_ACTIVITY_KEY]: activity });
  }
  return journal;
}

function appleWorkflowHasConfirmedSubmission(job) {
  return job.state === "submitted" && job.submissionOutcome === "confirmed";
}

function appleWorkflowNeverAuthorizedSubmit(job, session) {
  return session.status !== "running" && ["in_progress", "failed"].includes(job.state) &&
    job.submissionOutcome === "not_attempted" && job.submissionAttemptCount === 0 &&
    (job.acknowledgedAttemptCount === undefined || job.acknowledgedAttemptCount === 0) &&
    job.submitIntentAt === undefined && job.submitAuthorizedStep === undefined;
}

async function reconcileAppleApplicationSession(inventory) {
  if (!inventory.complete || !["confirmed", "confirmed_empty"].includes(inventory.inventoryState)) {
    throw appleWorkflowError("A complete authenticated Apple inventory is required for recovery.");
  }
  // A delayed ordinary form action must lose the old owner's permission before
  // a never-submitted interruption can be released for fresh user review.
  await quiesceRecoveredAppleWorkflow();
  const journal = await CareerPeelerJobStore.updateMetadata(APPLE_WORKFLOW_KEY, state => {
    if (!state?.id) return state || {};
    for (const job of Object.values(state.jobs)) {
      if (job.state === "not_started") continue;
      if (!state.reconciliationRequired && job.state !== "uncertain") continue;
      // A confirmed result was durably recorded before the worker stopped.
      // Apple's later base-only inventory cannot erase or weaken that proof.
      if (appleWorkflowHasConfirmedSubmission(job)) continue;
      const role = inventory.roles.find(role => String(role.jobId) === job.jobId);
      if (!role && appleWorkflowNeverAuthorizedSubmit(job, state)) {
        job.state = "failed";
        job.stepPending = false;
        job.reconciliation = "not_attempted";
        job.reconciledAt = Date.now();
        job.reason = "The application workflow stopped before Submit was authorized. Review the role before starting a new application.";
        continue;
      }
      if (!role && inventory.roles.some(role => CareerPeelerRanking.idOf(role.jobId) === CareerPeelerRanking.idOf(job.jobId))) {
        throw appleWorkflowError("The recovered role's full Apple job ID could not be reconciled.", "job_identity_mismatch");
      }
      job.reconciliation = role ? "present" : "absent";
      job.reconciledAt = Date.now();
      if (role) {
        if (job.state !== "submitted") job.alreadySubmitted = true;
        job.state = "submitted"; job.submissionOutcome = "confirmed";
      }
      // A complete list can precede a delayed Submit response. Absence permits
      // reconciliation of other jobs, but cannot release this slot or replay it.
    }
    state.reconciliationRequired = false;
    state.reconciledAt = Date.now();
    return state;
  });
  let changed = false;
  for (const job of Object.values(journal.jobs || {})) {
    if (job.state === "submitted" && !appliedJobLedger[`apple:${job.jobId}`]) {
      rememberAppliedJob({ ...job, site: "apple", siteLabel: "Apple Careers", appliedAt: new Date(job.resultAt || Date.now()).toISOString() }, "submitted");
      changed = true;
    }
  }
  if (changed) await saveScanState();
  return journal;
}

function unresolvedAppleWorkflowReservations(journal) {
  return Object.values(journal?.jobs || {}).filter(job => job.state === "uncertain").map(job =>
    ({ jobId: job.jobId, startedAt: job.submitIntentAt || journal.startedAt }));
}

// Inventory verification and exact application recovery answer different questions.
// Apple's Active list can use an unsuffixed ID, which proves the count but not
// the outcome of a previously reviewed location-specific application.
async function reconcileAppleApplicationInventory(inventory) {
  try {
    return { workflow: await reconcileAppleApplicationSession(inventory), blockedJobIds: [], recoveryWarning: null };
  } catch (error) {
    if (error?.code !== "job_identity_mismatch") throw error;
    let blocked;
    const workflow = await CareerPeelerJobStore.updateMetadata(APPLE_WORKFLOW_KEY, state => {
      blocked = Object.values(state?.jobs || {}).filter(job => job.state !== "not_started" &&
        (state.reconciliationRequired || job.state === "uncertain") &&
        !appleWorkflowHasConfirmedSubmission(job) && !appleWorkflowNeverAuthorizedSubmit(job, state) &&
        !inventory.roles.some(role => String(role.jobId) === String(job.jobId)) &&
        inventory.roles.some(role => CareerPeelerRanking.idOf(role.jobId) === CareerPeelerRanking.idOf(job.jobId)));
      if (!state?.id || !blocked.length) throw error;
      // An earlier absent inventory can have cleared the global gate while
      // retaining an uncertain job. A later ambiguous presence must gate again.
      state.reconciliationRequired = true;
      return state;
    });
    const job = blocked.find(job => job.state === "uncertain") || blocked[0];
    return { workflow, blockedJobIds: blocked.map(job => String(job.jobId)), recoveryWarning: {
      message: `Application needs review: Apple's Active list does not verify the exact job ID ${job.jobId}. Automatic applications remain paused.`,
      jobId: String(job.jobId), title: job.title || "Interrupted Application",
      url: CareerPeelerApplicationSafety.matchesJob(job.jobId, job.url) ? job.url : null
    } };
  }
}
