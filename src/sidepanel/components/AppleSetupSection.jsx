import { useEffect, useRef } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { CandidateProfileSection } from "./CandidateProfileSection";
import { RequiredApplicationAnswers } from "./RequiredApplicationAnswers";
import { ApiKeyValidationStatus } from "./ApiKeyValidationStatus";
import { useResumeExtraction } from "../hooks/useResumeExtraction";
import { useApiKeyValidation } from "../hooks/useApiKeyValidation";
import { useProfileField } from "../hooks/useDraftField";
import { fingerprintText, isCandidateProfileFreshForResume } from "../lib/profile";

export function AppleSetupSection({ profile, save }) {
  const resume = useResumeExtraction({ profile, save });
  const picker = useRef(null);
  const parsedFile = useRef(null);
  const apiKey = useProfileField(profile, save, "llmApiKey");
  const model = useProfileField(profile, save, "llmModel");
  const validation = useApiKeyValidation({ provider: "openai", apiKey: profile.llmApiKey, profile, save });
  const fingerprint = profile.resumeFileDataUrl ? fingerprintText(profile.resumeFileDataUrl) : null;
  const textReady = Boolean(profile.resumeText?.trim() && profile.resumeTextFingerprint === fingerprint);
  const extracting = ["parsing", "extracting"].includes(resume.extractionStatus);
  useEffect(() => {
    if (!fingerprint || textReady || parsedFile.current === fingerprint) return;
    parsedFile.current = fingerprint;
    resume.parseSavedResume(profile).catch(console.error);
  }, [fingerprint, textReady]);

  return <section className="setup-content">
    <div className="ios-section-heading"><h2>Your Resume</h2><HelpTooltip label="Your Resume" text="The PDF and full parsed text are saved locally. Local and OpenAI matching use the same current resume. The LLM extracts the candidate profile directly from your PDF. Readable PDF text also supports local matching. Image-based PDFs use the extracted profile." /></div>
    <div className="ios-group">
      <div className="resume-file-row"><div className="resume-file-copy"><strong>{profile.resumeFileName || "No Resume Added"}</strong><span className="muted">{extracting ? "Extracting…" : textReady ? "Text Ready" : isCandidateProfileFreshForResume(profile) ? "Profile Ready" : profile.resumeFileDataUrl ? "Profile Pending" : "Upload A PDF Resume"}</span></div>
        <button type="button" className="secondary" disabled={extracting} onClick={() => picker.current.click()}>{profile.resumeFileDataUrl ? "Replace" : "Upload Resume"}</button>
        <input ref={picker} type="file" accept="application/pdf,.pdf" className="visually-hidden" onChange={resume.handleResumeFileChange} /></div>
      {(resume.resumeFileError || resume.extractionError) && <p className="submitted-history-error" role="alert">{resume.resumeFileError || resume.extractionError}</p>}
      <details className="compact-fold"><summary>Parsed Resume Text</summary><div className="compact-fold-body">
        {textReady ? <textarea readOnly value={profile.resumeText} rows="9" aria-label="Parsed Resume Text" /> : <p className="muted">No readable PDF text yet.</p>}
        <button type="button" className="secondary" disabled={!profile.resumeFileDataUrl || extracting} onClick={() => save({ resumeTextFingerprint: "" }).then((saved) => resume.parseSavedResume(saved))}>Extract Text Again</button>
      </div></details>
      <CandidateProfileSection profile={profile} save={save} idPrefix="apple-" extractionStatus={resume.extractionStatus} extractionError={resume.extractionError} onExtractNow={resume.extractProfile} />
      {profile.resumeFileDataUrl && <span className="compact-role-meta">{isCandidateProfileFreshForResume(profile) ? "Profile Ready" : "Extract Profile After Configuring AI Matching"}</span>}
    </div>
    <div className="ios-section-heading"><h2>AI Matching</h2><HelpTooltip label="AI Matching" text="Local matching runs on your device. Ranking uses your OpenAI key and model to assess full postings against your resume. Scores and descriptions are reused when unchanged." /></div>
    <div className="ios-group settings-group-fields">
      <label className="checkbox-row"><input type="checkbox" checked={profile.llmEnabled} onChange={(event) => save({ llmEnabled: event.target.checked })} /><span>Enable LLM Matching</span></label>
      <label className="field-label" htmlFor="llmApiKey">OpenAI API Key</label><input id="llmApiKey" type="password" autoComplete="off" placeholder="sk-…" {...apiKey} />
      <ApiKeyValidationStatus status={validation.status} message={validation.message} testing={validation.status === "testing"} onTest={validation.testNow} />
      <label className="field-label" htmlFor="llmModel">Model</label><input id="llmModel" {...model} />
    </div>
    <details className="ios-group compact-fold"><summary>Application Profile</summary><div className="compact-fold-body">
      <label className="field-label" htmlFor="years">Years Of Professional Experience<HelpTooltip text="Use the experience level supported by your resume. Explicit required experience and senior scope are assessed separately from general skills." /></label>
      <input id="years" type="number" min="0" max="50" step="0.5" value={profile.userYearsOfExperience} onChange={(event) => save({ userYearsOfExperience: event.target.value })} />
      <RequiredApplicationAnswers profile={profile} save={save} idPrefix="apple-" />
      <div className="compact-setting-row"><label htmlFor="authorized">Work Authorized</label><select id="authorized" value={profile.workAuthorized} onChange={(event) => save({workAuthorized:event.target.value})}><option value="">Not Set</option><option value="yes">Yes</option><option value="no">No</option></select></div>
      <div className="compact-setting-row"><label htmlFor="sponsorship">Requires Sponsorship</label><select id="sponsorship" value={profile.requiresSponsorship} onChange={(event) => save({requiresSponsorship:event.target.value})}><option value="">Not Set</option><option value="yes">Yes</option><option value="no">No</option></select></div>
    </div></details>
    <details className="ios-group compact-fold"><summary>Matching Rules</summary><div className="compact-fold-body">
      <p>Responsibilities 40% · Minimum Qualifications 35% · Experience Level 15% · Domain 10%</p>
      <p>Strong Matches Require 80% Overall, Verified Substantive Minimum Qualifications, Strong Responsibility And Level Scores, And High Confidence.</p>
      <p>Routine Coding-Assistant Usage Does Not Affect Scores Or Block Applications. Building Agent Systems Still Requires Technical Evidence.</p>
      <p>Preferred Qualifications Are Bonuses. Scored Jobs With Concerns Can Be Selected For Reviewed Applications.</p>
    </div></details>
  </section>;
}
