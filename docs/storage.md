# Local Storage

Career Peeler stores data inside its Chrome extension installation.

| Data | Location |
| --- | --- |
| PDF resume, parsed text, extracted profile, settings, required application answers, API key | Chrome local storage, in `appleCareersUserProfile` |
| Job descriptions, scores, filter checkpoints, submission snapshots, queue, application history, activity and failure logs | IndexedDB, in `CareerPeelerJobs` |
| Small database error reports | Chrome session storage |
| Ranked Jobs Top setting, search text and View filter | Chrome local storage, in `appleCareersRankingView` |

Readable PDF text is extracted locally with the bundled PDF.js parser. OpenAI extracts the structured profile from the PDF. Matching uses current resume text when available and the extracted profile otherwise. Replacing the PDF invalidates stale resume evidence.

Descriptions and matching scores are cached and reused while valid. Jobs are stored individually by collection and job ID. Scan progress writes only changed records and checkpoints; cached descriptions can be read by job ID.

## Migration And Recovery

Existing job data migrates from Chrome local storage in one IndexedDB transaction. Original job keys are removed only after the committed migration marker is read back. A failed migration leaves the source data intact for a retry after reloading. Saved scores, queue states, withdrawal protections and checkpoints are retained.

The `unlimitedStorage` permission covers the local cache and IndexedDB. Interrupted scans retain checkpoints. Database write failures use a separate session status so they remain visible even when the database cannot save progress.

Rebuilding and reloading the same extension installation retains saved data. Uninstalling it removes its local data. Applications and withdrawals already sent to Apple remain on Apple's system.

For what leaves the device and how permissions are used, see [Privacy](../PRIVACY.md).
