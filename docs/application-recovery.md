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
4. Refreshes that detail tab without using its cache, then requests `APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS`.
5. Requires a fresh document and stable, positive submission confirmation identifying only the exact full job ID. Login/loading state, generic Submitted labels, already-applied errors, Apply availability, contradictory or historical withdrawn text, stale documents and different IDs cannot provide proof.
6. Updates only the original pending operation with a compare-and-set check, preserving attempt count and cancellation. A subsequent complete inventory reconciles capacity and any other unknown jobs.

No form filling, Apply click, Submit permission or automatic batch restart occurs. A new batch still requires review and confirmation. Failed persistence or synchronization does not authorize another Submit. Passive Submitted observations cannot resolve a pending unknown operation or release its reservation.

## Integration Limits

Offline tests use synthetic DOM fixtures and isolated worker/storage harnesses. They do not establish that Apple currently emits a fresh confirmation containing a full suffixed ID on every job-detail page. If Apple supplies only a generic Submitted button, this check intentionally leaves the outcome unknown. A real read-only sample of that status and its surrounding DOM is needed to establish any additional reliable association; no real submission is required to collect it.

Exact job ID does not provide an account identity. Changing Apple accounts within one Chrome profile remains an integration risk outside this remediation.
