# Explicit Saved Application Answers

Baseline: `5a028d1b4adeb22dd3d7a7464ef41dd00c8440f6`. Private-release target: **0.2.2**. This work replaces remaining fixed personal application answers and rebuilds the local private package. Nothing was uploaded or published, and no real Apple submission or withdrawal was performed.

## Root Causes

- `lib/core.js:getApplicationQuestionPolicy()` answered criminal-history questions No and selected the nearest future start date, regardless of the user's circumstances.
- `content.js:answerQuestionnaire()` used Yes for age eligibility and No for prior Apple employee/contractor questions.
- `resolvePreviousEmployerQuestionFromProfile()` treated absence from a resume as a negative employment-history answer.
- A filled control could bypass missing-answer checks, and the final read-only review page skipped the editable questionnaire path.

## Changes

- Shared `CareerPeelerApplicationSafety.applicationQuestionPolicy()` now resolves personal screening answers from explicit saved values. Work authorization/sponsorship keep their dedicated settings; simple age and Apple employment questions have new unset/Yes/No settings. Required EEO answers keep their existing dedicated settings.
- `applicationQuestionAnswers` stores exact-question Yes/No choices. Criminal-history, contractor, differently scoped and other binary screening questions use these choices rather than inferred answers. Matching normalizes case/whitespace only and preserves wording/punctuation. A blanket criminal No or inferred negative employment history is no longer available.
- `availableStartDate` accepts a valid calendar date or an explicitly selected `immediate`. Past dates, ambiguous date labels, unsupported formats, unavailable exact dates and binary availability questions require manual review. No nearest-date fallback remains.
- Both modern and legacy question-answer routes stop missing or unsupported personal answers before any LLM call. Grounded essay drafting remains separate. Personal settings are not added to job-matching prompts.
- Setup exposes the new fields and an exact-question editor. New/legacy profiles leave new answers unset; PDF upload/extraction does not derive or overwrite these answers.
- The worker forwards only the personal-answer whitelist to the page, without API keys or resume contents.
- `verifySavedApplicationAnswers()` checks filled and unfilled required personal controls, preserves conflicts, verifies read-only review rows and repeats immediately before Continue/Submit after awaited ownership checks. Detached controls, changed labels, changed answers and ambiguous combined review rows stop safely. Optional/voluntary questions remain untouched.
- Existing exact-job binding, workflow recovery, capacity checks, one-use final Submit and withdrawal safeguards remain in place.

## Verification

- **Full suite: 672 passed, 0 failed**, no skipped/cancelled tests.
- Runtime syntax checks and Vite production build passed using `npm run release:private`.
- Regression coverage includes both Yes and No, blank defaults, restart/profile normalization, PDF replacement, scoped question differences, explicit-date matching/expiry, no LLM calls for missing personal answers, existing prefills, controlled-input resets, changed labels, stale elements, late changes after ownership authorization, combined read-only review sections, optional questions, and worker message privacy.
- Four store screenshots render the actual React interface with synthetic data in an isolated headless browser; external requests are blocked. The new screenshot shows unset personal fields and the exact-question editor.
- The private package is generated from runtime-only `dist/` contents, with a checksum and source/file-hash manifest. See `docs/releases/PRIVATE_RELEASE.md` for installation and remaining publisher inputs.

## Remaining Integration Limits

Live Apple review formatting and complex custom controls can differ from the fixtures. Recognized personal questions whose answer association or control cannot be verified remain manual tasks. No claim is made that every future Apple question is supported. Native Chrome/Apple end-to-end submission behavior was not exercised. Installation-specific withdrawal protections and the matching experience default were preserved; each tester must review their own matching settings.
