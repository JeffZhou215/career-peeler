# Application Batch Error Context

## Root Cause

The application recovery warning included an ID in its message, but `prepareAppleApplicationBatch()` returned only the error text and type. The batch sheet discarded the originating job's title and URL. This was particularly confusing when an interrupted application outside the user's current selection blocked a new batch.

## Changes

- Batch preparation and start errors now carry structured `errorJob` context from the actual blocking workflow record.
- The sheet displays the role title, full Apple job ID, and a review link. Earlier workflow blockers are labeled **Previous Application Needs Review**.
- Only an Apple detail/application URL matching that exact full ID is clickable. Missing or invalid links retain the ID as text. Generic errors do not acquire an unrelated job from the selected batch or cached view.
- New requests and cancellation clear old context. Existing generation guards prevent a delayed cancelled response from replacing a newer error's role.
- Capacity verification, reconciliation, Submit permissions, reservations, and unknown-outcome retry rules are unchanged.

## Verification

- Full automated suite: **1,100 passed, zero failures**.
- Syntax checks and production build: passed.
- Regression tests reproduce a base-only Active inventory blocking a location-specific prior application outside the selection, inventory failure, invalid saved links, selected unknown outcomes, and generic errors without job attribution.
- UI tests cover full-ID links, recovery versus selection labels, invalid/offsite/mismatched links, response propagation, refresh, cancellation, late responses, and Confirm failure context.
- No real Apple submissions or withdrawals were performed. Private package rebuilt; not published.
