# Public Privacy Policy

Chrome Web Store privacy-policy URL:

https://jeffzhou215.github.io/career-peeler/privacy.html

## Hosting

- Repository: `JeffZhou215/career-peeler`.
- GitHub Pages source: `gh-pages`, `/`.
- HTTPS enforced; no custom domain.
- The publishing branch contains only `privacy.html`, `index.html`, `PRIVACY.md`, `rolebeam-icon.png`, and `.nojekyll`.
- The page uses bundled styling and the Rolebeam icon. It has no JavaScript, external fonts, analytics, or forms.
- Publishing this policy does not upload or publish the Chrome extension.

## Verification

First deployed October 18, 2026 from publishing commit `921eaabaa857ff0bb7632311bfede8672ce7835c`. The Pages workflow completed successfully. Unauthenticated HTTPS requests returned 200 for the HTML, raw Markdown, index, and icon, with bytes identical to the reviewed local files. The source-policy SHA-256 was `d81b29a1bf8b0d7da82983a5f3d5e608d695e4f7933923ccf88d1165232d8533`. The published page was also opened and visually inspected in the browser.

## Updating The Policy

1. Review and edit the repository-root `PRIVACY.md` against the actual extension behavior.
2. With an authenticated GitHub CLI, run:

   ```sh
   node scripts/build-privacy-site.mjs
   ```

   This renders the Markdown through GitHub and writes five files to `output/privacy-site/`. It does not deploy. The HTML records the SHA-256 of the source policy.

3. Clone the publishing branch into a new temporary directory:

   ```sh
   git clone --single-branch --branch gh-pages https://github.com/JeffZhou215/career-peeler.git /tmp/rolebeam-policy-update
   ```

4. Copy the five generated files, including `.nojekyll`, into that clone. Review the diff, then commit and push `gh-pages`. Do not copy the extension checkout or other output files.
5. Wait for the repository's **pages build and deployment** workflow to succeed.
6. Verify the public HTML and its `policy-source-sha256` against the reviewed local policy, and verify the published `PRIVACY.md` matches the source exactly. Check the icon and readable layout in a browser.
7. Keep the bundled policy, hosted policy, and Chrome Web Store privacy declarations consistent. Rebuild private-release store materials after changing the listing or policy.

Policy changes require an explicit publishing step. Pushing application changes to `main` alone does not update this Pages branch.
