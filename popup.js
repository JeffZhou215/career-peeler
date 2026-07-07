const extractButton = document.querySelector("#extractButton");
const scanButton = document.querySelector("#scanButton");
const analyzeApplicationButton = document.querySelector("#analyzeApplicationButton");
const runApplicationWorkflowButton = document.querySelector("#runApplicationWorkflowButton");
const stopScanButton = document.querySelector("#stopScanButton");
const clearHistoryButton = document.querySelector("#clearHistoryButton");
const statusEl = document.querySelector("#status");
const resultEl = document.querySelector("#result");
const decisionEl = document.querySelector("#decision");
const requiredYearsEl = document.querySelector("#requiredYears");
const jobIdEl = document.querySelector("#jobId");
const resumeMatchScoreEl = document.querySelector("#resumeMatchScore");
const resumeKeywordsEl = document.querySelector("#resumeKeywords");
const matchReasonsEl = document.querySelector("#matchReasons");
const matchesEl = document.querySelector("#matches");
const previewEl = document.querySelector("#preview");
const scanStatusEl = document.querySelector("#scanStatus");
const scanPhaseEl = document.querySelector("#scanPhase");
const scanPagesEl = document.querySelector("#scanPages");
const scanScannedEl = document.querySelector("#scanScanned");
const scanQueuedEl = document.querySelector("#scanQueued");
const scanPageTotalEl = document.querySelector("#scanPageTotal");
const scanPageUnappliedEl = document.querySelector("#scanPageUnapplied");
const scanPageAppliedEl = document.querySelector("#scanPageApplied");
const scanSubmittedEl = document.querySelector("#scanSubmitted");
const scanAppliedEl = document.querySelector("#scanApplied");
const scanLikelyMatchEl = document.querySelector("#scanLikelyMatch");
const scanLikelySkipEl = document.querySelector("#scanLikelySkip");
const scanReviewEl = document.querySelector("#scanReview");
const scanUnknownEl = document.querySelector("#scanUnknown");
const scanSkippedStoredEl = document.querySelector("#scanSkippedStored");
const scanSkippedUnqualifiedEl = document.querySelector("#scanSkippedUnqualified");
const scanApplyFailedEl = document.querySelector("#scanApplyFailed");
const scanErrorsEl = document.querySelector("#scanErrors");
const scanErrorsSummaryEl = document.querySelector("#scanErrorsSummary");
const scanErrorLogEl = document.querySelector("#scanErrorLog");
const scanCurrentEl = document.querySelector("#scanCurrent");
const scanRecentEl = document.querySelector("#scanRecent");
const scanFailuresEl = document.querySelector("#scanFailures");
const scanSkippedUnqualifiedLogEl = document.querySelector("#scanSkippedUnqualifiedLog");
const lastAppliedEl = document.querySelector("#lastApplied");
const applicationAnalysisEl = document.querySelector("#applicationAnalysis");
const applicationFieldCountEl = document.querySelector("#applicationFieldCount");
const applicationRequiredCountEl = document.querySelector("#applicationRequiredCount");
const applicationUnsupportedCountEl = document.querySelector("#applicationUnsupportedCount");
const applicationFormCountEl = document.querySelector("#applicationFormCount");
const applicationSummaryEl = document.querySelector("#applicationSummary");
const applicationFieldsEl = document.querySelector("#applicationFields");
const applicationButtonsEl = document.querySelector("#applicationButtons");
const userYearsOfExperienceEl = document.querySelector("#userYearsOfExperience");
const scanModeEl = document.querySelector("#scanMode");
const autoApplyConsentEl = document.querySelector("#autoApplyConsent");
const llmEnabledEl = document.querySelector("#llmEnabled");
const llmApiKeyEl = document.querySelector("#llmApiKey");
const llmModelEl = document.querySelector("#llmModel");
const resumeProfileEl = document.querySelector("#resumeProfile");
const noMatchKeywordsTagsEl = document.querySelector("#noMatchKeywordsTags");
const noMatchKeywordsInputEl = document.querySelector("#noMatchKeywordsInput");
const noMatchKeywordsSuggestionsEl = document.querySelector("#noMatchKeywordsSuggestions");

const SCAN_STATUS_KEY = "appleCareersScanStatus";
const USER_PROFILE_KEY = "appleCareersUserProfile";
const DEFAULT_USER_YOE = 2;
const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const DEFAULT_SCAN_MODE = "scan_only";

const TECH_KEYWORD_SUGGESTIONS = [
  "Android",
  "AppKit",
  "AR/VR",
  "ASIC",
  "ASP.NET",
  "Blockchain",
  "COBOL",
  "Cocoa",
  "Cocoa Touch",
  "Core Data",
  "Cordova",
  "Device Drivers",
  "Drupal",
  "Embedded Systems",
  "Firmware",
  "Flutter",
  "Fortran",
  "FPGA",
  "Game Development",
  "Hardware Engineering",
  "IoT",
  "iOS",
  "jQuery",
  "Kernel",
  "Kotlin",
  "Mainframe",
  "macOS",
  "Networking",
  "Objective-C",
  "Perl",
  "PHP",
  "React Native",
  "Robotics",
  "RTOS",
  "Ruby",
  "Ruby on Rails",
  "Salesforce",
  "SAP",
  "Swift",
  "SwiftUI",
  "Telecom",
  "tvOS",
  "UIKit",
  "Unity",
  "Unreal Engine",
  "VB.NET",
  "Verilog",
  "VHDL",
  "watchOS",
  "Web3",
  "WordPress",
  "Xcode"
].sort((a, b) => a.localeCompare(b));

let scanPollId = null;
let noMatchKeywords = [];
let activeSuggestionIndex = -1;

function isSupportedCareersUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.origin === "https://jobs.apple.com" ||
      (parsedUrl.origin === "https://www.apple.com" && /^\/careers(?:\/|$)/i.test(parsedUrl.pathname)) ||
      ["careers.tiktok.com", "lifeattiktok.com", "jobs.bytedance.com", "careers.bytedance.com"].includes(
        parsedUrl.hostname
      )
    );
  } catch (_error) {
    return false;
  }
}

function setStatus(message) {
  statusEl.textContent = message;
}

function normalizeUserYearsOfExperience(value) {
  const years = Number(value);

  if (!Number.isFinite(years) || years < 0) {
    return DEFAULT_USER_YOE;
  }

  return Math.min(50, years);
}

function normalizeScanMode(value) {
  return ["scan_only", "auto_apply"].includes(value) ? value : DEFAULT_SCAN_MODE;
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

async function getUserProfile() {
  const stored = await chrome.storage.local.get(USER_PROFILE_KEY);
  return {
    userYearsOfExperience: normalizeUserYearsOfExperience(
      stored[USER_PROFILE_KEY]?.userYearsOfExperience ?? userYearsOfExperienceEl.value
    ),
    llmEnabled: Boolean(stored[USER_PROFILE_KEY]?.llmEnabled ?? llmEnabledEl.checked),
    llmApiKey: String(stored[USER_PROFILE_KEY]?.llmApiKey ?? llmApiKeyEl.value).trim(),
    llmModel: String(stored[USER_PROFILE_KEY]?.llmModel ?? llmModelEl.value ?? DEFAULT_LLM_MODEL).trim(),
    resumeProfile: String(stored[USER_PROFILE_KEY]?.resumeProfile ?? resumeProfileEl.value).trim(),
    noMatchKeywords: normalizeNoMatchKeywords(stored[USER_PROFILE_KEY]?.noMatchKeywords ?? noMatchKeywords),
    scanMode: normalizeScanMode(stored[USER_PROFILE_KEY]?.scanMode ?? scanModeEl.value),
    autoApplyConsent: Boolean(stored[USER_PROFILE_KEY]?.autoApplyConsent ?? autoApplyConsentEl.checked)
  };
}

async function saveUserProfile() {
  const userProfile = {
    userYearsOfExperience: normalizeUserYearsOfExperience(userYearsOfExperienceEl.value),
    llmEnabled: Boolean(llmEnabledEl.checked),
    llmApiKey: String(llmApiKeyEl.value || "").trim(),
    llmModel: String(llmModelEl.value || DEFAULT_LLM_MODEL).trim(),
    resumeProfile: String(resumeProfileEl.value || "").trim(),
    noMatchKeywords: normalizeNoMatchKeywords(noMatchKeywords),
    scanMode: normalizeScanMode(scanModeEl.value),
    autoApplyConsent: Boolean(autoApplyConsentEl.checked)
  };

  userYearsOfExperienceEl.value = userProfile.userYearsOfExperience;
  llmEnabledEl.checked = userProfile.llmEnabled;
  llmApiKeyEl.value = userProfile.llmApiKey;
  llmModelEl.value = userProfile.llmModel;
  resumeProfileEl.value = userProfile.resumeProfile;
  noMatchKeywords = userProfile.noMatchKeywords;
  renderNoMatchKeywordTags();
  scanModeEl.value = userProfile.scanMode;
  autoApplyConsentEl.checked = userProfile.autoApplyConsent;
  await chrome.storage.local.set({
    [USER_PROFILE_KEY]: userProfile
  });

  return userProfile;
}

async function loadUserProfile() {
  const userProfile = await getUserProfile();
  userYearsOfExperienceEl.value = userProfile.userYearsOfExperience;
  llmEnabledEl.checked = userProfile.llmEnabled;
  llmApiKeyEl.value = userProfile.llmApiKey;
  llmModelEl.value = userProfile.llmModel;
  resumeProfileEl.value = userProfile.resumeProfile;
  noMatchKeywords = userProfile.noMatchKeywords;
  renderNoMatchKeywordTags();
  scanModeEl.value = userProfile.scanMode;
  autoApplyConsentEl.checked = userProfile.autoApplyConsent;
}

function renderNoMatchKeywordTags() {
  noMatchKeywordsTagsEl.textContent = "";

  for (const keyword of noMatchKeywords) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";

    const label = document.createElement("span");
    label.textContent = keyword;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "tag-chip-remove";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `Remove ${keyword}`);
    removeButton.addEventListener("click", () => {
      removeNoMatchKeyword(keyword);
    });

    chip.append(label, removeButton);
    noMatchKeywordsTagsEl.append(chip);
  }
}

function addNoMatchKeyword(rawValue) {
  const value = String(rawValue || "").trim();

  if (!value) {
    return;
  }

  noMatchKeywords = normalizeNoMatchKeywords([...noMatchKeywords, value]);
  renderNoMatchKeywordTags();
  saveUserProfile();
}

function removeNoMatchKeyword(value) {
  const key = value.toLowerCase();
  noMatchKeywords = noMatchKeywords.filter((keyword) => keyword.toLowerCase() !== key);
  renderNoMatchKeywordTags();
  saveUserProfile();
}

function getNoMatchKeywordSuggestions(query) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const selected = new Set(noMatchKeywords.map((keyword) => keyword.toLowerCase()));

  return TECH_KEYWORD_SUGGESTIONS.filter(
    (term) => !selected.has(term.toLowerCase()) && term.toLowerCase().includes(normalizedQuery)
  ).slice(0, 8);
}

function setActiveSuggestion(items, index) {
  activeSuggestionIndex = index;
  items.forEach((item, itemIndex) => {
    item.classList.toggle("active", itemIndex === index);
  });
}

function hideNoMatchKeywordSuggestions() {
  noMatchKeywordsSuggestionsEl.textContent = "";
  noMatchKeywordsSuggestionsEl.classList.add("hidden");
  activeSuggestionIndex = -1;
}

function renderNoMatchKeywordSuggestions() {
  const suggestions = getNoMatchKeywordSuggestions(noMatchKeywordsInputEl.value);

  if (!suggestions.length) {
    hideNoMatchKeywordSuggestions();
    return;
  }

  noMatchKeywordsSuggestionsEl.textContent = "";
  activeSuggestionIndex = -1;

  for (const term of suggestions) {
    const item = document.createElement("li");
    item.textContent = term;
    item.dataset.value = term;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      addNoMatchKeyword(term);
      noMatchKeywordsInputEl.value = "";
      hideNoMatchKeywordSuggestions();
      noMatchKeywordsInputEl.focus();
    });
    noMatchKeywordsSuggestionsEl.append(item);
  }

  noMatchKeywordsSuggestionsEl.classList.remove("hidden");
}

function commitNoMatchKeywordInput() {
  const items = Array.from(noMatchKeywordsSuggestionsEl.children);
  const chosen =
    activeSuggestionIndex >= 0 && items[activeSuggestionIndex]
      ? items[activeSuggestionIndex].dataset.value
      : noMatchKeywordsInputEl.value;

  addNoMatchKeyword(chosen);
  noMatchKeywordsInputEl.value = "";
  hideNoMatchKeywordSuggestions();
}

noMatchKeywordsInputEl.addEventListener("input", renderNoMatchKeywordSuggestions);
noMatchKeywordsInputEl.addEventListener("focus", renderNoMatchKeywordSuggestions);
noMatchKeywordsInputEl.addEventListener("blur", () => {
  setTimeout(hideNoMatchKeywordSuggestions, 100);
});

noMatchKeywordsInputEl.addEventListener("keydown", (event) => {
  const items = Array.from(noMatchKeywordsSuggestionsEl.children);

  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (items.length) {
      setActiveSuggestion(items, (activeSuggestionIndex + 1) % items.length);
    }
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (items.length) {
      setActiveSuggestion(items, (activeSuggestionIndex - 1 + items.length) % items.length);
    }
    return;
  }

  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    commitNoMatchKeywordInput();
    return;
  }

  if (event.key === "Backspace" && !noMatchKeywordsInputEl.value && noMatchKeywords.length) {
    removeNoMatchKeyword(noMatchKeywords[noMatchKeywords.length - 1]);
    return;
  }

  if (event.key === "Escape") {
    hideNoMatchKeywordSuggestions();
  }
});

function renderMatches(matches) {
  matchesEl.textContent = "";

  if (!matches.length) {
    const item = document.createElement("li");
    item.textContent = "No years-of-experience sentences found.";
    matchesEl.append(item);
    return;
  }

  for (const match of matches) {
    const item = document.createElement("li");
    item.textContent = `${match.type}: ${match.sentence}`;
    matchesEl.append(item);
  }
}

function renderResult(data) {
  resultEl.classList.remove("hidden");
  decisionEl.textContent = data.alreadySubmitted ? "Already submitted" : data.decision;
  requiredYearsEl.textContent = data.requiredYears === null ? "Unknown" : `${data.requiredYears} years`;
  jobIdEl.textContent = data.jobId;
  resumeMatchScoreEl.textContent = data.matchScore ? `${data.matchScore.percentage}%` : "Unknown";
  resumeKeywordsEl.textContent = data.resumeMatch?.keywords?.length
    ? data.resumeMatch.keywords.join(", ")
    : "None";
  matchReasonsEl.textContent = data.matchScore?.reasons?.length
    ? data.matchScore.reasons.join("; ")
    : "None";
  previewEl.textContent = data.preview || "No preview text found.";
  renderMatches(data.matches || []);
  setStatus(
    data.alreadySubmitted
      ? "This job appears to have already been submitted."
      : data.reason || "Extraction complete."
  );
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
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

async function extractCurrentPage() {
  extractButton.disabled = true;
  setStatus("Extracting job text from the current tab...");

  try {
    const tab = await getActiveTab();

    if (!tab?.id || !isSupportedCareersUrl(tab.url)) {
      resultEl.classList.add("hidden");
      setStatus("Open an Apple, TikTok, or ByteDance careers page, then try again.");
      return;
    }

    const userProfile = await getUserProfile();
    const response = await sendMessageWithFallback(tab.id, {
      type: "APPLE_CAREERS_EXTRACT_JOB",
      userYearsOfExperience: userProfile.userYearsOfExperience,
      noMatchKeywords: userProfile.noMatchKeywords
    });

    if (!response?.ok) {
      throw new Error("The content script did not return job details.");
    }

    renderResult(response.data);
  } catch (error) {
    resultEl.classList.add("hidden");
    setStatus(error?.message || "Could not extract this page.");
    console.error(error);
  } finally {
    extractButton.disabled = false;
  }
}

function renderList(listEl, items, emptyMessage, renderItemNodes) {
  listEl.textContent = "";

  if (!items?.length) {
    const item = document.createElement("li");
    item.textContent = emptyMessage;
    listEl.append(item);
    return;
  }

  for (const data of items) {
    const item = document.createElement("li");
    item.append(...renderItemNodes(data));
    listEl.append(item);
  }
}

function cleanJobTitle(title) {
  return (title || "Untitled job")
    .replace(/\s+-\s+Jobs\s+-\s+Careers at Apple\.?$/i, "")
    .replace(/\s+-\s+Careers at Apple\.?$/i, "")
    .replace(/\s*[>›»]\s*$/u, "")
    .trim();
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return "";
  }

  const elapsedMs = Date.now() - new Date(timestamp).getTime();
  const elapsedSeconds = Math.max(0, Math.round(elapsedMs / 1000));

  if (elapsedSeconds < 60) {
    return "just now";
  }

  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`;
  }

  const elapsedHours = Math.round(elapsedMinutes / 60);
  return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
}

function renderApplicationAnalysis(data) {
  applicationAnalysisEl.classList.remove("hidden");
  applicationFieldCountEl.textContent = data.fieldCount;
  applicationRequiredCountEl.textContent = data.requiredCount;
  applicationUnsupportedCountEl.textContent = data.unsupportedCount;
  applicationFormCountEl.textContent = data.formCount;
  applicationSummaryEl.textContent = data.summary;

  renderList(applicationFieldsEl, data.fields, "No visible fields detected.", (field) => {
    const required = field.required ? "required" : "optional";
    const options = field.options?.length ? ` options: ${field.options.join(", ")}` : "";
    return [`${field.index}. ${field.label} (${field.kind}, ${field.category}, ${required})${options}`];
  });

  renderList(applicationButtonsEl, data.buttons, "No visible buttons detected.", (button) => [button]);
}

async function analyzeApplicationPage() {
  analyzeApplicationButton.disabled = true;
  setStatus("Analyzing visible application fields...");

  try {
    const tab = await getActiveTab();

    if (!tab?.id || !isSupportedCareersUrl(tab.url)) {
      applicationAnalysisEl.classList.add("hidden");
      setStatus("Open a supported careers application page, then try again.");
      return;
    }

    const response = await sendMessageWithFallback(tab.id, {
      type: "APPLE_CAREERS_ANALYZE_APPLICATION_PAGE"
    });

    if (!response?.ok) {
      throw new Error("The content script did not return application fields.");
    }

    renderApplicationAnalysis(response.data);
    setStatus("Application page analyzed. No fields were filled.");
  } catch (error) {
    applicationAnalysisEl.classList.add("hidden");
    setStatus(error?.message || "Could not analyze this application page.");
    console.error(error);
  } finally {
    analyzeApplicationButton.disabled = false;
  }
}

async function runApplicationWorkflow() {
  runApplicationWorkflowButton.disabled = true;
  setStatus("Checking the current careers application page before running the workflow.");

  try {
    const tab = await getActiveTab();

    if (!tab?.id || !isSupportedCareersUrl(tab.url)) {
      setStatus("Open an Apple, TikTok, or ByteDance careers job or application page, then try again.");
      return;
    }

    const confirmed = window.confirm(
      "This diagnostic workflow can click through the application and submit it if the final Submit button is found. Continue?"
    );

    if (!confirmed) {
      setStatus("Application workflow cancelled.");
      return;
    }

    setStatus("Running the site-specific application workflow. This can submit the application if the final Submit button is found.");

    const response = await chrome.runtime.sendMessage({
      type: "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW",
      tab
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The workflow did not complete.");
    }

    const clickedSteps = response.data.steps.filter((step) => step.status === "clicked").length;
    setStatus(`${response.data.summary} Steps clicked: ${clickedSteps}.`);

    runApplicationWorkflowButton.disabled = Boolean(response.data?.submitted);
  } catch (error) {
    setStatus(error?.message || "Could not run the application workflow.");
    console.error(error);
  } finally {
    runApplicationWorkflowButton.disabled = false;
  }
}

function renderScanRecent(recent) {
  renderList(scanRecentEl, recent, "No scanned jobs yet.", (record) => {
    const reason = record.failureReason ? ` - ${record.failureReason}` : "";
    const llmDetails =
      record.matchSource === "llm" && record.llmMatch
        ? ` · LLM ${record.llmMatch.confidence}%${
            record.llmMatch.matchedSkills?.length
              ? ` · ${record.llmMatch.matchedSkills.slice(0, 3).join(", ")}`
              : ""
          }`
        : "";
    return [`${record.status}: `, createJobLink(record.jobId, record.title, record.url), `${llmDetails}${reason}`];
  });
}

function renderScanFailures(failures) {
  renderList(scanFailuresEl, failures, "No apply failures logged yet.", (failure) => {
    const lastAttempt = failure.workflow?.attempts?.at(-1);
    const actions = lastAttempt?.visibleActions?.length
      ? ` Visible buttons at failure: ${lastAttempt.visibleActions.join(", ")}.`
      : "";
    const heading = lastAttempt?.heading ? ` Page: ${lastAttempt.heading}.` : "";
    const role = failure.jobId ? `Role ${failure.jobId}` : "Role unknown";
    return [
      `${failure.status}: ${role} - ${cleanJobTitle(failure.title)}. ${failure.reason}.${heading}${actions}`
    ];
  });
}

function renderSkippedUnqualified(skippedUnqualified) {
  renderList(scanSkippedUnqualifiedLogEl, skippedUnqualified, "No unqualified roles skipped yet.", (entry) => {
    const site = entry.siteLabel ? ` ${entry.siteLabel}.` : "";
    const when = entry.skippedAt ? ` (${formatRelativeTime(entry.skippedAt)})` : "";
    return [`Skipped:${site} `, createJobLink(entry.jobId, entry.title, entry.url), ` - ${entry.reason}${when}`];
  });
}

function createJobLink(jobId, title, url) {
  const legacyUrl = typeof jobId === "string" && jobId.startsWith("http") ? jobId : null;
  const displayJobId = legacyUrl ? null : jobId;
  const linkUrl = url || legacyUrl;
  const label = `${displayJobId ? `Role ${displayJobId}` : "Role unknown"}${title ? ` - ${cleanJobTitle(title)}` : ""}`;

  if (!linkUrl) {
    return document.createTextNode(label);
  }

  const link = document.createElement("a");
  link.href = linkUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

function renderScanErrors(errors) {
  renderList(scanErrorLogEl, errors, "No errors logged yet.", (error) => {
    const attempt = error.lastAttempt || error.workflow?.attempts?.at(-1);
    const site = error.siteLabel ? ` ${error.siteLabel}.` : "";
    const errorType = error.errorType || error.type || "error";
    const heading = attempt?.heading ? ` Page: ${attempt.heading}.` : "";
    const summary = attempt?.summary ? ` Last step: ${attempt.summary}.` : "";
    const buttons = attempt?.visibleActions?.length
      ? ` Visible buttons: ${attempt.visibleActions.join(", ")}.`
      : "";
    const when = error.happenedAt ? ` (${formatRelativeTime(error.happenedAt)})` : "";
    return [
      `${errorType}:${site} `,
      createJobLink(error.jobId, error.title, error.manualReviewUrl || error.url),
      ` - ${error.message}.${heading}${summary}${buttons}${when}`
    ];
  });
}

function renderScanStatus(status) {
  scanStatusEl.classList.remove("hidden");
  scanPhaseEl.textContent = status.phase || "Idle";
  scanPagesEl.textContent = status.pageCount || 0;
  scanScannedEl.textContent = status.scanned || 0;
  scanQueuedEl.textContent = status.queued || 0;
  scanPageTotalEl.textContent = status.currentPageStats?.total || 0;
  scanPageUnappliedEl.textContent = status.currentPageStats?.unapplied || 0;
  scanPageAppliedEl.textContent = status.currentPageStats?.applied || 0;
  scanSubmittedEl.textContent = status.stats?.submitted || 0;
  scanAppliedEl.textContent = status.stats?.applied || 0;
  scanLikelyMatchEl.textContent = status.stats?.likelyMatch || 0;
  scanLikelySkipEl.textContent = status.stats?.likelySkip || 0;
  scanReviewEl.textContent = status.stats?.reviewed ?? status.stats?.review ?? 0;
  scanUnknownEl.textContent = status.stats?.seen ?? status.stats?.unknown ?? 0;
  scanSkippedStoredEl.textContent = status.stats?.skippedStored || 0;
  scanSkippedUnqualifiedEl.textContent = status.stats?.skippedUnqualified || 0;
  scanApplyFailedEl.textContent = status.stats?.applyFailed || 0;
  scanErrorsEl.textContent = status.stats?.errors || 0;
  scanErrorsSummaryEl.textContent = status.stats?.errors || 0;
  scanCurrentEl.textContent = status.currentJob
    ? `Current: ${status.currentJob.title || status.currentJob.jobId}`
    : status.lastError || "No current job.";
  lastAppliedEl.textContent = status.lastApplied
    ? `Last applied: ${cleanJobTitle(status.lastApplied.title)} (${status.lastApplied.jobId}), ${formatRelativeTime(status.lastApplied.appliedAt)}`
    : "No jobs applied yet.";
  renderScanFailures(status.failures || []);
  renderScanErrors(status.errors || []);
  renderSkippedUnqualified(status.skippedUnqualified || []);
  renderScanRecent(status.recent || []);

  scanButton.disabled = Boolean(status.running);
  scanButton.textContent = status.running ? "Scan Running" : "Scan visible job list";
  stopScanButton.classList.toggle("hidden", !status.running);
  clearHistoryButton.disabled = Boolean(status.running);

  if (status.running && !scanPollId) {
    startPollingScanStatus();
  }

  if (!status.running && scanPollId) {
    clearInterval(scanPollId);
    scanPollId = null;
  }
}

async function refreshScanStatus() {
  const response = await chrome.runtime.sendMessage({
    type: "APPLE_CAREERS_GET_SCAN_STATUS"
  });

  if (response?.ok) {
    renderScanStatus(response.status);
  }
}

function startPollingScanStatus() {
  if (scanPollId) {
    clearInterval(scanPollId);
  }

  scanPollId = setInterval(refreshScanStatus, 1000);
}

async function startListScan() {
  scanButton.disabled = true;
  setStatus("Starting scan from the current jobs list page...");

  try {
    const tab = await getActiveTab();
    const userProfile = await saveUserProfile();

    if (userProfile.scanMode === "auto_apply" && !userProfile.autoApplyConsent) {
      scanButton.disabled = false;
      setStatus("Confirm the auto-apply acknowledgement before starting an auto-apply scan.");
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "APPLE_CAREERS_START_SCAN",
      tab,
      userProfile
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not start the scan.");
    }

    renderScanStatus(response.status);
    startPollingScanStatus();
    setStatus(
      userProfile.scanMode === "scan_only"
        ? "Scan-only mode is running. No applications will be submitted."
        : userProfile.llmEnabled
        ? "Auto apply is running with LLM-assisted matching enabled."
        : "Auto apply is running with local matching. Likely match and Review jobs may be submitted."
    );
  } catch (error) {
    scanButton.disabled = false;
    scanButton.textContent = "Scan visible job list";
    setStatus(error?.message || "Could not start the list scan.");
  }
}

async function stopListScan() {
  stopScanButton.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "APPLE_CAREERS_STOP_SCAN"
    });

    if (response?.ok) {
      renderScanStatus(response.status);
      setStatus("Scan stopped.");
    }
  } finally {
    stopScanButton.disabled = false;
  }
}

async function clearHistory() {
  clearHistoryButton.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "APPLE_CAREERS_CLEAR_HISTORY"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not clear history.");
    }

    renderScanStatus(response.status);
    setStatus("History cleared.");
  } catch (error) {
    setStatus(error?.message || "Could not clear history.");
  } finally {
    clearHistoryButton.disabled = false;
  }
}

extractButton.addEventListener("click", extractCurrentPage);
scanButton.addEventListener("click", startListScan);
analyzeApplicationButton.addEventListener("click", analyzeApplicationPage);
runApplicationWorkflowButton.addEventListener("click", runApplicationWorkflow);
stopScanButton.addEventListener("click", stopListScan);
clearHistoryButton.addEventListener("click", clearHistory);
userYearsOfExperienceEl.addEventListener("change", saveUserProfile);
scanModeEl.addEventListener("change", saveUserProfile);
autoApplyConsentEl.addEventListener("change", saveUserProfile);
llmEnabledEl.addEventListener("change", saveUserProfile);
llmApiKeyEl.addEventListener("change", saveUserProfile);
llmModelEl.addEventListener("change", saveUserProfile);
resumeProfileEl.addEventListener("change", saveUserProfile);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[SCAN_STATUS_KEY]?.newValue) {
    return;
  }

  renderScanStatus(changes[SCAN_STATUS_KEY].newValue);
});
loadUserProfile();
refreshScanStatus();
