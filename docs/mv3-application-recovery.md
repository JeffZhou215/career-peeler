# MV3 Application Recovery

Scope: the Apple application session paths following `edfd0e1`. Ranking resumption, withdrawal ownership, and other audit findings are unchanged. Verification uses synthetic pages, Chrome APIs, and IndexedDB; no real applications or withdrawals were performed.

## Finding And Call Paths

`startAppleJobQueue`, `startAppleCurrentRole`, and the completed ranking auto-apply branch all reach `runAppleJobQueue` → `runApplicationWorkflow` → the content workflow step. The standalone workflow message also reaches `runApplicationWorkflow`.

Before this change:

| State | Persistence |
| --- | --- |
| Rankings, queue statuses, capacity reservations, applied/error history, activity snapshots | IndexedDB |
| Scan status, sanitized progress | Chrome local storage |
| Active queue runner, Stop flag, reviewed batch selection, tab ownership, per-tab question context | Worker memory |
| Submit counts/outcomes and in-flight step flag | Worker memory; a separate page-local attempt map also existed |

Startup set the saved scan to stopped, discarded its current job, and rebuilt neither workflow ownership nor Submit state. Ranking could retain `applying` jobs while activity continued to appear running. A surviving content script could still finish an awaited question or action after its background owner disappeared. No durable gate required reconciliation before starting another application.

## Changes

- Add `appleApplicationWorkflow` to the existing extension-owned IndexedDB metadata store. No database-version upgrade or new storage engine is needed. The checkpoint holds a unique session/worker owner, reviewed full job IDs, source tab/window, selected not-started jobs, current step/tab, attempt count, result, cancellation, and reconciliation status. It contains no API key, PDF, or duplicated resume/profile.
- Add a strict transactional metadata update to the shared adapter. Competing claims and Submit permissions cannot both commit. Ranking/UI snapshots cannot overwrite this separate journal.
- Claim ownership before acknowledging a selected batch/current-role start. Journal each dispatched step. Content scripts verify ownership and exact identity immediately before field writes and action clicks. Final Submit permission commits an unknown intent and increments the attempt count **before** returning permission. A changing Continue/Submit button cannot bypass that checkpoint.
- Preserve explicit validation rejection as `rejected`; only that known outcome permits bounded retries within the original session. Confirmed/rejected observations are saved before same-step validation recovery, and ordinary steps preserve the last known Submit outcome. Unknown outcomes are never replayed. Duplicate page commands, pending steps, competing owners, and confirmed-submitted jobs are rejected.
- Startup revokes the previous worker owner and sends revocation to surviving application tabs. Page-side checks run again after awaited permission replies, blocking a delayed grant after revocation. Unreachable live tabs must be closed before reconciliation; recovery does not close application tabs or resume them automatically.
- Interrupted sessions become paused, or remain cancelled. Their reviewed identity, confirmed results, pending intent, and unstarted jobs survive. Confirmed results restore missing durable history; interrupted activity becomes attention-required. Completed sessions also clean up stale running progress if termination happened during final bookkeeping. Success is never inferred from a pending activity row.
- A fresh, complete authenticated Sync Submissions or Scan And Match All reconciles the journal. Failed, malformed, partial, or stale cached inventories do not unlock recovery. Full job-ID conflicts stop reconciliation. A verified present role becomes submitted. **Absence is not a confirmed Submit failure**: it retains an uncertain outcome and reserved slot, and that role cannot be automatically retried. Unresolved outcomes survive later sessions. Other freshly reviewed roles can proceed after successful reconciliation within the remaining capacity.
- Stop is persisted before acknowledgement and revokes page execution. It remains stopped across another restart, including a Stop racing an ownership claim. Revocation does not claim to undo an already executed Submit.
- Jobs displays recovery instructions and preserves the explicit stopped label. Existing Submissions, ranking, withdrawal protection, saved-answer policy, and full job-identity checks remain in use.

## Regression Verification

Commands:

```sh
node --require ./tests/helpers/noNetwork.cjs --test --test-timeout=30000 tests/appleWorkflowRecovery.test.js tests/appleJobStore.test.js
npm test
npm run check
git diff --check
```

Final full suite: **331 passed, 0 failed, 0 skipped**. Syntax checks and the production Vite build passed. The new coverage comprises 31 recovery cases and 2 IndexedDB transaction cases; the existing synthetic four-stage application additionally asserts the final journal state and exactly one Submit attempt.

Recovery coverage includes all requested boundaries: before beginning, ordinary filling, immediately before Submit, clicked Submit awaiting confirmation, confirmed submission, repeated recovery, cancellation during recovery, and mismatched identity after reconciliation. Additional cases cover stale/duplicate IPC, a fresh document losing page-local counters, late permission delivery, unreachable tabs, failed inventory reads, eventual positive reconciliation after an absent inventory, unresolved outcomes across later sessions, changing button labels, bounded rejection retries, completed-session bookkeeping, atomic competing claims, transaction rollback, and stale ranking writes.

## Remaining Uncertainty And Chrome Integration

These tests recreate workers against shared durable data and load the real background/content sources. They do not terminate a native Chrome worker, validate disk flush behavior, or reproduce browser process scheduling.

Live Chrome integration still needs a safe fixture page and mocked responses, with the panel closed:

1. Terminate/restart the worker at each tested boundary, including while an LLM answer is pending and immediately after a permission reply.
2. Verify runtime message wake-up, page revocation acknowledgement, SPA navigation/new-tab transitions, and the Jobs/Activity recovery display.
3. Exercise unloaded/discarded/closed tabs and extension reload while a content response is outstanding.
4. Verify restart between journal confirmation, history persistence, and final activity/progress cleanup.
5. Confirm actual Apple inventory links retain the full reviewed job ID, including suffixes, and observe eventual inventory visibility after submission. If the full ID cannot be verified, the implementation stops; it does not silently match a different suffix.

Apple's inventory propagation latency is not established. A reserved uncertain role may need manual review or a later positive sync; there is deliberately no automatic retry or timeout that guesses failure. The real zero-submission DOM integration remains outstanding from the earlier fix. Withdrawal worker-lock recovery remains outside this targeted application task.
