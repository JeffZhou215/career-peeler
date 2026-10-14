import { test } from "node:test";
import assert from "node:assert/strict";
import { submissionCollection, filterSubmissions, retainSubmissionSelection } from "../src/sidepanel/lib/submissionCollection.mjs";
const role = (jobId, score) => ({ jobId, title: `Engineer ${jobId}`, active: true, favorite: false, protectedFromBatchWithdrawal: false,
  ...(score === undefined ? {} : { score, reason: "Saved evidence" }) });

test("complete inventories deduplicate IDs and exclude historical pages absent from the verified collection", () => {
  const archive = { latestScan: { complete: true, roles: [role("100", 95), role("101", 30), role("100", 95)] },
    lastCompleteScan: { roles: [role("102", 15)] }, pages: { 1: { roles: [role("103", 10)] } } };
  const collection = submissionCollection(archive);
  assert.equal(collection.partial, false);
  assert.deepEqual(collection.roles.map(role => role.jobId), ["101", "100"]);
});

test("partial scans overlay newer results onto the last complete collection without deleting unvisited submissions", () => {
  const archive = { lastCompleteScan: { complete: true, roles: [role("100", 70), role("101", 30)] },
    latestScan: { complete: false, roles: [role("100", 80), role("102", 20)], warning: "Matching stopped" },
    pages: { 1: { roles: [role("100", 70)], updatedAt: 1 } } };
  const before = structuredClone(archive);
  const collection = submissionCollection(archive);
  assert.equal(collection.partial, true);
  assert.equal(collection.warning, "Matching stopped");
  assert.deepEqual(collection.roles.map(role => role.jobId), ["102", "101", "100"]);
  assert.equal(collection.roles.find(role => role.jobId === "101").availabilityUnknown, true);
  assert.equal(collection.roles.find(role => role.jobId === "100").availabilityUnknown, false);
  assert.deepEqual(archive, before, "the UI projection must not rewrite persisted snapshots or scores");
});

test("new unscored observations preserve valid previous scores and protections without claiming a fresh match", () => {
  const collection = submissionCollection({ lastCompleteScan: { roles: [role("100", 85)] },
    latestScan: { complete: false, roles: [{ ...role("100"), favorite: true }] } });
  assert.equal(collection.roles[0].score, 85);
  assert.equal(collection.roles[0].scoreSource, "previous_review");
  assert.equal(collection.roles[0].protectedFromBatchWithdrawal, true);
});

test("changed titles and job identities do not inherit unrelated cached scores", () => {
  const collection = submissionCollection({ lastCompleteScan: { roles: [role("100-0836", 85)] },
    latestScan: { complete: false, roles: [{ ...role("100-0836"), title: "Different role" }, role("100-3543")] } });
  assert.equal(collection.roles.find(role => role.jobId === "100-0836").score, undefined);
  assert.equal(collection.roles.find(role => role.jobId === "100-3543").score, undefined);
});

test("legacy saved pages become a deduplicated partial collection with newer role data winning", () => {
  const collection = submissionCollection({ pages: { 1: { updatedAt: 1, roles: [role("100", 90)] },
    2: { updatedAt: 2, roles: [role("100", 80), role("101", 50)] } } });
  assert.equal(collection.partial, true);
  assert.equal(collection.roles.length, 2);
  assert.equal(collection.roles.find(role => role.jobId === "100").score, 80);
});

test("confirmed zero replaces all old submissions without resurrecting complete snapshots or pages", () => {
  const collection = submissionCollection({ latestScan: { complete: true, accountVerified: true, inventoryState: "confirmed_empty", roles: [] },
    lastCompleteScan: { roles: [role("100", 80)] }, pages: { 1: { roles: [role("100", 80)] } } });
  assert.equal(collection.partial, false);
  assert.deepEqual(collection.roles, []);
});

test("unverified legacy empty snapshots cannot hide earlier cached submissions as confirmed zero", () => {
  const collection = submissionCollection({ latestScan: { complete: true, roles: [] },
    lastCompleteScan: { roles: [role("100", 80)] } });
  assert.equal(collection.partial, true);
  assert.equal(collection.roles.length, 1);
});

test("status filters and title/ID search work on one collection and never reset hidden selections", () => {
  const roles = submissionCollection({ latestScan: { complete: true, roles: [role("100", 80), role("101"),
    { ...role("102", 30), favorite: true }] } }).roles;
  assert.equal(filterSubmissions(roles, "all").length, 3);
  assert.equal(filterSubmissions(roles, "scored").length, 2);
  assert.equal(filterSubmissions(roles, "unscored")[0].jobId, "101");
  assert.equal(filterSubmissions(roles, "protected")[0].jobId, "102");
  assert.equal(filterSubmissions(roles, "all", "Engineer 101")[0].jobId, "101");
  assert.equal(filterSubmissions(roles, "scored", "100")[0].jobId, "100");
  assert.deepEqual(retainSubmissionSelection(["100", "101"], roles), ["100", "101"]);
});

test("selection reconciliation removes missing IDs and newly protected roles while retaining cross-page targets", () => {
  const roles = submissionCollection({ latestScan: { complete: true, roles: [role("100", 80), role("101", 50),
    { ...role("102"), favorite: null }, role("200654506", 10)] } }).roles;
  assert.deepEqual(retainSubmissionSelection(["100", "101", "102", "200654506", "missing"], roles), ["100", "101"]);
});

test("an explicit inactive observation removes the role from a partial collection", () => {
  const collection = submissionCollection({ lastCompleteScan: { roles: [role("100", 80)] },
    latestScan: { complete: false, roles: [{ ...role("100"), active: false }] } });
  assert.deepEqual(collection.roles, []);
  assert.equal(collection.partial, true);
});
