# Full Test-Suite Restoration

Baseline: `3e31ca1`. Production runtime source was not changed.

## Baseline And Failure Classification

The original `npm test` stopped at the content VM bootstrap. Every test file was also run independently, including the orphaned generic-autofill file and the safety/inventory files absent from the default command. Older fail-fast runners were then converted to `node:test` to expose all remaining failures.

| File / Check | Classification | Resolution |
| --- | --- | --- |
| content.test.js bootstrap: Missing retired TikTok symbols in the exported VM test API | Obsolete API references / outdated harness | Remove retired-module cases and load the shared Apple safety script. |
| background.test.js bootstrap: Missing chrome.tabs.onActivated during importScripts | Outdated harness | Provide tab/events and asynchronous job-store/session interfaces, retaining real background source. |
| core.test.js initial stop: A removed ByteDance host expected active support | Obsolete expectation | Assert Apple support and retired-host rejection. |
| genericAutofill.test.js bootstrap: ENOENT for the deleted genericAutofill source directory | Obsolete suite | Remove the 80-case deleted-engine suite; preserve applicable guards in current Apple suites. |
| jobRanking.test.js: the scorer rejects required experience and personal exclusions before spending API credits | Obsolete mixed expectation | Retain seniority/required-experience assertions; remove the retired worker keyword-exclusion assertion. |
| content.test.js: a Submit click is still attempted when validation markers already exist | Obsolete expectation | Assert no click when explicit field validation already exists. |
| content.test.js: an unconfirmed Submit becomes validation-blocked when explicit required fields remain | Obsolete expectation | Assert unknown outcome; blank fields alone cannot authorize a Submit retry. |
| content.test.js: an unconfirmed Submit stops without broad required-field recovery | Outdated harness | Bind window.location and the mocked current URL to the same reviewed Apple ID; retain recovery/cap assertions. |
| content.test.js: post-click validation engages required-field recovery before retrying | Outdated harness | Bind window.location and the mocked current URL to the same reviewed Apple ID; retain recovery/cap assertions. |
| content.test.js: the third validation-blocked final Submit stops without another recovery | Outdated harness | Bind window.location and the mocked current URL to the same reviewed Apple ID; retain recovery/cap assertions. |
| content.test.js: a missing or disabled Continue/Submit action triggers one broadened required-field recovery pass | Outdated harness | Bind window.location and the mocked current URL to the same reviewed Apple ID; retain recovery/cap assertions. |
| content.test.js: getAlreadyAppliedSignal recognizes ByteDance's exact visible failure message without relying on wrapper classes | Outdated harness | Supply a visible scoped alert node; unscoped body text is covered by a negative regression. |
| content.test.js: the workflow terminates when ByteDance shows an already-applied dialog on a detail page | Outdated harness | Run the retained duplicate-outcome contract on Apple routes with expected ID and deterministic DOM timing. |
| content.test.js: a delayed Apple already-applied dialog stops the workflow before questionnaire fields are read | Outdated harness | Run the retained duplicate-outcome contract on Apple routes with expected ID and deterministic DOM timing. |
| content.test.js: a Apple already-applied dialog is detected after the page shell stabilizes but before the form loads | Outdated harness | Run the retained duplicate-outcome contract on Apple routes with expected ID and deterministic DOM timing. |
| content.test.js: a ByteDance popup mounting during the Submit search interrupts it immediately | Outdated harness | Run the retained duplicate-outcome contract on Apple routes with expected ID and deterministic DOM timing. |
| content.test.js: Apple confirmation waits for Proceed to render and become enabled | Outdated harness | Drive the mocked popup through a virtual delay/clock rather than overriding a bypassed timeout. |
| background.test.js: getSiteConfig recognizes Apple and TikTok/ByteDance hosts | Obsolete expectation | Use Apple fixtures and assert that unsupported legacy URLs are not eligible. |
| background.test.js: the side-panel URL gate recognizes joinbytedance.com consistently with the runtime | Obsolete expectation | Use Apple fixtures and assert that unsupported legacy URLs are not eligible. |
| background.test.js: buildRetryableErrorLinks returns only supported, deduplicated saved error jobs | Outdated harness | Use Apple fixtures and assert that unsupported legacy URLs are not eligible. |
| background.test.js: getSiteLabel resolves from a site id or a URL | Obsolete expectation | Use Apple fixtures and assert that unsupported legacy URLs are not eligible. |
| background.test.js: application workflow carries bounded validation-recovery state across content-script reloads | Outdated harness | Provide expected job identity, the read-only identity probe, and explicit rejected outcome metadata. |
| background.test.js: cached Apple details survive redirected URLs and optional qualifications | Outdated harness | Use the current version-2 cache schema so a valid cache entry avoids tab creation. |
| core.test.js: getSiteConfig and getJobIdFromUrl work identically to the VM-harness-tested copies | Obsolete expectation | Use Apple fixtures and assert that unsupported legacy URLs are not eligible. |
| core.test.js: application question policy keeps non-EEO fixed answers without treating sensitive profile answers as global policy | Obsolete expectation | Use explicit saved eligibility answers; categorical citizenship/immigration status remains unresolved. |
| core.test.js: resolveApplicationQuestion selects Foreigner for Singapore right-to-work status without an OpenAI call | Obsolete expectation | Use explicit saved eligibility answers; categorical citizenship/immigration status remains unresolved. |
| core.test.js: resolveResumeProfileText prefers candidateProfile once populated, falling back to pasted resumeProfile otherwise | Obsolete expectation | Test current PDF text, current extracted profile fallback, and rejection of stale/legacy-only evidence. |
| core.test.js: extractCandidateProfileFromResume returns a clear, actionable error without throwing when a PDF can't be processed | Obsolete expectation | Assert the current PDF extraction retry error instead of the removed paste-input advice. |

No failure was confirmed as a new production implementation defect. No environmental issue prevented the final test runs. A new privacy assertion initially compared objects from different VM realms; comparing a structured clone fixed that test-only prototype mismatch. The storage migration fixture was also normalized to include its current empty application-failure map.

## Obsolete Coverage Removed

**99 complete cases:** 80 from the deleted generic-autofill engine, 11 retired background workflows, six platform-specific content cases, and two Workday-only core cases. The obsolete keyword-exclusion clause in one mixed ranking test was removed while preserving the seniority/experience regression. Mixed matching, prompt, ledger, and DOM-control cases were retained and adapted. Retired host names remain only as rejection/historical-data fixtures; no platform code was restored.

### Removed Case Inventory

#### tests/background.test.js

- Workday retries the same Continue exactly once after rejected visible values are repaired
- Workday auto-apply re-sweeps after Continue and stops at one confirmation-pending Submit
- buildGenericContentProfile keeps form data but strips the OpenAI key before page injection
- persistObservedWorkdayCandidateProfile enriches the single local profile record idempotently
- mergeWorkdayAutofillPage accumulates fields and page-level workflow state
- trusted Workday text repair clears one selected value, inserts its replacement, and detaches
- trusted Workday clicks use a bounded CDP mouse sequence and detach immediately
- Workday URL detection is limited to candidate-facing Workday hosts
- buildNeedsReviewReasonSummary summarizes single vs multiple flagged fields
- generic submit clicks remain confirmation-pending and are never reported as submitted
- shouldAutoSubmitGenericAutofill only submits with zero flagged or unresolved agent fields and auto-apply consent

#### tests/content.test.js

- the question-agent fallback discovers a blank no-marker ByteDance authorization dropdown
- ByteDance Work Authorization module questions remain actionable when Formily omits required markers
- recognizes joinbytedance.com as a supported ByteDance careers host
- recognizes TikTok search detail links but not application links as result cards
- extracts generic career role ids from query parameters
- extracts TikTok and ByteDance role ids from details URLs

#### tests/core.test.js

- mergeObservedWorkdayCandidateProfile enriches missing values without overwriting resume-derived values
- generic 'worked for us' questions derive the employer from a Workday tenant host

#### tests/genericAutofill.test.js

- exposes the generic autofill test API
- Workday candidate dates accept explicit month/year formats and never invent a month from a bare year
- Workday degree matching maps resume degree names only to the equivalent offered degree family
- Workday structured-entry matching prevents duplicate jobs and same-school degrees
- Workday role descriptions use only saved profile content and de-duplicate repeated bullets
- generic question gating skips optional application questions but not optional profile fields
- inferGenericFieldMapping maps contact fields to the right profile key
- inferGenericFieldMapping maps combined-name e-signature fields to fullName, not essay
- inferGenericFieldMapping maps work-authorization and sponsorship questions
- inferGenericFieldMapping applies the fixed no-criminal-history policy without misclassifying background-check consent
- inferGenericFieldMapping maps EEO fields
- inferGenericFieldMapping detects genuine essay questions ahead of other rules
- inferGenericFieldMapping does not treat personal-info fields as essay questions
- inferGenericFieldMapping returns null for unrecognized, non-question fields
- inferGenericFieldMapping treats an unrecognized field phrased as a question as an essay prompt
- inferGenericFieldMapping keeps the non-Workday referral-source policy ahead of the essay check
- Workday field policy overrides are host-scoped
- phone extensions are recognized separately from phone numbers
- Workday dropdown fast path recognizes a real prefilled button and rejects a placeholder
- Workday multi-select fast path trusts selected-item chips instead of search text
- Workday selected-item accessibility statuses are not application questions
- Workday expanded option panels are not inventoried as application dropdowns
- Workday dropdown state trusts the trigger's aria-expanded contract
- Workday progress actions use only the bounded exact-label vocabulary
- inferGenericFieldMapping routes previous-employment questions to candidate profile history
- isReferralSourceQuestion/isPreviousEmploymentQuestion don't false-positive on unrelated questions
- Workday source choice prefers exact LinkedIn, then the shortest observed containing label
- Workday source policy prefers exact Other before any rendered LinkedIn option
- Workday source traversal recognizes the observed Salesforce and Job Board parent categories
- Workday US phone-code matching rejects the similarly named Minor Outlying Islands option
- Workday dropdown verification accepts the exact selected value rendered in its field wrapper
- Workday multi-select verification rejects typed filter text until a selected-item chip exists
- askLlmForAnswer resolves the LLM's resume-grounded answer when chrome.runtime.sendMessage succeeds
- askApplicationQuestionAgent sends the bounded question contract without copying the profile or raw resume
- askLlmForAnswer resolves null (not a popup) when the LLM has no resume-supported answer
- askLlmForAnswer never shows the manual-answer popup, whether or not the LLM answers
- prompt.js's source no longer references window.prompt (removed manual-answer popup)
- the unrelated window.confirm HITL guard on the known-site diagnostic workflow is untouched
- buildOptionMatcher matches yes/no answers, not the opposite
- buildOptionMatcher does substring matching for free-form EEO/location values
- inferGenericFieldMapping distinguishes Address Line 1 from Address Line 2 (regression: both used to map to addressLine1)
- ordinary fields are unaffected by the new Address Line 2 rule
- resolveProfileValue keeps Address Line 1 and Address Line 2 independent (regression: Line 2 used to duplicate Line 1's value)
- resolveProfileValue falls back to the extracted candidateProfile only for fields left blank in the flat autofill profile
- resolveProfileValue keeps non-EEO fixed policies but uses the saved EEO profile
- buildOptionMatcher recognizes the authorized veteran/disability policy wording and rejects decline options
- buildOptionMatcher maps canonical saved EEO values without matching decline options
- hasExpectedFieldValue detects whether a filled field's live value survived later page activity
- hasExpectedFieldValue verifies native selects by selected option text as well as machine value
- Workday validation recognizes a visible field error even when the input still has a value
- hasMeaningfulExistingFieldValue rejects non-empty placeholder select values but keeps real selections
- ordinary text fields still classify and resolve the same way as before (no dropdown-handling regression)
- isEssayQuestionLabel/isWorkAuthorizationQuestion/isVisaSponsorshipQuestion/isAgeEligibilityQuestion behave identically to content.js's originals on shared fixtures
- isElementStillActionable is true for a connected, visible, enabled element
- isElementStillActionable is false once a previously-live element is detached from the page
- isElementStillActionable is false for a zero-size (hidden) element
- isElementStillActionable is false for a disabled element
- describeEnteredValue never includes the actual value for a password-kind field
- describeEnteredValue includes the value for ordinary field kinds
- Workday text commits clear, insert a prefix, and re-add the final character
- the extension declares debugger permission for bounded trusted Workday prompt clicks and rejected-text repair
- Workday listbox backing inputs are not treated as text fields
- Workday multi-select search inputs are not treated as ordinary text fields
- Workday responsive prompts open through the prompt button instead of their hidden search input
- Workday responsive prompt options stay scoped to their associated widget
- Workday responsive prompt distinguishes branch rows from selectable leaves
- Workday trusted prompt clicks target the rendered text node observed in manual input
- Workday source branch success requires a changed non-empty menu inventory
- Workday source refresh can identify the prompt through its tenant-specific input
- Workday promptOption choices are inventoried while committed selected-item chips are excluded
- generic autofill installs its bounded action bridge in the page MAIN world
- the MAIN-world bridge commits Workday text through browser editing and applies resolved clicks
- buildTextFillRetryOutcome reports success with no fallback when the value was present once the page settled
- buildTextFillRetryOutcome reports success when the framework-compatible retry stuck
- buildTextFillRetryOutcome flags the field when the framework-compatible retry ran but still didn't stick
- buildTextFillRetryOutcome flags the field with the specific error when the framework-compatible retry itself failed
- findNextUnhandledFieldEntry returns the first entry not yet in the handled set
- findNextUnhandledFieldEntry returns undefined once every entry has been handled -- the sequential loop's termination condition
- findNextUnhandledFieldEntry recognizes a field replaced by a fresh re-render as already handled (keyed by kind+label, not element identity)
- runGenericAutofill closes its explicit activity cycle in chrome.storage.local

## Harness And Command Repairs

- All current cases use Node’s built-in test runner, including awaited async tests; no manual fail-fast loops remain.
- The default command discovers every top-level test file, enforces a bounded timeout, isolates files, and rejects unmocked fetch calls.
- Content fixtures load the safety dependency, reset Submit state, use real URL objects, bind job identity, and advance virtual clocks.
- Background fixtures supply current Chrome events, session storage, the asynchronous database boundary, identity proofs, cache versions, and outcome metadata.
- Matching fixtures use current parsed-PDF evidence and the current Apple-only support policy.
- Added a development-only locked `fake-indexeddb` dependency to execute the real migration/transaction adapter rather than testing only storage stubs.

## Added Current Coverage

- Eight IndexedDB cases: data/profile/protected-role retention, aborted migration retry, cleanup retry without stale reimport, concurrent startup, targeted patches/deletions, aborted-write rollback/no notification, cross-context notifications/unsubscription, and collection removal.
- Workflow IPC contains only the explicit eligibility settings and reviewed job ID, not the API key or resume/profile.
- Unscoped body text cannot mark a role already applied.
- Existing 40 safety and 16 inventory tests now run in the default command.

## Final Results

| Suite | Passed | Failed |
| --- | ---: | ---: |
| Content | 79 | 0 |
| Background | 54 | 0 |
| Core | 75 | 0 |
| Ranking | 17 | 0 |
| Workflow safety | 40 | 0 |
| Submission inventory | 16 | 0 |
| IndexedDB | 8 | 0 |
| Role UI | 6 | 0 |
| Withdrawals | 3 | 0 |
| **Total** | **298** | **0** |

`npm ci` succeeded. Two complete runs after that clean dependency installation passed with identical totals and zero skipped/todo/cancelled cases. Focused safety and inventory commands passed. `npm run check` (syntax and production build) and `git diff --check` passed. Tested with Node v26.4.0.

## Limits

No live Apple submissions, withdrawals, browser account navigation, or OpenAI requests were performed. DOM/Chrome workflows remain synthetic; `fake-indexeddb` does not verify Chrome disk quota, process termination, or real browser scheduling. Authenticated Apple markup and the real zero-submission page remain integration tests. Other previously identified audit findings were not expanded into production fixes. See [Testing](testing.md).
