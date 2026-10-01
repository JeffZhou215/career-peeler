# Career Peeler

Unofficial tool that scans Apple Careers, TikTok Careers, and ByteDance Careers job lists, classifies each role against your profile, and can optionally auto-apply. This project is not affiliated with Apple, TikTok, or ByteDance.

Two interfaces share the same matching/apply logic: a **Chrome extension** (the primary interface, reusing your logged-in browser tab) and an **experimental command-line tool** (for headless/scheduled runs, e.g. via cron). CLI auto-apply is experimental and should be monitored. They keep separate local job-tracking history — scanning via one doesn't inform the other.

## How it works

**1. Open a supported job list and start a scan.** Career Peeler discovers the visible Apple, TikTok, or ByteDance job links, opens each detail page in a workflow tab, and returns to the list between jobs. Workflow tabs are activated inside Chrome because some TikTok/ByteDance pages do not render while inactive; the extension does not bring the Chrome window in front of another application.

**2. Extract and evaluate each job.** The content script reads the job description and compares its technical signals against the saved parsed resume profile (or the manually pasted summary fallback). It also checks title/seniority, required years of experience, domain gaps, and any explicit no-match keywords. When LLM-assisted matching is enabled, OpenAI evaluates the job against the same CandidateProfile or saved summary.

**3. Apply or record the decision.** Scan-only mode records the result without opening the application workflow. Acknowledged auto-apply mode can advance through the tuned multi-step Apple/TikTok/ByteDance flows, fill and verify required questions sequentially, attach the saved PDF resume, and click final Submit. A job counts as applied only after the site exposes a success signal; already-applied notices are recorded separately and the workflow tab is closed.

**4. Follow the live execution.** The side panel shows API validation, resume-profile readiness, job-description reads, local and LLM match results, final apply/skip decisions, field actions, verification, submission, errors, and needs-review items. Job titles in activity and progress views link back to the original role.

### Ranked Apple job queue

The side panel uses folded function sections; opening one closes the previous section. Submission reviews, ranked jobs, shared matching settings, and activity/advanced tools each have their own section. Click the small **?** beside a function for its description. Job rows keep the title, job ID, status, and score visible; expand a row for explanations, evidence, and its job-page link. Active runs keep **Stop** accessible even when folded.

In **Submitted Application Review**, the **View** dropdown loads all saved roles, the current page with saved scores, individual saved pages, or the last complete scan. **Protected Roles** stays separate and cannot be selected for withdrawal. Select roles and click **Review Withdrawal** to check their titles and IDs in the confirmation dialog.

In **Ranked Job Queue**, **Scan Details** contains cache counts, saved filters, and **Refresh Submission Count**. **Match Concerns And Exclusions** and **Saved Queue** are folded; expand **Saved Queue** to review/remove queued roles, acknowledge match concerns, and allow application submission. Matching settings, application history, logs, and maintenance actions are available in their respective folded sections.

Open an Apple jobs search with your chosen filters and click **Rank Filtered Search** in **Ranked Job Queue**. The extension starts at page 1, evaluates every page, and saves results as it goes. Repeat with other filters to combine candidates; overlapping job IDs are deduplicated. Saved descriptions and unchanged resume/model scores are reused. Stop or API errors preserve completed scores, and quota failures show OpenAI's detailed error.

Ranking weighs demonstrated responsibilities (40%), minimum qualifications (35%), level (15%), and domain (10%). Strong matches have at least 80 overall, strong responsibility/qualification/level scores, high confidence, checked resume quotations, and evidence for every minimum qualification. Preferred qualifications do not disqualify a role. Lower scores, missing qualifications, and unverified evidence remain visible as match concerns. The original list-scan matching gate still requires a strong LLM match; the ranked queue lets you explicitly choose and acknowledge scored jobs with concerns.

Set **Top Matches (N)** to view the highest scored jobs, including jobs with match concerns. Each job shows its assessment and specific concerns. **Match Concerns And Exclusions** summarizes missing or unverified qualifications, insufficient evidence, confidence, score, unfinished matching, and explicit exclusions. **Scanned Filters** also counts jobs skipped because they were previously applied. Equivalent Unicode punctuation and numeric qualification IDs returned as strings are accepted when verifying quotations; paraphrases and invented experience remain rejected. Saved assessments are rechecked against cached descriptions without another LLM request when available.

Ranking saves scores; click **Queue Top N** to save the highest-ranked scored jobs across saved filters, including jobs with match concerns. N is at least the remaining capacity (`50 − active submissions`); the queue can hold extra candidates. Previously applied or withdrawn jobs, explicit title/experience/keyword exclusions, unscored jobs, and applications with unresolved outcomes are omitted. If fewer than N scored jobs are available, those available are queued. Use the job ID/title search and Fit Evidence to review the queue and remove any role you do not want. Search filters the display; Queue Top N uses the saved ranking.

**Refresh Submission Count** reads active submissions without LLM matching. Use it to obtain the count before ranking, update it after changes outside the extension, or resolve an interrupted application's current status.

**Apply Queue** requires permission to submit, a validated API key, a current resume, and Required Application Answers. If queued jobs have match concerns, also check **I Reviewed Match Concerns For … Queued Jobs And Want To Apply**. That acknowledgement is tied to the current assessments and must be renewed if they change. Applying refreshes the live active submission count without rescoring submissions, applies saved jobs in descending score order, and stops at the conservative 50-application target. Extra jobs stay queued. Apple may exempt some roles from its cap; this queue counts every visible active submission. Successful withdrawals update saved capacity. Each posting is checked for changes before applying. Interrupted or uncertain submissions reserve a slot and stop the queue until Apple is checked again. Apple Auto Apply list scans now rank first; submission happens from the queue. No applications are submitted while ranking.

**Failed Applications And Manual Review** stores every failed queue job's title, ID, job-page link, specific reason, last step, and time across runs and extension reloads. The job ID/title search includes these records. A missing Continue/Submit action, changed posting, or a form rejection before a confirmed submission is logged for manual review and the queue continues with the next saved job. Failures also appear in **Activity And Advanced Tools → Scan Progress → Errors**. They are kept out of automatic replay and the legacy Retry Error Jobs action. Open the job link to review it manually; **Refresh Submission Count** updates records when the job appears in active submissions.

The queue pauses for an unknown submission outcome, an expired Apple session, API access/rate-limit failures, or a changed assessment that needs acknowledgement. Unknown outcomes keep their reserved slot, and the error message links to the affected job. Refresh the submission count before retrying or resuming. Older saved review/uncertain jobs also appear in the failure list without a rescan; older logs may lack the exact last step or failure time.

The original May screenshots have been removed from this walkthrough because they show the retired popup-era UI. Current side-panel captures are still needed; see `store-assets/PRIVATE_LISTING.md` for the exact capture checklist.

### Stored job statuses

| Status | Meaning |
| --- | --- |
| `seen` | Scanned, no strong match/skip signal |
| `reviewed` | Worth a manual look |
| `likely_match` | Strong local fit |
| `likely_skip` | Poor fit, or hard-skipped (seniority, internship, YOE, no-match keyword) |
| `submitted` | Already applied, or detected as already submitted |
| `applied` | Submitted by this run and confirmed by a site success signal |
| `needs_review` | Automation or LLM evidence was insufficient to decide or submit safely |
| `*_apply_failed` | An eligible job entered the application workflow but did not finish |

Previously scanned jobs are skipped across sessions, and pagination advances automatically when the current list page is exhausted.
Confirmed/apparently already-submitted jobs also enter a durable, site-qualified applied ledger, so they remain skipped even after the compact general history is pruned. Job-specific failures remain in a separate saved Errors ledger and can be retried directly without scanning or paginating through the original job list again. Successful retries remove only the resolved error; interrupted retries leave it available.

The side panel provides separate `Clear Applied Jobs` and `Clear Error Jobs` controls. Each makes those jobs eligible for discovery again and leaves the other ledger untouched. `Clear Job History` resets both ledgers, compact job records, detailed logs, and scan progress while preserving settings, API credentials, and resume/profile data.

## What it does

- **Scans** Apple Careers, TikTok Careers, and ByteDance Careers list pages, across pagination, skipping jobs it's already seen.
- **Classifies** each job first by comparing role signals with skills, domain expertise, and experience in the saved CandidateProfile or summary, alongside deterministic title, years-of-experience, and domain-gap checks; OpenAI can add a second opinion.
- **Hard-skips** manager/senior/staff/principal/lead titles, internships, explicit no-match keywords, and roles whose required experience clearly exceeds the saved profile. Missing evidence for specialist domains lowers the local fit and remains reviewable by the LLM. The no-match list remains as a user-authored hard constraint because resume fit scoring cannot express every personal exclusion.
- **Extracts a CandidateProfile** from one PDF resume through OpenAI, caches it against that exact PDF, and uses it for matching, application answers, and autofill. Replacing the PDF invalidates the cached extraction. A manually pasted profile summary remains available as a fallback.
- **Validates the OpenAI API key** before LLM-assisted auto-apply starts. OpenAI is the only implemented provider; `gpt-4o` is the default configured model, while required open-text research uses a bounded `gpt-5.5` Responses request with hosted web search. Local-only scanning remains available; Apple's ranked application queue requires LLM matching.
- **Auto-applies on known sites** only after explicit acknowledgement and completion of the locally stored Required Application Answers. Required fields are filled one at a time and verified; optional questions are skipped. Fixed policies handle recognized authorization/date questions locally. Required EEO questions use saved profile values locally without sending them to OpenAI. Unknown required questions invoke the agent only for open text or dropdowns: text answers can combine resume facts with public company/role research, while dropdowns are restricted to exact observed options. On generic/Workday forms, recognizable previous-employer Yes/No groups are the narrow option-group exception: the answer is derived locally from CandidateProfile employer history and is never globally defaulted to No.
- **Tracks applied and error jobs durably** by supported site plus job ID (with a URL fallback), exposes independent clear controls, and retries saved error jobs without rescanning list pages.
- **Reviews Apple submissions** from the signed-in Your Roles page using cached descriptions and qualifications, ranks active roles against the saved profile, protects starred/interview roles, and offers a confirmed batch-withdraw flow that updates the saved list afterward.
- **Stores settings and profile data locally** in Chrome storage. OpenAI receives data only for an enabled/requested LLM operation; the selected PDF is sent when CandidateProfile extraction is requested.
- **Autofills other job application pages** (Greenhouse, Lever, Workday, custom ATS) on demand. Unknown sites use a single-page sequential sweep: it fills and verifies recognized fields, retries rejected controlled inputs through framework-compatible native setter/events, and flags unresolved required fields. Workday is the bounded multi-page exception; its adapter commits controlled text and already-matched dropdown clicks through a narrow page-context bridge, treats search-backed multi-selects as offered-option widgets rather than text fields, can add and verify CandidateProfile work-experience/education records, learns populated Workday entries back into the same Chrome-local CandidateProfile, and continues through exact Workday forward actions. Generic Submit is reported as **clicked, confirmation pending**, never as a confirmed application.

## Load locally (Chrome extension)

The side panel is a Vite + React app; `background.js`/`content.js`/`genericAutofill/`/`lib/` stay as plain, unbundled scripts and are copied through verbatim. `npm run build` produces the complete loadable extension in `dist/` — that folder, not the repo root, is what you point Chrome at.

1. `npm install && npm run build` (re-run `npm run build` after any code change; `npm run dev` runs Vite in watch mode for active side-panel development).
2. Open Chrome and go to `chrome://extensions`.
3. Turn on Developer Mode.
4. Click `Load unpacked` and select this repo's `dist/` folder.
5. Click the Career Peeler toolbar icon to open the side panel — it docks to the side of the window and stays open as you switch tabs. Open a supported careers list page and click `Scan Visible Job List`. Auto-apply stays off until you enable it under `Matching And Application Settings` and acknowledge that it can submit real applications.

## Private beta distribution

This repository is currently being prepared for a private Chrome Web Store listing restricted to trusted testers. The store submission fields, permission explanations, privacy answers, tester instructions, and outstanding screenshot inputs are maintained in `store-assets/PRIVATE_LISTING.md`.

Before sharing a build, review the current fixed application-answer policies. This working version still contains personal defaults for required authorization, sponsorship, criminal-history, and age-eligibility questions. Previous-employment answers are derived from CandidateProfile employer history, while EEO answers are configurable per profile and required before auto-apply; the remaining fixed answers are appropriate only for a tester whose real circumstances match them.

## Command-line tool

Experimental interface that drives a real Playwright-controlled Chromium browser. Scan-only runs are suitable for testing; CLI auto-apply and the direct `apply` command should be monitored and their results manually verified. It reuses `content.js` and the shared matching/LLM logic in `lib/core.js` verbatim; only the browser-automation layer (`cli/`) differs from the extension's `background.js`.

```bash
npm install                        # installs playwright
npx playwright install chromium    # one-time browser download (skip if already cached)

node cli/index.js login apple      # opens a browser window; log in manually, then press Enter
node cli/index.js config --set userYearsOfExperience=3 --set scanMode=scan_only
node cli/index.js scan https://jobs.apple.com/en-us/search
```

Or, after `npm link` (or installing globally), use the `career-peeler` command directly, e.g. `career-peeler scan <list-url>`.

Other commands: `config` (view/update your profile), `status` (print the current/last scan), `stop` (stop a scan running in another terminal), `history [--clear]` (view/clear tracked job records), `apply <application-url>` (run the apply workflow against an already-open application page). Run `career-peeler --help` for the full flag list.

Data (browser session, profile, scan state, job records) lives in `~/.career-peeler/` by default (override with `--data-dir` or `$CAREER_PEELER_DATA_DIR`) — deliberately outside the repo, since it holds your OpenAI API key and login session.

### Example: `career-peeler scan`

While a scan runs, one status line updates in place (like `docker pull`'s progress line), and a permanent one-line log prints each time a job finishes:

```text
$ career-peeler scan https://jobs.apple.com/en-us/search --scan-only
Scanning https://jobs.apple.com/en-us/search (scan-only mode)...
[Scanning job detail] scanned=1 queued=18 applied=0 likely_match=0 likely_skip=1 reviewed=0 needs_review=0 errors=0
  -> likely_skip (Likely skip): Senior Software Engineer, Partner Onboarding
  -> reviewed (Review): Software Engineer, Maps Search
[Advancing to next page] scanned=20 queued=0 applied=0 likely_match=3 likely_skip=9 reviewed=8 needs_review=0 errors=0
^C
Stopping after the current step finishes (press Ctrl+C again to force exit)...
Done: Stopped
```

Piping output to a file (or running non-interactively) drops the in-place redraw and just logs each status change as its own line instead, so logs stay readable.

## Publishing checklist

- Verify extension icons render correctly in Chrome and capture current Chrome Web Store screenshots.
- Keep the current logo/icon identity. The three existing `1280x800` screenshots and two promotional images predate the side panel and multi-site/generic workflows; do not submit them until they are replaced with the current captures described in `store-assets/PRIVATE_LISTING.md`.
- Host a public privacy policy based on `PRIVACY.md` and link it from the Chrome Web Store Developer Dashboard.
- Keep scan-only as the default so users can preview decisions without submitting.
- Ensure listing copy explains every OpenAI-assisted operation: API-key validation, job matching, PDF CandidateProfile extraction, and required-question resolution.
- Add an explicit resume remove/reset control and make personal application-answer policies configurable before distribution beyond matching trusted testers.
- Avoid Apple logos or wording that implies affiliation.
- Explain the current `storage`, `tabs`, `scripting`, `sidePanel`, `debugger`, and `<all_urls>` permissions accurately.
- Run the pre-publish checklist in `TEST_CASES.md`.

## Current limitations

- Apple/TikTok/ByteDance automation depends on those sites' current DOM and may stop for review when a page changes or a success signal cannot be confirmed.
- Generic autofill handles one visible page per click and cannot confirm what happens after it clicks Submit.
- Resume extraction accepts PDF only, and OpenAI is the only LLM provider.
- The model field is free-form; an unsupported model is detected only when OpenAI rejects a request.
- Fixed personal application answers are not yet configurable across all automation paths.
- CLI auto-apply and direct CLI `apply` remain experimental and should be monitored.
- Long-running MV3 scan recovery, stop ordering, and standalone application-tab ownership still need additional hardening.
