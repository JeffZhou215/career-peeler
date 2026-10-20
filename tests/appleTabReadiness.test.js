const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness } = require("./helpers/appleWorkflowHarness.cjs");

async function fixture(read) {
  const h = createBackgroundHarness();
  await h.ready;
  const listeners = new Set();
  const event = {
    addListener: listener => listeners.add(listener),
    removeListener: listener => listeners.delete(listener),
    emit: (id, status = "complete") => {
      const tab = { ...h.tabs[0], id, status };
      for (const listener of [...listeners]) listener(id, { status }, tab);
    }
  };
  h.sandbox.chrome.tabs.onUpdated = event;
  h.sandbox.chrome.tabs.get = id => read(id, event);
  return { ...h, event, listeners };
}

test("tab completion between get snapshot and await continuation cannot be lost", async () => {
  let status = "loading";
  const h = await fixture(async (id, event) => {
    const snapshot = { id, status };
    queueMicrotask(() => { status = "complete"; event.emit(id); });
    return snapshot;
  });
  const result = await h.sandbox.waitForTabComplete(1, 30);
  assert.equal(status, "complete");
  assert.equal(result.id, 1);
  assert.equal(result.status, "complete");
  assert.equal(h.listeners.size, 0);
});

test("an already complete tab resolves without retaining a readiness listener", async () => {
  const h = await fixture(async id => ({ id, status: "complete" }));
  const result = await h.sandbox.waitForTabComplete(1, 30);
  assert.equal(result.status, "complete");
  assert.equal(h.listeners.size, 0);
});

test("a later complete event resolves only the intended tab", async () => {
  const h = await fixture(async id => ({ id, status: "loading" }));
  let settled = false;
  const pending = h.sandbox.waitForTabComplete(1, 100).then(result => { settled = true; return result; });
  await Promise.resolve(); await Promise.resolve();
  h.event.emit(2);
  await Promise.resolve();
  assert.equal(settled, false, "another tab cannot satisfy this page's readiness wait");
  h.event.emit(1);
  const result = await pending;
  assert.equal(result.id, 1);
  assert.equal(result.status, "complete");
  assert.equal(h.listeners.size, 0);
});

test("a failed tab read rejects and removes its readiness listener", async () => {
  const h = await fixture(async () => { throw new Error("No tab with this ID"); });
  await assert.rejects(h.sandbox.waitForTabComplete(1, 30), /No tab with this ID/);
  assert.equal(h.listeners.size, 0);
});

test("a tab that remains loading times out without fabricating completion", async () => {
  const h = await fixture(async id => ({ id, status: "loading" }));
  await assert.rejects(h.sandbox.waitForTabComplete(1, 10), /Timed out waiting for tab to load/);
  assert.equal(h.listeners.size, 0);
});

test("concurrent readiness waits settle independently and leave no listeners", async () => {
  const h = await fixture(async id => ({ id, status: "loading" }));
  const first = h.sandbox.waitForTabComplete(1, 100);
  const second = h.sandbox.waitForTabComplete(1, 100);
  await Promise.resolve(); await Promise.resolve();
  h.event.emit(1);
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(result => result.id), [1, 1]);
  assert.equal(h.listeners.size, 0);
});
