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

## Follow-up: GSE preparation through final review

With the user's authorization to prepare job `200626114-0157` and stop before Submit, the actual runner traversed Add Resume, Profile Information, and Questions and reached Review and Submit. Temporary independent content-script and service-worker guards prohibited final Submit throughout this live test. A missing role-specific personal answer first stopped preparation; only the user's explicit response was saved before continuing.

This exposed two additional defects:

- The paused-review branch skipped its own cleanup, but queue-wide cleanup still closed the owned application tab. The runner now removes that paused draft from its owned cleanup set before handing it to the user. This also preserves an uncertain application for reconciliation without releasing its reservation or permitting another Submit.
- The read-only answer verifier inspected footer notices and treated answer/narrative keywords as questions. Apple's actual review markup pairs screening `h3.question` with `p.answer`, and demographic `label` with `span.info`. The parser now scopes itself to the verified review form and uses those explicit pairs. Known labeled profile data in the verified contact/education/employment sections is excluded from screening classification; unknown or ambiguous personal rows still block. A complete review-text/connectivity snapshot also stops verification if the page changes while saved answers are being resolved.

The second defect was independently reproduced using the captured review DOM: a veteran-status answer appeared to be a second question, and an employment description containing “over 12,000 images” was classified as age eligibility. A local probe reconstructed the full captured DOM and passed after the fix. Captures and personal profile values remain outside committed documentation and release assets.

After rebuilding the guarded test extension, the live final-review check stopped with **“Fill-only verification stopped before final Submit. No application was submitted.”** The exact GSE job remained on Apple's uncompleted Review and Submit step, with its draft open. No real submission or withdrawal was performed.

### Final verification

- Removed all temporary Submit guards, test controls, and fill-only UI text from production source before the final build.
- Full `npm test`: **1,014 passed, zero failed** (14 additional regressions).
- `npm run check`: syntax checks and production build passed.
- `git diff --check`: passed; copied runtime build files match source.
- New tests cover verified Apple review pairs, narrative/footer false positives, missing/conflicting personal answers, unexpected/combined rows, changed answers, newly inserted questions during asynchronous verification, paused draft cleanup, and uncertain-outcome reservation/replay protection.

The final irreversible Submit and Apple's response to a real submission remain intentionally untested in this live session. Apple's intermittent loading failures and expired-session behavior remain integration dependencies. The separate ranking scan was paused by an OpenAI insufficient-credit response; preparing this application used explicit saved personal answers.
