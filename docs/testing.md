# Automated Tests

Install the locked development dependencies with `npm ci`. Run:

```sh
npm test
npm run check
```

`npm test` uses Node's built-in runner, discovers every top-level `tests/*.test.js` and `tests/*.test.mjs`, reports all cases instead of stopping at the first suite, and applies a 30-second timeout. Test files have separate processes; cases sharing a VM run sequentially. Unmocked fetch requests fail locally. The focused `test:p0` and `test:inventory` commands remain available.

`npm run check` validates runtime-script syntax and builds the production extension. A successful build does not reload Chrome or start extension workflows.

## Fixtures And Coverage

| Area | Coverage |
| --- | --- |
| Core | Profile/PDF freshness, prompts, EEO/eligibility policy, matching, API responses, errors, timeout and key privacy |
| Content | Posting/experience parsing, local matching, required/optional controls, answer verification, duplicate notices and validation recovery |
| Background | Apple-only URL gates, retry/error ledgers, public-state privacy, activity, tab ownership, cached postings and recovery messages |
| Safety | Saved answers, Submit caps and unknown outcomes, workflow identity, one synthetic four-stage application, IPC privacy |
| MV3 Recovery | Durable claims/intent, worker recreation, cancellation, exact identity, late page revocation, reconciliation, reserved unknown outcomes and completed bookkeeping |
| Inventory | Confirmed empty versus unknown, pagination, stale counts, later applications and final-withdrawal reconciliation |
| Submission Sync | Read-only automatic navigation/activation checks, persisted status/throttles, deferred pagination/workflows, interrupted checks, legacy requests, explicit Sync/Analyze, tab reuse/restoration and pre-application capacity checks |
| Ranking | Complete/partial discovery scope, retained caches, filter drift, restart plan validation, exact identities, manual selection, live applicability, slot limits, reserved outcomes and queue edits |
| Search Pagination | Stable full-ID content and live ordinals, delayed/disabled/hidden controls, SPA rerenders, unchanged pages, lost navigation replies, bounded recovery, exact-filter checkpoints, cancellation, resumption and scan-scoped counters |
| IndexedDB | Real migration/transaction code, retained profile and protected roles, rollback, cleanup retry, concurrent contexts, record patches and notifications |
| UI/Withdrawal | Disclosure behavior/markup, withdrawal lost replies and queue-stop rules |
| Submission Collection | Unified cached inventories, partial overlay/legacy pages, authoritative complete snapshots, exact-ID deduplication, status filters, selection/protection reconciliation and status subscriptions on reopening |

The VM fixtures use synthetic DOM controls and Chrome APIs. The IndexedDB suite uses a fresh in-memory factory per case and closes its connections. Database collection defaults include empty maps; fixtures should match that schema. Tests must restore global fetch stubs and shared VM methods after each case.

New current-behavior tests belong in top-level `.test.js` or `.test.mjs` files and are automatically included. Helpers belong under `tests/helpers/`. Do not add manual test loops that hide later failures or launch unawaited promises.

## Limits

The suite does not verify authenticated Apple DOM variants, real server application outcomes, native Chrome service-worker termination, native Chrome debugger input, real PDF rendering, or actual browser cross-context scheduling. Worker-restart tests recreate the real scripts against shared saved state and synthetic message boundaries; see `docs/mv3-application-recovery.md` for required Chrome integration scenarios. The zero-account fixture is synthetic; Apple's real empty-list representation remains an outstanding integration test. `fake-indexeddb` verifies storage logic, not disk persistence/quota behavior in Chrome. No real Apple submissions, withdrawals, account navigation, or OpenAI requests are performed.

Legacy employer names may appear in negative support gates or historical-ledger fixtures. Those tests assert that retired hosts are rejected or that old records cannot inflate Apple's capacity; they do not restore support.
