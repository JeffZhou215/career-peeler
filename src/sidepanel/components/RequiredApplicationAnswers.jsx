import { useRef, useState } from "react";
import { HelpTooltip } from "./HelpTooltip";

import {
  EEO_PROFILE_FIELDS,
  EEO_PROFILE_OPTIONS,
  getMissingRequiredApplicationAnswers,
  normalizeApplicationQuestionKey,
  normalizeApplicationQuestionAnswers
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

// These are explicit answers to the exact question the user reviewed. In particular, a criminal
// conviction answer must not become an answer to a differently scoped arrest/background question.
export function SavedQuestionAnswers({ profile, save, idPrefix }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const answers = normalizeApplicationQuestionAnswers(profile.applicationQuestionAnswers);
  const questionKey = normalizeApplicationQuestionKey(question);

  async function saveAnswer() {
    if (savingRef.current || !questionKey || !["yes", "no"].includes(answer)) return;
    if (!Object.hasOwn(answers, questionKey) && Object.keys(answers).length >= 100) {
      setError("Remove a saved answer before adding another. You can save up to 100 questions.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await save({ applicationQuestionAnswers: { ...answers, [questionKey]: answer } });
      setQuestion("");
      setAnswer("");
    } catch (failure) {
      setError(failure?.message || "The answer could not be saved.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function removeAnswer(key) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const next = { ...answers };
    delete next[key];
    setError("");
    try {
      await save({ applicationQuestionAnswers: next });
    } catch (failure) {
      setError(failure?.message || "The answer could not be removed.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <details className="compact-fold">
    <summary>Saved Question Answers</summary>
    <div className="compact-fold-body">
      <p className="muted">Copy the exact personal Yes/No question from Apple. An unsaved or differently worded question stops for manual review. These answers stay on your device and are never inferred from your PDF or sent to AI.</p>
      {Object.entries(answers).map(([key, value]) => <div key={key} className="settings-group">
        <p>{key}</p>
        <div className="compact-setting-row"><span>{value === "yes" ? "Yes" : "No"}</span>
          <button type="button" className="secondary" disabled={saving} aria-label={`Remove Saved Answer: ${key}`} onClick={() => removeAnswer(key)}>Remove</button>
        </div>
      </div>)}
      <label className="field-label" htmlFor={`${idPrefix}saved-question`}>Exact Question</label>
      <textarea id={`${idPrefix}saved-question`} rows="3" maxLength="500" value={question} disabled={saving} onChange={(event) => setQuestion(event.target.value)} />
      <label className="field-label" htmlFor={`${idPrefix}saved-answer`}>Your Answer</label>
      <select id={`${idPrefix}saved-answer`} value={answer} disabled={saving} onChange={(event) => setAnswer(event.target.value)}>
        <option value="">Not Set</option><option value="yes">Yes</option><option value="no">No</option>
      </select>
      <button type="button" className="secondary" disabled={saving || !questionKey || !answer} onClick={saveAnswer}>Save Answer</button>
      {error && <p className="submitted-history-error" role="alert">{error}</p>}
    </div>
  </details>;
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
