# Career Peeler

Unofficial Chrome extension for scanning Apple Careers job lists, matching roles to a local profile, and optionally assisting with applications.

## Current Scope

- Runs on `jobs.apple.com` and `www.apple.com/careers` pages.
- Reads visible page text from the active job page.
- Starts from an Apple Careers list page with one primary `Start Scan` action.
- Scans visible job links from the list page.
- Opens each job detail in a background tab, classifies it with a local scoring engine, and records the decision.
- Defaults to `Scan only` mode so no applications are submitted unless auto-apply is explicitly enabled.
- In auto-apply mode, after an explicit acknowledgement, applies to `Likely match` and `Review` jobs, then closes the tab.
- If a job detail page clearly shows `Submitted`, records it as submitted, closes that tab, and continues with the next job.
- When the current list page is exhausted, advances to the next results page when an enabled `Next` control is available.
- Stores local job records in Chrome storage to track scanned, submitted, likely match, likely skip, review, and unknown statuses.
- Optional LLM-assisted matching sends the job text and your resume/profile summary to OpenAI when enabled. Local matching remains the fallback when LLM mode is off or fails.
- Logs auto-apply failures with the failed job, reason, page heading, and visible action labels so workflow issues can be debugged.
- Analyzes the current application page to preview visible fields, required fields, field categories, upload controls, and visible buttons.
- In acknowledged auto-apply mode, runs the common Apple application workflow on matching jobs: `Submit Resume`, three `Continue` steps, answer visa sponsorship as `Yes` when detected, final `Submit`, then close the submitted tab.
- Finds sentences that mention years of experience.
- Scores resume overlap using keywords from your AI/ML, RAG, vision-language, PyTorch, C#/.NET, Angular, AWS, Terraform, backend/API, full-stack, event/queue systems, cloud infrastructure, QA/test automation, and distributed systems experience.
- Penalizes local mismatch signals such as iOS, Swift, Objective-C, UIKit, SwiftUI, Xcode, macOS app work, mobile app UI, firmware, and high seniority.
- Hard-skips senior/staff/principal/lead titles before auto-apply.
- Classifies roles as `Likely match`, `Likely skip`, `Review`, or `Unknown`.
- Does not upload new files or create profile data. The application workflow assumes your Apple Careers profile, resume, and LinkedIn are already saved.
- This project is not affiliated with Apple.

## Load Locally

1. Open Chrome and go to `chrome://extensions`.
2. Turn on Developer Mode.
3. Click `Load unpacked`.
4. Select this folder: `apple-careers-helper`.
5. Open an Apple Careers list page and click `Start Scan` to classify jobs across pages. Auto-apply is available only after you explicitly enable it in `Matching and application settings`. Manual diagnostics are still available under `Advanced tools`.

## Publishing Checklist

- Add Chrome Web Store screenshots.
- Host a public privacy policy based on `PRIVACY.md` and link it from the Chrome Web Store Developer Dashboard.
- Keep scan-only as the default so users can preview decisions without submitting.
- Ensure listing copy clearly states that OpenAI matching is optional and sends job/profile text externally only when enabled.
- Add resume upload/reset UI before publishing beyond personal use.
- Avoid Apple logos or wording that implies affiliation.
- Keep permissions limited to Apple Careers hosts, optional OpenAI access, storage, tabs, and scripting.
- Run the pre-publish checklist in `TEST_CASES.md`.

## Next Milestones

1. Test list scanning across several Apple search result pages and log false positives.
2. Refine submitted-state and next-page selectors after inspecting real Apple DOM variations.
3. Refine application field categories across real application steps.
4. Add export for locally stored job records and analyzed form fields.
5. Add login/session-state detection and stronger confirmation-state detection.
6. Add configurable auto-apply criteria for `Likely match`, `Review`, and `Unknown`.
