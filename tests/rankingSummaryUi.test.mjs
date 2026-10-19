import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

let server, RankingScanSummary, RankingRecoveryFeedback;
before(async () => {
  server = await createServer({ configFile: false, plugins: [react()], appType: "custom", logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ RankingScanSummary, RankingRecoveryFeedback } = await server.ssrLoadModule("/src/sidepanel/components/RankedJobsSection.jsx"));
});
after(async () => { await server?.close(); });
const render = (view, search) => renderToStaticMarkup(createElement(RankingScanSummary, { view, search }));

test("ranking progress counts the latest scan rather than every cached job across filters", () => {
  const html = render({ savedJobCount: 2579, reviewedCount: 2579, eligibleCount: 40, latestSearchStrongCount: 2 },
    { jobsRead: 4, complete: true });
  assert.match(html, /This Scan: 4 Jobs Found/);
  assert.match(html, /2 Strong Matches/);
  assert.doesNotMatch(html, /2579|40 Strong Matches|Saved/);
});

test("zero strong matches refers to the current scan and explains automatic eligibility separately from score", () => {
  const html = render({ savedJobCount: 2579, eligibleCount: 19, latestSearchStrongCount: 0 },
    { jobsRead: 27, complete: true });
  assert.match(html, /This Scan: 27 Jobs Found/);
  assert.match(html, /0 Strong Matches/);
  assert.match(html, /title="Strong matches meet automatic application requirements:/);
  assert.match(html, /verified minimum qualifications and resume evidence, high confidence/);
  assert.doesNotMatch(html, /19 Strong Matches/);
});

test("unknown latest-scan eligibility is not displayed as confirmed zero", () => {
  for (const latestSearchStrongCount of [undefined, null]) {
    const html = render({ latestSearchStrongCount }, { jobsRead: 3 });
    assert.match(html, /— Strong Matches/);
    assert.doesNotMatch(html, /0 Strong Matches/);
  }
});

test("without a current scan the summary labels the complete cache rather than a scan result", () => {
  const html = render({ savedJobCount: 2579, reviewedCount: 400, eligibleCount: 2 }, null);
  assert.match(html, /2579 Cached Jobs/);
  assert.doesNotMatch(html, /This Scan|Strong Matches|400/);
});

test("partial scans report observed jobs without claiming all pages have been ranked", () => {
  const html = render({ savedJobCount: 2579, latestSearchStrongCount: 1 },
    { jobsRead: 12, pagesRead: 1, complete: false });
  assert.match(html, /This Scan: 12 Jobs Found/);
  assert.doesNotMatch(html, /All Pages Ranked|2579/);
});

test("the panel keeps cache totals in Scan Details and resumes from the completed-page checkpoint", async () => {
  const source = await readFile(new URL("../src/sidepanel/components/RankedJobsSection.jsx", import.meta.url), "utf8");
  assert.match(source, /<RankingScanSummary view=\{view\} search=\{latestSearch\}/);
  assert.match(source, /Cached Jobs Across Filters/);
  assert.doesNotMatch(source, /reviewedCount.*Saved ·/);
  const recovery = renderToStaticMarkup(createElement(RankingRecoveryFeedback, {
    view: { recovered: true }, interruptedRanking: true, latestSearch: { pagesRead: 13, pageIndex: 12 }
  }));
  assert.match(recovery, /continue from page 14 using saved scores/);
  assert.doesNotMatch(source, /interrupted on page \$\{\(latestSearch\.pageIndex/);
  assert.match(source, /latestSearch\.complete \? "All Pages Ranked" : "Partial Scan"/);
});

test("an old reconciled application Stop cannot disguise a stopped or completed job scan", async () => {
  const source = await readFile(new URL("../src/sidepanel/components/RankedJobsSection.jsx", import.meta.url), "utf8");
  const begin = source.indexOf("  const progressLabel =");
  const end = source.indexOf("\n\n  function jobCard", begin);
  assert.ok(begin >= 0 && end > begin);
  const label = new Function("view", "latestSearch", "interruptedRanking", `${source.slice(begin, end)}\nreturn progressLabel;`);
  const recovery = { stopRequested: true, reconciliationRequired: false };
  assert.equal(label({ recovery, phase: "Ranking stopped; results saved" }, { complete: false }, false), "Scan Stopped");
  assert.equal(label({ recovery, phase: "Filtered search ranked" }, { complete: true }, false), "Ranking Complete");
  assert.equal(label({ recovery: { ...recovery, reconciliationRequired: true }, phase: "Application stopped" }, {}, false), "Application Stopped");
  assert.equal(label({ running: true, recovery, phase: "Ranking page 6: Software Engineer" }, {}, false), "Ranking Page 6");
});
