# Application Batch Lifetime

Baseline: `62845a2`.

## Observed Failure

The reported screenshot shows **Workflow Interrupted** and retains multiple selected roles in the queue. The recovery message explicitly records a worker restart. The user did not reload the extension or restart Chrome. The live header still showed available capacity, so the observed state was not a one-slot capacity limit.

Selection is preserved from the queue checkboxes through preparation, confirmation, exact selected job IDs, and the shared workflow journal. There is no unconditional stop after the first successful application. On worker restart, recovery deliberately pauses: an outstanding application step may include a Submit that Apple accepted without the worker recording its result. A role later shown as Submitted does not authorize replay of its original step.

The log proves a restart occurred; it does **not** record Chrome's reason for terminating the worker. Chrome's documented idle lifetime makes waits without extension API activity a relevant implementation gap. The application runner previously had no operation-scoped lifetime guard and relied on incidental page messages/API activity or the open side panel.

## Changes

- During an explicitly started application batch, call the local `chrome.runtime.getPlatformInfo()` API every 20 seconds. This follows Chrome's documented long-operation pattern and uses no network request, new permission, or user-data write.
- Release the timer on completion, failure, pause, or Stop. Prevent overlapping calls and make release idempotent. Neither startup nor recovered workflows acquire the guard.
- Keep recovery, capacity verification, exact reviewed identities, and unknown-Submit handling intact. A real restart still pauses for reconciliation; no submission or application step is replayed automatically.
- Fix a separate confirmed-outcome bookkeeping defect: if the application returned a verified success but a later local journal/ranking write failed, the old catch treated `workflowInvoked` as evidence of an unknown result. Preserve **submitted**, reserve capacity, record **submission_bookkeeping_failed** with `submissionOutcomeUnknown: false`, and pause the remaining batch for synchronization.

For the interrupted batch, use **Sync Submissions**, then review and explicitly select the remaining queued roles. Do not retry the submitted role merely because the old batch summary recorded zero confirmed submissions.

## Verification

Offline fixtures exercise the real selected-batch preparation, confirmation/start, shared session, application runner, four synthetic stages per role, authorization and Submit observations. They verify two selected roles can complete while an unselected role stays queued. Virtual timers cover long content waits, release, cancellation, errors, overlapping pulses, and startup/recovery without an active timer. Queue regressions also cover journal/ranking writes after confirmed success and retained reservations.

No real Apple applications, withdrawals, or OpenAI calls are performed. The repository's full `npm test` suite and `npm run check` validate existing capacity, identity, recovery, matching, and pagination behavior alongside the new cases.

Results: **447 tests passed, 0 failed, 0 skipped**; runtime syntax checks and the production build passed. Nine new regressions cover the scoped lifetime and confirmed-result bookkeeping changes.

## Limits

This guard reduces ordinary idle termination; it does not prevent extension reload, browser shutdown, process crashes, resource pressure, or every Chrome request/fetch lifetime limit. Native Chrome verification with the side panel closed and slow Apple replies remains necessary. The exact cause of this historical worker termination cannot be reconstructed from the saved log.

References: [Chrome service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) and [Chrome's scoped long-operation pattern](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#keep_a_service_worker_alive_until_a_long-running_operation_is_finished).
