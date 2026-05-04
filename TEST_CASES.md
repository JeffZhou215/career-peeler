# Test Cases

Use this checklist before publishing or sharing the extension. Prefer testing in a fresh Chrome profile with the extension reloaded from `chrome://extensions` after each code change.

## 1. Install And Permissions

| ID | Scenario | Steps | Expected Result |
| --- | --- | --- | --- |
| I-01 | Fresh install | Load unpacked extension from this folder. | Extension loads without manifest errors. |
| I-02 | Host permission scope | Open a non-Apple site and open the popup. | Extension does not try to scan or inject into unrelated sites. |
| I-03 | Apple Careers host | Open `https://jobs.apple.com/` and open popup. | Popup accepts the page as an Apple Careers page. |
| I-04 | Alternate Apple Careers host | Open `https://www.apple.com/careers/` and open popup. | Popup accepts the page as an Apple Careers page. |
| I-05 | Reload behavior | Reload the extension while a previous scan state exists. | Popup renders without crashing; stale scan can be replaced by starting a new scan. |

## 2. Job List Scanning

| ID | Scenario | Steps | Expected Result |
| --- | --- | --- | --- |
| S-01 | Start from first results page | Open Apple Careers list page and click `Start Scan`. | Scan starts, phase changes, queued count appears in details. |
| S-02 | Start from later results page | Manually go to page 3+, then click `Start Scan`. | Detailed `Pages` counter reflects the current page if Apple exposes it in URL/UI. |
| S-03 | End of page pagination | Let scan finish all visible jobs on a page. | Extension advances to next page when enabled `Next` exists. |
| S-04 | End of all pages | Let scan reach final page with no enabled `Next`. | Scan ends with `Complete`; no infinite loop. |
| S-05 | Duplicate links | Start scan on a list with repeated job links. | Same URL is processed only once per scan run. |
| S-06 | Stop scan | Click `Stop scan` while scan is running. | Scan stops after current safe point; popup shows stopped state. |
| S-07 | Popup reopen during scan | Close and reopen popup during active scan. | Live stats resume updating. |
| S-08 | Default scan mode | Install fresh extension and open the popup. | Scan mode defaults to `Scan only, do not apply`. |
| S-09 | Auto-apply acknowledgement | Select auto-apply mode but leave the acknowledgement unchecked, then click `Start Scan`. | Scan does not start and the popup asks for acknowledgement. |

## 3. Local Matching

| ID | Scenario | Example Signals | Expected Result |
| --- | --- | --- | --- |
| M-01 | Backend/API role | C#/.NET, API, services, AWS, queues | `Likely match` or `Review`; eligible for auto-apply. |
| M-02 | Full-stack role | Angular, TypeScript, API, web app, backend | `Likely match` or `Review`; eligible for auto-apply. |
| M-03 | QA automation role | QA, test automation, Jasmine, MSTest, integration testing | `Likely match` or `Review`; eligible for auto-apply. |
| M-04 | ML/AI role | Python, PyTorch, RAG, LLM, VLM, embeddings | `Likely match`; eligible for auto-apply. |
| M-05 | Senior title | `Senior`, `Staff`, `Principal`, or `Lead` in title | `Likely skip`; not auto-applied. |
| M-06 | iOS app role | iOS, Swift, Objective-C, UIKit, SwiftUI, Xcode | `Likely skip`; not auto-applied. |
| M-07 | Firmware/driver role | firmware, kernel, device driver, embedded | `Likely skip` unless clearly overridden by relevant domain. |
| M-08 | High required YOE | `5+ years required`, `7 years minimum` | `Likely skip`. |
| M-09 | Preferred YOE only | `3+ years preferred` | Should not hard-skip solely due to preferred wording. |
| M-10 | Generic software role | Generic software wording with weak stack overlap | `Unknown` or `Review`; only `Review` can auto-apply. |

## 4. Auto-Apply Workflow

| ID | Scenario | Steps | Expected Result |
| --- | --- | --- | --- |
| A-01 | Standard flow in acknowledged auto-apply mode | Detail page has `Submit Resume`, then profile pages, then final `Submit`. | Application submits; detail tab closes; `Applied` increments. |
| A-02 | Already submitted on detail page | Detail page shows `Submitted`. | Job is marked `submitted`; tab closes; no apply failure. |
| A-03 | Already submitted but no Submit Resume | Detail page lacks `Submit Resume` and shows submitted state. | Job is marked `submitted`, not `*_apply_failed`. |
| A-04 | Questionnaire absent | Application has no questionnaire step. | Workflow continues normally. |
| A-05 | Questionnaire present | Questionnaire asks work authorization and visa sponsorship. | Selects `Yes` for both, continues, then submits. |
| A-06 | Questionnaire with unexpected extra question | Additional radio question appears. | Known questions are answered; workflow logs error if required unknown question blocks progress. |
| A-07 | Session expired/sign-in | Application redirects to sign-in or page lacks workflow buttons. | Scan logs error with page heading and visible buttons; no infinite loop. |
| A-08 | Missing final Submit | Review page does not expose final `Submit`. | Error log records last page heading, last step, and visible buttons. |
| A-09 | Repeated no-progress flow | Same step repeats until max attempts. | Workflow stops at max attempts and logs attempts instead of looping forever. |
| A-10 | Manual workflow diagnostic | Click `Run current job workflow (can submit)` from Advanced tools. | Popup shows a browser confirmation before any workflow clicks happen. Cancelling leaves the page unchanged. |

## 5. Popup UI

| ID | Scenario | Steps | Expected Result |
| --- | --- | --- | --- |
| U-01 | Compact stats | Start scan and view popup surface. | Surface shows Phase, Applied, Review, Errors, Last applied, and Current job only. |
| U-02 | Last applied job | Let an application succeed. | `Last applied` shows cleaned job title, role id, and relative time. |
| U-03 | Errors dropdown | Trigger or observe an error. | `Errors (N)` opens and shows recent error entries. |
| U-04 | Error detail | Inspect an error entry. | Entry includes role id/title, message, stopped page heading, last step, and visible buttons if available. |
| U-05 | Detailed stats dropdown | Open `Detailed stats and logs`. | Shows pages, scanned, queued, submitted, match counts, recent failures, and recent jobs. |
| U-06 | Clean titles | Inspect recent jobs/failures. | Titles do not include `- Jobs - Careers at Apple`. |
| U-07 | Settings help text | Hover or focus each `?` icon in settings. | A tooltip explains what that setting does. |

## 6. Data And Privacy

| ID | Scenario | Steps | Expected Result |
| --- | --- | --- | --- |
| P-01 | LLM disabled by default | Run scan with network inspector open and LLM disabled. | No resume/job text is sent to third-party APIs. |
| P-02 | LLM enabled disclosure | Enable LLM matching with an API key and resume summary. | UI clearly states job/profile text may be sent to OpenAI. |
| P-03 | LLM missing key fallback | Enable LLM matching without an API key and scan a role. | Extension falls back to local matching without crashing. |
| P-04 | Local storage | Inspect extension storage after scan. | Job records, settings, and scan state are stored locally. |
| P-05 | Clear state | Clear extension storage and reload popup. | Popup handles missing state cleanly. |
| P-06 | Permission review | Review `manifest.json`. | Permissions are limited to storage, tabs, scripting, Apple Careers hosts, and optional OpenAI access. |
| P-07 | Clear job history | Click `Clear job history` after a scan. | Job records and scan history clear, while matching settings remain available. |

## 7. Chrome Store Readiness

| ID | Scenario | Expected Result |
| --- | --- | --- |
| C-01 | Icons | `16`, `48`, and `128` px PNG extension icons exist before packaging. |
| C-02 | Screenshots | Store screenshots show popup, progress view, and advanced diagnostics. |
| C-03 | Privacy copy | Store listing states that local matching is default and OpenAI matching is optional. |
| C-04 | Trademark language | Listing does not imply Apple affiliation and does not use Apple logos. |
| C-05 | Dry-run mode | Confirm scan-only mode is the default so users can preview decisions before submit. |
| C-06 | Hosted privacy policy | Publish `PRIVACY.md` as a public URL and add it to the Chrome Web Store listing. |
