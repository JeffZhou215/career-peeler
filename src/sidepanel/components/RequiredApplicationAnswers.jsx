import { HelpTooltip } from "./HelpTooltip";

import {
  EEO_PROFILE_FIELDS,
  EEO_PROFILE_OPTIONS,
  getMissingRequiredApplicationAnswers
} from "../lib/profile";

function SelectAnswer({ field, idPrefix, profile, save, missing }) {
  const id = `${idPrefix}${field.key}`;
  return (
    <label className={`required-answer-field${missing ? " required-answer-field--missing" : ""}`} htmlFor={id}>
      <span>{field.label}</span>
      <select
        id={id}
        data-required-answer={field.key}
        value={profile[field.key] || ""}
        onChange={(event) => save({ [field.key]: event.target.value })}
      >
        <option value="">Select An Answer</option>
        {EEO_PROFILE_OPTIONS[field.key].map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function RequiredApplicationAnswers({ profile, save, idPrefix, sectionRef, emphasizeMissing = false }) {
  const missingFields = getMissingRequiredApplicationAnswers(profile);
  const missingKeys = new Set(missingFields.map(({ key }) => key));
  const completedCount = EEO_PROFILE_FIELDS.length - missingFields.length;
  const selectedRaces = Array.isArray(profile.eeoRaceEthnicity) ? profile.eeoRaceEthnicity : [];

  function updateRace(value, checked) {
    if (value === "prefer_not_to_disclose" && checked) {
      save({ eeoRaceEthnicity: [value] });
      return;
    }

    const withoutDecline = selectedRaces.filter((candidate) => candidate !== "prefer_not_to_disclose");
    const next = checked
      ? [...new Set([...withoutDecline, value])]
      : withoutDecline.filter((candidate) => candidate !== value);
    save({ eeoRaceEthnicity: next });
  }

  return (
    <section
      ref={sectionRef}
      className={`settings-group required-answers${emphasizeMissing && missingFields.length ? " required-answers--attention" : ""}`}
      aria-labelledby={`${idPrefix}required-answers-title`}
      tabIndex="-1"
    >
      <div className="settings-group-heading">
        <p id={`${idPrefix}required-answers-title`} className="settings-group-title">Required Application Answers<HelpTooltip label="Required Application Answers" text="Used locally only when a site requires an answer. Optional or voluntary questions stay unanswered, and these values are never sent to AI." /></p>
        <span className={`required-answers-status${missingFields.length ? "" : " required-answers-status--complete"}`}>
          {completedCount} Of {EEO_PROFILE_FIELDS.length}
        </span>
      </div>
      <div className="required-answer-grid">
        {EEO_PROFILE_FIELDS.filter(({ key }) => key !== "eeoRaceEthnicity").map((field) => (
          <SelectAnswer
            key={field.key}
            field={field}
            idPrefix={idPrefix}
            profile={profile}
            save={save}
            missing={missingKeys.has(field.key)}
          />
        ))}
      </div>
      <details
        className={`required-race-field${missingKeys.has("eeoRaceEthnicity") ? " required-answer-field--missing" : ""}`}
      >
        <summary data-required-answer="eeoRaceEthnicity">
          <span>Race / Ethnicity</span>
          <span>{selectedRaces.length ? `${selectedRaces.length} Selected` : "Not Set"}</span>
        </summary>
        <p>Select All That Apply</p>
        <div className="required-race-options">
          {EEO_PROFILE_OPTIONS.eeoRaceEthnicity.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={selectedRaces.includes(option.value)}
                onChange={(event) => updateRace(option.value, event.target.checked)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </details>
      {emphasizeMissing && missingFields.length > 0 && (
        <p className="required-answers-warning">
          Complete {missingFields.map(({ label }) => label).join(", ")} before starting auto-apply.
        </p>
      )}
    </section>
  );
}
