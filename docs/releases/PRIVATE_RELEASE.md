# Private Chrome Release Preparation

Prepared October 17, 2026. Target: **Career Peeler 0.2.1**, Apple Careers only, Chrome MV3. **Not published.** The owner has authorized local preparation, not a store upload or release.

## Prepared Material

- Installable ZIP: `release/career-peeler-0.2.1-private-beta.zip` (contents of the validated `dist/`, with `manifest.json` at ZIP root).
- Publisher/listing worksheet: `store-assets/PRIVATE_LISTING.md`.
- Privacy-policy source: `PRIVACY.md`; host the current document at a public HTTPS URL before store submission.
- Current icon, promotional images and sanitized source-rendered UI screenshots: `store-assets/`.
- Asset provenance/reproduction: `store-assets/source/README.md`.
- Validation results/package digest: use the release manifest/checksum generated with the final ZIP. Do not reuse prior 0.1.0 packages.

The ZIP must contain packaged runtime files only. Repository history, `node_modules`, tests, logs, screenshots, resume PDFs, user exports, keys, tester accounts and developer attachments must not be shipped. `PRIVACY.md` is intentionally bundled by the production build.

## Reproducible Local Preparation

```sh
npm run release:private
```

This runs the full offline automated suite, runtime syntax checks and production build, then packages the validated `dist/` using `scripts/package-private-release.mjs`. It writes:

- `release/career-peeler-0.2.1-private-beta.zip`
- `release/career-peeler-0.2.1-private-beta.zip.sha256`
- `release/career-peeler-0.2.1-private-beta.json` (file hashes, source commit, working-tree state and prepared/not-published status)
- `release/career-peeler-0.2.1-store-materials/` (listing, privacy policy, checklist and matching store images; not part of the extension ZIP)

The runtime allowlist excludes repository/developer material. Review the JSON and checksum; a dirty source flag means the package includes changes beyond the recorded base commit, so retain that exact reviewable source state. Running this command does not upload, invite testers or publish.

## Before Upload

- [ ] Full test suite, runtime syntax checks and production build pass on the exact package source.
- [ ] Inspect ZIP entry list and manifest: version 0.2.1, Apple/OpenAI hosts only, current withdrawal recovery module included, no retired platform/CLI runtime files.
- [ ] Verify the package digest and retain the source commit reference.
- [ ] Load the ZIP's extracted files in a **new separate Chrome profile**. Do not copy a developer Chrome profile or IndexedDB data.
- [ ] Confirm fresh install opens Jobs/Submissions/Setup, has no PDF/key/history and leaves application consent disabled.
- [ ] Review the default two-year experience value, then set the test user's real value before ranking.
- [ ] Verify Setup's required answers are blank/unresolved until explicitly saved. Review all displayed settings before using application assistance.
- [ ] Confirm no extension data or logs contain real applicant details in graphical assets.
- [ ] Test safe public-list Scan And Rank in **Review Then Apply** mode; inspect partial/complete status, Stop/Resume and cache behavior without final applications.
- [ ] With an account that already has submissions, inspect existing-tab passive sync and explicit Sync. Never withdraw applications to manufacture an empty-list fixture.
- [ ] Verify Chrome's native debugging banner, tab cleanup and permission explanations without completing a real withdrawal. Modal inspection may be cancelled; do not click Proceed.
- [ ] Keep the documented live Apple eventual-consistency/empty-state verification limitations visible; automated mocks do not establish every Apple behavior.
- [ ] Review fixed required-question policies below before allowing friends to enable application assistance.

## Current Private-Beta Boundaries

This preparation preserves current behavior and the user's existing safety protections. It does not generalize all personal settings or resolve unrelated audit findings.

- Explicit work-authorization and sponsorship answers are respected; unresolved answers stop the operation.
- Recognized criminal-history questions currently resolve to **No** and start-date questions choose the nearest available future option. The UI does not configure these policies. Anyone whose circumstances differ must complete applications manually. Review before enabling automatic applications; do not describe the extension as having fully configurable answers.
- The experience default is two years; each tester must replace/review it against their own resume.
- Some installation-specific protected-role rules remain. They only prevent withdrawals; they should be generalized in a separate reviewed change before broader distribution. Personal IDs/details are intentionally omitted from public-facing copy.
- Matching uses the Setup PDF plus explicit profile edits. Actual applications use Apple's saved resume; the user must verify it.
- Unknown submission/withdrawal results pause and require reconciliation. A fresh selection never grants permission to replay an unknown final action.
- Offline tests cover adverse sequences, not the native browser's full timing or Apple's internal server state. Do not claim live withdrawal verification occurred.

These boundaries are not satisfied by adding a disclaimer alone. Before inviting testers to use automated applications, the publisher must ensure the fixed policies are truthful for that tester or keep that tester's use to ranking/sync/manual application completion.

## Publisher Tasks Requiring Owner Input

1. Register/configure the Chrome Web Store developer account, publisher/contact and account-security requirements.
2. Host the privacy policy without authentication and put its public URL in the dashboard.
3. Enter invited Google accounts/group privately in the tester configuration. Do not commit their details.
4. Review listing copy, privacy categories, `debugger` justification and other permission disclosures against the final packaged behavior.
5. Choose **Private**, verify the intended tester list, and review the submission screen.
6. Ask for explicit owner authorization to upload/submit/publish; this task stops at local preparation.

Private and Unlisted are different: Unlisted generally permits installs by anyone with a link. Use Private for invited friends. Recheck current store dashboard wording, requirements and review process before submission.

## Friend Onboarding

1. Install only through the private listing using an invited Google account; use a personal Chrome profile.
2. Open Setup, enter your own OpenAI API key only if using AI features, and upload a PDF you are permitted to send to OpenAI. API usage can incur charges.
3. Check extracted CandidateProfile, explicit edits, experience setting, work authorization, sponsorship and other required answers. Never use the developer's sample answers or files.
4. Sign in to your own Apple Careers account and verify Apple's saved resume. Setup's PDF is for matching.
5. Start with Jobs → **After Ranking → Review Then Apply**. Scan the intended filter and review evidence before queueing roles.
6. Use Submissions → **Sync Submissions** for capacity; **Analyze & Rank All** is separate AI analysis. Cached/partial/unknown is not a newly verified count.
7. If choosing application assistance, review the entire batch and authorize only the selected roles. Stop when any fixed policy would be untrue; finish manually instead.
8. If choosing withdrawal, verify exact titles/IDs and explicitly confirm. Apple does not allow reapplication after withdrawal. An uncertain result requires Sync/review; do not repeatedly click Proceed.
9. Report version, safe role URL and redacted Activity errors. Never post keys, resumes or private account information in public issues.

## Publishing Status

**Prepared only.** There is no Chrome Web Store item URL, upload, review approval, tester invitation or publication recorded by this document.
