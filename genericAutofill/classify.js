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
    isCategoricalWorkAuthorizationStatusQuestion,
    isVisaSponsorshipQuestion,
    isCriminalHistoryQuestion,
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
    // Checked before addressLine1 on purpose: "address line" alone matches BOTH "Address Line 1" and
    // "Address Line 2", so without this narrower rule running first, Line 2 was classified as Line 1
    // too and silently filled with the same street address. Apartment/suite/unit fields commonly
    // don't say "address" at all ("Apt/Suite"), so those are matched standalone here too.
    {
      profileKey: "addressLine2",
      pattern: /\b(address line\s*2|apartment|apt\.?|suite|ste\.?|unit)\b/i
    },
    { profileKey: "addressLine1", pattern: /\b(street address|address line\s*1|mailing address|address)\b/i },
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

  function isWorkdayHostname(hostname) {
    const normalized = String(hostname || "").trim().toLowerCase();
    return ["myworkdayjobs.com", "myworkdaysite.com"].some(
      (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`)
    );
  }

  function isPhoneExtensionField(label) {
    return /\b(?:phone|telephone|mobile)\s+(?:number\s+)?extension\b|\bextension\s+(?:for\s+)?(?:phone|telephone|mobile)\b/i.test(
      String(label || "")
    );
  }

  function isPhoneCountryCodeField(label) {
    const text = String(label || "");
    return (
      /\b(?:phone|telephone|mobile)\b.{0,30}\bcountry\s+code\b/i.test(text) ||
      /\bcountry\s+code\b.{0,30}\b(?:phone|telephone|mobile)\b/i.test(text) ||
      /\bcountry\s+(?:phone|telephone|mobile)\s+code\b/i.test(text)
    );
  }

  function isPhoneDeviceTypeField(label) {
    return /\b(?:phone|telephone|mobile)\s+(?:device\s+)?type\b/i.test(String(label || ""));
  }

  function isWorkdayDropdownStatusLabel(label) {
    return /^(?:\d+\s+)?items?\s+selected[.:]?$/i.test(normalizeText(label || ""));
  }

  function getWorkdayProgressActionKind(label) {
    const normalized = normalizeText(label || "").toLowerCase();
    if (["submit", "submit application"].includes(normalized)) {
      return "submit";
    }
    if (
      [
        "continue",
        "next",
        "save and continue",
        "apply",
        "apply now",
        "apply for this job",
        "start application",
        "begin application"
      ].includes(normalized)
    ) {
      return "continue";
    }
    return null;
  }

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
  // action:"fixed" carries a literal `value` instead of a profileKey. Previous-employer questions
  // deliberately use action:"candidate_employment" instead: their truthful Yes/No answer must be
  // resolved from candidateProfile.experience, never from a global fixed policy.
  function inferGenericFieldMapping(label, context = {}) {
    const isWorkday = isWorkdayHostname(context.hostname);

    if (isWorkday && isPhoneDeviceTypeField(label)) {
      return { action: "fixed", value: "Mobile" };
    }

    if (isWorkday && isPhoneCountryCodeField(label)) {
      return { action: "fixed", value: "United States of America (+1)" };
    }

    if (isCategoricalWorkAuthorizationStatusQuestion(label)) {
      return /\bsingapore\b/i.test(label) ? { action: "fixed", value: "Foreigner" } : null;
    }

    if (isWorkAuthorizationQuestion(label)) {
      return { action: "fixed", value: "Yes" };
    }

    if (isVisaSponsorshipQuestion(label)) {
      return { action: "fixed", value: "Yes" };
    }

    if (isCriminalHistoryQuestion(label)) {
      return { action: "fixed", value: "No" };
    }

    if (isPreviousEmploymentQuestion(label)) {
      return { action: "candidate_employment" };
    }

    if (isReferralSourceQuestion(label)) {
      return { action: "fixed", value: "Other" };
    }

    if (isWorkday && /\bcountry\b/i.test(label)) {
      return { action: "fixed", value: "United States of America" };
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
  // Only fields that map cleanly 1:1 onto a candidateProfile.basicInfo field without any guessed
  // parsing -- firstName/lastName are deliberately excluded even though basicInfo has fullName, since
  // splitting a full name string into first/last is itself a guess (compound names, multiple middle
  // names) this codebase's "never guess" philosophy argues against. addressLine1/2 and
  // addressPostalCode have no candidateProfile equivalent at all (resumes rarely include a street
  // address), so they're correctly absent here too, not an oversight.
  const CANDIDATE_PROFILE_FALLBACK_FIELDS = {
    email: "email",
    phone: "phone",
    linkedinUrl: "linkedinUrl",
    githubUrl: "githubUrl",
    portfolioUrl: "portfolioUrl",
    addressCity: "city",
    addressState: "state",
    addressCountry: "country"
  };

  // An explicitly-filled flat autofill-profile field (typed by hand in the side panel) always wins
  // when non-empty -- candidateProfile (extracted from a resume, see lib/core.js's
  // extractCandidateProfileFromResume) is only ever a fallback for a field the user left blank, never
  // a silent override of something they deliberately entered themselves.
  function resolveProfileValue(profile, profileKey) {
    const policyValues = {
      workAuthorized: "Yes",
      requiresSponsorship: "Yes"
    };

    if (policyValues[profileKey]) {
      return policyValues[profileKey];
    }

    if (profileKey === "fullName") {
      const flatFullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
      return flatFullName || profile.candidateProfile?.basicInfo?.fullName || "";
    }

    const direct = profile[profileKey];
    if (direct) {
      return direct;
    }

    const candidateProfileField = CANDIDATE_PROFILE_FALLBACK_FIELDS[profileKey];
    if (candidateProfileField) {
      return profile.candidateProfile?.basicInfo?.[candidateProfileField] || direct;
    }

    return direct;
  }

  function buildOptionMatcher(wantedValue) {
    const normalized = String(wantedValue || "").trim().toLowerCase();
    const normalizedCanonical = normalized.replace(/[_-]+/g, " ");

    if (normalized === "yes") {
      return GA.isYesAnswerText;
    }

    if (normalized === "no") {
      return GA.isNoAnswerText;
    }

    // Referral prompts can contain nested categories such as "Other Job Board". When policy asks
    // for the top-level Other choice, require that exact offered label so the action layer never
    // enters another hierarchy by substring accident.
    if (normalized === "other") {
      return (text) => normalizeText(text || "").toLowerCase() === "other";
    }

    if (/\bunited states of america\b/.test(normalized) && /\+?1\b/.test(normalized)) {
      return (text) => {
        const candidate = normalizeText(text || "").toLowerCase();
        return (
          !/\bminor outlying islands\b/.test(candidate) &&
          /\bunited states(?: of america)?\b/.test(candidate) &&
          /(?:\+1\b|\b1\b)/.test(candidate)
        );
      };
    }

    if (normalized === "prefer_not_to_disclose") {
      return (text) => /\b(?:decline|prefer not|do not wish|don't wish|do not want|don't want|not disclose)\b/i.test(
        normalizeText(text)
      );
    }

    const canonicalMatchers = {
      male: (text) => /\b(?:male|man)\b/i.test(text) && !/\b(?:female|woman)\b/i.test(text),
      female: (text) => /\b(?:female|woman)\b/i.test(text),
      "non binary": (text) => /\b(?:non[\s-]?binary|genderqueer|gender nonconforming)\b/i.test(text),
      asian: (text) => /\basian\b/i.test(text),
      white: (text) => /\bwhite\b/i.test(text),
      "black or african american": (text) => /\bblack\b|\bafrican american\b/i.test(text),
      "hispanic or latino": (text) => /\bhispanic\b|\blatino\b|\blatina\b|\blatinx\b/i.test(text),
      "native american or alaska native": (text) => /\bnative american\b|\balaska native\b|\bamerican indian\b/i.test(text),
      "native hawaiian or pacific islander": (text) => /\bnative hawaiian\b|\bpacific islander\b/i.test(text),
      "middle eastern or north african": (text) => /\bmiddle eastern\b|\bnorth african\b/i.test(text),
      "two or more races": (text) => /\btwo or more races\b|\bmore than one race\b|\bmultiracial\b/i.test(text),
      "not protected veteran": (text) =>
        /^no\.?$/i.test(text.trim()) || /\bnot (?:a )?(?:protected )?veteran\b|\bnon[\s-]?veteran\b|\bnot a veteran\b/i.test(text),
      "protected veteran": (text) =>
        /^yes\.?$/i.test(text.trim()) ||
        (!/\bnot\b/i.test(text) && (/\bprotected veteran\b/i.test(text) || /\bone or more classifications\b/i.test(text))),
      "no current or past": (text) =>
        /^no\.?$/i.test(text.trim()) ||
        /\bno\b.*\bdisabil|\bdo not have\b.*\bdisabil|\bnot disabled\b|\bnever had\b.*\bdisabil/i.test(text),
      "yes current or past": (text) =>
        /^yes\.?$/i.test(text.trim()) || /\byes\b.*\bdisabil|\bhave (?:a )?disabil|\bhad (?:a )?disabil/i.test(text)
    };
    if (canonicalMatchers[normalizedCanonical]) {
      return (text) => {
        const candidate = normalizeText(text || "");
        return !/\b(?:decline|prefer not|do not wish|don't wish|do not want|don't want|not disclose)\b/i.test(candidate) &&
          canonicalMatchers[normalizedCanonical](candidate);
      };
    }

    if (/\bnot (?:a )?(?:protected )?veteran\b/i.test(normalized)) {
      return (text) => /\bnot (?:a )?(?:protected )?veteran\b/i.test(normalizeText(text)) && !/\bdecline|prefer not\b/i.test(text);
    }

    if (/\bdo not have a disability\b|\bno\b.*\bdisabil/i.test(normalized)) {
      return (text) =>
        /\bno\b.*\bdisabil|\bdo not have a disability\b|\bnot disabled\b/i.test(normalizeText(text)) &&
        !/\bdecline|prefer not\b/i.test(text);
    }

    return (text) => {
      const lower = normalizeText(text || "").toLowerCase();
      return Boolean(lower) && (lower.includes(normalized) || normalized.includes(lower));
    };
  }

  // Workday tenants organize referral sources differently. Once the action layer has exposed a set
  // of choices from the current level, prefer literal LinkedIn when present; otherwise use the
  // shortest offered answer containing LinkedIn so selection stays deterministic.
  function choosePreferredLinkedInSourceLabel(optionLabels) {
    const candidates = Array.from(new Set(
      (Array.isArray(optionLabels) ? optionLabels : [])
        .map((label) => normalizeText(label || ""))
        .filter((label) => label.toLowerCase().includes("linkedin"))
    ));

    candidates.sort((left, right) => {
      const leftExact = left.toLowerCase() === "linkedin" ? 0 : 1;
      const rightExact = right.toLowerCase() === "linkedin" ? 0 : 1;
      return leftExact - rightExact || left.length - right.length || left.localeCompare(right);
    });

    return candidates[0] || "";
  }

  function choosePreferredWorkdaySourceLabel(optionLabels) {
    const candidates = Array.from(new Set(
      (Array.isArray(optionLabels) ? optionLabels : [])
        .map((label) => normalizeText(label || ""))
        .filter(Boolean)
    ));
    const exactOther = candidates.find((label) => label.toLowerCase() === "other");
    return exactOther || choosePreferredLinkedInSourceLabel(candidates);
  }

  function choosePreferredWorkdaySourceParentLabel(optionLabels) {
    const candidates = Array.from(new Set(
      (Array.isArray(optionLabels) ? optionLabels : [])
        .map((label) => normalizeText(label || ""))
        .filter(Boolean)
    ));
    const parentPatterns = [
      /^external career site sources?$/i,
      /^job boards?$/i,
      /\bexternal\b.*\bcareer\b.*\bsite\b/i,
      /\bjob\b.*\bboard\b/i
    ];

    for (const pattern of parentPatterns) {
      const matches = candidates
        .filter((label) => pattern.test(label))
        .sort((left, right) => left.length - right.length || left.localeCompare(right));
      if (matches.length > 0) {
        return matches[0];
      }
    }

    return "";
  }

  function isSensitiveProfileKey(profileKey) {
    return ["eeoGender", "eeoRaceEthnicity", "eeoVeteranStatus", "eeoDisabilityStatus"].includes(profileKey);
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
    const radios = Array.from(container.querySelectorAll("input[type='radio'], input[type='checkbox'], [role='checkbox']")).filter(
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
    return text.length > 0 && text.length <= 500 && options.length >= 2 && options.length <= 12;
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
    isWorkdayHostname,
    isPhoneExtensionField,
    isPhoneCountryCodeField,
    isPhoneDeviceTypeField,
    isWorkdayDropdownStatusLabel,
    getWorkdayProgressActionKind,
    inferGenericFieldMapping,
    resolveProfileValue,
    buildOptionMatcher,
    choosePreferredLinkedInSourceLabel,
    choosePreferredWorkdaySourceLabel,
    choosePreferredWorkdaySourceParentLabel,
    isSensitiveProfileKey,
    getOptionControls,
    getQuestionLabel,
    isPlausibleQuestionContainer,
    findAllQuestionContainers
  });
})();
