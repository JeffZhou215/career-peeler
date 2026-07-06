# Privacy Policy

Career Peeler is an unofficial browser extension for scanning Apple Careers pages, matching jobs against your profile, and optionally assisting with applications.

## Data The Extension Reads

- Visible text and links on Apple Careers pages you open.
- Visible job descriptions and application-page controls needed for matching and workflow diagnostics.
- Matching settings you enter in the popup, including years of experience, scan mode, optional resume/profile summary, optional OpenAI API key, and optional model name.

## Local Storage

Career Peeler stores scan state, recent compact job records, matching decisions, workflow errors, settings, and the optional OpenAI API key in Chrome local extension storage on your device. Detailed debug job logs containing scanned job IDs, URLs, decision source, YOE evidence, compact job-description previews, and detected tech stack are kept in memory only during the current scanner session and can be downloaded to your machine with `Export job logs`. Use `Clear job history` in the popup to remove stored job records and scan history. Matching settings, including the optional OpenAI API key and resume/profile summary, are kept so you do not need to re-enter them after clearing job history.

## Optional OpenAI Matching

LLM-assisted matching is off by default. If you enable it and provide an API key, Career Peeler sends the current job text and your resume/profile summary to OpenAI to classify the role. Local matching remains the fallback when LLM matching is disabled or fails.

Career Peeler does not sell user data and does not send job or profile text to any external service unless LLM-assisted matching is enabled.

## Application Workflow

Career Peeler does not upload new files or create Apple Careers profile data. The optional application workflow uses information already saved in your Apple Careers account and may click application controls when auto-apply mode is enabled.

## Third Parties

- Apple Careers pages are read only when you use the extension on Apple Careers.
- OpenAI receives job text and your profile summary only when LLM-assisted matching is enabled.

## Affiliation

Career Peeler is not affiliated with, endorsed by, or sponsored by Apple.
