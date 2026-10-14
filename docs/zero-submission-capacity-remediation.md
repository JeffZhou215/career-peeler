# Zero-Submission Capacity Remediation

Baseline: `189d650`. Scope: the HIGH-severity zero-active-submissions finding and its inventory/capacity consumers.

## Root Cause And Call Paths

`collectCurrentAppleSubmittedHistoryPage` required a positive page number and at least one card. Legitimate empty inventory therefore failed before synchronization could produce a zero count. Missing pagination totals also defaulted to one. Background capacity refresh checked only `pages.length === pageCount`, so a malformed zero-pages/zero-count response could incorrectly become a complete empty snapshot.

The affected paths are:

- Sync Submissions, passive sync, and pre-application capacity checks → `refreshAppleQueueCapacity` → temporary Apple profile tab → all-pages content reader → ranking capacity and the shared capacity strip.
- Scan And Match All → per-page reader/reviews → combined submission snapshot → capacity. The scorer also rejected an empty array.
- Withdrawal confirmation → settled page read → saved role removal → submission/ranking snapshots. Removing the final application previously left no readable page.

## Changes

- Retain the existing Apple origin, profile route, and Active Submissions context checks; reject authentication, loading, and visible error states.
- Use the existing `paginationTotalPages` selector as explicit metadata. An authenticated Active Submissions context, no cards, explicit zero total, no enabled pagination, and no loading/error signal produces `confirmed_empty`. Missing metadata or one empty page out of a positive total remains unknown. No guessed Apple empty-state selector or copy is used.
- Represent confirmed empty inventory as one virtual page with zero roles, preserving the current Submissions UI and pagination consumers.
- Validate every inventory page: authentication/context proof, consistent count, contiguous indices, next-page state, closed withdrawal confirmation, valid active IDs, and no duplicates. An empty inventory needs explicit confirmation; empty `pages` is never accepted.
- Persist `confirmed`, `confirmed_empty`, or `unknown` inventory state. Failed or incomplete refreshes invalidate current capacity while retaining saved ranking/history and pending reservations. Unknown state takes precedence over cached counts, including anomalous future timestamps.
- Complete scans and successful syncs replace the baseline and clear reconciled reservations. Later confirmed applications and pending reservations still consume slots through the existing capacity helper. Unproven legacy empty snapshots require a fresh sync.
- Empty submission scoring succeeds without an API call or resume requirement. Final-withdrawal verification accepts a stable confirmed-empty page following the existing success message, and saved capacity is reconciled accordingly. Withdrawal protections and confirmation policy remain unchanged.

## Verification

The new tests reproduced the original empty-page error, malformed-response acceptance, final-withdrawal failure, and stale-count fallback before remediation.

| Check | Result |
| --- | --- |
| `npm run test:inventory` | 16/16 passed |
| `npm run test:p0` | 39/39 passed |
| `node --test --test-name-pattern='capacity\|submissions\|queue\|count' tests/jobRanking.test.js` | 6/6 relevant consumer tests passed |
| `node --test tests/submittedWithdrawals.test.mjs tests/roleCard.test.mjs` | 9/9 passed |
| `npm run check` and `git diff --check` | Passed |
| Full `npm test` | Still stops at the pre-existing content harness reference to removed `isTikTokAuthorizationModuleQuestion` |
| Full standalone job-ranking suite | 16 passed; one pre-existing test still expects the removed no-match-keyword exclusion policy |

Necessary worker fixtures now provide the current asynchronous job-store, session, tab, activity, PDF-profile, and inventory message interfaces. These are synthetic VM tests of the real source, not IndexedDB migration or browser integration tests. Network requests and application/withdrawal actions are mocked; no real submissions or withdrawals occurred.

## Outstanding Integration Test

The real zero-submission Apple page is unavailable because the user's account has active applications. The zero fixture is synthetic and uses existing parser structure with a zero pagination total; it is **not** a captured or verified Apple empty-account page.

When a genuine empty account is available, verify whether Apple renders zero through that existing total-pages metadata, how it marks completed loading/authentication, and what it renders after withdrawing the final role. Confirm that a zero total is not a transient bootstrap value without a loading indicator. If Apple omits that metadata or uses another representation, the current reader intentionally returns unknown until a focused, evidence-based adapter is added. Do not withdraw existing applications merely to obtain this fixture.

No matching thresholds, application-selection policy, withdrawal protections, removed platforms, or unrelated audit findings were changed.
