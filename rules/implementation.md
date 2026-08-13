# Implementation conventions

## Prefer extending over parallel systems

Before adding a new capability, find the existing abstraction that's closest to it and extend that -
don't build a second form-filler, a second classifier, or a second resume-reading path next to an
existing one. This codebase already has scar tissue from being careful here; keep it that way.

## Comments explain WHY, never WHAT

This repo's comments are almost all "here's the non-obvious reason", not "here's what this line does".
Examples already in the code: a 240-char `maxLength` field silently rejecting a long LLM answer, a
button-group matcher accidentally swallowing an entire "Application Questions" section on a real Uber
application, a custom-select trigger button masquerading as a yes/no option. When you touch code that
has one of these comments, keep it (or update it if the fix changes) - it's there because the bug
actually happened once. Don't add comments that just restate the code; well-named functions already do
that.

## `genericAutofill/*.js`'s shared-namespace pattern

No bundler, so these files share state via a single `window.__careerPeelerGA` object (aliased `GA`)
instead of import/export:

- Each file destructures what it needs off `GA` at the top, and calls `Object.assign(GA, {...})` at the
  bottom to publish its own exports.
- **Load order matters and is declared in two places that must stay in sync**: `background.js`'s
  `GENERIC_AUTOFILL_FILES` array, and `tests/genericAutofill.test.js`'s own copy of that same array
  (`domHelpers → classify → actions → snapshot → prompt → loop → agent`).
- When you add a new function meant to be used by another file in this family, **you must add it to the
  `Object.assign(GA, {...})` call at the bottom of its defining file** - forgetting this produces a
  silent-until-runtime `"X is not a function"` error in whichever file destructures it, since nothing
  catches a missing GA export at write time.
- `content.js` has its own, separately-maintained copy of similar DOM helpers
  (`genericAutofill/domHelpers.js` is deliberately duplicated, not shared) - the two flows are tuned for
  different risk levels and are not meant to converge. See `browser-agent.md`.

## Testing

- No test framework - `tests/*.test.js` are hand-written Node scripts run via `node tests/x.test.js`,
  wired together in `package.json`'s `test` script. Run `npm test` (all suites) and `npm run check`
  (`node --check` syntax validation on every server/content/CLI file, plus `vite build`) before calling
  a change done.
- `tests/content.test.js` / `tests/genericAutofill.test.js` execute the **real source files** inside a
  hand-rolled `vm.createContext` sandbox (mirrors `chrome.scripting.executeScript`'s injection
  semantics) - there's no jsdom, so only pure, DOM-independent functions (label classification, option
  matchers) get direct unit tests this way. DOM-mutating functions (`fillTextField`,
  `simulateRealClick`, etc.) have no direct unit tests today - a known, accepted gap; don't feel
  obligated to close it as a side effect of an unrelated change.
- Async tests use a manual pattern, not `async` arrows passed straight to a sync `test()` helper: an
  `asyncTests` array, an `asyncTest(name, fn)` registrar, and a trailing
  `(async () => { for (...) { await fn() } })().catch(...)` IIFE that sets `process.exitCode = 1` on
  failure. Mirror this exact shape (see `tests/core.test.js`) rather than inventing a different one.

## No blocking popups for ordinary "I don't know the answer" cases

Never fall back to `window.prompt()`/`alert()` to ask the user to manually answer a form field the
autofill sweep couldn't resolve - leave it blank and flag it for review; the target site's own
validation surfaces the problem. `window.confirm()` is still the right tool for a genuinely irreversible
action ("this will submit the application, continue?") - that's a different category (destructive-action
confirmation) from answer-elicitation, and should not be removed.

## Resume/profile data

`profile.resumeProfile` (a saved free-text summary) is the **existing** "read the resume" abstraction
fed to the LLM (`lib/core.js`'s `generateFreeTextAnswer`, already grounded + anti-fabrication-guarded).
`profile.resumeFileDataUrl` is only the raw uploaded file bytes, used solely for the
`DataTransfer`-based file-upload trick - it is never parsed for text. There is no PDF/DOCX text
extraction anywhere in this repo; don't assume one exists, and don't add one without discussing it
first (it's a real new subsystem, not a small change).
