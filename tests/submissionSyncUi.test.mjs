import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
let server, Indicator, Section, watchStatus;
before(async () => {
  server = await createServer({ configFile: false, plugins: [react()], appType: "custom", logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ SubmissionSyncIndicator: Indicator } = await server.ssrLoadModule("/src/sidepanel/components/SubmissionSyncIndicator.jsx"));
  ({ SubmittedApplicationsSection: Section } = await server.ssrLoadModule("/src/sidepanel/components/SubmittedApplicationsSection.jsx"));
  ({ watchSubmissionSyncStatus: watchStatus } = await server.ssrLoadModule("/src/sidepanel/hooks/useSubmissionSyncStatus.js"));
});
after(async () => { await server?.close(); });
const now = 1800000000000;
const renderStatus = status => renderToStaticMarkup(createElement(Indicator, { status, now, onRetry() {} }));

test("the indicator distinguishes syncing, verified, cached, failed and deferred capacity without analysis controls", () => {
  assert.match(renderStatus({ state: "syncing" }), /Syncing… — checking Apple Careers/);
  assert.match(renderStatus({ state: "syncing" }), /submission-sync-spinner/);
  assert.doesNotMatch(renderStatus({ state: "syncing" }), /Synced just now/);
  assert.match(renderStatus({ state: "synced", lastSuccessAt: now }), /Synced just now/);
  assert.match(renderStatus({ state: "synced", lastSuccessAt: now - 180000 }), /Last synced 3 minutes ago/);
  assert.match(renderStatus({ state: "failed", lastSuccessAt: now - 180000 }), /Sync failed — capacity unknown/);
  assert.match(renderStatus({ state: "failed", lastSuccessAt: now - 180000 }), /Retry/);
  assert.match(renderStatus({ state: "deferred", message: "Another workflow is running" }), /Sync deferred/);
  assert.doesNotMatch(renderStatus({ state: "deferred" }), /Retry|submission-sync-spinner/);
  assert.match(renderStatus({}), /Count not verified/);
});

test("successful timestamps have machine-readable dates and survive a reopened status subscription", async () => {
  let listener;
  const record = { state: "synced", lastSuccessAt: now };
  const storage = { local: { get: async () => ({ appleSubmissionSyncStatus: record }) },
    onChanged: { addListener: fn => { listener = fn; }, removeListener: fn => assert.equal(listener, fn) } };
  const first = [], second = [];
  const stop = watchStatus(status => first.push(status), storage);
  await Promise.resolve(); stop();
  const stopAgain = watchStatus(status => second.push(status), storage);
  await Promise.resolve(); stopAgain();
  assert.deepEqual(first, [record]); assert.deepEqual(second, [record]);
  assert.ok(renderStatus(record).includes(`dateTime="${new Date(now).toISOString()}"`));
});

test("verified capacity and unresolved exact application identity have separate status and review link", () => {
  const recoveryWarning = { message: "Application needs review. Automatic applications remain paused.",
    jobId: "200123456-0836", title: "Software Engineer", url: "https://jobs.apple.com/en-us/details/200123456-0836/engineer" };
  const html = renderStatus({ state: "synced", lastSuccessAt: now, lastVerifiedCount: 1, recoveryWarning });
  assert.match(html, /Synced just now/);
  assert.match(html, /Application needs review/);
  assert.match(html, /Automatic applications remain paused/);
  assert.ok(html.includes(`href="${recoveryWarning.url}"`));
  assert.match(html, /Review Software Engineer \(Job ID 200123456-0836\)/);
  assert.doesNotMatch(html, /Sync failed|capacity unknown|>Retry</);
  assert.doesNotMatch(renderStatus({ state: "failed", lastSuccessAt: now, recoveryWarning }), /Application needs review/);
});

test("a reopened panel restores the successful count timestamp together with its separate recovery warning", async () => {
  const record = { state: "synced", lastSuccessAt: now, lastVerifiedCount: 1,
    recoveryWarning: { jobId: "200123456-0836", message: "Automatic applications remain paused." } };
  const storage = { local: { get: async () => ({ appleSubmissionSyncStatus: record }) },
    onChanged: { addListener() {}, removeListener() {} } };
  for (let count = 0; count < 2; count++) {
    const received = [];
    const stop = watchStatus(status => received.push(status), storage);
    await Promise.resolve(); stop();
    assert.deepEqual(received, [record]);
    assert.match(renderStatus(received[0]), /Synced just now/);
    assert.match(renderStatus(received[0]), /Automatic applications remain paused/);
  }
});

test("live sync updates cannot be overwritten by an older asynchronous panel-opening read", async () => {
  let listener, resolve;
  const stale = new Promise(done => { resolve = done; });
  const received = [];
  const storage = { local: { get: () => stale }, onChanged: { addListener: fn => { listener = fn; }, removeListener() {} } };
  const stop = watchStatus(value => received.push(value), storage);
  listener({ appleSubmissionSyncStatus: { newValue: { state: "syncing" } } }, "local");
  resolve({ appleSubmissionSyncStatus: { state: "synced", lastSuccessAt: now - 10000 } });
  await stale; await Promise.resolve();
  assert.deepEqual(received, [{ state: "syncing" }]);
  stop(); listener({ appleSubmissionSyncStatus: { newValue: { state: "failed" } } }, "local");
  assert.equal(received.length, 1);
});

test("Submissions uses one status filter with distinct Analyze and Sync actions, and has no page-selection controls", async () => {
  const html = renderToStaticMarkup(createElement(Section, { embedded: true, profile: {}, setStatusMessage() {},
    syncStatus: { state: "synced", lastSuccessAt: now }, syncNow: now }));
  assert.match(html, /Analyze &amp; Rank All/);
  assert.match(html, /Sync Submissions/);
  for (const name of ["All", "Scored", "Unscored", "Protected"]) assert.ok(html.includes(`>${name}</button>`));
  assert.doesNotMatch(html, /Current Page|Saved Page|Saved Roles View|<select/);
  const source = await readFile(new URL("../src/sidepanel/components/SubmittedApplicationsSection.jsx", import.meta.url), "utf8");
  assert.match(source, /Partial Update · Older Saved Roles/);
  assert.match(source, /retainSubmissionSelection\(current, next.roles\)/);
  assert.match(source, /Hidden By Filters/);
  assert.match(source, /APPLE_CAREERS_ADVANCE_SUBMITTED_HISTORY_PAGE/);
  assert.match(source, /protectedFromBatchWithdrawal === false/);
});
