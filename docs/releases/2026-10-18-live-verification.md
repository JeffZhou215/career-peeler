# Signed-in Release Verification — October 18, 2026

This check uses the owner's existing signed-in Apple Careers account and saved resume/settings. It is separate from the automated suite. The installed unpacked extension was upgraded from 0.2.7 to 0.2.8 and then the local 0.2.9 build. No store upload or publication was performed.

## Submission Management

- Explicit **Sync Submissions**, started from the United States search tab, verified 41 active submissions and 9 available slots. It opened and closed a temporary submissions tab and preserved the original search.
- Manually opening Active Submissions stayed on page 1 of 5. Passive synchronization deferred full pagination and did not create another tab or start AI scoring.
- **Analyze & Rank All** requires the Active submissions tab to be open; invoking it from a search tab showed that prerequisite. Running it from Active visited all 5 pages, preserved the unified saved list, and returned to page 1.
- The initial analysis reused 41 descriptions, fetched no descriptions and performed 41 fresh matches. A subsequent complete analysis reused all 41 descriptions and all 41 scores, with zero fresh matches. This was observed in the real panel's Scan Details.
- The protected filter displayed the protected interview role without a withdrawal selection checkbox. Review Withdrawal stayed disabled. No withdrawal confirmation was opened.
- After the status corrections below, the complete cached analysis showed **Synced just now**, a verified timestamp, 41 / 50 submitted and 9 available slots, including after restoring the original submissions page.

## Job Scan

The controlled filter is Apple's United States search with `search=agentic` and `sort=relevance`, selected through Apple's search UI in a separate tab. Apple reported 442 results across 23 pages. The older broad United States search tab was retained.

The run uses **Review Then Apply** so completion can be inspected before any application. Live page ordinals and filter URLs are compared with the panel's progress. Stop was requested during page 6: 5 fully completed pages and 72 discovered unique base IDs remained saved, and the owned scan tab closed. Reopening the panel after an extension reload retained that checkpoint. Resume opened the same normalized filter at `page=6`, rather than restarting at page 1. The UI retains the original scan's observed-job count and cached matches.

The resumed run completed **all 23 pages**, reporting **316 unique base job IDs**, 70 previously applied jobs in the filter, and 28 scores reused during the resumed attempt. Apple's result total includes location-specific variants; it is not the same aggregation as the main unique-job counter. The panel reported **Ranking Complete · All Pages Ranked** and the owned scan tab closed, returning to the original filtered test tab. No repeated-page warning or unexpected stop occurred after resumption.

The side panel was closed at page 9 for approximately a minute. Apple's visible ordinal advanced while it was closed; reopening reconnected to the existing run at page 13, with 12 completed pages. The scan subsequently passed page 13 and completed page 23. This demonstrates this signed-in run continuing without the panel; it does not simulate a native worker crash or establish every browser-throttling scenario.

This scan had **0 strong matches** under the unchanged eligibility rules. It did not start applications. The pre-existing queue included partially matching roles and unrelated historical roles; none were automatically submitted to manufacture an application test.

## Application Batch Preflight

Two previously queued AI/ML roles were selected for a controlled preflight: Computer Vision & Machine Learning Engineer (`200667649-3956`, 72%) and Machine Learning Researcher, Foundation Models (`200636174-0836`, 66%). **Apply Selected (2)** opened a review sheet containing both exact IDs and their distinct match concerns. The selection display showed two planned selections against nine available slots. Final confirmation remained disabled while **I Reviewed The Match Concerns For These 2 Jobs** was unchecked. No final submission was authorized or issued by this verification.

Actual application execution is pending the owner's review of those partial matches and explicit answers when personal questions are required. The existing saved consent checkbox alone was not used to bypass the match-concern review. The source tab and sheet were left available for review. This preflight verifies selection and preparation, not form filling, Submit, server confirmation, or post-submission reconciliation.

## Defects Reproduced And Corrected

1. **Successful analysis overwritten by its own passive event.** The verified inventory was saved before the original page was restored and before analysis ownership was released. That restoration emitted a passive check which replaced the sync success with “another workflow is running.” An isolated two-page reproduction ended with a complete inventory, known capacity, zero active analyses, but a deferred status. The analysis now marks its inventory verified only after the capacity write; deferred status writes recheck that fact after awaited reads. Completion also updates the existing passive cooldown for the source tab. Ordinary incomplete analysis still defers and never claims verification.
2. **Page-readiness retry compared against historical success.** A passive check during a reload could fail before the content receiver was ready. The ready page's unchanged signature was compared with `lastPageSignature` from a previous document, blocking recovery. Failed attempts now record `lastFailedReadySignature`; a readiness notification can retry an earlier activation failure once, while repeated failures with the same signature remain throttled. Tests reproduce both the missed retry and the previous repeated-message retry loophole. A real document reload recovered from the receiver warning to the expected pagination deferral without creating a tab. A complete explicit analysis then restored verified capacity. With five pages, a passive read correctly cannot restore complete capacity on its own after a failed read.
3. **Scan Stop displayed as Application Stopped.** A historical application's reconciled cancellation flag overrode the new scan's heading. The heading now gives that flag priority only while application reconciliation remains required. Stopped/running/completed ranking phases retain their own labels, and unresolved stopped applications retain their warning.

These corrections do not relax inventory validation, capacity reservations, submission identity checks, final-Submit permissions, or withdrawal protections.

## Verification

The offline suite after these corrections has **983 passing tests, 0 failures and 0 skipped tests**. Runtime syntax checks and the production build pass. New tests cover completed-analysis restoration, a delayed deferral write arriving after verification, content readiness after a missing receiver with an unchanged inventory, throttling duplicate failed readiness notifications, and historical Stop metadata versus scan headings.

Private local evidence is under `artifacts/live-release-0.2.8/` and `artifacts/live-release-0.2.9/`. Those screenshots contain account/application context and are excluded from the extension package; they are not Chrome Web Store listing assets.

## Remaining Checks

- The broad United States search (218 pages at initial inspection) was not fully scanned in this verification; the complete signed-in run used the narrower 23-page filter. Other filters and changing search inventories remain integration cases.
- Execute a user-approved live application batch and verify its results against Apple. Some explicit personal application answers were unset when Setup was inspected. Do not infer them or submit unrelated roles merely to test the workflow. No live submissions or withdrawals have occurred in this verification so far.
- Native Chrome crash/forced worker termination during Submit, alternative Apple DOM variants, different accounts and a genuinely empty Active inventory are not established by these checks.
