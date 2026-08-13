# Career Peeler architecture

Chrome MV3 extension (unofficial job-application assistant). Two **separate** automation systems live
side by side on purpose - do not merge them or route one through the other:

1. **Known-site workflow** (`content.js`) - a tuned, multi-step "click Continue, wait, repeat" flow for
   exactly three sites: Apple (`jobs.apple.com`), TikTok, ByteDance. Site identity, URL patterns, and
   button-label regexes live in a `SITE_CONFIGS` object. `content.js` also does job-description scoring
   (`extractJobDetails`, `analyzeLocalMatch`) and list-page scanning/pagination for these sites.
2. **Generic autofill** (`genericAutofill/*.js`) - a single-page "snapshot the form, classify each field,
   act" sweep used by the "Autofill this page" button for **any other site**. Deterministic pattern
   classification, not an LLM choosing actions turn by turn - see `browser-agent.md` for the internals.

`SITE_CONFIGS` is duplicated (not imported) between `content.js` and `lib/core.js` - keep both in sync
by hand when adding/changing a supported site.

## Shared logic and multiple runtimes

`lib/core.js` holds all pure logic with **zero** `chrome.*` or DOM dependency (site config, YOE
hard-skips, LLM prompts/calls, job-record shaping) so it loads two different ways with no build step:

- `background.js`: `importScripts("lib/core.js")` - classic MV3 service worker.
- `cli/orchestrator.js`: `require("../lib/core.js")` - a Node + Playwright port of the same scan/apply
  orchestration, for running scans headlessly outside the extension (`cli/browser.js`,
  `cli/store.js`, `cli/index.js`).

**Never add a `chrome.*` call or DOM access to `lib/core.js`** - it would break the CLI half. If new
logic needs the DOM, it belongs in `content.js` or `genericAutofill/`, and background.js/cli should call
into it via message-passing / page-evaluation respectively.

## Extension shell

- `background.js` - MV3 service worker. Message routing (`chrome.runtime.onMessage`), scan state
  persisted to `chrome.storage.local`, orchestrates `content.js` and `genericAutofill/` via
  `chrome.tabs.sendMessage` / `chrome.scripting.executeScript`.
- `manifest.json` - `content.js` is statically declared for the three known-site hosts only.
  `genericAutofill/*.js` is **never** declared in `content_scripts` - it's injected on demand, only when
  the user clicks "Autofill this page" (see `background.js`'s `GENERIC_AUTOFILL_FILES` array).
- `src/sidepanel/` - React 19 + Vite side panel UI (persistent panel, not a popup). Mid-migration off a
  single `sidepanel.js` + `styles.css` (both marked for deletion) onto `hooks/`, `lib/`, `components/`.
  Don't add new code to the old files.

## No bundler for the injected/service-worker layer

`content.js`, `background.js`, `lib/core.js`, and every `genericAutofill/*.js` file are plain scripts
with no ES module import/export - only `src/sidepanel/` goes through Vite/Rollup. Keep it that way:
pulling `lib/core.js` into the Vite module graph would break `background.js`'s `importScripts`.
