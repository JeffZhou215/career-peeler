// Render the reviewed policy as a self-contained GitHub Pages site.
// Requires an authenticated GitHub CLI; does not deploy or publish the extension.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "output", "privacy-site");
const files = ["index.html", "privacy.html", "PRIVACY.md", "rolebeam-icon.png", ".nojekyll"];
fs.mkdirSync(output, { recursive: true });
for (const name of fs.readdirSync(output)) {
  if (!files.includes(name)) throw new Error(`Unexpected site file; review before publishing: ${name}`);
}
const markdown = fs.readFileSync(path.join(root, "PRIVACY.md"), "utf8");
const digest = crypto.createHash("sha256").update(markdown).digest("hex");
const body = execFileSync("gh", ["api", "markdown", "--input", "-"], {
  input: JSON.stringify({ text: markdown, mode: "gfm" }), encoding: "utf8"
}).trim();
if (!body.startsWith("<h1>Rolebeam Privacy Policy</h1>") ||
    /<(?:script|iframe|form|object|embed)\b|\son\w+\s*=|(?:href|src)=["']\s*(?:javascript|data):/i.test(body)) {
  throw new Error("Unexpected rendered policy HTML; review before publishing.");
}
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="How Rolebeam stores and uses resume, application and OpenAI API information.">
  <meta name="policy-source-sha256" content="${digest}">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'">
  <title>Rolebeam Privacy Policy</title>
  <link rel="canonical" href="https://jeffzhou215.github.io/career-peeler/privacy.html">
  <link rel="icon" href="./rolebeam-icon.png" type="image/png">
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; color: #20212b; background: #f7f8fb; }
    body { margin: 0; }
    main { box-sizing: border-box; max-width: 840px; margin: 0 auto; padding: 40px 28px 56px; }
    header { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; font-size: 20px; font-weight: 650; }
    header img { width: 42px; height: 42px; border-radius: 10px; }
    article { padding: 30px; border: 1px solid #dedfe8; border-radius: 18px; background: #fff; overflow-wrap: anywhere; }
    h1, h2 { line-height: 1.25; letter-spacing: -.025em; }
    h1 { font-size: clamp(26px, 5vw, 34px); margin-top: 0; }
    h2 { margin-top: 34px; font-size: 22px; }
    li + li { margin-top: 10px; }
    ul { padding-left: 24px; }
    a { color: #3f3bb5; text-underline-offset: 3px; }
    a:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
    code { font-size: .9em; }
    footer { margin-top: 24px; font-size: 14px; color: #575c70; }
    @media (prefers-color-scheme: dark) {
      :root { color: #ebedf3; background: #101116; }
      article { background: #191b24; border-color: #343746; }
      a { color: #b5b1ff; }
      footer { color: #b0b5c6; }
    }
    @media (max-width: 520px) { main { padding: 24px 14px 40px; } article { padding: 22px 18px; } }
  </style>
</head>
<body>
  <main>
    <header><img src="./rolebeam-icon.png" alt="" width="42" height="42"><span>Rolebeam</span></header>
    <article>${body}</article>
    <footer>Unofficial Apple Careers assistant. <a href="https://github.com/JeffZhou215/career-peeler/issues">Support</a> · <a href="./PRIVACY.md">Markdown copy</a></footer>
  </main>
</body>
</html>
`;
for (const file of ["index.html", "privacy.html"]) fs.writeFileSync(path.join(output, file), html);
fs.writeFileSync(path.join(output, "PRIVACY.md"), markdown);
fs.writeFileSync(path.join(output, ".nojekyll"), "");
fs.copyFileSync(path.join(root, "icons", "icon128.png"), path.join(output, "rolebeam-icon.png"));
process.stdout.write(`Prepared ${output}\nPolicy SHA-256: ${digest}\nFive public files; no deployment performed.\n`);
