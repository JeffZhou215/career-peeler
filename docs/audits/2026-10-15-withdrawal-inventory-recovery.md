# Withdrawal Inventory and Recovery Remediation

Baseline: `376b7ee2d`. Scope: the two remaining withdrawal findings from the independent verification. No real Apple submission or withdrawal was performed.

## Verified Apple DOM Evidence

The user supplied the Active list outerHTML and confirmation outerHTML. The list confirms `.rolecard`/`role=listitem`, `#profile-role-list`, title links `role-title-{jobId}`, checkbox IDs `addToFavoriteId-favorite-{jobId}`, and Withdraw IDs `js-withdraw-link-{jobId}`. The title href and action IDs use the same submission ID; the supplied submissions expose base numeric IDs rather than a search-result location suffix. `#profile-roles-pagination` contains a number input, `paginationTotalPages`, and Previous/Next controls with disabled attributes. The Type menu uses `button[data-autom="Submissions"]` and `button[data-autom="Active"]`.

The supplied popup has the existing generic heading, Proceed/Cancel IDs and close control. It contains no job ID or hidden role identifier. The existing F01 original-card/modal continuity and one-use input safeguards remain necessary and unchanged. Tests use sanitized structures with synthetic IDs and titles, not the user's application history.

## Reproductions and Corrections

### 1. False success after pagination reset

The baseline accepted a matching-title notification and a stable changed page even while the exact selected ID remained active. The status path then reused that local result as proof of inactivity. This was reproduced through the actual parser and worker/content paths.

`waitForSubmittedRoleWithdrawal()` now distinguishes `active`, `inactive` and `unknown` using complete inventory evidence. Notification text, a page reset, and absence from one page cannot establish withdrawal.

`collectStableAppleSubmittedHistoryInventory()` requires two matching full-inventory passes, settled page reads, exact IDs, consistent pagination, authenticated Active context, no open confirmation, ordered fresh timestamps and no duplicates. Incomplete, changing, stale or failed reads remain unknown. Initial SPA loading is bounded; already being on page one does not skip settling.

Before accepting an inactive outcome, the worker also reads a fresh inactive background document in the same Chrome window and closes it in `finally`. The verified menu selectors can open Submissions → Active there. This avoids treating a retained visible DOM as a new inventory. The initiating document is rechecked for contradictory active evidence after the fresh read. Content and panel checks cover reappearance while the acknowledgement and cache update are pending.

An active contradiction revokes the operation's inactive receipt and preserves unknown state. Old proof predating that contradiction cannot restore inactivity, including same-millisecond proof. Local removal and capacity changes require a current durable exact-operation receipt; stale or legacy content acknowledgements are insufficient. Earlier confirmed roles remain preserved if a subsequent role fails.

### 2. Unknown outcome replay through a new batch

The baseline deduplicated a batch/request but released its in-memory permission state afterward. A new reviewed batch could issue a second Proceed for the same unresolved job. The isolated worker/content probe reproduced two final clicks with no intervening reconciliation.

`lib/appleWithdrawalRecovery.js` stores exact-ID records in the metadata-only IndexedDB collection `appleWithdrawalWorkflow`. `beginAppleWithdrawalIntent()` atomically commits `unknown` before the worker grants Proceed permission or dispatches final input. Batch release, cancellation, panel reopening and worker restart do not clear it. A stale ranking/panel write cannot overwrite this separate journal.

The retry policy is enforced at batch registration, Open and the atomic Proceed claim:

- **Unknown:** retry blocked. Use explicit Sync Submissions.
- **Fresh complete inventory confirms active:** uncertainty resolves, but another attempt requires a subsequent explicit review and a different batch. Active evidence expires after 60 seconds, matching the evidence freshness bound.
- **Fresh complete inventory confirms absent:** the record resolves inactive; another Proceed is forbidden.
- **Incomplete/stale/unavailable evidence:** unknown state remains and retry stays blocked.

Explicit Sync uses a fresh background document and stable complete evidence when withdrawal journal records exist. Passive count synchronization remains read-only; it cannot grant retry permission. Contradictory positive activity can revoke an inactive receipt. No reconciliation path clicks Withdraw or Proceed.

For saved submissions from older versions with no withdrawal journal, the first new batch requires a fresh Sync before review. This covers the upgrade boundary: older unknown results cannot be reconstructed from a journal those versions never wrote. Ordinary successful full synchronization seeds the empty current-version journal.

## Main Call Paths

- Panel `reviewWithdrawals()` → `setAppleWithdrawalBatch()` → `withdrawAppleSubmittedRoles()`.
- Worker `dispatchTrustedAppleWithdrawalClick()` → atomic `beginAppleWithdrawalIntent()` before Proceed → existing document-bound capture/one-use action.
- Content complete inventory proof → `APPLE_CAREERS_REPORT_WITHDRAWAL_INVENTORY` → `readFreshAppleWithdrawalInventory()` → original-document contradiction check → atomic `resolveAppleWithdrawalInventory()`.
- Panel `APPLE_CAREERS_VERIFY_WITHDRAWAL_RECEIPT` → final visible-page contradiction check → per-role cache update.
- Explicit `refreshAppleQueueCapacity()` → fresh stable inventory → journal reconciliation → existing capacity/archive reconciliation. Application Submit recovery and reservations retain their existing safeguards.

## Validation

- Full `npm test`: **608 passed, 0 failed**, no skipped/cancelled tests.
- `npm run check`: runtime syntax checks and Vite production build passed.
- Existing ranking harness now imports the actual withdrawal recovery module; current-version Sync fixtures initialize the journal explicitly. Legacy upgrade behavior has separate coverage.
- Coverage includes pagination reset with the selected ID active, delayed and identical-title alerts, roles on other pages, partial/unstable inventory, stale/contradictory metadata, late reappearance, invalidated receipts, cross-batch replay, worker restart, reconciliation failure, active versus absent outcomes, upgrade initialization, IndexedDB transaction races, stale panel writes, tab cleanup and original F01 modal ownership/one-use permissions.

## Remaining Live Integration Verification

No confirmed false-success or unknown-replay path remains in the exercised cases. Native Chrome/Apple validation remains necessary for CDP/capture event timing, navigation-blocker cleanup, current live zero-submission markup, default menu/loading behavior and server convergence after withdrawal. A fresh document plus repeated DOM reads reduces stale client-state risk; DOM automation cannot independently prove hidden Apple server/cache state or account identity across an account switch. The supplied DOM has no stable account identifier or modal job identifier. Ambiguous observable states stop safely.

Reload the extension and Apple page after updating. Existing installations should run Sync Submissions before reviewing withdrawals. No unrelated audit remediation or non-Apple support was added.
