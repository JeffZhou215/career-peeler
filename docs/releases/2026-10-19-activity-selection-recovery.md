# Activity Selection And Recovery

## Reproduced Problems

- A blocked interrupted form offered only **Check Job Status**, which correctly reads the posting without altering workflow recovery. Its **Submit Resume** result could not release the old workflow, leaving the role unselectable from Activity.
- A lost form response could leave `applicationFailures.submissionOutcomeUnknown` true after the exact workflow had been reconciled as stopped before Submit. Retry selection trusted that stale diagnostic and remained disabled.

The first screenshot row is labeled **Outcome Unknown**. Its previous visible Continue step does not prove that a later Submit permission was never granted. Genuinely uncertain Submit outcomes remain blocked.

## Changes

- Activity now provides an explicit **Verify Previous Application** action for matching interrupted operations. It uses the existing reconciliation flow and identifies the exact job and workflow session. **Check Job Status** remains page-only.
- Retryable counts and disabled-checkbox explanations distinguish eligible rows from blocked recovery or stale-assessment rows. Removed and already-requeued entries remain history.
- Failure records now retain their workflow session identity. Recovery diagnostics retain that identity too.
- After a fresh authenticated complete inventory and workflow revocation, stale failure metadata may be repaired only if the exact bound operation is failed, has no pending step, records `not_attempted`, zero attempts and acknowledgements, no Submit intent or authorization, and completed no-Submit reconciliation. Old recovery diagnostics require the matching recovery event when no session ID was recorded.
- The repair rechecks the durable ranking and journal atomically. A new owner, late unknown result, unrelated session, mismatched ID, explicit Submit uncertainty, failed revocation, incomplete inventory, or failed persistence cannot unlock retry.
- Verification never queues or applies a job. New selection, review, and confirmation remain required; explicit Stop and cancellation are preserved.

## Verification

- Full automated suite: **1,117 passed, zero failures**.
- Syntax checks and production build: passed.
- The new end-to-end isolated regression failed before the repair and passed afterward. Additional cases cover inventory/revocation failures, actual unknown Submit, stale or mismatched operations, late journal changes, persistence failure, and cancellation.
- Chrome visual interaction with synthetic data verified that Select Retryable selects eligible roles, a simulated recovered form becomes selectable, and the unknown Submit row remains disabled. Screenshot: `artifacts/activity-selection-verified.png`. The preview uses no real Apple account or application actions.
- No real Apple submission or withdrawal was performed. Private release rebuilt; not published.
