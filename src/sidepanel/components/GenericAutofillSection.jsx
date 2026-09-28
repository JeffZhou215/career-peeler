import { useRef, useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { GenericAutofillResultPanel } from "./GenericAutofillResultPanel";
import { AutofillActivityLog } from "./AutofillActivityLog";
import { CandidateProfileSection } from "./CandidateProfileSection";
import { RequiredApplicationAnswers } from "./RequiredApplicationAnswers";
import { getActiveTab } from "../lib/format";
import { useProfileField } from "../hooks/useDraftField";
import { useResumeExtraction } from "../hooks/useResumeExtraction";
import {
  GENERIC_AUTOFILL_ACTIVITY_KEY,
  getMissingRequiredApplicationAnswers,
  hasRequiredApplicationAnswers
} from "../lib/profile";

function TextField({ id, label, type = "text", profile, save }) {
  const field = useProfileField(profile, save, id);

  return (
    <>
      <label className="field-label" htmlFor={id}>
        <span>{label}</span>
      </label>
      <input id={id} type={type} autoComplete="off" {...field} />
    </>
  );
}

function YesNoField({ id, label, help, profile, save }) {
  return (
    <>
      <label className="field-label" htmlFor={id}>
        <span>{label}</span>
        {help && <HelpTooltip text={help} />}
      </label>
      <select id={id} value={profile[id]} onChange={(event) => save({ [id]: event.target.value })}>
        <option value="">Not set -- always ask me</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </>
  );
}

export function GenericAutofillSection({ profile, save, setStatusMessage }) {
  const [autofillBusy, setAutofillBusy] = useState(false);
  const [autofillResult, setAutofillResult] = useState(null);
  const settingsRef = useRef(null);
  const requiredAnswersRef = useRef(null);
  const { extractionStatus, extractionError, resumeFileError, handleResumeFileChange, extractProfile } = useResumeExtraction({ profile, save });

  async function runGenericAutofill() {
    setAutofillBusy(true);
    setStatusMessage("Autofilling this page...");

    try {
      const tab = await getActiveTab();

      if (!tab?.id || !/^https?:$/.test(new URL(tab.url || "").protocol || "")) {
        setStatusMessage("Open a job application page in this tab, then try again.");
        return;
      }

      const hostname = new URL(tab.url).hostname.toLowerCase();
      const isWorkday = ["myworkdayjobs.com", "myworkdaysite.com"].some(
        (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
      );
      if (isWorkday) {
        setStatusMessage("Running Workday auto-apply across application steps...");
      }

      const savedProfile = await save();

      if (savedProfile.scanMode === "auto_apply" && !hasRequiredApplicationAnswers(savedProfile)) {
        settingsRef.current.open = true;
        const firstMissing = getMissingRequiredApplicationAnswers(savedProfile)[0]?.key;
        window.setTimeout(() => {
          const target = requiredAnswersRef.current?.querySelector?.(`[data-required-answer="${firstMissing}"]`);
          (target?.matches?.("select, input, summary") ? target : target?.querySelector?.("select, input, summary"))?.focus();
        }, 0);
        setStatusMessage("Complete Required Application Answers before running auto-apply. Optional questions will still be skipped.");
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: "APPLE_CAREERS_RUN_GENERIC_AUTOFILL_WORKFLOW",
        tab,
        userProfile: savedProfile
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Autofill did not complete.");
      }

      setAutofillResult(response.data);
      if (response.data.clickedApplyEntry) {
        setStatusMessage(`Clicked "${response.data.applyEntryLabel}" to start the application. Click Autofill again once the form loads.`);
      } else if (response.data.confirmationPending) {
        setStatusMessage(
          response.data.workdayPagesProcessed
            ? `Workday auto-apply reached Submit after ${response.data.workdayPagesProcessed} page(s); confirmation pending.`
            : "Autofill complete. Submit clicked; confirmation pending."
        );
      } else if (response.data.submitAttempted) {
        setStatusMessage("Autofill complete, but the Submit button could not be clicked.");
      } else if (response.data.flaggedFields.length > 0) {
        setStatusMessage(
          `${response.data.workdayPagesProcessed ? "Workday auto-apply stopped" : "Autofill complete"}. ` +
            `${response.data.flaggedFields.length} field(s) need your review before you submit.`
        );
      } else {
        setStatusMessage("Autofill complete. Submit was not clicked.");
      }
    } catch (error) {
      setStatusMessage(error?.message || "Could not autofill this page.");
      console.error(error);
    } finally {
      setAutofillBusy(false);
    }
  }

  return (
    <details name="autofillMode" className="mode-section">
      <summary>
        <h2>
          Other Job Sites
          <HelpTooltip text="Generic autofill for any application page -- Greenhouse, Lever, Workday, and everything else." />
        </h2>
      </summary>
      <div className="mode-section-body">
        <details ref={settingsRef} className="settings">
          <summary>
            Autofill Profile
            <HelpTooltip text="Any field left blank is skipped and flagged for you to fill in yourself." />
          </summary>
          <div className="settings-fields">
            <TextField id="firstName" label="First name" profile={profile} save={save} />
            <TextField id="lastName" label="Last name" profile={profile} save={save} />
            <TextField id="email" label="Email" type="email" profile={profile} save={save} />
            <TextField id="phone" label="Phone" type="tel" profile={profile} save={save} />
            <TextField id="addressLine1" label="Street address" profile={profile} save={save} />
            <TextField id="addressLine2" label="Address line 2 (apartment/suite/unit, optional)" profile={profile} save={save} />
            <TextField id="addressCity" label="City" profile={profile} save={save} />
            <TextField id="addressState" label="State / province" profile={profile} save={save} />
            <TextField id="addressPostalCode" label="Postal code" profile={profile} save={save} />
            <TextField id="addressCountry" label="Country" profile={profile} save={save} />
            <TextField id="linkedinUrl" label="LinkedIn URL" type="url" profile={profile} save={save} />
            <TextField id="githubUrl" label="GitHub URL" type="url" profile={profile} save={save} />
            <TextField id="portfolioUrl" label="Portfolio / website URL" type="url" profile={profile} save={save} />

            <label className="field-label" htmlFor="genericResumeFile">
              <span>Resume file</span>
              <HelpTooltip text="Stored locally in Chrome storage and attached to a resume upload field, if one is found, by handing the page a real file object -- no file path needed. Also used for automatic profile extraction, same as the Apple/TikTok/ByteDance section's copy -- one shared resume across both." />
            </label>
            <input id="genericResumeFile" type="file" accept="application/pdf,.pdf" onChange={handleResumeFileChange} />
            {resumeFileError && <p className="muted">{resumeFileError}</p>}
            <p className="muted">{profile.resumeFileName ? `Current resume: ${profile.resumeFileName}` : "No resume selected."}</p>
            <CandidateProfileSection
              profile={profile}
              save={save}
              extractionStatus={extractionStatus}
              extractionError={extractionError}
              onExtractNow={extractProfile}
              idPrefix="generic-"
            />

            <YesNoField
              id="workAuthorized"
              label="Authorized to work in your country?"
              help="Left unset by default -- unset answers are always flagged for your review rather than guessed."
              profile={profile}
              save={save}
            />
            <YesNoField id="requiresSponsorship" label="Requires visa sponsorship?" profile={profile} save={save} />

            <RequiredApplicationAnswers
              profile={profile}
              save={save}
              idPrefix="generic-"
              sectionRef={requiredAnswersRef}
              emphasizeMissing={profile.scanMode === "auto_apply"}
            />

            <TextField id="desiredSalary" label="Desired salary" profile={profile} save={save} />
            <TextField id="availableStartDate" label="Earliest start date" profile={profile} save={save} />
          </div>
        </details>

        <div className="actions primary-actions">
          <div className="button-with-help">
            <button type="button" className="primary" disabled={autofillBusy} onClick={runGenericAutofill}>
              Autofill This Page
            </button>
            <HelpTooltip text="Fills what it can confidently match from your autofill profile above, drafts an answer for open-ended questions, and flags anything else for you to review." />
          </div>
        </div>

        <AutofillActivityLog storageKey={GENERIC_AUTOFILL_ACTIVITY_KEY} />
        <GenericAutofillResultPanel data={autofillResult} />
      </div>
    </details>
  );
}
