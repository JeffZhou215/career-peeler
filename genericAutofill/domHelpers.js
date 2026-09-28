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

  // Re-checks the exact predicates snapshotPage() filtered on at discovery time, but right before
  // acting rather than only once, upfront. Pie re-resolves a fresh element handle (via its idx system)
  // immediately before every tool call, because its multi-turn LLM loop can leave a real gap between
  // observing an element and acting on it. Our sweep holds a direct reference from one upfront
  // snapshot instead -- cheaper, and fine for the common case -- but that means a mid-sweep re-render
  // (e.g. an earlier field's fill causing a framework to replace a later field's DOM node) can leave a
  // later loop iteration holding a stale reference with no warning: .value and dispatchEvent() both
  // silently "succeed" on a detached node, so without this check the field would be logged as filled
  // when nothing the user can see actually changed. This is the cheap equivalent of Pie's fresh-
  // resolution for our single-pass architecture: verify the already-held reference is still good,
  // rather than re-querying the whole page for it again.
  function isElementStillActionable(element) {
    return element.isConnected && isElementVisible(element) && !isActionDisabled(element);
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

    if (element.getAttribute?.("data-automation-id") === "multiSelectContainer") {
      const workdayFieldLabel = element.closest?.("[data-automation-id^='formField-']")?.querySelector?.("label");
      if (workdayFieldLabel?.innerText) {
        labels.push(workdayFieldLabel.innerText);
      }
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
    const lower = String(label || "").toLowerCase();
    return Boolean(element?.required) || element?.getAttribute?.("aria-required") === "true" || /\brequired\b|\*/.test(lower);
  }

  function isOptionalApplicationQuestionText(text) {
    return /\b(?:optional|voluntary)\b|\bnot\s+mandatory\b/i.test(String(text || ""));
  }

  function isOptionalApplicationQuestion(element, label) {
    if (isOptionalApplicationQuestionText(label)) {
      return true;
    }
    if (!/\b(?:gender|race|ethnicity|veteran|disabilit(?:y|ies))\b/i.test(String(label || ""))) {
      return false;
    }

    let node = element?.closest?.("[data-form-field-i18n-name], [data-form-field-id], .ud-formily-item, fieldset, [role='group']") || element;
    for (let depth = 0; node && depth < 5; depth += 1) {
      if (isOptionalApplicationQuestionText(normalizeText(node.innerText || ""))) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function isQuestionControlRequired(element, label) {
    const text = String(label || "");
    const hasExplicitMarker =
      /\*|\(\s*required\s*\)|\brequired\s*$|\bmandatory\s+for\s+applicants?\b|\(\s*mandatory\s*\)|\bmandatory\s*$/i.test(text);

    if (isOptionalApplicationQuestion(element, text)) {
      return false;
    }

    if (Boolean(element?.required) || element?.getAttribute?.("aria-required") === "true") {
      return true;
    }

    const container =
      element?.closest?.("[data-form-field-i18n-name], fieldset, [role='radiogroup'], [role='group']") || element;

    const hasRequiredDescendant = Boolean(
      container?.querySelector?.("input[required], select[required], textarea[required], [aria-required='true']")
    );

    return hasRequiredDescendant || hasExplicitMarker;
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
      /\beligible to work\b/.test(lower) ||
      /\b(?:right|permission)[\s\-‐‑‒–—]+to[\s\-‐‑‒–—]+work\b/.test(lower) ||
      /\bvalid work authori[sz]ation\b/.test(lower) ||
      /\bwork in the (?:us|u\.s\.|united states)\b/.test(lower)
    );
  }

  function isCategoricalWorkAuthorizationStatusQuestion(text) {
    const lower = normalizeText(text || "").toLowerCase();
    return /\bright[\s\-‐‑‒–—]+to[\s\-‐‑‒–—]+work\s+status\b/.test(lower);
  }

  function isVisaSponsorshipQuestion(text) {
    const lower = normalizeText(text || "").toLowerCase();
    return (
      /\bvisa sponsorship\b/.test(lower) ||
      /\brequire sponsorship\b/.test(lower) ||
      /\bsponsorship for employment\b/.test(lower) ||
      /\bvisa transfer\b/.test(lower) ||
      /\b(?:employment|work) visa\b/.test(lower) ||
      /\bimmigration (?:support|assistance)\b/.test(lower) ||
      /\b(?:require|need|seek)\b.{0,50}\b(?:sponsor(?:ship)?|work visa|immigration support)\b/.test(lower) ||
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

  function isCriminalHistoryQuestion(text) {
    const lower = normalizeText(text || "").toLowerCase();
    return (
      /\bcriminal (?:history|record)\b/.test(lower) ||
      /\bcriminal offen[cs]e\b/.test(lower) ||
      /\b(?:convicted|conviction|felony|misdemeanor)\b/.test(lower) ||
      /\b(?:ever|previously)\b.{0,50}\b(?:arrested|charged)\b/.test(lower) ||
      /\b(?:found|pleaded|pled) guilty\b/.test(lower)
    );
  }

  // Built once at module load, like this file's other pattern constants (PERSONAL_INFO_FIELD_LABEL_
  // PATTERN etc. below) -- isPreviousEmploymentQuestion runs once per field AND once per question on
  // every autofill sweep, so these shouldn't be rebuilt from template strings on every call.
  const PRIOR_EMPLOYMENT_TERM = "(?:employ(?:ed|ment)?|work(?:ed)?)";
  const PRIOR_TERM = "(?:previously|previous|before|in the past|ever)";
  const PRIOR_THEN_EMPLOYMENT_PATTERN = new RegExp(`\\b${PRIOR_TERM}\\b.*\\b${PRIOR_EMPLOYMENT_TERM}\\b`);
  const EMPLOYMENT_THEN_PRIOR_PATTERN = new RegExp(`\\b${PRIOR_EMPLOYMENT_TERM}\\b.*\\b${PRIOR_TERM}\\b`);

  // Matches both self-referential questions ("worked for us before?") and Workday's named-employer
  // form ("worked for Mastercard as an employee?"). The prior-employment signal is mandatory and
  // generic targets such as "another employer" / "any company" are excluded, so ordinary work-
  // history questions never enter the candidate-profile yes/no resolver.
  function isPreviousEmploymentQuestion(text) {
    const lower = normalizeText(text || "").toLowerCase();
    const mentionsPriorEmployment =
      PRIOR_THEN_EMPLOYMENT_PATTERN.test(lower) ||
      EMPLOYMENT_THEN_PRIOR_PATTERN.test(lower) ||
      /\bformer(?:ly)?\s+employ(?:ee|ed)\b/.test(lower);
    const referencesThisCompany = /\b(us|this company|our company|this employer|our employer|here)\b/.test(lower);
    const referencesNamedEmployer = /\b(?:employed by|worked for|employee of)\s+(?!(?:us|this|our|another|any|a|an|the|your|company|employer|organization)\b)[a-z0-9][a-z0-9&.'/-]*(?:\s+[a-z0-9][a-z0-9&.'/-]*){0,7}(?=\s+(?:as\b|or provided services\b|in any capacity\b)|\s*[?.!,]|$)/.test(lower);
    return mentionsPriorEmployment && (referencesThisCompany || referencesNamedEmployer);
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
    isElementStillActionable,
    getElementLabel,
    getActionLabel,
    getOptionLabel,
    getFieldKind,
    isRequiredField,
    isOptionalApplicationQuestionText,
    isOptionalApplicationQuestion,
    isQuestionControlRequired,
    delay,
    isYesAnswerText,
    isNoAnswerText,
    isWorkAuthorizationQuestion,
    isCategoricalWorkAuthorizationStatusQuestion,
    isVisaSponsorshipQuestion,
    isAgeEligibilityQuestion,
    isPreviousEmploymentQuestion,
    isReferralSourceQuestion,
    isGenderQuestion,
    isRaceEthnicityQuestion,
    isVeteranStatusQuestion,
    isDisabilityStatusQuestion,
    isCriminalHistoryQuestion,
    isEssayQuestionLabel,
    findOpenTextQuestionField
  });
})();
