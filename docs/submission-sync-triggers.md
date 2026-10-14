# Apple Submission Synchronization Triggers

This records the earlier removal of passive synchronization in `7b48a84`. It is superseded by the safe current-page checks described in [automatic-submission-sync.md](automatic-submission-sync.md); automatic checks now never create tabs or paginate.

## Root Cause And Call Paths

Three unsolicited triggers reached the same inventory workflow:

1. `lib/appleSubmissionSync.js` registered `chrome.tabs.onActivated`. After worker startup, activation of Your Roles called `passivelySyncAppleSubmissions`.
2. `content.js` scheduled `APPLE_CAREERS_REQUEST_SUBMISSION_SYNC` 1.5 seconds after loading the profile/roles route. The background message handler called the same passive helper.
3. The content mutation observer also sent that request with `confirmed: true` after detecting a form-success signal. This bypassed the usual route requirement and reset the in-memory throttle.

The helper acquired the ranking lock and invoked `refreshAppleQueueCapacity`. **That function created the tab** through `createTaskTab` in `background.js`, which calls `chrome.tabs.create({ url, windowId, active: false })`. It then requested `APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES`; the content collector navigated pagination buttons and read the complete Active inventory. Finally, the worker closed the temporary tab. Activating the original tab was enough to start this sequence. The 60-second throttle, busy-workflow deferrals, confirmation resets, and worker restarts explain its intermittent appearance.

This path did not perform LLM matching. Matching is performed by explicit Analyze actions. The sidepanel's current-role activation listener only reads the active tab, and the background's temporary tab-load listener only waits for page completion; neither starts a submissions workflow. The Submissions component initially loads saved results from IndexedDB.

## Changes

- Remove the background activation-triggered sync and the content script's load/form-success sync requests.
- Keep the legacy request message as an ignored acknowledgement for previously injected content scripts. They cannot reactivate full synchronization after an extension update.
- Require the explicit capacity-refresh message to originate from the extension panel. Auto Apply continues calling the inventory helper internally after an explicitly authorized start.
- Preserve lightweight observations of a visible Submitted marker on an identified job detail page. These update the role's existing saved status/ledger without creating tabs, paginating, or invoking matching.
- For authorized capacity checks, probe only complete Your Roles tabs in the originating window. Prefer the source tab. Reuse a tab only when the existing current-page parser confirms the authenticated Active list and no withdrawal dialog is open.
- Request complete pagination with original-page restoration on a reused tab, including the failure path. Never close or navigate a reused tab to another URL. If none is suitable, open an inactive temporary tab in the original window and close only that owned tab.
- Keep full inventory validation, unknown-capacity handling, recovery reconciliation, reserved uncertain outcomes, and job/Submit safety gates unchanged.

## Regression Risks And Verification

Disabling passive refresh means externally changed submissions can leave the displayed cached count stale until explicit Sync/Analyze or a pre-application capacity check. This is intentional. Cached counts never replace the application's necessary fresh verification.

Reusing a visible list permits pagination during an authorized check. The collector restores the starting page; authentication expiry, page changes, or restoration failures fail the check and leave capacity unknown. The probe alone is not evidence of complete inventory.

Tests execute real worker/content source against synthetic Chrome and DOM adapters. New cases cover manual load and SPA navigation, repeated activation and worker recreation, legacy requests, explicit Sync and Analyze, source-tab preference, cross-window isolation, unsuitable tabs, concurrent explicit requests, cache reuse, original-page restoration after success/failure, and explicit Auto Apply refusing unverified capacity. Existing inventory, recovery, identity, duplicate-Submit, and withdrawal suites also run.

No real Apple applications, withdrawals, or OpenAI calls are used. Native Chrome event timing, Apple SPA navigation during an authorized check, and page restoration on the live authenticated site remain integration checks. The real zero-submission fixture remains unavailable as documented in the earlier inventory remediation.

Validation: `npm test` passed all 365 tests (zero failures/skips); `npm run check` passed syntax checks and the production Vite build; `git diff --check` passed.
