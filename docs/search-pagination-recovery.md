# Search Pagination Recovery

Baseline: `20c2559`. This addresses partial Scan And Rank failures without changing matching or application policy.

## Findings

The old worker replaced every unsuccessful Next reply with the same generic error, losing the content script's reason. The reported 13-page failure therefore cannot identify whether the original trigger was a slow transition, unavailable control, or another navigation failure.

The source and offline reproductions confirm these defects:

- Next discovery excluded disabled controls, but the click path queried again and could click a different, disabled control.
- A changed set of links within 12 seconds was accepted without checking the intended page ordinal or stable results. The initial collection used stable row counts rather than stable job identities.
- A temporarily missing or disabled Next control could mark an unfinished list complete.
- Generic message fallback could replay a potentially executed Next click after a lost response.
- Resume used an ambiguous navigation checkpoint and did not persist which discovered jobs had finished processing.

Read-only inspection of Apple's current search DOM confirmed `#search-pagnation`, `#pagination-search-page-number`, `data-autom="paginationTotalPages"`, and the Next/Previous Page button labels. No scan, application, withdrawal, or OpenAI request was started during that inspection.

## Changes

Ranking uses a strict pagination protocol. A page must have the same normalized filter URL, its intended live DOM ordinal, a valid total, visible connected controls with the expected disabled states, no observed loading/session/error signal, and four stable full-job-ID signatures. Each wait is bounded at 30 seconds. Changed links alone cannot prove advancement, and missing controls cannot prove the final page.

Next clicks the exact verified enabled button once. If already at the intended target, it verifies that page without clicking again. The worker sends this mutation once, avoiding generic replay. After a lost or unsuccessful response, it reads the target page. If necessary, it makes at most two recovery navigations to that exact page URL in the owned scan tab and verifies the DOM again. It never advances blindly or navigates the original filtered-search tab. Filter/identity/authentication failures stop recovery.

An initial page read has at most two attempts. Exhausted navigation includes the original failure reasons, expected page, and Resume Scan instructions. Changed total-page counts pause with instructions to start a fresh scan using cached scores; they cannot certify a complete inventory.

Checkpoints retain the exact filter/scan/profile identity, full discovered IDs, completed-job IDs, completed-page count, and page signatures. Resume starts at `pagesRead + 1`; a partially processed page is reread while already finished jobs are skipped. Discovery before a failed or cancelled match does not mark that job processed. Resume rejects a different active filter or changed profile instead of silently starting a different scan. Older compatible checkpoints can reuse scores, but do not guess completed-job identities from discovery alone. A completed final page and its complete flag are saved together.

Incomplete, failed, cancelled, or unverifiable scans cannot start automatic applications. Capacity, reviewed job identity, workflow ownership/recovery, and duplicate-Submit guards are unchanged.

## Counter Meanings

Previously, **Saved** meant all cached jobs with the current resume/settings signature across filters, including unscored, excluded, and historical jobs. **Strong Matches** meant eligible unapplied cached jobs for that profile across filters. Neither was a current-scan evaluation count. Thus 2,579 saved records did not mean 2,579 jobs were evaluated in this scan. Zero strong matches alone does not identify which qualification/evidence/confidence/score checks failed.

The main summary now shows **This Scan: X Jobs Found · Y Strong Matches**. Discovery counts retain the existing unique-base-ID semantics; matching membership uses exact full IDs. The strong count includes only this scan's current-profile observations that satisfy the existing automatic eligibility rules. Missing/legacy/stale-profile scope displays unknown rather than a false zero. **Cached Jobs Across Filters** appears separately in Scan Details and includes the complete cache. Cached rankings and manual selection remain available.

## Verification And Remaining Limits

Offline regressions exercise delayed and disabled controls, SPA rerenders, unchanged content, missing/hidden/detached controls, page skips, loading/authentication failures, transitions beyond 12 seconds, lost replies, bounded exhaustion, more than ten pages, filter drift, cancellation, durable resume, duplicate IDs, scan-scoped counters, and incomplete-scan Auto Apply safety.

Run `npm test` and `npm run check`. Content tests use a virtual clock; worker tests use the real scripts with synthetic physical-page Chrome responses. No real applications or withdrawals are performed.

Final verification: **438 tests passed, 0 failed, 0 skipped**. Runtime syntax checks and the production Vite build passed. The targeted pagination/worker/UI suites contain 77 passing tests, including 40 new regressions.

Native Chrome integration is still needed for throttled or suspended tabs, actual Apple slow/error/final-page DOM variants, and worker termination during a real paginated read. Apple can reorder results while a scan is running without changing page count; this client cannot create a server-side point-in-time snapshot. It verifies contiguous page identities and observed content, preserves partial state, and checks live identity/applicability before applying. The exact cause of the old 13-page failure remains unknown because its original diagnostic was discarded.
