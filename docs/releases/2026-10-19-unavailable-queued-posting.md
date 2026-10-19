# Unavailable Queued Posting — October 19, 2026

## Observed failure

The reviewed queue entry `200636174-0836` (Machine Learning Researcher, Foundation Models) stopped with “The live posting did not verify the selected full Apple job ID.” A read-only visit to the exact linked URL instead showed Apple's explicit unavailable page:

```html
<div class="text-center page-not-found-wrapper">
  <h1 class="t-eyebrow-elevated">Page not found.</h1>
  <div class="mt-50 mb-50">
    <p class="t-intro">Sorry, this role does not exist or is no longer available.</p>
  </div>
  <button class="button button-elevated" id="jobdetails-open-positions-button">Search Current Openings</button>
</div>
```

There was no `#jobdetails-wrapper`. The page title was `No job details found`. This establishes what Apple reported for that exact URL at verification time; it does not prove the role is permanently closed or authorize substituting a different posting.

## Root cause

`extractAppleSubmittedRoleDetails()` reported `ready: false` because there was no description. `waitForAppleSubmittedRoleDetails()` discarded the distinction between unavailable, loading, and unreadable pages and eventually returned `null`. `runAppleJobQueue()` then compared the missing result with the selected job ID, producing `job_identity_unverified`. That systemic error paused the entire batch even though this was a known pre-application failure for one unavailable role.

## Changes

- Recognize only the observed visible, connected unavailable view with its exact heading, explanation, and Apple button, and no competing posting wrapper. Blank shells, generic errors, and hidden/stale markers remain unverified.
- Require three consecutive unavailable observations. A loading rerender resets that count; a ready posting can still load in the interval.
- Use an application-specific detail-read option that verifies the full selected ID against both the response and current tab URL. Real identity changes still stop the batch.
- Report `job_unavailable` as a known pre-application per-role failure. Preserve the role's cached ranking/history, record its failure, and continue only other already reviewed selections. No reservation or application action is created for the unavailable role.
- Keep unreadable or incomplete pages distinct, with a bounded wait, retained read error, and actionable retry instructions. Those remain batch-pausing verification failures.
- Preserve the existing submission-description caller contract and base-ID redirect compatibility; no submitted-inventory or withdrawal behavior is changed.

## Verification

- Reproduced the missing unavailable-state classification with a failing regression before implementation.
- Tests cover the observed DOM structure, loading and network failures, hidden/competing DOM, delayed rendering, consecutive-observation resets, contradictory readiness, full-ID/URL changes, legacy description reads, and partial batches using the production detail poller.
- A synthetic unavailable first role permits the next reviewed role to finish its mocked workflow. An unavailable middle role preserves the preceding confirmed result and permits the following reviewed role. A real identity mismatch prevents all further application steps.
- Full `npm test`: **1,034 passed, zero failed**.
- `npm run check`: runtime syntax checks and production build passed. `git diff --check`: passed.

No live application or withdrawal was performed. The unavailable-page detection uses verified English Apple markup; a changed or localized page remains unverified and pauses safely. Apple can also restore a posting later, so this does not permanently delete or exclude the saved role.
