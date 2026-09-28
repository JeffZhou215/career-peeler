// Entry point for the site-agnostic "Autofill this page" feature (see background.js's
// sendGenericAutofillMessage/runGenericAutofillWorkflow for the extension-side half). Injected on
// demand via chrome.scripting.executeScript listing all genericAutofill/*.js files in dependency
// order (domHelpers -> classify -> actions -> Workday adapter -> snapshot -> prompt -> loop -> agent) only when the
// user clicks "Autofill this page" in the side panel -- never declared in manifest.json's
// content_scripts. Workday re-injects this same bounded pipeline after each supported forward
// navigation; the three known career sites still use their separate tuned flow in content.js.
//
// The re-injection guard lives here, not in the other files: this is the only file with an
// observable side effect on re-injection (registering a message listener). The other files just
// redefine functions onto the shared GA namespace each time, which is harmless.
(function () {
  if (window.__careerPeelerGenericAutofillLoaded) {
    return;
  }
  window.__careerPeelerGenericAutofillLoaded = true;

  const GA = window.__careerPeelerGA;
  const { runGenericAutofill, findGenericSubmitButton, findWorkdayProgressAction, simulateRealClick } = GA;

  // Must match loop.js's own copy of this key -- if runGenericAutofill throws before reaching its own
  // final persistActivity(false) call, the activity log would otherwise stay stuck showing "running"
  // in the side panel until the next sweep overwrites it.
  const GENERIC_AUTOFILL_ACTIVITY_KEY = "appleCareersGenericAutofillActivity";

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "APPLE_CAREERS_RUN_GENERIC_AUTOFILL") {
      runGenericAutofill(message.userProfile, message.activityContext)
        .then(sendResponse)
        .catch((error) => {
          chrome.storage.local.get(GENERIC_AUTOFILL_ACTIVITY_KEY).then((stored) => {
            const activity = stored[GENERIC_AUTOFILL_ACTIVITY_KEY];
            if (activity?.running) {
              const cycles = (activity.cycles || []).map((cycle) =>
                cycle.status === "running"
                  ? { ...cycle, status: "attention", outcome: "Needs Attention", completedAt: Date.now() }
                  : cycle
              );
              chrome.storage.local
                .set({ [GENERIC_AUTOFILL_ACTIVITY_KEY]: { ...activity, running: false, cycles } })
                .catch(() => {});
            }
          });
          sendResponse({ ok: false, error: error?.message || "Autofill failed." });
        });
      return true;
    }

    if (message?.type === "APPLE_CAREERS_GENERIC_AUTOFILL_SUBMIT") {
      const button = findGenericSubmitButton();
      if (button) {
        button.click();
      }
      sendResponse({ ok: true, clicked: Boolean(button), confirmationPending: Boolean(button) });
      return false;
    }

    if (message?.type === "APPLE_CAREERS_GET_WORKDAY_PROGRESS_ACTION") {
      const action = findWorkdayProgressAction();
      sendResponse({
        ok: true,
        found: Boolean(action),
        ...(action ? { label: action.label, actionKind: action.kind } : {})
      });
      return false;
    }

    if (message?.type === "APPLE_CAREERS_CLICK_WORKDAY_PROGRESS_ACTION") {
      const action = findWorkdayProgressAction();
      const expected =
        action && action.label === message.expectedLabel && action.kind === message.expectedActionKind;
      if (expected) {
        simulateRealClick(action.element);
      }
      sendResponse({
        ok: true,
        clicked: Boolean(expected),
        ...(action ? { label: action.label, actionKind: action.kind } : {})
      });
      return false;
    }

    return false;
  });

  window.__careerPeelerGenericAutofillTestApi = {
    inferGenericFieldMapping: GA.inferGenericFieldMapping,
    isWorkdayHostname: GA.isWorkdayHostname,
    isPhoneExtensionField: GA.isPhoneExtensionField,
    isPhoneCountryCodeField: GA.isPhoneCountryCodeField,
    isPhoneDeviceTypeField: GA.isPhoneDeviceTypeField,
    isWorkdayDropdownStatusLabel: GA.isWorkdayDropdownStatusLabel,
    isWorkdayDropdownMenuElement: GA.isWorkdayDropdownMenuElement,
    isDropdownBackingInput: GA.isDropdownBackingInput,
    getWorkdayProgressActionKind: GA.getWorkdayProgressActionKind,
    findGenericSubmitButton: GA.findGenericSubmitButton,
    buildOptionMatcher: GA.buildOptionMatcher,
    choosePreferredLinkedInSourceLabel: GA.choosePreferredLinkedInSourceLabel,
    choosePreferredWorkdaySourceLabel: GA.choosePreferredWorkdaySourceLabel,
    choosePreferredWorkdaySourceParentLabel: GA.choosePreferredWorkdaySourceParentLabel,
    isEssayQuestionLabel: GA.isEssayQuestionLabel,
    isWorkAuthorizationQuestion: GA.isWorkAuthorizationQuestion,
    isCategoricalWorkAuthorizationStatusQuestion: GA.isCategoricalWorkAuthorizationStatusQuestion,
    isVisaSponsorshipQuestion: GA.isVisaSponsorshipQuestion,
    isAgeEligibilityQuestion: GA.isAgeEligibilityQuestion,
    isPreviousEmploymentQuestion: GA.isPreviousEmploymentQuestion,
    isReferralSourceQuestion: GA.isReferralSourceQuestion,
    askLlmForAnswer: GA.askLlmForAnswer,
    askApplicationQuestionAgent: GA.askApplicationQuestionAgent,
    hasExpectedFieldValue: GA.hasExpectedFieldValue,
    hasExplicitWorkdayFieldError: GA.hasExplicitWorkdayFieldError,
    isDropdownValueConfirmed: GA.isDropdownValueConfirmed,
    isWorkdayDropdownMenuOpen: GA.isWorkdayDropdownMenuOpen,
    isWorkdayMultiSelectContainer: GA.isWorkdayMultiSelectContainer,
    getVisibleDropdownOptionElements: GA.getVisibleDropdownOptionElements,
    getAssociatedWorkdayPromptOptions: GA.getAssociatedWorkdayPromptOptions,
    getWorkdayMultiSelectOpenTarget: GA.getWorkdayMultiSelectOpenTarget,
    getWorkdayDropdownSearchInput: GA.getWorkdayDropdownSearchInput,
    getWorkdayPromptMenuItemType: GA.getWorkdayPromptMenuItemType,
    getWorkdayTrustedPromptClickTarget: GA.getWorkdayTrustedPromptClickTarget,
    getWorkdaySourceMenuState: GA.getWorkdaySourceMenuState,
    resolveProfileValue: GA.resolveProfileValue,
    isElementStillActionable: GA.isElementStillActionable,
    isQuestionControlRequired: GA.isQuestionControlRequired,
    buildFrameworkTextCommitStages: GA.buildFrameworkTextCommitStages,
    describeEnteredValue: GA.describeEnteredValue,
    buildTextFillRetryOutcome: GA.buildTextFillRetryOutcome,
    findNextUnhandledFieldEntry: GA.findNextUnhandledFieldEntry,
    hasMeaningfulExistingFieldValue: GA.hasMeaningfulExistingFieldValue,
    getMeaningfulExistingWorkdayDropdownValue: GA.getMeaningfulExistingWorkdayDropdownValue,
    isMappedApplicationQuestion: GA.isMappedApplicationQuestion,
    parseWorkdayCandidateDate: GA.parseWorkdayCandidateDate,
    getWorkdayDegreeFamily: GA.getWorkdayDegreeFamily,
    doesWorkdayDegreeOptionMatch: GA.doesWorkdayDegreeOptionMatch,
    buildWorkdayRoleDescription: GA.buildWorkdayRoleDescription,
    workdayExperienceEntriesMatch: GA.workdayExperienceEntriesMatch,
    workdayEducationEntriesMatch: GA.workdayEducationEntriesMatch,
    runGenericAutofill: GA.runGenericAutofill
  };
})();
