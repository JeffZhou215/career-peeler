# Career Peeler Architecture

Apple Careers is the only supported employer. The React/Vite side panel has Jobs, Submissions, and Setup tabs. Keep workflow logic in the background/content layer, and UI controls in src/sidepanel.

- background.js orchestrates Apple workflows and runtime messages.
- content.js reads Apple pages, matches local resume evidence, fills required questions, and verifies actions.
- lib/appleRankingWorker.js ranks complete filtered searches and applies saved queues.
- lib/appleSubmissionSync.js observes confirmed applications and reconciles counts without interrupting workflows.
- lib/jobRanking.js supplies pure ranking and capacity helpers.
- lib/core.js supplies pure profile, prompt, and LLM helpers shared with the experimental Apple CLI. Never add Chrome APIs or DOM dependencies here.

The service worker and content scripts remain classic, unbundled scripts. Vite bundles only src/sidepanel and the local PDF parser/worker. Keep both SITE_CONFIGS copies and both profile normalization copies in sync.

The profile stays under appleCareersUserProfile. Preserve Apple history, caches, queue records, and protected job 200654506 during migrations. Full parsed PDF text and the structured profile are tied to the PDF fingerprint. Resume entry is PDF-only; no pasted resume field.

Automatic applications follow a complete ranking and use strong matches only. Reviewed application queues can include explicitly acknowledged concerns. Verify active submissions before applying; reserve ambiguous outcomes. Withdrawals require selection and confirmation, re-find each role after page changes, and protect starred or unknown-star roles.
