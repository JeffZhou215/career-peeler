# Job Page Status And Queue Exclusions

## Behavior

Activity's **Check Job Status**, **Return Selected To Application Queue**, and **Review & Retry** read the selected full-ID job page. They no longer enumerate Active submissions. The three verified states are:

| Apple Page | Queue Behavior |
| --- | --- |
| Submit Resume / Apply | A known failed application can return after its assessment and saved answers are checked. Applying still requires explicit confirmation. |
| Submitted | Excluded from submission queues; retained as Submitted On Apple history. |
| Page Not Found | Excluded from submission queues; retained as Posting Removed history. |

A loading shell, failed request, disabled action, signed-out session, or identity mismatch remains unverified. None is treated as removal. The unavailable-page detector uses the Apple structure already verified for the prior unavailable-posting fix and requires three consecutive observations plus a matching live tab URL.

## Persistence And Safety

An exact-full-ID `submissionQueueExclusion` is persisted in the ranking collection. Manual ranking selection, automatic selection, selected-batch preparation, stale results, and retries all enforce it. Existing `job_unavailable` failure records are recognized without a new scan. A scan preserves a newly recorded exclusion instead of replacing it with its older in-memory placeholder; cached descriptions and new matching settings cannot restore a removed role to a queue.

Job records, matching caches, and failure history are retained. These page checks do not change Active inventory, application history, workflow ownership, or reserved slots. A prior unknown Submit remains uncertain and blocked even when Apple displays Submitted or removes the posting. Fresh complete inventory verification still runs as part of an explicitly confirmed application batch. The existing interrupted-workflow reconciliation remains separate.

## Verification

- Full automated suite: 1,087 tests passed, zero failures.
- Syntax checks and production build: passed.
- Regression coverage includes all three page states without inventory reads, selected-role isolation, exact suffix variants, persistence failure, repeated messages, Stop, restart, legacy diagnostics, stale queue status, changed matching profiles, scan snapshot preservation, unknown outcomes and reservations, and partial application batches.
- UI rendering and event-handler tests cover the new status action and non-actionable history.
- No real applications or withdrawals were performed. Apple session timing, SPA rerenders, and future changes to the live unavailable/Submitted controls still require Chrome integration coverage.
- Private release only; not published.
