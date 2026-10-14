const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { IDBFactory } = require("fake-indexeddb");

const source = fs.readFileSync(require.resolve("../lib/appleJobStore.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const rankingKey = "appleJobRanking";
const appliedKey = "appleCareersAppliedJobs";
const reviewsKey = "appleSubmittedRoleReviews";
const workflowKey = "appleApplicationWorkflow";

test("workflow ownership claims are atomic across IndexedDB contexts and survive adapter restart", async () => {
  const h = storageHarness();
  try {
    const first = h.context(), second = h.context();
    const claim = owner => prior => {
      if (prior?.owner) throw new Error("Already owned");
      return { owner, status: "running", jobs: { "200123456-0836": { state: "not_started" } } };
    };
    const results = await Promise.allSettled([first.updateMetadata(workflowKey, claim("one")), second.updateMetadata(workflowKey, claim("two"))]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const saved = await h.context().getMetadata(workflowKey);
    assert.ok(["one", "two"].includes(saved.owner));
    assert.equal(saved.jobs["200123456-0836"].state, "not_started");
    assert.equal(h.data[workflowKey], undefined, "workflow state belongs in IndexedDB");
  } finally { h.close(); }
});

test("Submit intent and cancellation commit atomically and ranking writes cannot erase the journal", async () => {
  const h = storageHarness();
  try {
    const store = h.context();
    await store.updateMetadata(workflowKey, () => ({ status: "running", stopRequested: false, attempts: 0, outcome: "not_attempted" }));
    await store.updateMetadata(workflowKey, state => ({ ...state, attempts: 1, outcome: "unknown" }));
    await assert.rejects(store.updateMetadata(workflowKey, state => {
      state.attempts++;
      throw new Error("Synthetic permission failure");
    }), /Synthetic/);
    await store.updateMetadata(workflowKey, state => ({ ...state, status: "cancelled", stopRequested: true }));
    await store.set({ [rankingKey]: { jobs: {}, searches: {}, reservations: [] } });
    await store.patch(rankingKey, { jobs: {}, searches: {}, reservations: [], phase: "Stale UI write" }, {});
    assert.deepEqual(plain(await h.context().getMetadata(workflowKey)), {
      status: "cancelled", stopRequested: true, attempts: 1, outcome: "unknown"
    });
  } finally { h.close(); }
});

function storageHarness(seed = {}, { abortMigration = false } = {}) {
  const indexedDB = new IDBFactory();
  const data = structuredClone(seed);
  const removed = [];
  const databases = new Set();
  const channels = new Set();
  const localListeners = new Set();
  const logs = [];
  let cleanupFailures = 0;
  const local = {
    get: async keys => {
      const selected = keys == null ? Object.keys(data) : typeof keys === "string" ? [keys] : keys;
      return structuredClone(Object.fromEntries(selected.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])));
    },
    set: async updates => Object.assign(data, structuredClone(updates)),
    remove: async keys => {
      if (cleanupFailures-- > 0) throw new Error("Synthetic cleanup failure");
      for (const key of [].concat(keys)) { removed.push(key); delete data[key]; }
    }
  };
  const originalOpen = indexedDB.open.bind(indexedDB);
  indexedDB.open = (...args) => {
    const request = originalOpen(...args);
    request.addEventListener("success", () => {
      const database = request.result;
      databases.add(database);
      if (!abortMigration) return;
      const transaction = database.transaction.bind(database);
      database.transaction = (...transactionArgs) => {
        const tx = transaction(...transactionArgs);
        if (abortMigration && transactionArgs[1] === "readwrite") {
          abortMigration = false;
          const store = tx.objectStore("records");
          const put = store.put.bind(store);
          store.put = (...putArgs) => {
            const result = put(...putArgs);
            queueMicrotask(() => tx.abort());
            return result;
          };
        }
        return tx;
      };
    });
    return request;
  };
  class Channel {
    constructor(name) { this.name = name; channels.add(this); }
    postMessage(message) {
      for (const channel of channels) if (channel !== this && channel.name === this.name) channel.onmessage?.({ data: structuredClone(message) });
    }
  }
  function context() {
    const sandbox = { indexedDB, BroadcastChannel: Channel,
      console: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
      chrome: { storage: { local, onChanged: {
        addListener: listener => localListeners.add(listener), removeListener: listener => localListeners.delete(listener)
      } } } };
    vm.runInNewContext(source, sandbox, { filename: "lib/appleJobStore.js" });
    return sandbox.CareerPeelerJobStore;
  }
  return { context, data, removed, logs, localListeners,
    failCleanupOnce() { cleanupFailures = 1; },
    close() { for (const database of databases) database.close(); } };
}

test("migration retains queue, pages, ledgers, and protected role data while leaving the PDF/profile in Chrome storage", async () => {
  const legacy = {
    [rankingKey]: { jobs: { "200654506": { jobId: "200654506", queueStatus: "queued" } }, searches: {}, applicationFailures: {}, reservations: [] },
    [reviewsKey]: { pages: { 1: { roles: [{ jobId: "200654506", favorite: true, protectedFromBatchWithdrawal: true }] } },
      lastCompleteScan: { roles: [{ jobId: "200654506" }], complete: true } },
    [appliedKey]: { "apple:200000001": { jobId: "200000001", site: "apple" } },
    appleCareersUserProfile: { resumeFileDataUrl: "data:application/pdf;base64,fixture", llmApiKey: "synthetic-secret" },
    unrelated: "retained"
  };
  const h = storageHarness(legacy);
  try {
    const store = h.context();
    const values = await store.get([rankingKey, reviewsKey, appliedKey]);
    for (const key of [rankingKey, reviewsKey, appliedKey]) assert.deepEqual(plain(values[key]), legacy[key]);
    assert.deepEqual(h.data.appleCareersUserProfile, legacy.appleCareersUserProfile);
    assert.equal(h.data.unrelated, "retained");
    assert.deepEqual(h.removed.sort(), [rankingKey, reviewsKey, appliedKey].sort());
    const db = await store.ready();
    const request = db.transaction("metadata", "readonly").objectStore("metadata").get("migration:chrome-local-v1");
    const marker = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    assert.equal(marker.value.version, 1);
    assert.deepEqual(plain(marker.value.importedKeys).sort(), h.removed.sort());
  } finally { h.close(); }
});

test("an aborted migration preserves its sources and a subsequent attempt imports them", async () => {
  const original = { "apple:200000001": { jobId: "200000001", site: "apple" } };
  const h = storageHarness({ [appliedKey]: original }, { abortMigration: true });
  try {
    const store = h.context();
    await assert.rejects(store.ready(), /abort/i);
    assert.deepEqual(h.data[appliedKey], original);
    assert.equal(h.removed.length, 0);
    const values = await store.get(appliedKey);
    assert.deepEqual(plain(values[appliedKey]), original);
    assert.equal(h.data[appliedKey], undefined);
  } finally { h.close(); }
});

test("cleanup retry and a second context never reimport stale legacy data over newer records", async () => {
  const h = storageHarness({ [appliedKey]: { old: { jobId: "200000001" } } });
  h.failCleanupOnce();
  try {
    const first = h.context();
    await first.ready();
    assert.ok(h.data[appliedKey]);
    await first.set({ [appliedKey]: { newer: { jobId: "200000002" } } });
    const second = h.context();
    const values = await second.get(appliedKey);
    assert.deepEqual(plain(values[appliedKey]), { newer: { jobId: "200000002" } });
    assert.equal(h.data[appliedKey], undefined);
    assert.equal(h.logs.length, 1);
  } finally { h.close(); }
});

test("simultaneous worker/panel startup performs one atomic migration", async () => {
  const h = storageHarness({ [appliedKey]: { one: { jobId: "200000001" } } });
  try {
    const first = h.context(), second = h.context();
    const [a, b] = await Promise.all([first.get(appliedKey), second.get(appliedKey)]);
    assert.deepEqual(plain(a), plain(b));
    await first.putRecords(appliedKey, { two: { jobId: "200000002" } });
    assert.equal((await second.get(appliedKey))[appliedKey].two.jobId, "200000002");
  } finally { h.close(); }
});

test("record patches update only named jobs and support deletions without replacing other maps", async () => {
  const h = storageHarness();
  try {
    const store = h.context();
    await store.set({ [rankingKey]: { version: 1, phase: "Saved", jobs: { one: { score: 80 }, two: { score: 70 } },
      searches: { filter: { complete: true } }, applicationFailures: { failure: { status: "uncertain" } } } });
    await store.patch(rankingKey, { version: 1, phase: "Ranked", jobs: { one: { score: 90 } } }, { jobs: ["one"] });
    const saved = (await store.get(rankingKey))[rankingKey];
    assert.equal(saved.jobs.one.score, 90);
    assert.equal(saved.jobs.two.score, 70);
    assert.equal(saved.searches.filter.complete, true);
    assert.equal(saved.applicationFailures.failure.status, "uncertain");
    assert.deepEqual(plain(await store.getMetadata(rankingKey)), { version: 1, phase: "Ranked" });
    assert.deepEqual(plain(await store.getRecords(rankingKey, ["one", "one", "absent"], "jobs")), { one: { score: 90 } });
    await store.patch(rankingKey, { version: 1, jobs: {} }, { jobs: ["one"] });
    assert.equal((await store.get(rankingKey))[rankingKey].jobs.one, undefined);
    assert.equal(h.data[rankingKey], undefined);
  } finally { h.close(); }
});

test("an aborted write preserves the last committed records and does not publish a change", async () => {
  const h = storageHarness();
  try {
    const store = h.context();
    await store.set({ [rankingKey]: { phase: "Saved", jobs: { one: { score: 80 } }, searches: {}, applicationFailures: {} } });
    const changes = [];
    store.onChanged.addListener(value => changes.push(value));
    const db = await store.ready();
    const transaction = db.transaction.bind(db);
    db.transaction = (...args) => {
      const tx = transaction(...args);
      if (args[1] === "readwrite") queueMicrotask(() => tx.abort());
      return tx;
    };
    await assert.rejects(store.patch(rankingKey, { phase: "Ranked", jobs: { one: { score: 99 } } }, { jobs: ["one"] }), /abort/i);
    db.transaction = transaction;
    const saved = (await store.get(rankingKey))[rankingKey];
    assert.equal(saved.phase, "Saved");
    assert.equal(saved.jobs.one.score, 80);
    assert.equal(changes.length, 0);
  } finally { h.close(); }
});

test("committed database writes notify both contexts and remove unsubscribed listeners", async () => {
  const h = storageHarness();
  try {
    const first = h.context(), second = h.context();
    const own = [], other = [];
    const ownListener = (changes, area) => own.push({ keys: Object.keys(changes), area });
    const otherListener = (changes, area) => other.push({ keys: Object.keys(changes), area });
    first.onChanged.addListener(ownListener);
    second.onChanged.addListener(otherListener);
    await first.putRecords(appliedKey, { one: { jobId: "200000001" } });
    assert.deepEqual(own, [{ keys: [appliedKey], area: "indexeddb" }]);
    assert.deepEqual(other, own);
    assert.equal((await second.get(appliedKey))[appliedKey].one.jobId, "200000001");
    second.onChanged.removeListener(otherListener);
    await first.putRecords(appliedKey, { one: undefined });
    assert.equal(other.length, 1);
    assert.equal(h.localListeners.size, 1);
  } finally { h.close(); }
});

test("collection removal leaves unrelated job collections and local profile settings intact", async () => {
  const h = storageHarness({ appleCareersUserProfile: { workAuthorized: "no" } });
  try {
    const store = h.context();
    await store.set({ [appliedKey]: { one: { jobId: "200000001" } }, [reviewsKey]: { pages: { 1: { roles: [] } } } });
    await store.remove(appliedKey);
    const values = await store.get(null);
    assert.equal(values[appliedKey], undefined);
    assert.equal(values[reviewsKey].pages[1].roles.length, 0);
    assert.equal(values.appleCareersUserProfile.workAuthorized, "no");
    await assert.rejects(store.getRecords(rankingKey, ["one"]), /direct record reads/);
    await assert.rejects(store.patch(rankingKey, {}, { unknown: [] }), /Unknown/);
  } finally { h.close(); }
});
