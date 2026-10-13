# Career Peeler

An unofficial Chrome extension for Apple Careers. Upload your resume, rank filtered jobs, choose which ones to apply for, and review your existing submissions.

![UI guide showing the Setup, Jobs, and Submissions tabs](docs/images/ui-guide.png)

*Illustration of the extension's controls. Roles and counts are examples.*

## Install

Requires Chrome 120 or newer and your own OpenAI API key.

```sh
npm install
npm run build
```

In Chrome, open **Extensions → Developer Mode → Load Unpacked** and select `dist/`. Click the Career Peeler extension icon to open its side panel. Sign in to [Apple Careers](https://jobs.apple.com/).

## Start With Setup

1. Open **Setup → Your Resume → Upload Resume** and choose a PDF.
2. Under **AI Matching**, enable **LLM Matching**, enter your OpenAI API key, choose a model, and click **Test API Key**.
3. Click **Extract Profile From Resume** if the profile is not ready. Review the extracted profile and **Parsed Resume Text**.
4. Expand **Application Profile** and check your experience, required application answers, work authorization, and sponsorship settings.

## Find And Apply For Jobs

In your Apple Careers tab, set the search filters you want. Then open the extension's **Jobs** tab.

### Choose Roles Yourself

1. Set **After Ranking** to **Review Then Apply**, then click **Scan And Rank**. It ranks the entire filtered search before you apply.
2. Expand **Ranked Jobs** and inspect roles' match details and evidence. Check specific roles and click **Queue Selected** below the ranked list, or set **Top** and click **Queue Top N** there.
3. Expand **Application Queue**. Check the roles you want to apply for—each starts unchecked. Use **Select All** or **Clear Selection** as needed.
4. Click **Apply Selected (N)** below the application queue. The confirmation sheet lists only those roles. Review any concerns, allow submission, then click **Confirm And Apply (N)**.

**Queue Top N** shows how many jobs it can add: the smaller of your Top setting, available results, and open slots. For example, one available result with 13 open slots shows **Queue Top 1**. You can set Top below the number of open slots.

Selected roles are processed in score order after checking available slots. Unselected roles and roles beyond available capacity stay queued. Adding a role to the queue does not submit an application.

A live selection counter shows how many slots remain to be covered. It tells you when enough roles are selected and when the selection exceeds available slots. Extra selections are allowed as backups if an application fails. The capacity notice stays visible while you scroll the application queue and is repeated in the confirmation sheet.

**Preparing Batch** loads your selected roles' saved scores. After confirmation, **Checking Submission Capacity** verifies active applications in a temporary tab before applying. This check can take several seconds while Apple loads each submissions page.

### Apply Strong Matches Automatically

Set **After Ranking** to **Auto Apply Strong Matches**, check **I Allow Strong Match Applications After Ranking**, then click **Scan And Rank**. Applications begin only after the full search finishes successfully. Roles with match concerns remain available for manual review.

The header shows **Submitted**, **Open**, and **Queued** counts. The extension uses a conservative target of 50 active submissions and verifies the count before applying.

## Review Existing Submissions

Open **Submissions** in the extension.

| Button | What It Does |
| --- | --- |
| **Sync Submissions** | Updates saved submissions and the count without new AI matching. Uses a temporary background tab, keeping your current search in place. |
| **Scan And Match All** | Reads all submission pages and scores roles against your resume. Reviewable roles appear with the lowest fit first. |

Use **Find Job ID Or Title** to locate a role. Check the applications you want to withdraw, click **Review Withdrawal**, and review the confirmation sheet before continuing. Roles shown under **Protected Roles** cannot be selected.

**Apple withdrawals cannot be undone, and you cannot reapply for a withdrawn role.**

## When Something Stops

- **Interrupted scan:** use **Resume Scan** with the same search filters. Saved results remain available, and valid cached scores are reused.
- **Failed application:** expand **Activity** for the job link, reason, and last step. Known failures before submission are skipped; an unknown submission outcome pauses the batch for review.
- **Changed submissions:** use **Sync Submissions** to refresh without matching again. Detected manual applications also update the count, which is checked again before applying.

Small **?** buttons explain controls. Expand a role to see its details; opening another role in the same list closes the previous one.

## Data And Development

Resume and job data are saved on your device. AI features send the PDF or relevant resume and job information to OpenAI using your key. See [Privacy](PRIVACY.md) and [Storage Details](docs/storage.md).

After editing the extension, run `npm run build` and reload it in Chrome's Extensions page. The same installation retains saved data. The React side panel is bundled; background, content, and shared library scripts are copied into `dist/`.
