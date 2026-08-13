# Side panel UI

React 19 + Vite (`@vitejs/plugin-react`), built via `npm run dev` / `npm run build` into `dist/`, loaded
by `manifest.json`'s `side_panel.default_path`. It's a persistent docked panel, not a transient popup -
`background.js` calls `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})` on every
service-worker startup.

## Mid-migration - don't add to the old files

The extension is moving off a single `sidepanel.js` + `styles.css` (both marked for deletion in the
current diff) onto `src/sidepanel/{hooks,lib,components}/`. Put new UI code in the new structure, not
the old files.

## `lib/core.js` is duplicated here on purpose, not imported

`src/sidepanel/lib/profile.js` re-implements `lib/core.js`'s profile normalization
(`normalizeUserProfile` -> `normalizeProfile`, `normalizeUserYearsOfExperience`,
`normalizeNoMatchKeywords`, etc.) rather than importing it. This mirrors the same duplication tradeoff
as `genericAutofill/domHelpers.js` vs `content.js`: `lib/core.js` is deliberately kept a plain,
unbundled script so `background.js`'s `importScripts` still works, and pulling it into the Vite/Rollup
module graph would fight that. **When the profile shape changes, update both copies by hand** -
`lib/core.js`'s `normalizeUserProfile` and `src/sidepanel/lib/profile.js`'s `normalizeProfile` must stay
field-for-field identical.

## Storage contract

The entire profile - known-site settings (YOE, LLM config, no-match keywords) *and* the generic-autofill
fields (contact info, EEO, resume) - lives in **one** object under the single `chrome.storage.local` key
`appleCareersUserProfile` (`USER_PROFILE_KEY`). Don't split it into multiple storage keys.

`useUserProfile()`'s `save(updates)` returns the just-saved, normalized profile - callers that need the
new value immediately (starting a scan, running autofill) should use that return value, not the hook's
own `profile` from the current render's closure, which can be stale relative to an in-flight save.

## Popups: confirm() vs. prompt()

`window.confirm(...)` (see `KnownSitesSection.jsx`) is the right tool for an irreversible-action gate -
"this will click through and submit the application, continue?" - and should be preserved. It is a
different category from asking the user to type an ordinary form answer, which should never interrupt
with a popup (see `implementation.md` / `browser-agent.md`) - don't conflate the two when touching
either.
