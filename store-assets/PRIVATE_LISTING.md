# Chrome Web Store Private Release Worksheet

Prepared October 17, 2026 for the Apple-only **Career Peeler 0.2.2** private beta. This worksheet is draft submission material; nothing has been uploaded, published, or approved. Replace placeholders before submission. Private visibility does not bypass Chrome Web Store review.

## Release Target

| Field | Prepared Value |
| --- | --- |
| Name | Career Peeler |
| Version | 0.2.2 |
| Visibility | Private — Trusted Testers |
| Audience | Explicitly invited Google accounts / publisher-owned tester group |
| Category | Productivity |
| Language | English (United States) |
| Runtime | Chrome Manifest V3 side-panel extension; Apple Careers only |
| Package | `release/career-peeler-0.2.2-private-beta.zip` |
| Support | https://github.com/JeffZhou215/career-peeler/issues |
| Hosted Privacy Policy | `[REQUIRED: publicly accessible HTTPS URL rendering current PRIVACY.md]` |

Never enter tester emails, API keys, real resumes or Apple credentials in this tracked file.

## Publisher Inputs Still Required

- [ ] Chrome Web Store developer account and final publisher name.
- [ ] Verified working support/contact email in the developer dashboard.
- [ ] Public privacy-policy URL; repository Markdown inside the ZIP alone is insufficient.
- [ ] Trusted tester Google accounts or an owned tester group, entered privately in the dashboard.
- [ ] Confirmation of final listing, permission/data disclosures and private distribution settings.
- [ ] Non-destructive live Chrome smoke verification recorded in the release checklist.
- [ ] Verify blank personal-answer defaults and the missing/conflicting-answer manual-review behavior before inviting testers.

## Private-Beta Limitations And Release Gates

- Work authorization and sponsorship use explicit saved Yes/No answers; unanswered or unresolved questions stop assistance. Each tester must set their own answers.
- **Personal answers are explicit:** age eligibility and simple previous Apple employment use saved Yes/No choices; availability uses an explicitly saved date or Immediately choice. Criminal-history and differently scoped questions require an answer saved for the exact question wording. Missing, conflicting, expired or unsupported answers stop for manual review. Resume omissions are not proof of No, and the LLM cannot guess these answers.
- A fresh profile starts with an experience setting of two years. Each tester must review it against their own resume before ranking.
- Additional installation-specific withdrawal protections remain in this build. They can prevent a role from being selected; they do not authorize withdrawals. Generalizing these protections is a future product decision. Do not include personal application details in store copy or screenshots.
- Setup's PDF supports matching; Apple applications use the resume saved in the tester's Apple account.
- Apple live DOM behavior, Chrome debugger/native click ordering and eventual server updates are not fully established by the offline tests. No real submissions or withdrawals are required for reviewer testing.
- The OpenAI key and PDF are retained locally without additional application-level encryption. Disclose that accurately.
- Old 0.1.0 multi-platform ZIPs and older screenshots are obsolete. Upload only the freshly validated 0.2.2 package/assets.

## Listing Copy

### Short Description

Resume-based Apple Careers ranking, reviewed applications, and active-submission management in a Chrome side panel.

### Detailed Description

PRIVATE BETA FOR INVITED TESTERS.

Career Peeler is an unofficial Apple Careers assistant that helps you compare jobs with your resume and manage applications from a persistent Chrome side panel.

Jobs

• Upload a PDF resume and review its extracted candidate profile.
• Scan all pages of your filtered Apple Careers search and rank jobs against your resume.
• Reuse saved descriptions and scores, with clear partial-scan and recovery status.
• Review ranked jobs, save an application queue and select the specific roles you want to apply for.
• Optionally authorize strong-match applications after the entire filtered search has been ranked.
• Save your own personal application answers, including exact-question responses where wording matters.

Submissions

• See verified active-submission capacity and synchronization status.
• Automatically check the current Active Submissions page without opening another tab or starting AI analysis.
• Explicitly sync the complete inventory or Analyze & Rank All to compare saved submissions with your resume.
• Search by title or job ID and explicitly review any withdrawal batch. Protected roles cannot be selected.

Control And Recovery

• Applications use your own explicit saved personal answers and Apple's saved resume. Missing or conflicting answers stop for manual review.
• Unknown application or withdrawal outcomes require reconciliation rather than automatic replay.
• Activity links identify roles that need manual review.
• Career Peeler uses your own OpenAI API key. API requests can incur charges.

DATA DISCLOSURE: Your PDF, parsed resume, profile, API key, job caches and workflow records are stored locally in your Chrome profile. Enabled/requested AI features send the relevant PDF, resume/profile evidence, job text or required-question context directly to OpenAI. Apple receives authorized application interactions. Career Peeler has no developer-operated backend, analytics or advertising service. Read the privacy policy before use.

PERSONAL ANSWERS: Save your own required application answers in Setup. Missing or conflicting answers stop the role for manual review. Criminal-history and scoped questions are bound to exact saved wording; dates are never replaced by the nearest offered date. Ranking and synchronization can be used without submitting applications.

Career Peeler is not affiliated with, endorsed by, or sponsored by Apple or OpenAI. Matching scores are estimates, not hiring predictions. Apple can change its website, eligibility rules and submission limits.

## Privacy Practices

### Single Purpose

Help users evaluate and manage Apple Careers jobs and applications against their resume, with explicitly authorized application and withdrawal assistance.

### Permission Justifications

| Permission | User-Facing Need |
| --- | --- |
| `storage` | Store resume/profile, user settings/answers, OpenAI credential, capacity sync status and small live progress records locally. |
| `unlimitedStorage` | Retain full job descriptions, rankings, submission snapshots, scan checkpoints and durable recovery records for large Apple searches in local extension storage/IndexedDB. |
| `tabs` | Locate suitable Apple tabs and manage temporary tabs used by explicitly authorized job/application/inventory verification workflows in the initiating window. Passive visiting does not create a new tab. |
| `scripting` | Reinject packaged Apple content scripts when navigation or extension reload leaves an authorized Apple workflow without its reader. No remote executable code is fetched. |
| `sidePanel` | Provide persistent Jobs, Submissions and Setup tabs, review/consent controls and activity/recovery status. |
| `debugger` | Apple can reject ordinary script-generated withdrawal clicks. Briefly attach only to the authorized Apple tab and send bounded browser-trusted clicks to the exact reviewed job's Withdraw/Proceed control after job, modal ownership, stage and one-use permission checks. Detach afterward; Chrome may show its debugging banner. No arbitrary command/selector endpoint or general browsing debugging is exposed. |

### Host Justifications

- `https://jobs.apple.com/*`: search results, descriptions, application forms and signed-in submission inventory.
- `https://www.apple.com/careers/*`: supported Apple Careers entry pages/context and packaged readers.
- `https://api.openai.com/*`: direct authenticated key validation, PDF/profile extraction, resume matching and required-question assistance using the user's key.

There is no `<all_urls>` permission, generic autofill, CLI, TikTok, ByteDance or Workday workflow in this release.

### Remote Code

**No.** Executable code is bundled. OpenAI responses are structured data and cannot supply arbitrary JavaScript, selectors or Chrome Debugger Protocol commands.

### Data Categories

Map these actual data uses to the labels currently shown by the store dashboard. Do not omit a category solely because it remains local.

- Personally identifiable information: contact/location details and resume identity information.
- Authentication information: the user-provided OpenAI API key. Apple passwords are not requested/stored by Career Peeler.
- Health information: saved disability answer and any health information the user includes in their resume/profile.
- Website content: Apple descriptions, form labels/options, inventory and validation/status text.
- Web browsing activity: Apple job/application URLs and interaction history for these features.
- Form/user-generated data: PDF resume, parsed text, CandidateProfile/edits, application answers and AI outputs.
- No payment-card/bank processing or reading of private messages/email.

### Data-Use Declarations

- Used for the stated Apple Careers matching/application/submission-management features only.
- No sale, advertising, data-broker transfer or unrelated analytics.
- No use for creditworthiness or lending decisions.
- No developer backend receives the data.
- Operation-specific information goes directly to OpenAI for enabled/requested AI features and to Apple through authorized browser interactions over HTTPS.
- Third-party handling follows Apple/OpenAI policies; no guarantee of their immediate deletion is made.

## Non-Destructive Reviewer Instructions

1. Install the private item with an invited Google account and open the Career Peeler side panel.
2. In Jobs, leave **After Ranking → Review Then Apply**. Do not authorize strong-match submission.
3. Inspect Jobs, Submissions, Setup and Activity without requiring credentials. Use the provided demo-data screenshots only as illustrative listing material; they are not live accounts.
4. Optional AI review requires your own OpenAI API key and a PDF you are permitted to send to OpenAI. Review the extracted profile, experience setting and all required answers. Never use a supplied/shared private key.
5. Open a public filtered Apple job list and use **Scan And Rank** in Review Then Apply mode. This may incur OpenAI charges but does not submit applications. Stop/resume, cached rankings, search and queue review can be inspected without clicking Confirm And Apply.
6. Signed-in inventory testing requires a reviewer/tester's own Apple account. Visit **Your Roles → Submissions → Active** to inspect passive sync status. **Sync Submissions** explicitly verifies the full inventory; **Analyze & Rank All** is separate AI analysis. Do not create or withdraw applications to generate data.
7. Do not click **Confirm And Apply**, Apple's **Submit**, **Confirm Withdrawal**, or Apple's **Proceed** during review. Withdrawal and final submission are irreversible real account actions, not demo actions.
8. Inspect Application Profile and Saved Question Answers. Verify required personal answers start unset. Automated offline tests exercise missing, conflicting and unmatched answers without performing real Apple actions. An unsupported question remains a manual-review task.
9. Report extension version, safe job URL, last Activity step and redacted error. Do not include a key, resume or private application details in a public issue.

No shared Apple credentials or private API keys are provided. The automated suite is isolated and performs no live submissions or withdrawals.

## Graphical Assets

| Asset | Use |
| --- | --- |
| `store-icon-128x128.png` | Exact current packaged brand icon. |
| `promo-small-440x280.png` | Apple-only small promotional image. |
| `promo-marquee-1400x560.png` | Optional Apple-only marquee. |
| `screenshot-1-overview-1280x800.png` | Current React Jobs UI with sanitized offline demo data. |
| `screenshot-2-settings-1280x800.png` | Current React Setup UI with no credential or personal resume. |
| `screenshot-3-progress-logs-1280x800.png` | Current React Submissions UI with sanitized offline demo data. |
| `screenshot-4-application-answers-1280x800.png` | Current Application Profile and exact-question editor, showing unset personal answers. |

See `store-assets/source/README.md` for capture provenance and reproducibility. Screenshots show the actual source-rendered side panel; surrounding captions and demo records are illustrative. No real account data or claimed live submission success is used.

## Distribution — Not Yet Executed

1. Finish the release checklist in `docs/releases/PRIVATE_RELEASE.md`.
2. Provide the required publisher/privacy/tester inputs.
3. Upload only the validated versioned ZIP and matching assets.
4. Select **Private → Trusted Testers**; verify visibility before submission.
5. Submit for Chrome Web Store review only after the owner authorizes publication. Do not assume private distribution skips review.

Official dashboard guidance, to recheck before submission:

- [Distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
- [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [User-data policy](https://developer.chrome.com/docs/webstore/user_data)
- [Listing images](https://developer.chrome.com/docs/webstore/images)
