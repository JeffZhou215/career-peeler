# Career Peeler

Unofficial tool that scans Apple Careers, TikTok Careers, and ByteDance Careers job lists, classifies each role against your profile, and can optionally auto-apply. This project is not affiliated with Apple, TikTok, or ByteDance.

Two interfaces share the same matching/apply logic: a **Chrome extension** (the primary interface, reusing your logged-in browser tab) and an **experimental command-line tool** (for headless/scheduled runs, e.g. via cron). CLI auto-apply is experimental and should be monitored. They keep separate local job-tracking history — scanning via one doesn't inform the other.

## How it works

**1. Open a supported job list and start a scan.** Career Peeler discovers the visible Apple, TikTok, or ByteDance job links, opens each detail page in a workflow tab, and returns to the list between jobs. Workflow tabs are activated inside Chrome because some TikTok/ByteDance pages do not render while inactive; the extension does not bring the Chrome window in front of another application.

**2. Extract and evaluate each job.** The content script reads the job description and compares its technical signals against the saved parsed resume profile (or the manually pasted summary fallback). It also checks title/seniority, required years of experience, domain gaps, and any explicit no-match keywords. When LLM-assisted matching is enabled, OpenAI evaluates the job against the same CandidateProfile or saved summary.

**3. Apply or record the decision.** Scan-only mode records the result without opening the application workflow. Acknowledged auto-apply mode can advance through the tuned multi-step Apple/TikTok/ByteDance flows, fill and verify required questions sequentially, attach the saved PDF resume, and click final Submit. A job counts as applied only after the site exposes a success signal; already-applied notices are recorded separately and the workflow tab is closed.

**4. Follow the live execution.** The side panel shows API validation, resume-profile readiness, job-description reads, local and LLM match results, final apply/skip decisions, field actions, verification, submission, errors, and needs-review items. Job titles in activity and progress views link back to the original role.

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
- **Validates the OpenAI API key** before LLM-assisted auto-apply starts. OpenAI is the only implemented provider; `gpt-4o` is the default configured model, while required open-text research uses a bounded `gpt-5.5` Responses request with hosted web search. Local-only scanning and auto-apply remain available with LLM matching disabled.
- **Auto-applies on known sites** only after explicit acknowledgement and completion of the locally stored Required Application Answers. Required fields are filled one at a time and verified; optional questions are skipped. Fixed policies handle recognized authorization/date questions locally. Required EEO questions use saved profile values locally without sending them to OpenAI. Unknown required questions invoke the agent only for open text or dropdowns: text answers can combine resume facts with public company/role research, while dropdowns are restricted to exact observed options. On generic/Workday forms, recognizable previous-employer Yes/No groups are the narrow option-group exception: the answer is derived locally from CandidateProfile employer history and is never globally defaulted to No.
- **Tracks applied and error jobs durably** by supported site plus job ID (with a URL fallback), exposes independent clear controls, and retries saved error jobs without rescanning list pages.
- **Reviews Apple submissions** from the signed-in Your Roles page, ranks active roles against the saved profile, and offers a confirmed batch-withdraw flow that refreshes the remaining active list afterward. The first-pass score uses each role's title and department, not its full job description.
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
