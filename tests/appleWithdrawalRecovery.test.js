const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { IDBFactory } = require("fake-indexeddb");

const root = path.resolve(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const jobId = "200670922";
const otherJobId = "200670923";
const intent = (overrides = {}) => ({ jobId, batchId: "review-one", requestId: "request-one",
  tabId: 41, documentId: "document-one", reviewedAt: 900, ...overrides });

function evidence(ids, { startedAt = 1100, pageSize = 10 } = {}) {
  const pageCount = Math.max(1, Math.ceil(ids.length / pageSize));
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const roles = ids.slice(index * pageSize, (index + 1) * pageSize)
      .map(id => ({ jobId: id, active: true, title: "A Shared Job Title" }));
    return { roles, pageIndex: index + 1, pageCount, hasNextPage: index + 1 < pageCount,
      accountVerified: true, inventoryState: roles.length ? "confirmed" : "confirmed_empty",
      withdrawalConfirmationOpen: false };
  });
  return { passes: [0, 1].map(index => ({ pages: structuredClone(pages), pageCount,
    complete: true, accountVerified: true, inventoryState: ids.length ? "confirmed" : "confirmed_empty",
    readStartedAt: startedAt + index * 100, readCompletedAt: startedAt + index * 100 + 50 })) };
}

// Run the actual storage adapter, validation rules, and recovery module in
// independent worker contexts sharing a real (fake-indexeddb) database. This
// exercises transaction completion, rollback and restart, not a get/set mock.
function harness() {
  const indexedDB = new IDBFactory();
  const databases = new Set();
  const clock = { now: 1000 };
  const data = {};
  let abortNextWrite = false;
  const open = indexedDB.open.bind(indexedDB);
  indexedDB.open = (...args) => {
    const request = open(...args);
    request.addEventListener("success", () => {
      const database = request.result;
      databases.add(database);
      const transaction = database.transaction.bind(database);
      database.transaction = (...transactionArgs) => {
        const tx = transaction(...transactionArgs);
        if (transactionArgs[1] === "readwrite" && abortNextWrite) {
          abortNextWrite = false;
          const store = tx.objectStore("metadata");
          const put = store.put.bind(store);
          store.put = (...values) => {
            const result = put(...values);
            queueMicrotask(() => tx.abort());
            return result;
          };
        }
        return tx;
      };
    });
    return request;
  };
  function context() {
    const sandbox = { indexedDB, console, Date: class extends Date { static now() { return clock.now; } },
      chrome: { storage: { local: {
        get: async keys => Object.fromEntries([].concat(keys || Object.keys(data))
          .filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])])),
        set: async updates => Object.assign(data, structuredClone(updates)),
        remove: async keys => { for (const key of [].concat(keys)) delete data[key]; }
      }, onChanged: { addListener() {}, removeListener() {} } } } };
    vm.createContext(sandbox);
    for (const file of ["lib/appleJobStore.js", "lib/appleApplicationSafety.js", "lib/appleWithdrawalRecovery.js"]) {
      vm.runInContext(source(file), sandbox, { filename: file });
    }
    return sandbox;
  }
  return { context, clock, data, abortNextWrite() { abortNextWrite = true; },
    close() { for (const database of databases) database.close(); } };
}

test("Proceed intent commits to IndexedDB and blocks a new batch after worker restart", async () => {
  const h = harness();
  try {
    const first = h.context();
    const saved = await first.beginAppleWithdrawalIntent(intent());
    assert.equal(saved.outcome, "unknown");
    assert.equal(saved.intentAt, 1000);
    assert.equal(h.data.appleWithdrawalWorkflow, undefined, "journal is not Chrome-local cached state");
    const restarted = h.context();
    assert.deepEqual(plain(await restarted.readAppleWithdrawalRecord(jobId)), plain(saved));
    await assert.rejects(restarted.assertAppleWithdrawalRetryAllowed([jobId], 3000), /unresolved withdrawal/);
    await assert.rejects(restarted.beginAppleWithdrawalIntent(intent({ batchId: "new-review", requestId: "new-request",
      documentId: "new-document", reviewedAt: 3000 })), /unresolved withdrawal/);
    assert.equal((await restarted.readAppleWithdrawalRecord(jobId)).attempts, 1);
  } finally { h.close(); }
});

test("concurrent contexts cannot authorize two unresolved withdrawal intents", async () => {
  const h = harness();
  try {
    const first = h.context(), second = h.context();
    const results = await Promise.allSettled([
      first.beginAppleWithdrawalIntent(intent()),
      second.beginAppleWithdrawalIntent(intent({ batchId: "competing-review", requestId: "competing-request" }))
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.match(results.find(result => result.status === "rejected").reason.message, /unresolved withdrawal/);
    assert.equal((await h.context().readAppleWithdrawalRecord(jobId)).attempts, 1);
  } finally { h.close(); }
});

test("journal identities retain exact full IDs without suffix or base inference", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    await worker.beginAppleWithdrawalIntent(intent({ jobId: `${jobId}-0836`, requestId: "suffix-request" }));
    h.clock.now = 2000;
    const records = await worker.resolveAppleWithdrawalInventory(evidence([`${jobId}-0836`]));
    assert.equal(records[jobId].outcome, "inactive");
    assert.equal(records[`${jobId}-0836`].outcome, "active");
    assert.equal((await worker.readAppleWithdrawalJournal()).records[jobId].jobId, jobId);
  } finally { h.close(); }
});

test("verified absence resolves the prior operation inactive and never grants another Proceed", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    h.clock.now = 2000;
    const records = await worker.resolveAppleWithdrawalInventory(evidence([otherJobId]), { expectedOperation: intent() });
    assert.equal(records[jobId].outcome, "inactive");
    assert.equal(records[jobId].verifiedAt, 1250);
    assert.equal(records[jobId].reconciledAt, 2000);
    await assert.rejects(worker.assertAppleWithdrawalRetryAllowed([jobId], 2100), /confirmed this job inactive/);
    await assert.rejects(worker.beginAppleWithdrawalIntent(intent({ batchId: "new-review", requestId: "new-request", reviewedAt: 2100 })), /confirmed this job inactive/);
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).attempts, 1);
  } finally { h.close(); }
});

test("verified active outcome requires review after reconciliation and a different batch", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    h.clock.now = 2000;
    const records = await worker.resolveAppleWithdrawalInventory(evidence([jobId]));
    assert.equal(records[jobId].outcome, "active");
    for (const reviewedAt of [900, 1999, 2000]) {
      await assert.rejects(worker.assertAppleWithdrawalRetryAllowed([jobId], reviewedAt), /Review and confirm a new/);
    }
    await worker.assertAppleWithdrawalRetryAllowed([jobId], 2100);
    await assert.rejects(worker.beginAppleWithdrawalIntent(intent({ requestId: "another-request", reviewedAt: 2100 })), /newly reviewed batch/);
    h.clock.now = 2200;
    const retry = await worker.beginAppleWithdrawalIntent(intent({ batchId: "new-reviewed-batch", requestId: "new-request", reviewedAt: 2100 }));
    assert.equal(retry.outcome, "unknown");
    assert.equal(retry.attempts, 2);
    await assert.rejects(worker.assertAppleWithdrawalRetryAllowed([jobId], 2300), /unresolved withdrawal/);
  } finally { h.close(); }
});

test("active identity on a later inventory page prevents inactive resolution despite matching titles", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    h.clock.now = 2000;
    const records = await worker.resolveAppleWithdrawalInventory(evidence([otherJobId, jobId], { pageSize: 1 }));
    assert.equal(records[jobId].outcome, "active");
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).outcome, "active");
  } finally { h.close(); }
});

for (const [label, mutate, now = 2000] of [
  ["incomplete pagination", proof => { proof.passes[1].pageCount = 2; }],
  ["authentication failure", proof => { proof.passes[1].pages[0].accountVerified = false; }],
  ["one read only", proof => { proof.passes.pop(); }],
  ["contradictory inventory", proof => { proof.passes[1] = evidence([jobId]).passes[1]; }],
  ["read started before intent", proof => { proof.passes[0].readStartedAt = 999; }],
  ["cached read older than the freshness limit", () => {}, 70000],
  ["future read timestamp", proof => { proof.passes[1].readCompletedAt = 3000; }]
]) {
  test(`${label} cannot resolve or unblock an unknown withdrawal`, async () => {
    const h = harness();
    try {
      const worker = h.context();
      await worker.beginAppleWithdrawalIntent(intent());
      h.clock.now = now;
      const proof = evidence([otherJobId]); mutate(proof);
      await assert.rejects(worker.resolveAppleWithdrawalInventory(proof), /complete.*inventory/);
      assert.equal((await h.context().readAppleWithdrawalRecord(jobId)).outcome, "unknown");
      await assert.rejects(worker.assertAppleWithdrawalRetryAllowed([jobId], now + 1), /unresolved withdrawal/);
    } finally { h.close(); }
  });
}

test("reconciliation failure is atomic across multiple unresolved jobs", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    h.clock.now = 1800;
    await worker.beginAppleWithdrawalIntent(intent({ jobId: otherJobId, requestId: "later-request" }));
    h.clock.now = 2000;
    await assert.rejects(worker.resolveAppleWithdrawalInventory(evidence([])), /fresh, complete, stable/);
    const records = (await h.context().readAppleWithdrawalJournal()).records;
    assert.equal(records[jobId].outcome, "unknown");
    assert.equal(records[otherJobId].outcome, "unknown");
  } finally { h.close(); }
});

test("a delayed prior operation proof cannot resolve a newer intent", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    h.clock.now = 2000;
    await worker.resolveAppleWithdrawalInventory(evidence([jobId]));
    h.clock.now = 2200;
    const current = intent({ batchId: "new-reviewed-batch", requestId: "new-request", reviewedAt: 2100 });
    await worker.beginAppleWithdrawalIntent(current);
    h.clock.now = 3000;
    await assert.rejects(worker.resolveAppleWithdrawalInventory(evidence([], { startedAt: 2300 }), { expectedOperation: intent() }), /older withdrawal operation/);
    await assert.rejects(worker.resolveAppleWithdrawalInventory(evidence([]), { expectedOperation: current }), /fresh, complete, stable/);
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).outcome, "unknown");
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).requestId, "new-request");
  } finally { h.close(); }
});

test("fresh contradictory active evidence replaces inactive status and old evidence cannot override it", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    h.clock.now = 2000;
    const absent = evidence([otherJobId]);
    await worker.resolveAppleWithdrawalInventory(absent, { expectedOperation: intent() });
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).outcome, "inactive");
    const present = evidence([otherJobId, jobId], { startedAt: 1300 });
    const records = await worker.resolveAppleWithdrawalInventory(present, { expectedOperation: intent() });
    assert.equal(records[jobId].outcome, "active");
    assert.equal(records[jobId].verifiedAt, 1450);
    await assert.rejects(worker.resolveAppleWithdrawalInventory(absent, { expectedOperation: intent() }), /fresh, complete, stable/);
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).outcome, "active");
    await assert.rejects(worker.assertAppleWithdrawalRetryAllowed([jobId], 1999), /Review and confirm a new/);
  } finally { h.close(); }
});

test("a stale active reconciliation cannot permit retry until a fresh inventory and new review", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    h.clock.now = 2000;
    await worker.resolveAppleWithdrawalInventory(evidence([jobId]));
    h.clock.now = 70000;
    await assert.rejects(worker.assertAppleWithdrawalRetryAllowed([jobId], 69900), /check is stale/);
    await assert.rejects(worker.beginAppleWithdrawalIntent(intent({ batchId: "new-review", requestId: "new-request", reviewedAt: 69900 })), /check is stale/);
    const records = await worker.resolveAppleWithdrawalInventory(evidence([jobId], { startedAt: 69000 }));
    assert.equal(records[jobId].outcome, "active");
    assert.equal(records[jobId].reconciledAt, 70000);
    await assert.rejects(worker.assertAppleWithdrawalRetryAllowed([jobId], 69900), /Review and confirm a new/);
    h.clock.now = 71000;
    await worker.beginAppleWithdrawalIntent(intent({ batchId: "fresh-reviewed-batch", requestId: "new-request", reviewedAt: 70500 }));
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).outcome, "unknown");
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).attempts, 2);
  } finally { h.close(); }
});

test("contradictory status invalidates an inactive receipt until inventory begun after uncertainty", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    h.clock.now = 2000;
    await worker.resolveAppleWithdrawalInventory(evidence([otherJobId]), { expectedOperation: intent() });
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).outcome, "inactive");
    const invalidated = await worker.invalidateAppleWithdrawalResolution(intent(), "The selected job is still active in a current page read.");
    assert.equal(invalidated.outcome, "unknown");
    assert.equal(invalidated.uncertainAt, 2001);
    assert.equal(invalidated.verifiedAt, 1250, "retain the earlier proof for diagnosis, without treating it as current authority");
    await assert.rejects(worker.assertAppleWithdrawalRetryAllowed([jobId], 2100), /unresolved withdrawal/);
    const restarted = h.context();
    assert.equal((await restarted.readAppleWithdrawalRecord(jobId)).outcome, "unknown");
    await assert.rejects(restarted.resolveAppleWithdrawalInventory(evidence([], { startedAt: 1300 }), { expectedOperation: intent() }), /fresh, complete, stable/);
    assert.equal((await restarted.readAppleWithdrawalRecord(jobId)).outcome, "unknown");
    h.clock.now = 3000;
    const resolved = await restarted.resolveAppleWithdrawalInventory(evidence([otherJobId], { startedAt: 2100 }), { expectedOperation: intent() });
    assert.equal(resolved[jobId].outcome, "inactive");
    assert.equal(resolved[jobId].verifiedAt, 2250);
  } finally { h.close(); }
});

test("an old contradictory observation cannot invalidate a newer withdrawal intent", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    h.clock.now = 2000;
    await worker.resolveAppleWithdrawalInventory(evidence([jobId]));
    h.clock.now = 2200;
    const current = intent({ batchId: "new-reviewed-batch", requestId: "new-request", reviewedAt: 2100 });
    await worker.beginAppleWithdrawalIntent(current);
    await assert.rejects(worker.invalidateAppleWithdrawalResolution(intent(), "Delayed old page status"), /older withdrawal operation/);
    const saved = await worker.readAppleWithdrawalRecord(jobId);
    assert.equal(saved.requestId, "new-request");
    assert.equal(saved.outcome, "unknown");
    assert.equal(saved.uncertainAt, undefined);
  } finally { h.close(); }
});

test("concurrent stale resolution and contradiction cannot restore an inactive receipt", async () => {
  const h = harness();
  try {
    const first = h.context(), second = h.context();
    await first.beginAppleWithdrawalIntent(intent());
    h.clock.now = 2000;
    await first.resolveAppleWithdrawalInventory(evidence([]));
    h.clock.now = 3000;
    await Promise.allSettled([
      first.resolveAppleWithdrawalInventory(evidence([], { startedAt: 1300 }), { expectedOperation: intent() }),
      second.invalidateAppleWithdrawalResolution(intent(), "Current selected role is active")
    ]);
    const saved = await h.context().readAppleWithdrawalRecord(jobId);
    assert.equal(saved.outcome, "unknown");
    assert.equal(saved.uncertainAt, 3001);
  } finally { h.close(); }
});

test("explicit fresh synchronization refreshes inactive journal status when exact job is active", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    h.clock.now = 2000;
    await worker.resolveAppleWithdrawalInventory(evidence([]));
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).outcome, "inactive");
    const records = await worker.resolveAppleWithdrawalInventory(evidence([jobId], { startedAt: 1300 }));
    assert.equal(records[jobId].outcome, "active");
    assert.equal(records[jobId].verifiedAt, 1450);
    await assert.rejects(worker.assertAppleWithdrawalRetryAllowed([jobId], 1999), /Review and confirm a new/);
  } finally { h.close(); }
});

test("a same-millisecond pre-contradiction proof cannot restore an inactive receipt", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    h.clock.now = 2000;
    await worker.resolveAppleWithdrawalInventory(evidence([]));
    const invalidated = await worker.invalidateAppleWithdrawalResolution(intent(), "Selected role active at this instant");
    assert.equal(invalidated.uncertainAt, 2001);
    h.clock.now = 3000;
    await assert.rejects(worker.resolveAppleWithdrawalInventory(evidence([], { startedAt: 2000 }), { expectedOperation: intent() }), /fresh, complete, stable/);
    assert.equal((await worker.readAppleWithdrawalRecord(jobId)).outcome, "unknown");
    const verified = await worker.resolveAppleWithdrawalInventory(evidence([], { startedAt: 2001 }), { expectedOperation: intent() });
    assert.equal(verified[jobId].outcome, "inactive");
  } finally { h.close(); }
});

test("an aborted intent transaction cannot grant durable withdrawal permission", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.CareerPeelerJobStore.ready();
    h.abortNextWrite();
    await assert.rejects(worker.beginAppleWithdrawalIntent(intent()), /abort/i);
    assert.equal(await h.context().readAppleWithdrawalRecord(jobId), null);
    const saved = await worker.beginAppleWithdrawalIntent(intent());
    assert.equal(saved.attempts, 1);
  } finally { h.close(); }
});

test("ranking, application recovery and stale panel writes cannot erase unknown withdrawal intent", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.beginAppleWithdrawalIntent(intent());
    await worker.CareerPeelerJobStore.set({ appleJobRanking: { jobs: {}, searches: {}, reservations: [] },
      appleSubmittedRoleReviews: { pages: {} }, appleApplicationWorkflow: { status: "cancelled" } });
    await worker.CareerPeelerJobStore.patch("appleJobRanking", { jobs: {}, searches: {}, phase: "stale panel" }, {});
    assert.equal((await h.context().readAppleWithdrawalRecord(jobId)).outcome, "unknown");
  } finally { h.close(); }
});

test("malformed durable state fails closed instead of dropping unknown records", async () => {
  const h = harness();
  try {
    const worker = h.context();
    await worker.CareerPeelerJobStore.updateMetadata("appleWithdrawalWorkflow", () => ({ version: 1,
      records: { [jobId]: { jobId, outcome: "active" } } }));
    await assert.rejects(worker.readAppleWithdrawalJournal(), /safety state is incomplete/);
    await assert.rejects(worker.assertAppleWithdrawalRetryAllowed([otherJobId], 3000), /safety state is incomplete/);
    await assert.rejects(worker.beginAppleWithdrawalIntent(intent()), /safety state is incomplete/);
  } finally { h.close(); }
});
