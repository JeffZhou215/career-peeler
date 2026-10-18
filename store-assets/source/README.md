# Store Asset Provenance

Generated October 18, 2026 for the Apple-only Rolebeam 0.2.4 private-beta preparation. These are local release assets, not evidence of a Chrome Web Store upload or approval.

## UI Screenshots

`capture-current-ui.cjs` renders the repository's **actual React side-panel source** through Vite in a new isolated headless Chrome context. It captures Jobs, Setup, Submissions, the expanded Application Profile and the model selection sheet, then composites each unmodified 450 × 800 capture onto a 1280 × 800 caption background.

- Uses the current App/components/styles; does not draw or imitate a replacement product interface.
- Chrome APIs are mocked and submission archive data uses the real IndexedDB adapter in the isolated origin.
- Job titles, synthetic IDs, scores, counts and scan state are **offline demonstration data**. They are not actual Apple postings or matching results.
- No personal applicant identity, PDF, real API key, saved legal/EEO answer, real history or account is loaded. The model-sheet capture uses an explicit nonfunctional placeholder and a synthetic available-model response.
- Every non-localhost request is blocked. No Apple/OpenAI request, submission or withdrawal occurs.
- Operation message handlers return an offline error except read-only ranking data and the explicitly mocked placeholder key/model discovery. View tabs, disclosure summaries and the model-sheet opener are clicked during capture. No application, withdrawal, consent or personal-answer action is selected.
- No real Chrome profile/session is accessed.
- Caption panels explicitly label the source-rendered UI and dummy data.
- This proves visual rendering, not native extension permission handling, worker recovery or live Apple integration.

Reproduce with an installed Playwright-compatible Chrome and Sharp:

```sh
npm run dev -- --host 127.0.0.1 --port 4177 --strictPort --force
# In another terminal, with playwright and sharp available to Node:
node store-assets/source/capture-current-ui.cjs
```

If dependencies are outside this repository, set `NODE_PATH` to their absolute `node_modules` directory. The script defaults to installed Google Chrome; `CAREER_PEELER_CAPTURE_BROWSER` can select another installed Playwright browser channel. No capture tools are included in the extension ZIP.

The first three PNGs retain historical filenames for listing compatibility:

- `screenshot-1-overview-1280x800.png`: Jobs, complete filter ranking and ranked roles.
- `screenshot-2-settings-1280x800.png`: Setup without uploaded resume or credential.
- `screenshot-3-progress-logs-1280x800.png`: Submissions, capacity/sync, filters and protected role.
- `screenshot-4-application-answers-1280x800.png`: Setup's expanded Application Profile and Saved Question Answers, scrolled to the blank personal-answer controls. Shows unset answers, an empty start date, unchecked immediate availability and the exact-question editor.
- `screenshot-5-model-picker-1280x800.png`: native model selection sheet with Recommended and searchable compatible entries. The list is synthetic and does not establish any real key's model access.

Inspect all outputs visually after rerunning. Dates/relative time are generated from the capture time; demo status must never be represented as a live verified account.

## Promotional Images And Icon

`icons/icon128.svg` is the canonical hand-authored Letterform mark. `render-icons.cjs` derives the 16, 48 and 128 pixel SVG/PNG variants and copies the 128 pixel PNG to `store-icon-128x128.png`. `render-promos.cjs` uses Sharp to render the adjacent SVG sources at exactly 440 × 280 and 1400 × 560, preserving the same brand: white R, mint `#78edd0` accent and deep-indigo `#25215a` background.

```sh
node store-assets/source/render-icons.cjs
node store-assets/source/render-promos.cjs
```

Promotional copy is Apple-only and includes the unofficial/private-beta context. No Apple logo or fabricated browser/account screenshot is used. Existing multi-platform promotional copy is replaced.
