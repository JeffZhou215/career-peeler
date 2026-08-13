# Browser automation internals

## The generic-autofill pipeline is snapshot -> classify -> act, not an LLM tool loop

`genericAutofill/loop.js`'s own top comment says it best: "roughly analogous to Pie's runAgentLoop --
except the 'decide' step here is deterministic pattern classification, not an LLM choosing actions turn
by turn." Concretely:

- `snapshot.js`'s `snapshotPage()` is the single upfront DOM read - walks the page once and returns a
  flat list of `field` / `question` / `dropdown` / `file` entries. Modeled on "Pie"'s
  `extractPageContentHardened` (single self-contained read primitive), but the result is **never**
  handed to an LLM to pick actions from.
- `classify.js` is pure label -> concept classification (`inferGenericFieldMapping`,
  `findAllQuestionContainers`, `buildOptionMatcher`, etc.) - no DOM mutation, only `querySelector`-style
  reads. Keep it that way so it stays directly unit-testable via the VM harness (see
  `implementation.md`).
- `actions.js` is the only file that should perform real DOM mutations/clicks (`fillTextField`,
  `selectMatchingOption`, `simulateRealClick`, `clickOptionMatchingText`, `openDropdownAndSelectOption`,
  `waitForSettle`, ...).
- `loop.js` orchestrates the three above, one field/question/dropdown entry at a time.

The LLM is used for exactly two narrow, one-shot calls, both in `lib/core.js`, both grounded in
`profile.resumeProfile` with an explicit anti-fabrication instruction baked into the prompt:
`getLlmMatch` (job/resume fit scoring) and `generateFreeTextAnswer` (drafting an essay-style answer).
**Never let the LLM choose which DOM element or action to take** - if a future change wants that, it's a
materially different, higher-risk design than what's here today and should be discussed explicitly
rather than folded into an incremental change.

## Field/question mapping shapes (`classify.js`'s `inferGenericFieldMapping`)

Three action types, matched in this order (most specific first, essay last):

- `{action:"map", profileKey}` - value comes from the user's saved profile.
- `{action:"fixed", value}` - one universally-correct answer regardless of profile (e.g. previous-
  employment questions are always "No"; the referral-source question is always "LinkedIn"). Use this,
  not a new ad-hoc branch, for any future "the answer is always X" concept.
- `{action:"essay"}` - free-text, routed to the LLM (`askLlmForAnswer` in `prompt.js`), grounded in
  `resumeProfile`. If the LLM has nothing, the field is left blank and flagged - never a popup.

`QUESTION_RULES` in `loop.js` mirrors this for radio/button-group entries: a `matcher` function plus
either a `profileKey` (profile lookup) or a `fixedValue` (same "always X" concept).

## Never guess at an unconfirmed widget interaction

Custom dropdown widgets (`role=combobox`/`listbox`) are **not** auto-filled by default - only detected
and flagged - because guessing at an unproven widget's open/select interaction is riskier than asking
the user once. Only add a narrowly-scoped exception (matching one specific, high-confidence question,
like the referral-source -> "LinkedIn" case in `loop.js`'s dropdown loop) - never a general "autofill
any custom dropdown" primitive.

Same logic for every click-based fill: **verify the click actually took effect**
(`isOptionConfirmedSelected`) rather than assuming a `.click()` succeeded. This caught real
"answered" questions on a live application that were still failing the site's own required-field
validation afterward. Use `waitForSettle()` (`MutationObserver` + polling quiet-period) to confirm a
click actually changed the page before deciding what happened next - don't substitute a fixed
`setTimeout` delay.

## Known-site workflow (`content.js`) is a different risk tier

The three tuned sites get a multi-step "click Continue, wait, repeat" loop with retry/attempt caps
(`runApplicationWorkflow` in both `background.js` and its `cli/orchestrator.js` port). This is
deliberately **not** shared with `genericAutofill/`'s single-page-only design - chaining multi-step
navigation across an arbitrary, never-seen site is materially riskier than doing it on the three
well-understood ones. Don't try to unify the two flows.
