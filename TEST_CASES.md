# Private Beta Test Cases

Use this checklist before uploading or sharing a private-beta package. Test in a dedicated Chrome profile with the extension loaded from a fresh `dist/` build. Reload the unpacked extension after every code change.

Automated release checks:

```bash
npm test
npm run test:cli
npm run check
```

`npm run check` performs syntax checks and a production Vite build. There is no separate lint or typecheck script.

## 1. Install and permissions

- [ ] **I-01: Fresh production build**
  - Steps: Run `npm run build`, load `dist/` from `chrome://extensions`, and open the toolbar action.
  - Expected: No manifest/runtime error; the persistent Career Peeler side panel opens.
- [ ] **I-02: Supported-site recognition**
  - Steps: Visit one Apple, TikTok, and ByteDance list URL declared in `manifest.json`.
  - Expected: `Scan Visible Job List` accepts each page and starts the corresponding known-site scanner.
- [ ] **I-03: Passive unrelated-page behavior**
  - Steps: Visit an unrelated HTTP/HTTPS page without clicking Career Peeler actions.
  - Expected: No generic script is injected and no page field is read or changed merely because the extension is installed.
- [ ] **I-04: User-invoked generic injection**
  - Steps: Open an unrelated test application, expand `Other Job Sites`, and click `Autofill This Page`.
  - Expected: Generic scripts are injected only into the selected tab after the click.
- [ ] **I-05: Workday controlled-input commit**
  - Steps: On two different Workday tenants, autofill a required text field, a month/year field, and a value that Workday had already marked required/empty.
  - Expected: Ordinary values are committed through the page-context browser-editing pipeline and survive blur/page settle. After Continue exposes an explicitly rejected visible text value, Career Peeler focuses and fully selects only that field, performs one trusted Backspace plus bounded text insertion, freshly verifies the exact value and cleared error, and retries the same Continue no more than once. Chrome may briefly show its debugging banner during rejected-field repair. A failed repair stops for review rather than looping.
- [ ] **I-06: Workday responsive referral prompt**
  - Steps: On at least two Workday tenants whose required `How Did You Hear About Us?` fields use different nested responsive-prompt hierarchies, run autofill with no source selected. Include one tenant offering exact `Other` and Salesforce with only `External Career Site Sources` → `LinkedIn Connection Post`.
  - Expected: Before ordinary text autofill, Career Peeler reuses a source prompt that is already open; it does not toggle that prompt closed on a rerun. Otherwise it opens and freshly re-reads the prompt. It selects exact `Other` whenever offered. When Salesforce has no exact `Other`, it first applies the captured page-context sequence to the type-2 `External Career Site Sources` row and inventories the replacement level. If verification shows that the branch did not open, it performs one bounded trusted retry centered on the inner rendered `promptOption` text node observed in a successful manual click. It follows the same verified sequence for the type-1 `LinkedIn Connection Post` leaf. On the Job Board fixture it opens `Job Board` and selects its LinkedIn-containing leaf. The source text input remains empty throughout. Every branch transition is proven by a changed non-empty option inventory, and every selected value is freshly verified through a matching selected-item chip. The collapsed `Select` activity detail lists every child option observed after opening the branch; zero visible options are never reported as an opened branch. If the branch does not open, the detail explicitly says so and lists the unchanged root options. A discovered leaf that does not commit is reported as such instead of being rewritten as “no matching child.” If an Other/LinkedIn-labelled match opens another child category, Career Peeler follows only newly rendered preferred children and stops after at most four levels. Chrome may briefly show its debugging banner for trusted input. The extension stops for review if no recognized source parent/preferred leaf is offered or the final chip cannot be verified.
- [ ] **I-07: Reload recovery**
  - Steps: Reload the extension with saved settings/history and reopen the side panel.
  - Expected: The side panel renders without crashing and displays persisted profile/history state.

## 2. Known-site scanning

- [ ] **S-01: Apple discovery and pagination**
  - Steps: Start from an Apple list with multiple results/pages.
  - Expected: Visible unique jobs are queued, duplicates are ignored, and enabled pagination advances until the last page.
- [ ] **S-02: TikTok discovery and pagination**
  - Steps: Repeat on TikTok Careers, including a client-side-rendered next page.
  - Expected: The scanner waits for list rendering and does not stop merely because navigation is client-side.
- [ ] **S-03: ByteDance discovery and pagination**
  - Steps: Repeat on a ByteDance or Join ByteDance list using its current numbered/next controls.
  - Expected: Pages advance without an unbounded retry loop.
- [ ] **S-04: Workflow-tab activation without window focus**
  - Steps: Keep another desktop application in front while a TikTok/ByteDance scan opens a job/application tab.
  - Expected: Chrome activates the workflow tab inside its own window so the page renders, but does not bring the Chrome window to the foreground; the list tab is reactivated afterward.
- [ ] **S-05: Stored duplicate skip**
  - Steps: Finish or stop a scan, then scan the same list again without clearing history.
  - Expected: Stored jobs are not reopened; `Skipped (stored)` increases.
- [ ] **S-06: Stop scan**
  - Steps: Click `Stop scan` while a job is being processed.
  - Expected: The scanner stops at a safe checkpoint and does not begin another job.
- [ ] **S-07: End of list**
  - Steps: Reach a page with no usable next control.
  - Expected: Phase ends as complete; no polling or navigation loop continues.
- [ ] **S-08: Retry saved error jobs without rescanning the list**
  - Steps: Produce two job-specific Errors, then click `Retry Error Jobs` without reopening the original list page. Stop after the first job and start the retry again.
  - Expected: Only saved supported-site error URLs are opened; collection and pagination do not run. Successfully reprocessed jobs leave the Errors list, newly failing jobs remain, and an unattempted second job survives Stop for the next retry.
- [ ] **S-09: Durable applied/error ledgers and independent clears**
  - Steps: Confirm one Apple application, record one TikTok/ByteDance job error, restart Chrome, and reopen the side panel. Re-scan the Apple list, then test `Clear Applied Jobs` and `Clear Error Jobs` separately.
  - Expected: Both saved counts survive restart; the applied job is skipped by its site-qualified ID even if compact history has been pruned; each clear action requires confirmation, clears only its own ledger and related compact records, and makes those jobs discoverable again.

## 3. Matching, OpenAI, and CandidateProfile

- [ ] **M-01: Scan-only default**
  - Steps: Clear extension storage and reopen settings.
  - Expected: Scan mode is `Scan only, do not apply`; auto-apply consent is unchecked; LLM matching is off.
- [ ] **M-02: Deterministic hard skip**
  - Steps: Evaluate manager/senior/staff/principal/lead/intern titles, an explicit no-match keyword, and a required-YOE overage.
  - Expected: Final result is a reasoned skip and the LLM is not called.
- [ ] **M-03: Preferred YOE is not a hard requirement**
  - Steps: Evaluate a role where higher YOE appears only as preferred/nice-to-have.
  - Expected: It is not hard-skipped solely for preferred YOE.
- [ ] **M-04: Local and LLM activity are distinct**
  - Steps: Enable LLM matching and evaluate a non-hard-skipped job.
  - Expected: Activity shows separate `Local match`, `LLM match`, and `Evaluate job match` entries; the final entry includes apply/skip and its reason.
- [ ] **M-05: 70% recall threshold**
  - Steps: Use a result at or above 70% with only limited learnable-tool gaps and no hard disqualifier.
  - Expected: The reconciled result may become `Review`, making it eligible for acknowledged auto-apply; the LLM's raw reason/gaps remain visible.
- [ ] **M-06: LLM failure is not a silent skip/apply**
  - Steps: Force a timeout, provider error, or malformed response for a job without a deterministic hard skip.
  - Expected: The job becomes `needs_review`, an error is visible, and no application workflow starts.
- [ ] **M-07: API-key validation states**
  - Steps: Test an absent key, rejected key, temporary provider/network failure, and valid key.
  - Expected: UI distinguishes not-tested, invalid, error, and valid states without exposing the key in activity/log output.
- [ ] **M-08: LLM-assisted auto-apply readiness**
  - Steps: Enable auto-apply plus LLM matching with an unvalidated key.
  - Expected: Scan does not start and asks for a valid tested key. Disable LLM matching and repeat.
  - Expected: Local-only auto-apply remains available after consent.
- [ ] **M-09: PDF-only resume**
  - Steps: Attempt DOC/DOCX and then PDF selection in both resume pickers.
  - Expected: Non-PDF files are rejected and cleared; the PDF is stored once and shown as the shared current resume.
- [ ] **M-10: CandidateProfile extraction and reuse**
  - Steps: With a valid OpenAI configuration, select a PDF and extract the profile; start another scan with the same PDF.
  - Expected: Structured fields are populated and editable; the matching scan reuses the fresh profile instead of extracting once per job.
- [ ] **M-11: CandidateProfile invalidation**
  - Steps: Replace the PDF while an old CandidateProfile exists.
  - Expected: The old extraction is treated as stale and is not used for matching or questions; the new PDF requires extraction.
- [ ] **M-12: API-call count**
  - Steps: Run several LLM-matched jobs and inspect Scan Progress.
  - Expected: `API calls` increases for actual completion calls and does not count the free key-validation probe.

## 4. Known-site auto-apply

- [ ] **A-01: Consent guard**
  - Steps: Select auto-apply without checking its acknowledgement and start a scan.
  - Expected: The scan does not start and no application control is clicked.
- [ ] **A-02: Confirmed successful application**
  - Steps: Complete a test application that exposes a known success signal.
  - Expected: The job becomes `applied`, `Applied` increments exactly once, `Last applied` updates, and the owned workflow tab closes.
- [ ] **A-03: ByteDance success page**
  - Steps: Reach the page containing `Thanks for your interest in ByteDance` and `We have received your resume`.
  - Expected: Submission is confirmed without a false `confirmation pending` error.
- [ ] **A-04: TikTok already-applied dialog**
  - Steps: Reach `Application Failed` / `You've already applied for this job. Unable to apply again.`
  - Expected: Detection happens before unrelated work-auth filling; the job becomes `submitted`, no apply failure is counted, and the workflow tab closes.
- [ ] **A-05: Other already-submitted signal**
  - Steps: Open a detail or application page already showing Submitted/Applied.
  - Expected: The workflow exits without clicking Submit again.
- [ ] **A-06: Optional question**
  - Steps: Include an unanswered optional radio, select, checkbox, or text question such as Apple's resume-parsing feedback.
  - Expected: It remains unanswered, does not invoke the question agent, and does not block the next step.
- [ ] **A-07: Fixed required question**
  - Steps: Present a required recognized authorization/date/EEO question whose offered option matches the configured current policy.
  - Expected: The deterministic policy is applied and verified without an OpenAI call.
- [ ] **A-07b: ByteDance authorization module without required markers**
  - Steps: Use the ByteDance `Work Authorization` Formily variant whose authorization and sponsorship fields have `data-form-field-i18n-name` labels and read-only `.ud__select__selector` controls, but no `required`, `aria-required`, or asterisk marker.
  - Expected: A visible Submit button does not make the live one-page form look like a read-only review step. The two recognized authorization questions receive the fixed Yes policies and are verified; Activity shows each Select result. If deterministic selection fails, the blank dropdown remains available to the bounded question-agent fallback. Unrelated unmarked or explicitly optional questions remain skipped.
- [ ] **A-08: Unknown required question**
  - Steps: Present a required why-company or other unsupported question with LLM capability available.
  - Expected: Activity shows `Question agent` only when the unresolved question blocks progress; the answer is resume-grounded and verified before continuing.
- [ ] **A-09: Question-agent failure**
  - Steps: Make the resolver skip, return an invalid option, or fail verification.
  - Expected: Final Submit is not clicked; the job stops in needs-review/error state with the question identified.
- [ ] **A-10: Unconfirmed post-submit state**
  - Steps: Click final Submit on a known site but suppress every success/already-applied/loading signal.
  - Expected: The Submit activity remains pending until an outcome is read. The extension does not count the job as applied and records an actionable review/error result. If the click reveals validation errors, Activity reports the failed validation and the workflow stops instead of clicking Submit repeatedly.
- [ ] **A-11: Session/login failure**
  - Steps: Expire the login during a workflow.
  - Expected: The workflow stops with `session_or_login_required`, page context, and a manual recovery URL.
- [ ] **A-12: Bounded no-progress retry**
  - Steps: Hold the workflow on an unchanged page/action.
  - Expected: It terminates at the attempt cap with `workflow_timeout`; no infinite loop occurs.
- [ ] **A-13: Owned-tab cleanup**
  - Steps: Force failure after a site opens a separate application tab.
  - Expected: Workflow-owned tabs close before the next job and the list tab is restored.
- [ ] **A-14: Advanced manual workflow confirmation**
  - Steps: Click `Run Current Job Workflow (Can Submit)` and cancel the browser confirmation.
  - Expected: No application action occurs.

## 5. Generic autofill

- [ ] **G-01: Unknown-site single-page boundary**
  - Steps: Run generic autofill on a multi-step non-Workday application entry page.
  - Expected: At most one apply/continue entry click occurs; the user must click Autofill again after the next page loads. Workday alone uses its separately bounded multi-page controller.
- [ ] **G-02: Sequential fresh snapshots**
  - Steps: Use a reactive form where filling one field replaces or reveals another.
  - Expected: Fields are processed one at a time from fresh snapshots; detached/replaced fields are not treated as successfully filled.
- [ ] **G-03: Preserve existing values**
  - Steps: Pre-fill a meaningful value before running the sweep.
  - Expected: Career Peeler does not overwrite it.
- [ ] **G-04: Text verification and fallback**
  - Steps: Test one ordinary field and one field that rejects DOM-level input.
  - Expected: The first value is verified normally; the second uses the bounded page-context browser-editing fallback or is flagged if fallback is unavailable/unsuccessful.
- [ ] **G-05: Native and custom dropdown verification**
  - Steps: Test both dropdown kinds.
  - Expected: Only an observed offered option is selected, and selected state/display text is verified.
- [ ] **G-06: Optional questions skipped**
  - Steps: Include optional text, checkbox, select, radio-group, and custom-dropdown questions.
  - Expected: They remain unchanged and do not create question-agent activity or a review flag.
- [ ] **G-07: Required unknown question**
  - Steps: Include an empty required unknown question.
  - Expected: The bounded question agent may return text or one observed option; a verified result continues, while no safe answer creates a review flag.
- [ ] **G-08: Resume upload**
  - Steps: Include a visible resume input with and without a saved PDF.
  - Expected: The saved PDF is attached and logged; otherwise the field is flagged for review.
- [ ] **G-09: Submission guard**
  - Steps: Leave any required field unresolved and enable acknowledged auto-apply.
  - Expected: Submit is not clicked. Resolve every required field and repeat.
  - Expected: Submit may be clicked once.
- [ ] **G-10: Generic submission wording**
  - Steps: Allow generic Submit to be clicked.
  - Expected: Result and status say `Submit clicked; confirmation pending`; neither says submitted/applied.
- [ ] **G-11: Workday structured experience and education**
  - Steps: Use a Workday My Experience page with no entries and a CandidateProfile containing complete month/year work records plus education records. Run autofill.
  - Expected: Entries are added sequentially, required title/company/date/school/degree values are verified, degree selection uses a real offered option, and the next record is not created from a stale row reference. A current role checks `I currently work here`; no month is invented for a profile date containing only a year.
- [ ] **G-12: Workday preserve, learn, and retry safely**
  - Steps: Pre-populate Workday work/education entries (manually or with another parser), including location or GPA missing from CandidateProfile, then run autofill twice.
  - Expected: Existing matching entries are not duplicated. The visible entries enrich `appleCareersUserProfile.candidateProfile` in Chrome local storage, resume-derived conflicting values remain authoritative, and the open side panel reflects the storage update. The second run is idempotent. If a newly-created row cannot be verified, only that row is removed; if removal cannot be confirmed, Workday stops for review.

## 6. Side-panel activity and progress

- [ ] **U-01: Current two-mode UI**
  - Steps: Switch between `Apple / TikTok / ByteDance` and `Other Job Sites`.
  - Expected: Only one mode section is expanded at a time and shared profile/resume changes remain synchronized.
- [ ] **U-02: Live activity**
  - Steps: Run known-site and generic workflows.
  - Expected: Runtime steps appear as they occur; pending question-agent entries resolve to success/error and the list scrolls to the newest entry.
- [ ] **U-03: Clickable job links**
  - Steps: Inspect job-labeled activity, error, needs-review, skipped, and recent-job entries.
  - Expected: Valid HTTP/HTTPS job titles open the corresponding job in a new tab.
- [ ] **U-04: Final match clarity**
  - Steps: Inspect a hard skip and a high-scoring LLM review result.
  - Expected: `Evaluate job match` states the final apply/skip/review outcome and reason rather than displaying an unexplained local percentage.
- [ ] **U-05: Applied count**
  - Steps: Complete multiple confirmed applications in one scan.
  - Expected: `Applied` increments for every distinct confirmed application and does not remain at one.
- [ ] **U-06: Needs Review and Errors separation**
  - Steps: Produce one safety pause and one workflow failure.
  - Expected: They appear in their respective sections with usable context and are not silently converted into ordinary skips.

## 7. Data and privacy

- [ ] **P-01: LLM disabled network behavior**
  - Steps: Leave LLM matching disabled and avoid requesting extraction; inspect network activity during a scan.
  - Expected: No job/resume/profile content is sent to OpenAI.
- [ ] **P-02: OpenAI operation payloads**
  - Steps: Separately validate a key, extract a CandidateProfile, match a job, and resolve a required question.
  - Expected: Each operation sends only the categories documented in `PRIVACY.md`; API keys and raw prompts are absent from activity and console logs.
- [ ] **P-03: Local storage contents**
  - Steps: Inspect `chrome.storage.local` after saving a profile/resume and running a scan.
  - Expected: The documented profile, PDF data URL, CandidateProfile, activity, scan state, compact job records, applied ledger, and error ledger are present; no developer backend receives them.
- [ ] **P-04: Clear Job History scope**
  - Steps: After saving applied and error jobs, click `Clear Job History` and accept the confirmation.
  - Expected: Compact job records, both ledgers, detailed logs, and scan history clear while settings, API key, and resume/profile remain.
- [ ] **P-05: Fresh storage**
  - Steps: Clear extension storage and reopen the side panel.
  - Expected: Defaults load cleanly without stale CandidateProfile/API-validation status.
- [ ] **P-06: Permission review**
  - Steps: Compare `manifest.json` with `PRIVACY.md` and `store-assets/PRIVATE_LISTING.md`.
  - Expected: `storage`, `tabs`, `scripting`, `sidePanel`, `debugger`, and `<all_urls>` are all disclosed and justified consistently. The debugger justification is limited to bounded Workday responsive-prompt trusted input, selected-item verification between attempts, and immediate detach behavior.
- [ ] **P-07: No secrets in package**
  - Steps: Inspect the ZIP file list and search extracted text for real `sk-` keys, resume names/content, contact data, cookies, browser profiles, and local history.
  - Expected: None are packaged.

## 8. Private Chrome Web Store readiness

- [ ] **C-01: Version consistency**
  - Expected: `package.json`, `manifest.json`, listing draft, and ZIP filename all use the intended current version.
- [ ] **C-02: Package root**
  - Steps: Inspect the ZIP.
  - Expected: `manifest.json` is at the ZIP root; source-only files, tests, Git data, and `node_modules` are absent.
- [ ] **C-03: Current screenshots**
  - Expected: Every submitted screenshot is a real current side-panel capture at `1280x800`; obsolete popup-era images are not uploaded.
- [ ] **C-04: Current promotional images**
  - Expected: Promotional copy does not claim Apple-only support or show obsolete UI.
- [ ] **C-05: Hosted privacy policy**
  - Expected: The submitted privacy-policy URL publicly renders the current `PRIVACY.md` without authentication.
- [ ] **C-06: Private visibility**
  - Steps: In the Chrome Web Store Distribution tab, select `Private` and the intended trusted tester accounts or owned Google Group.
  - Expected: The item is not public or unlisted; only the selected testers can install it.
- [ ] **C-07: Listing/privacy consistency**
  - Expected: Supported sites, OpenAI data use, submission behavior, permissions, and limitations match the shipped code and `PRIVACY.md`.
- [ ] **C-08: Tester policy compatibility**
  - Steps: Review every fixed required application-answer policy with each invited tester before enabling auto-apply.
  - Expected: Auto-apply is not used by a tester whose real answers differ. General distribution remains blocked until these answers are configurable.
- [ ] **C-09: Final automated checks**
  - Expected: `npm test`, `npm run test:cli`, and `npm run check` all pass against the exact source used to build the ZIP.
