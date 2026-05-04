const JOB_RECORDS_KEY = "appleCareersJobRecords";
const SCAN_STATUS_KEY = "appleCareersScanStatus";
const PAGE_SETTLE_DELAY_MS = 1500;
const TAB_LOAD_TIMEOUT_MS = 25000;
const DEFAULT_USER_YOE = 2;
const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const DEFAULT_SCAN_MODE = "scan_only";
const MAX_STORED_JOB_RECORDS = 100;
const MAX_TEXT_FIELD_LENGTH = 500;

const processedUrls = new Set();
const visitedListPages = new Set();

let scanState = createIdleState();

function isAppleCareersUrl(url) {
  return (
    url?.startsWith("https://jobs.apple.com/") ||
    url?.startsWith("https://www.apple.com/careers/")
  );
}

function createIdleState() {
  return {
    running: false,
    phase: "Idle",
    listTabId: null,
    listPageUrl: null,
    queued: 0,
    scanned: 0,
    pageCount: 0,
    currentJob: null,
    currentPageStats: null,
    lastError: null,
    completedAt: null,
    stats: {
      submitted: 0,
      applied: 0,
      applyFailed: 0,
      likelyMatch: 0,
      likelySkip: 0,
      review: 0,
      unknown: 0,
      errors: 0
    },
    recent: [],
    failures: [],
    errors: [],
    lastApplied: null,
    userProfile: {
      userYearsOfExperience: DEFAULT_USER_YOE,
      llmEnabled: false,
      llmApiKey: "",
      llmModel: DEFAULT_LLM_MODEL,
      resumeProfile: "",
      scanMode: DEFAULT_SCAN_MODE,
      autoApplyConsent: false
    }
  };
}

function normalizeUserYearsOfExperience(value) {
  const years = Number(value);

  if (!Number.isFinite(years) || years < 0) {
    return DEFAULT_USER_YOE;
  }

  return Math.min(50, years);
}

function normalizeUserProfile(profile = {}) {
  return {
    userYearsOfExperience: normalizeUserYearsOfExperience(profile.userYearsOfExperience),
    llmEnabled: Boolean(profile.llmEnabled),
    llmApiKey: String(profile.llmApiKey || "").trim(),
    llmModel: String(profile.llmModel || DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL,
    resumeProfile: String(profile.resumeProfile || "").trim(),
    scanMode: ["scan_only", "auto_apply"].includes(profile.scanMode) ? profile.scanMode : DEFAULT_SCAN_MODE,
    autoApplyConsent: Boolean(profile.autoApplyConsent)
  };
}

function truncateText(value, maxLength = MAX_TEXT_FIELD_LENGTH) {
  const text = String(value || "");

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function compactAttempt(attempt) {
  if (!attempt) {
    return null;
  }

  return {
    attempt: attempt.attempt,
    url: attempt.url,
    title: truncateText(attempt.title, 160),
    heading: truncateText(attempt.heading, 160),
    summary: truncateText(attempt.summary, 240),
    visibleActions: (attempt.visibleActions || []).slice(0, 10).map((action) => truncateText(action, 80))
  };
}

function compactWorkflow(workflow) {
  if (!workflow) {
    return null;
  }

  return {
    submitted: Boolean(workflow.submitted),
    alreadySubmitted: Boolean(workflow.alreadySubmitted),
    summary: truncateText(workflow.summary, 240),
    attempts: (workflow.attempts || []).slice(-3).map(compactAttempt),
    steps: (workflow.steps || []).slice(-8).map((step) => ({
      attempt: step.attempt,
      step: truncateText(step.step, 120),
      status: step.status,
      label: truncateText(step.label, 120)
    }))
  };
}

function compactLlmMatch(llmMatch) {
  if (!llmMatch) {
    return null;
  }

  return {
    decision: llmMatch.decision,
    confidence: llmMatch.confidence,
    matchedSkills: (llmMatch.matchedSkills || []).slice(0, 8).map((skill) => truncateText(skill, 80)),
    missingSkills: (llmMatch.missingSkills || []).slice(0, 8).map((skill) => truncateText(skill, 80)),
    yoeAssessment: llmMatch.yoeAssessment,
    reason: truncateText(llmMatch.reason, 300)
  };
}

function compactJobRecord(job, status) {
  return {
    jobId: job.jobId,
    title: truncateText(job.title, 220),
    url: job.url,
    status,
    decision: job.decision,
    requiredYears: job.requiredYears,
    reason: truncateText(job.reason, 300),
    failureReason: truncateText(job.failureReason, 300),
    alreadySubmitted: Boolean(job.alreadySubmitted),
    matchSource: job.matchSource || "local",
    llmMatch: compactLlmMatch(job.llmMatch),
    llmError: truncateText(job.llmError, 300),
    resumeMatch: {
      score: job.resumeMatch?.score,
      percentage: job.resumeMatch?.percentage,
      keywords: (job.resumeMatch?.keywords || []).slice(0, 20)
    },
    matchScore: {
      score: job.matchScore?.score,
      percentage: job.matchScore?.percentage,
      positiveScore: job.matchScore?.positiveScore,
      mismatchPenalty: job.matchScore?.mismatchPenalty,
      seniorityPenalty: job.matchScore?.seniorityPenalty,
      overrideCredit: job.matchScore?.overrideCredit,
      keywords: (job.matchScore?.keywords || []).slice(0, 20),
      domainMismatches: (job.matchScore?.domainMismatches || []).slice(0, 10),
      senioritySignals: (job.matchScore?.senioritySignals || []).slice(0, 10),
      overrideTerms: (job.matchScore?.overrideTerms || []).slice(0, 12),
      reasons: (job.matchScore?.reasons || []).slice(0, 20).map((reason) => truncateText(reason, 160))
    },
    applicationResult: compactWorkflow(job.applicationResult),
    updatedAt: job.updatedAt || new Date().toISOString()
  };
}

function compactFailure(failure) {
  return {
    jobId: failure.jobId,
    title: truncateText(failure.title, 220),
    url: failure.url,
    decision: failure.decision,
    resumeMatch: {
      score: failure.resumeMatch?.score,
      percentage: failure.resumeMatch?.percentage,
      keywords: (failure.resumeMatch?.keywords || []).slice(0, 20)
    },
    status: failure.status,
    reason: truncateText(failure.reason, 300),
    workflow: compactWorkflow(failure.workflow),
    failedAt: failure.failedAt
  };
}

function compactError(error) {
  return {
    type: error.type,
    jobId: error.jobId,
    title: truncateText(error.title, 220),
    url: error.url,
    status: error.status,
    message: truncateText(error.message, 300),
    workflow: compactWorkflow(error.workflow),
    lastAttempt: compactAttempt(error.lastAttempt),
    happenedAt: error.happenedAt
  };
}

function isStorageQuotaError(error) {
  return /quota/i.test(error?.message || "");
}

async function saveScanState() {
  await chrome.storage.local.set({
    [SCAN_STATUS_KEY]: scanState
  });
}

async function updateScanState(updates) {
  scanState = {
    ...scanState,
    ...updates
  };

  await saveScanState();
}

function rememberRecent(record) {
  scanState.recent = [
    {
      jobId: record.jobId,
      title: record.title,
      status: record.status,
      decision: record.decision,
      url: record.url,
      matchSource: record.matchSource || "local",
      llmMatch: record.llmMatch || null,
      failureReason: record.failureReason || null
    },
    ...scanState.recent
  ].slice(0, 8);
}

function rememberFailure(failure) {
  scanState.failures = [
    compactFailure({
      ...failure,
      failedAt: new Date().toISOString()
    }),
    ...scanState.failures
  ].slice(0, 5);
}

function rememberError(error) {
  scanState.errors = [
    compactError({
      ...error,
      happenedAt: new Date().toISOString()
    }),
    ...scanState.errors
  ].slice(0, 5);
}

async function saveJobRecord(job, status) {
  const stored = await chrome.storage.local.get(JOB_RECORDS_KEY);
  const records = stored[JOB_RECORDS_KEY] || {};
  const key = job.jobId || job.url;
  const record = compactJobRecord(job, status);

  records[key] = record;
  const compactedRecords = Object.fromEntries(
    Object.entries(records)
      .map(([recordKey, storedRecord]) => [
        recordKey,
        compactJobRecord(storedRecord, storedRecord.status || "unknown")
      ])
      .sort(([, left], [, right]) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, MAX_STORED_JOB_RECORDS)
  );

  try {
    await chrome.storage.local.set({
      [JOB_RECORDS_KEY]: compactedRecords
    });
  } catch (error) {
    if (!isStorageQuotaError(error)) {
      throw error;
    }

    const prunedRecords = Object.fromEntries(Object.entries(compactedRecords).slice(0, 30));
    await chrome.storage.local.set({
      [JOB_RECORDS_KEY]: prunedRecords
    });
  }

  rememberRecent(record);
}

async function compactStoredJobRecords() {
  const stored = await chrome.storage.local.get(JOB_RECORDS_KEY);
  const records = stored[JOB_RECORDS_KEY] || {};
  const compactedRecords = Object.fromEntries(
    Object.entries(records)
      .map(([recordKey, storedRecord]) => [
        recordKey,
        compactJobRecord(storedRecord, storedRecord.status || "unknown")
      ])
      .sort(([, left], [, right]) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, MAX_STORED_JOB_RECORDS)
  );

  try {
    await chrome.storage.local.set({
      [JOB_RECORDS_KEY]: compactedRecords
    });
  } catch (error) {
    if (!isStorageQuotaError(error)) {
      throw error;
    }

    await chrome.storage.local.set({
      [JOB_RECORDS_KEY]: {}
    });
  }
}

function statusFromDecision(decision) {
  if (decision === "Likely match") {
    return "likely_match";
  }

  if (decision === "Likely skip") {
    return "likely_skip";
  }

  if (decision === "Review") {
    return "review";
  }

  return "unknown";
}

function incrementStatsForStatus(status) {
  if (status === "applied") {
    scanState.stats.applied += 1;
    return;
  }

  if (status.endsWith("_apply_failed")) {
    scanState.stats.applyFailed += 1;
    return;
  }

  if (status === "submitted") {
    scanState.stats.submitted += 1;
    return;
  }

  if (status === "likely_match") {
    scanState.stats.likelyMatch += 1;
    return;
  }

  if (status === "likely_skip") {
    scanState.stats.likelySkip += 1;
    return;
  }

  if (status === "review") {
    scanState.stats.review += 1;
    return;
  }

  scanState.stats.unknown += 1;
}

function shouldAutoApply(status) {
  return (
    scanState.userProfile?.scanMode === "auto_apply" &&
    scanState.userProfile?.autoApplyConsent &&
    (status === "likely_match" || status === "review")
  );
}

function getHardSkipTitleReason(title) {
  const normalizedTitle = String(title || "").trim();
  const titleRules = [
    { label: "senior-level", pattern: /\bsenior\b/i },
    { label: "senior-level", pattern: /\bsr\.?(?=\s|$|[-,()/])/i },
    { label: "staff-level", pattern: /\bstaff\b/i },
    { label: "principal-level", pattern: /\bprincipal\b/i },
    { label: "lead-level", pattern: /\blead\b/i },
    { label: "manager-level", pattern: /\bmanager\b/i }
  ];
  const matchedRule = titleRules.find((rule) => rule.pattern.test(normalizedTitle));

  return matchedRule ? `Title appears ${matchedRule.label}: ${normalizedTitle}.` : null;
}

function isLocalHardSkip(job) {
  return (
    job.decision === "Likely skip" &&
    /senior-level|required experience sentence appears to exceed|strong domain mismatch/i.test(job.reason || "")
  );
}

function normalizeLlmDecision(decision) {
  const normalized = String(decision || "").toLowerCase().replace(/[_-]+/g, " ");

  if (normalized.includes("likely match")) {
    return "Likely match";
  }

  if (normalized.includes("likely skip")) {
    return "Likely skip";
  }

  if (normalized.includes("review")) {
    return "Review";
  }

  return "Review";
}

function normalizeYoeAssessment(assessment) {
  const normalized = String(assessment || "").toLowerCase().replace(/[-\s]+/g, "_");

  if (normalized === "too_high") {
    return "too_high";
  }

  if (normalized === "acceptable") {
    return "acceptable";
  }

  return "unclear";
}

function decisionFromLlmResult(parsed) {
  const yoeAssessment = normalizeYoeAssessment(parsed.yoe_assessment);

  if (yoeAssessment === "too_high") {
    return "Likely skip";
  }

  return normalizeLlmDecision(parsed.decision);
}

function buildLlmPrompt(job, userProfile) {
  return [
    {
      role: "system",
      content:
        "You are a cautious job matching assistant. Return only strict JSON. If a role requires more years of experience than user_years_of_experience, yoe_assessment must be too_high and decision must be Likely skip. Prefer Review when uncertain. Do not recommend applying to manager, senior, staff, principal, lead, iOS, firmware, or high-YOE roles unless the provided evidence clearly says otherwise."
    },
    {
      role: "user",
      content: JSON.stringify({
        resume_profile: userProfile.resumeProfile,
        user_years_of_experience: userProfile.userYearsOfExperience,
        local_decision: job.decision,
        local_reason: job.reason,
        job: {
          title: job.title,
          url: job.url,
          required_years: job.requiredYears,
          local_keywords: job.matchScore?.keywords || [],
          text: (job.jobText || job.preview || "").slice(0, 12000)
        },
        output_schema: {
          decision: "Likely match | Review | Likely skip",
          confidence: "number from 0 to 100",
          matched_skills: ["string"],
          missing_skills: ["string"],
          yoe_assessment: "acceptable | too_high | unclear. Use too_high when required YOE is greater than user_years_of_experience.",
          reason: "one short sentence"
        }
      })
    }
  ];
}

function parseLlmJson(content) {
  const trimmed = String(content || "").trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(withoutFence);
}

async function getLlmMatch(job) {
  const userProfile = normalizeUserProfile(scanState.userProfile);

  const skipReasons = [];
  if (!userProfile.llmEnabled) {
    skipReasons.push("LLM matching is disabled");
  }
  if (!userProfile.llmApiKey) {
    skipReasons.push("OpenAI API key is missing");
  }
  if (!userProfile.resumeProfile) {
    skipReasons.push("resume/profile summary is missing");
  }
  if (isLocalHardSkip(job)) {
    skipReasons.push("local hard-skip matched");
  }

  if (skipReasons.length) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userProfile.llmApiKey}`
    },
    body: JSON.stringify({
      model: userProfile.llmModel,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: buildLlmPrompt(job, userProfile)
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[Career Peeler] OpenAI LLM matcher HTTP error", {
      jobId: job.jobId,
      status: response.status,
      statusText: response.statusText,
      body: errorText
    });
    throw new Error(`LLM matcher failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const parsed = parseLlmJson(data.choices?.[0]?.message?.content);

  return {
    decision: decisionFromLlmResult(parsed),
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    matchedSkills: Array.isArray(parsed.matched_skills) ? parsed.matched_skills.slice(0, 12) : [],
    missingSkills: Array.isArray(parsed.missing_skills) ? parsed.missing_skills.slice(0, 12) : [],
    yoeAssessment: normalizeYoeAssessment(parsed.yoe_assessment),
    reason: String(parsed.reason || "LLM completed matching.").slice(0, 500)
  };
}

async function applyLlmMatch(job) {
  try {
    const llmMatch = await getLlmMatch(job);

    if (!llmMatch) {
      return job;
    }

    return {
      ...job,
      decision: llmMatch.decision,
      reason:
        llmMatch.yoeAssessment === "too_high"
          ? `LLM hard skip: required YOE exceeds your profile. ${llmMatch.reason}`
          : `LLM match (${llmMatch.confidence}%): ${llmMatch.reason}`,
      matchSource: "llm",
      llmMatch
    };
  } catch (error) {
    rememberError({
      type: "llm_match_failed",
      jobId: job.jobId,
      title: job.title,
      url: job.url,
      status: "error",
      message: error?.message || "LLM matcher failed."
    });

    return {
      ...job,
      matchSource: "local",
      llmError: error?.message || "LLM matcher failed."
    };
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForTabComplete(tabId, timeoutMs = TAB_LOAD_TIMEOUT_MS) {
  const tab = await chrome.tabs.get(tabId);

  if (tab.status === "complete") {
    return tab;
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for tab to load."));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo, updatedTab) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(updatedTab);
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendMessageWithFallback(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });

    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function collectLinksFromListTab() {
  const response = await sendMessageWithFallback(scanState.listTabId, {
    type: "APPLE_CAREERS_COLLECT_JOB_LINKS"
  });

  if (!response?.ok) {
    throw new Error("Could not collect job links from the list tab.");
  }

  return response.data;
}

async function advanceListPage() {
  const response = await sendMessageWithFallback(scanState.listTabId, {
    type: "APPLE_CAREERS_GO_TO_NEXT_PAGE"
  });

  if (!response?.ok) {
    return false;
  }

  if (response.action === "navigate") {
    await waitForTabComplete(scanState.listTabId);
  }

  await delay(PAGE_SETTLE_DELAY_MS * 2);

  return true;
}

async function scanJobLink(link) {
  let detailTab;

  try {
    if (link.alreadyAppliedFromList) {
      await saveJobRecord(
        {
          jobId: link.jobId,
          title: link.title,
          url: link.url,
          decision: "Already submitted",
          reason: "List page shows this role has already been applied/submitted.",
          alreadySubmitted: true
        },
        "submitted"
      );
      incrementStatsForStatus("submitted");
      scanState.scanned += 1;
      await saveScanState();
      return;
    }

    const titleHardSkipReason = getHardSkipTitleReason(link.title);
    if (titleHardSkipReason) {
      await saveJobRecord(
        {
          jobId: link.jobId,
          title: link.title,
          url: link.url,
          decision: "Likely skip",
          reason: titleHardSkipReason
        },
        "likely_skip"
      );
      incrementStatsForStatus("likely_skip");
      scanState.scanned += 1;
      await saveScanState();
      return;
    }

    await updateScanState({
      phase: "Scanning job detail",
      currentJob: link,
      lastError: null
    });

    detailTab = await chrome.tabs.create({
      url: link.url,
      active: false
    });

    await waitForTabComplete(detailTab.id);
    await delay(PAGE_SETTLE_DELAY_MS);

    const response = await sendMessageWithFallback(detailTab.id, {
      type: "APPLE_CAREERS_EXTRACT_JOB",
      userYearsOfExperience: scanState.userProfile?.userYearsOfExperience
    });

    if (!response?.ok) {
      throw new Error("Could not extract the job detail page.");
    }

    const job = await applyLlmMatch(response.data);
    const status = job.alreadySubmitted ? "submitted" : statusFromDecision(job.decision);
    let finalStatus = status;
    let applicationResult = null;
    let failureReason = null;

    if (shouldAutoApply(status)) {
      await updateScanState({
        phase: "Auto-applying",
        currentJob: {
          ...link,
          decision: job.decision
        }
      });

      const workflowResponse = await runApplicationWorkflow(detailTab);
      applicationResult = workflowResponse.data || null;

      if (workflowResponse.ok && workflowResponse.data?.submitted) {
        finalStatus = "applied";
        scanState.lastApplied = {
          jobId: job.jobId,
          title: job.title,
          url: job.url,
          appliedAt: new Date().toISOString()
        };
        detailTab = null;
      } else if (workflowResponse.ok && workflowResponse.data?.alreadySubmitted) {
        finalStatus = "submitted";
        detailTab = null;
      } else {
        finalStatus = `${status}_apply_failed`;
        failureReason = workflowResponse.error || "Auto-apply workflow did not finish.";
        scanState.stats.errors += 1;
        scanState.lastError = failureReason;
        rememberError({
          type: "apply_failed",
          jobId: job.jobId,
          title: job.title,
          url: job.url || link.url,
          status: finalStatus,
          message: failureReason,
          workflow: applicationResult,
          lastAttempt: applicationResult?.attempts?.at(-1) || null
        });
        rememberFailure({
          jobId: job.jobId,
          title: job.title,
          url: job.url,
          decision: job.decision,
          resumeMatch: job.resumeMatch,
          status: finalStatus,
          reason: failureReason,
          workflow: applicationResult
        });
      }
    }

    await saveJobRecord(
      {
        ...job,
        applicationResult,
        failureReason
      },
      finalStatus
    );
    incrementStatsForStatus(finalStatus);

    scanState.scanned += 1;
    await saveScanState();
  } catch (error) {
    const message = error?.message || "Could not scan a job detail page.";
    scanState.stats.errors += 1;
    scanState.lastError = message;
    rememberError({
      type: "scan_job_failed",
      jobId: link.jobId || "unknown",
      title: link.title,
      url: link.url || detailTab?.url || null,
      status: "error",
      message
    });
    await saveScanState();
  } finally {
    if (detailTab?.id) {
      await chrome.tabs.remove(detailTab.id).catch(() => {});
    }

    scanState.currentJob = null;
    await saveScanState();
  }
}

async function runScanLoop() {
  try {
    while (scanState.running) {
      await updateScanState({
        phase: "Collecting job links"
      });

      const collection = await collectLinksFromListTab();
      const newLinks = collection.links.filter((link) => !processedUrls.has(link.url));
      const hasAlreadyVisitedListPage = visitedListPages.has(collection.url);

      scanState.listPageUrl = collection.url;
      scanState.pageCount = collection.currentPage || scanState.pageCount;
      scanState.currentPageStats = collection.listStats || null;
      scanState.queued = newLinks.length;
      await saveScanState();

      if (newLinks.length === 0 && hasAlreadyVisitedListPage) {
        await updateScanState({
          running: false,
          phase: "Complete",
          queued: 0,
          currentJob: null,
          completedAt: new Date().toISOString()
        });
        break;
      }

      for (const link of newLinks) {
        if (!scanState.running) {
          break;
        }

        processedUrls.add(link.url);
        scanState.queued = Math.max(0, scanState.queued - 1);
        await scanJobLink(link);
      }

      visitedListPages.add(collection.url);

      if (!scanState.running) {
        break;
      }

      if (!collection.hasNextPage) {
        await updateScanState({
          running: false,
          phase: "Complete",
          queued: 0,
          currentJob: null,
          completedAt: new Date().toISOString()
        });
        break;
      }

      await updateScanState({
        phase: "Advancing to next page",
        queued: 0
      });

      const advanced = await advanceListPage();

      if (!advanced) {
        await updateScanState({
          running: false,
          phase: "Complete",
          lastError: "Reached the end of the job list.",
          completedAt: new Date().toISOString()
        });
        break;
      }
    }
  } catch (error) {
    const message = error?.message || "The scan stopped unexpectedly.";
    await updateScanState({
      running: false,
      phase: "Stopped with error",
      lastError: message,
      completedAt: new Date().toISOString()
    });
    rememberError({
      type: "scan_loop_failed",
      status: "error",
      message
    });
    await saveScanState();
  }
}

async function startScan(tab, userProfile) {
  if (scanState.running) {
    return {
      ok: false,
      error: "A scan is already running."
    };
  }

  if (!tab?.id || !isAppleCareersUrl(tab.url)) {
    return {
      ok: false,
      error: "Open an Apple Careers list page before starting a scan."
    };
  }

  const normalizedProfile = normalizeUserProfile(userProfile);

  await compactStoredJobRecords();

  processedUrls.clear();
  visitedListPages.clear();
  scanState = {
    ...createIdleState(),
    running: true,
    phase: "Starting scan",
    listTabId: tab.id,
    listPageUrl: tab.url,
    pageCount: 1,
    userProfile: normalizedProfile
  };

  await saveScanState();
  runScanLoop();

  return {
    ok: true,
    status: scanState
  };
}

async function stopScan() {
  await updateScanState({
    running: false,
    phase: "Stopped",
    currentJob: null,
    completedAt: new Date().toISOString()
  });

  return {
    ok: true,
    status: scanState
  };
}

async function clearHistory() {
  if (scanState.running) {
    return {
      ok: false,
      error: "Stop the scan before clearing history."
    };
  }

  const userProfile = scanState.userProfile;
  processedUrls.clear();
  visitedListPages.clear();
  scanState = {
    ...createIdleState(),
    userProfile
  };

  await chrome.storage.local.remove(JOB_RECORDS_KEY);
  await saveScanState();

  return {
    ok: true,
    status: scanState
  };
}

async function runApplicationWorkflow(tab) {
  if (!tab?.id) {
    return {
      ok: false,
      error: "No job tab was available for the application workflow."
    };
  }

  const liveTab = await chrome.tabs.get(tab.id).catch(() => null);

  if (!isAppleCareersUrl(liveTab?.url)) {
    return {
      ok: false,
      error: `Expected an Apple Careers job/application tab, but the current tab URL is ${liveTab?.url || "unknown"}.`
    };
  }

  const steps = [];
  const attempts = [];

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    await waitForTabComplete(tab.id).catch(() => {});
    await delay(PAGE_SETTLE_DELAY_MS);

    const response = await sendMessageWithFallback(tab.id, {
      type: "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW_STEP"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The application workflow step failed.");
    }

    attempts.push({
      attempt,
      url: response.data.url,
      title: response.data.title,
      heading: response.data.heading,
      summary: response.data.summary,
      visibleActions: response.data.visibleActions || []
    });

    steps.push(
      ...response.data.steps.map((step) => ({
        ...step,
        attempt
      }))
    );

    if (response.data.done) {
      await delay(2500);
      await chrome.tabs.remove(tab.id).catch(() => {});

      if (response.data.alreadySubmitted) {
        return {
          ok: true,
          data: {
            submitted: false,
            alreadySubmitted: true,
            attempts,
            steps,
            summary: "Job was already submitted and the job tab was closed."
          }
        };
      }

      return {
        ok: true,
        data: {
          submitted: true,
          attempts,
          steps,
          summary: "Application submitted and the job tab was closed."
        }
      };
    }

    if (!response.data.clicked) {
      return {
        ok: false,
        error: response.data.summary || "The workflow could not find the next action.",
        data: {
          submitted: false,
          attempts,
          steps
        }
      };
    }
  }

  return {
    ok: false,
    error: "The workflow hit the maximum number of steps before submission.",
    data: {
      submitted: false,
      attempts,
      steps
    }
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "APPLE_CAREERS_START_SCAN") {
    startScan(message.tab, message.userProfile).then(sendResponse);
    return true;
  }

  if (message?.type === "APPLE_CAREERS_STOP_SCAN") {
    stopScan().then(sendResponse);
    return true;
  }

  if (message?.type === "APPLE_CAREERS_CLEAR_HISTORY") {
    clearHistory().then(sendResponse);
    return true;
  }

  if (message?.type === "APPLE_CAREERS_GET_SCAN_STATUS") {
    sendResponse({
      ok: true,
      status: scanState
    });
    return true;
  }

  if (message?.type === "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW") {
    runApplicationWorkflow(message.tab)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || "The application workflow failed."
        });
      });

    return true;
  }

  return false;
});
