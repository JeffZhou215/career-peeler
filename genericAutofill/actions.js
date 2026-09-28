// DOM-mutating actions -- filling fields, clicking options, finding the resume/submit controls. See
// domHelpers.js for the shared-namespace pattern this file follows.
(function () {
  const GA = window.__careerPeelerGA;
  const {
    normalizeText,
    isElementVisible,
    isActionDisabled,
    getElementLabel,
    getActionLabel,
    getOptionLabel,
    delay,
    buildOptionMatcher,
    choosePreferredWorkdaySourceLabel,
    choosePreferredWorkdaySourceParentLabel,
    isWorkdayHostname,
    getWorkdayProgressActionKind
  } = GA;

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
    const text = String(value ?? "");
    element.focus();
    setNativeElementValue(element, text);
    element.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  // Used by loop.js's end-of-sweep verification pass to confirm a field's live DOM value still
  // matches what was filled earlier in the same run -- a cheap, synchronous re-check, not a repeat of
  // the whole fill.
  function hasExpectedFieldValue(element, expectedValue) {
    if (element.tagName?.toLowerCase() === "select") {
      const expectedValues = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
      const selectedOptions = Array.from(element.selectedOptions || []);
      return expectedValues.length > 0 && expectedValues.every((value) =>
        selectedOptions.some((selected) => buildOptionMatcher(value)(`${selected.textContent || ""} ${selected.value || ""}`))
      );
    }
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

  // Builds the same observable value progression as replacing the field and then typing its final
  // character. Workday's controlled FormKit fields can display a one-shot DOM assignment while their
  // internal answer remains empty; the user-visible symptom is that deleting and re-adding one
  // character makes the error disappear. Clearing, inserting the prefix, and finally inserting the
  // last character gives React/FormKit distinct input transitions to consume without pretending a
  // full-string assignment was one typed character.
  function buildFrameworkTextCommitStages(value) {
    const text = String(value ?? "");
    if (!text) {
      return [{ value: "", inputType: "deleteContentBackward", data: null }];
    }

    const prefix = text.slice(0, -1);
    return [
      { value: "", inputType: "deleteContentBackward", data: null },
      ...(prefix ? [{ value: prefix, inputType: "insertText", data: prefix }] : []),
      { value: text, inputType: "insertText", data: text.slice(-1) }
    ];
  }

  const MAIN_WORLD_TEXT_REQUEST_CHANNEL = "career-peeler-main-world-text-request-v3";
  const MAIN_WORLD_TEXT_RESPONSE_CHANNEL = "career-peeler-main-world-text-response-v3";
  const MAIN_WORLD_CLICK_REQUEST_CHANNEL = "career-peeler-main-world-click-request-v3";
  const MAIN_WORLD_CLICK_RESPONSE_CHANNEL = "career-peeler-main-world-click-response-v3";
  const MAIN_WORLD_TARGET_ATTRIBUTE = "data-career-peeler-main-world-target";
  let mainWorldRequestSequence = 0;

  // The background runtime installs mainWorldBridge.js before this isolated-world pipeline. A short-
  // lived DOM marker identifies only the already-resolved target; page and isolated JavaScript worlds
  // cannot call each other's functions directly. Discovery, matching, and verification stay here.
  function requestMainWorldAction(element, requestChannel, responseChannel, payload, unavailableMessage) {
    if (!element?.isConnected || typeof window.addEventListener !== "function" || typeof window.postMessage !== "function") {
      return Promise.resolve({ ok: false, error: unavailableMessage });
    }

    const requestId = `career-peeler-${Date.now()}-${++mainWorldRequestSequence}`;
    const targetId = requestId;
    element.setAttribute(MAIN_WORLD_TARGET_ATTRIBUTE, targetId);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onMessage);
        if (element.getAttribute(MAIN_WORLD_TARGET_ATTRIBUTE) === targetId) {
          element.removeAttribute(MAIN_WORLD_TARGET_ATTRIBUTE);
        }
        clearTimeout(timeoutId);
        resolve(result);
      };
      const onMessage = (event) => {
        const response = event.data;
        if (
          event.source === window &&
          response?.channel === responseChannel &&
          response.requestId === requestId
        ) {
          finish({ ok: Boolean(response.ok), error: response.error || "" });
        }
      };
      const timeoutId = setTimeout(
        () => finish({ ok: false, error: "The page-context action bridge did not respond." }),
        750
      );

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          ...payload,
          channel: requestChannel,
          requestId,
          targetId
        },
        "*"
      );
    });
  }

  function commitTextFieldInMainWorld(element, value) {
    return requestMainWorldAction(
      element,
      MAIN_WORLD_TEXT_REQUEST_CHANNEL,
      MAIN_WORLD_TEXT_RESPONSE_CHANNEL,
      { value: String(value ?? ""), stages: buildFrameworkTextCommitStages(value) },
      "The page-context input bridge was unavailable."
    );
  }

  function clickElementInMainWorld(element, { focus = true, sequence = "default" } = {}) {
    return requestMainWorldAction(
      element,
      MAIN_WORLD_CLICK_REQUEST_CHANNEL,
      MAIN_WORLD_CLICK_RESPONSE_CHANNEL,
      { focus, sequence },
      "The page-context click bridge was unavailable."
    );
  }

  async function clickElementThroughTrustedInput(element) {
    if (!element?.isConnected) {
      return { ok: false, error: "The Workday option was replaced before trusted input could click it." };
    }

    element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
    const rect = element.getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
    if (![point.x, point.y].every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0)) {
      return { ok: false, error: "The Workday option did not have a valid viewport position." };
    }

    return chrome.runtime
      .sendMessage({ type: "APPLE_CAREERS_TRUSTED_WORKDAY_CLICK", point })
      .catch((error) => ({ ok: false, error: error?.message || "Trusted Workday input was unavailable." }));
  }

  async function replaceRejectedWorkdayTextThroughTrustedInput(element, value) {
    const text = String(value ?? "");
    if (!element?.isConnected || !text || (element.value || "") !== text) {
      return { ok: false, error: "The rejected Workday field changed before trusted repair could begin." };
    }

    element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
    element.focus?.({ preventScroll: true });
    try {
      element.select?.();
    } catch (_error) {
      return { ok: false, error: "The rejected Workday field does not support selecting its current value." };
    }

    const selectionReady =
      document.activeElement === element &&
      Number(element.selectionStart) === 0 &&
      Number(element.selectionEnd) === text.length;
    if (!selectionReady) {
      return { ok: false, error: "The rejected Workday field could not be focused and fully selected." };
    }

    const result = await chrome.runtime
      .sendMessage({ type: "APPLE_CAREERS_TRUSTED_WORKDAY_TEXT_REPLACEMENT", value: text })
      .catch((error) => ({ ok: false, error: error?.message || "Trusted Workday text repair was unavailable." }));
    if (!result?.ok) {
      return result || { ok: false, error: "Trusted Workday text repair did not return a result." };
    }

    element.blur?.();
    await waitForSettle({ quietMs: 150, maxMs: 1000, pollMs: 50 });
    return result;
  }

  function retryFrameworkTextCommit(element, value) {
    if (!element?.isConnected) {
      return { ok: false, error: "The field was replaced before its value could be committed." };
    }

    try {
      element.focus();
      try {
        element.select?.();
      } catch {
        // Some Workday spinbutton/date input types do not support select(); the native setter/input
        // sequence below is still valid for them, so selection failure must not abort the commit.
      }
      for (const stage of buildFrameworkTextCommitStages(value)) {
        setNativeElementValue(element, stage.value);
        element.dispatchEvent(
          new InputEvent("input", {
            inputType: stage.inputType,
            data: stage.data,
            bubbles: true,
            composed: true
          })
        );
      }
      element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || "The framework-compatible input retry failed." };
    }
  }

  // Workday can leave a controlled field looking filled in the DOM while its FormKit state still
  // considers the field empty. Commit every Workday text/date value through the page-world staged
  // sequence, then wait for the framework to settle. The caller still performs a fresh DOM +
  // validation read before counting the field as filled.
  async function commitWorkdayTextField(element, value) {
    let commitResult = await commitTextFieldInMainWorld(element, value);
    if (!commitResult.ok) {
      // Old/partially-loaded tabs may not have the page-world bridge yet. Preserve the bounded isolated-
      // world sequence as a fallback so this remains a recoverable review error instead of throwing.
      commitResult = retryFrameworkTextCommit(element, value);
      element.blur?.();
    }
    await waitForSettle({ quietMs: 150, maxMs: 1000, pollMs: 50 });
    return commitResult;
  }

  function hasExplicitWorkdayFieldError(element) {
    if (!isWorkdayHostname(window.location.hostname) || !element) {
      return false;
    }
    if (element.getAttribute?.("aria-invalid") === "true") {
      return true;
    }

    const fieldContainer = element.closest?.("[data-automation-id^='formField-']");
    if (!fieldContainer) {
      return false;
    }
    if (fieldContainer.getAttribute?.("aria-invalid") === "true" || fieldContainer.querySelector?.("[aria-invalid='true']")) {
      return true;
    }

    return Array.from(fieldContainer.querySelectorAll?.("[data-automation-id='errorMessage'], [role='alert']") || []).some(
      (errorElement) => isElementVisible(errorElement) && Boolean(normalizeText(errorElement.textContent || ""))
    );
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

    return element.getAttribute("aria-invalid") === "true" || hasExplicitWorkdayFieldError(element);
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

  function selectMatchingOptions(selectElement, wantedValues) {
    const values = Array.isArray(wantedValues) ? wantedValues.filter(Boolean) : [wantedValues].filter(Boolean);
    if (values.length === 0 || (values.length > 1 && !selectElement.multiple)) {
      return false;
    }
    if (values.length === 1) {
      return selectMatchingOption(selectElement, values[0]);
    }

    const options = Array.from(selectElement.options || []);
    const matches = values.map((value) => options.find((option) => buildOptionMatcher(value)(option.textContent || option.value || "")));
    if (matches.some((option) => !option)) {
      return false;
    }

    const selectedSetter = Object.getOwnPropertyDescriptor(window.HTMLOptionElement?.prototype || {}, "selected")?.set;
    for (const option of options) {
      const selected = matches.includes(option);
      if (selectedSetter) selectedSetter.call(option, selected);
      else option.selected = selected;
    }
    selectElement.dispatchEvent(new Event("input", { bubbles: true }));
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
      Boolean(option.querySelector?.("input[type='radio'], input[type='checkbox']")?.checked) ||
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

  // Workday's responsive prompt renders its live choices as promptOption divs without option roles,
  // while ordinary listboxes use role=option. Selected-item chips also use role=option, so exclude
  // those explicitly: they prove committed state but are not choices offered by the open menu.
  function getVisibleDropdownOptionElements(root = document) {
    return Array.from(root.querySelectorAll("[role='option'], [data-automation-id='promptOption']")).filter(
      (element) =>
        isElementVisible(element) &&
        !isActionDisabled(element) &&
        element.getAttribute?.("data-automation-id") !== "selectedItem" &&
        !element.closest?.("[data-automation-id='selectedItemList']")
    );
  }

  function getAssociatedWorkdayPromptOptions(dropdownElement) {
    const widgetId = dropdownElement?.id || dropdownElement?.getAttribute?.("data-uxi-element-id") || "";
    if (!widgetId) return [];

    const promptRoots = Array.from(document.querySelectorAll("[data-associated-widget]"))
      .filter((root) => root.getAttribute?.("data-associated-widget") === widgetId);
    return promptRoots.flatMap((root) => getVisibleDropdownOptionElements(root));
  }

  function waitForPreferredWorkdaySourceLevel(previousOptions, { maxMs = 4000, pollMs = 50 } = {}) {
    const previousOptionSet = new Set(previousOptions);
    const startedAt = Date.now();
    let latestOptions = previousOptions.filter((option) => option?.isConnected !== false && isElementVisible(option));
    let latestFingerprint = "";

    const fingerprint = (options) => options
      .map((option) => `${option.id || ""}:${normalizeText(getOptionLabel(option)).toLowerCase()}`)
      .join("|");

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        observer.disconnect();
        resolve(latestOptions);
      };
      const inspect = () => {
        const now = Date.now();
        const currentOptions = getVisibleDropdownOptionElements();
        const currentFingerprint = fingerprint(currentOptions);
        if (currentFingerprint !== latestFingerprint) {
          latestOptions = currentOptions;
          latestFingerprint = currentFingerprint;
        }
        const revealedOptions = currentOptions.filter((option) => !previousOptionSet.has(option));
        const candidateOptions = revealedOptions.length > 0 ? revealedOptions : currentOptions;
        if (choosePreferredWorkdaySourceLabel(candidateOptions.map((option) => getOptionLabel(option)))) {
          latestOptions = currentOptions;
          finish();
          return;
        }
        if (now - startedAt >= maxMs) {
          finish();
        }
      };

      latestFingerprint = fingerprint(previousOptions);
      const observer = new MutationObserver(inspect);
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setInterval(inspect, pollMs);
      inspect();
    });
  }

  function summarizeObservedDropdownOptions(options, maxLabels = 6) {
    const labels = Array.from(new Set(
      options.map((option) => normalizeText(getOptionLabel(option))).filter(Boolean)
    ));
    if (labels.length === 0) return "none";
    const visibleLabels = labels.slice(0, maxLabels);
    return `${visibleLabels.join(", ")}${labels.length > maxLabels ? `, +${labels.length - maxLabels} more` : ""}`;
  }

  function isWorkdayMultiSelectContainer(element) {
    return element?.getAttribute?.("data-automation-id") === "multiSelectContainer";
  }

  function getWorkdayMultiSelectOpenTarget(dropdownElement) {
    const hiddenSearchBox = dropdownElement.querySelector?.("[data-automation-hiddensearch='true']");
    if (hiddenSearchBox) {
      // The Mastercard-style responsive prompt stays minimized when its hidden input is clicked. Its
      // promptSearchButton is the real opener; the resulting choices live in a separate prompt panel.
      return dropdownElement.querySelector?.("[data-automation-id='promptSearchButton']") || dropdownElement;
    }
    return (
      dropdownElement.querySelector?.("input[data-uxi-widget-type='selectinput'], input") || dropdownElement
    );
  }

  // Opens a custom dropdown and clicks whichever revealed option's text matches `matcher`, reusing
  // the same click-then-verify pattern as clickOptionMatchingText/isOptionConfirmedSelected above.
  // Diffs the visible [role=option] set before/after the open-click so options that were already in
  // the DOM (just hidden, rather than rendered fresh on open) still get picked up even when nothing
  // NEW appears after clicking -- falls back to "every currently visible option" in that case.
  async function openDropdownAndReadOptions(dropdownElement) {
    const isWorkdayPrompt = isWorkdayHostname(window.location.hostname) &&
      isWorkdayMultiSelectContainer(dropdownElement);
    const associatedOptionsBeforeOpen = isWorkdayPrompt
      ? getAssociatedWorkdayPromptOptions(dropdownElement)
      : [];
    if (associatedOptionsBeforeOpen.length > 0) {
      return associatedOptionsBeforeOpen;
    }

    const optionsBeforeOpen = new Set(getVisibleDropdownOptionElements());
    const openTarget = isWorkdayMultiSelectContainer(dropdownElement)
      ? getWorkdayMultiSelectOpenTarget(dropdownElement)
      : dropdownElement;
    const pageClick = isWorkdayHostname(window.location.hostname)
      ? await clickElementInMainWorld(openTarget)
      : { ok: false };
    if (!pageClick.ok) {
      simulateRealClick(openTarget);
    }
    await waitForSettle();

    const associatedOptionsAfterOpen = isWorkdayPrompt
      ? getAssociatedWorkdayPromptOptions(dropdownElement)
      : [];
    const optionsAfterOpen = associatedOptionsAfterOpen.length > 0
      ? associatedOptionsAfterOpen
      : getVisibleDropdownOptionElements();
    const revealedOptions = optionsAfterOpen.filter((option) => !optionsBeforeOpen.has(option));
    const candidateOptions = revealedOptions.length > 0 ? revealedOptions : optionsAfterOpen;

    return candidateOptions;
  }

  async function clickResolvedDropdownOption(option) {
    if (
      isWorkdayHostname(window.location.hostname) &&
      option?.getAttribute?.("data-automation-id") === "promptOption"
    ) {
      // Workday's responsiveMonikerPrompt accepts the same pointer sequence from a person but ignores
      // DOM-dispatched events (`isTrusted:false`). Send only this already-resolved option's viewport
      // point to the background CDP bridge; selected-item verification still happens back in loop.js.
      const trustedClick = await clickElementThroughTrustedInput(option);
      return { ...trustedClick, method: "trusted browser input" };
    }

    if (
      isWorkdayHostname(window.location.hostname) &&
      option?.getAttribute?.("data-automation-id") === "menuItem"
    ) {
      const itemType = getWorkdayPromptMenuItemType(option);
      const pageClick = await clickElementInMainWorld(option, {
        focus: false,
        sequence: "workday_prompt_menu_item"
      });
      if (pageClick.ok) {
        return { ...pageClick, method: "recorded page-context sequence" };
      }

      // Keep trusted input as the bounded fallback when the page-world bridge is unavailable. Callers
      // still verify a changed child inventory or a selected-item chip before accepting the action.
      const trustedTarget = getWorkdayTrustedPromptClickTarget(option);
      const trustedClick = await clickElementThroughTrustedInput(trustedTarget);
      if (trustedClick.ok) {
        return {
          ...trustedClick,
          method: itemType === "2"
            ? "trusted browser input fallback on rendered branch text"
            : "trusted browser input fallback on rendered option text"
        };
      }
      return {
        ok: false,
        error: pageClick.error || trustedClick.error || "Workday did not accept the resolved prompt click.",
        method: "unavailable"
      };
    }

    const pageClick = isWorkdayHostname(window.location.hostname)
      ? await clickElementInMainWorld(option, { focus: false })
      : { ok: false };
    if (!pageClick.ok) {
      simulateRealClick(option);
      return { ok: true, usedSyntheticFallback: true };
    }
    return pageClick;
  }

  async function selectOpenedDropdownOption(candidateOptions, matcher) {
    const clickedOption = candidateOptions.find((option) => matcher(getOptionLabel(option))) || null;

    if (clickedOption) {
      await clickResolvedDropdownOption(clickedOption);
    }
    const confirmed = clickedOption && (await isOptionConfirmedSelected(clickedOption));

    return { clickedOption, confirmed };
  }

  function getWorkdayDropdownSearchInput(dropdownElement) {
    return dropdownElement?.querySelector?.(
      "input[data-automation-id='searchBox'], input[data-uxi-widget-type='selectinput']"
    ) || null;
  }

  function refreshWorkdayDropdownElement(dropdownElement) {
    const knownInputId = getWorkdayDropdownSearchInput(dropdownElement)?.id || "";
    const currentInput = knownInputId ? document.getElementById(knownInputId) : null;
    return currentInput?.closest?.("[data-automation-id='multiSelectContainer']") ||
      (dropdownElement?.isConnected ? dropdownElement : null);
  }

  function findPreferredWorkdayPromptOption(candidateOptions, selectedValue) {
    const normalizedSelectedValue = normalizeText(selectedValue).toLowerCase();
    return candidateOptions
      .filter((option) => normalizeText(getOptionLabel(option)).toLowerCase() === normalizedSelectedValue)
      .sort((left, right) => {
        const interactionScore = (option) => {
          if (option.getAttribute?.("data-automation-id") === "menuItem") return 0;
          if (option.getAttribute?.("role") === "option") return 1;
          return 2;
        };
        return interactionScore(left) - interactionScore(right);
      })[0] || null;
  }

  function getWorkdayTrustedPromptClickTarget(option, candidateOptions = []) {
    if (option?.getAttribute?.("data-automation-id") === "promptOption") {
      return option;
    }

    const nestedPromptOption = option?.querySelector?.("[data-automation-id='promptOption']");
    if (nestedPromptOption) {
      return nestedPromptOption;
    }

    const normalizedLabel = normalizeText(getOptionLabel(option)).toLowerCase();
    return candidateOptions.find((candidate) =>
      candidate?.isConnected !== false &&
      candidate.getAttribute?.("data-automation-id") === "promptOption" &&
      normalizeText(getOptionLabel(candidate)).toLowerCase() === normalizedLabel
    ) || option;
  }

  function getWorkdayPromptMenuItemType(option) {
    const typedNode = option?.getAttribute?.("data-uxi-multiselectlistitem-type")
      ? option
      : option?.querySelector?.("[data-uxi-multiselectlistitem-type]");
    return typedNode?.getAttribute?.("data-uxi-multiselectlistitem-type") || "";
  }

  function getWorkdaySourceMenuState(rootOptions, currentOptions) {
    const rootInventory = summarizeObservedDropdownOptions(rootOptions, Number.POSITIVE_INFINITY);
    const currentInventory = summarizeObservedDropdownOptions(currentOptions, Number.POSITIVE_INFINITY);
    const optionCount = new Set(
      currentOptions.map((option) => normalizeText(getOptionLabel(option))).filter(Boolean)
    ).size;
    return {
      rootInventory,
      currentInventory,
      optionCount,
      opened: optionCount > 0 && currentInventory !== rootInventory
    };
  }

  // The recorded Simplify path never types into Salesforce's source prompt. Prefer an exact Other
  // leaf when the current level offers it; otherwise traverse only the observed external-site/job-
  // board category and choose a rendered LinkedIn leaf. The source input remains untouched throughout.
  async function selectWorkdayReferralSource(dropdownElement, openedOptions = []) {
    let currentDropdownElement = refreshWorkdayDropdownElement(dropdownElement) || dropdownElement;
    let candidateOptions = openedOptions.filter(
      (option) => option?.isConnected !== false && isElementVisible(option)
    );
    if (candidateOptions.length === 0) {
      candidateOptions = getVisibleDropdownOptionElements();
    }
    let clickedOption = null;
    let sourceObservation = "";
    let selectedValue = choosePreferredWorkdaySourceLabel(
      candidateOptions.map((option) => getOptionLabel(option))
    );

    if (!selectedValue) {
      const rootOptions = candidateOptions;
      const parentValue = choosePreferredWorkdaySourceParentLabel(
        rootOptions.map((option) => getOptionLabel(option))
      );
      const parentOption = parentValue
        ? findPreferredWorkdayPromptOption(rootOptions, parentValue)
        : null;
      if (!parentOption) {
        return {
          interacted: false,
          ok: false,
          clickedOption: null,
          selectedValue: "",
          error: "No exact Other, LinkedIn source, or recognized Workday source category was offered."
        };
      }

      const optionsBeforeParentClick = new Set(rootOptions);
      const parentClick = await clickResolvedDropdownOption(parentOption);
      if (!parentClick?.ok) {
        return {
          interacted: true,
          ok: false,
          clickedOption: parentOption,
          selectedValue: "",
          error: parentClick?.error || `Workday did not open "${parentValue}".`
        };
      }

      let branchClickMethod = parentClick.method || "the resolved click";
      let currentOptions = await waitForPreferredWorkdaySourceLevel(Array.from(optionsBeforeParentClick));
      let menuState = getWorkdaySourceMenuState(rootOptions, currentOptions);
      let branchRetryError = "";

      if (!menuState.opened && parentClick.method === "recorded page-context sequence") {
        const trustedTarget = getWorkdayTrustedPromptClickTarget(parentOption, rootOptions);
        const trustedRetry = await clickElementThroughTrustedInput(trustedTarget);
        if (trustedRetry.ok) {
          branchClickMethod = `${branchClickMethod}, then trusted browser input retry`;
          currentOptions = await waitForPreferredWorkdaySourceLevel(Array.from(optionsBeforeParentClick));
          menuState = getWorkdaySourceMenuState(rootOptions, currentOptions);
        } else {
          branchRetryError = trustedRetry.error || "trusted browser input was unavailable";
        }
      }

      const revealedOptions = currentOptions.filter((option) => !optionsBeforeParentClick.has(option));
      candidateOptions = revealedOptions.length > 0 ? revealedOptions : currentOptions;
      sourceObservation = menuState.opened
        ? `Opened "${parentValue}" using ${branchClickMethod}. Child options (${menuState.optionCount}): ${menuState.currentInventory}.`
        : menuState.optionCount === 0
          ? `Clicked "${parentValue}" using ${branchClickMethod}, but no child options remained visible.`
          : `Clicked "${parentValue}" using ${branchClickMethod}, but its child menu did not appear. Visible options remained: ${menuState.currentInventory}.`;
      if (branchRetryError) {
        sourceObservation = `${sourceObservation} Trusted retry was unavailable: ${branchRetryError}.`;
      }
      selectedValue = choosePreferredWorkdaySourceLabel(
        candidateOptions.map((option) => getOptionLabel(option))
      );
      if (!selectedValue) {
        return {
          interacted: true,
          ok: false,
          clickedOption: parentOption,
          selectedValue: "",
          error: sourceObservation,
          observation: sourceObservation
        };
      }
    }

    // Other and LinkedIn-labelled results can themselves be categories on some tenants. Follow only
    // newly rendered preferred descendants; never probe an unrelated option just to discover whether
    // it is a branch. Four levels is well above the observed Workday depth and guarantees termination.
    for (let depth = 0; depth < 4; depth += 1) {
      if (!selectedValue) {
        return {
          interacted: depth > 0,
          ok: false,
          clickedOption,
          selectedValue: "",
          error: depth === 0
            ? "No preferred Workday source option was offered."
            : "The Workday source category opened, but none of its observed children was Other or contained LinkedIn.",
          observation: sourceObservation
        };
      }

      clickedOption = findPreferredWorkdayPromptOption(candidateOptions, selectedValue);
      if (!clickedOption) {
        return {
          interacted: depth > 0,
          ok: false,
          clickedOption: null,
          selectedValue,
          error: `The Workday source option "${selectedValue}" was replaced before it could be selected.`,
          observation: sourceObservation
        };
      }

      const optionsBeforeClick = new Set(getVisibleDropdownOptionElements());
      const clickResult = await clickResolvedDropdownOption(clickedOption);
      if (!clickResult?.ok) {
        return {
          interacted: true,
          ok: false,
          clickedOption,
          selectedValue,
          error: clickResult?.error || `Workday did not accept "${selectedValue}".`,
          observation: sourceObservation
        };
      }

      await waitForSettle({ quietMs: 250, maxMs: 1500, pollMs: 50 });
      currentDropdownElement = refreshWorkdayDropdownElement(currentDropdownElement) || currentDropdownElement;
      if (await isDropdownValueConfirmed(currentDropdownElement, selectedValue)) {
        return {
          interacted: true,
          ok: true,
          clickedOption,
          selectedValue,
          error: "",
          observation: sourceObservation
        };
      }

      if (getWorkdayPromptMenuItemType(clickedOption) === "1") {
        let trustedRetry = null;
        if (clickResult.method === "recorded page-context sequence") {
          const trustedTarget = getWorkdayTrustedPromptClickTarget(clickedOption, candidateOptions);
          trustedRetry = await clickElementThroughTrustedInput(trustedTarget);
          if (trustedRetry.ok) {
            await waitForSettle({ quietMs: 250, maxMs: 1500, pollMs: 50 });
            currentDropdownElement = refreshWorkdayDropdownElement(currentDropdownElement) || currentDropdownElement;
            if (await isDropdownValueConfirmed(currentDropdownElement, selectedValue)) {
              const retryObservation = `Selecting "${selectedValue}" required one trusted retry on its rendered text option.`;
              return {
                interacted: true,
                ok: true,
                clickedOption,
                selectedValue,
                error: "",
                observation: `${sourceObservation} ${retryObservation}`.trim()
              };
            }
          }
        }

        const leafInventory = summarizeObservedDropdownOptions(candidateOptions, Number.POSITIVE_INFINITY);
        const retryDetail = trustedRetry
          ? trustedRetry.ok
            ? "one trusted retry also did not produce a selected-item chip"
            : `the trusted retry was unavailable (${trustedRetry.error || "unknown error"})`
          : `${clickResult.method || "the resolved click"} did not produce a selected-item chip`;
        return {
          interacted: true,
          ok: false,
          clickedOption,
          selectedValue,
          error: `The discovered leaf "${selectedValue}" was not committed: ${retryDetail}. Visible child options: ${leafInventory}.`,
          observation: sourceObservation
        };
      }

      const currentOptions = await waitForPreferredWorkdaySourceLevel(Array.from(optionsBeforeClick));
      candidateOptions = currentOptions.filter((option) => !optionsBeforeClick.has(option));
      selectedValue = choosePreferredWorkdaySourceLabel(
        candidateOptions.map((option) => getOptionLabel(option))
      );
    }

    return {
      interacted: true,
      ok: false,
      clickedOption,
      selectedValue,
      error: "The Workday source hierarchy exceeded the four-level safety limit.",
      observation: sourceObservation
    };
  }

  function hasVisibleDropdownOptions(candidateOptions = []) {
    return candidateOptions.some((option) => option?.isConnected !== false && isElementVisible(option));
  }

  function getWorkdayDropdownTrigger(dropdownElement) {
    if (dropdownElement.getAttribute?.("aria-haspopup") === "listbox") {
      return dropdownElement;
    }
    return dropdownElement.querySelector?.("[aria-haspopup='listbox']") || null;
  }

  function getWorkdayDropdownPanel(trigger) {
    const panelId = trigger?.getAttribute?.("aria-controls");
    return panelId ? document.getElementById(panelId) : null;
  }

  function isWorkdayDropdownMenuOpen(dropdownElement, candidateOptions = []) {
    const trigger = getWorkdayDropdownTrigger(dropdownElement);
    if (trigger) {
      return trigger.getAttribute?.("aria-expanded") === "true";
    }
    if (isWorkdayMultiSelectContainer(dropdownElement)) {
      return getAssociatedWorkdayPromptOptions(dropdownElement).length > 0;
    }
    return hasVisibleDropdownOptions(candidateOptions) || getVisibleDropdownOptionElements().length > 0;
  }

  async function closeWorkdayDropdownMenu(dropdownElement, candidateOptions = []) {
    if (!isWorkdayHostname(window.location.hostname)) {
      return true;
    }

    await delay(100);
    const menuIsOpen = () => isWorkdayDropdownMenuOpen(dropdownElement, candidateOptions);

    if (!menuIsOpen()) {
      return true;
    }

    // Workday can register a synthetic option click while leaving its popup mounted. Escape mirrors
    // the keyboard interaction the widget already supports and avoids letting the next fresh snapshot
    // mistake that option panel for another application question.
    const trigger = getWorkdayDropdownTrigger(dropdownElement);
    const eventTarget = getWorkdayDropdownPanel(trigger) || trigger || document.activeElement || dropdownElement;
    eventTarget.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true
    }));
    eventTarget.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true
    }));
    await delay(150);

    if (!menuIsOpen()) {
      return true;
    }

    // The real Workday trigger removes aria-expanded when closed. Issue exactly one click while it
    // still says true: simulateRealClick's pointer/mouse/click sequence can hit Workday's toggle more
    // than once and leave the menu open again even though the chosen value was already registered.
    const stillOpenTrigger = getWorkdayDropdownTrigger(dropdownElement);
    if (stillOpenTrigger?.getAttribute?.("aria-expanded") === "true" && isElementVisible(stillOpenTrigger)) {
      stillOpenTrigger.click();
      await delay(150);
    }

    if (menuIsOpen() && document.body) {
      // A click targeted at body is an outside-click signal, not a coordinate click on whatever is
      // visually under the body's center. Workday's document-level dismiss handler receives it while
      // no form control or navigation element can accidentally be activated.
      simulateRealClick(document.body);
      await delay(150);
    }

    return !menuIsOpen();
  }

  async function isDropdownValueConfirmed(dropdownElement, wantedValue) {
    await delay(150);
    const visibleDescendantOptions = Array.from(dropdownElement.querySelectorAll?.("[role='option']") || [])
      .filter(
        (option) =>
          isElementVisible(option) &&
          option.getAttribute?.("data-automation-id") !== "selectedItem" &&
          !option.closest?.("[data-automation-id='selectedItemList']")
      );
    if (visibleDescendantOptions.length > 0) {
      return false; // an open menu's option text is not proof that a selection registered
    }
    const matcher = buildOptionMatcher(wantedValue);
    if (isWorkdayHostname(window.location.hostname) && isWorkdayMultiSelectContainer(dropdownElement)) {
      // The editable search input keeps whatever filter text was typed even when no option was chosen.
      // Only Workday's selected-item chips represent committed form state.
      const selectedItems = Array.from(
        dropdownElement.querySelectorAll?.("[data-automation-id='selectedItem']") || []
      );
      return selectedItems.some((item) =>
        matcher(`${item.textContent || ""} ${item.getAttribute?.("data-automation-label") || ""}`)
      );
    }
    const input = dropdownElement.querySelector?.("input[role='combobox'], input[readonly], input") || null;
    const displayed = normalizeText(
      `${dropdownElement.innerText || ""} ${dropdownElement.getAttribute("aria-label") || ""} ${input?.value || ""}`
    );
    if (matcher(displayed)) {
      return true;
    }

    if (!isWorkdayHostname(window.location.hostname) || getVisibleDropdownOptionElements().length > 0) {
      return false;
    }

    // Workday commonly closes and removes the role=option menu after a successful click, then renders
    // the chosen value beside the combobox trigger rather than inside it. Once no option menu remains
    // visible, accept that value only from a nearby, bounded field wrapper; this verifies the exact
    // requested option without mistaking the previously-open menu's text for a saved selection.
    let container = dropdownElement.parentElement;
    for (let depth = 0; container && depth < 5; depth += 1) {
      const containerText = normalizeText(container.innerText || "");
      if (containerText.length > 0 && containerText.length <= 500 && matcher(containerText)) {
        return true;
      }
      container = container.parentElement;
    }
    return false;
  }

  async function openDropdownAndSelectOption(dropdownElement, matcher) {
    const candidateOptions = await openDropdownAndReadOptions(dropdownElement);

    return selectOpenedDropdownOption(candidateOptions, matcher);
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

  // Workday is the one generic-autofill host allowed to cross page boundaries. Keep its navigation
  // vocabulary exact and separate from SUBMIT_LABEL_ALLOWLIST: treating "Continue" as a generic
  // submit action would silently broaden multi-page automation to every unknown careers site.
  function findWorkdayProgressAction() {
    const candidates = Array.from(document.querySelectorAll("a, button, input[type='submit'], [role='button']"))
      .filter((element) => isElementVisible(element))
      .filter((element) => !isActionDisabled(element))
      .map((element) => {
        const label = getActionLabel(element);
        return { element, label, kind: getWorkdayProgressActionKind(label) };
      })
      .filter((candidate) => candidate.kind);

    const actionKeys = new Set(candidates.map((candidate) => `${candidate.kind}:${normalizeText(candidate.label).toLowerCase()}`));
    return actionKeys.size === 1 ? candidates[0] : null;
  }

  Object.assign(GA, {
    fillTextField,
    isFieldNowInvalid,
    hasExpectedFieldValue,
    traceElementWrites,
    buildFrameworkTextCommitStages,
    retryFrameworkTextCommit,
    commitTextFieldInMainWorld,
    clickElementInMainWorld,
    clickElementThroughTrustedInput,
    replaceRejectedWorkdayTextThroughTrustedInput,
    commitWorkdayTextField,
    hasExplicitWorkdayFieldError,
    selectMatchingOption,
    selectMatchingOptions,
    simulateRealClick,
    isOptionConfirmedSelected,
    clickOptionMatchingText,
    openDropdownAndReadOptions,
    selectOpenedDropdownOption,
    getVisibleDropdownOptionElements,
    getAssociatedWorkdayPromptOptions,
    getWorkdayMultiSelectOpenTarget,
    getWorkdayDropdownSearchInput,
    getWorkdayPromptMenuItemType,
    getWorkdayTrustedPromptClickTarget,
    getWorkdaySourceMenuState,
    selectWorkdayReferralSource,
    isWorkdayDropdownMenuOpen,
    isWorkdayMultiSelectContainer,
    closeWorkdayDropdownMenu,
    isDropdownValueConfirmed,
    openDropdownAndSelectOption,
    waitForSettle,
    findResumeFileInput,
    findGenericSubmitButton,
    findWorkdayProgressAction
  });
})();
