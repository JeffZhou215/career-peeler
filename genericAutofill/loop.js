// The main snapshot -> decide -> act loop, roughly analogous to Pie's runAgentLoop -- except the
// "decide" step here is deterministic pattern classification (classify.js), not an LLM choosing
// actions turn by turn. See snapshot.js's comment for why.
(function () {
  const GA = window.__careerPeelerGA;
  const {
    getActionLabel,
    isAgeEligibilityQuestion,
    isPreviousEmploymentQuestion,
    isWorkAuthorizationQuestion,
    isVisaSponsorshipQuestion,
    isReferralSourceQuestion,
    isGenderQuestion,
    isRaceEthnicityQuestion,
    isVeteranStatusQuestion,
    isDisabilityStatusQuestion,
    isElementStillActionable,
    snapshotPage,
    inferGenericFieldMapping,
    resolveProfileValue,
    buildOptionMatcher,
    selectMatchingOption,
    fillTextField,
    isFieldNowInvalid,
    hasExpectedFieldValue,
    traceElementWrites,
    typeViaKeyboardFallback,
    clickOptionMatchingText,
    isOptionConfirmedSelected,
    openDropdownAndSelectOption,
    waitForSettle,
    askLlmForAnswer,
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

  // Pure: picks the next field entry the sequential loop below hasn't decided about yet. Kept
  // separate from the snapshotPage()/DOM side of that loop (which does need a real page) so the
  // selection logic itself -- the actual behavior change this session's sequential rewrite is about --
  // is independently testable in the VM-sandbox harness with plain objects, the same boundary
  // buildTextFillRetryOutcome already sits on. Module-level and exported for that reason.
  function findNextUnhandledFieldEntry(fieldEntries, handledKeys, keyFn) {
    return fieldEntries.find((entry) => !handledKeys.has(keyFn(entry)));
  }

  // Pure: turns the settle/fallback results into the field loop's outcome shape. Kept separate from
  // the async waitForSettle/typeViaKeyboardFallback calls that produce those inputs (which DO need a
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
        ? `${label} -- this site's form didn't accept the value even via keyboard input; please fill it manually`
        : `${label} -- couldn't fill this field programmatically, and the keyboard-input fallback failed (${fallback.error}); please fill it manually`,
      observation: fallback.ok ? "value still didn't stick, even via keyboard input" : `keyboard-input fallback failed (${fallback.error})`
    };
  }

  async function runGenericAutofill(userProfile) {
    const profile = userProfile || {};
    const filledFields = [];
    const flaggedFields = [];
    // (element, label, value) for every text/select field filled below -- kept separate from
    // filledFields (which flows out through sendResponse/chrome.runtime messaging, and DOM elements
    // can't be structured-cloned) so the end-of-sweep verification pass can re-check each one's live
    // value against what was actually written, after everything else in this sweep has run.
    const filledFieldElements = [];
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

    // Real-time, structured companion to the trace above -- one entry per actual action the sweep
    // takes (not every skip/diagnostic logTrace covers), pushed to chrome.storage.local as it happens
    // so the side panel can render a live activity log the same way it already renders scan status
    // (see useScanStatus.js's chrome.storage.onChanged listener). Content scripts have direct
    // chrome.storage access, so this needs no message relay through background.js -- unlike Pie, which
    // streams steps over a chrome.runtime.connect() port because its agent loop runs in a different
    // context; this repo already has a working storage-based live-update mechanism, so this reuses
    // that instead of introducing ports.
    const GENERIC_AUTOFILL_ACTIVITY_KEY = "appleCareersGenericAutofillActivity";
    const activitySteps = [];
    let activityStepId = 0;

    async function persistActivity(running) {
      await chrome.storage.local
        .set({ [GENERIC_AUTOFILL_ACTIVITY_KEY]: { running, steps: activitySteps, updatedAt: Date.now() } })
        .catch(() => {}); // best-effort UI nicety -- must never break the sweep itself
    }

    async function pushActivityStep(tool, label, status, observation) {
      const step = { id: ++activityStepId, tool, label, status, observation };
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
    // Escalates to the keyboard-input fallback (see actions.js's typeViaKeyboardFallback) only if the
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
          logTrace(`"${label}" (${kind}) -- still didn't stick after settling; retrying via keyboard input...`);
          fallback = await typeViaKeyboardFallback(element, wantedValue);
          await waitForSettle();
          fallbackFinalOk = hasExpectedFieldValue(element, wantedValue);
        }

        const outcome = buildTextFillRetryOutcome(label, { settledOk, fallback, fallbackFinalOk });

        logTrace(
          outcome.ok
            ? settledOk
              ? `"${label}" (${kind}) -- value was present after all once the page settled.`
              : `Filled "${label}" (${kind}) with "${wantedValue}" via keyboard-input fallback.`
            : fallback.ok
              ? `Flagged "${label}" (${kind}) -- keyboard-input fallback ran, but the value still didn't stick.`
              : `Flagged "${label}" (${kind}) -- keyboard-input fallback failed (${fallback.error}).`
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
      const { element, label, fieldKind: kind, required } = entry;

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
        if (isAgeEligibilityQuestion(label)) {
          if (!element.checked) {
            element.click();
          }
          filledFields.push({ label, value: "Yes" });
          await pushActivityStep("click", label, "success", 'checked "Yes"');
          logTrace(`Checked "${label}" (age eligibility).`);
          return { mutated: true };
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

      if ((element.value || "").trim()) {
        logTrace(`Skipped "${label}" (${kind}) -- already has a value.`);
        return { mutated: false }; // already filled by the site itself, don't overwrite
      }

      const mapping = inferGenericFieldMapping(label);

      if (!mapping) {
        if (required && TEXT_LIKE_KINDS.includes(kind)) {
          pendingAnswerFields.push({ element, label });
          logTrace(`"${label}" (${kind}) -- unrecognized but required; queued for LLM answer.`);
        } else if (required) {
          flaggedFields.push({ label, reason: `${label} -- unrecognized required field` });
          logTrace(`Flagged "${label}" (${kind}) -- unrecognized required field.`);
        } else {
          logTrace(`Skipped "${label}" (${kind}) -- unrecognized, not required.`);
        }
        return { mutated: false };
      }

      if (mapping.action === "essay") {
        pendingAnswerFields.push({ element, label });
        logTrace(`"${label}" -- detected as an essay question; queued for LLM answer.`);
        return { mutated: false };
      }

      const wantedValue = mapping.action === "fixed" ? mapping.value : resolveProfileValue(profile, mapping.profileKey);

      if (!wantedValue) {
        if (required) {
          flaggedFields.push({ label, reason: `${label} -- no value saved in your autofill profile` });
          logTrace(`Flagged "${label}" -- matched profile.${mapping.profileKey}, but it's empty.`);
        } else {
          logTrace(`Skipped "${label}" -- matched profile.${mapping.profileKey}, but it's empty and not required.`);
        }
        return { mutated: false };
      }

      if (kind === "select") {
        if (selectMatchingOption(element, wantedValue)) {
          filledFields.push({ label, value: wantedValue });
          filledFieldElements.push({ element, label, value: wantedValue });
          await pushActivityStep("select", label, "success", `selected "${wantedValue}"`);
          logTrace(`Filled "${label}" (select) with "${wantedValue}".`);
          return { mutated: true };
        }
        flaggedFields.push({ label, reason: `${label} -- could not find a matching option for "${wantedValue}"` });
        await pushActivityStep("select", label, "error", `no option matched "${wantedValue}"`);
        logTrace(`Flagged "${label}" (select) -- no option matched "${wantedValue}".`);
        return { mutated: false };
      }

      fillTextField(element, wantedValue);

      if (await isFieldNowInvalid(element)) {
        flaggedFields.push({ label, reason: `${label} -- the value from your profile didn't pass this field's validation` });
        await pushActivityStep("type", label, "error", "filled, but failed the field's own validation");
        logTrace(`Flagged "${label}" (${kind}) -- filled but failed the field's own validation.`);
        return { mutated: true }; // still wrote a value, even though it's flagged -- worth settling before the next field
      }

      if (!hasExpectedFieldValue(element, wantedValue)) {
        const outcome = await verifyAndRetryTextFill(element, label, kind, wantedValue); // settles internally

        if (outcome.ok) {
          filledFields.push({ label, value: wantedValue });
          filledFieldElements.push({ element, label, value: wantedValue });
          await pushActivityStep(
            "type",
            label,
            "success",
            outcome.viaFallback ? `${describeEnteredValue(kind, wantedValue)} (via keyboard fallback)` : describeEnteredValue(kind, wantedValue)
          );
        } else {
          flaggedFields.push({ label, reason: outcome.reason });
          await pushActivityStep("type", label, "error", outcome.observation);
        }
        return { mutated: false };
      }

      filledFields.push({ label, value: wantedValue });
      filledFieldElements.push({ element, label, value: wantedValue });
      await pushActivityStep("type", label, "success", describeEnteredValue(kind, wantedValue));
      logTrace(`Filled "${label}" (${kind}) with "${wantedValue}".`);
      return { mutated: true }; // the common-case immediate success -- the path that previously had no settle-wait at all
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
      { matcher: isWorkAuthorizationQuestion, profileKey: "workAuthorized" },
      { matcher: isVisaSponsorshipQuestion, profileKey: "requiresSponsorship" },
      { matcher: isGenderQuestion, profileKey: "eeoGender" },
      { matcher: isRaceEthnicityQuestion, profileKey: "eeoRaceEthnicity" },
      { matcher: isVeteranStatusQuestion, profileKey: "eeoVeteranStatus" },
      { matcher: isDisabilityStatusQuestion, profileKey: "eeoDisabilityStatus" },
      { matcher: isAgeEligibilityQuestion, profileKey: null, fixedValue: "yes" }, // no profile lookup -- always "yes"
      { matcher: isPreviousEmploymentQuestion, profileKey: null, fixedValue: "no" } // no profile lookup -- always "no"
    ];

    for (const entry of questionEntries) {
      const rule = QUESTION_RULES.find((candidate) => candidate.matcher(entry.label));

      if (!rule) {
        flaggedFields.push({ label: entry.label, reason: `${entry.label} -- unrecognized question, please answer manually` });
        logTrace(`Flagged unrecognized question "${entry.label}".`);
        continue;
      }

      const wantedValue = rule.fixedValue || profile[rule.profileKey];

      if (!wantedValue) {
        flaggedFields.push({ label: entry.label, reason: `${entry.label} -- no value saved in your autofill profile` });
        logTrace(`Flagged question "${entry.label}" -- matched profile.${rule.profileKey}, but it's empty.`);
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

      const matcher = buildOptionMatcher(wantedValue);
      const clickedOption = clickOptionMatchingText(entry.options, matcher);
      const confirmed = clickedOption && (await isOptionConfirmedSelected(clickedOption));

      if (confirmed) {
        filledFields.push({ label: entry.label, value: wantedValue });
        await pushActivityStep("select", entry.label, "success", `selected "${wantedValue}"`);
        logTrace(`Answered question "${entry.label}" with "${wantedValue}" (confirmed selected).`);
      } else if (clickedOption) {
        flaggedFields.push({
          label: entry.label,
          reason: `${entry.label} -- clicked "${wantedValue}", but could not confirm the site registered it -- please check`
        });
        await pushActivityStep("select", entry.label, "error", `clicked "${wantedValue}", but couldn't confirm it registered`);
        logTrace(`Flagged question "${entry.label}" -- clicked "${wantedValue}" but selection unconfirmed.`);
      } else {
        flaggedFields.push({ label: entry.label, reason: `${entry.label} -- could not find a matching option for "${wantedValue}"` });
        await pushActivityStep("select", entry.label, "error", `no option matched "${wantedValue}"`);
        logTrace(`Flagged question "${entry.label}" -- no option matched "${wantedValue}".`);
      }
    }

    // Custom dropdown widgets (role=combobox/listbox) -- generally not auto-filled (see snapshot.js's
    // comment on why guessing at an unconfirmed widget's open/select interaction is riskier than just
    // flagging it), just detected and surfaced so nothing is silently invisible. DROPDOWN_RULES holds
    // the narrow exceptions worth the same open-then-verify pattern already used for button/radio-
    // group questions above (see actions.js's openDropdownAndSelectOption) -- same matcher/fixedValue
    // shape as QUESTION_RULES, so a future fixed-answer dropdown question is one more row here rather
    // than another special-cased branch. Never guesses a different option if the wanted one isn't
    // offered.
    const DROPDOWN_RULES = [{ matcher: isReferralSourceQuestion, fixedValue: "LinkedIn" }];

    for (const entry of dropdownEntries) {
      // getElementLabel() falls back to the closest wrapping label/fieldset/div/li/section's whole
      // innerText when there's no tightly-scoped label -- on a large, loosely-structured wrapper
      // that can grab way more than the actual field label. A real field label is short; anything
      // long here is more likely scooped-up page content than a genuine "Gender"-style label.
      if (entry.label.length > 60) {
        logTrace(`Skipped a custom dropdown -- label too long (${entry.label.length} chars) to be a real field label, likely a false match.`);
        continue;
      }

      const rule = DROPDOWN_RULES.find((candidate) => candidate.matcher(entry.label));

      if (rule) {
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

        logTrace(`Opening custom dropdown "${entry.label}" to look for a "${rule.fixedValue}" option...`);
        const { clickedOption, confirmed } = await openDropdownAndSelectOption(entry.element, buildOptionMatcher(rule.fixedValue));

        if (confirmed) {
          filledFields.push({ label: entry.label, value: rule.fixedValue });
          await pushActivityStep("select", entry.label, "success", `selected "${rule.fixedValue}"`);
          logTrace(`Selected "${rule.fixedValue}" for custom dropdown "${entry.label}".`);
        } else if (clickedOption) {
          flaggedFields.push({
            label: entry.label,
            reason: `${entry.label} -- clicked "${rule.fixedValue}", but could not confirm the site registered it -- please check`
          });
          await pushActivityStep("select", entry.label, "error", `clicked "${rule.fixedValue}", but couldn't confirm it registered`);
          logTrace(`Flagged custom dropdown "${entry.label}" -- clicked "${rule.fixedValue}" but selection unconfirmed.`);
        } else {
          flaggedFields.push({
            label: entry.label,
            reason: `${entry.label} -- opened the dropdown, but no "${rule.fixedValue}" option was found -- please select manually`
          });
          await pushActivityStep("select", entry.label, "error", `no "${rule.fixedValue}" option found after opening`);
          logTrace(`Flagged custom dropdown "${entry.label}" -- no "${rule.fixedValue}" option found after opening.`);
        }
        continue;
      }

      flaggedFields.push({
        label: entry.label,
        reason: `${entry.label} -- custom dropdown widget; not yet auto-filled, please select manually`
      });
      logTrace(`Flagged custom dropdown "${entry.label}".`);
    }

    // Essay questions and unrecognized required text fields -- try the LLM first, grounded in the
    // resume/profile summary saved in the side panel (see lib/core.js's generateFreeTextAnswer,
    // which already refuses to fabricate facts not present in that summary). If the LLM is disabled,
    // unconfigured, or has nothing it can answer from, the field is left blank and flagged for
    // review rather than interrupting the user with a popup -- sites like Workday already show their
    // own validation error for anything required that's missing, so there's nothing to ask for up
    // front. Filled fields still get flagged for review before submitting, mirroring content.js's
    // answerOpenTextQuestion/pausedForReview precedent of never auto-submitting over an answer that
    // hasn't been reviewed.
    const hadPendingAnswerFields = pendingAnswerFields.length > 0;
    logTrace(`Resolving ${pendingAnswerFields.length} essay/unrecognized-required field(s) via LLM.`);
    for (const pending of pendingAnswerFields) {
      logTrace(`Calling LLM for "${pending.label}"...`);
      // "pending" here is a genuine async gap (a real network call), unlike the fill/select/click
      // steps above which resolve fast enough to log only their outcome -- this is the one place in
      // the sweep where a live "in progress" state is worth showing rather than just a final result.
      const stepId = await pushActivityStep("generate", pending.label, "pending", "drafting an answer from your resume/profile...");
      const answer = await askLlmForAnswer(pending.label);

      if (!answer) {
        flaggedFields.push({
          label: pending.label,
          reason: `${pending.label} -- no answer available from your saved profile or resume; please fill in manually`
        });
        await resolveActivityStep(stepId, "error", "no answer available from your saved profile or resume");
        logTrace(`Flagged "${pending.label}" -- no LLM/resume-derived answer available.`);
        continue;
      }

      // The LLM call above is the slowest step in the whole sweep -- re-verify this field (captured
      // back in the main field loop) is still live before writing into it, same reasoning as every
      // other isElementStillActionable check in this file, but even more likely to matter here given
      // how much more time/DOM churn has had a chance to pass.
      if (!isElementStillActionable(pending.element)) {
        flaggedFields.push({
          label: pending.label,
          reason: `${pending.label} -- drafted an answer, but this field became unavailable before it could be filled; please fill in manually`
        });
        await resolveActivityStep(stepId, "error", "field became unavailable before the drafted answer could be entered");
        logTrace(`Flagged "${pending.label}" -- LLM drafted an answer, but the field is no longer actionable.`);
        continue;
      }

      fillTextField(pending.element, answer);
      const invalid = await isFieldNowInvalid(pending.element);
      flaggedFields.push({
        label: pending.label,
        reason: invalid
          ? `${pending.label} -- drafted an answer, but it didn't pass this field's validation (e.g. too long) -- please fix manually`
          : "LLM-drafted answer ready -- please review before submitting"
      });
      await resolveActivityStep(
        stepId,
        invalid ? "error" : "success",
        invalid ? "drafted an answer, but it failed the field's own validation" : "drafted an answer -- flagged for your review"
      );
      logTrace(
        invalid
          ? `Flagged "${pending.label}" -- LLM-drafted answer failed validation.`
          : `Filled "${pending.label}" via LLM-drafted answer (flagged for review).`
      );
    }

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
      }
    } else {
      logTrace("No resume upload field found on this page.");
    }

    // Nothing to fill, flag, or upload on this page at all -- it's likely a job description/landing
    // page rather than the application form itself. Look for a button that starts the application
    // (the same allowlist findGenericSubmitButton uses for the final submit already covers "Apply
    // Now"-style labels) and click it, rather than reporting an empty, unhelpful result. This only
    // gets the user INTO the form; it deliberately doesn't chase the page that loads next
    // automatically -- re-clicking "Autofill this page" once the form appears keeps this in line with
    // the single-page-only design (see the runGenericAutofillWorkflow comment in background.js).
    let clickedApplyEntry = false;
    let applyEntryLabel = null;

    if (filledFields.length === 0 && flaggedFields.length === 0) {
      const entryButton = findGenericSubmitButton();

      if (entryButton) {
        applyEntryLabel = getActionLabel(entryButton);
        const urlBeforeClick = window.location.href;
        entryButton.click();
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
    // as the main field loop above (plain re-fill, then the keyboard-input fallback for text-like
    // fields) exactly once each, never looping; a value that still won't stick is moved from filled to
    // flagged rather than silently reported as a success.
    function demoteFilledFieldToFlagged(label, value, reason) {
      const filledIndex = filledFields.findIndex((entry) => entry.label === label && entry.value === value);
      if (filledIndex !== -1) {
        filledFields.splice(filledIndex, 1);
      }
      flaggedFields.push({ label, reason });
    }

    for (const { element, label, value } of filledFieldElements) {
      if (hasExpectedFieldValue(element, value)) {
        continue;
      }

      if (!element.isConnected) {
        // Diagnostic tag "element_detached" -- distinct from the plain-cleared case below: the DOM
        // node we filled is gone entirely (a re-render replaced its subtree, or navigation tore down
        // the page), not merely reset. No amount of re-filling the SAME reference can help here.
        demoteFilledFieldToFlagged(
          label,
          value,
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

      if (isSelect) {
        selectMatchingOption(element, value);
      } else {
        fillTextField(element, value);
      }

      if (hasExpectedFieldValue(element, value)) {
        await pushActivityStep("verify", label, "success", "re-filled -- a later step in this sweep had cleared its value");
        logTrace(`Re-filled "${label}" -- a later step in this sweep had cleared its value.`);
        continue;
      }

      // Escalate to the keyboard-input fallback exactly once more before giving up -- never for
      // select (see actions.js's typeViaKeyboardFallback and loop.js's dropdown handling: this
      // fallback types free text, which is never the right interaction for a control that only
      // accepts one of its own real options).
      if (!isSelect) {
        logTrace(`"${label}" -- still didn't stick after a plain re-fill; retrying via keyboard input...`);
        const fallback = await typeViaKeyboardFallback(element, value);

        if (fallback.ok && hasExpectedFieldValue(element, value)) {
          await pushActivityStep(
            "verify",
            label,
            "success",
            "re-filled via keyboard fallback -- a later step in this sweep had cleared its value"
          );
          logTrace(`Re-filled "${label}" via keyboard-input fallback -- a later step in this sweep had cleared its value.`);
          continue;
        }
      }

      // Diagnostic: "value_cleared" (back to empty) points at the field's own controlled-input state
      // resetting it; "value_replaced" (holds something else entirely) points more at the site's own
      // logic -- a dependent-field default, or its own autofill -- actively overwriting what we wrote,
      // not just failing to register it.
      const currentValue = element.value || "";
      demoteFilledFieldToFlagged(
        label,
        value,
        `${label} -- was filled, but its value didn't persist after later steps in the form (diagnostic: ${currentValue ? "value_replaced" : "value_cleared"}); please re-check`
      );
      await pushActivityStep(
        "verify",
        label,
        "error",
        currentValue ? `reverted to "${currentValue}" after being filled` : "reverted to empty after being filled"
      );
      logTrace(
        `Flagged "${label}" -- value did not persist even after a second fill attempt${
          isSelect ? "" : ", including a keyboard-input retry,"
        } (diagnostic: ${currentValue ? `now holds "${currentValue}" instead` : "now empty"}).`
      );
    }

    logTrace(
      `Done. Filled ${filledFields.length}, flagged ${flaggedFields.length}${clickedApplyEntry ? ", clicked apply-entry button" : ""}.`
    );
    await pushActivityStep(
      "done",
      null,
      "success",
      `Filled ${filledFields.length}, flagged ${flaggedFields.length}${clickedApplyEntry ? ", clicked apply-entry button" : ""}`
    );
    await persistActivity(false);

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
        trace,
        pageTitle: document.title,
        hostname: window.location.hostname
      }
    };
  }

  Object.assign(GA, { runGenericAutofill, describeEnteredValue, buildTextFillRetryOutcome, findNextUnhandledFieldEntry });
})();
