// The main snapshot -> decide -> act loop, roughly analogous to Pie's runAgentLoop. Known fields stay
// deterministic; unresolved application questions may ask the bounded background question agent for
// answer_text/choose_option, but this local loop remains the only code allowed to act on the DOM.
(function () {
  const GA = window.__careerPeelerGA;
  const {
    normalizeText,
    getActionLabel,
    getOptionLabel,
    isAgeEligibilityQuestion,
    isPreviousEmploymentQuestion,
    isWorkAuthorizationQuestion,
    isCategoricalWorkAuthorizationStatusQuestion,
    isVisaSponsorshipQuestion,
    isReferralSourceQuestion,
    isWorkdayHostname,
    isPhoneExtensionField,
    getWorkdayProgressActionKind,
    isGenderQuestion,
    isRaceEthnicityQuestion,
    isVeteranStatusQuestion,
    isDisabilityStatusQuestion,
    isCriminalHistoryQuestion,
    isElementStillActionable,
    snapshotPage,
    inferGenericFieldMapping,
    resolveProfileValue,
    buildOptionMatcher,
    isSensitiveProfileKey,
    selectMatchingOption,
    selectMatchingOptions,
    fillTextField,
    isFieldNowInvalid,
    hasExpectedFieldValue,
    traceElementWrites,
    retryFrameworkTextCommit,
    commitWorkdayTextField,
    replaceRejectedWorkdayTextThroughTrustedInput,
    hasExplicitWorkdayFieldError,
    clickOptionMatchingText,
    isOptionConfirmedSelected,
    openDropdownAndSelectOption,
    openDropdownAndReadOptions,
    selectOpenedDropdownOption,
    selectWorkdayReferralSource,
    isWorkdayMultiSelectContainer,
    closeWorkdayDropdownMenu,
    isDropdownValueConfirmed,
    waitForSettle,
    autofillWorkdayExperiencePage,
    askApplicationQuestionAgent,
    findGenericSubmitButton
  } = GA;

  // Never surface a typed value for a password-kind field in the activity log, even though no current
  // profile/mapping rule targets one -- this extension only ever fills application-form data, never
  // credentials. Kept as a forward-looking guard, same spirit as Pie's own narrowly-scoped
  // redactArgsForPanel (which also guards a case rather than only what's exercised today). Module-level
  // (not a closure inside runGenericAutofill) so it's independently testable and reusable.
  function describeEnteredValue(kind, value) {
    return kind === "password" ? "entered a value" : `entered "${value}"`;
  }

  function countAnswerWords(value) {
    return String(value || "").trim().split(/\s+/).filter(Boolean).length;
  }

  function countOfferedOptions(options) {
    return options.filter((option) =>
      !/^(?:select|choose)(?: an?)?(?: option| date)?\.?$/i.test(normalizeText(option || ""))
    ).length;
  }

  function hasSavedAnswer(value) {
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  }

  function profileAnswerObservation(profileKey, fallback) {
    return isSensitiveProfileKey(profileKey) ? "answered from saved profile and verified" : fallback;
  }

  function reportedProfileValue(profileKey, value) {
    return isSensitiveProfileKey(profileKey) ? "Saved profile answer" : value;
  }

  // Pure: picks the next field entry the sequential loop below hasn't decided about yet. Kept
  // separate from the snapshotPage()/DOM side of that loop (which does need a real page) so the
  // selection logic itself -- the actual behavior change this session's sequential rewrite is about --
  // is independently testable in the VM-sandbox harness with plain objects, the same boundary
  // buildTextFillRetryOutcome already sits on. Module-level and exported for that reason.
  function findNextUnhandledFieldEntry(fieldEntries, handledKeys, keyFn) {
    return fieldEntries.find((entry) => !handledKeys.has(keyFn(entry)));
  }

  // Pure: turns the settle/fallback results into the field loop's outcome shape. Kept separate from
  // the async waitForSettle/retryFrameworkTextCommit calls that produce those inputs (which DO need a
  // real DOM/MutationObserver, unlike this branching) so the decision logic itself is independently
  // testable in the VM-sandbox harness, the same boundary hasExpectedFieldValue's comparison logic
  // already sits on. Module-level and exported for that reason, not a closure inside runGenericAutofill.
  function buildTextFillRetryOutcome(label, { settledOk, fallback, fallbackFinalOk }) {
    if (settledOk) {
      return { ok: true, viaFallback: false };
    }

    if (fallback.ok && fallbackFinalOk) {
      return { ok: true, viaFallback: true };
    }

    return {
      ok: false,
      reason: fallback.ok
        ? `${label} -- this site's form didn't accept the value after a framework-compatible retry; please fill it manually`
        : `${label} -- couldn't fill this field programmatically, and the framework-compatible retry failed (${fallback.error}); please fill it manually`,
      observation: fallback.ok
        ? "value still didn't stick after the framework-compatible retry"
        : `framework-compatible retry failed (${fallback.error})`
    };
  }

  function hasMeaningfulExistingFieldValue(element, kind) {
    if (kind !== "select") {
      return Boolean((element.value || "").trim());
    }

    const selected = element.selectedOptions?.[0] || element.options?.[element.selectedIndex];
    const text = normalizeText(`${selected?.textContent || ""} ${selected?.value || ""}`);
    return Boolean(selected) && !selected.disabled && Boolean(String(selected.value || "").trim()) &&
      !/^(?:select|choose)(?: an?)?(?: option| date)?\b/i.test(text);
  }

  function getMeaningfulExistingWorkdayDropdownValue(element) {
    if (element.getAttribute?.("data-automation-id") === "multiSelectContainer") {
      const selectedItems = Array.from(
        element.querySelectorAll?.("[data-automation-id='selectedItem']") || []
      ).map((item) => normalizeText(item.getAttribute?.("data-automation-label") || item.textContent || ""));
      return selectedItems.filter(Boolean).join(", ");
    }
    const trigger = element.getAttribute?.("aria-haspopup") === "listbox"
      ? element
      : element.querySelector?.("[aria-haspopup='listbox']");
    const machineValue = String(trigger?.getAttribute?.("value") || trigger?.value || "").trim();
    const displayedValue = normalizeText(trigger?.innerText || "");
    if (!machineValue || !displayedValue || /^(?:select|choose)(?: an?)?(?: option| one| date)?\.?$/i.test(displayedValue)) {
      return "";
    }
    return displayedValue;
  }

  function isMappedApplicationQuestion(label, mapping) {
    return Boolean(
      mapping &&
      (mapping.action === "essay" ||
        mapping.action === "fixed" ||
        /\?/.test(label || "") ||
        [
          "availableStartDate",
          "desiredSalary",
          "eeoGender",
          "eeoRaceEthnicity",
          "eeoVeteranStatus",
          "eeoDisabilityStatus"
        ].includes(mapping.profileKey))
    );
  }

  async function runGenericAutofill(userProfile, activityContext = {}) {
    const profile = userProfile || {};
    const pageContext = { hostname: window.location.hostname || "" };
    const isWorkday = isWorkdayHostname(pageContext.hostname);
    const filledFields = [];
    const flaggedFields = [];
    // (element, label, value) for every text/select field filled below -- kept separate from
    // filledFields (which flows out through sendResponse/chrome.runtime messaging, and DOM elements
    // can't be structured-cloned) so the end-of-sweep verification pass can re-check each one's live
    // value against what was actually written, after everything else in this sweep has run.
    const filledFieldElements = [];
    let repairedRejectedWorkdayFieldCount = 0;
    // Genuine essay questions, plus unrecognized required text fields -- both get the same
    // LLM-drafted-from-resume fallback chain below, rather than only essay questions.
    const pendingAnswerFields = [];
    const TEXT_LIKE_KINDS = ["text", "email", "tel", "url", "textarea", "search"];

    // A running, human-readable trace of every decision the sweep makes -- both so you can see it in
    // the side panel's result and confirm the sweep is actually finding/reasoning about fields (not
    // just silently skipping things), and printed to this page's own DevTools console too.
    const trace = [];
    function logTrace(message) {
      trace.push(message);
      console.log(`[Career Peeler] ${message}`);
    }

    async function resolveWithQuestionAgent(questionText, fieldKind, options = []) {
      return askApplicationQuestionAgent({
        questionText,
        fieldKind,
        options
      });
    }

    async function enterTextValue(element, value) {
      if (!isWorkday) {
        fillTextField(element, value);
        return { ok: true, viaFrameworkCommit: false, settled: false };
      }

      const commit = await commitWorkdayTextField(element, value);
      return { ...commit, viaFrameworkCommit: commit.ok, settled: true };
    }

    function findCurrentFilledField(element, label, kind, value) {
      if (element?.isConnected && hasExpectedFieldValue(element, value)) {
        return element;
      }
      return snapshotPage()
        .filter((entry) => entry.type === "field" && entry.label === label && entry.fieldKind === kind)
        .map((entry) => entry.element)
        .find((candidate) => hasExpectedFieldValue(candidate, value)) || null;
    }

    // Real-time, structured companion to the trace above -- one entry per actual action the sweep
    // takes (not every skip/diagnostic logTrace covers), pushed to chrome.storage.local as it happens
    // so the side panel can render a live activity log the same way it already renders scan status
    // (see useScanStatus.js's chrome.storage.onChanged listener). Content scripts have direct
    // chrome.storage access, so this needs no message relay through background.js -- unlike Pie, which
    // streams steps over a chrome.runtime.connect() port because its agent loop runs in a different
    // context; this repo already has a working storage-based live-update mechanism, so this reuses
    // that instead of introducing ports.
    const GENERIC_AUTOFILL_ACTIVITY_KEY = "appleCareersGenericAutofillActivity";
    const requestedCycleId = activityContext.cycleId || null;
    const storedActivity = requestedCycleId
      ? (await chrome.storage.local.get(GENERIC_AUTOFILL_ACTIVITY_KEY).catch(() => ({})))[GENERIC_AUTOFILL_ACTIVITY_KEY]
      : null;
    const priorCycle = storedActivity?.cycles?.find((cycle) => cycle.id === requestedCycleId) || null;
    const activitySteps = priorCycle
      ? (storedActivity.steps || []).filter((step) => step.cycleId === requestedCycleId).map((step) => ({ ...step }))
      : [];
    const activityCycle = priorCycle
      ? { ...priorCycle, status: "running", outcome: "Applying" }
      : {
          id: requestedCycleId || `generic:${Date.now()}`,
          title: document.title || window.location.hostname || "Current Application",
          url: window.location.href || null,
          status: "running",
          outcome: isWorkday ? "Applying" : "Autofilling",
          startedAt: Date.now()
        };
    if (priorCycle) {
      delete activityCycle.completedAt;
    }
    const activityCycles = [activityCycle];
    let activityStepId = activitySteps.reduce((maximum, step) => Math.max(maximum, Number(step.id) || 0), 0);

    async function persistActivity(running) {
      await chrome.storage.local
        .set({
          [GENERIC_AUTOFILL_ACTIVITY_KEY]: {
            running,
            steps: activitySteps,
            cycles: activityCycles,
            updatedAt: Date.now()
          }
        })
        .catch(() => {}); // best-effort UI nicety -- must never break the sweep itself
    }

    async function pushActivityStep(tool, label, status, observation) {
      const step = { id: ++activityStepId, cycleId: activityCycle.id, tool, label, status, observation };
      activitySteps.push(step);
      await persistActivity(true);
      return step.id;
    }

    async function resolveActivityStep(id, status, observation) {
      const step = activitySteps.find((entry) => entry.id === id);
      if (step) {
        step.status = status;
        step.observation = observation;
        await persistActivity(true);
      }
    }

    await persistActivity(true); // reset any previous run's steps before this one starts
    logTrace(`Starting autofill sweep on ${window.location.hostname}.`);

    let observedCandidateProfile = null;
    if (isWorkday) {
      const structuredResult = await autofillWorkdayExperiencePage(profile, { pushActivityStep, logTrace });
      filledFields.push(...structuredResult.filledFields);
      flaggedFields.push(...structuredResult.flaggedFields);
      observedCandidateProfile = structuredResult.handled ? structuredResult.observedCandidateProfile : null;
      repairedRejectedWorkdayFieldCount += structuredResult.repairedRejectedFieldCount || 0;
      if (structuredResult.handled) {
        logTrace(
          `Workday structured profile: ${structuredResult.observedCandidateProfile.experience.length} experience and ${structuredResult.observedCandidateProfile.education.length} education entr${
            structuredResult.observedCandidateProfile.experience.length + structuredResult.observedCandidateProfile.education.length === 1
              ? "y"
              : "ies"
          } observed after autofill.`
        );
      }
    }

    const snapshot = snapshotPage();
    const fieldEntries = snapshot.filter((entry) => entry.type === "field");
    const questionEntries = snapshot.filter((entry) => entry.type === "question");
    const dropdownEntries = snapshot.filter((entry) => entry.type === "dropdown");
    const fileEntry = snapshot.find((entry) => entry.type === "file") || null;
    logTrace(
      `Snapshot: ${fieldEntries.length} form field(s), ${questionEntries.length} button/radio-group question(s), ${dropdownEntries.length} custom dropdown(s), ${fileEntry ? 1 : 0} resume upload field(s).`
    );

    // A value that didn't stick immediately after a normal fill gets ONE genuine settle-then-recheck
    // before assuming the write was rejected outright -- a framework's debounced validation/re-render
    // can take longer than isFieldNowInvalid's fixed ~150ms delay to revert a value, so checking again
    // that early can't tell "rejected on write" apart from "accepted, then reverted a moment later."
    // Escalates to the staged framework-compatible retry (see actions.js's retryFrameworkTextCommit) only if the
    // value is STILL wrong after settling, then settles and verifies once more before giving up --
    // exactly one retry tier, never looping. traceElementWrites is attached for the whole check so a
    // revert-in-progress shows up in the console, not just its end state.
    async function verifyAndRetryTextFill(element, label, kind, wantedValue) {
      const untrace = traceElementWrites(element, label, kind);

      try {
        logTrace(`"${label}" (${kind}) -- value didn't stick immediately after a normal fill; waiting for the page to settle before deciding...`);
        await waitForSettle();
        const settledOk = hasExpectedFieldValue(element, wantedValue);

        let fallback = { ok: true };
        let fallbackFinalOk = true;

        if (!settledOk) {
          logTrace(`"${label}" (${kind}) -- still didn't stick after settling; retrying through the field's framework events...`);
          fallback = isWorkday
            ? await commitWorkdayTextField(element, wantedValue)
            : retryFrameworkTextCommit(element, wantedValue);
          await waitForSettle();
          fallbackFinalOk = hasExpectedFieldValue(element, wantedValue);
        }

        const outcome = buildTextFillRetryOutcome(label, { settledOk, fallback, fallbackFinalOk });

        logTrace(
          outcome.ok
            ? settledOk
              ? `"${label}" (${kind}) -- value was present after all once the page settled.`
              : `Filled "${label}" (${kind}) with "${wantedValue}" via framework-compatible retry.`
            : fallback.ok
              ? `Flagged "${label}" (${kind}) -- framework-compatible retry ran, but the value still didn't stick.`
              : `Flagged "${label}" (${kind}) -- framework-compatible retry failed (${fallback.error}).`
        );

        return outcome;
      } finally {
        untrace();
      }
    }

    // Handles exactly ONE field-loop entry (checkbox / select / text) -- extracted so the sequential
    // loop below can call it once per fresh read, then settle, then re-read, rather than looping
    // through a list captured from one stale upfront snapshot. Every branch here is otherwise
    // unchanged from before this session's sequential rewrite. Returns { mutated } so the caller knows
    // whether a settle-wait is warranted before the next fresh read -- a pure "skip, already has a
    // value" or "skip, not required" entry never touched the DOM, so there's nothing to wait on; a
    // write that already went through verifyAndRetryTextFill's own settle-wait internally doesn't need
    // a second one layered on top.
    async function processFieldEntry(entry) {
      const { element, label, fieldKind: kind, required, questionRequired } = entry;

      // Re-verify this element is still live immediately before acting on it -- see
      // isElementStillActionable's comment in domHelpers.js for why. Guards every branch below,
      // including the checkbox one, since a stale reference silently "succeeds" on .click()/.value
      // just as easily as on fillTextField.
      if (!isElementStillActionable(element)) {
        if (required) {
          flaggedFields.push({
            label,
            reason: `${label} -- this field became unavailable before the sweep could fill it; please check it manually`
          });
          await pushActivityStep(kind === "select" ? "select" : "type", label, "error", "field became unavailable before we could fill it");
          logTrace(`Flagged "${label}" (${kind}) -- no longer actionable (detached/hidden/disabled) by the time the sweep reached it.`);
        } else {
          logTrace(`Skipped "${label}" (${kind}) -- no longer actionable (detached/hidden/disabled) by the time the sweep reached it.`);
        }
        return { mutated: false };
      }

      if (kind === "checkbox") {
        if (isAgeEligibilityQuestion(label) || isWorkAuthorizationQuestion(label) || isVisaSponsorshipQuestion(label)) {
          if (!questionRequired) {
            logTrace(`Skipped optional question "${label}" (checkbox).`);
            return { mutated: false };
          }
          if (!element.checked) {
            element.click();
          }
          if (element.checked) {
            filledFields.push({ label, value: "Yes" });
            await pushActivityStep("click", label, "success", 'checked "Yes"');
            logTrace(`Checked "${label}" (fixed Yes policy, confirmed checked).`);
            return { mutated: true };
          }
          flaggedFields.push({ label, reason: `${label} -- clicked the Yes checkbox, but it did not remain checked` });
          await pushActivityStep("click", label, "error", "checkbox did not remain checked");
          return { mutated: false };
        }
        if (required) {
          flaggedFields.push({ label, reason: `${label} -- checkbox needs manual review` });
          await pushActivityStep("click", label, "error", "needs manual review");
          logTrace(`Flagged checkbox "${label}" -- required, no safe default to check.`);
          return { mutated: false };
        }
        logTrace(`Skipped checkbox "${label}" -- not required, no safe default.`);
        return { mutated: false };
      }

      if (hasMeaningfulExistingFieldValue(element, kind)) {
        const rejectedWorkdayTextValue =
          isWorkday &&
          TEXT_LIKE_KINDS.includes(kind) &&
          !element.closest?.("[data-automation-id='applyFlowMyExpPage']") &&
          hasExplicitWorkdayFieldError(element);
        if (rejectedWorkdayTextValue) {
          const existingValue = String(element.value || "");
          const repair = await replaceRejectedWorkdayTextThroughTrustedInput(element, existingValue);
          const verifiedElement = findCurrentFilledField(element, label, kind, existingValue);
          const repaired = Boolean(
            repair.ok &&
              verifiedElement &&
              !(await isFieldNowInvalid(verifiedElement))
          );
          if (repaired) {
            repairedRejectedWorkdayFieldCount += 1;
            filledFields.push({ label, value: existingValue });
            filledFieldElements.push({ element: verifiedElement, label, value: existingValue });
            await pushActivityStep("verify", label, "success", "re-entered the rejected value through trusted browser input");
            logTrace(`Re-entered rejected Workday field "${label}" through trusted browser input and verified it.`);
          } else {
            flaggedFields.push({
              label,
              reason: repair.ok
                ? `${label} -- Workday still rejected the visible value after one trusted input repair; please review it manually`
                : `${label} -- trusted Workday input repair failed (${repair.error}); please review it manually`
            });
            await pushActivityStep(
              "verify",
              label,
              "error",
              repair.ok ? "Workday still rejected the value after a trusted input repair" : `trusted input repair failed (${repair.error})`
            );
          }
          return { mutated: false }; // enterTextValue already waited for Workday to commit or reject the retry
        }
        logTrace(`Skipped "${label}" (${kind}) -- already has a value.`);
        return { mutated: false }; // already filled by the site itself, don't overwrite
      }

      if (isPhoneExtensionField(label)) {
        logTrace(`Skipped "${label}" (${kind}) -- phone extensions are intentionally left blank.`);
        return { mutated: false };
      }

      const mapping = inferGenericFieldMapping(label, pageContext);

      if (!questionRequired && isMappedApplicationQuestion(label, mapping)) {
        logTrace(`Skipped optional question "${label}" (${kind}).`);
        return { mutated: false };
      }

      if (!mapping) {
        if (required && TEXT_LIKE_KINDS.includes(kind)) {
          pendingAnswerFields.push({ element, label, fieldKind: kind });
          logTrace(`"${label}" (${kind}) -- unrecognized but required; queued for LLM answer.`);
        } else if (required && kind === "select") {
          const optionLabels = Array.from(element.options || []).map((option) => normalizeText(option.textContent || option.value || ""));
          const offeredOptionCount = countOfferedOptions(optionLabels);
          const stepId = await pushActivityStep(
            "question_agent",
            label,
            "pending",
            `Agent started; reviewing ${offeredOptionCount} offered options...`
          );
          const decision = await resolveWithQuestionAgent(label, kind, optionLabels);

          if (decision?.action === "choose_option" && selectMatchingOption(element, decision.value)) {
            filledFields.push({ label, value: decision.value });
            filledFieldElements.push({ element, label, value: decision.value });
            await resolveActivityStep(
              stepId,
              "success",
              `reviewed ${offeredOptionCount} offered options; selected "${decision.value}"`
            );
            logTrace(`Answered unrecognized required select "${label}" with "${decision.value}" (question agent).`);
            return { mutated: true };
          }

          flaggedFields.push({ label, reason: `${label} -- the question agent could not select a verified offered option` });
          await resolveActivityStep(stepId, "error", "no verified offered option was selected");
          logTrace(`Flagged "${label}" (select) -- question agent could not select an offered option.`);
        } else if (required) {
          flaggedFields.push({ label, reason: `${label} -- unrecognized required field` });
          logTrace(`Flagged "${label}" (${kind}) -- unrecognized required field.`);
        } else {
          logTrace(`Skipped "${label}" (${kind}) -- unrecognized, not required.`);
        }
        return { mutated: false };
      }

      if (mapping.action === "essay") {
        pendingAnswerFields.push({ element, label, fieldKind: kind });
        logTrace(`"${label}" -- detected as an essay question; queued for LLM answer.`);
        return { mutated: false };
      }

      if (mapping.action === "candidate_employment") {
        const optionLabels = kind === "select"
          ? Array.from(element.options || []).map((option) => normalizeText(option.textContent || option.value || ""))
          : [];
        const stepId = await pushActivityStep(
          "question_agent",
          label,
          "pending",
          "Agent started; checking previous-employer history in the candidate profile..."
        );
        const decision = await resolveWithQuestionAgent(label, kind, optionLabels);

        if (decision?.action === "choose_option" && kind === "select" && selectMatchingOption(element, decision.value)) {
          filledFields.push({ label, value: decision.value });
          filledFieldElements.push({ element, label, value: decision.value });
          await resolveActivityStep(stepId, "success", `${decision.reason || "Answered from candidate profile"} Selected "${decision.value}".`);
          return { mutated: true };
        }

        if (decision?.action === "answer_text" && TEXT_LIKE_KINDS.includes(kind)) {
          const write = await enterTextValue(element, decision.value);
          const verifiedElement = findCurrentFilledField(element, label, kind, decision.value);
          if (write.ok && verifiedElement && !(await isFieldNowInvalid(verifiedElement))) {
            filledFields.push({ label, value: decision.value });
            filledFieldElements.push({ element: verifiedElement, label, value: decision.value });
            await resolveActivityStep(stepId, "success", `${decision.reason || "Answered from candidate profile"} Entered "${decision.value}".`);
            return { mutated: !write.settled };
          }
        }

        flaggedFields.push({ label, reason: `${label} -- candidate profile could not produce a verified previous-employer answer` });
        await resolveActivityStep(stepId, "error", "candidate profile could not produce a verified Yes/No answer");
        return { mutated: false };
      }

      if (mapping.profileKey === "availableStartDate") {
        const optionLabels = kind === "select"
          ? Array.from(element.options || []).map((option) => normalizeText(option.textContent || option.value || ""))
          : [];
        const stepId = await pushActivityStep("generate", label, "pending", "choosing the nearest available future date...");
        const decision = await resolveWithQuestionAgent(label, kind, optionLabels);

        if (decision?.action === "choose_option" && kind === "select" && selectMatchingOption(element, decision.value)) {
          filledFields.push({ label, value: decision.value });
          filledFieldElements.push({ element, label, value: decision.value });
          await resolveActivityStep(stepId, "success", `selected "${decision.value}"`);
          logTrace(`Selected nearest available future date "${decision.value}" for "${label}".`);
          return { mutated: true };
        }

        if (decision?.action === "answer_text" && TEXT_LIKE_KINDS.includes(kind)) {
          const write = await enterTextValue(element, decision.value);
          const verifiedElement = findCurrentFilledField(element, label, kind, decision.value);
          const accepted = Boolean(
            write.ok && verifiedElement && !(await isFieldNowInvalid(verifiedElement))
          );
          if (accepted) {
            filledFields.push({ label, value: decision.value });
            filledFieldElements.push({ element: verifiedElement, label, value: decision.value });
            await resolveActivityStep(stepId, "success", `entered "${decision.value}"`);
            return { mutated: !write.settled };
          }
        }

        flaggedFields.push({ label, reason: `${label} -- could not apply the nearest available future date` });
        await resolveActivityStep(stepId, "error", "could not apply a verified future date");
        return { mutated: false };
      }

      const wantedValue = mapping.action === "fixed" ? mapping.value : resolveProfileValue(profile, mapping.profileKey);

      if (!hasSavedAnswer(wantedValue)) {
        if (required) {
          flaggedFields.push({ label, reason: `${label} -- no value saved in your autofill profile` });
          logTrace(`Flagged "${label}" -- matched profile.${mapping.profileKey}, but it's empty.`);
        } else {
          logTrace(`Skipped "${label}" -- matched profile.${mapping.profileKey}, but it's empty and not required.`);
        }
        return { mutated: false };
      }

      if (isSensitiveProfileKey(mapping.profileKey) && kind !== "select") {
        flaggedFields.push({ label, reason: `${label} -- this sensitive field is not an offered-option control` });
        await pushActivityStep("type", label, "error", "sensitive profile answers are used only with offered options");
        return { mutated: false };
      }

      if (kind === "select") {
        if (selectMatchingOptions(element, wantedValue)) {
          filledFields.push({ label, value: reportedProfileValue(mapping.profileKey, wantedValue) });
          filledFieldElements.push({
            element,
            label,
            value: wantedValue,
            reportedValue: reportedProfileValue(mapping.profileKey, wantedValue)
          });
          await pushActivityStep(
            "select",
            label,
            "success",
            profileAnswerObservation(mapping.profileKey, `selected "${wantedValue}"`)
          );
          logTrace(`Filled "${label}" (select) from its mapped profile value.`);
          return { mutated: true };
        }
        flaggedFields.push({ label, reason: `${label} -- the saved profile answer did not map safely to the offered options` });
        await pushActivityStep("select", label, "error", "saved profile answer did not match the offered options");
        logTrace(`Flagged "${label}" (select) -- its mapped profile answer did not match an offered option.`);
        return { mutated: false };
      }

      if (Array.isArray(wantedValue)) {
        flaggedFields.push({ label, reason: `${label} -- this control cannot safely accept multiple saved answers` });
        await pushActivityStep("type", label, "error", "this control cannot accept multiple saved answers");
        return { mutated: false };
      }

      const write = await enterTextValue(element, wantedValue);
      const verifiedElement = findCurrentFilledField(element, label, kind, wantedValue);

      if (!write.ok) {
        flaggedFields.push({
          label,
          reason: `${label} -- the Workday-compatible input commit failed (${write.error}); please fill it manually`
        });
        await pushActivityStep("type", label, "error", `Workday-compatible input commit failed (${write.error})`);
        logTrace(`Flagged "${label}" (${kind}) -- Workday-compatible input commit failed (${write.error}).`);
        return { mutated: false };
      }

      if (!verifiedElement || (await isFieldNowInvalid(verifiedElement))) {
        flaggedFields.push({ label, reason: `${label} -- the value from your profile didn't pass this field's validation` });
        await pushActivityStep("type", label, "error", "filled, but failed the field's own validation");
        logTrace(`Flagged "${label}" (${kind}) -- filled but failed the field's own validation.`);
        return { mutated: true }; // still wrote a value, even though it's flagged -- worth settling before the next field
      }

      if (!hasExpectedFieldValue(verifiedElement, wantedValue)) {
        const outcome = await verifyAndRetryTextFill(element, label, kind, wantedValue); // settles internally

        if (outcome.ok) {
          filledFields.push({ label, value: wantedValue });
          const retryElement = findCurrentFilledField(element, label, kind, wantedValue) || element;
          filledFieldElements.push({ element: retryElement, label, value: wantedValue });
          await pushActivityStep(
            "type",
            label,
            "success",
            outcome.viaFallback ? `${describeEnteredValue(kind, wantedValue)} (via framework-compatible retry)` : describeEnteredValue(kind, wantedValue)
          );
        } else {
          flaggedFields.push({ label, reason: outcome.reason });
          await pushActivityStep("type", label, "error", outcome.observation);
        }
        return { mutated: false };
      }

      filledFields.push({ label, value: wantedValue });
      filledFieldElements.push({ element: verifiedElement, label, value: wantedValue });
      await pushActivityStep("type", label, "success", describeEnteredValue(kind, wantedValue));
      logTrace(`Filled "${label}" (${kind}) with "${wantedValue}".`);
      return { mutated: !write.settled }; // Workday's page-context path already waited for its controlled state to commit
    }

    const handledQuestionKeys = new Set();
    const prehandledDropdownLabels = new Set();
    function questionEntryKey(entry) {
      return `${entry.label}::${entry.options.map((option) => getOptionLabel(option)).join("|")}`;
    }

    // Workday can re-render its controlled form after a radio answer. Resolve the one bounded,
    // profile-grounded previous-employer question before ordinary fields so such a re-render occurs
    // before names/phone/etc. are written, not after. Already-selected answers are verified and left
    // untouched; the agent is engaged only for a required, currently unanswered question.
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const entry = snapshotPage()
        .filter((snapshotEntry) => snapshotEntry.type === "question")
        .find((candidate) => isPreviousEmploymentQuestion(candidate.label) && !handledQuestionKeys.has(questionEntryKey(candidate)));
      if (!entry) {
        break;
      }

      const key = questionEntryKey(entry);
      handledQuestionKeys.add(key);
      if (!entry.required) {
        logTrace(`Skipped optional previous-employer question "${entry.label}".`);
        continue;
      }

      let selectedOption = null;
      for (const option of entry.options) {
        if (await isOptionConfirmedSelected(option)) {
          selectedOption = option;
          break;
        }
      }
      if (selectedOption) {
        logTrace(`Skipped previous-employer question "${entry.label}" -- already answered "${getOptionLabel(selectedOption)}".`);
        continue;
      }

      const optionLabels = entry.options.map((option) => getOptionLabel(option));
      const stepId = await pushActivityStep(
        "question_agent",
        entry.label,
        "pending",
        `Agent started; checking candidate profile against ${optionLabels.length} offered options...`
      );
      const decision = await resolveWithQuestionAgent(entry.label, "option_group", optionLabels);
      const clickedOption = decision?.action === "choose_option"
        ? clickOptionMatchingText(entry.options, buildOptionMatcher(decision.value))
        : null;
      const confirmed = clickedOption && (await isOptionConfirmedSelected(clickedOption));

      if (confirmed) {
        filledFields.push({ label: entry.label, value: decision.value });
        await resolveActivityStep(
          stepId,
          "success",
          `${decision.reason || "Answered from candidate profile"} Selected "${decision.value}".`
        );
        logTrace(`Answered previous-employer question "${entry.label}" from candidate profile and verified "${decision.value}".`);
        await waitForSettle();
      } else {
        const reason = decision?.reason || "The candidate profile did not support a safe Yes/No answer.";
        flaggedFields.push({ label: entry.label, reason: `${entry.label} -- ${reason}` });
        await resolveActivityStep(stepId, "error", reason);
        logTrace(`Flagged previous-employer question "${entry.label}" -- ${reason}`);
      }
    }

    // Workday's responsive source prompt can re-render sibling fields after it commits a selected
    // item. Resolve it before ordinary text input, and inspect its tenant-specific hierarchy through
    // the bounded source adapter instead of hard-coding one parent/child path.
    if (isWorkday) {
      const sourceEntry = snapshotPage()
        .filter((snapshotEntry) => snapshotEntry.type === "dropdown")
        .find((candidate) =>
          isReferralSourceQuestion(candidate.label) && isWorkdayMultiSelectContainer(candidate.element)
        );

      if (sourceEntry) {
        prehandledDropdownLabels.add(sourceEntry.label);

        if (!sourceEntry.required) {
          logTrace(`Skipped optional Workday source question "${sourceEntry.label}".`);
        } else {
          const existingValue = getMeaningfulExistingWorkdayDropdownValue(sourceEntry.element);
          const alreadyPreferredSource = existingValue && (
            buildOptionMatcher("Other")(existingValue) || buildOptionMatcher("LinkedIn")(existingValue)
          ) &&
            !hasExplicitWorkdayFieldError(sourceEntry.element);

          if (alreadyPreferredSource) {
            const menuClosed = await closeWorkdayDropdownMenu(sourceEntry.element);
            if (menuClosed) {
              logTrace(`Skipped Workday source question "${sourceEntry.label}" -- already set to "${existingValue}".`);
            } else {
              flaggedFields.push({
                label: sourceEntry.label,
                reason: `${sourceEntry.label} -- already contains "${existingValue}", but its open option menu could not be closed`
              });
              await pushActivityStep("select", sourceEntry.label, "error", "source is selected, but the menu could not be closed");
            }
          } else if (!isElementStillActionable(sourceEntry.element)) {
            flaggedFields.push({
              label: sourceEntry.label,
              reason: `${sourceEntry.label} -- the Workday source prompt became unavailable before its options could be explored`
            });
            await pushActivityStep("select", sourceEntry.label, "error", "source prompt became unavailable before its options could be explored");
          } else {
            const stepId = await pushActivityStep(
              "select",
              sourceEntry.label,
              "pending",
              "exploring Workday source options..."
            );
            const openedOptions = await openDropdownAndReadOptions(sourceEntry.element);
            const openedSourceEntry = snapshotPage()
              .filter((snapshotEntry) => snapshotEntry.type === "dropdown")
              .find((candidate) => candidate.label === sourceEntry.label);
            const selection = await selectWorkdayReferralSource(
              openedSourceEntry?.element || sourceEntry.element,
              openedOptions
            );
            await waitForSettle({ quietMs: 150, maxMs: 1000, pollMs: 50 });

            const refreshedEntry = snapshotPage()
              .filter((snapshotEntry) => snapshotEntry.type === "dropdown")
              .find((candidate) => candidate.label === sourceEntry.label);
            const currentElement = refreshedEntry?.element || sourceEntry.element;
            const menuClosed = await closeWorkdayDropdownMenu(currentElement, openedOptions);
            const confirmed = Boolean(
              selection.ok &&
              selection.selectedValue &&
              menuClosed &&
              (await isDropdownValueConfirmed(currentElement, selection.selectedValue))
            );

            if (confirmed) {
              filledFields.push({ label: sourceEntry.label, value: selection.selectedValue });
              const sourceDetails = selection.observation ? ` ${selection.observation}` : "";
              await resolveActivityStep(
                stepId,
                "success",
                `selected and verified "${selection.selectedValue}".${sourceDetails}`
              );
              logTrace(`Selected Workday source option "${selection.selectedValue}" and verified its selected-item chip.`);
            } else {
              let reason = selection.error || (menuClosed
                ? "Workday did not expose a verified preferred source selection."
                : "The Workday source menu could not be closed after selection.");
              if (selection.observation && selection.observation !== reason) {
                reason = `${reason} ${selection.observation}`;
              }
              flaggedFields.push({ label: sourceEntry.label, reason: `${sourceEntry.label} -- ${reason}` });
              await resolveActivityStep(stepId, "error", reason);
              logTrace(`Flagged Workday source question "${sourceEntry.label}" -- ${reason}`);
            }
          }
        }
      }
    }

    // Sequential, Pie-style field pass: read -> act on ONE field -> settle -> read again, rather than
    // acting through the fixed list `fieldEntries` (captured once, above) from one stale snapshot. Only
    // the initial `fieldEntries` filter above is used for the startup log line; every actual pick here
    // comes from a fresh snapshotPage() call. handledFieldKeys is keyed by kind+label, not element
    // identity, so a DOM node replaced by a framework re-render between passes is still recognized as
    // "the same field, already decided" rather than being picked again -- and a field that resolves to
    // "queue for LLM" still counts as handled so it isn't re-collected into pendingAnswerFields on a
    // later pass. MAX_FIELD_PASS_ITERATIONS is a generous safety cap, not an expected ceiling -- it only
    // guarantees termination if something pathological keeps making the page look like it has more work.
    const MAX_FIELD_PASS_ITERATIONS = 80;
    const handledFieldKeys = new Set();

    function fieldEntryKey(entry) {
      return `${entry.fieldKind}::${entry.label}`;
    }

    for (let iteration = 0; iteration < MAX_FIELD_PASS_ITERATIONS; iteration += 1) {
      const freshFieldEntries = snapshotPage().filter((snapshotEntry) => snapshotEntry.type === "field");
      const nextEntry = findNextUnhandledFieldEntry(freshFieldEntries, handledFieldKeys, fieldEntryKey);

      if (!nextEntry) {
        break;
      }

      handledFieldKeys.add(fieldEntryKey(nextEntry));
      const { mutated } = await processFieldEntry(nextEntry);

      if (mutated) {
        await waitForSettle();
      }
    }

    // Button/radio-group questions -- each snapshot entry is already a distinct, deduplicated
    // container (see findAllQuestionContainers), so classify each one against the known concepts
    // exactly once, rather than re-searching the DOM separately per concept.
    const QUESTION_RULES = [
      {
        matcher: (label) => isCategoricalWorkAuthorizationStatusQuestion(label) && /\bsingapore\b/i.test(label),
        fixedValue: "Foreigner"
      },
      {
        matcher: (label) => isWorkAuthorizationQuestion(label) && !isCategoricalWorkAuthorizationStatusQuestion(label),
        fixedValue: "Yes"
      },
      { matcher: isVisaSponsorshipQuestion, fixedValue: "Yes" },
      { matcher: isCriminalHistoryQuestion, fixedValue: "No" },
      { matcher: isGenderQuestion, profileKey: "eeoGender" },
      { matcher: isRaceEthnicityQuestion, profileKey: "eeoRaceEthnicity" },
      { matcher: isVeteranStatusQuestion, profileKey: "eeoVeteranStatus" },
      { matcher: isDisabilityStatusQuestion, profileKey: "eeoDisabilityStatus" },
      { matcher: isAgeEligibilityQuestion, profileKey: null, fixedValue: "yes" } // no profile lookup -- always "yes"
    ];

    for (let iteration = 0; iteration < 30; iteration += 1) {
      const freshQuestions = snapshotPage().filter((snapshotEntry) => snapshotEntry.type === "question");
      const entry = freshQuestions.find((candidate) => {
        return !handledQuestionKeys.has(questionEntryKey(candidate));
      });

      if (!entry) {
        break;
      }

      const optionLabels = entry.options.map((option) => getOptionLabel(option));
      handledQuestionKeys.add(questionEntryKey(entry));

      if (!entry.required) {
        logTrace(`Skipped optional question "${entry.label}" (button/radio group).`);
        continue;
      }

      const rule = QUESTION_RULES.find((candidate) => candidate.matcher(entry.label));
      let wantedValue = rule ? rule.fixedValue || resolveProfileValue(profile, rule.profileKey) : "";

      if (!rule) {
        flaggedFields.push({
          label: entry.label,
          reason: `${entry.label} -- unknown radio/button questions are outside the question agent's two supported formats`
        });
        await pushActivityStep(
          "select",
          entry.label,
          "error",
          "unknown radio/button question; the agent handles only open text and dropdowns"
        );
        logTrace(`Flagged question "${entry.label}" -- unknown option groups do not invoke the question agent.`);
        continue;
      }

      if (!hasSavedAnswer(wantedValue)) {
        flaggedFields.push({ label: entry.label, reason: `${entry.label} -- no safe answer was available` });
        logTrace(`Flagged question "${entry.label}" -- no safe answer was available.`);
        continue;
      }

      // Verify the container is still live immediately before clicking into it -- same reasoning as
      // the field loop's isElementStillActionable check above.
      if (!isElementStillActionable(entry.element)) {
        flaggedFields.push({
          label: entry.label,
          reason: `${entry.label} -- this question became unavailable before the sweep could answer it; please check it manually`
        });
        await pushActivityStep("select", entry.label, "error", "question became unavailable before we could answer it");
        logTrace(`Flagged question "${entry.label}" -- no longer actionable by the time the sweep reached it.`);
        continue;
      }

      const wantedValues = Array.isArray(wantedValue) ? wantedValue : [wantedValue];
      const supportsMultiple = wantedValues.length === 1 || entry.options.every((option) =>
        option.matches?.("input[type='checkbox'], [role='checkbox']") ||
        Boolean(option.querySelector?.("input[type='checkbox'], [role='checkbox']"))
      );
      const clickedOptions = [];
      if (supportsMultiple) {
        for (const value of wantedValues) {
          const clicked = clickOptionMatchingText(entry.options, buildOptionMatcher(value));
          if (clicked) clickedOptions.push(clicked);
        }
      }
      const confirmed = supportsMultiple && clickedOptions.length === wantedValues.length &&
        (await Promise.all(clickedOptions.map((option) => isOptionConfirmedSelected(option)))).every(Boolean);

      if (confirmed) {
        filledFields.push({ label: entry.label, value: reportedProfileValue(rule.profileKey, wantedValue) });
        await pushActivityStep(
          "select",
          entry.label,
          "success",
          profileAnswerObservation(rule.profileKey, `selected "${wantedValue}"`)
        );
        logTrace(`Answered question "${entry.label}" from its mapped profile value (confirmed selected).`);
        await waitForSettle();
      } else if (clickedOptions.length > 0) {
        flaggedFields.push({
          label: entry.label,
          reason: `${entry.label} -- the saved profile answer was clicked, but the site did not confirm every selection`
        });
        await pushActivityStep("select", entry.label, "error", "saved profile answer was not fully verified");
        logTrace(`Flagged question "${entry.label}" -- its mapped profile answer was not fully verified.`);
      } else {
        flaggedFields.push({ label: entry.label, reason: `${entry.label} -- the saved profile answer did not map safely to the offered options` });
        await pushActivityStep("select", entry.label, "error", "saved profile answer did not match the offered options");
        logTrace(`Flagged question "${entry.label}" -- its mapped profile answer did not match the offered options.`);
      }
    }

    // Custom dropdown widgets expose their real options only after opening. Read those options, use a
    // deterministic fixed rule where one exists, otherwise ask the bounded question agent to choose
    // one observed option, then click and verify locally. Never types into the widget or invents an
    // option that was not actually offered.
    const DROPDOWN_RULES = [
      { matcher: isReferralSourceQuestion, fixedValue: "Other" }
    ];

    const handledDropdownKeys = new Set(prehandledDropdownLabels);
    for (let iteration = 0; iteration < 30; iteration += 1) {
      const freshDropdowns = snapshotPage().filter((snapshotEntry) => snapshotEntry.type === "dropdown");
      const entry = freshDropdowns.find((candidate) => !handledDropdownKeys.has(candidate.label));

      if (!entry) {
        break;
      }

      handledDropdownKeys.add(entry.label);

      if (!entry.required) {
        logTrace(`Skipped optional question "${entry.label}" (custom dropdown).`);
        continue;
      }

      // A long full-sentence question can be legitimate (sponsorship is commonly 100+ characters),
      // but long unclassified wrapper text is still likely a false match from getElementLabel's nearby-
      // text fallback. Allow classified questions up to a hard cap; skip everything else over 60.
      const dropdownMapping = inferGenericFieldMapping(entry.label, pageContext);
      if (entry.label.length > 240 || (entry.label.length > 60 && !dropdownMapping)) {
        logTrace(`Skipped a custom dropdown -- its ${entry.label.length}-character label did not look like one bounded application question.`);
        continue;
      }

      const rule = DROPDOWN_RULES.find((candidate) => candidate.matcher(entry.label));
      let wantedValue = rule?.fixedValue ||
        (dropdownMapping?.action === "fixed" ? dropdownMapping.value : "") ||
        (dropdownMapping?.action === "map" && dropdownMapping.profileKey !== "availableStartDate"
          ? resolveProfileValue(profile, dropdownMapping.profileKey)
          : "");
      const existingWorkdayValue = isWorkday ? getMeaningfulExistingWorkdayDropdownValue(entry.element) : "";
      const existingValueIsAcceptable = existingWorkdayValue && !hasExplicitWorkdayFieldError(entry.element) && (
        !hasSavedAnswer(wantedValue) ||
        (Array.isArray(wantedValue) ? wantedValue : [wantedValue]).every((value) =>
          buildOptionMatcher(value)(existingWorkdayValue)
        )
      );

      if (existingValueIsAcceptable) {
        const menuClosed = await closeWorkdayDropdownMenu(entry.element);
        if (!menuClosed) {
          flaggedFields.push({
            label: entry.label,
            reason: `${entry.label} -- already contains "${existingWorkdayValue}", but its open option menu could not be closed`
          });
          await pushActivityStep("select", entry.label, "error", "value is already correct, but the open menu could not be closed");
          logTrace(`Flagged Workday dropdown "${entry.label}" -- its value is correct, but its option menu remained open.`);
          continue;
        }
        logTrace(`Skipped Workday dropdown "${entry.label}" -- already set to "${existingWorkdayValue}" and closed.`);
        continue;
      }

      // Verify the dropdown trigger is still live immediately before opening it -- same reasoning
      // as the field/question loops' isElementStillActionable checks above.
      if (!isElementStillActionable(entry.element)) {
        flaggedFields.push({
          label: entry.label,
          reason: `${entry.label} -- this dropdown became unavailable before the sweep could select from it; please check it manually`
        });
        await pushActivityStep("select", entry.label, "error", "dropdown became unavailable before we could select from it");
        logTrace(`Flagged custom dropdown "${entry.label}" -- no longer actionable by the time the sweep reached it.`);
        continue;
      }

      logTrace(`Opening custom dropdown "${entry.label}" to read its real options...`);
      const candidateOptions = await openDropdownAndReadOptions(entry.element);
      const optionLabels = candidateOptions.map((option) => getOptionLabel(option));
      const offeredOptionCount = countOfferedOptions(optionLabels);
      let generateStepId = null;
      const sensitiveProfileAnswer = dropdownMapping?.action === "map" && isSensitiveProfileKey(dropdownMapping.profileKey);

      if (!hasSavedAnswer(wantedValue) && !sensitiveProfileAnswer) {
        generateStepId = await pushActivityStep(
          "question_agent",
          entry.label,
          "pending",
          `Agent started; reviewing ${offeredOptionCount} offered options...`
        );
        const decision = await resolveWithQuestionAgent(entry.label, "custom_dropdown", optionLabels);
        wantedValue = decision?.action === "choose_option" ? decision.value : "";
      }

      if (!hasSavedAnswer(wantedValue)) {
        flaggedFields.push({ label: entry.label, reason: `${entry.label} -- no safe offered option was available` });
        if (generateStepId) {
          await resolveActivityStep(generateStepId, "error", "could not choose an offered option");
        }
        logTrace(`Flagged custom dropdown "${entry.label}" -- no safe offered option was available.`);
        continue;
      }

      const wantedValues = Array.isArray(wantedValue) ? wantedValue : [wantedValue];
      if (wantedValues.length > 1 && !/\bselect all|all that apply|multiple\b/i.test(entry.label)) {
        flaggedFields.push({ label: entry.label, reason: `${entry.label} -- this dropdown accepts one answer, but multiple answers are saved` });
        await pushActivityStep("select", entry.label, "error", "single-answer dropdown cannot accept all saved answers");
        continue;
      }

      let allConfirmed = true;
      let clickedAny = false;
      let selectionError = "";
      let currentDropdownElement = entry.element;
      for (let valueIndex = 0; valueIndex < wantedValues.length; valueIndex += 1) {
        const value = wantedValues[valueIndex];
        const currentOptions = valueIndex === 0
          ? candidateOptions
          : await openDropdownAndReadOptions(currentDropdownElement);
        const valueMatcher = buildOptionMatcher(value);
        const selection = await selectOpenedDropdownOption(currentOptions, valueMatcher);
        selectionError = selection?.error || "";
        await waitForSettle({ quietMs: 150, maxMs: 1000, pollMs: 50 });

        // Workday can replace the entire field subtree after an option click. Verify the current
        // dropdown from a fresh snapshot so a committed selected-item chip is not missed merely
        // because the pre-click container was detached.
        const refreshedEntry = snapshotPage()
          .filter((snapshotEntry) => snapshotEntry.type === "dropdown")
          .find((snapshotEntry) => snapshotEntry.label === entry.label);
        currentDropdownElement = refreshedEntry?.element || currentDropdownElement;

        const menuClosed = await closeWorkdayDropdownMenu(currentDropdownElement, currentOptions);
        const displayedValueConfirmed = await isDropdownValueConfirmed(currentDropdownElement, value);
        const confirmed = menuClosed && (Boolean(selection.confirmed) || displayedValueConfirmed);
        clickedAny = clickedAny || Boolean(selection.clickedOption) || Boolean(selection.interacted);
        if (!confirmed) {
          allConfirmed = false;
          break;
        }
      }

      if (allConfirmed) {
        filledFields.push({
          label: entry.label,
          value: reportedProfileValue(dropdownMapping?.profileKey, wantedValue)
        });
        if (generateStepId) {
          await resolveActivityStep(
            generateStepId,
            "success",
            `reviewed ${offeredOptionCount} offered options; selected one`
          );
        } else {
          await pushActivityStep(
            "select",
            entry.label,
            "success",
            profileAnswerObservation(dropdownMapping?.profileKey, `selected "${wantedValue}"`)
          );
        }
        logTrace(`Selected a verified answer for custom dropdown "${entry.label}".`);
        await waitForSettle();
      } else {
        flaggedFields.push({
          label: entry.label,
          reason: selectionError || (clickedAny
            ? `${entry.label} -- clicked a saved answer, but could not confirm the site registered it`
            : `${entry.label} -- no offered option matched the saved answer`)
        });
        if (generateStepId) {
          await resolveActivityStep(generateStepId, "error", selectionError || "the selected option could not be verified");
        } else {
          await pushActivityStep("select", entry.label, "error", selectionError || "the selected option could not be verified");
        }
        logTrace(`Flagged custom dropdown "${entry.label}" -- option selection was not verified.`);
      }
    }

    // Essay questions and unrecognized required text fields are now full-auto: the bounded question
    // agent may return answer_text, but the local executor still re-reads the field, fills one value,
    // and verifies it before the answer stops blocking submission. Missing/invalid/unverifiable agent
    // answers remain flagged and therefore keep the submit guard closed.
    let unresolvedAgentAnswerFields = 0;
    logTrace(`Resolving ${pendingAnswerFields.length} essay/unrecognized-required field(s) via LLM.`);
    for (const pending of pendingAnswerFields) {
      logTrace(`Calling LLM for "${pending.label}"...`);
      // "pending" here is a genuine async gap (a real network call), unlike the fill/select/click
      // steps above which resolve fast enough to log only their outcome -- this is the one place in
      // the sweep where a live "in progress" state is worth showing rather than just a final result.
      const stepId = await pushActivityStep(
        "question_agent",
        pending.label,
        "pending",
        "Agent started; using resume and web context for an open-text answer..."
      );
      const decision = await resolveWithQuestionAgent(pending.label, pending.fieldKind || "text");
      const answer = decision?.action === "answer_text" ? decision.value : "";

      if (!answer) {
        unresolvedAgentAnswerFields += 1;
        flaggedFields.push({
          label: pending.label,
          reason: `${pending.label} -- no answer available from your saved profile, resume, or public web context; please fill in manually`
        });
        await resolveActivityStep(stepId, "error", "no answer available from your saved profile, resume, or public web context");
        logTrace(`Flagged "${pending.label}" -- no LLM/resume-derived answer available.`);
        continue;
      }

      // The LLM call above is the slowest step in the whole sweep -- re-verify this field (captured
      // back in the main field loop) is still live before writing into it, same reasoning as every
      // other isElementStillActionable check in this file, but even more likely to matter here given
      // how much more time/DOM churn has had a chance to pass.
      const freshEntry = snapshotPage().find(
        (entry) => entry.type === "field" && entry.label === pending.label && !(entry.element.value || "").trim()
      );
      const targetElement = freshEntry?.element || pending.element;

      if (!isElementStillActionable(targetElement)) {
        unresolvedAgentAnswerFields += 1;
        flaggedFields.push({
          label: pending.label,
          reason: `${pending.label} -- drafted an answer, but this field became unavailable before it could be filled; please fill in manually`
        });
        await resolveActivityStep(stepId, "error", "field became unavailable before the drafted answer could be entered");
        logTrace(`Flagged "${pending.label}" -- LLM drafted an answer, but the field is no longer actionable.`);
        continue;
      }

      const write = await enterTextValue(targetElement, answer);
      const verifiedElement = findCurrentFilledField(targetElement, pending.label, pending.fieldKind || "text", answer);
      const invalid = !write.ok || !verifiedElement || (await isFieldNowInvalid(verifiedElement));

      if (invalid) {
        unresolvedAgentAnswerFields += 1;
        flaggedFields.push({
          label: pending.label,
          reason: `${pending.label} -- agent answer didn't pass this field's validation (for example, a length limit)`
        });
        await resolveActivityStep(stepId, "error", "agent answer failed the field's own validation");
        logTrace(`Flagged "${pending.label}" -- question-agent answer failed validation.`);
        continue;
      }

      let verified = hasExpectedFieldValue(verifiedElement, answer);
      if (!verified) {
        const outcome = await verifyAndRetryTextFill(targetElement, pending.label, pending.fieldKind || "text", answer);
        verified = outcome.ok;
      }

      if (!verified) {
        unresolvedAgentAnswerFields += 1;
        flaggedFields.push({ label: pending.label, reason: `${pending.label} -- agent answer could not be verified after input` });
        await resolveActivityStep(stepId, "error", "agent answer did not persist after input");
        logTrace(`Flagged "${pending.label}" -- question-agent answer did not persist.`);
        continue;
      }

      filledFields.push({ label: pending.label, value: answer });
      filledFieldElements.push({ element: verifiedElement, label: pending.label, value: answer });
      await resolveActivityStep(stepId, "success", `Question answered with ${countAnswerWords(answer)} words.`);
      logTrace(`Filled "${pending.label}" via resume-grounded question agent (verified).`);
    }

    const hadPendingAnswerFields = unresolvedAgentAnswerFields > 0;

    // Resume file input -- a native <input type=file>'s .files can be set from page JS via the
    // standard DataTransfer trick (constructing a real File object and assigning it), so this needs
    // no elevated permission or filesystem path, just the file's bytes (already read into a data:
    // URL and stored when the user picked it in the side panel).
    let needsResumeUpload = false;
    let resumeUploaded = false;
    if (fileEntry) {
      needsResumeUpload = true;
      const resumeInput = fileEntry.element;

      // Just isConnected, not the fuller isElementStillActionable -- findResumeFileInput()'s own
      // comment explains why visibility can't be required here (Workday-style dropzones hide the
      // real input on purpose), so only guard against the node having been removed outright.
      if (profile.resumeFileDataUrl && resumeInput.isConnected) {
        try {
          const blob = await (await fetch(profile.resumeFileDataUrl)).blob();
          const file = new File([blob], profile.resumeFileName || "resume", {
            type: profile.resumeFileType || blob.type
          });
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          resumeInput.files = dataTransfer.files;
          resumeInput.dispatchEvent(new Event("input", { bubbles: true }));
          resumeInput.dispatchEvent(new Event("change", { bubbles: true }));
          resumeUploaded = true;
        } catch (_error) {
          resumeUploaded = false;
        }
      }

      if (!resumeUploaded) {
        flaggedFields.push({
          label: "Resume upload",
          reason: profile.resumeFileDataUrl
            ? "Found a resume upload field, but attaching the file didn't work -- attach it manually."
            : "Found a resume upload field, but no resume is set in your autofill profile -- attach it manually."
        });
        await pushActivityStep(
          "upload",
          "Resume upload",
          "error",
          profile.resumeFileDataUrl ? "attaching the file didn't work" : "no resume saved in profile"
        );
        logTrace(`Flagged resume upload -- ${profile.resumeFileDataUrl ? "attach attempt failed" : "no resume saved in profile"}.`);
      } else {
        await pushActivityStep("upload", "Resume upload", "success", `attached "${profile.resumeFileName || "resume"}"`);
        logTrace("Resume attached via DataTransfer.");
        await waitForSettle();
      }
    } else {
      logTrace("No resume upload field found on this page.");
    }

    // Nothing to fill, flag, or upload on this page at all -- it's likely a job description/landing
    // page rather than the application form itself. Look for a button that starts the application
    // (the same allowlist findGenericSubmitButton uses for the final submit already covers "Apply
    // Now"-style labels) and click it, rather than reporting an empty, unhelpful result. This only
    // gets the user INTO the form. Unknown sites still stop after that click; Workday progress labels
    // are withheld here so background.js's bounded multi-page controller can re-read and click them
    // under its page/no-progress guards instead.
    let clickedApplyEntry = false;
    let applyEntryLabel = null;

    if (filledFields.length === 0 && flaggedFields.length === 0) {
      const entryButton = findGenericSubmitButton();
      const entryButtonLabel = entryButton ? getActionLabel(entryButton) : "";
      const safeEntryButton =
        entryButton && !(isWorkday && getWorkdayProgressActionKind(entryButtonLabel));

      if (safeEntryButton) {
        applyEntryLabel = entryButtonLabel;
        const urlBeforeClick = window.location.href;
        safeEntryButton.click();
        clickedApplyEntry = true;

        // Verify the click actually did something rather than assuming success -- see actions.js's
        // waitForSettle comment. A URL change counts as "changed" even if it races the observer's
        // disconnect (e.g. a full navigation tearing down the page before the next poll tick).
        const settleResult = await waitForSettle();
        const pageChanged = settleResult.mutated || window.location.href !== urlBeforeClick;

        if (pageChanged) {
          await pushActivityStep("click", applyEntryLabel, "success", "page changed after clicking");
          logTrace(`Nothing to fill on this page -- clicked "${applyEntryLabel}" to start the application; the page changed afterward.`);
        } else {
          flaggedFields.push({
            label: applyEntryLabel,
            reason: `Clicked "${applyEntryLabel}" to start the application, but the page doesn't appear to have changed -- please check it worked.`
          });
          await pushActivityStep("click", applyEntryLabel, "error", "no page change detected after clicking");
          logTrace(`Clicked "${applyEntryLabel}", but no page change was detected after ${settleResult.elapsedMs}ms -- flagging for review.`);
        }
      } else {
        logTrace("Nothing to fill on this page, and no entry button found either.");
      }
    }

    // Re-verify every text/select field recorded as filled still holds that value, now that every
    // other action in this sweep (later fields, question clicks, dropdown selection, LLM-answer
    // fills, the resume upload, an apply-entry click) has run and had a chance to trigger a
    // re-render. actions.js's setNativeElementValue fix (see its comment) prevents most of this at
    // the source, but this pass is the safety net for what that fix can't cover -- the site's own
    // React (or similar) replacing the element outright rather than just reverting its value, or later
    // clearing a value that DID register correctly at fill time. Escalates through the same two tiers
    // as the main field loop above (plain re-fill, then the framework-compatible retry for text-like
    // fields) exactly once each, never looping; a value that still won't stick is moved from filled to
    // flagged rather than silently reported as a success.
    function demoteFilledFieldToFlagged(label, value, reason) {
      const filledIndex = filledFields.findIndex((entry) => entry.label === label && entry.value === value);
      if (filledIndex !== -1) {
        filledFields.splice(filledIndex, 1);
      }
      flaggedFields.push({ label, reason });
    }

    for (const { element, label, value, reportedValue = value } of filledFieldElements) {
      if (hasExpectedFieldValue(element, value)) {
        continue;
      }

      if (!element.isConnected) {
        // Diagnostic tag "element_detached" -- distinct from the plain-cleared case below: the DOM
        // node we filled is gone entirely (a re-render replaced its subtree, or navigation tore down
        // the page), not merely reset. No amount of re-filling the SAME reference can help here.
        demoteFilledFieldToFlagged(
          label,
          reportedValue,
          `${label} -- was filled, but the page replaced this field before the sweep finished (diagnostic: element_detached); please re-check and fill it manually`
        );
        // A new step, not a rewrite of the earlier success -- the field really was filled at the time,
        // then genuinely became unfilled afterward, so the log should show both, in order, same as
        // Pie's own layered defense would surface a later correction rather than erasing history.
        await pushActivityStep("verify", label, "error", "the page replaced this field after it was filled (diagnostic: element_detached)");
        logTrace(`Flagged "${label}" -- element no longer attached to the page after later actions (diagnostic: element_detached).`);
        continue;
      }

      // Still on the page but the value reverted -- try once more now that every later action in this
      // sweep has settled, rather than assuming the first fill's failure to stick is final.
      const isSelect = element.tagName?.toLowerCase() === "select";

      let workdayRefill = null;
      if (isSelect) {
        selectMatchingOptions(element, value);
      } else if (isWorkday) {
        workdayRefill = await enterTextValue(element, value);
      } else {
        fillTextField(element, value);
      }

      if ((!workdayRefill || workdayRefill.ok) && hasExpectedFieldValue(element, value)) {
        await pushActivityStep("verify", label, "success", "re-filled -- a later step in this sweep had cleared its value");
        logTrace(`Re-filled "${label}" -- a later step in this sweep had cleared its value.`);
        continue;
      }

      // Escalate to the framework-compatible retry exactly once more before giving up -- never for
      // select (see actions.js's retryFrameworkTextCommit and loop.js's dropdown handling: this
      // fallback types free text, which is never the right interaction for a control that only
      // accepts one of its own real options).
      if (!isSelect && !isWorkday) {
        logTrace(`"${label}" -- still didn't stick after a plain re-fill; retrying through the field's framework events...`);
        const fallback = retryFrameworkTextCommit(element, value);

        if (fallback.ok && hasExpectedFieldValue(element, value)) {
          await pushActivityStep(
            "verify",
            label,
            "success",
            "re-filled via framework-compatible retry -- a later step in this sweep had cleared its value"
          );
          logTrace(`Re-filled "${label}" via framework-compatible retry -- a later step in this sweep had cleared its value.`);
          continue;
        }
      }

      // Diagnostic: "value_cleared" (back to empty) points at the field's own controlled-input state
      // resetting it; "value_replaced" (holds something else entirely) points more at the site's own
      // logic -- a dependent-field default, or its own autofill -- actively overwriting what we wrote,
      // not just failing to register it.
      const currentValue = element.value || "";
      const sensitiveValue = reportedValue === "Saved profile answer";
      demoteFilledFieldToFlagged(
        label,
        reportedValue,
        `${label} -- was filled, but its value didn't persist after later steps in the form (diagnostic: ${currentValue ? "value_replaced" : "value_cleared"}); please re-check`
      );
      await pushActivityStep(
        "verify",
        label,
        "error",
        sensitiveValue
          ? "saved profile answer did not persist after later form steps"
          : currentValue ? `reverted to "${currentValue}" after being filled` : "reverted to empty after being filled"
      );
      logTrace(
        sensitiveValue
          ? `Flagged "${label}" -- saved profile answer did not persist after a second verified attempt.`
          : `Flagged "${label}" -- value did not persist even after a second fill attempt${
              isSelect ? "" : ", including a framework-compatible retry,"
            } (diagnostic: ${currentValue ? `now holds "${currentValue}" instead` : "now empty"}).`
      );
    }

    logTrace(
      `Done. Filled ${filledFields.length}, flagged ${flaggedFields.length}${clickedApplyEntry ? ", clicked apply-entry button" : ""}.`
    );
    const needsAttention = flaggedFields.length > 0 || hadPendingAnswerFields;
    const keepActivityCycleOpen = Boolean(activityContext.keepActivityCycleOpen) && !needsAttention;
    activityCycle.status = needsAttention ? "attention" : keepActivityCycleOpen ? "running" : "success";
    activityCycle.outcome = needsAttention ? "Needs Attention" : keepActivityCycleOpen ? "Applying" : "Complete";
    if (keepActivityCycleOpen) {
      delete activityCycle.completedAt;
    } else {
      activityCycle.completedAt = Date.now();
    }
    await persistActivity(keepActivityCycleOpen);

    const finalSnapshot = snapshotPage();
    const pageFingerprint = [
      window.location.pathname || "",
      ...finalSnapshot.map((entry) => `${entry.type}:${entry.label}`)
    ].join("|");

    return {
      ok: true,
      data: {
        filledCount: filledFields.length,
        filledFields,
        flaggedFields,
        hadPendingAnswerFields,
        needsResumeUpload,
        resumeUploaded,
        clickedApplyEntry,
        applyEntryLabel,
        pageFingerprint,
        observedCandidateProfile,
        repairedRejectedWorkdayFieldCount,
        trace,
        pageTitle: document.title,
        hostname: window.location.hostname
      }
    };
  }

  Object.assign(GA, {
    runGenericAutofill,
    describeEnteredValue,
    buildTextFillRetryOutcome,
    findNextUnhandledFieldEntry,
    hasMeaningfulExistingFieldValue,
    getMeaningfulExistingWorkdayDropdownValue,
    isMappedApplicationQuestion
  });
})();
