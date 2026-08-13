// Generic DOM/label helpers for the site-agnostic "Autofill this page" feature (see agent.js for the
// overview). Duplicated from content.js rather than imported/shared, since content.js is tuned hard
// for three specific sites and this is a separate, unproven flow -- see the plan doc for why. Keep
// them in sync by hand for now; revisit extracting a shared lib/domHelpers.js once both flows' needs
// are known to stay identical.
//
// No bundler in this project, so cross-file sharing between these files is a plain shared namespace
// object on `window` rather than ES module import/export -- each file reads what it needs off GA and
// writes its own exports back onto it. chrome.scripting.executeScript's `files` array injects these
// in order, so files later in that list can rely on earlier ones already being on GA.
(function () {
  const GA = (window.__careerPeelerGA = window.__careerPeelerGA || {});

  function normalizeText(text) {
    return String(text || "")
      .replace(/ /g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function isElementVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function isActionDisabled(element) {
    return element.disabled || element.getAttribute("aria-disabled") === "true" || element.getAttribute("disabled") !== null;
  }

  function getElementLabel(element) {
    const labels = [];

    if (element.labels?.length) {
      labels.push(...Array.from(element.labels).map((label) => label.innerText));
    }

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) {
      labels.push(ariaLabel);
    }

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const labelElement = document.getElementById(id);
        if (labelElement) {
          labels.push(labelElement.innerText);
        }
      }
    }

    const placeholder = element.getAttribute("placeholder");
    if (placeholder) {
      labels.push(placeholder);
    }

    const nearbyText = element.closest("label, fieldset, div, li, section")?.innerText;
    if (nearbyText) {
      labels.push(nearbyText.split("\n").slice(0, 3).join(" "));
    }

    return normalizeText(labels.find(Boolean) || element.name || element.id || "Unlabeled field");
  }

  function getActionLabel(element) {
    return normalizeText(element.innerText || element.value || element.getAttribute("aria-label") || "");
  }

  // A yes/no-style option button's own visible text ("Yes") is its label -- getElementLabel's
  // external "closest wrapping label/fieldset/div/li/section" lookup is meant for form fields whose
  // OWN element has no visible text, and a <button> commonly matches closest("...div...") on its
  // immediate parent, which for two sibling pill buttons (<div class="options"><button>Yes</button>
  // <button>No</button></div>) is the SAME shared div for both -- so both buttons looked identically
  // labeled "Yes No" and neither ever matched a yes/no answer. Native radio inputs still have no
  // visible text of their own, so keep using getElementLabel's external lookup for those.
  function getOptionLabel(option) {
    if (option instanceof HTMLInputElement) {
      return getElementLabel(option);
    }
    return getActionLabel(option) || getElementLabel(option);
  }

  function getFieldKind(element) {
    const tagName = element.tagName.toLowerCase();

    if (tagName === "select") {
      return "select";
    }

    if (tagName === "textarea") {
      return "textarea";
    }

    if (element.isContentEditable) {
      return "rich_text";
    }

    return element.getAttribute("type") || "text";
  }

  function isRequiredField(element, label) {
    const lower = label.toLowerCase();
    return element.required || element.getAttribute("aria-required") === "true" || /\brequired\b|\*/.test(lower);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isYesAnswerText(text) {
    const lower = normalizeText(text || "").toLowerCase();
    return /\byes\b/.test(lower) && !/\bno\b/.test(lower);
  }

  function isNoAnswerText(text) {
    const lower = normalizeText(text || "").toLowerCase();
    return /\bno\b/.test(lower) && !/\byes\b/.test(lower);
  }

  function isWorkAuthorizationQuestion(text) {
    const lower = normalizeText(text || "").toLowerCase();
    return (
      /\blegally authorized\b/.test(lower) ||
      /\bauthorized to work\b/.test(lower) ||
      /\bwork in the (?:us|u\.s\.|united states)\b/.test(lower)
    );
  }

  function isVisaSponsorshipQuestion(text) {
    const lower = normalizeText(text || "").toLowerCase();
    return (
      /\bvisa sponsorship\b/.test(lower) ||
      /\brequire sponsorship\b/.test(lower) ||
      /\bsponsorship for employment\b/.test(lower) ||
      /\bvisa transfer\b/.test(lower) ||
      /\bnow or in the future\b.*\b(?:sponsorship|visa)\b/.test(lower)
    );
  }

  function isAgeEligibilityQuestion(text) {
    const lower = normalizeText(text || "").toLowerCase();
    return /\b18\s+years\s+of\s+age\s+or\s+older\b/.test(lower) || /\bat least 18 years\b/.test(lower);
  }

  function isGenderQuestion(text) {
    return /\bgender\b/i.test(text || "");
  }

  function isRaceEthnicityQuestion(text) {
    return /\b(race|ethnicity)\b/i.test(text || "");
  }

  function isVeteranStatusQuestion(text) {
    return /\bveteran\b/i.test(text || "");
  }

  function isDisabilityStatusQuestion(text) {
    return /\bdisabilit(y|ies)\b/i.test(text || "");
  }

  // Built once at module load, like this file's other pattern constants (PERSONAL_INFO_FIELD_LABEL_
  // PATTERN etc. below) -- isPreviousEmploymentQuestion runs once per field AND once per question on
  // every autofill sweep, so these shouldn't be rebuilt from template strings on every call.
  const PRIOR_EMPLOYMENT_TERM = "(?:employ(?:ed|ment)?|work(?:ed)?)";
  const PRIOR_TERM = "(?:previously|previous|before|in the past|ever)";
  const PRIOR_THEN_EMPLOYMENT_PATTERN = new RegExp(`\\b${PRIOR_TERM}\\b.*\\b${PRIOR_EMPLOYMENT_TERM}\\b`);
  const EMPLOYMENT_THEN_PRIOR_PATTERN = new RegExp(`\\b${PRIOR_EMPLOYMENT_TERM}\\b.*\\b${PRIOR_TERM}\\b`);

  // Matches "Have you previously been employed by us?" / "worked for this company before?" / "Are
  // you a former employee?" style questions -- two independent signals (a past-employment term, AND
  // a self-reference to the hiring company) rather than one combined regex, so this doesn't fire on
  // e.g. "Please describe your work experience" (has the employment term, no company self-reference)
  // or "Do you currently work for another employer?" (has the company-adjacent phrasing but no
  // past-tense/prior signal).
  function isPreviousEmploymentQuestion(text) {
    const lower = normalizeText(text || "").toLowerCase();
    const mentionsPriorEmployment =
      PRIOR_THEN_EMPLOYMENT_PATTERN.test(lower) ||
      EMPLOYMENT_THEN_PRIOR_PATTERN.test(lower) ||
      /\bformer(?:ly)?\s+employ(?:ee|ed)\b/.test(lower);
    const referencesThisCompany = /\b(us|this company|our company|here)\b/.test(lower);
    return mentionsPriorEmployment && referencesThisCompany;
  }

  // Matches "How did/do you hear about us?" / "Where did you hear about this position?" / "Referral
  // source" style questions -- the Workday-style referral/source-of-hire field.
  function isReferralSourceQuestion(text) {
    const lower = normalizeText(text || "").toLowerCase();
    return (
      /\bhow (?:did|do) you (?:hear|find out|learn)\b.*\b(?:about|of)\b/.test(lower) ||
      /\bwhere did you (?:hear|find out|learn)\b.*\b(?:about|of)\b/.test(lower) ||
      /\breferral source\b/.test(lower) ||
      /\bhow were you referred\b/.test(lower)
    );
  }

  // Fields that must never be treated as an open-ended essay prompt, even if their label happens to
  // contain a "?" or an essay-like phrase.
  const PERSONAL_INFO_FIELD_LABEL_PATTERN =
    /\b(first name|last name|full name|legal name|preferred name|email|e-mail|phone|mobile|telephone|address|city|state|province|zip|postal code|country|linkedin|portfolio|website|personal site|github|referral|referred by|salary|compensation|expected pay|school|university|degree|major|gpa|current employer|current company|what company|currently work|where do you work|gender|race|ethnicity|veteran|disability)\b/i;

  const ESSAY_QUESTION_LABEL_PATTERN =
    /\?|\bwhy (?:do you want|are you interested|would you|this role|this company|this team)\b|\btell us about\b|\bdescribe a time\b|\bwhat interests you\b|\bwalk us through\b|\bwhat makes you\b/i;

  function isEssayQuestionLabel(label) {
    const text = normalizeText(label || "");
    return ESSAY_QUESTION_LABEL_PATTERN.test(text) && !PERSONAL_INFO_FIELD_LABEL_PATTERN.test(text);
  }

  function findOpenTextQuestionField() {
    const fields = Array.from(document.querySelectorAll("textarea, input[type='text']"))
      .filter((element) => isElementVisible(element))
      .filter((element) => !isActionDisabled(element))
      .filter((element) => !(element.value || "").trim());

    return fields.find((element) => isEssayQuestionLabel(getElementLabel(element))) || null;
  }

  Object.assign(GA, {
    normalizeText,
    isElementVisible,
    isActionDisabled,
    getElementLabel,
    getActionLabel,
    getOptionLabel,
    getFieldKind,
    isRequiredField,
    delay,
    isYesAnswerText,
    isNoAnswerText,
    isWorkAuthorizationQuestion,
    isVisaSponsorshipQuestion,
    isAgeEligibilityQuestion,
    isPreviousEmploymentQuestion,
    isReferralSourceQuestion,
    isGenderQuestion,
    isRaceEthnicityQuestion,
    isVeteranStatusQuestion,
    isDisabilityStatusQuestion,
    isEssayQuestionLabel,
    findOpenTextQuestionField
  });
})();
