# Interrupted Application Recovery

The workflow journal (`appleApplicationWorkflow` in IndexedDB) records the full reviewed job ID, worker/session ownership, step permission, Submit intent, attempt count and outcome. A restart does not replay pending actions.

## Known Outcomes

`reconcileAppleApplicationSession()` in `lib/appleWorkflowRecovery.js` preserves a durably confirmed submission. It does not require Apple's later Active list to prove that historical outcome again.

An interrupted form with an explicit `not_attempted` outcome, zero attempts and no Submit intent or authorization can be released for a new user review after the old tab acknowledges revocation and a complete inventory is verified. This does not infer submission from a base job ID and does not resume the old form.

## Unknown Outcomes

Apple's Active list can expose a base ID while the reviewed posting contains a location suffix. Capacity verification can succeed independently of that exact outcome. An unknown Submit keeps its reservation and cannot be retried merely by selecting it in a new batch. Base-ID equality does not confirm the full reviewed posting.

**Check Application Status** calls `checkInterruptedAppleApplication()` in `lib/appleRankingWorker.js`. It:

1. Locks the read-only operation, validates the selected journal/session/job, and revokes the old tab's workflow permission.
2. Reads a fresh complete Active inventory. This may resolve an exact-ID presence directly.
3. Otherwise finds the exact job-detail tab in the same window. The user opens the Review link if needed; the check does not reload an application form or open a new job tab.
4. Refreshes that detail tab without using its cache, then requests `APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS`. The reader waits within a bounded window for Apple to render a stable status; browser load completion alone does not prove the SPA is ready. Busy semantics are checked separately from ordinary job-description words such as “processing.”
5. Requires a fresh document and stable, positive submission confirmation identifying only the exact full job ID. Apple's verified header/footer Submitted controls are accepted only when both are disabled, have no link, and their accessible labels agree exactly with the posting title and full role number. The page must be signed in. The worker revalidates this structured evidence and reads a complete Active inventory again after the control observation; it must contain one matching active entry with no competing suffix, title mismatch or withdrawal evidence. Login/loading state, generic Submitted labels, already-applied errors, Apply availability, contradictory or historical withdrawn text, stale documents and different IDs cannot provide proof.
6. Updates only the original pending operation with a compare-and-set check, preserving attempt count and cancellation. A subsequent complete inventory reconciles capacity and any other unknown jobs.

No form filling, Apply click, Submit permission or automatic batch restart occurs. A new batch still requires review and confirmation. Failed persistence or synchronization does not authorize another Submit. Passive Submitted observations cannot resolve a pending unknown operation or release its reservation.

The latest check result appears beside the recovery controls. Panel refreshes are sequenced so a delayed older response cannot replace a newer recovery view. A completed check remains associated with its workflow session even when reconciling the checked role changes which role needs review next. A different session cannot inherit that result.

## Integration Limits

The disabled Submitted controls were verified by read-only inspection on October 18, 2026. Opening the original full-ID detail URL exposed the full ID in both control labels and the displayed role number; opening the base-ID URL exposed only the base ID. This difference explains why the supplied base-page HTML was insufficient for the original full-ID check. Base-only controls remain insufficient for a suffixed workflow.

Offline tests use sanitized observed DOM fields, adverse variants, and isolated worker/storage harnesses. They do not perform submissions, withdrawals or live recovery-state updates. Apple may change its markup, and not every posting is verified to use this exact structure. Missing or conflicting evidence keeps the outcome unknown. Complete live recovery, Chrome reload/content-script ordering, and cross-account behavior remain integration checks.

Exact job ID does not provide an account identity. Changing Apple accounts within one Chrome profile remains an integration risk outside this remediation.

The 0.2.7 timing changes were verified with delayed DOM fixtures and the actual React panel in an offline browser. The delayed-snapshot reproduction no longer restores the old warning after reconciliation. An end-to-end live status check remains outstanding because the connected Apple session expired; no real application or withdrawal was performed.
