import { HelpTooltip } from "./HelpTooltip";
import { useDraftField } from "../hooks/useDraftField";
import { hasLlmProviderConfigured, isApiKeyValidated, hasCandidateProfileContent, SKILL_CATEGORIES } from "../lib/profile";

const SKILL_CATEGORY_LABELS = {
  programmingLanguages: "Programming languages",
  frameworks: "Frameworks",
  mlAi: "ML / AI",
  backend: "Backend",
  frontend: "Frontend",
  cloud: "Cloud",
  databases: "Databases",
  infrastructure: "Infrastructure / DevOps",
  distributedSystems: "Distributed systems",
  dataEngineering: "Data engineering",
  protocols: "Protocols / APIs",
  tools: "Tools",
  other: "Other"
};

// Scrolls to and opens the API key field over in KnownSitesSection -- the two top-level sections share
// a details[name="autofillMode"] accordion (native browser exclusive-open behavior), so opening this
// one closes GenericAutofillSection's automatically, no extra code needed for that part.
function focusApiKeyField() {
  const input = document.getElementById("llmApiKey");
  if (!input) {
    return;
  }
  for (const details of [input.closest("details.settings"), input.closest("details[name='autofillMode']")]) {
    if (details) {
      details.open = true;
    }
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
        <span>Domain expertise</span>
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
        <span>Professional summary</span>
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
  const headerWithRange = range ? `${header} (${range})` : header;
  const techSuffix = entry.technologies?.length ? ` [${entry.technologies.join(", ")}]` : "";
  return `${headerWithRange}${entry.summary ? `: ${entry.summary}` : ""}${techSuffix}`;
}

function renderEducationEntry(entry) {
  const degree = [entry.degree, entry.field ? `in ${entry.field}` : null].filter(Boolean).join(" ");
  return [degree, entry.institution].filter(Boolean).join(", ");
}

function renderProjectEntry(entry) {
  const techSuffix = entry.technologies?.length ? ` [${entry.technologies.join(", ")}]` : "";
  return `${entry.name}${entry.description ? `: ${entry.description}` : ""}${techSuffix}`;
}

function renderCertificationEntry(entry) {
  return [entry.name, entry.issuer].filter(Boolean).join(", ");
}

// idPrefix keeps element ids unique when this renders in more than one place at once -- this repo's
// two mode-sections (KnownSitesSection, GenericAutofillSection) share a details[name="autofillMode"]
// accordion, which only controls VISIBILITY (native browser behavior for same-name <details>) -- the
// collapsed one's content, including every id here, is still in the DOM, not removed. Without a
// distinct prefix per caller, duplicate ids would make a <label for=...> click in one section
// potentially focus the other, hidden section's field instead.
export function CandidateProfileSection({ profile, save, extractionStatus, extractionError, onExtractNow, idPrefix = "" }) {
  if (!profile.resumeFileDataUrl) {
    return null;
  }

  const canExtract = hasLlmProviderConfigured(profile) && isApiKeyValidated(profile);
  const hasContent = hasCandidateProfileContent(profile.candidateProfile);

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
                Extract profile from resume
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
            Extracted candidate profile
            <HelpTooltip text="Automatically extracted from your resume and used for matching, LLM answers, and autofill. Edit any field, or re-extract to overwrite with a fresh pass." />
          </summary>
          <div className="settings-fields">
            <CandidateBasicInfoField id={`${idPrefix}candidateFullName`} label="Full name" field="fullName" profile={profile} save={save} />
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
              label="State / province"
              field="state"
              profile={profile}
              save={save}
            />
            <CandidateBasicInfoField id={`${idPrefix}candidateCountry`} label="Country" field="country" profile={profile} save={save} />
            <CandidateBasicInfoField
              id={`${idPrefix}candidateYoe`}
              label="Total years of experience"
              field="totalYearsOfExperience"
              type="number"
              profile={profile}
              save={save}
            />
            <CandidateDomainExpertiseField profile={profile} save={save} idPrefix={idPrefix} />
            <CandidateSummaryField profile={profile} save={save} idPrefix={idPrefix} />

            <details className="progress-details">
              <summary>
                Skills by category
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

            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={!canExtract || extractionStatus === "extracting"}
                onClick={() => onExtractNow(profile)}
              >
                {extractionStatus === "extracting" ? "Re-extracting..." : "Re-extract from resume"}
              </button>
              {!canExtract && <p className="muted">Re-extraction requires a valid API key.</p>}
              {extractionStatus === "error" && <p className="muted">{extractionError}</p>}
            </div>
          </div>
        </details>
      )}
    </>
  );
}
