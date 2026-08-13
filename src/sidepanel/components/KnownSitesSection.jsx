import { useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { TagInput } from "./TagInput";
import { ScanStatusPanel } from "./ScanStatusPanel";
import { ExtractResultPanel } from "./ExtractResultPanel";
import { ApplicationAnalysisPanel } from "./ApplicationAnalysisPanel";
import { getActiveTab, isSupportedCareersUrl, sendMessageWithFallback } from "../lib/format";
import { useProfileField } from "../hooks/useDraftField";

export function KnownSitesSection({ profile, save, status, refreshScanStatus, setStatusMessage }) {
  const [extractResult, setExtractResult] = useState(null);
  const [applicationAnalysis, setApplicationAnalysis] = useState(null);
  const [busy, setBusy] = useState({});

  // See src/sidepanel/hooks/useDraftField.js -- these three are the same "save() trims on every
  // keystroke" bug as GenericAutofillSection's TextField, just written as raw inputs here instead of
  // through a shared field component. resumeProfile in particular is a multi-sentence textarea, so
  // this was the highest-impact instance of the bug.
  const llmApiKeyField = useProfileField(profile, save, "llmApiKey");
  const llmModelField = useProfileField(profile, save, "llmModel");
  const resumeProfileField = useProfileField(profile, save, "resumeProfile");

  function setFieldBusy(key, value) {
    setBusy((prev) => ({ ...prev, [key]: value }));
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
        noMatchKeywords: profile.noMatchKeywords
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
        tab
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
      const savedProfile = await save();

      if (savedProfile.scanMode === "auto_apply" && !savedProfile.autoApplyConsent) {
        setStatusMessage("Confirm the auto-apply acknowledgement before starting an auto-apply scan.");
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
        savedProfile.scanMode === "scan_only"
          ? "Scan-only mode is running. No applications will be submitted."
          : savedProfile.llmEnabled
            ? "Auto apply is running with LLM-assisted matching enabled."
            : "Auto apply is running with local matching. Likely match and Review jobs may be submitted."
      );
    } catch (error) {
      setStatusMessage(error?.message || "Could not start the list scan.");
    } finally {
      setFieldBusy("scan", false);
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

  async function clearHistory() {
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

  return (
    <details name="autofillMode" className="mode-section" open>
      <summary>
        <h2>
          Apple / TikTok / ByteDance
          <HelpTooltip text="Scan a job list page across pagination and auto-apply with site-specific handling." />
        </h2>
      </summary>
      <div className="mode-section-body">
        <details className="settings">
          <summary>Matching and application settings</summary>
          <div className="settings-fields">
            <label className="field-label" htmlFor="userYearsOfExperience">
              <span>Years of experience</span>
              <HelpTooltip text="Used to skip roles whose required years of experience are above your profile." />
            </label>
            <input
              id="userYearsOfExperience"
              type="number"
              min="0"
              max="50"
              step="0.5"
              value={profile.userYearsOfExperience}
              onChange={(event) => save({ userYearsOfExperience: event.target.value })}
            />

            <label className="field-label" htmlFor="scanMode">
              <span>Scan mode</span>
              <HelpTooltip text="Scan only records decisions without submitting applications. Auto apply submits likely matches and review jobs." />
            </label>
            <select id="scanMode" value={profile.scanMode} onChange={(event) => save({ scanMode: event.target.value })}>
              <option value="scan_only">Scan only, do not apply</option>
              <option value="auto_apply">Auto apply likely match and review jobs</option>
            </select>

            <label className="checkbox-row">
              <input
                id="autoApplyConsent"
                type="checkbox"
                checked={profile.autoApplyConsent}
                onChange={(event) => save({ autoApplyConsent: event.target.checked })}
              />
              <span>I understand auto-apply can submit real applications</span>
              <HelpTooltip text="Required before auto-apply mode can submit matching jobs. Leave unchecked for scan-only use." />
            </label>

            <label className="checkbox-row">
              <input
                id="llmEnabled"
                type="checkbox"
                checked={profile.llmEnabled}
                onChange={(event) => save({ llmEnabled: event.target.checked })}
              />
              <span>Use LLM-assisted matching</span>
              <HelpTooltip text="Sends the job text and your resume summary to OpenAI for a second opinion. Local matching is still used as the fallback." />
            </label>

            <label className="field-label" htmlFor="llmApiKey">
              <span>OpenAI API key</span>
              <HelpTooltip text="Stored locally in Chrome storage and used only from this extension to call OpenAI when LLM matching is enabled." />
            </label>
            <input
              id="llmApiKey"
              type="password"
              placeholder="sk-..."
              autoComplete="off"
              {...llmApiKeyField}
            />

            <label className="field-label" htmlFor="llmModel">
              <span>LLM model</span>
              <HelpTooltip text="The OpenAI model used for matching. gpt-4o-mini is a good low-cost default." />
            </label>
            <input id="llmModel" type="text" {...llmModelField} />

            <label className="field-label" htmlFor="resumeProfile">
              <span>Resume/profile summary</span>
              <HelpTooltip text="A concise summary of your target roles, strongest skills, and domains to avoid. This improves LLM matching quality." />
            </label>
            <textarea
              id="resumeProfile"
              rows={5}
              placeholder="Paste a concise resume summary, target roles, and strongest skills."
              {...resumeProfileField}
            />

            <label className="field-label" htmlFor="noMatchKeywordsInput">
              <span>No-matching keywords</span>
              <HelpTooltip text="Pick from common tech keywords or type your own and press Enter. If a job posting mentions any of these, it's hard-skipped locally before the LLM is ever called, saving API cost." />
            </label>
            <TagInput
              inputId="noMatchKeywordsInput"
              value={profile.noMatchKeywords}
              onChange={(next) => save({ noMatchKeywords: next })}
            />
          </div>
        </details>

        <div className="actions primary-actions">
          <button type="button" className="primary" disabled={running} onClick={startListScan}>
            {running ? "Scan Running" : "Scan visible job list"}
          </button>
          {running && (
            <button type="button" className="danger" disabled={busy.stopScan} onClick={stopListScan}>
              Stop scan
            </button>
          )}
          <button type="button" className="secondary" disabled={running || busy.clearHistory} onClick={clearHistory}>
            Clear job history
          </button>
        </div>

        <ScanStatusPanel status={status} />

        <details className="advanced">
          <summary>Advanced tools</summary>
          <div className="actions">
            <button type="button" className="secondary" disabled={busy.extract} onClick={extractCurrentPage}>
              Extract current page
            </button>
            <button type="button" className="secondary" disabled={busy.analyze} onClick={analyzeApplicationPage}>
              Analyze application page
            </button>
            <button type="button" className="secondary" disabled={busy.workflow} onClick={runApplicationWorkflow}>
              Run current job workflow (can submit)
            </button>
          </div>
        </details>

        <ExtractResultPanel data={extractResult} />
        <ApplicationAnalysisPanel data={applicationAnalysis} />
      </div>
    </details>
  );
}
