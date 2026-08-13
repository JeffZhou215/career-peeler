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
    snapshotPage,
    inferGenericFieldMapping,
    resolveProfileValue,
    buildOptionMatcher,
    selectMatchingOption,
    fillTextField,
    isFieldNowInvalid,
    clickOptionMatchingText,
    isOptionConfirmedSelected,
    openDropdownAndSelectOption,
    waitForSettle,
    askLlmForAnswer,
    findGenericSubmitButton
  } = GA;

  async function runGenericAutofill(userProfile) {
    const profile = userProfile || {};
    const filledFields = [];
    const flaggedFields = [];
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

    logTrace(`Starting autofill sweep on ${window.location.hostname}.`);

    const snapshot = snapshotPage();
    const fieldEntries = snapshot.filter((entry) => entry.type === "field");
    const questionEntries = snapshot.filter((entry) => entry.type === "question");
    const dropdownEntries = snapshot.filter((entry) => entry.type === "dropdown");
    const fileEntry = snapshot.find((entry) => entry.type === "file") || null;
    logTrace(
      `Snapshot: ${fieldEntries.length} form field(s), ${questionEntries.length} button/radio-group question(s), ${dropdownEntries.length} custom dropdown(s), ${fileEntry ? 1 : 0} resume upload field(s).`
    );

    for (const entry of fieldEntries) {
      const { element, label, fieldKind: kind, required } = entry;

      if (kind === "checkbox") {
        if (isAgeEligibilityQuestion(label)) {
          if (!element.checked) {
            element.click();
          }
          filledFields.push({ label, value: "Yes" });
          logTrace(`Checked "${label}" (age eligibility).`);
        } else if (required) {
          flaggedFields.push({ label, reason: `${label} -- checkbox needs manual review` });
          logTrace(`Flagged checkbox "${label}" -- required, no safe default to check.`);
        } else {
          logTrace(`Skipped checkbox "${label}" -- not required, no safe default.`);
        }
        continue;
      }

      if ((element.value || "").trim()) {
        logTrace(`Skipped "${label}" (${kind}) -- already has a value.`);
        continue; // already filled by the site itself, don't overwrite
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
        continue;
      }

      if (mapping.action === "essay") {
        pendingAnswerFields.push({ element, label });
        logTrace(`"${label}" -- detected as an essay question; queued for LLM answer.`);
        continue;
      }

      const wantedValue = mapping.action === "fixed" ? mapping.value : resolveProfileValue(profile, mapping.profileKey);

      if (!wantedValue) {
        if (required) {
          flaggedFields.push({ label, reason: `${label} -- no value saved in your autofill profile` });
          logTrace(`Flagged "${label}" -- matched profile.${mapping.profileKey}, but it's empty.`);
        } else {
          logTrace(`Skipped "${label}" -- matched profile.${mapping.profileKey}, but it's empty and not required.`);
        }
        continue;
      }

      if (kind === "select") {
        if (selectMatchingOption(element, wantedValue)) {
          filledFields.push({ label, value: wantedValue });
          logTrace(`Filled "${label}" (select) with "${wantedValue}".`);
        } else {
          flaggedFields.push({ label, reason: `${label} -- could not find a matching option for "${wantedValue}"` });
          logTrace(`Flagged "${label}" (select) -- no option matched "${wantedValue}".`);
        }
      } else {
        fillTextField(element, wantedValue);

        if (await isFieldNowInvalid(element)) {
          flaggedFields.push({ label, reason: `${label} -- the value from your profile didn't pass this field's validation` });
          logTrace(`Flagged "${label}" (${kind}) -- filled but failed the field's own validation.`);
        } else {
          filledFields.push({ label, value: wantedValue });
          logTrace(`Filled "${label}" (${kind}) with "${wantedValue}".`);
        }
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

      const matcher = buildOptionMatcher(wantedValue);
      const clickedOption = clickOptionMatchingText(entry.options, matcher);
      const confirmed = clickedOption && (await isOptionConfirmedSelected(clickedOption));

      if (confirmed) {
        filledFields.push({ label: entry.label, value: wantedValue });
        logTrace(`Answered question "${entry.label}" with "${wantedValue}" (confirmed selected).`);
      } else if (clickedOption) {
        flaggedFields.push({
          label: entry.label,
          reason: `${entry.label} -- clicked "${wantedValue}", but could not confirm the site registered it -- please check`
        });
        logTrace(`Flagged question "${entry.label}" -- clicked "${wantedValue}" but selection unconfirmed.`);
      } else {
        flaggedFields.push({ label: entry.label, reason: `${entry.label} -- could not find a matching option for "${wantedValue}"` });
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
        logTrace(`Opening custom dropdown "${entry.label}" to look for a "${rule.fixedValue}" option...`);
        const { clickedOption, confirmed } = await openDropdownAndSelectOption(entry.element, buildOptionMatcher(rule.fixedValue));

        if (confirmed) {
          filledFields.push({ label: entry.label, value: rule.fixedValue });
          logTrace(`Selected "${rule.fixedValue}" for custom dropdown "${entry.label}".`);
        } else if (clickedOption) {
          flaggedFields.push({
            label: entry.label,
            reason: `${entry.label} -- clicked "${rule.fixedValue}", but could not confirm the site registered it -- please check`
          });
          logTrace(`Flagged custom dropdown "${entry.label}" -- clicked "${rule.fixedValue}" but selection unconfirmed.`);
        } else {
          flaggedFields.push({
            label: entry.label,
            reason: `${entry.label} -- opened the dropdown, but no "${rule.fixedValue}" option was found -- please select manually`
          });
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
      const answer = await askLlmForAnswer(pending.label);

      if (!answer) {
        flaggedFields.push({
          label: pending.label,
          reason: `${pending.label} -- no answer available from your saved profile or resume; please fill in manually`
        });
        logTrace(`Flagged "${pending.label}" -- no LLM/resume-derived answer available.`);
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

      if (profile.resumeFileDataUrl) {
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
        logTrace(`Flagged resume upload -- ${profile.resumeFileDataUrl ? "attach attempt failed" : "no resume saved in profile"}.`);
      } else {
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
          logTrace(`Nothing to fill on this page -- clicked "${applyEntryLabel}" to start the application; the page changed afterward.`);
        } else {
          flaggedFields.push({
            label: applyEntryLabel,
            reason: `Clicked "${applyEntryLabel}" to start the application, but the page doesn't appear to have changed -- please check it worked.`
          });
          logTrace(`Clicked "${applyEntryLabel}", but no page change was detected after ${settleResult.elapsedMs}ms -- flagging for review.`);
        }
      } else {
        logTrace("Nothing to fill on this page, and no entry button found either.");
      }
    }

    logTrace(
      `Done. Filled ${filledFields.length}, flagged ${flaggedFields.length}${clickedApplyEntry ? ", clicked apply-entry button" : ""}.`
    );

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

  Object.assign(GA, { runGenericAutofill });
})();
