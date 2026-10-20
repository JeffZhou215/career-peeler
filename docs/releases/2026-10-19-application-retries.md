# Application Retry Controls — October 19, 2026

## User flow

Activity now provides **Select Retryable**, batch **Return Selected To Application Queue**, and individual **Review & Retry**. Known failures can be checked and returned to the existing queue. The individual action then opens the existing one-role application review sheet, with its previous failure available to expand. Neither action starts an application. Cancel leaves a successfully returned role queued.

Returned failures remain in Activity as **Requeued**, under **Previous Failure**, and no longer inflate the unresolved count. A later successful submission remains **Submitted Later**. Missing-answer failures offer **Complete Answers**. Unknown or interrupted outcomes offer a read-only **Check Application Status** action.

## Safety and persistence

`returnAppleApplicationsToQueue()` in `lib/appleRankingWorker.js` is an extension-panel-only message handler. It serializes against scans, applications, and withdrawal workflows; verifies saved answers and current assessments; synchronizes capacity; and reads the exact full-ID posting and its current apply action in a temporary inactive tab. It performs no LLM scoring, form filling, Submit, or withdrawal. Closed/unavailable postings, changed descriptions, stale scores, submitted/withdrawn jobs, and unverifiable identities cannot return unchecked. Per-role unavailability can coexist with successful returns; systemic identity failures stop the check.

The durable workflow journal, failure record, and reservations determine retry eligibility. Inventory absence does not clear an unknown Submit. Legacy records without sufficient proof also remain blocked. New queue membership is not automatic-application discovery: old `autoQueuedFrom` membership is removed, and the normal application flow still verifies live identity, assessment, capacity, ownership, and explicit batch confirmation.

The final queue/history update reads the ranking and application journal in one `CareerPeelerJobStore.updateCollections()` transaction. A late unknown outcome cannot be overwritten by an older page snapshot. A reviewed known failure gets a separate `retryReviewedAt` marker so worker recovery preserves the queue decision without fabricating an application result, resetting cancellation, or authorizing an action. No new application owner is claimed until the user confirms an application batch.

## Verification

- Full `npm test`: **1,070 passed, zero failed**.
- `npm run check`: runtime syntax checks and production build passed.
- `git diff --check`: passed; copied runtime files match their sources.
- Backend tests include batch/single return, exact selection, mixed blocked/safe roles, unavailable/changed postings, failed inventory, missing answers, stale scores, identity changes, persistence failure, duplicate requests, cancellation, and late unknown outcomes.
- Recovery coverage includes unknown outcomes after absence and worker restart, a prior retry marker followed by an unknown outcome, and a requeued interrupted ordinary form that retains explicit cancellation after restart.
- A real fake-indexeddb transaction test validates late journal evidence independently of the in-memory workflow adapter.
- UI tests and a Chrome preview using synthetic jobs verify disabled unknown selection, bulk return, folded history, single-role confirmation, previous failure details, and confirmation disabled until consent. The preview cannot submit applications.

Private screenshots are saved under `artifacts/`; the synthetic preview is under `tmp/`. These are excluded from the release archive. No real Apple submission or withdrawal was performed. Live Apple authentication, loading behavior, and future DOM changes remain integration dependencies; failed verification keeps the role out of the queue.
