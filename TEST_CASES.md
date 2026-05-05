# Test Cases

Use this checklist before publishing or sharing the extension. Prefer testing in a fresh Chrome profile with the extension reloaded from `chrome://extensions` after each code change.

## 1. Install And Permissions

- [ ] **I-01: Fresh install**
  - Steps: Load unpacked extension from this folder.
  - Expected: Extension loads without manifest errors.
- [ ] **I-02: Host permission scope**
  - Steps: Open a non-Apple site and open the popup.
  - Expected: Extension does not try to scan or inject into unrelated sites.
- [ ] **I-03: Apple Careers host**
  - Steps: Open `https://jobs.apple.com/` and open popup.
  - Expected: Popup accepts the page as an Apple Careers page.
- [ ] **I-04: Alternate Apple Careers host**
  - Steps: Open `https://www.apple.com/careers/` and open popup.
  - Expected: Popup accepts the page as an Apple Careers page.
- [ ] **I-05: Reload behavior**
  - Steps: Reload the extension while a previous scan state exists.
  - Expected: Popup renders without crashing; stale scan can be replaced by starting a new scan.

## 2. Job List Scanning

- [ ] **S-01: Start from first results page**
  - Steps: Open Apple Careers list page and click `Start Scan`.
  - Expected: Scan starts, phase changes, queued count appears in details.
- [ ] **S-02: Start from later results page**
  - Steps: Manually go to page 3+, then click `Start Scan`.
  - Expected: Detailed `Pages` counter reflects the current page if Apple exposes it in URL/UI.
- [ ] **S-03: End of page pagination**
  - Steps: Let scan finish all visible jobs on a page.
  - Expected: Extension advances to next page when enabled `Next` exists.
- [ ] **S-04: End of all pages**
  - Steps: Let scan reach final page with no enabled `Next`.
  - Expected: Scan ends with `Complete`; no infinite loop.
- [ ] **S-05: Duplicate links**
  - Steps: Start scan on a list with repeated job links.
  - Expected: Same URL is processed only once per scan run.
- [ ] **S-06: Stop scan**
  - Steps: Click `Stop scan` while scan is running.
  - Expected: Scan stops after current safe point; popup shows stopped state.
- [ ] **S-07: Popup reopen during scan**
  - Steps: Close and reopen popup during active scan.
  - Expected: Live stats resume updating.
- [ ] **S-08: Default scan mode**
  - Steps: Install fresh extension and open the popup.
  - Expected: Scan mode defaults to `Scan only, do not apply`.
- [ ] **S-09: Auto-apply acknowledgement**
  - Steps: Select auto-apply mode but leave the acknowledgement unchecked, then click `Start Scan`.
  - Expected: Scan does not start and the popup asks for acknowledgement.

## 3. Local Matching

- [ ] **M-01: Backend/API role**
  - Example signals: C#/.NET, API, services, AWS, queues.
  - Expected: `Likely match` or `Review`; eligible for auto-apply.
- [ ] **M-02: Full-stack role**
  - Example signals: Angular, TypeScript, API, web app, backend.
  - Expected: `Likely match` or `Review`; eligible for auto-apply.
- [ ] **M-03: QA automation role**
  - Example signals: QA, test automation, Jasmine, MSTest, integration testing.
  - Expected: `Likely match` or `Review`; eligible for auto-apply.
- [ ] **M-04: ML/AI role**
  - Example signals: Python, PyTorch, RAG, LLM, VLM, embeddings.
  - Expected: `Likely match`; eligible for auto-apply.
- [ ] **M-05: Senior title**
  - Example signals: `Senior`, `Staff`, `Principal`, or `Lead` in title.
  - Expected: `Likely skip`; not auto-applied.
- [ ] **M-06: iOS app role**
  - Example signals: iOS, Swift, Objective-C, UIKit, SwiftUI, Xcode.
  - Expected: `Likely skip`; not auto-applied.
- [ ] **M-07: Firmware/driver role**
  - Example signals: firmware, kernel, device driver, embedded.
  - Expected: `Likely skip` unless clearly overridden by relevant domain.
- [ ] **M-08: High required YOE**
  - Example signals: `5+ years required`, `7 years minimum`.
  - Expected: `Likely skip`.
- [ ] **M-09: Preferred YOE only**
  - Example signals: `3+ years preferred`.
  - Expected: Should not hard-skip solely due to preferred wording.
- [ ] **M-10: Generic software role**
  - Example signals: Generic software wording with weak stack overlap.
  - Expected: `Unknown` or `Review`; only `Review` can auto-apply.

## 4. Auto-Apply Workflow

- [ ] **A-01: Standard flow in acknowledged auto-apply mode**
  - Steps: Detail page has `Submit Resume`, then profile pages, then final `Submit`.
  - Expected: Application submits; detail tab closes; `Applied` increments.
- [ ] **A-02: Already submitted on detail page**
  - Steps: Detail page shows `Submitted`.
  - Expected: Job is marked `submitted`; tab closes; no apply failure.
- [ ] **A-03: Already submitted but no Submit Resume**
  - Steps: Detail page lacks `Submit Resume` and shows submitted state.
  - Expected: Job is marked `submitted`, not `*_apply_failed`.
- [ ] **A-04: Questionnaire absent**
  - Steps: Application has no questionnaire step.
  - Expected: Workflow continues normally.
- [ ] **A-05: Questionnaire present**
  - Steps: Questionnaire asks work authorization and visa sponsorship.
  - Expected: Selects `Yes` for both, continues, then submits.
- [ ] **A-06: Questionnaire with unexpected extra question**
  - Steps: Additional radio question appears.
  - Expected: Known questions are answered; workflow logs error if required unknown question blocks progress.
- [ ] **A-07: Session expired/sign-in**
  - Steps: Application redirects to sign-in or page lacks workflow buttons.
  - Expected: Scan logs error with page heading and visible buttons; no infinite loop.
- [ ] **A-08: Missing final Submit**
  - Steps: Review page does not expose final `Submit`.
  - Expected: Error log records last page heading, last step, and visible buttons.
- [ ] **A-09: Repeated no-progress flow**
  - Steps: Same step repeats until max attempts.
  - Expected: Workflow stops at max attempts and logs attempts instead of looping forever.
- [ ] **A-10: Manual workflow diagnostic**
  - Steps: Click `Run current job workflow (can submit)` from Advanced tools.
  - Expected: Popup shows a browser confirmation before any workflow clicks happen. Cancelling leaves the page unchanged.

## 5. Popup UI

- [ ] **U-01: Compact stats**
  - Steps: Start scan and view popup surface.
  - Expected: Surface shows Phase, Applied, Review, Errors, Last applied, and Current job only.
- [ ] **U-02: Last applied job**
  - Steps: Let an application succeed.
  - Expected: `Last applied` shows cleaned job title, role id, and relative time.
- [ ] **U-03: Errors dropdown**
  - Steps: Trigger or observe an error.
  - Expected: `Errors (N)` opens and shows recent error entries.
- [ ] **U-04: Error detail**
  - Steps: Inspect an error entry.
  - Expected: Entry includes role id/title, message, stopped page heading, last step, and visible buttons if available.
- [ ] **U-05: Detailed stats dropdown**
  - Steps: Open `Detailed stats and logs`.
  - Expected: Shows pages, scanned, queued, submitted, match counts, recent failures, and recent jobs.
- [ ] **U-06: Clean titles**
  - Steps: Inspect recent jobs/failures.
  - Expected: Titles do not include `- Jobs - Careers at Apple`.
- [ ] **U-07: Settings help text**
  - Steps: Hover or focus each `?` icon in settings.
  - Expected: A tooltip explains what that setting does.

## 6. Data And Privacy

- [ ] **P-01: LLM disabled by default**
  - Steps: Run scan with network inspector open and LLM disabled.
  - Expected: No resume/job text is sent to third-party APIs.
- [ ] **P-02: LLM enabled disclosure**
  - Steps: Enable LLM matching with an API key and resume summary.
  - Expected: UI clearly states job/profile text may be sent to OpenAI.
- [ ] **P-03: LLM missing key fallback**
  - Steps: Enable LLM matching without an API key and scan a role.
  - Expected: Extension falls back to local matching without crashing.
- [ ] **P-04: Local storage**
  - Steps: Inspect extension storage after scan.
  - Expected: Job records, settings, and scan state are stored locally.
- [ ] **P-05: Clear state**
  - Steps: Clear extension storage and reload popup.
  - Expected: Popup handles missing state cleanly.
- [ ] **P-06: Permission review**
  - Steps: Review `manifest.json`.
  - Expected: Permissions are limited to storage, tabs, scripting, Apple Careers hosts, and optional OpenAI access.
- [ ] **P-07: Clear job history**
  - Steps: Click `Clear job history` after a scan.
  - Expected: Job records and scan history clear, while matching settings remain available.

## 7. Chrome Store Readiness

- [ ] **C-01: Icons**
  - Expected: `16`, `48`, and `128` px PNG extension icons exist before packaging.
- [ ] **C-02: Screenshots**
  - Expected: Store screenshots show popup, progress view, and advanced diagnostics.
- [ ] **C-03: Privacy copy**
  - Expected: Store listing states that local matching is default and OpenAI matching is optional.
- [ ] **C-04: Trademark language**
  - Expected: Listing does not imply Apple affiliation and does not use Apple logos.
- [ ] **C-05: Dry-run mode**
  - Expected: Confirm scan-only mode is the default so users can preview decisions before submit.
- [ ] **C-06: Hosted privacy policy**
  - Expected: Publish `PRIVACY.md` as a public URL and add it to the Chrome Web Store listing.
