# Career Peeler Architecture

Apple Careers is the only supported employer. The React/Vite side panel has Jobs, Submissions, and Setup tabs. Keep workflow logic in the background/content layer, and UI controls in src/sidepanel.

- background.js orchestrates Apple workflows and runtime messages.
- content.js reads Apple pages, matches local resume evidence, fills required questions, and verifies actions.
- lib/appleRankingWorker.js ranks complete filtered searches and applies saved queues.
- lib/appleSubmissionSync.js observes confirmed applications and reconciles counts without interrupting workflows.
- lib/appleJobStore.js supplies the shared IndexedDB job store, automatic transactional migration and cross-context change notifications. Use it for job data in both background and side panel; content scripts must not access IndexedDB directly because their database origin would belong to Apple.
- lib/jobRanking.js supplies pure ranking and capacity helpers.
- lib/core.js supplies pure profile, prompt, and LLM helpers shared with the experimental Apple CLI. Never add Chrome APIs or DOM dependencies here.

The service worker and content scripts remain classic, unbundled scripts. Vite bundles only src/sidepanel and the local PDF parser/worker. Keep both SITE_CONFIGS copies and both profile normalization copies in sync.

The profile stays under appleCareersUserProfile. Preserve Apple history, caches, queue records, and protected job 200654506 during migrations. Full parsed PDF text and the structured profile are tied to the PDF fingerprint. Resume entry is PDF-only; no pasted resume field.

Jobs, descriptions, submission scores/pages, application/error ledgers and activity live in IndexedDB (CareerPeelerJobs). Profile and small live status records remain in Chrome storage. Never reintroduce job cache writes to chrome.storage.local. Scan hot paths use per-record reads and patches; full-map replacements are reserved for batch edits. Notify the side panel after committed database writes. Migrate and verify a committed marker before removing legacy source keys.

Jobs uses one ranked list with view filters and one Application Queue. Keep concerns inside role cards and application failures in Activity, rather than introducing more queue-like lists.

Automatic applications follow a complete ranking and use strong matches only. Manual application batches require explicit queued-role selection and confirmation; bind review to the selected IDs and assessments, process only those roles, and leave unselected roles queued. Selected batches can include explicitly acknowledged concerns. Verify active submissions before applying; reserve ambiguous outcomes. Withdrawals require selection and confirmation, re-find each role after page changes, and protect starred or unknown-star roles.
