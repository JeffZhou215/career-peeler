// DOM-mutating actions -- filling fields, clicking options, finding the resume/submit controls. See
// domHelpers.js for the shared-namespace pattern this file follows.
(function () {
  const GA = window.__careerPeelerGA;
  const { normalizeText, isElementVisible, isActionDisabled, getElementLabel, getActionLabel, getOptionLabel, delay, buildOptionMatcher } = GA;

  function fillTextField(element, value) {
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Checks the field's OWN validation state after a fill, rather than assuming a value was accepted
  // just because it was set -- catches both native HTML constraints (maxlength, type=email/url
  // pattern mismatch) and site-driven validation (React forms setting aria-invalid after a brief
  // re-render), which is exactly how the "Full Name" bug above manifested: a 240+ character LLM
  // answer landed in a field with a 240-char maxlength and was flagged invalid by the site itself,
  // but nothing here was checking for that, so it was reported as a confident, successful fill.
  async function isFieldNowInvalid(element) {
    await delay(150);

    if (element.maxLength >= 0 && (element.value || "").length > element.maxLength) {
      return true;
    }

    if (typeof element.checkValidity === "function" && !element.checkValidity()) {
      return true;
    }

    return element.getAttribute("aria-invalid") === "true";
  }

  function selectMatchingOption(selectElement, wantedValue) {
    const matcher = buildOptionMatcher(wantedValue);
    const options = Array.from(selectElement.options || []);
    const match = options.find((option) => matcher(option.textContent || option.value || ""));

    if (!match) {
      return false;
    }

    selectElement.value = match.value;
    selectElement.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // A bare .click() only dispatches a "click" event -- custom-styled toggle buttons built on
  // pointer/mouse handlers (rather than a native <button>'s click semantics) can silently no-op it.
  // Simulate the fuller real-interaction sequence a genuine click produces.
  function simulateRealClick(element) {
    const rect = element.getBoundingClientRect();
    const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };

    if (typeof PointerEvent === "function") {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, ...point }));
    }
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, ...point }));
    if (typeof PointerEvent === "function") {
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, ...point }));
    }
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, ...point }));
    element.click();
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Verify the click actually registered rather than assuming success -- this is exactly what caught
  // (or rather, didn't catch until a live test surfaced it) two "answered" questions on a real
  // application that were still showing a "this info is required" validation error afterward. Checks
  // common selected-state signals; if none of them apply to this site's specific markup, the caller
  // treats the result as unconfirmed rather than a false "success."
  async function isOptionConfirmedSelected(option) {
    const isSelected = () =>
      option.getAttribute("aria-checked") === "true" ||
      option.getAttribute("aria-pressed") === "true" ||
      option.getAttribute("aria-selected") === "true" ||
      (option instanceof HTMLInputElement && option.checked) ||
      /\b(selected|active|is-selected|is-active|checked)\b/i.test(option.className || "");

    if (isSelected()) {
      return true;
    }

    await delay(150);
    return isSelected();
  }

  // Returns the clicked option element on a text match, or null if nothing matched -- the caller
  // still needs to verify the click actually took effect via isOptionConfirmedSelected().
  function clickOptionMatchingText(options, matcher) {
    for (const option of options) {
      if (matcher(getOptionLabel(option))) {
        simulateRealClick(option);
        return option;
      }
    }
    return null;
  }

  // Simplified adaptation of Pie's wait-for-settle.ts -- just the MutationObserver+polling portion,
  // not the chrome.webNavigation half (a content script can't listen for webNavigation events without
  // relaying through the background script, and DOM mutation alone is enough to tell "the click
  // visibly did something" from "nothing changed"). Resolves once the page goes `quietMs` without a
  // mutation, or after `maxMs` regardless, matching Pie's real defaults (500/3000/100ms) and its
  // `sinceLastActivity >= quietMs || elapsed >= maxMs` exit condition. Deliberately NOT used for the
  // narrow per-field checks above (isFieldNowInvalid/isOptionConfirmedSelected keep their fixed 150ms
  // delay) -- a page-wide "nothing is mutating anywhere" signal is too slow/imprecise for a single
  // element, since unrelated page activity (ads, chat widgets, polling indicators) can keep the whole
  // page from ever going fully quiet within maxMs.
  function waitForSettle({ quietMs = 500, maxMs = 3000, pollMs = 100 } = {}) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let lastMutationAt = startedAt;
      let mutated = false;

      const observer = new MutationObserver(() => {
        mutated = true;
        lastMutationAt = Date.now();
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const timer = setInterval(() => {
        const now = Date.now();
        const sinceLastMutation = now - lastMutationAt;
        const elapsed = now - startedAt;

        if (sinceLastMutation >= quietMs || elapsed >= maxMs) {
          clearInterval(timer);
          observer.disconnect();
          resolve({ mutated, elapsedMs: elapsed });
        }
      }, pollMs);
    });
  }

  // Custom dropdown widgets (role=combobox/listbox) don't expose their option list until opened --
  // unlike a native <select>'s .options, or a button/radio-group's already-rendered children, there's
  // nothing to read at snapshot time. Deliberately kept separate from a general "autofill any custom
  // dropdown" primitive -- loop.js only calls this for the one narrow, high-confidence referral-source
  // case, not for arbitrary dropdowns; see snapshot.js's comment on why guessing at an unconfirmed
  // widget's open/select interaction is risky in general.
  function getVisibleRoleOptionElements() {
    return Array.from(document.querySelectorAll("[role='option']")).filter(
      (element) => isElementVisible(element) && !isActionDisabled(element)
    );
  }

  // Opens a custom dropdown and clicks whichever revealed option's text matches `matcher`, reusing
  // the same click-then-verify pattern as clickOptionMatchingText/isOptionConfirmedSelected above.
  // Diffs the visible [role=option] set before/after the open-click so options that were already in
  // the DOM (just hidden, rather than rendered fresh on open) still get picked up even when nothing
  // NEW appears after clicking -- falls back to "every currently visible option" in that case.
  async function openDropdownAndSelectOption(dropdownElement, matcher) {
    const optionsBeforeOpen = new Set(getVisibleRoleOptionElements());
    simulateRealClick(dropdownElement);
    await waitForSettle();

    const optionsAfterOpen = getVisibleRoleOptionElements();
    const revealedOptions = optionsAfterOpen.filter((option) => !optionsBeforeOpen.has(option));
    const candidateOptions = revealedOptions.length > 0 ? revealedOptions : optionsAfterOpen;

    const clickedOption = clickOptionMatchingText(candidateOptions, matcher);
    const confirmed = clickedOption && (await isOptionConfirmedSelected(clickedOption));

    return { clickedOption, confirmed };
  }

  // Deliberately does NOT filter by isElementVisible -- custom-styled upload widgets (Workday's
  // "Drop file here or Select file" zone included) near-universally hide the native
  // <input type=file> itself (opacity:0, zero size, or display:none) while a styled dropzone/button
  // displays the actual UI on top of it. Setting .files via the DataTransfer trick (see loop.js)
  // works regardless of the input's visibility, so requiring it here only rejected the real target.
  function findResumeFileInput() {
    const fileInputs = Array.from(document.querySelectorAll("input[type='file']")).filter(
      (element) => !isActionDisabled(element)
    );

    if (fileInputs.length === 0) {
      return null;
    }

    const labeled = fileInputs.find((element) => /\b(resume|cv|curriculum vitae)\b/i.test(getElementLabel(element)));
    return labeled || (fileInputs.length === 1 ? fileInputs[0] : null);
  }

  // A loose substring match risks clicking the wrong button on a site Career Peeler has never seen
  // before (e.g. "Submit for referral" or "Submit another response") -- tighter than content.js's
  // known-site button matching on purpose, since there's no per-site tuning to fall back on here.
  // Shared by findGenericSubmitButton() (clicked after the form is filled, to actually submit) and
  // the entry-button check in loop.js (clicked on a job page that has no form yet, to get into the
  // application) -- same matching logic, same one-and-only-one-candidate safety rule.
  const SUBMIT_LABEL_ALLOWLIST = new Set([
    "submit",
    "submit application",
    "send application",
    "apply",
    "apply now",
    "apply for this job",
    "apply for this position",
    "apply to this job",
    "start application",
    "begin application"
  ]);

  function findGenericSubmitButton() {
    const candidates = Array.from(document.querySelectorAll("a, button[type='submit'], input[type='submit'], button, [role='button']"))
      .filter((element) => isElementVisible(element))
      .filter((element) => !isActionDisabled(element))
      .filter((element) => SUBMIT_LABEL_ALLOWLIST.has(normalizeText(getActionLabel(element)).toLowerCase()));

    return candidates.length === 1 ? candidates[0] : null;
  }

  Object.assign(GA, {
    fillTextField,
    isFieldNowInvalid,
    selectMatchingOption,
    simulateRealClick,
    isOptionConfirmedSelected,
    clickOptionMatchingText,
    openDropdownAndSelectOption,
    waitForSettle,
    findResumeFileInput,
    findGenericSubmitButton
  });
})();
