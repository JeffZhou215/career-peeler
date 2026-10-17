const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { IDBFactory } = require("fake-indexeddb");

const root = path.resolve(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const jobId = "209900001";
const otherJobId = "209900002";
const keys = { journal: "appleWithdrawalWorkflow", archive: "appleSubmittedRoleReviews", ranking: "appleJobRanking" };
const operation = (overrides = {}) => ({ jobId, batchId: "reviewed-batch", requestId: "selected-request", tabId: 7,
  documentId: "apple-document", reviewedAt: 900, ...overrides });
const reconciliationRequired = error => error?.code === "withdrawal_reconciliation_required";
const role = id => ({ jobId: id, title: `Engineer ${id}`, active: true, protectedFromBatchWithdrawal: false });

// Independent worker realms share actual IndexedDB requests and transactions.
// An old panel receipt is deliberately not used as an authoritative storage mock.
function harness() {
  const indexedDB = new IDBFactory();
  const databases = new Set();
  const local = {};
  const clock = { now: 1000 };
  let failNextWrite = false;
  const originalOpen = indexedDB.open.bind(indexedDB);
  indexedDB.open = (...args) => {
    const request = originalOpen(...args);
    request.addEventListener("success", () => {
      const database = request.result;
      databases.add(database);
      const originalTransaction = database.transaction.bind(database);
      database.transaction = (...transactionArgs) => {
        const transaction = originalTransaction(...transactionArgs);
        if (failNextWrite && transactionArgs[1] === "readwrite") {
          failNextWrite = false;
          // Abort after the first put, not before any code has run. This covers
          // partially enqueued writes without making fake state look atomic.
          for (const storeName of transaction.objectStoreNames) {
            const store = transaction.objectStore(storeName);
            const put = store.put.bind(store);
            store.put = (...values) => {
              const result = put(...values);
              queueMicrotask(() => { if (transaction.readyState !== "done") { try { transaction.abort(); } catch {} } });
              return result;
            };
          }
        }
        return transaction;
      };
    });
    return request;
  };
  function context() {
    const sandbox = { indexedDB, console, Date: class extends Date { static now() { return clock.now; } },
      chrome: { storage: { local: {
        get: async selection => Object.fromEntries([].concat(selection || Object.keys(local))
          .filter(key => Object.hasOwn(local, key)).map(key => [key, structuredClone(local[key])])),
        set: async values => Object.assign(local, structuredClone(values)),
        remove: async selection => { for (const key of [].concat(selection)) delete local[key]; }
      }, onChanged: { addListener() {}, removeListener() {} } } } };
    vm.createContext(sandbox);
    for (const file of ["lib/appleJobStore.js", "lib/appleApplicationSafety.js", "lib/appleWithdrawalRecovery.js"]) {
      vm.runInContext(source(file), sandbox, { filename: file });
    }
    return sandbox;
  }
  return { context, clock, failNextWrite() { failNextWrite = true; },
    close() { for (const database of databases) database.close(); } };
}

function inventory(ids, startedAt = 1100) {
  const activeRoles = ids.map(role);
  const inventoryState = activeRoles.length ? "confirmed" : "confirmed_empty";
  const page = { roles: activeRoles, pageIndex: 1, pageCount: 1, hasNextPage: false,
    accountVerified: true, inventoryState, withdrawalConfirmationOpen: false };
  return { passes: [0, 1].map(index => ({ pages: [structuredClone(page)], pageCount: 1,
    complete: true, accountVerified: true, inventoryState,
    readStartedAt: startedAt + index * 100, readCompletedAt: startedAt + index * 100 + 50 })) };
}

async function seed(worker, ids = [jobId, otherJobId]) {
  const roles = ids.map(role);
  await worker.CareerPeelerJobStore.set({
    [keys.archive]: { pages: { 1: { roles, pageIndex: 1, pageCount: 1 } },
      latestScan: { roles, complete: true, updatedAt: 800 }, lastCompleteScan: { roles, complete: true, updatedAt: 800 } },
    [keys.ranking]: { version: 1, jobs: Object.fromEntries(roles.map(item => [item.jobId,
      { ...item, queueStatus: "submitted", eligible: false }])), searches: {}, applicationFailures: {},
      reservations: roles.map(item => ({ jobId: item.jobId, reservedAt: 700 })),
      capacitySnapshot: { roles, complete: true, accountVerified: true, inventoryState: "confirmed", updatedAt: 800 } }
  });
}

async function resolveInactive(worker, h, selected = operation(), activeIds = [otherJobId]) {
  await worker.beginAppleWithdrawalIntent(selected);
  h.clock.now = 2000;
  await worker.resolveAppleWithdrawalInventory(inventory(activeIds), { jobIds: [selected.jobId], expectedOperation: selected });
}

// Finalization must own both the journal condition and the resulting cleanup in
// a single database transaction. A preceding receipt from another message is not
// authority to change the current archive or release capacity.

test("worker restart cannot consume a receipt revoked while the panel awaited page stability", async () => {
  const h = harness();
  try {
    const original = h.context();
    await seed(original);
    await resolveInactive(original, h);
    const receipt = plain(await original.readAppleWithdrawalRecord(jobId));
    assert.equal(receipt.outcome, "inactive");
    const restarted = h.context();
    h.clock.now = 2100;
    await restarted.invalidateAppleWithdrawalResolution(operation(), "Another Apple tab confirms the selected job is active.");
    const before = plain(await restarted.CareerPeelerJobStore.get([keys.archive, keys.ranking]));
    await assert.rejects(original.commitAppleWithdrawalCleanup(operation()), reconciliationRequired);
    assert.deepEqual(plain(await restarted.CareerPeelerJobStore.get([keys.archive, keys.ranking])), before);
    assert.equal((await original.readAppleWithdrawalRecord(jobId)).outcome, "unknown");
    await assert.rejects(restarted.assertAppleWithdrawalRetryAllowed([jobId], 2200), /unresolved withdrawal/);
  } finally { h.close(); }
});

test("a freshly reconciled inactive operation cleans only its selected role in one durable transaction", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await seed(worker);
    await resolveInactive(worker, h);
    const result = await worker.commitAppleWithdrawalCleanup(operation());
    assert.equal(result.cleanupConfirmed, true);
    assert.equal(result.outcome, "inactive");
    assert.equal(result.proofVersion, 3);
    assert.equal(result.alreadyFinalized, false);
    assert.equal(result.jobId, jobId);
    const restarted = h.context();
    const saved = await restarted.CareerPeelerJobStore.get([keys.archive, keys.ranking]);
    for (const snapshot of [saved[keys.archive].pages[1], saved[keys.archive].latestScan, saved[keys.archive].lastCompleteScan]) {
      assert.deepEqual(plain(snapshot.roles.map(item => item.jobId)), [otherJobId]);
    }
    assert.deepEqual(plain(saved[keys.ranking].reservations.map(item => item.jobId)), [otherJobId]);
    assert.deepEqual(plain(saved[keys.ranking].capacitySnapshot.roles.map(item => item.jobId)), [otherJobId]);
    assert.equal(saved[keys.ranking].jobs[jobId].queueStatus, "withdrawn");
    assert.equal(saved[keys.ranking].jobs[otherJobId].queueStatus, "submitted");
    assert.equal((await restarted.readAppleWithdrawalRecord(jobId)).cleanup.completedAt, 2000);
  } finally { h.close(); }
});

for (const [name, overrides] of [
  ["another job", { jobId: otherJobId }],
  ["another reviewed batch", { batchId: "unreviewed-batch" }],
  ["an obsolete request", { requestId: "old-request" }],
  ["another Apple document", { documentId: "replacement-document" }]
]) {
  test(`${name} cannot finalize the selected operation's receipt`, async () => {
    const h = harness();
    try {
      const worker = h.context();
      await seed(worker);
      await resolveInactive(worker, h);
      const before = plain(await worker.CareerPeelerJobStore.get([keys.archive, keys.ranking]));
      await assert.rejects(worker.commitAppleWithdrawalCleanup(operation(overrides)), /withdrawal|operation|identity|verified/i);
      assert.deepEqual(plain(await worker.CareerPeelerJobStore.get([keys.archive, keys.ranking])), before);
      assert.equal((await worker.readAppleWithdrawalRecord(jobId)).cleanup, undefined);
    } finally { h.close(); }
  });
}

test("stale inactive evidence cannot release local active records or reservations", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await seed(worker);
    await resolveInactive(worker, h);
    h.clock.now = 70000;
    const before = plain(await worker.CareerPeelerJobStore.get([keys.archive, keys.ranking]));
    await assert.rejects(worker.commitAppleWithdrawalCleanup(operation()), reconciliationRequired);
    assert.deepEqual(plain(await worker.CareerPeelerJobStore.get([keys.archive, keys.ranking])), before);
  } finally { h.close(); }
});

test("a current active resolution never finalizes even after an older inactive resolution existed", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await seed(worker);
    await resolveInactive(worker, h);
    await worker.resolveAppleWithdrawalInventory(inventory([jobId, otherJobId], 1300), { expectedOperation: operation() });
    const before = plain(await worker.CareerPeelerJobStore.get([keys.archive, keys.ranking]));
    await assert.rejects(worker.commitAppleWithdrawalCleanup(operation()), reconciliationRequired);
    assert.deepEqual(plain(await worker.CareerPeelerJobStore.get([keys.archive, keys.ranking])), before);
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).outcome, "active");
  } finally { h.close(); }
});

test("late old cleanup cannot target a newly reviewed withdrawal intent for the same job", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await seed(worker);
    await worker.beginAppleWithdrawalIntent(operation());
    h.clock.now = 2000;
    await worker.resolveAppleWithdrawalInventory(inventory([jobId, otherJobId]), { expectedOperation: operation() });
    h.clock.now = 2200;
    const next = operation({ batchId: "new-reviewed-batch", requestId: "new-request", reviewedAt: 2100 });
    await worker.beginAppleWithdrawalIntent(next);
    const before = plain(await worker.CareerPeelerJobStore.get([keys.archive, keys.ranking]));
    await assert.rejects(worker.commitAppleWithdrawalCleanup(operation()), reconciliationRequired);
    assert.deepEqual(plain(await worker.CareerPeelerJobStore.get([keys.archive, keys.ranking])), before);
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).requestId, next.requestId);
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).outcome, "unknown");
  } finally { h.close(); }
});

test("duplicate cleanup messages after worker restart are idempotent and preserve new unrelated capacity state", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await seed(worker);
    await resolveInactive(worker, h);
    await worker.commitAppleWithdrawalCleanup(operation());
    const firstCleanup = plain((await worker.readAppleWithdrawalRecord(jobId)).cleanup);
    const ranking = (await worker.CareerPeelerJobStore.get(keys.ranking))[keys.ranking];
    ranking.reservations.push({ jobId: "209900003", state: "unknown", reservedAt: 2050 });
    await worker.CareerPeelerJobStore.set({ [keys.ranking]: ranking });
    h.clock.now = 2100;
    const restarted = h.context();
    const before = plain(await restarted.CareerPeelerJobStore.get([keys.archive, keys.ranking]));
    const repeat = await restarted.commitAppleWithdrawalCleanup(operation());
    assert.equal(repeat.cleanupConfirmed, true);
    assert.equal(repeat.alreadyFinalized, true);
    assert.deepEqual(plain(await restarted.CareerPeelerJobStore.get([keys.archive, keys.ranking])), before);
    assert.deepEqual(plain((await restarted.readAppleWithdrawalRecord(jobId)).cleanup), firstCleanup);
  } finally { h.close(); }
});

test("storage failure rolls back journal cleanup marker, archive removal, and released capacity together", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await seed(worker);
    await resolveInactive(worker, h);
    const before = plain(await worker.CareerPeelerJobStore.get(Object.values(keys)));
    h.failNextWrite();
    await assert.rejects(worker.commitAppleWithdrawalCleanup(operation()), /abort/i);
    assert.deepEqual(plain(await h.context().CareerPeelerJobStore.get(Object.values(keys))), before);
    const retry = await worker.commitAppleWithdrawalCleanup(operation());
    assert.equal(retry.cleanupConfirmed, true, "an uncommitted local cleanup may retry without another Proceed");
  } finally { h.close(); }
});

test("a later unresolved role preserves the earlier committed withdrawal in a partial batch", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await seed(worker);
    await resolveInactive(worker, h);
    await worker.commitAppleWithdrawalCleanup(operation());
    h.clock.now = 2100;
    const second = operation({ jobId: otherJobId, requestId: "second-request" });
    await worker.beginAppleWithdrawalIntent(second);
    await assert.rejects(worker.commitAppleWithdrawalCleanup(second), reconciliationRequired);
    const saved = await h.context().CareerPeelerJobStore.get(Object.values(keys));
    assert.deepEqual(plain(saved[keys.archive].latestScan.roles.map(item => item.jobId)), [otherJobId]);
    assert.deepEqual(plain(saved[keys.ranking].reservations.map(item => item.jobId)), [otherJobId]);
    assert.equal(saved[keys.journal].records[jobId].outcome, "inactive");
    assert.equal(saved[keys.journal].records[jobId].cleanup.completedAt, 2000);
    assert.equal(saved[keys.journal].records[otherJobId].outcome, "unknown");
    assert.equal(saved[keys.journal].records[otherJobId].cleanup, undefined);
  } finally { h.close(); }
});

test("a queued invalidation wins against cleanup across worker realms without exposing a partial write", async () => {
  const h = harness();
  try {
    const original = h.context(), restarted = h.context();
    await seed(original);
    await resolveInactive(original, h);
    await Promise.all([original.CareerPeelerJobStore.ready(), restarted.CareerPeelerJobStore.ready()]);
    const before = plain(await original.CareerPeelerJobStore.get([keys.archive, keys.ranking]));
    const results = await Promise.allSettled([
      restarted.invalidateAppleWithdrawalResolution(operation(), "Fresh active contradiction while the panel settles."),
      original.commitAppleWithdrawalCleanup(operation())
    ]);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    assert.deepEqual(plain(await original.CareerPeelerJobStore.get([keys.archive, keys.ranking])), before);
    assert.equal((await original.readAppleWithdrawalRecord(jobId)).outcome, "unknown");
  } finally { h.close(); }
});

test("atomic collection callback failure rolls back changes across split record and metadata stores", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await seed(worker);
    await resolveInactive(worker, h);
    const store = worker.CareerPeelerJobStore;
    const before = plain(await store.get(Object.values(keys)));
    await assert.rejects(store.updateCollections(Object.values(keys), values => {
      values[keys.archive].latestScan.roles = [];
      values[keys.ranking].reservations = [];
      values[keys.journal].records[jobId].outcome = "unknown";
      throw new Error("Synthetic callback failure after preparing all three changes");
    }), /Synthetic callback failure/);
    assert.deepEqual(plain(await h.context().CareerPeelerJobStore.get(Object.values(keys))), before);
  } finally { h.close(); }
});

test("atomic collection updates reject async callbacks instead of committing before their guard completes", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await seed(worker);
    const store = worker.CareerPeelerJobStore;
    const before = plain(await store.get([keys.archive, keys.ranking]));
    await assert.rejects(store.updateCollections([keys.archive, keys.ranking], async values => {
      values[keys.archive].latestScan.roles = [];
      return values;
    }), /synchronous|async|promise/i);
    assert.deepEqual(plain(await store.get([keys.archive, keys.ranking])), before);
  } finally { h.close(); }
});

test("confirmed-empty page does not clear an unrelated uncertain application reservation", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await seed(worker, [jobId]);
    const ranking = (await worker.CareerPeelerJobStore.get(keys.ranking))[keys.ranking];
    ranking.reservations.push({ jobId: otherJobId, state: "unknown", reservedAt: 950 });
    await worker.CareerPeelerJobStore.set({ [keys.ranking]: ranking });
    await resolveInactive(worker, h, operation(), []);
    const livePage = inventory([]).passes[1].pages[0];
    const result = await worker.commitAppleWithdrawalCleanup({ ...operation(), livePage });
    assert.equal(result.cleanupConfirmed, true);
    const saved = (await worker.CareerPeelerJobStore.get(keys.ranking))[keys.ranking];
    assert.deepEqual(plain(saved.reservations), [{ jobId: otherJobId, state: "unknown", reservedAt: 950 }]);
    assert.deepEqual(plain(saved.capacitySnapshot.roles), []);
  } finally { h.close(); }
});

test("background finalization route rejects content-script senders and consumes proof only for the panel", async () => {
  const { createBackgroundHarness } = require("./helpers/appleWorkflowHarness.cjs");
  const h = harness();
  try {
    const worker = h.context();
    await seed(worker);
    await resolveInactive(worker, h);
    const background = createBackgroundHarness();
    await background.ready;
    background.sandbox.CareerPeelerJobStore = worker.CareerPeelerJobStore;
    background.sandbox.Date = class extends Date { static now() { return h.clock.now; } };
    const message = { type: "APPLE_CAREERS_FINALIZE_WITHDRAWAL", ...operation() };
    const before = plain(await worker.CareerPeelerJobStore.get(Object.values(keys)));
    const blocked = await background.sandbox.dispatch(message, { tab: { id: 7 }, frameId: 0,
      documentId: "apple-document", url: "https://jobs.apple.com/app/en-us/profile/roles" });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /extension panel/);
    assert.deepEqual(plain(await worker.CareerPeelerJobStore.get(Object.values(keys))), before);
    const accepted = await background.sandbox.dispatch(message, {});
    assert.equal(accepted.ok, true);
    assert.equal(accepted.data.cleanupConfirmed, true);
    assert.equal(accepted.data.proofVersion, 3);
    assert.deepEqual(plain((await worker.CareerPeelerJobStore.get(keys.archive))[keys.archive].latestScan.roles.map(item => item.jobId)), [otherJobId]);
  } finally { h.close(); }
});

test("actual panel plus durable cleanup rejects a post-acknowledgment revocation across worker restart", async () => {
  const { createBackgroundHarness } = require("./helpers/appleWorkflowHarness.cjs");
  const { withdrawSubmittedRolesSequentially } = await import("../src/sidepanel/lib/submittedWithdrawals.mjs");
  const panelSource = source("src/sidepanel/components/SubmittedApplicationsSection.jsx");
  const reviewStart = panelSource.indexOf("  function reviewWithdrawals(");
  const reviewSource = panelSource.slice(reviewStart, panelSource.indexOf("\n  function closeWithdrawalConfirmation(", reviewStart));
  const withdrawStart = panelSource.indexOf("  async function withdrawSelected(");
  const withdrawSource = panelSource.slice(withdrawStart, panelSource.indexOf("\n  return (", withdrawStart));
  assert.ok(reviewStart > 0 && withdrawStart > 0, "execute the actual production selection and batch functions");
  const h = harness();
  try {
    const worker = h.context();
    await seed(worker);
    await worker.CareerPeelerJobStore.updateMetadata(keys.journal, () => ({ version: 1, records: {} }));
    const tab = { id: 7, windowId: 3, status: "complete", url: "https://jobs.apple.com/app/en-us/profile/roles" };
    const background = createBackgroundHarness([tab]);
    await background.ready;
    background.sandbox.CareerPeelerJobStore = worker.CareerPeelerJobStore;
    background.sandbox.Date = class extends Date { static now() { return h.clock.now; } };
    const selected = [role(jobId), role(otherJobId)];
    let acknowledged = false, revoked = false, requestCount = 0, finalizationCalls = 0;
    let currentOperation;
    const panel = {
      Date: class extends Date { static now() { return h.clock.now; } },
      selectedRoles: selected, confirmationSelectionRef: { current: null }, confirmationReviewedAtRef: { current: null },
      confirmationOpen: false, withdrawalInFlightRef: { current: false }, busyRef: { current: false },
      crypto: { randomUUID: () => `review-token-${++requestCount}` },
      setTimeout: callback => { h.clock.now += 300; callback(); },
      setConfirmationSelection() {}, setConfirmationOpen: value => { panel.confirmationOpen = value; },
      setBusy: value => { panel.busyRef.current = value; }, setWithdrawProgress() {},
      setStatusMessage: value => { panel.status = value; }, setError: value => { panel.error = value; },
      visibleRoles: selected.slice(), selectedIds: selected.map(item => item.jobId),
      setRoles: updater => { panel.visibleRoles = updater(panel.visibleRoles); },
      setSelectedIds: updater => { panel.selectedIds = typeof updater === "function" ? updater(panel.selectedIds) : updater; },
      rankSubmittedRoles: roles => roles,
      getActiveTab: async () => tab,
      reloadArchive: async () => {
        panel.visibleRoles = (await worker.CareerPeelerJobStore.get(keys.archive))[keys.archive].latestScan.roles;
      },
      withdrawSubmittedRolesSequentially,
      sendMessageWithFallback: async (_id, message) => {
        assert.equal(message.type, "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE");
        if (acknowledged && !revoked) {
          // This context represents a restarted worker observing fresh activity
          // on another Apple tab while the old panel awaits its current page.
          const restarted = h.context();
          h.clock.now += 1;
          await restarted.invalidateAppleWithdrawalResolution(currentOperation,
            "A second Apple Active tab confirms the selected job is still active.");
          revoked = true;
        }
        return { ok: true, data: { pageIndex: 1, pageCount: acknowledged ? 2 : 1,
          hasNextPage: acknowledged, accountVerified: true, inventoryState: "confirmed",
          withdrawalConfirmationOpen: false, roles: acknowledged ? [role(otherJobId)] : selected } };
      },
      chrome: {
        runtime: { sendMessage: async message => {
          if (message.type === "APPLE_CAREERS_GET_JOB_RANKING") return { ok: true, data: { running: false } };
          if (message.type === "APPLE_CAREERS_FINALIZE_WITHDRAWAL") finalizationCalls++;
          return background.sandbox.dispatch(message, {});
        } },
        tabs: { sendMessage: async (_id, message) => {
          assert.equal(message.type, "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES");
          assert.equal(message.roles[0].jobId, jobId, "the batch must stop before the next selected role");
          currentOperation = { ...operation(), batchId: message.batchId, requestId: message.requestId,
            reviewedAt: panel.confirmationReviewedAtRef.current || 1000 };
          await worker.beginAppleWithdrawalIntent(currentOperation);
          const startedAt = h.clock.now + 100;
          h.clock.now += 400;
          await worker.resolveAppleWithdrawalInventory(inventory([otherJobId], startedAt), { expectedOperation: currentOperation });
          acknowledged = true;
          return { ok: true, data: { jobId, batchId: message.batchId, requestId: message.requestId,
            identityVerified: true, inventoryVerified: true, proofVersion: 2, outcome: "inactive",
            withdrawn: [role(jobId)], failed: [] } };
        } }
      }
    };
    vm.createContext(panel);
    vm.runInContext(`${reviewSource}\n${withdrawSource}\nglobalThis.review=reviewWithdrawals;globalThis.confirm=withdrawSelected;`, panel);
    panel.review();
    await panel.confirm();
    assert.equal(acknowledged, true);
    assert.equal(revoked, true);
    assert.equal(finalizationCalls, 1);
    assert.match(panel.status, /Batch stopped after 0 of 2/);
    assert.match(panel.error, /proof changed or expired/);
    assert.equal(panel.visibleRoles.length, 2, "no optimistic removal after a rejected atomic finalization");
    assert.deepEqual(panel.selectedIds, [jobId, otherJobId]);
    const saved = await h.context().CareerPeelerJobStore.get(Object.values(keys));
    assert.equal(saved[keys.journal].records[jobId].outcome, "unknown");
    assert.equal(saved[keys.journal].records[jobId].cleanup, undefined);
    assert.equal(saved[keys.journal].records[otherJobId], undefined, "no second Proceed intent was created");
    assert.deepEqual(plain(saved[keys.archive].latestScan.roles.map(item => item.jobId)), [jobId, otherJobId]);
    assert.deepEqual(plain(saved[keys.ranking].reservations.map(item => item.jobId)), [jobId, otherJobId]);
  } finally { h.close(); }
});
