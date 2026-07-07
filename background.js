const JOB_RECORDS_KEY = "appleCareersJobRecords";
const JOB_LOGS_KEY = "appleCareersDetailedJobLogs";
const SCAN_STATUS_KEY = "appleCareersScanStatus";
const PAGE_SETTLE_DELAY_MS = 1500;
const TAB_LOAD_TIMEOUT_MS = 25000;
const DEFAULT_USER_YOE = 2;
const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const DEFAULT_SCAN_MODE = "scan_only";
const MAX_STORED_JOB_RECORDS = 100;
const MAX_TEXT_FIELD_LENGTH = 500;
const HIGH_YOE_HARD_SKIP_FLOOR = 8;
const HIGH_YOE_HARD_SKIP_BUFFER = 3;

const processedUrls = new Set();
const processedJobIds = new Set();
const storedIdentifiersAtScanStart = new Set();
const visitedListPages = new Set();
const ownedWorkflowTabIds = new Set();

let scanState = createIdleState();
let storedJobRecordsAtScanStart = {};

const scanStateReady = chrome.storage.local.get(SCAN_STATUS_KEY).then((stored) => {
  const savedState = stored[SCAN_STATUS_KEY];

  if (!savedState || typeof savedState !== "object") {
    return;
  }

  scanState = {
    ...createIdleState(),
    ...savedState,
    running: false,
    currentJob: savedState.running ? null : savedState.currentJob,
    phase: savedState.running ? "Stopped (extension restarted)" : savedState.phase
  };
});

const SITE_CONFIGS = {
  apple: {
    id: "apple",
    label: "Apple Careers",
    isSupportedUrl: (url) =>
      url?.origin === "https://jobs.apple.com" ||
      (url?.origin === "https://www.apple.com" && /^\/careers(?:\/|$)/i.test(url.pathname))
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok/ByteDance Careers",
    isSupportedUrl: (url) =>
      ["careers.tiktok.com", "lifeattiktok.com", "jobs.bytedance.com", "careers.bytedance.com"].includes(
        url?.hostname || ""
      ),
    isApplicationUrl: (url) => /\/resume\/[^/?#]+\/apply(?:\/|$)?/i.test(url?.pathname || "")
  }
};

function parseUrl(url) {
  try {
    return new URL(url);
  } catch (_error) {
    return null;
  }
}

function getSiteConfig(url) {
  const parsedUrl = parseUrl(url);
  return Object.values(SITE_CONFIGS).find((site) => site.isSupportedUrl(parsedUrl)) || null;
}

function getSiteLabel(urlOrSite) {
  if (SITE_CONFIGS[urlOrSite]) {
    return SITE_CONFIGS[urlOrSite].label;
  }

  return getSiteConfig(urlOrSite)?.label || "Unknown site";
}

function getJobIdFromUrl(url) {
  const parsedUrl = parseUrl(url);

  if (!parsedUrl) {
    return null;
  }

  const pathPatterns = [
    /\/details\/([^/?#]+)/i,
    /\/position\/([^/?#]+)/i,
    /\/resume\/([^/?#]+)/i,
    /\/search\/([^/?#]+)/i,
    /\/job\/([^/?#]+)/i,
    /\/jobs\/([^/?#]+)/i
  ];

  for (const pattern of pathPatterns) {
    const match = parsedUrl.pathname.match(pattern);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  for (const param of ["job_id", "jobId", "id", "position_id", "positionId", "req_id", "reqId"]) {
    const value = parsedUrl.searchParams.get(param);
    if (value) {
      return value;
    }
  }

  return null;
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
    site: null,
    siteLabel: null,
    lastError: null,
    completedAt: null,
    stats: {
      submitted: 0,
      applied: 0,
      applyFailed: 0,
      likelyMatch: 0,
      likelySkip: 0,
      reviewed: 0,
      seen: 0,
      skippedStored: 0,
      skippedUnqualified: 0,
      errors: 0
    },
    recent: [],
    failures: [],
    errors: [],
    skippedUnqualified: [],
    lastApplied: null,
    userProfile: {
      userYearsOfExperience: DEFAULT_USER_YOE,
      llmEnabled: false,
      llmApiKey: "",
      llmModel: DEFAULT_LLM_MODEL,
      resumeProfile: "",
      noMatchKeywords: [],
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

function normalizeNoMatchKeywords(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  const seen = new Set();
  const result = [];

  for (const rawTerm of list) {
    const term = String(rawTerm || "").trim();
    const key = term.toLowerCase();

    if (!term || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(term);

    if (result.length >= 50) {
      break;
    }
  }

  return result;
}

function normalizeUserProfile(profile = {}) {
  return {
    userYearsOfExperience: normalizeUserYearsOfExperience(profile.userYearsOfExperience),
    llmEnabled: Boolean(profile.llmEnabled),
    llmApiKey: String(profile.llmApiKey || "").trim(),
    llmModel: String(profile.llmModel || DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL,
    resumeProfile: String(profile.resumeProfile || "").trim(),
    noMatchKeywords: normalizeNoMatchKeywords(profile.noMatchKeywords),
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
    errorType: attempt.errorType || null,
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

function getLastWorkflowAttempt(workflow) {
  return workflow?.attempts?.at(-1) || null;
}

function getManualReviewUrl(source = {}) {
  return source.manualReviewUrl || source.applicationUrl || source.url || source.lastAttempt?.url || source.workflow?.attempts?.at(-1)?.url || null;
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

function compactResumeMatch(resumeMatch) {
  return {
    score: resumeMatch?.score,
    percentage: resumeMatch?.percentage,
    keywords: (resumeMatch?.keywords || []).slice(0, 20)
  };
}

function compactJobRecord(job, status) {
  return {
    jobId: job.jobId,
    site: job.site || getSiteConfig(job.url)?.id || null,
    siteLabel: job.siteLabel || getSiteLabel(job.site || job.url),
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
    resumeMatch: compactResumeMatch(job.resumeMatch),
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
    site: failure.site || getSiteConfig(failure.url)?.id || null,
    siteLabel: failure.siteLabel || getSiteLabel(failure.site || failure.url),
    title: truncateText(failure.title, 220),
    url: failure.url,
    decision: failure.decision,
    resumeMatch: compactResumeMatch(failure.resumeMatch),
    status: failure.status,
    reason: truncateText(failure.reason, 300),
    workflow: compactWorkflow(failure.workflow),
    failedAt: failure.failedAt
  };
}

function compactError(error) {
  const errorType = error.errorType || error.type || "error";
  const lastAttempt = error.lastAttempt || getLastWorkflowAttempt(error.workflow);

  return {
    type: error.type,
    errorType,
    jobId: error.jobId,
    site: error.site || getSiteConfig(error.url)?.id || null,
    siteLabel: error.siteLabel || getSiteLabel(error.site || error.url),
    title: truncateText(error.title, 220),
    url: error.url,
    manualReviewUrl: getManualReviewUrl({
      ...error,
      lastAttempt
    }),
    status: error.status,
    message: truncateText(error.message, 300),
    workflow: compactWorkflow(error.workflow),
    lastAttempt: compactAttempt(lastAttempt),
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
      site: record.site || null,
      siteLabel: record.siteLabel || getSiteLabel(record.site || record.url),
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
  ].slice(0, 50);
}

function rememberSkippedUnqualified(entry) {
  scanState.skippedUnqualified = [
    {
      jobId: entry.jobId || null,
      site: entry.site || getSiteConfig(entry.url)?.id || null,
      siteLabel: entry.siteLabel || getSiteLabel(entry.site || entry.url),
      title: truncateText(entry.title, 220),
      url: entry.url,
      reason: truncateText(entry.reason, 300),
      skippedAt: new Date().toISOString()
    },
    ...scanState.skippedUnqualified
  ].slice(0, 8);
}

async function recordAppliedCheckpoint(jobContext) {
  if (!jobContext) {
    return;
  }

  scanState.lastApplied = {
    jobId: jobContext.jobId,
    site: jobContext.site,
    siteLabel: jobContext.siteLabel,
    title: jobContext.title,
    url: jobContext.url,
    appliedAt: new Date().toISOString()
  };
  scanState.stats.applied += 1;
  await saveScanState();
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
    return "reviewed";
  }

  return "seen";
}

async function loadStoredJobIdentifiers() {
  const stored = await chrome.storage.local.get(JOB_RECORDS_KEY);
  const records = stored[JOB_RECORDS_KEY] || {};
  const urls = new Set();
  const jobIds = new Set();

  for (const [key, record] of Object.entries(records)) {
    if (record?.url) {
      urls.add(record.url);
    }

    if (record?.jobId) {
      jobIds.add(record.jobId);
    } else if (key && !/^https?:\/\//i.test(key)) {
      jobIds.add(key);
    }
  }

  return { urls, jobIds, records };
}

function isLinkProcessed(link) {
  return processedUrls.has(link.url) || (link.jobId ? processedJobIds.has(link.jobId) : false);
}

function markLinkProcessed(link) {
  processedUrls.add(link.url);

  if (link.jobId) {
    processedJobIds.add(link.jobId);
  }
}

function wasStoredBeforeScan(link) {
  return storedIdentifiersAtScanStart.has(link.url) || (link.jobId ? storedIdentifiersAtScanStart.has(link.jobId) : false);
}

function getStoredJobRecord(link) {
  if (link.jobId && storedJobRecordsAtScanStart[link.jobId]) {
    return storedJobRecordsAtScanStart[link.jobId];
  }

  if (link.url && storedJobRecordsAtScanStart[link.url]) {
    return storedJobRecordsAtScanStart[link.url];
  }

  return null;
}

function isUnqualifiedRecord(record) {
  return record?.decision === "Likely skip" || record?.status === "likely_skip";
}

async function hydrateProcessedFromStorage() {
  const stored = await loadStoredJobIdentifiers();

  storedIdentifiersAtScanStart.clear();
  storedJobRecordsAtScanStart = stored.records || {};

  for (const url of stored.urls) {
    processedUrls.add(url);
    storedIdentifiersAtScanStart.add(url);
  }

  for (const jobId of stored.jobIds) {
    processedJobIds.add(jobId);
    storedIdentifiersAtScanStart.add(jobId);
  }

  return stored;
}

function classifyWorkflowError(errorMessage, workflow) {
  const message = String(errorMessage || workflow?.summary || "").toLowerCase();
  const lastAttempt = getLastWorkflowAttempt(workflow);
  const attemptText = `${lastAttempt?.heading || ""} ${lastAttempt?.summary || ""} ${(lastAttempt?.visibleActions || []).join(" ")}`.toLowerCase();
  const combined = `${message} ${attemptText}`;

  if (workflow?.errorType) {
    return workflow.errorType;
  }

  if (/already applied|unable to apply again/.test(combined)) {
    return "already_applied";
  }

  if (/authorization questions|questionnaire|submit was not clicked|answered \d+ of \d+/.test(combined)) {
    return "questionnaire_incomplete";
  }

  if (/sign in|log in|login|session|authenticate|authentication|access denied/.test(combined)) {
    return "session_or_login_required";
  }

  if (/maximum number of steps|timeout|timed out|no progress/.test(combined)) {
    return "workflow_timeout";
  }

  return "apply_failed";
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

  if (status === "reviewed" || status === "review") {
    scanState.stats.reviewed += 1;
    return;
  }

  if (status === "seen" || status === "unknown") {
    scanState.stats.seen += 1;
    return;
  }
}

function shouldAutoApply(status, job) {
  if (getYoeHardSkip(job, scanState.userProfile)) {
    return false;
  }

  return (
    scanState.userProfile?.scanMode === "auto_apply" &&
    scanState.userProfile?.autoApplyConsent &&
    (status === "likely_match" || status === "reviewed" || status === "review")
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
    { label: "manager-level", pattern: /\bmanager\b/i },
    { label: "internship", pattern: /\bintern(s|ship)?\b/i }
  ];
  const matchedRule = titleRules.find((rule) => rule.pattern.test(normalizedTitle));

  return matchedRule ? `Title appears ${matchedRule.label}: ${normalizedTitle}.` : null;
}

function isLocalHardSkip(job) {
  return (
    job.decision === "Likely skip" &&
    /senior-level|internship|matched your no-match keyword list|strong domain mismatch|(?:exceeds?|above)\b.*\byears? of experience\b/i.test(
      job.reason || ""
    )
  );
}

function getMaxMatchYears(match) {
  return Array.isArray(match?.years) && match.years.length ? Math.max(...match.years) : null;
}

function getYoeHardSkip(job, userProfile) {
  if (!job) {
    return null;
  }

  const userYearsOfExperience = normalizeUserYearsOfExperience(userProfile?.userYearsOfExperience);
  const requiredYearsFromSummary = Number(job.requiredYears);

  if (Number.isFinite(requiredYearsFromSummary) && requiredYearsFromSummary > userYearsOfExperience) {
    return {
      requiredYears: requiredYearsFromSummary,
      reason: `Required YOE is ${requiredYearsFromSummary}, above your ${userYearsOfExperience} years of experience.`
    };
  }

  const blockingMatch = (job.matches || []).find(
    (match) => match.type === "required" && getMaxMatchYears(match) > userYearsOfExperience
  );

  if (blockingMatch) {
    const requiredYears = getMaxMatchYears(blockingMatch);
    return {
      requiredYears,
      reason: `Required YOE is ${requiredYears}, above your ${userYearsOfExperience} years of experience.`
    };
  }

  const highNonPreferredMatch = (job.matches || []).find((match) => {
    const maxYears = getMaxMatchYears(match);
    return (
      match.type !== "preferred" &&
      maxYears !== null &&
      maxYears >= Math.max(HIGH_YOE_HARD_SKIP_FLOOR, userYearsOfExperience + HIGH_YOE_HARD_SKIP_BUFFER) &&
      maxYears > userYearsOfExperience
    );
  });

  if (highNonPreferredMatch) {
    const requiredYears = getMaxMatchYears(highNonPreferredMatch);
    return {
      requiredYears,
      reason: `High YOE signal is ${requiredYears}, above your ${userYearsOfExperience} years of experience.`
    };
  }

  return null;
}

function applyRequiredYoeHardSkip(job, userProfile) {
  const hardSkip = getYoeHardSkip(job, userProfile);

  if (!hardSkip) {
    return job;
  }

  return {
    ...job,
    decision: "Likely skip",
    requiredYears: hardSkip.requiredYears,
    reason: `Hard skip: ${hardSkip.reason}`,
    matchSource: job.matchSource || "local"
  };
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

function getExperienceRequirementsForLlm(job) {
  return (job.matches || []).slice(0, 12).map((match) => ({
    type: match.type,
    years: match.years,
    sentence: truncateText(match.sentence, 280)
  }));
}

function buildLlmPrompt(job, userProfile) {
  return [
    {
      role: "system",
      content:
        "You are a cautious job matching assistant. Return only strict JSON. Hard rule: if any required or non-preferred detected experience requirement is greater than user_years_of_experience, yoe_assessment must be too_high and decision must be Likely skip. Do not treat that role as a candidate. Prefer Review when uncertain. Do not recommend applying to manager, senior, staff, principal, lead, iOS, firmware, or high-YOE roles unless the provided evidence clearly says otherwise."
    },
    {
      role: "user",
      content: JSON.stringify({
        resume_profile: userProfile.resumeProfile,
        user_years_of_experience: userProfile.userYearsOfExperience,
        hard_constraints: {
          reject_if_required_yoe_above_user_years: true,
          reject_if_high_non_preferred_yoe_above_user_years: true,
          candidate_role_requires_yoe_lte_user_years: true
        },
        local_decision: job.decision,
        local_reason: job.reason,
        job: {
          title: job.title,
          url: job.url,
          required_years: job.requiredYears,
          detected_experience_requirements: getExperienceRequirementsForLlm(job),
          local_keywords: job.matchScore?.keywords || [],
          text: (job.jobText || job.preview || "").slice(0, 12000)
        },
        output_schema: {
          decision: "Likely match | Review | Likely skip",
          confidence: "number from 0 to 100",
          matched_skills: ["string"],
          missing_skills: ["string"],
          yoe_assessment: "acceptable | too_high | unclear. Use too_high when required/non-preferred YOE is greater than user_years_of_experience.",
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
  const userProfile = normalizeUserProfile(scanState.userProfile);
  const locallyGuardedJob = applyRequiredYoeHardSkip(job, userProfile);

  try {
    const llmMatch = await getLlmMatch(locallyGuardedJob);

    if (!llmMatch) {
      return locallyGuardedJob;
    }

    const llmDecision =
      locallyGuardedJob.decision === "Likely match" &&
      llmMatch.decision === "Likely skip" &&
      llmMatch.yoeAssessment !== "too_high"
        ? "Review"
        : llmMatch.decision;
    const llmReason =
      llmDecision === "Review" && llmMatch.decision === "Likely skip"
        ? `LLM review (${llmMatch.confidence}%): local matching found strong relevant overlap, but the LLM identified uncertainty. ${llmMatch.reason}`
        : llmMatch.yoeAssessment === "too_high"
          ? `LLM hard skip: required YOE exceeds your profile. ${llmMatch.reason}`
          : `LLM match (${llmMatch.confidence}%): ${llmMatch.reason}`;

    return applyRequiredYoeHardSkip(
      {
        ...locallyGuardedJob,
        decision: llmDecision,
        reason: llmReason,
        matchSource: "llm",
        llmMatch
      },
      userProfile
    );
  } catch (error) {
    rememberError({
      type: "llm_match_failed",
      jobId: locallyGuardedJob.jobId,
      title: locallyGuardedJob.title,
      url: locallyGuardedJob.url,
      status: "error",
      message: error?.message || "LLM matcher failed."
    });

    return {
      ...locallyGuardedJob,
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

async function getOpenTabIds() {
  const tabs = await chrome.tabs.query({});
  return new Set(tabs.map((tab) => tab.id).filter((id) => id !== undefined));
}

async function closeOwnedWorkflowTabs(options = {}) {
  const preserveTabIds = new Set((options.preserveTabIds || []).filter((id) => id !== undefined && id !== null));
  const tabIds = Array.from(ownedWorkflowTabIds).filter((tabId) => !preserveTabIds.has(tabId));

  for (const tabId of tabIds) {
    await chrome.tabs.remove(tabId).catch(() => {});
    ownedWorkflowTabIds.delete(tabId);
  }
}

async function closeInactiveApplicationTabs(siteConfig, options = {}) {
  const preserveTabIds = new Set((options.preserveTabIds || []).filter((id) => id !== undefined && id !== null));

  if (!siteConfig?.isApplicationUrl) {
    return;
  }

  const tabs = await chrome.tabs.query({});
  const staleTabs = tabs.filter((tab) => {
    const parsedUrl = parseUrl(tab.url);
    return (
      tab.id !== undefined &&
      !tab.active &&
      !preserveTabIds.has(tab.id) &&
      parsedUrl &&
      siteConfig.isSupportedUrl(parsedUrl) &&
      siteConfig.isApplicationUrl(parsedUrl)
    );
  });

  for (const tab of staleTabs) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    ownedWorkflowTabIds.delete(tab.id);
  }
}

function tabMatchesApplication(tab, siteConfig, jobId) {
  const parsedUrl = parseUrl(tab?.url);

  if (!parsedUrl || !siteConfig?.isSupportedUrl(parsedUrl)) {
    return false;
  }

  if (siteConfig.isApplicationUrl?.(parsedUrl)) {
    return !jobId || parsedUrl.href.includes(jobId);
  }

  return false;
}

async function waitForApplicationTab(previousTabIds, siteConfig, jobId, timeoutMs = 8000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const tabs = await chrome.tabs.query({});
    const applicationTab = tabs.find(
      (tab) => !previousTabIds.has(tab.id) && tabMatchesApplication(tab, siteConfig, jobId)
    );

    if (applicationTab?.id) {
      await waitForTabComplete(applicationTab.id).catch(() => {});
      ownedWorkflowTabIds.add(applicationTab.id);
      return applicationTab;
    }

    await delay(300);
  }

  return null;
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
  const siteConfig = SITE_CONFIGS[link.site] || getSiteConfig(link.url);
  const site = siteConfig?.id || link.site || "unknown";
  const siteLabel = siteConfig?.label || link.siteLabel || getSiteLabel(link.url);

  try {
    await closeOwnedWorkflowTabs();
    if (scanState.userProfile?.scanMode === "auto_apply" && scanState.userProfile?.autoApplyConsent) {
      await closeInactiveApplicationTabs(siteConfig, {
        preserveTabIds: [scanState.listTabId]
      });
    }

    if (link.alreadyAppliedFromList) {
      await saveJobRecord(
        {
          site,
          siteLabel,
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
          site,
          siteLabel,
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
      userYearsOfExperience: scanState.userProfile?.userYearsOfExperience,
      noMatchKeywords: scanState.userProfile?.noMatchKeywords
    });

    if (!response?.ok) {
      throw new Error("Could not extract the job detail page.");
    }

    let job = await applyLlmMatch(response.data);
    job = {
      ...job,
      site: job.site || site,
      siteLabel: job.siteLabel || siteLabel
    };
    job = applyRequiredYoeHardSkip(job, scanState.userProfile);
    const status = job.alreadySubmitted ? "submitted" : statusFromDecision(job.decision);
    let finalStatus = status;
    let applicationResult = null;
    let failureReason = null;
    let alreadyCheckpointed = false;

    if (shouldAutoApply(status, job)) {
      await updateScanState({
        phase: "Auto-applying",
        currentJob: {
          ...link,
          decision: job.decision
        }
      });

      const workflowResponse = await runApplicationWorkflow(detailTab, {
        stopIfScanStopped: true,
        jobContext: {
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url
        }
      });
      applicationResult = workflowResponse.data || null;

      if (workflowResponse.ok && workflowResponse.data?.submitted) {
        finalStatus = "applied";
        alreadyCheckpointed = Boolean(workflowResponse.data?.checkpointed);

        if (!alreadyCheckpointed) {
          scanState.lastApplied = {
            jobId: job.jobId,
            site: job.site,
            siteLabel: job.siteLabel,
            title: job.title,
            url: job.url,
            appliedAt: new Date().toISOString()
          };
        }
      } else if (workflowResponse.ok && workflowResponse.data?.alreadySubmitted) {
        finalStatus = "submitted";
        job.errorType = workflowResponse.data.errorType || null;
      } else {
        finalStatus = `${status}_apply_failed`;
        failureReason = workflowResponse.error || "Auto-apply workflow did not finish.";
        const errorType = classifyWorkflowError(failureReason, applicationResult);
        scanState.stats.errors += 1;
        scanState.lastError = failureReason;
        rememberError({
          type: errorType,
          errorType,
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url || link.url,
          status: finalStatus,
          message: failureReason,
          workflow: applicationResult,
          lastAttempt: applicationResult?.attempts?.at(-1) || null
        });
        rememberFailure({
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url,
          decision: job.decision,
          resumeMatch: job.resumeMatch,
          status: finalStatus,
          reason: failureReason,
          workflow: applicationResult
        });
        job.errorType = errorType;
      }
    }

    await saveJobRecord(
      {
        ...job,
        applicationResult,
        failureReason,
        errorType: job.errorType || null
      },
      finalStatus
    );
    if (!alreadyCheckpointed) {
      incrementStatsForStatus(finalStatus);
    }

    scanState.scanned += 1;
    await saveScanState();
  } catch (error) {
    const message = error?.message || "Could not scan a job detail page.";
    scanState.stats.errors += 1;
    scanState.lastError = message;
    rememberError({
      type: "scan_job_failed",
      errorType: "scan_job_failed",
      jobId: link.jobId || "unknown",
      site,
      siteLabel,
      title: link.title,
      url: link.url || detailTab?.url || null,
      status: "error",
      message
    });
    await saveScanState();
  } finally {
    await closeOwnedWorkflowTabs();

    if (detailTab?.id) {
      await chrome.tabs.remove(detailTab.id).catch(() => {});
      ownedWorkflowTabIds.delete(detailTab.id);
    }

    scanState.currentJob = null;
    await saveScanState();
  }
}

async function scanCurrentApplicationPage(link) {
  const siteConfig = SITE_CONFIGS[link.site] || getSiteConfig(link.url);
  const site = siteConfig?.id || link.site || "unknown";
  const siteLabel = siteConfig?.label || link.siteLabel || getSiteLabel(link.url);
  let job = {
    site,
    siteLabel,
    jobId: link.jobId,
    title: link.title,
    url: link.url,
    decision: "Review",
    reason: "Started from the current job/application page.",
    matchSource: "current_page"
  };
  let finalStatus = "review";
  let applicationResult = null;
  let failureReason = null;
  let alreadyCheckpointed = false;

  try {
    await updateScanState({
      phase: "Running current application page",
      currentJob: link,
      lastError: null
    });

    const response = await sendMessageWithFallback(scanState.listTabId, {
      type: "APPLE_CAREERS_EXTRACT_JOB",
      userYearsOfExperience: scanState.userProfile?.userYearsOfExperience,
      noMatchKeywords: scanState.userProfile?.noMatchKeywords
    }).catch(() => null);

    if (response?.ok) {
      job = {
        ...response.data,
        site: response.data.site || site,
        siteLabel: response.data.siteLabel || siteLabel,
        decision: response.data.decision || "Review",
        reason: response.data.reason || "Started from the current job/application page.",
        matchSource: response.data.matchSource || "current_page"
      };
    }

    if (scanState.userProfile?.scanMode !== "auto_apply" || !scanState.userProfile?.autoApplyConsent) {
      await saveJobRecord(job, finalStatus);
      incrementStatsForStatus(finalStatus);
      scanState.scanned += 1;
      await saveScanState();
      return;
    }

    const workflowResponse = await runApplicationWorkflow(
      { id: scanState.listTabId },
      {
        closeOnDone: false,
        stopIfScanStopped: true,
        jobContext: {
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url
        }
      }
    );
    applicationResult = workflowResponse.data || null;

    if (workflowResponse.ok && workflowResponse.data?.submitted) {
      finalStatus = "applied";
      alreadyCheckpointed = Boolean(workflowResponse.data?.checkpointed);

      if (!alreadyCheckpointed) {
        scanState.lastApplied = {
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url,
          appliedAt: new Date().toISOString()
        };
      }
    } else if (workflowResponse.ok && workflowResponse.data?.alreadySubmitted) {
      finalStatus = "submitted";
      job.errorType = workflowResponse.data.errorType || null;
    } else {
      finalStatus = "review_apply_failed";
      failureReason = workflowResponse.error || "Current application page workflow did not finish.";
      const errorType = classifyWorkflowError(failureReason, applicationResult);
      scanState.stats.errors += 1;
      scanState.lastError = failureReason;
      rememberError({
        type: errorType,
        errorType,
        jobId: job.jobId,
        site: job.site,
        siteLabel: job.siteLabel,
        title: job.title,
        url: job.url,
        status: finalStatus,
        message: failureReason,
        workflow: applicationResult,
        lastAttempt: applicationResult?.attempts?.at(-1) || null
      });
      job.errorType = errorType;
    }

    await saveJobRecord(
      {
        ...job,
        applicationResult,
        failureReason,
        errorType: job.errorType || null
      },
      finalStatus
    );
    if (!alreadyCheckpointed) {
      incrementStatsForStatus(finalStatus);
    }
    scanState.scanned += 1;
    await saveScanState();
  } catch (error) {
    const message = error?.message || "Could not run workflow on the current application page.";
    scanState.stats.errors += 1;
    scanState.lastError = message;
    rememberError({
      type: "current_page_scan_failed",
      errorType: "current_page_scan_failed",
      jobId: job.jobId || link.jobId || "unknown",
      site,
      siteLabel,
      title: job.title || link.title,
      url: job.url || link.url,
      status: "error",
      message,
      workflow: applicationResult,
      lastAttempt: applicationResult?.attempts?.at(-1) || null
    });
    await saveScanState();
  } finally {
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
      const newLinks = [];
      let skippedStored = 0;
      let skippedUnqualified = 0;

      for (const link of collection.links) {
        if (isLinkProcessed(link)) {
          if (wasStoredBeforeScan(link)) {
            skippedStored += 1;

            const priorRecord = getStoredJobRecord(link);
            if (isUnqualifiedRecord(priorRecord)) {
              skippedUnqualified += 1;
              rememberSkippedUnqualified({
                jobId: link.jobId || priorRecord.jobId,
                site: link.site || priorRecord.site,
                siteLabel: link.siteLabel || priorRecord.siteLabel,
                title: link.title || priorRecord.title,
                url: link.url || priorRecord.url,
                reason: priorRecord.reason || priorRecord.failureReason
              });
            }
          }
          continue;
        }

        newLinks.push(link);
      }

      scanState.stats.skippedStored += skippedStored;
      scanState.stats.skippedUnqualified += skippedUnqualified;
      const hasAlreadyVisitedListPage = visitedListPages.has(collection.url);

      scanState.listPageUrl = collection.url;
      scanState.site = collection.site || scanState.site;
      scanState.siteLabel = collection.siteLabel || scanState.siteLabel;
      scanState.pageCount = collection.currentPage || scanState.pageCount;
      scanState.currentPageStats = collection.listStats || null;
      scanState.queued = newLinks.length;
      await saveScanState();

      if (newLinks.length === 0 && collection.currentJob) {
        await scanCurrentApplicationPage(collection.currentJob);
        await updateScanState({
          running: false,
          phase: "Complete",
          queued: 0,
          currentJob: null,
          completedAt: new Date().toISOString()
        });
        break;
      }

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

        markLinkProcessed(link);
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
        phase:
          newLinks.length === 0
            ? `Skipping page ${scanState.pageCount} (already scanned)`
            : "Advancing to next page",
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
      errorType: "scan_loop_failed",
      site: scanState.site,
      siteLabel: scanState.siteLabel,
      status: "error",
      message
    });
    await saveScanState();
  }

  await closeOwnedWorkflowTabs();
}

async function startScan(tab, userProfile) {
  if (scanState.running) {
    return {
      ok: false,
      error: "A scan is already running."
    };
  }

  const siteConfig = getSiteConfig(tab?.url);

  if (!tab?.id || !siteConfig) {
    return {
      ok: false,
      error: "Open an Apple, TikTok, or ByteDance careers list page before starting a scan."
    };
  }

  const normalizedProfile = normalizeUserProfile(userProfile);

  await closeOwnedWorkflowTabs();
  await compactStoredJobRecords();

  processedUrls.clear();
  processedJobIds.clear();
  storedIdentifiersAtScanStart.clear();
  visitedListPages.clear();
  await hydrateProcessedFromStorage();
  scanState = {
    ...createIdleState(),
    running: true,
    phase: "Starting scan",
    listTabId: tab.id,
    listPageUrl: tab.url,
    site: siteConfig.id,
    siteLabel: siteConfig.label,
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
  await closeOwnedWorkflowTabs();

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
  processedJobIds.clear();
  storedIdentifiersAtScanStart.clear();
  storedJobRecordsAtScanStart = {};
  visitedListPages.clear();
  scanState = {
    ...createIdleState(),
    userProfile
  };

  await chrome.storage.local.remove([JOB_RECORDS_KEY, JOB_LOGS_KEY]);
  await saveScanState();

  return {
    ok: true,
    status: scanState
  };
}

async function runApplicationWorkflow(tab, options = {}) {
  const closeOnDone = options.closeOnDone !== false;
  const stopIfScanStopped = Boolean(options.stopIfScanStopped);
  const jobContext = options.jobContext || null;
  const originalWorkflowTabId = tab?.id;
  let workflowTabId = tab?.id;

  if (!workflowTabId) {
    return {
      ok: false,
      error: "No job tab was available for the application workflow."
    };
  }

  const liveTab = await chrome.tabs.get(workflowTabId).catch(() => null);

  const siteConfig = getSiteConfig(liveTab?.url);
  const jobId = liveTab?.url ? getJobIdFromUrl(liveTab.url) : null;

  if (!siteConfig) {
    return {
      ok: false,
      error: `Expected an Apple, TikTok, or ByteDance careers job/application tab, but the current tab URL is ${liveTab?.url || "unknown"}.`
    };
  }

  const steps = [];
  const attempts = [];
  const cleanupWorkflowTabs = async () => {
    if (!closeOnDone) {
      return;
    }

    await closeOwnedWorkflowTabs({
      preserveTabIds: [originalWorkflowTabId]
    });
  };

  try {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      if (stopIfScanStopped && !scanState.running) {
        return {
          ok: false,
          error: "Scan stopped.",
          data: {
            submitted: false,
            errorType: "stopped_by_user",
            attempts,
            steps,
            summary: "Scan was stopped; leaving the current application step as-is."
          }
        };
      }

      await waitForTabComplete(workflowTabId).catch(() => {});
      await delay(PAGE_SETTLE_DELAY_MS);

      const previousTabIds = await getOpenTabIds();
      const response = await sendMessageWithFallback(workflowTabId, {
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
        errorType: response.data.errorType || null,
        visibleActions: response.data.visibleActions || []
      });

      steps.push(
        ...response.data.steps.map((step) => ({
          ...step,
          attempt
        }))
      );

      const openedApplication =
        response.data.clicked &&
        response.data.steps.some(
          (step) => step.step === "Open application flow" && step.status === "clicked"
        );

      if (openedApplication) {
        const applicationTab = await waitForApplicationTab(previousTabIds, siteConfig, jobId);
        if (applicationTab?.id) {
          workflowTabId = applicationTab.id;
          attempts.push({
            attempt,
            url: applicationTab.url,
            title: applicationTab.title,
            heading: "",
            summary: "Detected newly opened application tab.",
            visibleActions: []
          });
        }
      }

      if (response.data.done) {
        const isFreshSubmission = !response.data.alreadySubmitted;

        if (isFreshSubmission && jobContext) {
          await recordAppliedCheckpoint(jobContext);
        }

        await delay(2500);
        if (closeOnDone) {
          await chrome.tabs.remove(workflowTabId).catch(() => {});
          ownedWorkflowTabIds.delete(workflowTabId);
        }

        if (response.data.alreadySubmitted) {
          return {
            ok: true,
            data: {
              submitted: false,
              alreadySubmitted: true,
              errorType: response.data.errorType || "already_applied",
              attempts,
              steps,
              summary: closeOnDone
                ? "Job was already submitted and the job tab was closed."
                : "Job was already submitted."
            }
          };
        }

        return {
          ok: true,
          data: {
            submitted: true,
            checkpointed: isFreshSubmission && Boolean(jobContext),
            attempts,
            steps,
            summary: closeOnDone ? "Application submitted and the job tab was closed." : "Application submitted."
          }
        };
      }

      if (!response.data.clicked) {
        await cleanupWorkflowTabs();
        return {
          ok: false,
          error: response.data.summary || "The workflow could not find the next action.",
          data: {
            submitted: false,
            errorType: response.data.errorType || classifyWorkflowError(response.data.summary, { attempts, steps }),
            summary: response.data.summary,
            attempts,
            steps
          }
        };
      }
    }

    await cleanupWorkflowTabs();
    return {
      ok: false,
      error: "The workflow hit the maximum number of steps before submission.",
      data: {
        submitted: false,
        errorType: "workflow_timeout",
        summary: "The workflow hit the maximum number of steps before submission.",
        attempts,
        steps
      }
    };
  } catch (error) {
    await cleanupWorkflowTabs();
    throw error;
  }
}

const RECOGNIZED_MESSAGE_TYPES = new Set([
  "APPLE_CAREERS_START_SCAN",
  "APPLE_CAREERS_STOP_SCAN",
  "APPLE_CAREERS_CLEAR_HISTORY",
  "APPLE_CAREERS_GET_SCAN_STATUS",
  "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW"
]);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!RECOGNIZED_MESSAGE_TYPES.has(message?.type)) {
    return false;
  }

  scanStateReady.then(async () => {
    try {
      if (message.type === "APPLE_CAREERS_START_SCAN") {
        sendResponse(await startScan(message.tab, message.userProfile));
      } else if (message.type === "APPLE_CAREERS_STOP_SCAN") {
        sendResponse(await stopScan());
      } else if (message.type === "APPLE_CAREERS_CLEAR_HISTORY") {
        sendResponse(await clearHistory());
      } else if (message.type === "APPLE_CAREERS_GET_SCAN_STATUS") {
        sendResponse({
          ok: true,
          status: scanState
        });
      } else if (message.type === "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW") {
        sendResponse(await runApplicationWorkflow(message.tab));
      }
    } catch (error) {
      sendResponse({
        ok: false,
        error: error?.message || "The request failed."
      });
    }
  });

  return true;
});
