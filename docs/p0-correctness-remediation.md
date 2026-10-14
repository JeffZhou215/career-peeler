# P0 Application Correctness Remediation

Baseline reviewed: `593ca45`. Scope: audit findings 1–3 only.

## 1. Saved Work Authorization And Sponsorship

**Reconfirmed root cause:** `content.js`'s `answerQuestionnaire` used `answerYesQuestion` for both questions, and `clickSponsorshipAnswer` also selected Yes. Separately, `lib/core.js`'s `getApplicationQuestionPolicy` returned hard-coded Yes values and inferred a Singapore immigration category. Saved `workAuthorized` / `requiresSponsorship` did not control these paths.

**Affected paths:** queued and single-role application → background `runApplicationWorkflow` → content `runApplicationWorkflowStep` → deterministic questionnaire / sponsorship fallback; required-field recovery → question agent → core `resolveApplicationQuestion`.

**Fix:** both readers use the same small policy module. Background passes explicit saved settings to content. Native selects, radio controls, and custom dropdowns select and verify the offered saved answer. An existing matching answer is preserved; a conflicting or unverifiable answer stops for review. Unset settings, unsupported options, categorical, historical, negative, or combined wording are unresolved. These recognized eligibility questions never fall through to LLM inference.

**Regression risk:** unfamiliar wording or controls can now require manual review. This is intentional under the requirement to avoid inventing eligibility answers. Other personal-answer policies were not changed.

## 2. Final Submit Attempts And Outcomes

**Reconfirmed root cause:** `clickAndDetectSubmission` returned `pending` while loading; background's next iteration could click Submit again. The three-attempt check ran only after validation and another click. A lost response also passed through a fallback that could reinject and replay the mutating command.

**Affected paths:** `runApplicationWorkflow` loop → `clickPrimaryAction` → primary Submit or `clickFinalSubmit` fallback → `clickAndDetectSubmission`; validation recovery re-enters this loop.

**Fix:** check the existing three-attempt limit before either Submit path, then reserve the attempt synchronously before clicking. Page-local and parent attempt state prevent duplicate/concurrent unknown submissions. Loading, missing confirmation, network alerts, or a lost reply are unknown and stop the run. Mutating workflow messages are not replayed. Only explicit field-validation rejection permits recovery and retry. Existing validation is recovered before clicking; blank fields alone do not prove rejection.

Outcomes are explicit: `confirmed`, `rejected`, `unknown`, or `not_attempted`. Confirmed Apple submission remains confirmed if local history saving fails; the result warns that synchronization is needed. Unknown outcomes retain the existing queue reservation and review behavior.

**Regression risk:** a slow or ambiguous Apple response stops automation even if the server eventually accepts it. The user must reconcile with Your Roles. Durable service-worker restart/reconciliation remains a separate audit finding, not part of this patch.

## 3. Reviewed Job Identity Throughout The Workflow

**Reconfirmed root cause:** background captured the original job context but sent no expected ID to later content steps. Content acted on the current page, and success checkpointed the original context regardless of navigation.

**Affected paths:** initial application tab selection → each background iteration → Apply/Continue/Submit and questionnaire/agent recovery → confirmation → application checkpoint.

**Fix:** bind the full numeric Apple job ID, including its suffix, to every step. Validate Apple origin and route before dispatch, after replies, and immediately before delayed actions or writes. Recovery retains the same guard. Reject application links for another job. Mismatched or unverifiable identity stops and pauses the queue before checkpointing. A profile confirmation route is accepted only following this workflow's Submit and when the confirmation itself identifies the expected role. Explicit conflicting confirmation IDs are rejected even when the URL still shows the expected job.

**Regression risk:** suffix/base-ID changes and confirmation pages lacking job identity are not inferred; they stop for review. New Apple routes or markup may need a focused reader update.

## Verification

Each issue was reproduced in targeted synthetic tests before its fix, then retested. Final checks:

| Command | Result |
| --- | --- |
| `npm run test:p0` | 39/39 passed |
| `node --test tests/submittedWithdrawals.test.mjs tests/roleCard.test.mjs` | 9/9 passed |
| `npm run check` | Syntax checks and production build passed |
| `git diff --check` | Passed |
| `npm test` | Blocked by the existing content harness referencing removed `isTikTokAuthorizationModuleQuestion` |

The focused harness loads the real Apple background/content/core code. It supplies current tab/event/message APIs and an asynchronous in-memory storage adapter; it does not test IndexedDB migration. Network access is prohibited in the workflow fixtures. The four-stage integration fixture verifies saved answers, one final Submit, and the exact job checkpoint. No real Apple submissions or withdrawals occurred.

No new material product-policy choice was needed: missing answers, unknown outcomes, and unverified identity stop as requested; the existing three-attempt limit is retained. Removed platforms were not restored. The legacy full-suite cleanup and other audit findings were left untouched.

**Remaining uncertainty:** authenticated Apple DOM variants, actual server rejection/confirmation behavior, and browser/service-worker restart behavior have not been live verified. Unsupported evidence produces review/unknown, not an assumed success or automatic replay.

**Next recommended finding:** audit finding 4, authenticated profiles with zero active submissions cannot synchronize capacity. It has not been addressed here.
