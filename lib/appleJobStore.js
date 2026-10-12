// Shared by the classic background worker and the bundled side panel. The
// database belongs to the extension origin, never to an Apple content script.
(function (root) {
  const DATABASE_NAME = "CareerPeelerJobs";
  const MIGRATION_KEY = "migration:chrome-local-v1";
  const layouts = {
    appleJobRanking: { jobs: "rankedJobs", searches: "searches", applicationFailures: "applicationFailures" },
    appleSubmittedRoleDetailsCache: { root: "postings" },
    appleSubmittedRoleScoresCache: { root: "submissionScores" },
    appleSubmittedRoleReviews: { pages: "submissionPages" },
    appleCareersAppliedJobs: { root: "appliedJobs" },
    appleCareersErrorJobs: { root: "errorJobs" },
    appleCareersJobRecords: { root: "jobRecords" },
    appleCareersDetailedJobLogs: { root: "jobLogs" },
    appleCareersKnownSiteActivity: {}
  };
  const keys = Object.keys(layouts);
  const listeners = new Set();
  let databasePromise;
  let migrationPromise;
  let channel;

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error("The job database transaction was aborted."));
      transaction.onerror = () => {}; // Abort reports the final transaction failure.
    });
  }

  function openDatabase() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          database.createObjectStore("metadata", { keyPath: "key" });
          const records = database.createObjectStore("records", { keyPath: ["bucket", "id"] });
          records.createIndex("bucket", "bucket");
        };
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => { database.close(); databasePromise = null; migrationPromise = null; };
          resolve(database);
        };
        request.onerror = () => { databasePromise = null; reject(request.error); };
        request.onblocked = () => { databasePromise = null; reject(new Error("Close older extension panels, then reopen Career Peeler to update its job database.")); };
      });
    }
    return databasePromise;
  }

  function splitValue(key, value) {
    const layout = layouts[key];
    if (layout.root) return { metadata: {}, maps: { [layout.root]: value || {} } };
    const metadata = { ...value };
    const maps = {};
    for (const [field, bucket] of Object.entries(layout)) {
      maps[bucket] = metadata[field] || {};
      delete metadata[field];
    }
    return { metadata, maps };
  }

  async function migrate(database) {
    const legacy = await chrome.storage.local.get(keys);
    const transaction = database.transaction(["metadata", "records"], "readwrite", { durability: "strict" });
    const done = transactionDone(transaction);
    const metadata = transaction.objectStore("metadata");
    const records = transaction.objectStore("records");
    const marker = metadata.get(MIGRATION_KEY);
    // The marker and all imported records commit together. A second panel/worker
    // waits for this transaction and cannot import a stale copy over newer data.
    marker.onsuccess = () => {
      if (marker.result) return;
      const importedKeys = keys.filter(key => Object.hasOwn(legacy, key));
      for (const key of importedKeys) {
        const split = splitValue(key, legacy[key]);
        metadata.put({ key, value: split.metadata });
        for (const [bucket, values] of Object.entries(split.maps)) {
          for (const [id, value] of Object.entries(values)) records.put({ bucket, id, value });
        }
      }
      metadata.put({ key: MIGRATION_KEY, value: { version: 1, importedKeys, completedAt: Date.now() } });
    };
    await done;
    const verification = database.transaction("metadata", "readonly");
    const verified = transactionDone(verification);
    const [saved] = await Promise.all([requestResult(verification.objectStore("metadata").get(MIGRATION_KEY)), verified]);
    if (!saved?.value?.completedAt) throw new Error("Saved jobs could not be migrated. The original Chrome storage data has been retained.");
    // Removing only committed source keys is safe to retry after a crash. Profile
    // settings, PDF resume and unrelated legacy data remain in Chrome storage.
    if (saved.value.importedKeys.length) {
      await chrome.storage.local.remove(saved.value.importedKeys).catch(error =>
        console.warn("Career Peeler: old job cache cleanup will be retried after restart.", error?.message));
    }
  }

  async function ready() {
    const database = await openDatabase();
    if (!migrationPromise) {
      migrationPromise = migrate(database).catch(error => { migrationPromise = null; throw error; });
    }
    await migrationPromise;
    return database;
  }

  function emit(changedKeys) {
    const changes = Object.fromEntries(changedKeys.map(key => [key, {}]));
    for (const listener of listeners) {
      try { listener(changes, "indexeddb"); } catch (error) { console.error(error); }
    }
  }

  function notificationChannel() {
    if (!channel && typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("career-peeler-job-storage");
      channel.onmessage = event => {
        if (Array.isArray(event.data?.keys)) emit(event.data.keys.filter(key => Object.hasOwn(layouts, key)));
      };
    }
    return channel;
  }

  function notify(changedKeys) {
    if (!changedKeys.length) return;
    emit(changedKeys);
    notificationChannel()?.postMessage({ keys: changedKeys });
  }

  async function readValues(selectedKeys) {
    const database = await ready();
    const transaction = database.transaction(["metadata", "records"], "readonly");
    const done = transactionDone(transaction);
    const metadata = transaction.objectStore("metadata");
    const index = transaction.objectStore("records").index("bucket");
    const reads = selectedKeys.map(key => {
      const header = requestResult(metadata.get(key));
      const layout = layouts[key];
      const fields = Object.entries(layout).map(([field, bucket]) =>
        requestResult(index.getAll(bucket)).then(rows => [field, Object.fromEntries(rows.map(row => [row.id, row.value]))]));
      return Promise.all([header, ...fields]).then(([entry, ...maps]) => {
        if (!entry) return null;
        return [key, layout.root ? maps[0][1] : { ...entry.value, ...Object.fromEntries(maps) }];
      });
    });
    const [values] = await Promise.all([Promise.all(reads), done]);
    return Object.fromEntries(values.filter(Boolean));
  }

  async function get(selection) {
    const all = selection == null;
    const selectedKeys = all ? keys : typeof selection === "string" ? [selection]
      : Array.isArray(selection) ? selection : Object.keys(selection);
    const databaseKeys = selectedKeys.filter(key => Object.hasOwn(layouts, key));
    const localKeys = selectedKeys.filter(key => !Object.hasOwn(layouts, key));
    const [databaseValues, localValues] = await Promise.all([
      databaseKeys.length ? readValues(databaseKeys) : {},
      all || localKeys.length ? chrome.storage.local.get(all ? null : localKeys) : {}
    ]);
    const defaults = selection && !Array.isArray(selection) && typeof selection === "object" ? selection : {};
    return { ...defaults, ...localValues, ...databaseValues };
  }

  function replaceMap(records, bucket, values) {
    const existing = records.index("bucket").getAll(bucket);
    existing.onsuccess = () => {
      const remaining = new Map(Object.entries(values));
      for (const row of existing.result) {
        if (!remaining.has(row.id)) records.delete([bucket, row.id]);
        else {
          const next = remaining.get(row.id);
          if (JSON.stringify(row.value) !== JSON.stringify(next)) records.put({ bucket, id: row.id, value: next });
          remaining.delete(row.id);
        }
      }
      for (const [id, value] of remaining) records.put({ bucket, id, value });
    };
  }

  async function set(updates) {
    const databaseKeys = Object.keys(updates).filter(key => Object.hasOwn(layouts, key));
    const localUpdates = Object.fromEntries(Object.entries(updates).filter(([key]) => !Object.hasOwn(layouts, key)));
    if (databaseKeys.length) {
      const database = await ready();
      const transaction = database.transaction(["metadata", "records"], "readwrite", { durability: "strict" });
      const done = transactionDone(transaction);
      const metadata = transaction.objectStore("metadata");
      const records = transaction.objectStore("records");
      for (const key of databaseKeys) {
        const split = splitValue(key, updates[key]);
        metadata.put({ key, value: split.metadata });
        for (const [bucket, values] of Object.entries(split.maps)) replaceMap(records, bucket, values);
      }
      await done;
      notify(databaseKeys);
    }
    if (Object.keys(localUpdates).length) await chrome.storage.local.set(localUpdates);
  }

  // Scan hot paths know exactly which jobs changed. Updating those records avoids
  // reading or serializing every saved score for each newly processed role.
  async function patch(key, value, changedFields) {
    if (!layouts[key] || Object.keys(changedFields).some(field => !layouts[key][field])) {
      throw new Error("Unknown job database record collection.");
    }
    const database = await ready();
    const transaction = database.transaction(["metadata", "records"], "readwrite", { durability: "strict" });
    const done = transactionDone(transaction);
    transaction.objectStore("metadata").put({ key, value: splitValue(key, value).metadata });
    const records = transaction.objectStore("records");
    for (const [field, ids] of Object.entries(changedFields)) {
      const bucket = layouts[key][field];
      for (const id of ids) {
        const entry = value[field]?.[id];
        if (entry === undefined) records.delete([bucket, String(id)]);
        else records.put({ bucket, id: String(id), value: entry });
      }
    }
    await done;
    notify([key]);
  }

  async function getRecords(key, ids) {
    const database = await ready();
    const bucket = layouts[key]?.root;
    if (!bucket) throw new Error("This job database collection does not support direct record reads.");
    const transaction = database.transaction("records", "readonly");
    const done = transactionDone(transaction);
    const records = transaction.objectStore("records");
    const [rows] = await Promise.all([
      Promise.all([...new Set(ids.map(String))].map(id => requestResult(records.get([bucket, id])))), done
    ]);
    return Object.fromEntries(rows.filter(Boolean).map(row => [row.id, row.value]));
  }

  async function putRecords(key, values) {
    const database = await ready();
    const bucket = layouts[key]?.root;
    if (!bucket) throw new Error("This job database collection does not support direct record writes.");
    const transaction = database.transaction(["metadata", "records"], "readwrite", { durability: "strict" });
    const done = transactionDone(transaction);
    transaction.objectStore("metadata").put({ key, value: {} });
    const records = transaction.objectStore("records");
    for (const [id, value] of Object.entries(values)) {
      if (value === undefined) records.delete([bucket, id]);
      else records.put({ bucket, id, value });
    }
    await done;
    notify([key]);
  }

  async function remove(selection) {
    const selectedKeys = typeof selection === "string" ? [selection] : selection;
    const databaseKeys = selectedKeys.filter(key => Object.hasOwn(layouts, key));
    if (databaseKeys.length) {
      const database = await ready();
      const transaction = database.transaction(["metadata", "records"], "readwrite", { durability: "strict" });
      const done = transactionDone(transaction);
      const records = transaction.objectStore("records");
      for (const key of databaseKeys) {
        transaction.objectStore("metadata").delete(key);
        for (const bucket of Object.values(layouts[key])) {
          const cursor = records.index("bucket").openKeyCursor(bucket);
          cursor.onsuccess = () => { if (cursor.result) { records.delete(cursor.result.primaryKey); cursor.result.continue(); } };
        }
      }
      await done;
      notify(databaseKeys);
    }
    const localKeys = selectedKeys.filter(key => !Object.hasOwn(layouts, key));
    if (localKeys.length) await chrome.storage.local.remove(localKeys);
  }

  const onChanged = {
    addListener(listener) {
      listeners.add(listener);
      chrome.storage.onChanged.addListener(listener);
      notificationChannel();
    },
    removeListener(listener) {
      listeners.delete(listener);
      chrome.storage.onChanged.removeListener(listener);
    }
  };

  root.CareerPeelerJobStore = Object.freeze({ DATABASE_NAME, ready, get, set, remove, patch, getRecords, putRecords, onChanged });
})(globalThis);
