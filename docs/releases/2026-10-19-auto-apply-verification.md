# Auto Apply Failure Verification — October 19, 2026

## Reproduction and diagnosis

The latest observed batch completed with zero submissions and three roles needing review. Activity initially described every failure as a worker restart. Inspection of the actual recovery path, followed by an isolated restart reproduction, established that completed failures were being relabeled on a later worker startup. This was not evidence that the worker had interrupted all three applications.

Restoring the durable per-job reasons revealed two distinct failures:

- Two roles stopped at `verifySavedApplicationAnswers()` because the policy interpreted an employment-history `Start Date` as an ambiguous availability question.
- One role stopped looking for Continue/Submit on Add Resume. Live inspection confirmed that Apple renders a disabled `apply-step-continue-button` labeled `Submit` and a visible `aria-label="Loading indicator"` before loading its saved resume and real Continue action. `waitForApplicationFormToSettle()` previously counted the mere presence of that disabled placeholder as readiness.

The saved personal answers were configured. No missing answers were inferred or filled as part of verification.

## Verified Apple DOM

After a refresh, Profile loaded successfully. Its employment editor has a `Start Date` fieldset and month/year selects inside the Employment Summary section. The application itself was then inspected using Apple's existing saved resume, stopping at Profile Information before final Submit. Its parsed-profile editor has the same semantic structure:

```html
<section id="parsedmodal-review-employments-title">
  <h2>Employment Summary</h2>
  <!-- Other employment fields omitted. -->
  <fieldset>
    <legend>Start Date</legend>
    <!-- Layout wrappers omitted. -->
    <select id="parsedmodal-startmonth-0" name="Month">...</select>
    <select id="parsedmodal-startyear-0" name="Year">...</select>
  </fieldset>
</section>
```

The excerpt documents observed structure, with values and unrelated profile information omitted.

## Changes

- Exclude bare Start/End Date fields from availability verification only when their nearest section explicitly identifies Employment Summary or Education Summary. This does not fill or alter historical dates. Explicit availability questions and dates without that context still require verification.
- Wait up to 30 seconds for usable application controls, ignoring disabled resume-loading placeholders and honoring visible loading indicators. Loaded questions remain eligible for filling when Apple disables Continue until answers exist. URL, heading, control count, and primary-action label must stabilize.
- Persist a workflow result's error type, heading, and visible actions. Preserve acknowledged failure reasons across worker restarts and repair earlier overwritten/fallback history from the exact job's durable result. A completed application journal no longer replaces a subsequent ranking scan's progress/error.
- Show blocked saved-answer checks in the detailed Activity steps.
- Unknown Submit results, ownership revocation, reconciliation requirements, reservations, and fresh user review requirements remain in force. No applications are automatically retried by these changes.

## Verification

- Full `npm test`: **1,000 passed, zero failed**.
- `npm run check`: all runtime syntax checks and production Vite build passed.
- `git diff --check`: passed.
- Real-browser isolated DOM probe: four cases passed, using synthetic values and the production parser: employment date, education date, standalone ambiguous date, and explicit unanswered availability inside a history section. All values remained unchanged.
- Recovery tests include completed failures, previously overwritten reasons, missing queue failure persistence, repeated restarts, a later queue selection/resolved result, and a known failure alongside another job's uncertain Submit.
- Readiness tests include a disabled shell, delayed loading beyond the old timeout, a persistent loader, disabled-but-fillable questions, SPA changes, and identity changes during polling.

The local unpacked extension was confirmed to load from this repository's `dist` directory. No real final submissions or withdrawals were performed.

## Remaining integration limits

Apple intermittently failed to retrieve Profile information and kept the resume-loading placeholder visible. Refresh eventually restored both pages. The readiness change waits for a bounded interval and pauses safely if Apple remains unavailable; it does not reload or replay a potentially executed Submit.

The fix was validated against live field structure and isolated browser/automated tests, not a new real submission batch. Existing failed jobs remain reviewable failures; they are not silently requeued or retried. A newly reviewed application is needed to validate the complete live submission path.
