import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { withdrawSubmittedRolesSequentially } from "../src/sidepanel/lib/submittedWithdrawals.mjs";

const source = await readFile(new URL("../src/sidepanel/components/SubmittedApplicationsSection.jsx", import.meta.url), "utf8");
const reviewSource = source.slice(source.indexOf("  function reviewWithdrawals("), source.indexOf("\n  useEffect(", source.indexOf("  function reviewWithdrawals(")));
const withdrawSource = source.slice(source.indexOf("  async function withdrawSelected("), source.indexOf("\n  return (", source.indexOf("  async function withdrawSelected(")));
const roles = [
  { jobId: "200000101-0836", title: "First Engineer", active: true, protectedFromBatchWithdrawal: false },
  { jobId: "200000102-9999", title: "Second Engineer", active: true, protectedFromBatchWithdrawal: false },
  { jobId: "200000103-0836", title: "Unselected Engineer", active: true, protectedFromBatchWithdrawal: false }
];
const appleTab = { id: 7, windowId: 3, url: "https://jobs.apple.com/app/en-us/profile/roles" };

function harness(options = {}) {
  let clock = 1000, uuid = 0;
  const requests = [], mutations = [], saved = [], statuses = [];
  let liveRoles = roles.map(role => ({ ...role }));
  const sandbox = {
    selectedRoles: roles.slice(0, 2).map(role => ({ ...role })), confirmationSelection: [], confirmationOpen: false,
    confirmationSelectionRef: { current: null },
    busyRef: { current: false }, withdrawalInFlightRef: { current: false },
    crypto: { randomUUID: () => `request-${++uuid}` },
    Date: class extends Date { static now() { return clock; } },
    setTimeout: (callback, delay) => { clock += delay; callback(); },
    setConfirmationSelection: value => { sandbox.confirmationSelection = value; },
    setConfirmationOpen: value => { sandbox.confirmationOpen = value; },
    setBusy: value => { sandbox.busyRef.current = value; },
    setError: value => { sandbox.error = value; },
    setStatusMessage: value => { statuses.push(value); },
    setWithdrawProgress: value => { sandbox.progress = value; },
    setSelectedIds: update => { sandbox.selectedIds = typeof update === "function" ? update(sandbox.selectedIds) : update; },
    selectedIds: roles.slice(0, 2).map(role => role.jobId),
    setRoles: () => {}, rankSubmittedRoles: value => value,
    getActiveTab: options.getActiveTab || (async () => appleTab),
    removeSavedRole: async jobId => { saved.push(jobId); if (options.saveFailure) throw new Error("Cache persistence failed."); },
    withdrawSubmittedRolesSequentially,
    sendMessageWithFallback: async (_tabId, message) => {
      requests.push(message);
      assert.equal(message.type, "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE");
      return { ok: true, data: { pageIndex: 1, pageCount: 1, hasNextPage: false, roles: liveRoles,
        withdrawalConfirmationOpen: false } };
    },
    chrome: {
      runtime: { sendMessage: async message => {
        requests.push(message);
        if (message.type === "APPLE_CAREERS_GET_JOB_RANKING") {
          if (options.rankingWait) await options.rankingWait;
          return { ok: true, data: { running: false } };
        }
        assert.equal(message.type, "APPLE_CAREERS_WITHDRAWAL_BATCH_STATE");
        return { ok: true };
      } },
      tabs: { sendMessage: async (tabId, message) => {
        requests.push(message);
        assert.equal(tabId, appleTab.id);
        if (message.type === "APPLE_CAREERS_GET_WITHDRAWAL_STATUS") {
          return { ok: true, data: { batchId: message.batchId, requestId: message.requestId, jobId: message.jobId,
            identityVerified: true, withdrawalConfirmed: true, active: false, confirmationOpen: false } };
        }
        assert.equal(message.type, "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES");
        const role = message.roles[0];
        mutations.push(role.jobId);
        if (options.failSecond && mutations.length === 2) {
          return { ok: false, error: "Apple modal no longer belongs to the reviewed role." };
        }
        liveRoles = liveRoles.filter(current => current.jobId !== role.jobId);
        if (options.loseFirstReply && mutations.length === 1) throw new Error("message channel closed");
        return { ok: true, data: { batchId: message.batchId, requestId: message.requestId, jobId: role.jobId, identityVerified: true,
          withdrawn: [{ jobId: role.jobId }], failed: [] } };
      } }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${reviewSource}\n${withdrawSource}\nglobalThis.review = reviewWithdrawals; globalThis.confirm = withdrawSelected; globalThis.cancel = closeWithdrawalConfirmation;`, sandbox);
  return { sandbox, requests, mutations, saved, statuses };
}

test("Review Withdrawal freezes full IDs and titles used by the dialog and subsequent confirmation", async () => {
  const h = harness();
  h.sandbox.review();
  h.sandbox.selectedRoles[0].title = "Changed Cached Title";
  h.sandbox.selectedRoles = [roles[2]];
  assert.deepEqual(Array.from(h.sandbox.confirmationSelection, role => role.title), ["First Engineer", "Second Engineer"]);
  await h.sandbox.confirm();
  const lease = h.requests.find(message => message.type === "APPLE_CAREERS_WITHDRAWAL_BATCH_STATE" && message.active);
  assert.equal(lease.tabId, appleTab.id);
  assert.equal(lease.confirmed, true);
  assert.deepEqual(Array.from(lease.roles, role => role.jobId), roles.slice(0, 2).map(role => role.jobId));
  assert.deepEqual(h.mutations, roles.slice(0, 2).map(role => role.jobId));
  const withdrawalRequests = h.requests.filter(message => message.type === "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES");
  assert.ok(withdrawalRequests.every(message => message.batchId === lease.batchId && message.expectedPageIndex === 1));
  assert.equal(new Set(withdrawalRequests.map(message => message.requestId)).size, 2);
  assert.match(source, /This will withdraw \{confirmationSelection\.length\}/);
  assert.match(source, /<ul>\{confirmationSelection\.map/);
});

test("Confirm cannot start without the reviewed snapshot or register a batch on a non-Apple tab", async () => {
  const h = harness({ getActiveTab: async () => ({ id: 8, url: "https://example.com" }) });
  await h.sandbox.confirm();
  assert.equal(h.requests.length, 0);
  h.sandbox.review();
  await h.sandbox.confirm();
  assert.equal(h.mutations.length, 0);
  assert.equal(h.requests.filter(message => message.type === "APPLE_CAREERS_WITHDRAWAL_BATCH_STATE").length, 0);
  assert.match(h.sandbox.error, /Open Apple Careers/);
});

test("Cancel consumes the reviewed selection before a stale Confirm handler can start a batch", async () => {
  const h = harness();
  h.sandbox.review();
  h.sandbox.cancel();
  h.sandbox.confirmationOpen = true; // Old React handler before the close render commits.
  await h.sandbox.confirm();
  assert.equal(h.requests.length, 0);
  assert.equal(h.sandbox.confirmationSelectionRef.current, null);
  assert.deepEqual(Array.from(h.sandbox.selectedIds), roles.slice(0, 2).map(role => role.jobId));
});

test("repeated Confirm events cannot dispatch concurrent withdrawal batches", async () => {
  let resolveRanking;
  const rankingWait = new Promise(resolve => { resolveRanking = resolve; });
  const h = harness({ rankingWait });
  h.sandbox.review();
  const first = h.sandbox.confirm();
  await h.sandbox.confirm();
  assert.equal(h.requests.filter(message => message.type === "APPLE_CAREERS_GET_JOB_RANKING").length, 1);
  resolveRanking();
  await first;
  assert.equal(h.requests.filter(message => message.type === "APPLE_CAREERS_WITHDRAWAL_BATCH_STATE" && message.active).length, 1);
  assert.deepEqual(h.mutations, roles.slice(0, 2).map(role => role.jobId));
  assert.equal(h.sandbox.withdrawalInFlightRef.current, false);
  // Simulate a stale React handler before the closed sheet state has committed.
  h.sandbox.confirmationOpen = true;
  h.sandbox.confirmationSelection = roles.slice(0, 2);
  await h.sandbox.confirm();
  assert.equal(h.requests.filter(message => message.type === "APPLE_CAREERS_WITHDRAWAL_BATCH_STATE" && message.active).length, 1);
});

test("later failure keeps prior confirmed cache updates and leaves failed selections available for review", async () => {
  const h = harness({ failSecond: true });
  h.sandbox.review();
  await h.sandbox.confirm();
  assert.deepEqual(h.saved, [roles[0].jobId]);
  assert.deepEqual(Array.from(h.sandbox.selectedIds), [roles[1].jobId]);
  assert.match(h.sandbox.error, /Batch stopped after 1 of 2.*modal no longer belongs/);
  assert.equal(h.requests.filter(message => message.type === "APPLE_CAREERS_GET_WITHDRAWAL_STATUS").length, 0);
  assert.equal(h.requests.filter(message => message.type === "APPLE_CAREERS_WITHDRAWAL_BATCH_STATE" && !message.active).length, 1);
});

test("a lost reply is reconciled with the same batch, request, and full job ID without replay", async () => {
  const h = harness({ loseFirstReply: true });
  h.sandbox.review();
  await h.sandbox.confirm();
  const first = h.requests.find(message => message.type === "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES");
  const proof = h.requests.find(message => message.type === "APPLE_CAREERS_GET_WITHDRAWAL_STATUS");
  assert.equal(proof.batchId, first.batchId);
  assert.equal(proof.requestId, first.requestId);
  assert.equal(proof.jobId, first.roles[0].jobId);
  assert.deepEqual(h.mutations, roles.slice(0, 2).map(role => role.jobId));
  assert.deepEqual(h.saved, roles.slice(0, 2).map(role => role.jobId));
});

test("a cache error after successful withdrawal reports the known success and prevents the next action", async () => {
  const h = harness({ saveFailure: true });
  h.sandbox.review();
  await h.sandbox.confirm();
  assert.deepEqual(h.mutations, [roles[0].jobId]);
  assert.match(h.sandbox.error, /Batch stopped after 1 of 2.*Cache persistence failed/);
});
