# Career Peeler — Apple Careers

An unofficial Apple Careers extension with an iOS-inspired side panel: **Jobs**, **Submissions**, and **Setup**.

## Setup

1. Upload a text-based PDF resume in Setup. Full text is parsed on your device and saved in Chrome local storage. An existing saved PDF is parsed automatically after upgrading.
2. Enable LLM Matching, enter your OpenAI API key, and choose Test API Key. The model remains configurable.
3. Review your experience setting and required application answers. The LLM extracts your candidate profile directly from the PDF; full parsed text is also used as matching evidence when available.

Image-only PDFs use the LLM-extracted profile for matching. The PDF, parsed text, and extracted profile stay in the existing profile record; uploading a different PDF invalidates stale text and profile evidence.

## Jobs

Open an Apple search with your filters, then choose Scan And Rank. Every search page is read, and full descriptions, responsibilities, minimum qualifications, and preferred qualifications are cached. Local matching provides evidence; LLM matching assesses responsibilities, minimum qualifications, level, and domain.

- **Review Then Apply:** review ranked jobs, queue Top N or selected jobs, then review and confirm the saved application batch.
- **Auto Apply Strong Matches:** explicitly allow submission, then scan the complete filtered search before applying its highest-ranked strong matches. Jobs with concerns remain available for review. A stopped or failed scan never starts automatic applications.
- **Resume Scan:** continue a partial filter scan from its saved page, reusing valid scores. Keep the same filter open; changing the resume or matching settings starts a fresh scan.

Before applying, the extension verifies all active Apple submissions and limits submissions to 50 active applications. Additional jobs stay queued. Apple may exempt some roles from its own cap, so this is a conservative target. Previously applied or withdrawn jobs are excluded. Unknown submission outcomes reserve a slot and pause the queue; known failures before submission are logged and skipped. Activity stores failed job links, reasons, last steps, and times.

Workflow tabs stay in the Chrome window where the run started.

## Submissions

Open Your Roles → Submissions → Active, then Scan And Match All. Results appear and are saved page by page, with lowest-fit unprotected roles first. Stopping or an OpenAI quota failure preserves usable saved results.

Sync Submissions updates the active list and count without LLM rescoring. It opens a temporary background tab in the same Chrome window and closes that tab when finished, including after errors. Your current tab and search filters remain in place. Existing matching scores are retained, and new roles remain unscored until matched. Saved results load immediately when the panel opens.

Search by title or job ID, select specific roles, and confirm the withdrawal sheet. Starred roles, unknown star status, and role **200654506** are protected. Withdrawal re-finds each job after Apple changes pagination or returns to page one. Every successful withdrawal updates the saved list.

Detected manual submissions update the application ledger. Returning to Your Roles triggers a background reconciliation when no workflow is running. The last verified count is available from its help button; counts are verified again before queue application.

## Build And Load

```sh
npm install
npm run build
```

Load `dist/` through Chrome → Extensions → Developer Mode → Load Unpacked. Reload the extension after rebuilding. Saved Apple data is retained by the same Chrome extension installation.

Only the React side panel is bundled. `background.js`, `content.js`, and `lib/` remain classic scripts copied into `dist/`. The local PDF parser and worker are bundled with the extension; no remote scripts are loaded.

## Scope And Privacy

Apple Careers is the sole supported employer. TikTok, ByteDance, generic autofill, and Workday automation are removed. Host access is restricted to Apple Careers and the OpenAI API. See [PRIVACY.md](PRIVACY.md).

The Apple CLI remains experimental and shares the pure core logic. The browser extension is the primary workflow.
