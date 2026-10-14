# Auto Apply Scan Scope

Baseline: `be62cb1`. This addresses original audit finding 6, cached jobs absent from the latest completed filter entering Auto Apply. No real Apple applications or withdrawals were performed.

## Confirmed Root Cause

`startAppleJobRanking` captures the search URL, and `runAppleJobRanking` stores each filter in `appleJobRanking.searches`. Jobs share the persistent ranking cache. Their `sourceKey` identifies a filter that previously discovered them, not the particular scan that most recently discovered them.

Automatic selection filtered cached jobs by matching profile and `sourceKey`. Although scans collected `discoveredIds`, that membership was not used by automatic selection. Fresh scans did not delete older job records, so a strong cached role absent from a new complete scan remained eligible. The apply worker then accepted the automatic job-ID set without independently checking its scan provenance. Live posting verification proved the job still existed, not that it belonged to the intended filter.

A synthetic run against the actual `be62cb1` worker reproduced this: first scan discovers `100` and `101`; the next complete scan discovers only `101`. Baseline simulated application attempts were **`100`, `101`**. The fixed regression attempts only **`101`**, preserving `100` and its queued/cache record.

## Changes

- Each new scan receives a unique `scanId`, full `discoveredJobIds`, and an explicit persisted `latestSearchKey`. Existing base-ID discovery counts remain compatible. Search identity preserves filter parameters, normalizes parameter ordering, and excludes only pagination `page` and the URL fragment.
- Every returned search page must identify the same normalized filter and explicitly report its next-page state. Redirects, filter drift, malformed reads, cancellation, and failures leave the scan incomplete and never initiate Auto Apply.
- Auto Apply selects strong matches only from this scan's exact full IDs. Its selected IDs and scan provenance are saved alongside the existing search/queue records.
- Queue construction independently requires the latest completed scan, matching scan/filter/profile identities, persisted automatic selection, exact discovered ID, and matching queued provenance. Old, absent, missing, or unverified scope cannot fall back to the whole saved queue.
- Exact duplicate IDs are deduplicated. A changed suffix cannot reuse another full job ID's assessment or queued permission. Existing base-key cache layout and capacity accounting are preserved.
- Caches are retained. The ranking view distinguishes latest-scan observations, historical records absent from the complete filter, and unknown membership for incomplete/legacy scans. These labels are visible in collapsed role headings. Filter absence never claims that a posting is closed.
- Existing explicit manual queue/selection/confirmation remains supported for historical roles. Before any selected application, verify the live full job ID, posting fingerprint, and a read-only applicability probe. The probe checks an enabled Apply action or an already-submitted signal and preserves authentication/identity failures. It does not click anything. The workflow continues to verify identity and ownership before actual actions.
- Valid Resume continues the same identified partial scan, preserving only its own observations. Legacy scans without full membership and a scan identity restart discovery from page one while retaining reusable scores. Loading saved state does not automatically launch applications.

No matching thresholds, saved-answer policy, capacity rules, recovery gates, or Submit limits were relaxed. No storage records were deleted, new queue introduced, or database schema/version migration required.

## Tests

```sh
node --require ./tests/helpers/noNetwork.cjs --test --test-timeout=30000 tests/jobRanking.test.js tests/roleCard.test.mjs
npm test
npm run check
git diff --check
```

Full suite: **350 passed, 0 failed, 0 skipped**. Syntax validation and the production Vite build passed. Added 18 worker/content regressions and one role-heading regression; repaired the existing mocked page/status responses to include the identity evidence returned by the real content script.

Coverage includes cached absent/present roles, score reuse, changed filters, filter redirects, parameter ordering and pagination, malformed terminal evidence, failed/cancelled scans, restored partial and legacy scans, duplicate IDs, suffix changes, explicit historical manual selection, restart queue construction, missing/stale plans, unavailable live roles, identity conflicts, authentication expiry, and the existing workflow-recovery gate. The full suite includes the prior capacity and duplicate-Submit safety regressions.

## Remaining Limits And Policy

No unresolved product-policy decision was needed: Auto Apply is restricted to its completed filtered scan, while explicit manual selection retains its established behavior. Cache retention and Resume follow the existing architecture.

Discovery is a scan-time observation, not proof of permanent availability or a globally closed role. A resumed partial scan remains the same logical scan. Apple can reorder/change results while paging; no server-side point-in-time inventory API is available in this implementation. A live identity/posting/apply-action check precedes each application, and workflow guards recheck before mutation.

Native Chrome integration remains necessary to validate actual Apple filter URL normalization, SPA pagination/redirects, delayed Apply controls, and worker termination while saving the automatic plan. Automated verification used real source in VM fixtures and mocked browser/network responses; it did not interact with an authenticated account.
