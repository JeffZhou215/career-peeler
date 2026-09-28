# Privacy Policy

Last updated: August 23, 2026

Career Peeler is an unofficial, private-beta Chrome extension for scanning supported Apple Careers, TikTok Careers, and ByteDance Careers pages; matching jobs against a candidate profile; assisting with applications; and autofilling other job-application pages when the user requests it. Career Peeler is not affiliated with Apple, TikTok, ByteDance, or OpenAI.

## Data the extension reads

Career Peeler may read the following information while the relevant feature is running:

- Visible job links, titles, descriptions, submitted-state indicators, pagination controls, and application controls on supported Apple, TikTok, and ByteDance career pages.
- Visible form labels, offered options, existing field values, validation state, page headings, and submission or error indicators on an application page.
- The settings and profile information entered in the side panel, including contact details, years of experience, matching preferences, application-answer preferences, an optional OpenAI API key and model name, an optional PDF resume, and an extracted CandidateProfile.

The known-site content script is installed only on the supported Apple, TikTok, and ByteDance hosts listed in the extension manifest. Generic autofill scripts are injected into another HTTP or HTTPS page only after the user clicks **Autofill This Page** for that tab.

## Local storage

Career Peeler stores the following information in Chrome's local extension storage on the user's device:

- Matching, auto-apply, LLM, and generic-autofill settings.
- Contact fields and Required Application Answers (gender identity, race/ethnicity, veteran status,
  and disability status) entered in the side panel.
- The optional OpenAI API key and its validation status.
- The selected PDF resume as a local data URL, its filename/type, its fingerprint, and the structured CandidateProfile extracted from it. On a user-started Workday autofill run, populated work-experience and education entries visible on the Workday page may enrich the same local CandidateProfile for future autofill.
- Scan state, compact job records, matching decisions, activity steps, needs-review entries, a site-qualified applied-job ledger, and a saved error-job ledger.

This data is not sent to a Career Peeler developer-operated server. Career Peeler does not provide analytics, advertising, tracking, or data-sale functionality.

**Clear Applied Jobs** removes the applied ledger and related compact applied/submitted records. **Clear Error Jobs** removes the error ledger and related compact error records. **Clear Job History** removes compact job records, both ledgers, detailed job logs, and scan history. These controls deliberately keep profile settings, the API key, and resume data. The current private beta does not yet provide a dedicated remove-resume button. Users can replace the selected resume in the side panel or clear the extension's local storage through Chrome before removing or transferring a profile.

Chrome extension storage is managed by Chrome and is not separately encrypted by Career Peeler. Anyone with access to the user's unlocked Chrome profile may be able to access locally stored extension data.

## OpenAI-assisted features

OpenAI is the only implemented LLM provider. LLM-assisted matching is disabled by default. Career Peeler communicates directly from the extension to OpenAI using the API key supplied by the user; Career Peeler does not proxy those requests through a developer-operated server.

Depending on the operation the user enables or requests, OpenAI may receive:

- **API-key validation:** the API key is sent as an authorization credential to OpenAI's models endpoint. No resume or job description is included in this validation request.
- **CandidateProfile extraction:** the selected PDF resume, its filename, and extraction instructions.
- **Job matching:** the visible job description, detected experience requirements, local-match evidence, years-of-experience setting, and the CandidateProfile or saved resume/profile summary.
- **Apple submitted-role review:** the CandidateProfile or saved resume/profile summary plus each active submitted role's title and department text. This first-pass review does not fetch job descriptions; the side panel labels its scores accordingly.
- **Required-question resolution:** the visible question and offered options, page/job context, the CandidateProfile or saved resume/profile summary, and selected autofill-profile fields such as name, email, phone, city/state/country, professional-profile URLs, and desired salary. The saved gender, race/ethnicity, veteran, and disability answers are excluded from these requests and resolved locally. For an unresolved required open-text question, OpenAI's hosted web-search tool may also search for public company, startup, product, mission, or role context before drafting the answer. Dropdown decisions do not use web search.

Recognized fixed application policies are resolved locally when possible. Optional questions are skipped. OpenAI is used for an application question only when the question is required, the deterministic rules cannot resolve it, the control is supported as open text or a dropdown, and the user has enabled a usable LLM configuration.

OpenAI handles information under its own terms and privacy policy. Users should not enable an OpenAI-assisted feature or upload a resume unless they are comfortable sending the described information to OpenAI.

## Application pages and submission

When the user runs an application workflow, Career Peeler may place saved profile values into form fields, attach the selected PDF resume, choose application answers, click navigation controls, and—when auto-apply is enabled and acknowledged—click a final submission control. On Workday's My Experience step, it may also read populated work-experience and education entries and retain them in the Chrome-local CandidateProfile described above.

On Apple Careers' active submissions page, a user may confirm a specific batch of withdrawals from the side panel. Career Peeler then clicks Apple's per-role Withdraw controls and any matching confirmation dialog, and refreshes the active list afterward. Withdrawals change the user's candidacy with Apple.

Information entered into an employer's application page is transmitted to that employer or its recruiting platform under that site's own privacy terms. For Apple, TikTok, and ByteDance workflows, Career Peeler records an application as applied only after detecting a site success signal. On other job sites, generic autofill reports a Submit click as **confirmation pending** because it does not verify the post-submit result.

## Chrome permissions

Career Peeler currently requests:

- `storage` to retain settings, the profile/resume, scan state, activity, and compact job records locally.
- `tabs` to open, activate, inspect, return to, and close workflow-owned job/application tabs.
- `scripting` to inject the generic autofill scripts into the current tab after the user requests autofill.
- `sidePanel` to provide the persistent Career Peeler interface.
- `debugger` to send short-lived trusted input on the requesting Workday tab when its widgets reject ordinary extension DOM events. For already-resolved prompt options, Career Peeler uses bounded `Input.dispatchMouseEvent` clicks. If Workday explicitly rejects a visibly populated text field after validation, Career Peeler may fully select that field and perform one fixed Backspace followed by bounded `Input.insertText`, then verify that the exact value remains and the field error clears. It detaches immediately after each action; Chrome may display its debugging banner during the action.
- `<all_urls>` host access so user-invoked generic autofill can operate on job-application pages outside the three tuned sites and so the background worker can call the configured OpenAI endpoint.

## Data retention and control

Locally stored data remains in the user's Chrome extension profile until the user clears it, replaces it, clears extension storage, or removes the extension. Data already submitted to an employer site or OpenAI is governed by that third party's retention practices.

Users can keep LLM matching disabled, use scan-only mode, clear job history, and stop an active scan. Auto-apply requires a separate acknowledgement that it can submit real applications.

## Third parties

- Apple, TikTok, ByteDance, and any other employer or recruiting platform receive information only through the pages on which the user runs Career Peeler.
- OpenAI receives only the operation-specific data described above when an OpenAI-assisted feature is enabled or requested.
- Career Peeler has no developer-operated analytics, advertising, tracking, or data-storage service.

## Contact

For privacy questions or reports, open an issue at [github.com/JeffZhou215/career-peeler/issues](https://github.com/JeffZhou215/career-peeler/issues).
