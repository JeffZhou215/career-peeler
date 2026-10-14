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

## Testing

- Use Node's built-in `node:test` and `node:assert/strict`. `npm test` discovers `tests/*.test.js`
  and `tests/*.test.mjs`, including safety and inventory regressions. Run it and `npm run check`
  (syntax validation plus the production build) before calling a change done.
- Test callbacks may be async; return/await all work so the runner observes failures. Keep cases
  that mutate a shared VM sandbox sequential and restore mocked methods in `finally`. Use fresh
  contexts or virtual clocks for stateful application/polling tests rather than real timer waits.
- Content/background fixtures load the **real source** into classic-script VM contexts. Fake Chrome
  tabs, events, messages and storage never control a real browser. The storage suite loads the real
  IndexedDB adapter against the development-only `fake-indexeddb` implementation.
- The default runner rejects unmocked fetch requests. API tests must provide explicit response
  fixtures. Never perform live Apple applications or withdrawals during automated verification.
- See `docs/testing.md` for fixture boundaries and integration limitations. Do not restore removed
  platform code merely to satisfy an obsolete test.

## No blocking popups for ordinary "I don't know the answer" cases

Never fall back to `window.prompt()`/`alert()` to ask the user to manually answer a form field the
autofill sweep couldn't resolve - leave it blank and flag it for review; the target site's own
validation surfaces the problem. `window.confirm()` is still the right tool for a genuinely irreversible
action ("this will submit the application, continue?") - that's a different category (destructive-action
confirmation) from answer-elicitation, and should not be removed.

## Resume/profile data

Resume input is PDF-only. The local PDF.js parser preserves full text in profile.resumeText, paired with resumeTextFingerprint. LLM profile extraction receives the original PDF. Both matchers use current raw text when available, otherwise the profile extracted from that PDF. Never use stale extraction from a replaced file. The old resumeProfile field is retained for storage compatibility and is not exposed or used as resume input.
