# Withdrawal Receipt Revocation And Atomic Finalization

Baseline: `8564d63d6c44a8233b929296c990e05ab5dcf490`. Scope: the two confirmed withdrawal defects found during final verification, followed by local private-release preparation. No live Apple submissions or withdrawals were performed.

## Reproductions

1. **Active evidence plus failed fresh read.** A prior inactive receipt remained usable when a subsequent complete, stable primary inventory contained the selected exact active job but the additional fresh-document read failed. Content reported unknown while the journal still reported inactive.
2. **Receipt revoked during the panel wait.** The panel checked an inactive receipt before awaiting a settled page. A worker restart cleared the memory lease; later reconciliation revoked the receipt. The panel's page omitted the selected ID, so it still removed the cached role, released its reservation, and counted success.

Both were reproduced offline using the production worker/content or panel functions. The first regression now verifies that the receipt is revoked even while the later browser read remains pending. The second runs the actual panel selection/batch functions, sequential helper, background message handler, storage adapter and withdrawal journal across independent worker contexts sharing `fake-indexeddb`.

## Changes

- `background.js:reportAppleWithdrawalInventory()` persists revocation upon validated positive active evidence before awaiting further browser navigation. Fresh reconciliation starts after that revocation. A failed read leaves unknown; an agreeing active inventory does not automatically replay a withdrawal.
- `lib/appleJobStore.js:updateCollections()` reads and updates the participating logical collections in one strict IndexedDB transaction over metadata and records. Its callback must be synchronous; thrown failures and asynchronous callbacks abort without partial updates.
- `lib/appleWithdrawalRecovery.js:commitAppleWithdrawalCleanup()` validates the current exact job/batch/request identity, optional document identity and fresh inactive proof inside that transaction. It atomically removes the selected job from saved active records, updates its ranking/capacity state, and writes an idempotent cleanup marker. Unknown, active, stale, revoked and mismatched operations cannot finalize. Unrelated reservations remain intact.
- The panel waits for the visible page first, then calls `APPLE_CAREERS_FINALIZE_WITHDRAWAL`. It has no direct archive/capacity cleanup path and counts success only after the matching worker commit. Earlier committed batch successes survive a later failure.
- Existing F01 original-modal continuity, exact card identity, document-bound click authority and one-use Proceed protections are unchanged.

## Verification

- Full automated suite: **630 passed, 0 failed**, no skipped/cancelled tests.
- All focused withdrawal suites: **163 passed, 0 failed** (included in the full suite).
- Runtime syntax checks and production build: passed through `npm run release:private`.
- Coverage includes revocation before delayed/failed reads, persistence across worker restart, no automatic retry after active reconciliation, real transactional rollback and queue ordering, duplicate finalization, exact-operation mismatch, stale proof, partial batches, unrelated uncertain reservations, panel/worker integration and sender restrictions.
- Existing zero-inventory coverage was adapted to the worker-owned cleanup architecture; a single empty-page hint cannot authorize local removal or clear unrelated reservations.

## Release Preparation

The private-beta target is 0.2.1. `npm run release:private` reruns the suite and syntax/build validation, then prepares the runtime ZIP, SHA-256 checksum, file-hash manifest and store-materials directory. No upload, invitation or publishing command is included. See `docs/releases/PRIVATE_RELEASE.md` for pending publisher inputs and separate known private-beta limitations.

## Remaining Integration Limits

The exercised false-success and unknown-replay paths are closed. Native Chrome/CDP event ordering, Apple server convergence, actual zero-submission markup and account continuity still require non-destructive integration verification. The supplied Apple confirmation markup has no independent job ID; the existing continuity safeguards remain necessary. Offline tests do not establish Apple's hidden server state. No unrelated audit finding was broadly remediated.
