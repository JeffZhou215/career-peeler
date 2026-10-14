const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness } = require("./helpers/appleWorkflowHarness.cjs");

const jobA = "200000001-0836";
const jobB = "200000002-9999";
const batchId = "reviewed-withdrawal-batch";
const requestA = "withdrawal-A";
const requestB = "withdrawal-B";
const tab = { id: 41, windowId: 7, status: "complete", url: "https://jobs.apple.com/app/en-us/profile/roles" };
const sender = { tab, url: tab.url, frameId: 0, documentId: "apple-document-A" };
const selectedRoles = [{ jobId: jobA, title: "Engineer A" }, { jobId: jobB, title: "Engineer B" }];
const lease = overrides => ({ active: true, confirmed: true, batchId, tabId: tab.id, roles: selectedRoles, ...overrides });
const identity = message => ({ jobId: message.jobId, batchId: message.batchId, requestId: message.requestId, identityVerified: true });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function fixture(options = {}) {
  const h = createBackgroundHarness([{ ...tab }], { data: options.data });
  await h.ready;
  const calls = { attached: [], detached: [], commands: [], content: [] };
  h.sandbox.chrome.debugger = {
    attach: (target, version, callback) => { calls.attached.push({ ...target, version }); callback(); },
    detach: (target, callback) => { calls.detached.push({ ...target }); callback(); },
    sendCommand: (target, method, parameters, callback) => {
      const command = { ...target, method, ...parameters };
      calls.commands.push(command);
      Promise.resolve().then(async () => {
        await options.onCommand?.(command, h);
        callback(method === "Page.addScriptToEvaluateOnNewDocument" ?
          (options.guardInstalled === false ? {} : { identifier: "guard" }) : {});
      }).catch(error => {
        h.sandbox.chrome.runtime.lastError = { message: error.message };
        callback();
        delete h.sandbox.chrome.runtime.lastError;
      });
    }
  };
  h.sandbox.chrome.tabs.sendMessage = async (tabId, message, target) => {
    calls.content.push({ tabId, message: { ...message }, target: { ...target } });
    assert.equal(tabId, tab.id);
    assert.equal(target.documentId, sender.documentId, "click preparation and acknowledgement must target the initiating document");
    if (message.type === "APPLE_CAREERS_PREPARE_WITHDRAWAL_CLICK") {
      if (options.prepare) return options.prepare(message, h);
      return { ok: true, data: { ...identity(message), x: 125, y: 225 } };
    }
    if (message.type === "APPLE_CAREERS_FINISH_WITHDRAWAL_CLICK") {
      if (options.finish) return options.finish(message, h);
      return { ok: true, data: { ...identity(message), actionActivated: true } };
    }
    assert.equal(message.type, "APPLE_CAREERS_REVOKE_WITHDRAWAL");
    return { ok: true };
  };
  const click = (stage, overrides = {}) => h.sandbox.dispatchTrustedAppleWithdrawalClick(
    overrides.sender || sender, overrides.jobId || jobA, stage, overrides.page || 1,
    overrides.batchId || batchId, overrides.requestId || requestA
  );
  if (options.register !== false) assert.equal((await h.sandbox.setAppleWithdrawalBatch(lease(), {})).ok, true);
  return { ...h, calls, click, options };
}

const mouseCommands = h => h.calls.commands.filter(command => command.method === "Input.dispatchMouseEvent");
const mousePresses = h => mouseCommands(h).filter(command => command.type === "mousePressed");
const cleanups = h => h.calls.commands.filter(command => command.method === "Page.removeScriptToEvaluateOnNewDocument");

test("withdrawal leases require explicit confirmation and a valid unique selected set from the panel", async () => {
  const h = await fixture({ register: false });
  for (const change of [
    { confirmed: false }, { roles: [] }, { roles: [selectedRoles[0], selectedRoles[0]] },
    { roles: [{ jobId: "not-a-job" }] }, { roles: [{ jobId: "200654506-0836" }] }, { tabId: undefined }
  ]) {
    await assert.rejects(h.sandbox.setAppleWithdrawalBatch(lease(change), {}), /review and confirm/);
  }
  await assert.rejects(h.sandbox.setAppleWithdrawalBatch(lease(), sender), /extension panel/);
  assert.equal(h.calls.attached.length, 0);
  assert.equal((await h.click("open")).ok, false);
});

test("trusted withdrawal without an active confirmed lease cannot click", async () => {
  const h = await fixture({ register: false });
  assert.equal((await h.click("open")).ok, false);
  assert.equal((await h.click("proceed")).ok, false);
  assert.equal(h.calls.attached.length, 0);
  assert.equal(h.calls.content.length, 0);
});

test("an exact reviewed job gets one Open and one Proceed with document-bound guards and cleanup", async () => {
  const h = await fixture();
  assert.equal((await h.click("open")).ok, true);
  const result = await h.click("proceed");
  assert.equal(result.ok, true);
  assert.equal(result.data.identityVerified, true);
  assert.equal(result.data.jobId, jobA);
  assert.equal(result.data.batchId, batchId);
  assert.equal(result.data.requestId, requestA);
  assert.equal(mousePresses(h).length, 2);
  assert.equal(h.calls.attached.length, 2);
  assert.equal(h.calls.detached.length, 2);
  assert.equal(h.calls.commands.filter(command => command.method === "Page.addScriptToEvaluateOnNewDocument").length, 2);
  assert.equal(cleanups(h).length, 2);
  assert.ok(cleanups(h).every(command => command.identifier === "guard"));
  assert.equal(h.calls.commands.filter(command => command.method === "Runtime.evaluate").length, 2);
  assert.deepEqual(h.calls.content.map(call => [call.message.type, call.message.stage]), [
    ["APPLE_CAREERS_PREPARE_WITHDRAWAL_CLICK", "open"], ["APPLE_CAREERS_FINISH_WITHDRAWAL_CLICK", "open"],
    ["APPLE_CAREERS_PREPARE_WITHDRAWAL_CLICK", "proceed"], ["APPLE_CAREERS_FINISH_WITHDRAWAL_CLICK", "proceed"]
  ]);
});

test("an unselected job or another location suffix cannot consume the selected role's permission", async () => {
  const h = await fixture();
  for (const jobId of ["200000003-0836", "200000001-9999", "200000001"]) {
    assert.equal((await h.click("open", { jobId })).ok, false);
  }
  assert.equal(h.calls.attached.length, 0);
  assert.equal((await h.click("open")).ok, true);
});

test("wrong tabs, origins, frames, or missing documents cannot start; changed documents cannot Proceed", async () => {
  const h = await fixture();
  for (const invalidSender of [
    { ...sender, tab: { ...tab, id: 42 } }, { ...sender, frameId: 1 },
    { ...sender, documentId: undefined }, { ...sender, url: "https://example.com/profile/roles" }
  ]) assert.equal((await h.click("open", { sender: invalidSender })).ok, false);
  assert.equal(h.calls.attached.length, 0);
  assert.equal((await h.click("open")).ok, true);
  assert.equal((await h.click("proceed", { sender: { ...sender, documentId: "apple-document-B" } })).ok, false);
  assert.equal((await h.click("open", { jobId: jobB, requestId: requestB, sender: { ...sender, documentId: "apple-document-B" } })).ok, false);
  assert.equal(mousePresses(h).length, 1);
});

test("repeated Open or Proceed messages and changed request IDs never replay a stage", async () => {
  const h = await fixture();
  assert.equal((await h.click("proceed")).ok, false);
  assert.equal((await h.click("open")).ok, true);
  assert.equal((await h.click("open")).ok, false);
  assert.equal((await h.click("open", { requestId: "another-request" })).ok, false);
  assert.equal((await h.click("proceed", { requestId: "another-request" })).ok, false);
  assert.equal((await h.click("proceed", { page: 2 })).ok, false);
  assert.equal((await h.click("proceed")).ok, true);
  assert.equal((await h.click("proceed")).ok, false);
  assert.equal((await h.click("open", { requestId: "new-request-for-processed-role" })).ok, false);
  assert.equal(mousePresses(h).length, 2);
});

test("concurrent Open requests acquire one stage owner before awaited preparation", async () => {
  const entered = deferred(), release = deferred();
  const h = await fixture({ prepare: async message => {
    entered.resolve(); await release.promise;
    return { ok: true, data: { ...identity(message), x: 125, y: 225 } };
  } });
  const first = h.click("open");
  await entered.promise;
  assert.equal((await h.click("open")).ok, false);
  assert.equal((await h.click("open", { jobId: jobB, requestId: requestB })).ok, false);
  release.resolve();
  assert.equal((await first).ok, true);
  assert.equal(mousePresses(h).length, 1);
});

test("concurrent Proceed requests consume permission before awaited preparation", async () => {
  const entered = deferred(), release = deferred();
  const options = {};
  const h = await fixture(options);
  assert.equal((await h.click("open")).ok, true);
  options.prepare = async message => {
    entered.resolve(); await release.promise;
    return { ok: true, data: { ...identity(message), x: 125, y: 225 } };
  };
  const first = h.click("proceed");
  await entered.promise;
  assert.equal((await h.click("proceed")).ok, false);
  release.resolve();
  assert.equal((await first).ok, true);
  assert.equal(mousePresses(h).length, 2);
});

test("failed or mismatched preparation sends no mouse input and always cleans the installed guard", async () => {
  for (const prepare of [
    async () => ({ ok: false, error: "The modal was replaced." }),
    async message => ({ ok: true, data: { ...identity(message), jobId: jobB, x: 125, y: 225 } }),
    async message => ({ ok: true, data: { ...identity(message), requestId: "stale-request", x: 125, y: 225 } }),
    async message => ({ ok: true, data: { ...identity(message), identityVerified: false, x: 125, y: 225 } })
  ]) {
    const h = await fixture({ prepare });
    assert.equal((await h.click("open")).ok, false);
    assert.equal(mouseCommands(h).length, 0);
    assert.equal(h.calls.content.length, 1);
    assert.equal(cleanups(h).length, 1);
    assert.equal(h.calls.detached.length, 1);
    assert.equal((await h.click("open")).ok, false, "failed requests are consumed, not replayed");
  }
});

test("an unacknowledged Proceed is not retried even if its trusted click already occurred", async () => {
  const h = await fixture({ finish: async message => message.stage === "proceed" ?
    { ok: false, error: "The bound confirmation disappeared." } : { ok: true, data: { ...identity(message), actionActivated: true } } });
  assert.equal((await h.click("open")).ok, true);
  const unacknowledged = await h.click("proceed");
  assert.equal(unacknowledged.ok, false);
  assert.equal(unacknowledged.data.outcomeUnknown, true, "issued final input cannot be classified as definitely unexecuted");
  assert.equal((await h.click("proceed")).ok, false);
  assert.equal((await h.click("open", { requestId: "retry-A" })).ok, false);
  assert.equal(mousePresses(h).length, 2);
  assert.equal(cleanups(h).length, 2);
  assert.equal(h.calls.detached.length, 2);
});

test("cancelling while preparation is pending revokes ownership and prevents the click", async () => {
  const entered = deferred(), release = deferred();
  const h = await fixture({ prepare: async message => {
    entered.resolve(); await release.promise;
    return { ok: true, data: { ...identity(message), x: 125, y: 225 } };
  } });
  const pending = h.click("open");
  await entered.promise;
  await h.sandbox.setAppleWithdrawalBatch({ active: false, batchId }, {});
  release.resolve();
  assert.equal((await pending).ok, false);
  assert.equal(mouseCommands(h).length, 0);
  assert.equal(h.calls.content.filter(call => call.message.type === "APPLE_CAREERS_REVOKE_WITHDRAWAL").length, 1);
  assert.equal(cleanups(h).length, 1);
  assert.equal(h.calls.detached.length, 1);
});

test("cancellation between mouse movement and press prevents remaining trusted input", async () => {
  const h = await fixture({ onCommand: async (command, background) => {
    if (command.method === "Input.dispatchMouseEvent" && command.type === "mouseMoved") {
      await background.sandbox.setAppleWithdrawalBatch({ active: false, batchId }, {});
    }
  } });
  assert.equal((await h.click("open")).ok, false);
  assert.deepEqual(mouseCommands(h).map(command => command.type), ["mouseMoved"]);
  assert.equal(cleanups(h).length, 1);
  assert.equal(h.calls.detached.length, 1);
});

test("a missing new-document blocker aborts before content preparation and input", async () => {
  const h = await fixture({ guardInstalled: false });
  assert.equal((await h.click("open")).ok, false);
  assert.equal(h.calls.content.length, 0);
  assert.equal(mouseCommands(h).length, 0);
  assert.equal(cleanups(h).length, 0);
  assert.equal(h.calls.detached.length, 1);
});

test("a worker restart forgets prior withdrawal permission and cannot replay the pending Proceed", async () => {
  const h = await fixture();
  assert.equal((await h.click("open")).ok, true);
  const restarted = await fixture({ register: false, data: h.data });
  assert.equal((await restarted.click("proceed")).ok, false);
  assert.equal((await restarted.click("open")).ok, false);
  assert.equal(restarted.calls.attached.length, 0);
  assert.equal(restarted.calls.content.length, 0);
});

test("a released lease blocks dispatch while another batch's release cannot revoke the current selection", async () => {
  const h = await fixture();
  await h.sandbox.setAppleWithdrawalBatch({ active: false, batchId: "older-batch" }, {});
  assert.equal((await h.click("open")).ok, true);
  await h.sandbox.setAppleWithdrawalBatch({ active: false, batchId }, {});
  assert.equal((await h.click("proceed")).ok, false);
  assert.equal(mousePresses(h).length, 1);
});

test("later failure cannot erase or replay the earlier processed selected job", async () => {
  const h = await fixture({ prepare: async message => message.jobId === jobB && message.stage === "proceed" ?
    { ok: false, error: "The second role modal lost ownership." } : { ok: true, data: { ...identity(message), x: 125, y: 225 } } });
  assert.equal((await h.click("open")).ok, true);
  assert.equal((await h.click("proceed")).ok, true);
  assert.equal((await h.click("open", { jobId: jobB, requestId: requestB })).ok, true);
  assert.equal((await h.click("proceed", { jobId: jobB, requestId: requestB })).ok, false);
  assert.equal((await h.click("open", { requestId: "repeat-earlier-success" })).ok, false);
  assert.equal((await h.click("proceed")).ok, false);
  assert.equal(mousePresses(h).length, 3);
  assert.equal(cleanups(h).length, 4);
  assert.equal(h.calls.detached.length, 4);
});
