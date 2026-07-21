// Live Playwright verification of the CLI's scan flow, driven through the real cli/orchestrator.js
// and cli/browser.js code (not ad hoc test scripts) against mocked Apple Careers pages. Separate
// from the default `npm test` since it needs a downloaded Chromium build and is much slower than
// the plain unit tests -- run explicitly via `npm run test:cli`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const browser = require("../../cli/browser.js");
const orchestrator = require("../../cli/orchestrator.js");
const { createStore } = require("../../cli/store.js");

const LIST_URL = "https://jobs.apple.com/en-us/search";
const NORMAL_JOB_URL = "https://jobs.apple.com/en-us/details/200000001-0001/backend-software-engineer";
const INTERNSHIP_JOB_URL = "https://jobs.apple.com/en-us/details/200000002-0002/software-engineering-internship-2026";

const LIST_HTML = `<!doctype html>
<html><body>
<a href="${NORMAL_JOB_URL}">Backend Software Engineer</a>
<a href="${INTERNSHIP_JOB_URL}">Software Engineering Internship, 2026</a>
</body></html>`;

const NORMAL_JOB_HTML = `<!doctype html>
<html><body>
<h1>Backend Software Engineer - Jobs - Careers at Apple.</h1>
<p>Build backend APIs and microservices using AWS, DynamoDB, and full-stack services. Requires 2+ years of software experience.</p>
</body></html>`;

const INTERNSHIP_JOB_HTML = `<!doctype html>
<html><body>
<h1>Software Engineering Internship, 2026 - Jobs - Careers at Apple.</h1>
<p>Join our summer internship program.</p>
</body></html>`;

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "career-peeler-cli-test-"));
  const store = createStore(dataDir);

  const context = await browser.launchContext({
    dataDir,
    headless: true,
    generateAnswer: async () => ({ ok: false, error: "not used in this test" })
  });

  await context.route(LIST_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: LIST_HTML })
  );
  await context.route(NORMAL_JOB_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: NORMAL_JOB_HTML })
  );
  await context.route(INTERNSHIP_JOB_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: INTERNSHIP_JOB_HTML })
  );

  const profile = store.saveProfile({ userYearsOfExperience: 2, scanMode: "scan_only" });

  const result = await orchestrator.startScan(context, store, LIST_URL, profile);
  console.log(JSON.stringify({ result, scanState: store.scanState }, null, 2));

  assertTrue(result.ok === true, "startScan should succeed");
  assertTrue(store.scanState.running === false, "scan should have completed (running:false)");
  assertTrue(store.scanState.phase === "Complete", `phase should be Complete, got "${store.scanState.phase}"`);
  assertTrue(store.scanState.scanned === 2, `should have scanned both links (got ${store.scanState.scanned})`);
  assertTrue(store.scanState.stats.likelySkip >= 1, "the internship should be hard-skipped");

  const records = store.getJobRecords();
  const internshipRecord = Object.values(records).find((r) => /Internship/i.test(r.title));
  const normalRecord = Object.values(records).find((r) => /Backend Software Engineer/i.test(r.title));

  assertTrue(Boolean(internshipRecord), "internship job record should be saved");
  assertTrue(internshipRecord.status === "likely_skip", "internship should be recorded as likely_skip");
  assertTrue(Boolean(normalRecord), "normal job record should be saved");
  assertTrue(normalRecord.status !== "likely_skip", "normal backend job should not be hard-skipped");

  console.log("\nALL CHECKS PASSED -- CLI scan flow works end-to-end through the real orchestrator/browser modules");

  await context.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(`FAILED: ${message}`);
  }
  console.log(`OK: ${message}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
