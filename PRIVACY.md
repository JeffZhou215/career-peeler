# Rolebeam Privacy Policy

Last updated: October 18, 2026

Rolebeam is an unofficial Chrome extension for Apple Careers. It helps you compare jobs with your resume, manage a local application queue, assist with applications you authorize, and review active submissions. It is not affiliated with Apple or OpenAI.

Rolebeam has no developer-operated backend, advertising, analytics, or tracking service. The developer does not receive your resume, application profile, API key, job history, or application answers through the extension.

## Information Stored On Your Device

The extension stores the following inside your Chrome profile:

- **Chrome local storage:** your uploaded PDF resume and filename, parsed resume text, structured CandidateProfile and edits, matching preferences, experience setting, required application answers (including age eligibility, prior Apple employment, start availability and exact-question answers for criminal-history/scoped questions), OpenAI API key and its validation status, small progress records, and submission synchronization status/timestamps.
- **IndexedDB (`CareerPeelerJobs`):** job descriptions and qualifications, matching scores and evidence, search identities and scan checkpoints, saved submissions, application queue/history, activity/error logs, submission capacity snapshots and reservations, and durable application/withdrawal recovery records. Withdrawal records associate an exact job ID with its reviewed operation and confirmed or unresolved outcome.
- **Chrome session storage:** small database-write failure reports used to surface storage problems.

Data is retained across side-panel reopening and browser/service-worker restarts until replaced, removed through available controls, or the extension is uninstalled. Replacing a resume invalidates matching results when relevant; it does not immediately erase all historical job records. Data from retired integrations on an upgraded installation is not automatically erased.

PDF.js runs locally to extract readable PDF text. Rolebeam does not apply additional encryption to its local data. Someone with access to your unlocked Chrome profile may be able to read it. Do not use a shared Chrome profile for private application data.

## Information Sent To OpenAI

OpenAI is the only AI provider integrated into Rolebeam. You provide your own API key; requests go directly over HTTPS to `api.openai.com`. OpenAI API usage may incur charges on your account.

Depending on the feature you enable or request, the extension sends:

- **Key validation and model discovery:** your API credential in the authorization header when checking the models endpoint. Model discovery reads model identifiers/basic availability, filters them through the packaged compatibility list, and caches results briefly in background-worker memory. It does not send your resume, profile or saved application answers, or generate a completion.
- **CandidateProfile extraction:** the uploaded PDF, including its contents and filename, to extract a structured profile.
- **Job ranking and submission analysis:** resume text/profile evidence (including explicit profile edits), experience settings, and relevant job descriptions, responsibilities and qualifications.
- **Unresolved required application questions:** the question, observed answer choices, relevant job/page context, resume evidence and relevant saved contact/profile values. For required open-text questions, OpenAI's hosted web search may be used for public company or role context.

Separately saved personal application answers, including gender, race/ethnicity, veteran/disability, work eligibility, age, prior Apple employment, availability and exact-question answers, are resolved locally. They are not included in AI question requests to infer personal answers. Optional questions are skipped. Information you put inside the PDF, resume text or other resume/profile evidence can still be included in extraction or matching requests; avoid including unnecessary sensitive information.

OpenAI processes requests under its own terms and privacy/data policies. The extension does not control OpenAI's retention or account settings and does not promise immediate deletion of information already sent to OpenAI.

## Information Read From And Sent To Apple

The extension reads supported Apple Careers pages, including search results, job descriptions, application forms and your Active Submissions list. It uses your existing browser session; it does not request or store your Apple password. Chrome and Apple manage authentication cookies.

Applications you explicitly authorize may fill required form answers, click Continue and perform final Submit actions. The PDF in Setup is used for matching; applications use the resume already saved in your Apple Careers account. Review that saved resume and your application answers before permitting submissions. Missing, conflicting, expired or unsupported personal answers stop for manual review. The extension does not infer criminal history or a negative previous-employment answer from an incomplete resume, or choose an unsaved start date.

Withdrawals require selecting roles and explicitly confirming the intended batch. They cannot be undone on Apple Careers. The extension checks exact job IDs and protects starred or otherwise protected roles. Unresolved outcomes are retained for reconciliation; they are not automatically retried.

When you visit an existing Active Submissions tab, automatic synchronization reads that current page without opening another tab, paging through it, or running AI analysis. If a complete inventory cannot be established from that page, synchronization can be deferred and cached/unknown status remains visible. Explicit Sync, authorized application capacity checks, and withdrawal reconciliation may use temporary Apple tabs in the same Chrome window to verify the complete inventory. These tabs are closed afterward where possible. Explicit Analyze & Rank All is separate and may navigate submission pages and send matching requests to OpenAI.

Information entered or submitted to Apple is governed by Apple's policies. Removing local extension data does not withdraw applications or delete data already held by Apple.

## Permissions And Host Access

- **`storage`:** save preferences, profile/resume data, credentials, and small status records.
- **`unlimitedStorage`:** retain full descriptions, scores and durable workflow data across large searches without normal extension storage quotas, and reduce IndexedDB eviction risk.
- **`tabs`:** identify appropriate Apple tabs and manage tabs used by authorized workflows in the initiating window.
- **`scripting`:** restore packaged Apple content scripts when needed after navigation or extension reload.
- **`sidePanel`:** display Rolebeam's persistent interface.
- **`debugger`:** briefly send browser-trusted clicks to the exact Apple withdrawal controls after validating the selected job and confirmation stage. Chrome may show a debugging banner. The extension does not expose a general-purpose remote-debugging interface.

Host access is restricted to `https://jobs.apple.com/*`, `https://www.apple.com/careers/*`, and `https://api.openai.com/*`. There is no all-sites permission. All executable extension code is packaged locally; AI responses are handled as data.

## Your Controls

You can replace the PDF, edit the profile and saved answers, stop workflows, remove queued jobs, and inspect activity or unresolved outcomes. Stopping cannot undo an action already accepted by Apple. You can inspect Chrome extension storage and IndexedDB using Chrome developer tools. Uninstalling the extension removes its local extension storage, subject to Chrome's behavior; it does not remove information previously sent to Apple or OpenAI.

For product/privacy questions, open an issue at [Rolebeam Support](https://github.com/JeffZhou215/career-peeler/issues). Issues are public: do not include API keys, resumes, private application details, or unredacted logs. The private-release publisher must also provide a working support contact in the Chrome Web Store listing.
