// Field/question classification -- mapping a label to a profile concept, and finding option-group
// question containers on the page. Pure-ish (no chrome.* calls), so the label-only functions here are
// directly unit-tested via tests/genericAutofill.test.js's VM harness. See domHelpers.js for the
// shared-namespace pattern this file (and the rest of genericAutofill/) follows.
(function () {
  const GA = window.__careerPeelerGA;
  const {
    normalizeText,
    isElementVisible,
    isActionDisabled,
    getActionLabel,
    isEssayQuestionLabel,
    isWorkAuthorizationQuestion,
    isVisaSponsorshipQuestion,
    isPreviousEmploymentQuestion,
    isReferralSourceQuestion
  } = GA;

  const FIELD_CONCEPT_RULES = [
    { profileKey: "firstName", pattern: /\bfirst name\b/i },
    { profileKey: "lastName", pattern: /\blast name\b/i },
    // Combined-name fields are common on e-signature/legal sections ("type your full legal name as
    // your signature"). Checked before "email" etc. only because it's grouped with the other name
    // rules -- order doesn't matter here since none of these patterns overlap.
    { profileKey: "fullName", pattern: /\b(full name|legal name|your full name|applicant'?s? name|signature name)\b/i },
    { profileKey: "email", pattern: /\b(email|e-mail)\b/i },
    { profileKey: "phone", pattern: /\b(phone|mobile|telephone)\b/i },
    { profileKey: "addressLine1", pattern: /\b(street address|address line|mailing address|address)\b/i },
    { profileKey: "addressCity", pattern: /\bcity\b/i },
    { profileKey: "addressState", pattern: /\b(state|province)\b/i },
    { profileKey: "addressPostalCode", pattern: /\b(zip|postal code)\b/i },
    { profileKey: "addressCountry", pattern: /\bcountry\b/i },
    { profileKey: "linkedinUrl", pattern: /\blinkedin\b/i },
    { profileKey: "githubUrl", pattern: /\bgithub\b/i },
    { profileKey: "portfolioUrl", pattern: /\b(portfolio|personal site|personal website)\b/i },
    { profileKey: "eeoGender", pattern: /\bgender\b/i },
    { profileKey: "eeoRaceEthnicity", pattern: /\b(race|ethnicity)\b/i },
    { profileKey: "eeoVeteranStatus", pattern: /\bveteran\b/i },
    { profileKey: "eeoDisabilityStatus", pattern: /\bdisabilit(y|ies)\b/i },
    { profileKey: "desiredSalary", pattern: /\b(salary|compensation|expected pay|pay expectations?)\b/i },
    { profileKey: "availableStartDate", pattern: /\b(start date|available to start|earliest start)\b/i }
  ];

  // Pure classification: label -> { action, profileKey | value } | null. No profile/element access,
  // so this (and the option-matching helpers below) are directly unit-testable.
  //
  // More specific concepts are checked before the essay check, not after: unlike content.js (where
  // isEssayQuestionLabel only ever runs against empty text/textarea fields, and work-auth/sponsorship
  // questions are answered via a completely separate radio/select code path, so the two never
  // collide), this function classifies every field kind uniformly. Work-authorization/sponsorship/
  // previous-employment/referral-source questions are routinely phrased as literal questions ending
  // in "?", which the essay pattern's bare "\?" alternative would otherwise swallow first.
  //
  // action:"fixed" carries a literal `value` instead of a profileKey -- for concepts that have one
  // correct answer regardless of the user's saved profile (previous employment is always "No"; the
  // referral-source question is always "LinkedIn"), rather than something looked up per-user.
  function inferGenericFieldMapping(label) {
    if (isWorkAuthorizationQuestion(label)) {
      return { action: "map", profileKey: "workAuthorized" };
    }

    if (isVisaSponsorshipQuestion(label)) {
      return { action: "map", profileKey: "requiresSponsorship" };
    }

    if (isPreviousEmploymentQuestion(label)) {
      return { action: "fixed", value: "No" };
    }

    if (isReferralSourceQuestion(label)) {
      return { action: "fixed", value: "LinkedIn" };
    }

    for (const rule of FIELD_CONCEPT_RULES) {
      if (rule.pattern.test(label)) {
        return { action: "map", profileKey: rule.profileKey };
      }
    }

    if (isEssayQuestionLabel(label)) {
      return { action: "essay" };
    }

    return null;
  }

  // "fullName" isn't a real stored profile field -- it's derived from firstName + lastName, since
  // the profile stores them separately but plenty of sites (especially e-signature sections) ask
  // for one combined name field.
  function resolveProfileValue(profile, profileKey) {
    if (profileKey === "fullName") {
      return `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
    }

    return profile[profileKey];
  }

  function buildOptionMatcher(wantedValue) {
    const normalized = String(wantedValue || "").trim().toLowerCase();

    if (normalized === "yes") {
      return GA.isYesAnswerText;
    }

    if (normalized === "no") {
      return GA.isNoAnswerText;
    }

    return (text) => {
      const lower = normalizeText(text || "").toLowerCase();
      return Boolean(lower) && (lower.includes(normalized) || normalized.includes(lower));
    };
  }

  // Verbs describing an operation (edit this entry, remove this file, add another link), not a
  // parallel CHOICE answering a question -- a card of these (e.g. a work-experience entry, a
  // resume/attachment row) can otherwise look identical to a genuine yes/no button group under a
  // bare "2+ short clickable elements" check.
  const NON_ANSWER_ACTION_LABEL_PATTERN =
    /\b(edit|change|modify|update|view|remove|delete|add|continue|submit|apply|cancel|close|back|next|download|print|export|attach|upload|share|preview|resume)\b/i;

  // A "Yes"/"No" (or EEO-option) question doesn't have a single element whose label carries the
  // whole question -- each option's own label is just "Yes"/"No"/an EEO value. Find the smallest
  // visible container whose text matches and that contains 2+ option controls.
  //
  // Not every site uses native <input type=radio"> for this -- plenty of React-based ATS UIs (this
  // gap is what caused an entire "Application Questions" section to be silently skipped on one real
  // Uber application) render a styled <button> pill group instead, with no underlying radio input at
  // all. Recognize both: prefer real radios where present (native semantics, most reliable), and
  // fall back to short-labeled buttons/role='radio' elements otherwise.
  function getOptionControls(container) {
    const radios = Array.from(container.querySelectorAll("input[type='radio']")).filter(
      (radio) => isElementVisible(radio) && !isActionDisabled(radio)
    );

    if (radios.length >= 2) {
      return radios;
    }

    const buttonCandidates = Array.from(container.querySelectorAll("button, [role='radio'], [role='button']"))
      .filter((element) => isElementVisible(element) && !isActionDisabled(element))
      // Dropdown/combobox trigger buttons (e.g. several "Diversity Information" custom-select
      // triggers sharing one wrapping section) aren't parallel yes/no-style options either -- each
      // one opens a DIFFERENT, separate field, not a shared answer set for one question. Checked via
      // closest(), not just the candidate's own attributes -- some custom-select widgets put
      // role="combobox"/aria-haspopup="listbox" on an outer wrapper and render the actual clickable,
      // label-bearing element as a plain <button> underneath it with neither attribute of its own, so
      // a self-only check let those slip through and get misread as parallel answer options.
      .filter((element) => !element.closest("[role='combobox'], [aria-haspopup='listbox']"));

    // If ANY candidate reads like an action verb, this container is very likely a toolbar on an
    // unrelated card, not a question -- reject the whole group rather than just dropping that one
    // button, since a genuine question would never mix "Yes"/"No" with "Edit"/"Remove".
    if (buttonCandidates.some((element) => NON_ANSWER_ACTION_LABEL_PATTERN.test(getActionLabel(element)))) {
      return [];
    }

    return buttonCandidates.filter((element) => getActionLabel(element).length > 0 && getActionLabel(element).length <= 40);
  }

  // A genuine single question's container is short with a small, bounded set of options. Without
  // this cap, an oversized wrapper (e.g. most of the page body) can spuriously satisfy "text matches
  // AND has 2+ option-like children" just because it contains a real question SOMEWHERE inside it,
  // alongside unrelated buttons elsewhere on the page -- this is exactly what caused a chunk of job
  // description text to get flagged as an "unanswered question" (repeatedly, once per matching rule)
  // on a real application.
  function isPlausibleQuestionContainer(element) {
    const text = element.innerText || "";
    const options = getOptionControls(element);
    return text.length > 0 && text.length <= 300 && options.length >= 2 && options.length <= 10;
  }

  // The smallest container that wraps a question's options (see findAllQuestionContainers) is often
  // ONLY the button/radio group itself -- the actual question sentence commonly lives in a sibling
  // element one level up (a <label>/<legend>/<p> next to, not inside, the button-group div), so
  // container.innerText alone is just "Yes No"/the option labels with the real question missing
  // entirely. This was silently breaking BOTH the flagged-question display (unreadable "Yes No --
  // unrecognized question" entries) AND classification itself (isWorkAuthorizationQuestion etc. had
  // nothing to match against, so genuinely answerable questions were flagged as unrecognized instead
  // of being filled). Climb from the container upward, one level at a time, looking for the nearest
  // ancestor that adds real text beyond the options themselves -- but stop as soon as an ancestor's
  // option count no longer matches the original container's (that means we've climbed out into a
  // wrapper spanning more than this one question, e.g. the whole "Application Questions" section).
  function getQuestionLabel(container, options) {
    const containerText = normalizeText(container.innerText || "");
    let node = container.parentElement;
    let depth = 0;

    while (node && depth < 4 && getOptionControls(node).length === options.length) {
      const ancestorText = normalizeText(node.innerText || "");
      const extra = normalizeText(ancestorText.replace(containerText, "")).trim();

      if (extra.length >= 4) {
        return normalizeText(`${extra} ${containerText}`).slice(0, 160);
      }

      node = node.parentElement;
      depth += 1;
    }

    return containerText.slice(0, 160);
  }

  // Finds every distinct question-like container on the page in one pass (snapshot.js calls this
  // once; loop.js then classifies each entry against the known concepts, rather than re-searching
  // the DOM separately per concept the way an earlier version of this file did).
  function findAllQuestionContainers() {
    const candidates = Array.from(document.querySelectorAll("fieldset, section, div, li"))
      .filter((element) => isElementVisible(element))
      .filter((element) => isPlausibleQuestionContainer(element));

    // Keep only the smallest (most specific) container per question -- drop any candidate that
    // contains another candidate, since that's just a wrapper around multiple separate questions
    // (e.g. the whole "Application Questions" section), not a single question itself.
    return candidates.filter((element) => !candidates.some((other) => other !== element && element.contains(other)));
  }

  Object.assign(GA, {
    inferGenericFieldMapping,
    resolveProfileValue,
    buildOptionMatcher,
    getOptionControls,
    getQuestionLabel,
    isPlausibleQuestionContainer,
    findAllQuestionContainers
  });
})();
