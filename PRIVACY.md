# Career Peeler Privacy

Career Peeler is an unofficial Apple Careers application assistant. It has no developer-operated backend, advertising, analytics, or tracking.

## Local Data

Chrome local storage retains the selected PDF, its full parsed text, structured candidate profile, profile settings, required application answers, API key, job descriptions, scores, search checkpoints, submission snapshots, queues, application history, and failure logs. Existing Apple data is preserved during upgrades. Old records from retired integrations are not automatically erased.

PDF text extraction runs locally using the bundled PDF.js parser. Chrome storage is not separately encrypted by Career Peeler. Anyone with access to your unlocked Chrome profile may access extension data.

## OpenAI Requests

OpenAI is the only LLM provider. You supply the key and enable LLM Matching. Requests go directly to OpenAI:

- Key validation sends only the credential to the models endpoint.
- Candidate profile extraction sends the selected PDF directly to OpenAI.
- Job ranking and submission review send resume evidence and full job descriptions and qualifications.
- Required question resolution may send the question, available options, job context, and relevant resume/contact data. Unresolved required open-text questions may use OpenAI hosted web search for public company or role context.

Saved gender, race/ethnicity, veteran, and disability answers are resolved locally and are excluded from AI requests. Optional application questions are skipped.

## Apple Workflows

Confirmed application actions can fill required answers and click Continue and Submit. Reviewed queue application requires acknowledgement, and automatic mode requires explicit permission before the full filtered scan starts. The active submission count is checked before applying. Known failures before submission are skipped; unconfirmed submission outcomes pause the queue.

Confirmed withdrawal batches click Apple's Withdraw and Proceed actions sequentially. Withdrawals are irreversible and prevent reapplication. Starred roles and job 200654506 are protected.

Detected submission success and returning to Your Roles may refresh the local count without another click. Passive reconciliation reads submissions in a background tab and does not run during ranking, applying, or withdrawing.

## Permissions

- `storage`: retain the local data described above.
- `unlimitedStorage`: retain full job descriptions, rankings and resume data across large searches without Chrome's default 10 MB local storage cap. Data stays in this extension's local storage.
- `tabs`: manage Apple workflow tabs in the initiating window.
- `scripting`: restore the Apple content script when needed after navigation or reload.
- `sidePanel`: display the persistent interface.
- `debugger`: briefly send trusted clicks to exact Apple withdrawal controls when Apple rejects ordinary DOM clicks. The extension verifies the job and confirmation stage and detaches afterward. Chrome may display its debugging banner.

Host access is limited to `jobs.apple.com`, Apple careers pages, and `api.openai.com`. There is no all-sites access or generic autofill.

## Control

You can replace the saved resume, edit profile settings, stop workflows, remove queued jobs, and inspect failures. Clearing extension storage through Chrome removes local data. Chrome extension removal also removes its local storage. Application and withdrawal data already transmitted to Apple remains subject to Apple's policies; OpenAI requests are subject to OpenAI's policies.
