# Career Peeler

Unofficial Chrome extension for scanning supported career job lists, matching roles to a local profile, and optionally assisting with applications.

## List Scan Workflow

This milestone focuses on safe list scanning with local job tracking:

1. Open a supported careers **jobs list** page and click **Scan visible job list**.
2. The extension collects visible job links from the list tab and keeps that tab as the source of truth.
3. Each job opens in a background detail tab, gets classified, and is saved locally in Chrome storage.
4. If a detail page clearly shows a submitted state, the job is marked `submitted`, the detail tab closes, and the queue continues.
5. Previously scanned jobs are skipped across sessions using stored job IDs and URLs.
6. When the current page is exhausted, the scanner advances to the next results page when available.
7. **Extract current page** remains available under **Advanced tools** for one-off analysis of the active tab.

### Stored Job Statuses

Each scanned job is stored locally with one of these statuses:

- `seen`: scanned but no strong match/skip signal
- `reviewed`: worth manual review
- `likely_match`: strong local fit
- `likely_skip`: poor fit or hard-skipped
- `submitted`: already applied or detected as submitted

In default **Scan only** mode, the extension does not autofill forms, upload files, or submit applications. Auto-apply is optional and requires explicit acknowledgement in settings.

## Current Scope

- Runs on Apple Careers, TikTok Careers, and ByteDance Careers pages.
- Reads visible page text from the active job page.
- Starts from a supported careers list page with one primary `Start Scan` action.
- Scans visible job links from the list page.
- Automatically identifies the current career site and uses the matching list/detail/application workflow.
- Opens each job detail in a background tab, classifies it with a local scoring engine, and records the decision.
- Defaults to `Scan only` mode so no applications are submitted unless auto-apply is explicitly enabled.
- In auto-apply mode, after an explicit acknowledgement, applies to `Likely match` and `Review` jobs, then closes the tab.
- If a job detail page clearly shows `Submitted`, records it as submitted, closes that tab, and continues with the next job.
- When the current list page is exhausted, advances to the next results page when an enabled `Next` control is available.
- Stores local job records in Chrome storage to track scanned, submitted, likely match, likely skip, reviewed, and seen statuses.
- Optional LLM-assisted matching sends the job text and your resume/profile summary to OpenAI when enabled. Local matching remains the fallback when LLM mode is off or fails.
- Logs auto-apply failures with the site, job ID, error type, reason, page heading, visible action labels, and recovery link so workflow issues can be reviewed and submitted manually later.
- Analyzes the current application page to preview visible fields, required fields, field categories, upload controls, and visible buttons.
- In acknowledged auto-apply mode, runs the site-specific application workflow on matching jobs: open the application action, continue through known steps, answer work authorization or visa sponsorship as `Yes` when detected, final `Submit`, then close the submitted tab.
- Finds sentences that mention years of experience.
- Scores resume overlap using keyword categories configurable to your own skills and experience, plus your own no-match keyword denylist for domains you want to skip.
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
5. Open a supported careers list page and click `Scan visible job list` to classify jobs across pages. Auto-apply is available only after you explicitly enable it in `Matching and application settings`. Manual diagnostics are still available under `Advanced tools`.

## Publishing Checklist

- Verify extension icons render correctly in Chrome and add Chrome Web Store screenshots.
- Use the generated Chrome Web Store images in `store-assets/`: three `1280x800` screenshots, `promo-small-440x280.png`, `promo-marquee-1400x560.png`, and `store-icon-128x128.png`.
- Host a public privacy policy based on `PRIVACY.md` and link it from the Chrome Web Store Developer Dashboard.
- Keep scan-only as the default so users can preview decisions without submitting.
- Ensure listing copy clearly states that OpenAI matching is optional and sends job/profile text externally only when enabled.
- Add resume upload/reset UI before publishing beyond personal use.
- Avoid Apple logos or wording that implies affiliation.
- Keep permissions limited to supported careers hosts, optional OpenAI access, storage, tabs, and scripting.
- Run the pre-publish checklist in `TEST_CASES.md`.

## Next Milestones

1. Test list scanning across several Apple search result pages and log false positives.
2. Refine submitted-state and next-page selectors after inspecting real Apple DOM variations.
3. Refine application field categories across real application steps.
4. Refine login/session-state detection and stronger confirmation-state detection across more real site variants.
5. Add configurable auto-apply criteria for `Likely match`, `Review`, and `Unknown`.
