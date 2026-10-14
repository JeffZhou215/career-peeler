# Automatic Capacity Checks And A Unified Submissions Collection

## Scope And Safe Read Strategy

The previous unsolicited-tab defect came from routing passive activation/load/success events into the same full-inventory reader used by explicit Sync and Auto Apply. That reader legitimately creates a temporary tab when no existing suitable submissions tab exists and navigates pagination. It cannot safely be invoked automatically on the user's visible page.

The existing parser proves an authenticated Active list and returns roles, pagination metadata, loading/error state, and withdrawal-dialog state. It provides **no verified total application count or authenticated read-only JSON endpoint**. Page count alone cannot determine total submissions. No new selectors, inferred ten-per-page count, hidden browsing context, or undocumented API was introduced.

Automatic synchronization therefore reads only the existing ready Active page:

- Activation and completed navigation are checked in the background. The content mutation observer also reports a ready Active-list signature, covering SPA navigation and loading completion.
- A dedicated Peek message uses the existing context/session/page parser. It never clicks, injects scripts, creates tabs, or performs LLM matching. Favorites and other non-Active views are ignored.
- A one-page inventory, including explicitly confirmed empty, can pass the same complete-inventory validator used by explicit Sync.
- Multiple pages defer with an explanation: explicit **Sync Submissions** visits all pages and restores the starting page. An open withdrawal dialog also defers.
- Apply, ranking, analysis, withdrawal, and unresolved workflow recovery defer before any page read. Automatic checks never acknowledge recovery or free pending reservations.
- Concurrent events coalesce through the existing ranking ownership lock and a sync guard. A persisted 60-second attempt throttle survives worker restarts; a changed ready-page signature may retry a failed loading read. Panels observe status and caches; they do not start automatic workflows.

Explicit Sync retains same-window suitable-tab reuse and temporary-tab cleanup. Explicit Analyze retains cached scoring and pagination. Auto Apply retains fresh complete capacity validation, job identity, recovery ownership and duplicate-Submit guards.

## Persistent Feedback

`appleSubmissionSyncStatus` is a small live record in Chrome local storage, alongside other small settings/status records. Job inventories, scores, descriptions and queues stay in the existing IndexedDB store.

The record stores state (`syncing`, `synced`, `failed`, `deferred`), reason/message, last attempt/source tab/signature, and `lastSuccessAt`/`lastVerifiedCount`. Success is written only after the inventory passes validation and inventory/ranking persistence completes. A failed fresh read invalidates current capacity, retains cached roles and reservations, and never creates a zero count. Last success survives failures and deferrals. Complete Analyze also records its verified inventory timestamp independently of LLM progress.

Worker startup converts a persisted in-flight sync into an interrupted failure and unknown capacity; it preserves last success/reservations and does not replay or resume synchronization. Normal successful timestamps and attempt throttles survive reopening/restart.

The Submissions panel shows compact progress with a small spinner, verified/cached age and timestamp, failure with Retry, or a defer explanation. The capacity strip labels cached counts. Subscription setup fences older asynchronous reads so reopening cannot overwrite newer live state. No browser notification, modal, or automatic toast was added.

## Unified Collection And Safety

Page-selection UI was removed; pagination/page identities remain in backend scans and withdrawal navigation. **Analyze & Rank All** is the primary action. Search and All/Scored/Unscored/Protected filters operate on one exact-job-ID-deduplicated collection, ordered by lowest unprotected fit first. Protected roles remain nonselectable.

A complete latest snapshot is authoritative, including confirmed zero; old pages cannot resurrect removed applications. An incomplete/latest stopped scan overlays newer saved observations onto the last complete snapshot and legacy cached pages. Older retained roles show unverified availability, and the collection displays a partial-data warning. The projection does not rewrite persisted snapshots or score caches. Same-title cached scores may be retained as Saved Score; changed titles/identities do not inherit unrelated scores.

Selection is independent of filters/search. Hidden selected roles are counted; a full withdrawal confirmation still lists every target. Cache refreshes retain only still-present, unprotected IDs. Batch withdrawal continues to re-find exact live job IDs, check star protections, process Apple confirmation dialogs, and handle shifting pages. No new withdrawal policy or live destructive operation was introduced.

## Verification And Remaining Integration Checks

Regression tests cover automatic navigation and SPA readiness, activation bursts, successful/empty/failed/malformed reads, pagination/dialog/workflow/recovery deferrals, reserved uncertain outcomes, durable timestamps/throttles, interrupted sync, duplicate ownership, explicit Sync/Analyze, UI reopening and stale subscription reads, unified partial/complete/legacy projections, filter-independent selections and protections. Existing capacity, recovery, Submit safety, ranking, IndexedDB, and withdrawal suites continue to run offline.

Native Chrome event scheduling and Apple SPA variations remain integration checks, especially loading transitions and changing routes while a check is pending. The real zero-submission page fixture remains unavailable. Full non-disruptive automatic synchronization of multi-page inventories requires a verified total/count or authenticated read-only data source; until that evidence exists, the extension deliberately defers instead of navigating or opening a tab silently.

Validation: full `npm test` passed 398 tests with zero failures/skips; `npm run check` passed all syntax checks and the production build; `git diff --check` passed. No live Apple submissions, withdrawals or OpenAI requests were performed.
