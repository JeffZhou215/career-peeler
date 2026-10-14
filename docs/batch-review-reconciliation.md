# Automatic Reconciliation In Batch Review

Baseline: `33783dd`.

## Meaning And Ordering Defect

An interrupted application may have reached Apple even when the background worker did not receive its final result. The durable application journal blocks a new owner until a complete authenticated submissions inventory reconciles that prior workflow. A cached available-slot count cannot clear this guard.

Previously, preparing a batch read only cached jobs/capacity. Confirm then called `claimAppleApplicationSession` before the apply worker reached its fresh inventory check. Recovery-required state therefore rejected confirmation before that check could run, leaving the user to switch tabs and Sync Submissions manually.

## Current Flow

1. **Apply Selected** immediately opens the existing review sheet and shows **Checking Previous Applications…** with an animated indicator and the original selected count. Capacity is pending while the check runs.
2. Preparation holds the existing workflow lock. If the durable journal requires reconciliation, reuse the verified full submission-sync flow: revoke the old owner, reuse a suitable Apple tab in the same window and restore its page, or create/close an inactive owned tab. Keep the original search/tab intact. No LLM analysis or application actions occur.
3. Only a complete authenticated inventory can reconcile the old workflow. Verified empty inventory is valid; failed, malformed, or incomplete reads leave capacity unknown and recovery blocked. An absent role with an unknown Submit outcome remains protected and reserved.
4. Preparation revalidates the exact selected jobs and returns their review token/capacity. The sheet reports **Previous Applications Checked** and requires explicit **Confirm And Apply**. Normal preparation without recovery continues using cached results and does not trigger a full sync.
5. Verification failures offer **Retry Check** in the sheet, retaining the original IDs even if the background list refreshes. A submitted or unresolved selected role requires **Back To Queue** and a new selection; the batch is never silently reduced.
6. If a restart occurs after preparation but before Confirm, the structured recovery error triggers one new preparation check. It leaves the refreshed sheet for another explicit confirmation and never retries Apply automatically.

The apply worker still performs its fresh full-capacity check before applying. Recovery preparation and application permission are separate steps; synchronization is not permission to resume interrupted actions. Passive page navigation/activation is unchanged and does not acquire a global recovery runner or create a new tab.

The operation reuses the existing scoped worker-lifetime guard and releases it on completion, failure, or Stop. Concurrent preparation, analysis, withdrawal, and apply owners are excluded. Explicit cancellation remains intact even if an already-started inventory read finishes afterward.

Cancel remains available during the read-only check. Each preparation has a unique request ID: closing its sheet cancels only that matching check, and a stale cancellation cannot stop a later application runner. Client generations ignore late tab/profile/server replies, keeping a cancelled sheet closed and preserving the original selection. Closing is protected once actual application startup begins.

## Verification And Limits

Offline regressions cover complete/empty inventories, stale counts, unknown reserved outcomes, failed/incomplete reads, concurrent/repeated preparation, cancellation, unchanged cached preparation, selected-role changes, and explicit application only after renewed confirmation. UI render and real-handler fixtures cover loading feedback, original selection retention, Retry/Back To Queue, consent, and a recovery error at Confirm with no automatic Apply retry.

No real submissions, withdrawals, or OpenAI calls are used. Native Chrome verification remains necessary for actual Apple account/pagination variants, login failures, and worker termination during the check. A still-unknown Submit result requires manual review of that role even after a successful sync.

Results: **471 tests passed, 0 failed, 0 skipped**, including 24 new recovery/preflight/UI regressions. Runtime syntax checks and the production build passed.
