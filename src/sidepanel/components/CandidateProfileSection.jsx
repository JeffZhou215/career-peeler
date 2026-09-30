import { HelpTooltip } from "./HelpTooltip";
import { useDraftField } from "../hooks/useDraftField";
import {
  hasLlmProviderConfigured,
  isApiKeyValidated,
  isCandidateProfileFreshForResume,
  hasCandidateProfileContent,
  SKILL_CATEGORIES
} from "../lib/profile";

const SKILL_CATEGORY_LABELS = {
  programmingLanguages: "Programming Languages",
  frameworks: "Frameworks",
  mlAi: "ML / AI",
  backend: "Backend",
  frontend: "Frontend",
  cloud: "Cloud",
  databases: "Databases",
  infrastructure: "Infrastructure / DevOps",
  distributedSystems: "Distributed Systems",
  dataEngineering: "Data Engineering",
  protocols: "Protocols / APIs",
  tools: "Tools",
  other: "Other"
};

// Open every ancestor before focusing the API key in the shared matching settings.
function focusApiKeyField() {
  const input = document.getElementById("llmApiKey");
  if (!input) {
    return;
  }
  for (let ancestor = input.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.tagName === "DETAILS") ancestor.open = true;
  }
  input.scrollIntoView({ behavior: "smooth", block: "center" });
  input.focus();
}

function updateBasicInfoField(profile, save, field, value) {
  const current = profile.candidateProfile || {};
  return save({ candidateProfile: { ...current, basicInfo: { ...(current.basicInfo || {}), [field]: value } } });
}

function CandidateBasicInfoField({ id, label, field, type = "text", profile, save }) {
  const currentValue = profile.candidateProfile?.basicInfo?.[field] ?? "";
  const draftField = useDraftField(String(currentValue), (value) =>
    updateBasicInfoField(profile, save, field, type === "number" ? (value === "" ? null : Number(value)) : value)
  );

  return (
    <>
      <label className="field-label" htmlFor={id}>
        <span>{label}</span>
      </label>
      <input id={id} type={type} autoComplete="off" {...draftField} />
    </>
  );
}

function CandidateDomainExpertiseField({ profile, save, idPrefix }) {
  const currentValue = (profile.candidateProfile?.domainExpertise || []).join(", ");
  const draftField = useDraftField(currentValue, (value) => {
    const domainExpertise = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return save({ candidateProfile: { ...(profile.candidateProfile || {}), domainExpertise } });
  });
  const id = `${idPrefix}candidateDomainExpertise`;

  return (
    <>
      <label className="field-label" htmlFor={id}>
        <span>Domain Expertise</span>
        <HelpTooltip text="Comma-separated subject-matter areas (e.g. fintech, computer vision) -- not technologies, see Skills below." />
      </label>
      <input id={id} type="text" autoComplete="off" {...draftField} />
    </>
  );
}

function CandidateSkillCategoryField({ category, profile, save, idPrefix }) {
  const currentValue = (profile.candidateProfile?.skills?.[category] || []).join(", ");
  const draftField = useDraftField(currentValue, (value) => {
    const skills = value
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean);
    const currentSkills = profile.candidateProfile?.skills || {};
    return save({ candidateProfile: { ...(profile.candidateProfile || {}), skills: { ...currentSkills, [category]: skills } } });
  });
  const id = `${idPrefix}candidateSkills-${category}`;

  return (
    <>
      <label className="field-label" htmlFor={id}>
        <span>{SKILL_CATEGORY_LABELS[category]}</span>
      </label>
      <input id={id} type="text" autoComplete="off" {...draftField} />
    </>
  );
}

function CandidateSummaryField({ profile, save, idPrefix }) {
  const currentValue = profile.candidateProfile?.professionalSummary || "";
  const draftField = useDraftField(currentValue, (value) =>
    save({ candidateProfile: { ...(profile.candidateProfile || {}), professionalSummary: value } })
  );
  const id = `${idPrefix}candidateSummary`;

  return (
    <>
      <label className="field-label" htmlFor={id}>
        <span>Professional Summary</span>
      </label>
      <textarea id={id} rows={3} {...draftField} />
    </>
  );
}

// Education/experience/projects/certifications are shown read-only, not inline-editable, in this pass
// -- a full add/edit/remove/reorder UI for four separate repeating-entry sections is a materially
// bigger, separate UI subsystem (closer to a resume builder) than this task's scope. Re-extracting, or
// editing the flat fields/summary/skills above, are today's escape hatches if something looks wrong.
function CandidateProfileEntryList({ title, entries, renderEntry }) {
  if (!entries?.length) {
    return null;
  }

  return (
    <div className="candidate-profile-entries">
      <p className="eyebrow">{title}</p>
      <ul>
        {entries.map((entry, index) => (
          <li key={index}>{renderEntry(entry)}</li>
        ))}
      </ul>
    </div>
  );
}

function renderExperienceEntry(entry) {
  const header = [entry.title, entry.company].filter(Boolean).join(" at ");
  const range = [entry.startDate, entry.endDate].filter(Boolean).join(" - ");
  const headerWithLocation = entry.location ? `${header} — ${entry.location}` : header;
  const headerWithRange = range ? `${headerWithLocation} (${range})` : headerWithLocation;
  const techSuffix = entry.technologies?.length ? ` [${entry.technologies.join(", ")}]` : "";
  return `${headerWithRange}${entry.summary ? `: ${entry.summary}` : ""}${techSuffix}`;
}

function renderEducationEntry(entry) {
  const degree = [entry.degree, entry.field ? `in ${entry.field}` : null].filter(Boolean).join(" ");
  const grade = entry.gradeAverage ? ` (GPA: ${entry.gradeAverage})` : "";
  return `${[degree, entry.institution].filter(Boolean).join(", ")}${grade}`;
}

function renderProjectEntry(entry) {
  const techSuffix = entry.technologies?.length ? ` [${entry.technologies.join(", ")}]` : "";
  return `${entry.name}${entry.description ? `: ${entry.description}` : ""}${techSuffix}`;
}

function renderCertificationEntry(entry) {
  return [entry.name, entry.issuer].filter(Boolean).join(", ");
}

// idPrefix keeps element ids unique when this renders in more than one place at once -- this repo's
// two mode-sections (KnownSitesSection, GenericAutofillSection) share a details[name="careerPeelerFunctions"]
// accordion, which only controls VISIBILITY (native browser behavior for same-name <details>) -- the
// collapsed one's content, including every id here, is still in the DOM, not removed. Without a
// distinct prefix per caller, duplicate ids would make a <label for=...> click in one section
// potentially focus the other, hidden section's field instead.
export function CandidateProfileSection({ profile, save, extractionStatus, extractionError, onExtractNow, idPrefix = "" }) {
  const hasStoredContent = hasCandidateProfileContent(profile.candidateProfile);
  if (!profile.resumeFileDataUrl && !hasStoredContent) {
    return null;
  }

  const canExtract = Boolean(profile.resumeFileDataUrl) && hasLlmProviderConfigured(profile) && isApiKeyValidated(profile);
  const hasContent =
    hasStoredContent && (!profile.resumeFileDataUrl || isCandidateProfileFreshForResume(profile));

  return (
    <>
      {!hasContent && (
        <div className="candidate-extraction-status">
          {extractionStatus === "extracting" ? (
            <p className="muted">Extracting your profile from the resume...</p>
          ) : !canExtract ? (
            <>
              <p className="muted">Resume uploaded successfully.</p>
              <p className="muted">Automatic profile extraction requires a valid API key.</p>
              <div className="actions">
                <button type="button" className="secondary" onClick={focusApiKeyField}>
                  Configure API Key
                </button>
                <button type="button" className="secondary" onClick={focusApiKeyField}>
                  Test API Key
                </button>
              </div>
            </>
          ) : (
            <>
              {extractionStatus === "error" && <p className="muted">{extractionError}</p>}
              <button type="button" className="secondary" onClick={() => onExtractNow(profile)}>
                Extract Profile From Resume
              </button>
            </>
          )}
        </div>
      )}

      {hasContent && (
        // progress-details, not settings -- this renders inside KnownSitesSection/GenericAutofillSection's
        // OWN "settings" card (via their settings-fields), so reusing the same full card class here would
        // nest an identical card inside its own parent card with no tier break between them. progress-details
        // (already used the same way for ScanStatusPanel's Errors/Needs Review/Detailed stats sub-accordions)
        // is the established pattern for "collapsible subsection within a card" -- a divider, not a second card.
        <details className="progress-details">
          <summary>
            Candidate Profile
            <HelpTooltip text="Used for matching, LLM answers, and autofill. It can be extracted from your resume and enriched from populated Workday experience/education entries stored locally. Edit fields freely, or re-extract from the current resume." />
          </summary>
          <div className="settings-fields">
            <CandidateBasicInfoField id={`${idPrefix}candidateFullName`} label="Full Name" field="fullName" profile={profile} save={save} />
            <CandidateBasicInfoField id={`${idPrefix}candidateEmail`} label="Email" field="email" profile={profile} save={save} />
            <CandidateBasicInfoField id={`${idPrefix}candidatePhone`} label="Phone" field="phone" profile={profile} save={save} />
            <CandidateBasicInfoField
              id={`${idPrefix}candidateLinkedin`}
              label="LinkedIn"
              field="linkedinUrl"
              profile={profile}
              save={save}
            />
            <CandidateBasicInfoField id={`${idPrefix}candidateGithub`} label="GitHub" field="githubUrl" profile={profile} save={save} />
            <CandidateBasicInfoField
              id={`${idPrefix}candidatePortfolio`}
              label="Portfolio"
              field="portfolioUrl"
              profile={profile}
              save={save}
            />
            <CandidateBasicInfoField id={`${idPrefix}candidateCity`} label="City" field="city" profile={profile} save={save} />
            <CandidateBasicInfoField
              id={`${idPrefix}candidateState`}
              label="State / Province"
              field="state"
              profile={profile}
              save={save}
            />
            <CandidateBasicInfoField id={`${idPrefix}candidateCountry`} label="Country" field="country" profile={profile} save={save} />
            <CandidateBasicInfoField
              id={`${idPrefix}candidateYoe`}
              label="Total Years Of Experience"
              field="totalYearsOfExperience"
              type="number"
              profile={profile}
              save={save}
            />
            <CandidateDomainExpertiseField profile={profile} save={save} idPrefix={idPrefix} />
            <CandidateSummaryField profile={profile} save={save} idPrefix={idPrefix} />

            <details className="progress-details">
              <summary>
                Skills By Category
                <HelpTooltip text="Comma-separated within each category. Any technology mentioned in the resume should land in one of these -- edit freely if extraction miscategorized something." />
              </summary>
              <div className="settings-fields">
                {SKILL_CATEGORIES.map((category) => (
                  <CandidateSkillCategoryField key={category} category={category} profile={profile} save={save} idPrefix={idPrefix} />
                ))}
              </div>
            </details>

            <CandidateProfileEntryList title="Experience" entries={profile.candidateProfile?.experience} renderEntry={renderExperienceEntry} />
            <CandidateProfileEntryList title="Education" entries={profile.candidateProfile?.education} renderEntry={renderEducationEntry} />
            <CandidateProfileEntryList title="Projects" entries={profile.candidateProfile?.projects} renderEntry={renderProjectEntry} />
            <CandidateProfileEntryList
              title="Certifications"
              entries={profile.candidateProfile?.certifications}
              renderEntry={renderCertificationEntry}
            />

            {profile.resumeFileDataUrl && (
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={!canExtract || extractionStatus === "extracting"}
                  onClick={() => onExtractNow(profile)}
                >
                  {extractionStatus === "extracting" ? "Re-Extracting..." : "Re-Extract From Resume"}
                </button>
                {!canExtract && <p className="muted">Re-extraction requires a valid API key.</p>}
                {extractionStatus === "error" && <p className="muted">{extractionError}</p>}
              </div>
            )}
          </div>
        </details>
      )}
    </>
  );
}
