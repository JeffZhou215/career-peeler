// Shared pure logic (site config, matching, YOE hard-skips, LLM prompts/calls) with zero chrome.*
// or DOM dependency, so it can be loaded two ways with no build step:
//   - background.js: `importScripts("lib/core.js")` (classic MV3 service worker, no manifest change)
//   - Node/CLI: `require("./lib/core.js")`
// The functions below that touch job-matching state (getLlmMatch, applyLlmMatch,
// generateFreeTextAnswer, incrementStatsForStatus, shouldAutoApply) take userProfile/stats/job as
// explicit parameters instead of closing over background.js's module-level scanState, so they work
// identically in both contexts.

const DEFAULT_USER_YOE = 2;
const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const DEFAULT_SCAN_MODE = "scan_only";
const MAX_STORED_JOB_RECORDS = 100;
const MAX_TEXT_FIELD_LENGTH = 500;
const HIGH_YOE_HARD_SKIP_FLOOR = 8;
const HIGH_YOE_HARD_SKIP_BUFFER = 3;

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
      [
        "careers.tiktok.com",
        "lifeattiktok.com",
        "jobs.bytedance.com",
        "careers.bytedance.com",
        "joinbytedance.com"
      ].includes(url?.hostname || ""),
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
      needsReview: 0,
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

function incrementStatsForStatus(stats, status) {
  if (status === "applied") {
    stats.applied += 1;
    return;
  }

  if (status.endsWith("_apply_failed")) {
    stats.applyFailed += 1;
    return;
  }

  if (status === "submitted") {
    stats.submitted += 1;
    return;
  }

  if (status === "likely_match") {
    stats.likelyMatch += 1;
    return;
  }

  if (status === "likely_skip") {
    stats.likelySkip += 1;
    return;
  }

  if (status === "reviewed" || status === "review") {
    stats.reviewed += 1;
    return;
  }

  if (status === "seen" || status === "unknown") {
    stats.seen += 1;
    return;
  }

  if (status === "needs_review") {
    stats.needsReview += 1;
    return;
  }
}

function shouldAutoApply(status, job, userProfile) {
  if (getYoeHardSkip(job, userProfile)) {
    return false;
  }

  return (
    userProfile?.scanMode === "auto_apply" &&
    userProfile?.autoApplyConsent &&
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
    { label: "internship", pattern: /\bintern(s|ships?)?\b/i }
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

async function callOpenAi(messages, { apiKey, model, temperature = 0.1, jsonMode = true } = {}) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[Career Peeler] OpenAI call HTTP error", {
      status: response.status,
      statusText: response.statusText,
      body: errorText
    });
    throw new Error(`OpenAI call failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function getLlmMatch(job, userProfile) {
  const normalizedProfile = normalizeUserProfile(userProfile);

  const skipReasons = [];
  if (!normalizedProfile.llmEnabled) {
    skipReasons.push("LLM matching is disabled");
  }
  if (!normalizedProfile.llmApiKey) {
    skipReasons.push("OpenAI API key is missing");
  }
  if (!normalizedProfile.resumeProfile) {
    skipReasons.push("resume/profile summary is missing");
  }
  if (isLocalHardSkip(job)) {
    skipReasons.push("local hard-skip matched");
  }

  if (skipReasons.length) {
    return null;
  }

  const content = await callOpenAi(buildLlmPrompt(job, normalizedProfile), {
    apiKey: normalizedProfile.llmApiKey,
    model: normalizedProfile.llmModel
  });
  const parsed = parseLlmJson(content);

  return {
    decision: decisionFromLlmResult(parsed),
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    matchedSkills: Array.isArray(parsed.matched_skills) ? parsed.matched_skills.slice(0, 12) : [],
    missingSkills: Array.isArray(parsed.missing_skills) ? parsed.missing_skills.slice(0, 12) : [],
    yoeAssessment: normalizeYoeAssessment(parsed.yoe_assessment),
    reason: String(parsed.reason || "LLM completed matching.").slice(0, 500)
  };
}

function buildAnswerPrompt(questionText, job, userProfile) {
  return [
    {
      role: "system",
      content:
        "You are drafting a short answer to an open-ended job application question on behalf of the candidate. Use only facts present in resume_profile -- never invent employers, schools, skills, or achievements that aren't there. Keep the answer specific to the question and the job, first person, and under 120 words. Return only strict JSON matching output_schema."
    },
    {
      role: "user",
      content: JSON.stringify({
        resume_profile: userProfile.resumeProfile,
        question: questionText,
        job: {
          title: job?.title || null,
          company: job?.siteLabel || null,
          matched_keywords: job?.matchScore?.keywords || []
        },
        output_schema: {
          answer: "string, first person, under 120 words"
        }
      })
    }
  ];
}

function hasLlmAnswerCapability(userProfile) {
  return Boolean(userProfile?.llmEnabled && userProfile?.llmApiKey && userProfile?.resumeProfile);
}

async function generateFreeTextAnswer({ questionText, job, userProfile }) {
  const normalizedProfile = normalizeUserProfile(userProfile);

  if (!hasLlmAnswerCapability(normalizedProfile)) {
    return { ok: false, error: "LLM matching is not enabled." };
  }

  const content = await callOpenAi(buildAnswerPrompt(questionText, job, normalizedProfile), {
    apiKey: normalizedProfile.llmApiKey,
    model: normalizedProfile.llmModel
  });
  const parsed = parseLlmJson(content);
  const answer = String(parsed.answer || "").trim();

  if (!answer) {
    return { ok: false, error: "The LLM did not return an answer." };
  }

  return { ok: true, data: { answer: answer.slice(0, 2000) } };
}

async function applyLlmMatch(job, userProfile, { onError } = {}) {
  const normalizedProfile = normalizeUserProfile(userProfile);
  const locallyGuardedJob = applyRequiredYoeHardSkip(job, normalizedProfile);

  try {
    const llmMatch = await getLlmMatch(locallyGuardedJob, normalizedProfile);

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
      normalizedProfile
    );
  } catch (error) {
    onError?.({
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_USER_YOE,
    DEFAULT_LLM_MODEL,
    DEFAULT_SCAN_MODE,
    MAX_STORED_JOB_RECORDS,
    MAX_TEXT_FIELD_LENGTH,
    HIGH_YOE_HARD_SKIP_FLOOR,
    HIGH_YOE_HARD_SKIP_BUFFER,
    SITE_CONFIGS,
    parseUrl,
    getSiteConfig,
    getSiteLabel,
    getJobIdFromUrl,
    createIdleState,
    normalizeUserYearsOfExperience,
    normalizeNoMatchKeywords,
    normalizeUserProfile,
    truncateText,
    compactAttempt,
    compactWorkflow,
    getLastWorkflowAttempt,
    getManualReviewUrl,
    compactLlmMatch,
    compactResumeMatch,
    compactJobRecord,
    compactFailure,
    compactError,
    isStorageQuotaError,
    statusFromDecision,
    classifyWorkflowError,
    incrementStatsForStatus,
    shouldAutoApply,
    getHardSkipTitleReason,
    isLocalHardSkip,
    getMaxMatchYears,
    getYoeHardSkip,
    applyRequiredYoeHardSkip,
    normalizeLlmDecision,
    normalizeYoeAssessment,
    decisionFromLlmResult,
    getExperienceRequirementsForLlm,
    buildLlmPrompt,
    parseLlmJson,
    callOpenAi,
    getLlmMatch,
    buildAnswerPrompt,
    hasLlmAnswerCapability,
    generateFreeTextAnswer,
    applyLlmMatch
  };
}
