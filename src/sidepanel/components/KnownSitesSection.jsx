import { useRef, useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { FunctionSection } from "./FunctionSection";
import { TagInput } from "./TagInput";
import { ScanStatusPanel } from "./ScanStatusPanel";
import { ExtractResultPanel } from "./ExtractResultPanel";
import { ApplicationAnalysisPanel } from "./ApplicationAnalysisPanel";
import { ApiKeyValidationStatus } from "./ApiKeyValidationStatus";
import { AutofillActivityLog } from "./AutofillActivityLog";
import { CandidateProfileSection } from "./CandidateProfileSection";
import { RequiredApplicationAnswers } from "./RequiredApplicationAnswers";
import { getActiveTab, isSupportedCareersUrl, sendMessageWithFallback } from "../lib/format";
import { useProfileField } from "../hooks/useDraftField";
import { useApiKeyValidation } from "../hooks/useApiKeyValidation";
import { useResumeExtraction } from "../hooks/useResumeExtraction";
import {
  KNOWN_SITE_ACTIVITY_KEY,
  hasLlmProviderConfigured,
  isApiKeyValidated,
  isCandidateProfileFreshForResume,
  requiresValidatedApiKeyForScan,
  getMissingRequiredApplicationAnswers,
  hasRequiredApplicationAnswers,
  fingerprintText,
  resolveResumeProfileText
} from "../lib/profile";

export function KnownSitesSection({ profile, save, status, refreshScanStatus, setStatusMessage }) {
  const [extractResult, setExtractResult] = useState(null);
  const [applicationAnalysis, setApplicationAnalysis] = useState(null);
  const [busy, setBusy] = useState({});
  const resumeFileInputRef = useRef(null);
  const settingsRef = useRef(null);
  const requiredAnswersRef = useRef(null);

  // See src/sidepanel/hooks/useDraftField.js -- these three are the same "save() trims on every
  // keystroke" bug as GenericAutofillSection's TextField, just written as raw inputs here instead of
  // through a shared field component. resumeProfile in particular is a multi-sentence textarea, so
  // this was the highest-impact instance of the bug.
  const llmApiKeyField = useProfileField(profile, save, "llmApiKey");
  const llmModelField = useProfileField(profile, save, "llmModel");
  const resumeProfileField = useProfileField(profile, save, "resumeProfile");
  const apiKeyValidation = useApiKeyValidation({ provider: "openai", apiKey: profile.llmApiKey, profile, save });
  const resumeExtraction = useResumeExtraction({ profile, save });

  function setFieldBusy(key, value) {
    setBusy((prev) => ({ ...prev, [key]: value }));
  }

  function revealMissingRequiredAnswers(savedProfile) {
    settingsRef.current.open = true;
    const firstMissing = getMissingRequiredApplicationAnswers(savedProfile)[0]?.key;
    window.setTimeout(() => {
      const target = requiredAnswersRef.current?.querySelector?.(`[data-required-answer="${firstMissing}"]`);
      (target?.matches?.("select, input, summary") ? target : target?.querySelector?.("select, input, summary"))?.focus();
    }, 0);
  }

  // A list scan and an error-only retry can both submit, so they must share the same consent,
  // provider-validation, and current-resume extraction gate. requiresValidatedApiKeyForScan remains
  // false for local-only auto-apply; retrying errors must not accidentally make an API key mandatory
  // for that existing mode.
  async function prepareKnownSiteRunProfile() {
    let savedProfile = await save();

    if (savedProfile.scanMode === "auto_apply" && !savedProfile.autoApplyConsent) {
      setStatusMessage("Confirm the auto-apply acknowledgement before starting an auto-apply run.");
      return null;
    }

    if (savedProfile.scanMode === "auto_apply" && !hasRequiredApplicationAnswers(savedProfile)) {
      revealMissingRequiredAnswers(savedProfile);
      setStatusMessage("Complete Required Application Answers before starting auto-apply. Optional questions will still be skipped.");
      return null;
    }

    if (!requiresValidatedApiKeyForScan(savedProfile)) {
      return savedProfile;
    }

    if (!hasLlmProviderConfigured(savedProfile) || !isApiKeyValidated(savedProfile)) {
      setStatusMessage("Auto-apply job matching requires a valid API key. Configure and test it above, then try again.");
      return null;
    }

    if (!savedProfile.resumeFileDataUrl || isCandidateProfileFreshForResume(savedProfile)) {
      return savedProfile;
    }

    setStatusMessage("Preparing your candidate profile from your resume...");

    const extraction = await chrome.runtime
      .sendMessage({
        type: "APPLE_CAREERS_EXTRACT_CANDIDATE_PROFILE",
        resumeFileDataUrl: savedProfile.resumeFileDataUrl,
        resumeFileName: savedProfile.resumeFileName,
        apiKey: savedProfile.llmApiKey,
        model: savedProfile.llmModel
      })
      .catch((error) => ({ ok: false, error: error?.message }));

    if (!extraction?.ok) {
      setStatusMessage(extraction?.error || "Could not prepare your candidate profile from the resume.");
      return null;
    }

    // The extraction belongs to this exact PDF. Both full scans and saved-error retries share this
    // gate so neither can run LLM matching against a stale profile after the resume changes.
    savedProfile = await save({
      candidateProfile: extraction.candidateProfile,
      candidateProfileResumeFingerprint: fingerprintText(savedProfile.resumeFileDataUrl)
    });

    return savedProfile;
  }

  async function extractCurrentPage() {
    setFieldBusy("extract", true);
    setStatusMessage("Extracting job text from the current tab...");

    try {
      const tab = await getActiveTab();

      if (!tab?.id || !isSupportedCareersUrl(tab.url)) {
        setExtractResult(null);
        setStatusMessage("Open an Apple, TikTok, or ByteDance careers page, then try again.");
        return;
      }

      const response = await sendMessageWithFallback(tab.id, {
        type: "APPLE_CAREERS_EXTRACT_JOB",
        userYearsOfExperience: profile.userYearsOfExperience,
        noMatchKeywords: profile.noMatchKeywords,
        resumeProfileText: resolveResumeProfileText(profile)
      });

      if (!response?.ok) {
        throw new Error("The content script did not return job details.");
      }

      setExtractResult(response.data);
      setStatusMessage(
        response.data.alreadySubmitted
          ? "This job appears to have already been submitted."
          : response.data.reason || "Extraction complete."
      );
    } catch (error) {
      setExtractResult(null);
      setStatusMessage(error?.message || "Could not extract this page.");
      console.error(error);
    } finally {
      setFieldBusy("extract", false);
    }
  }

  async function analyzeApplicationPage() {
    setFieldBusy("analyze", true);
    setStatusMessage("Analyzing visible application fields...");

    try {
      const tab = await getActiveTab();

      if (!tab?.id || !isSupportedCareersUrl(tab.url)) {
        setApplicationAnalysis(null);
        setStatusMessage("Open a supported careers application page, then try again.");
        return;
      }

      const response = await sendMessageWithFallback(tab.id, {
        type: "APPLE_CAREERS_ANALYZE_APPLICATION_PAGE"
      });

      if (!response?.ok) {
        throw new Error("The content script did not return application fields.");
      }

      setApplicationAnalysis(response.data);
      setStatusMessage("Application page analyzed. No fields were filled.");
    } catch (error) {
      setApplicationAnalysis(null);
      setStatusMessage(error?.message || "Could not analyze this application page.");
      console.error(error);
    } finally {
      setFieldBusy("analyze", false);
    }
  }

  async function runApplicationWorkflow() {
    setFieldBusy("workflow", true);
    setStatusMessage("Checking the current careers application page before running the workflow.");

    try {
      const tab = await getActiveTab();
      const savedProfile = await prepareKnownSiteRunProfile();

      if (!savedProfile) {
        return;
      }

      if (!tab?.id || !isSupportedCareersUrl(tab.url)) {
        setStatusMessage("Open an Apple, TikTok, or ByteDance careers job or application page, then try again.");
        return;
      }

      const confirmed = window.confirm(
        "This diagnostic workflow can click through the application and submit it if the final Submit button is found. Continue?"
      );

      if (!confirmed) {
        setStatusMessage("Application workflow cancelled.");
        return;
      }

      setStatusMessage(
        "Running the site-specific application workflow. This can submit the application if the final Submit button is found."
      );

      const response = await chrome.runtime.sendMessage({
        type: "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW",
        tab,
        userProfile: savedProfile
      });

      if (!response?.ok) {
        throw new Error(response?.error || "The workflow did not complete.");
      }

      const clickedSteps = response.data.steps.filter((step) => step.status === "clicked").length;
      setStatusMessage(`${response.data.summary} Steps clicked: ${clickedSteps}.`);

      if (response.data?.submitted) {
        setFieldBusy("workflow", true);
        return;
      }
    } catch (error) {
      setStatusMessage(error?.message || "Could not run the application workflow.");
      console.error(error);
    } finally {
      setFieldBusy("workflow", false);
    }
  }

  async function startListScan() {
    setFieldBusy("scan", true);
    setStatusMessage("Starting scan from the current jobs list page...");

    try {
      const tab = await getActiveTab();
      const savedProfile = await prepareKnownSiteRunProfile();

      if (!savedProfile) {
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: "APPLE_CAREERS_START_SCAN",
        tab,
        userProfile: savedProfile
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not start the scan.");
      }

      await refreshScanStatus();
      setStatusMessage(
        response.rankedOnly
          ? "Apple jobs are being ranked first. Open Ranked Job Queue to review the best matches and apply later."
          : savedProfile.scanMode === "scan_only"
          ? "Scan-only mode is running. No applications will be submitted."
          : savedProfile.llmEnabled
            ? "Auto apply is running with LLM-assisted matching enabled."
            : "Auto apply is running with local matching. Only Likely Match jobs may be submitted."
      );
    } catch (error) {
      setStatusMessage(error?.message || "Could not start the list scan.");
    } finally {
      setFieldBusy("scan", false);
    }
  }

  async function retryErrorJobs() {
    setFieldBusy("retryErrors", true);
    setStatusMessage("Preparing to retry saved error jobs...");

    try {
      const savedProfile = await prepareKnownSiteRunProfile();

      if (!savedProfile) {
        return;
      }

      const tab = await getActiveTab();
      const response = await chrome.runtime.sendMessage({
        type: "APPLE_CAREERS_RETRY_ERROR_JOBS",
        tab,
        userProfile: savedProfile
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not retry the saved error jobs.");
      }

      await refreshScanStatus();
      setStatusMessage(
        savedProfile.scanMode === "scan_only"
          ? `Rechecking ${response.retryCount} saved error job${response.retryCount === 1 ? "" : "s"} without applying.`
          : `Retrying ${response.retryCount} saved error job${response.retryCount === 1 ? "" : "s"}.`
      );
    } catch (error) {
      setStatusMessage(error?.message || "Could not retry the saved error jobs.");
    } finally {
      setFieldBusy("retryErrors", false);
    }
  }

  async function stopListScan() {
    setFieldBusy("stopScan", true);

    try {
      const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_STOP_SCAN" });

      if (response?.ok) {
        await refreshScanStatus();
        setStatusMessage("Scan stopped.");
      }
    } finally {
      setFieldBusy("stopScan", false);
    }
  }

  async function clearAppliedJobs() {
    const confirmed = window.confirm(
      "Clear the saved applied-job ledger? Those jobs can be discovered and processed again on a future scan."
    );

    if (!confirmed) {
      return;
    }

    setFieldBusy("clearApplied", true);

    try {
      const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_CLEAR_APPLIED_JOBS" });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not clear applied jobs.");
      }

      await refreshScanStatus();
      setStatusMessage("Saved applied jobs cleared.");
    } catch (error) {
      setStatusMessage(error?.message || "Could not clear applied jobs.");
    } finally {
      setFieldBusy("clearApplied", false);
    }
  }

  async function clearErrorJobs() {
    const confirmed = window.confirm(
      "Clear the saved error-job ledger? Those jobs can be discovered again, but they will no longer appear in Retry Error Jobs."
    );

    if (!confirmed) {
      return;
    }

    setFieldBusy("clearErrors", true);

    try {
      const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_CLEAR_ERROR_JOBS" });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not clear error jobs.");
      }

      await refreshScanStatus();
      setStatusMessage("Saved error jobs cleared.");
    } catch (error) {
      setStatusMessage(error?.message || "Could not clear error jobs.");
    } finally {
      setFieldBusy("clearErrors", false);
    }
  }

  async function clearHistory() {
    const confirmed = window.confirm(
      "Clear all saved job history, including applied jobs, error jobs, detailed logs, and scan progress?"
    );

    if (!confirmed) {
      return;
    }

    setFieldBusy("clearHistory", true);

    try {
      const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_CLEAR_HISTORY" });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not clear history.");
      }

      await refreshScanStatus();
      setStatusMessage("History cleared.");
    } catch (error) {
      setStatusMessage(error?.message || "Could not clear history.");
    } finally {
      setFieldBusy("clearHistory", false);
    }
  }

  const running = Boolean(status.running);
  const retryableErrorCount =
    status.retryableErrorCount ??
    new Set(
      (status.errors || [])
        .map((error) => ({
          error,
          retryUrl: [error?.url, error?.manualReviewUrl].find((url) => isSupportedCareersUrl(url))
        }))
        .filter(({ retryUrl }) => retryUrl)
        .map(({ error, retryUrl }) => `${error.site || "unknown"}:${error.jobId || retryUrl}`)
    ).size;
  const savedAppliedCount = status.savedAppliedCount || 0;
  const savedErrorCount = status.savedErrorCount ?? status.errors?.length ?? 0;
  const resumeProfileIsCurrent = isCandidateProfileFreshForResume(profile);
  const resumeStatusLabel =
    resumeExtraction.extractionStatus === "extracting"
      ? "Extracting"
      : !profile.resumeFileDataUrl
        ? "Not Added"
        : resumeProfileIsCurrent
          ? "Ready"
          : "Profile Pending";
  const resumeSummaryLabel =
    resumeExtraction.extractionStatus === "extracting"
      ? "Resume Extracting"
      : !profile.resumeFileDataUrl
        ? "Resume Needed"
        : resumeProfileIsCurrent
          ? "Resume Ready"
          : "Resume Uploaded";

  return (
    <>
      <FunctionSection title="Matching And Application Settings" sectionRef={settingsRef}
        meta={resumeSummaryLabel}
        help="Manage your saved resume, OpenAI model and API key, experience, filters, application consent and required application answers. These settings are shared by submission reviews, rankings and supported job sites.">
        <div className="settings settings-flat">
          <div className="settings-groups">
            <section className="settings-group" aria-labelledby="application-settings-title">
              <p id="application-settings-title" className="settings-group-title">
                Application
              </p>
              <div className="settings-group-fields">
                <label className="field-label" htmlFor="scanMode">
                  <span>Scan Mode</span>
                  <HelpTooltip text="Scan Only records decisions. Apple Auto Apply ranks the filtered search first; submit later from Ranked Job Queue. Other supported sites automatically submit only strong matches." />
                </label>
                <select id="scanMode" value={profile.scanMode} onChange={(event) => save({ scanMode: event.target.value })}>
                  <option value="scan_only">Scan Only</option>
                  <option value="auto_apply">Auto Apply: Strong Matches</option>
                </select>

                <div className="compact-setting-row">
                  <label htmlFor="userYearsOfExperience">Experience</label>
                  <div className="experience-control">
                    <input
                      id="userYearsOfExperience"
                      type="number"
                      min="0"
                      max="50"
                      step="0.5"
                      value={profile.userYearsOfExperience}
                      onChange={(event) => save({ userYearsOfExperience: event.target.value })}
                    />
                    <span>Years</span>
                  </div>
                </div>

                {profile.scanMode === "auto_apply" && (
                  <label className="checkbox-row consent-row">
                    <input
                      id="autoApplyConsent"
                      type="checkbox"
                      checked={profile.autoApplyConsent}
                      onChange={(event) => save({ autoApplyConsent: event.target.checked })}
                    />
                    <span>I Understand This Can Submit Applications</span>
                    <HelpTooltip text="Required before auto-apply mode can submit matching jobs. Leave unchecked for scan-only use." />
                  </label>
                )}
              </div>
            </section>

            <RequiredApplicationAnswers
              profile={profile}
              save={save}
              idPrefix="knownsite-"
              sectionRef={requiredAnswersRef}
              emphasizeMissing={profile.scanMode === "auto_apply"}
            />

            <section className="settings-group" aria-labelledby="ai-settings-title">
              <div className="settings-group-heading">
                <p id="ai-settings-title" className="settings-group-title">
                  AI Matching
                </p>
                <HelpTooltip label="AI Matching" text="When disabled, supported legacy scans use the local matcher only. Ranked Job Queue requires AI matching." />
                <label className="settings-toggle" htmlFor="llmEnabled">
                  <input
                    id="llmEnabled"
                    type="checkbox"
                    checked={profile.llmEnabled}
                    onChange={(event) => save({ llmEnabled: event.target.checked })}
                  />
                  <span>{profile.llmEnabled ? "On" : "Off"}</span>
                </label>
              </div>

              {profile.llmEnabled ? (
                <div className="settings-group-fields">
                  <label className="field-label" htmlFor="llmApiKey">
                    <span>OpenAI API Key</span>
                    <HelpTooltip text="Stored locally in Chrome storage and used only from this extension to call OpenAI when LLM matching is enabled." />
                  </label>
                  <input
                    id="llmApiKey"
                    type="password"
                    placeholder="sk-..."
                    autoComplete="off"
                    {...llmApiKeyField}
                    onBlur={(event) => {
                      llmApiKeyField.onBlur(event);
                      apiKeyValidation.testNow();
                    }}
                  />
                  <ApiKeyValidationStatus
                    status={apiKeyValidation.status}
                    message={apiKeyValidation.message}
                    testing={apiKeyValidation.status === "testing"}
                    onTest={apiKeyValidation.testNow}
                    buttonLabel={apiKeyValidation.status === "valid" ? "Retest" : "Test API Key"}
                  />

                  <div className="compact-setting-row">
                    <label htmlFor="llmModel">Model</label>
                    <input id="llmModel" className="model-control" type="text" {...llmModelField} />
                  </div>
                </div>
              ) : null}
            </section>

            <section className="settings-group" aria-labelledby="resume-settings-title">
              <p id="resume-settings-title" className="settings-group-title">
                Resume
              </p>
              <div className="resume-file-row">
                <div className="resume-file-copy">
                  <strong className="resume-file-name" title={profile.resumeFileName || "No Resume Selected"}>
                    {profile.resumeFileName || "No Resume Selected"}
                  </strong>
                  <span className={`resume-file-status${resumeStatusLabel === "Ready" ? " resume-file-status--ready" : ""}`}>
                    {resumeStatusLabel}
                  </span>
                </div>
                <button
                  type="button"
                  className="secondary file-picker-button"
                  onClick={() => resumeFileInputRef.current?.click()}
                >
                  {profile.resumeFileDataUrl ? "Replace Resume" : "Choose Resume"}
                </button>
                <input
                  ref={resumeFileInputRef}
                  className="visually-hidden"
                  id="knownSiteResumeFile"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={resumeExtraction.handleResumeFileChange}
                />
              </div>
              {resumeExtraction.resumeFileError && <p className="muted">{resumeExtraction.resumeFileError}</p>}
              <CandidateProfileSection
                profile={profile}
                save={save}
                extractionStatus={resumeExtraction.extractionStatus}
                extractionError={resumeExtraction.extractionError}
                onExtractNow={resumeExtraction.extractProfile}
                idPrefix="knownsite-"
              />
            </section>

            <details className="settings-advanced">
              <summary>Advanced Matching Details</summary>
              <div className="settings-fields">
                <label className="field-label" htmlFor="resumeProfile">
                  <span>Resume/Profile Summary (Fallback)</span>
                </label>
                <textarea
                  id="resumeProfile"
                  rows={5}
                  placeholder="Paste a concise resume summary, target roles, and strongest skills."
                  {...resumeProfileField}
                />

                <label className="field-label" htmlFor="noMatchKeywordsInput">
                  <span>No-Matching Keywords</span>
                </label>
                <TagInput
                  inputId="noMatchKeywordsInput"
                  value={profile.noMatchKeywords}
                  onChange={(next) => save({ noMatchKeywords: next })}
                />
              </div>
            </details>
          </div>
        </div>
      </FunctionSection>
      <FunctionSection title="Activity And Advanced Tools"
        running={running && !/ranked queue/i.test(status.phase || "")}
        meta={running ? "Running" : undefined}
        headerAction={running && <button type="button" className="danger" disabled={busy.stopScan} onClick={stopListScan}>Stop</button>}
        help="View application activity, scan progress, saved history and diagnostic tools. Apple job searches can be ranked from Ranked Job Queue; this section also retains list scans for TikTok and ByteDance.">
        <div className="compact-list-heading"><strong>Supported Site Scans</strong>
          <HelpTooltip label="Supported Site Scans" text="Scan Apple, TikTok or ByteDance careers lists using the selected scan mode. Apple Auto Apply ranks first; actual submission happens from the saved queue." />
        </div>
        <div className="actions primary-actions known-site-actions">
          <button type="button" className="primary action-wide" disabled={running} onClick={startListScan}>
            {running ? "Scan Running" : "Scan Visible Job List"}
          </button>
          {running && (
            <button type="button" className="danger action-wide" disabled={busy.stopScan} onClick={stopListScan}>
              Stop Scan
            </button>
          )}
        </div>

        <details className="compact-fold"><summary>Activity<HelpTooltip label="Activity" text="Read the latest matching decisions and application steps, with links to the original roles." /></summary>
          <AutofillActivityLog storageKey={KNOWN_SITE_ACTIVITY_KEY} />
        </details>
        <details className="compact-fold"><summary>Scan Progress<HelpTooltip label="Scan Progress" text="Saved applications, errors, review items and detailed scan logs are available here." /></summary>
          <ScanStatusPanel status={status} />
        </details>

        <details className="compact-fold">
          <summary>Advanced Tools<HelpTooltip label="Advanced Tools" text="Inspect job pages, analyze application fields, run a diagnostic workflow or manage locally saved history. The current-job workflow can submit an application and asks for confirmation." /></summary>
          <div className="actions compact-fold-body">
            <button
              type="button"
              className="secondary"
              disabled={running || busy.clearApplied || savedAppliedCount === 0}
              onClick={clearAppliedJobs}
            >
              Clear Applied Jobs ({savedAppliedCount})
            </button>
            <button type="button" className="secondary" disabled={running || busy.clearHistory} onClick={clearHistory}>
              Clear Job History
            </button>
            {savedErrorCount > 0 && (
              <div className="known-site-error-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={running || busy.retryErrors || retryableErrorCount === 0}
                  onClick={retryErrorJobs}
                >
                  Retry Error Jobs ({retryableErrorCount})
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={running || busy.clearErrors}
                  onClick={clearErrorJobs}
                >
                  Clear Error Jobs ({savedErrorCount})
                </button>
              </div>
            )}
            <button type="button" className="secondary" disabled={busy.extract} onClick={extractCurrentPage}>
              Extract Current Page
            </button>
            <button type="button" className="secondary" disabled={busy.analyze} onClick={analyzeApplicationPage}>
              Analyze Application Page
            </button>
            <button type="button" className="secondary" disabled={busy.workflow} onClick={runApplicationWorkflow}>
              Run Current Job Workflow (Can Submit)
            </button>
          </div>
        </details>

        <ExtractResultPanel data={extractResult} />
        <ApplicationAnalysisPanel data={applicationAnalysis} />
      </FunctionSection>
    </>
  );
}
