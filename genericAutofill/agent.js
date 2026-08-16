// Entry point for the site-agnostic "Autofill this page" feature (see background.js's
// sendGenericAutofillMessage/runGenericAutofillWorkflow for the extension-side half). Injected on
// demand via chrome.scripting.executeScript listing all genericAutofill/*.js files in dependency
// order (domHelpers -> classify -> actions -> snapshot -> prompt -> loop -> agent) only when the
// user clicks "Autofill this page" in the side panel -- never declared in manifest.json's
// content_scripts, and never runs on the three known career sites (which have their own tuned flow
// in content.js).
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
  const { runGenericAutofill, findGenericSubmitButton } = GA;

  // Must match loop.js's own copy of this key -- if runGenericAutofill throws before reaching its own
  // final persistActivity(false) call, the activity log would otherwise stay stuck showing "running"
  // in the side panel until the next sweep overwrites it.
  const GENERIC_AUTOFILL_ACTIVITY_KEY = "appleCareersGenericAutofillActivity";

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "APPLE_CAREERS_RUN_GENERIC_AUTOFILL") {
      runGenericAutofill(message.userProfile)
        .then(sendResponse)
        .catch((error) => {
          chrome.storage.local.get(GENERIC_AUTOFILL_ACTIVITY_KEY).then((stored) => {
            const activity = stored[GENERIC_AUTOFILL_ACTIVITY_KEY];
            if (activity?.running) {
              chrome.storage.local.set({ [GENERIC_AUTOFILL_ACTIVITY_KEY]: { ...activity, running: false } }).catch(() => {});
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
      sendResponse({ ok: true, clicked: Boolean(button) });
      return false;
    }

    return false;
  });

  window.__careerPeelerGenericAutofillTestApi = {
    inferGenericFieldMapping: GA.inferGenericFieldMapping,
    findGenericSubmitButton: GA.findGenericSubmitButton,
    buildOptionMatcher: GA.buildOptionMatcher,
    isEssayQuestionLabel: GA.isEssayQuestionLabel,
    isWorkAuthorizationQuestion: GA.isWorkAuthorizationQuestion,
    isVisaSponsorshipQuestion: GA.isVisaSponsorshipQuestion,
    isAgeEligibilityQuestion: GA.isAgeEligibilityQuestion,
    isPreviousEmploymentQuestion: GA.isPreviousEmploymentQuestion,
    isReferralSourceQuestion: GA.isReferralSourceQuestion,
    askLlmForAnswer: GA.askLlmForAnswer,
    hasExpectedFieldValue: GA.hasExpectedFieldValue,
    resolveProfileValue: GA.resolveProfileValue,
    isElementStillActionable: GA.isElementStillActionable,
    describeEnteredValue: GA.describeEnteredValue,
    buildTextFillRetryOutcome: GA.buildTextFillRetryOutcome,
    findNextUnhandledFieldEntry: GA.findNextUnhandledFieldEntry,
    runGenericAutofill: GA.runGenericAutofill
  };
})();
