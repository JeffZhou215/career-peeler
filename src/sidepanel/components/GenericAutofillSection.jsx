import { useState } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { GenericAutofillResultPanel } from "./GenericAutofillResultPanel";
import { AutofillActivityLog } from "./AutofillActivityLog";
import { CandidateProfileSection } from "./CandidateProfileSection";
import { getActiveTab } from "../lib/format";
import { useProfileField } from "../hooks/useDraftField";
import { useResumeExtraction } from "../hooks/useResumeExtraction";
import { GENERIC_AUTOFILL_ACTIVITY_KEY } from "../lib/profile";

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

function EeoSelectField({ id, label, options, profile, save }) {
  return (
    <>
      <label className="field-label" htmlFor={id}>
        <span>{label}</span>
      </label>
      <select id={id} value={profile[id]} onChange={(event) => save({ [id]: event.target.value })}>
        <option value="">Not set -- always ask me</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </>
  );
}

export function GenericAutofillSection({ profile, save, setStatusMessage }) {
  const [autofillBusy, setAutofillBusy] = useState(false);
  const [autofillResult, setAutofillResult] = useState(null);
  const { extractionStatus, extractionError, handleResumeFileChange, extractProfile } = useResumeExtraction({ profile, save });

  // Some sites' form fields reject a value set via the normal, DOM-level autofill path outright --
  // background.js's typeViaDebugger falls back to real CDP keyboard input for exactly those fields,
  // but chrome.debugger is a sensitive, optional permission (see manifest.json), so it's requested
  // here rather than bundled into the install-time grant. This is the ONLY place that can request it:
  // chrome.permissions.request() needs an active user gesture, which this button click is and a
  // message handler deep in the autofill sweep is not, and content scripts can't call the permissions
  // API at all. A decline isn't fatal -- it just means that fallback won't be available this run;
  // fields that would have needed it get flagged for manual review instead, same as before this
  // existed.
  async function ensureDebuggerPermission() {
    const alreadyGranted = await chrome.permissions.contains({ permissions: ["debugger"] }).catch(() => false);
    return alreadyGranted || (await chrome.permissions.request({ permissions: ["debugger"] }).catch(() => false));
  }

  async function runGenericAutofill() {
    setAutofillBusy(true);
    setStatusMessage("Autofilling this page...");

    try {
      const tab = await getActiveTab();

      if (!tab?.id || !/^https?:$/.test(new URL(tab.url || "").protocol || "")) {
        setStatusMessage("Open a job application page in this tab, then try again.");
        return;
      }

      await ensureDebuggerPermission();

      const savedProfile = await save();

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
      } else {
        setStatusMessage(
          response.data.submitted
            ? "Autofill complete and submitted."
            : `Autofill complete. ${response.data.flaggedFields.length} field(s) need your review before you submit.`
        );
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
        <details className="settings">
          <summary>
            Autofill profile
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
              <HelpTooltip text="Stored locally in Chrome storage and attached to a resume upload field, if one is found, by handing the page a real file object -- no debugger permission or file path needed. Also used for automatic profile extraction, same as the Apple/TikTok/ByteDance section's copy -- one shared resume across both." />
            </label>
            <input id="genericResumeFile" type="file" accept=".pdf,.doc,.docx" onChange={handleResumeFileChange} />
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

            <EeoSelectField
              id="eeoGender"
              label="Gender (EEO)"
              options={["Male", "Female", "Non-binary", "Decline to self-identify"]}
              profile={profile}
              save={save}
            />
            <EeoSelectField
              id="eeoRaceEthnicity"
              label="Race / ethnicity (EEO)"
              options={[
                "Hispanic or Latino",
                "White (Not Hispanic or Latino)",
                "Black or African American (Not Hispanic or Latino)",
                "Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)",
                "Asian (Not Hispanic or Latino)",
                "Native American or Alaska Native (Not Hispanic or Latino)",
                "Two or More Races (Not Hispanic or Latino)",
                "Decline to self-identify"
              ]}
              profile={profile}
              save={save}
            />
            <EeoSelectField
              id="eeoVeteranStatus"
              label="Veteran status (EEO)"
              options={[
                "I am not a protected veteran",
                "I identify as one or more classifications of a protected veteran",
                "I don't wish to answer"
              ]}
              profile={profile}
              save={save}
            />
            <EeoSelectField
              id="eeoDisabilityStatus"
              label="Disability status (EEO)"
              options={[
                "Yes, I have a disability, or have had one in the past",
                "No, I do not have a disability and have not had one in the past",
                "I do not want to answer"
              ]}
              profile={profile}
              save={save}
            />

            <TextField id="desiredSalary" label="Desired salary" profile={profile} save={save} />
            <TextField id="availableStartDate" label="Earliest start date" profile={profile} save={save} />
          </div>
        </details>

        <div className="actions primary-actions">
          <div className="button-with-help">
            <button type="button" className="primary" disabled={autofillBusy} onClick={runGenericAutofill}>
              Autofill this page
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
