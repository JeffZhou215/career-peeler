// DOM-mutating actions -- filling fields, clicking options, finding the resume/submit controls. See
// domHelpers.js for the shared-namespace pattern this file follows.
(function () {
  const GA = window.__careerPeelerGA;
  const { normalizeText, isElementVisible, isActionDisabled, getElementLabel, getActionLabel, getOptionLabel, delay, buildOptionMatcher } = GA;

  // A plain `element.value = x` goes through whatever setter is CURRENTLY installed on the element --
  // and React wraps every controlled input's setter with its own value tracker so it can tell a real
  // change apart from a no-op. Setting through that wrapped setter updates the tracker's own "last
  // value" right along with the DOM, so when the `input` event fires afterward, React's tracker sees
  // no change since ITS OWN last-known value and never updates the page's actual state -- the DOM
  // shows the new value for now, but the site's own React state still thinks the field is empty. The
  // next time ANYTHING on the page re-renders (a sibling field's dependent-field logic, a debounced
  // validation pass, navigating a wizard step), React repaints the input from that stale state and the
  // value silently reverts -- this is the mechanism behind "a field I filled earlier went blank
  // again." Calling the ORIGINAL prototype setter (captured once, before React or anything else could
  // have wrapped the instance's own property) bypasses the wrapped instance setter entirely, so
  // React's tracker still sees its old value and correctly detects + commits the change once the
  // input event fires. Falls back to a plain assignment when no such prototype setter exists (e.g. an
  // unusual custom element) -- strictly an upgrade over the old behavior, never a regression.
  function setNativeElementValue(element, value) {
    const prototype =
      element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
    const nativeSetter = prototype && Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      element.value = value;
    }
  }

  // A bare `new Event("input")` carries none of the information a REAL typed character produces --
  // no `inputType`, no `data`. Ported from Pie's act-core.ts `type` op (the one difference from what
  // this function used to do): a genuine `InputEvent("input", {inputType:"insertText", data:value})`
  // is what browsers themselves dispatch for a real text insertion, and form libraries that key their
  // own state off `event.data`/`event.inputType` (rather than just re-reading `element.value`) don't
  // recognize a plain Event as one at all -- the write can appear to succeed (the DOM shows the value)
  // while the framework's own model of the field never registers a change, and a later unrelated
  // re-render repaints the input from that untouched state. This is why the previous version of this
  // function (native setter + bare Event) fixed some sites but not Microsoft Careers specifically.
  function fillTextField(element, value) {
    element.focus();
    setNativeElementValue(element, value);
    element.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: value, bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Used by loop.js's end-of-sweep verification pass to confirm a field's live DOM value still
  // matches what was filled earlier in the same run -- a cheap, synchronous re-check, not a repeat of
  // the whole fill.
  function hasExpectedFieldValue(element, expectedValue) {
    return (element.value || "") === expectedValue;
  }

  // Wraps this element's OWN `value` property with a logging getter/setter that records every write
  // (value + timestamp) to the console, then delegates to the real native setter -- lets you see
  // exactly what wrote what, and in what order, when a field's value reverts after fillTextField
  // already reported it as present. Attached only while loop.js is actively retrying a field that
  // failed its immediate check, never on every field, so an ordinary sweep pays nothing for it.
  // Instance-level (Object.defineProperty on the element itself, not its prototype), so it never
  // affects any other element on the page. Returns a function that removes the override, restoring the
  // prototype's own setter -- always call it once done tracing, whether the retry succeeded or not.
  // Never logs the raw value for a password-kind field, matching loop.js's describeEnteredValue guard.
  function traceElementWrites(element, label, kind) {
    const prototype = element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "value");

    if (!descriptor?.get || !descriptor?.set) {
      return () => {};
    }

    Object.defineProperty(element, "value", {
      configurable: true,
      get() {
        return descriptor.get.call(element);
      },
      set(nextValue) {
        console.log(`[Career Peeler] write to "${label}":`, {
          value: kind === "password" ? "(redacted)" : nextValue,
          at: new Date().toISOString()
        });
        descriptor.set.call(element, nextValue);
      }
    });

    return () => {
      delete element.value;
    };
  }

  // Fallback for a field that rejects fillTextField's programmatic write entirely (see loop.js's
  // "rejected-on-write" diagnostic) -- some frameworks only accept a value change traceable to a
  // genuine, OS-trusted keyboard event, which no DOM-dispatched synthetic event can produce no matter
  // how it's constructed. chrome.debugger's CDP Input.insertText is the one mechanism available to an
  // extension that DOES produce isTrusted input, but the API itself is only callable from the
  // background service worker, not from this content-script context -- so this only does the part
  // that DOES belong here (focus + select the target, exactly what a real user does before typing
  // over existing content) and hands the actual typing to background.js over a message.
  async function typeViaKeyboardFallback(element, value) {
    element.focus();
    element.select();

    const response = await chrome.runtime
      .sendMessage({ type: "APPLE_CAREERS_TYPE_VIA_DEBUGGER", text: value })
      .catch((error) => ({ ok: false, error: error?.message }));

    if (!response?.ok) {
      return { ok: false, error: response?.error || "Keyboard-input fallback failed." };
    }

    // Input.insertText already produces the isTrusted input event the site needs -- this dispatches
    // `change` too (real typing wouldn't fire it until blur) so anything downstream that specifically
    // waits for `change` (this codebase's own isFieldNowInvalid included) still sees it, same as
    // fillTextField already does for the normal path.
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
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

    // Same React-value-tracker reasoning as fillTextField's setNativeElementValue -- a native <select>
    // is just as susceptible to a controlled-component re-render reverting a plain `.value =`
    // assignment as a text input is.
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement?.prototype || {}, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(selectElement, match.value);
    } else {
      selectElement.value = match.value;
    }

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
    hasExpectedFieldValue,
    traceElementWrites,
    typeViaKeyboardFallback,
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
