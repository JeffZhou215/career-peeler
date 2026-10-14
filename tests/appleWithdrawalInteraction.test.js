const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { createAppleWithdrawalDom } = require("./helpers/appleWithdrawalDomHarness.cjs");
const { createBackgroundHarness, createContentHarness } = require("./helpers/appleWorkflowHarness.cjs");

const safetySource = fs.readFileSync(path.join(__dirname, "../lib/appleWithdrawalSafety.js"), "utf8");
const jobA = "200000001-0836";
const jobB = "200000002-9999";
const batchId = "reviewed-batch-A";
const requestId = "withdraw-A";
const tab = { id: 41, windowId: 7, status: "complete", url: "https://jobs.apple.com/app/en-us/profile/roles" };
const sender = { tab, url: tab.url, frameId: 0, documentId: "apple-document-A" };

async function settle(dom, promise, maximumMs = 20000) {
  let result;
  promise.then(value => { result = { value }; }, error => { result = { error }; });
  for (let elapsed = 0; !result && elapsed <= maximumMs; elapsed += 150) await dom.advanceTime(150);
  assert.ok(result, "real worker/content IPC must finish using only mocked Chrome and virtual timer tasks");
  if (result.error) throw result.error;
  return result.value;
}

async function interactionHarness(options = {}) {
  const dom = createAppleWithdrawalDom(options);
  const background = createBackgroundHarness([{ ...tab }]);
  await background.ready;
  const content = createContentHarness({ url: tab.url });
  dom.install(content);
  // The shared application fixture starts with a placeholder document. Replace
  // its late-installed, inert helper when installing this fresh loading DOM.
  delete content.CareerPeelerAppleWithdrawalSafety;
  vm.runInContext(safetySource, content, { filename: "lib/appleWithdrawalSafety.js" });
  content.delay = ms => new Promise(resolve => dom.schedule(resolve, ms));
  content.findSubmittedRoleCard = dom.readRole;
  content.getAppleHistoryPageIndex = () => dom.state.pageIndex;
  content.collectCurrentAppleSubmittedHistoryPage = () => {
    const roles = [...dom.roles.values()].filter(role => role.card.isConnected).map(role => ({
      jobId: role.jobId, title: role.title.textContent, active: true, favorite: role.favorite.checked,
      protectedFromWithdrawal: role.favorite.checked
    }));
    return { roles, pageIndex: dom.state.pageIndex, pageCount: 1, hasNextPage: false,
      inventoryState: roles.length ? "confirmed_nonempty" : "confirmed_empty" };
  };
  const calls = { commands: [], contentMessages: [], attached: 0, detached: 0 };
  const browser = { dom, documentId: sender.documentId, pageContext: null };
  background.sandbox.attachDebugger = async () => { calls.attached++; };
  background.sandbox.detachDebugger = async () => { calls.detached++; };
  background.sandbox.chrome.tabs.sendMessage = async (tabId, message, target) => {
    assert.equal(tabId, tab.id);
    assert.equal(target?.documentId, sender.documentId, "prepared/finished clicks remain in the initiating Apple document");
    if (target.documentId !== browser.documentId) throw new Error("The original Apple document was replaced.");
    calls.contentMessages.push({ ...message });
    return content.dispatch(message);
  };
  content.chrome.runtime.sendMessage = message => background.sandbox.dispatch(message, sender);
  background.sandbox.sendDebuggerCommand = async (_tabId, method, parameters) => {
    calls.commands.push({ method, ...parameters });
    if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "navigation-input-blocker" };
    await options.onCommand?.({ dom, content, background, calls, browser, method, parameters });
    if (method === "Input.dispatchMouseEvent") {
      const { type, x, y } = parameters;
      if (type === "mousePressed") {
        browser.dom.mouse("pointerdown", x, y, { buttons: 1 });
        browser.dom.mouse("mousedown", x, y, { buttons: 1 });
      }
      if (type === "mouseReleased") {
        browser.dom.mouse("pointerup", x, y); browser.dom.mouse("mouseup", x, y); browser.dom.mouse("click", x, y);
      }
    }
    if (method === "Runtime.evaluate" && browser.pageContext) vm.runInContext(parameters.expression, browser.pageContext);
    return {};
  };
  // A fixture's irreversible effect is just a logged bubbling handler. Positive
  // cases also update the list and success alert as Apple's observed DOM does.
  const role = dom.roles.get(jobA);
  const openEffect = role.withdrawButton.defaultAction;
  role.withdrawButton.defaultAction = () => {
    openEffect();
    options.onOpen?.({ dom, content, background, calls });
    if (dom.state.modalSubject !== jobA) return;
    const confirmation = dom.state.modal;
    if (!confirmation) return;
    const proceedEffect = confirmation.proceedButton.defaultAction;
    confirmation.proceedButton.defaultAction = () => {
      proceedEffect();
      if (options.confirmWithdrawal !== false) {
        role.card.remove();
        dom.document.body.appendChild(new dom.Node("div", { id: "global-alert", role: "alert" },
          `${role.title.textContent} submission has been successfully withdrawn`));
      } else if (options.removeRoleWithoutSuccess) {
        role.card.remove();
      }
    };
  };
  const review = await background.sandbox.dispatch({ type: "APPLE_CAREERS_WITHDRAWAL_BATCH_STATE",
    active: true, confirmed: true, batchId, tabId: tab.id,
    roles: [{ jobId: jobA, title: role.title.textContent }] });
  assert.equal(review.ok, true);
  const request = { type: "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES", expectedPageIndex: 1,
    batchId, requestId, roles: [{ jobId: jobA, title: role.title.textContent }] };
  return { dom, content, background, calls, request, browser };
}

test("real worker and content complete exactly one reviewed withdrawal and verify fresh success", async () => {
  const h = await interactionHarness();
  const response = await settle(h.dom, h.content.dispatch(h.request));
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.data.identityVerified, true);
  assert.equal(response.data.outcomeUnknown, false);
  assert.deepEqual(JSON.parse(JSON.stringify(response.data.withdrawn)), [{ jobId: jobA, title: "Engineer 1" }]);
  assert.deepEqual(h.dom.calls.clicks, [{ stage: "open", jobId: jobA }, { stage: "proceed", jobId: jobA }]);
  assert.equal(h.calls.attached, 2); assert.equal(h.calls.detached, 2);
  assert.equal(h.calls.commands.filter(command => command.method === "Page.addScriptToEvaluateOnNewDocument").length, 2);
  assert.equal(h.calls.commands.filter(command => command.method === "Page.removeScriptToEvaluateOnNewDocument").length, 2);
  assert.equal(h.dom.observerCount, 0);
});

test("duplicate delivery of the same content withdrawal request never repeats browser input", async () => {
  const h = await interactionHarness();
  const first = h.content.dispatch(h.request);
  const duplicate = h.content.dispatch(h.request);
  const [a, b] = await settle(h.dom, Promise.all([first, duplicate]));
  assert.equal(a.data.withdrawn.length, 1); assert.equal(b.data.withdrawn.length, 1);
  assert.equal(h.dom.calls.clicks.length, 2);
  const repeated = await settle(h.dom, h.content.dispatch(h.request));
  assert.equal(repeated.data.withdrawn.length, 1);
  assert.equal(h.dom.calls.clicks.length, 2);
});

test("a generic replacement popup before content binds it causes no final trusted withdrawal", async () => {
  const h = await interactionHarness({ onOpen: ({ dom }) => dom.showModal(jobB) });
  const response = await settle(h.dom, h.content.dispatch(h.request));
  assert.equal(response.ok, true, "a known failed workflow is returned as structured data");
  assert.equal(response.data.withdrawn.length, 0);
  assert.equal(response.data.outcomeUnknown, false);
  assert.match(response.data.failed[0].error, /removed|replaced|replacement/i);
  assert.equal(h.dom.calls.clicks.filter(click => click.stage === "proceed").length, 0);
  assert.equal(h.calls.commands.filter(command => command.type === "mousePressed").length, 1);
});

test("replacement by a protected role's identical popup is blocked before Proceed", async () => {
  const protectedJob = "200654506";
  const h = await interactionHarness({ roleIds: [jobA, protectedJob],
    onOpen: ({ dom }) => dom.showModal(protectedJob) });
  const response = await settle(h.dom, h.content.dispatch(h.request));
  assert.equal(response.data.withdrawn.length, 0);
  assert.equal(response.data.outcomeUnknown, false);
  assert.equal(h.dom.calls.clicks.filter(click => click.stage === "proceed").length, 0);
  assert.ok(h.dom.roles.get(protectedJob).card.isConnected);
});

test("actual CDP mouseDown-to-mouseUp modal replacement is capture-blocked in the content document", async () => {
  const h = await interactionHarness({ onCommand: ({ dom, method, parameters }) => {
    if (method === "Input.dispatchMouseEvent" && parameters.type === "mouseReleased" && parameters.y === 320) dom.showModal(jobB);
  } });
  const response = await settle(h.dom, h.content.dispatch(h.request));
  assert.equal(response.data.withdrawn.length, 0);
  assert.equal(response.data.outcomeUnknown, true, "input was dispatched: a missing click ack cannot prove no earlier handler ran");
  assert.equal(h.dom.calls.clicks.filter(click => click.stage === "proceed").length, 0);
  assert.ok(h.dom.calls.events.some(event => event.type === "mouseup" && event.defaultPrevented));
  assert.match(response.data.failed[0].error, /replaced|removed|interrupted/i);
  assert.equal(h.calls.attached, h.calls.detached);
});

test("the actual navigation-blocker script prevents a CDP release from activating a new document's Proceed", async () => {
  let replacement;
  const h = await interactionHarness({ onCommand: ({ method, parameters, calls, browser }) => {
    if (method !== "Input.dispatchMouseEvent" || parameters.type !== "mouseReleased" || parameters.y !== 320) return;
    replacement = createAppleWithdrawalDom({ roleIds: [jobB] });
    const pageContext = {};
    replacement.install(pageContext); vm.createContext(pageContext);
    const installed = calls.commands.findLast(command => command.method === "Page.addScriptToEvaluateOnNewDocument");
    assert.ok(installed?.source, "run the actual source Chrome would install at navigation");
    vm.runInContext(installed.source, pageContext);
    // The new site's handler is registered after Chrome's document-start gate.
    replacement.showModal(jobB);
    browser.dom = replacement; browser.documentId = "apple-document-B"; browser.pageContext = pageContext;
  } });
  const response = await settle(h.dom, h.content.dispatch(h.request));
  assert.equal(response.data.withdrawn.length, 0);
  assert.equal(response.data.outcomeUnknown, true, "a lost document after issued final input requires reconciliation");
  assert.match(response.data.failed[0].error, /document was replaced/i);
  assert.equal(replacement.calls.clicks.filter(click => click.stage === "proceed").length, 0);
  assert.ok(replacement.calls.events.some(event => event.type === "mouseup" && event.defaultPrevented));
  assert.ok(replacement.calls.events.some(event => event.type === "click" && event.defaultPrevented));
  assert.equal(h.calls.attached, h.calls.detached);
});

test("an accepted Proceed with no fresh success/list reconciliation is unknown rather than confirmed", async () => {
  const h = await interactionHarness({ confirmWithdrawal: false });
  const response = await settle(h.dom, h.content.dispatch(h.request), 25000);
  assert.equal(response.data.withdrawn.length, 0);
  assert.equal(response.data.identityVerified, false);
  assert.equal(response.data.outcomeUnknown, true);
  assert.match(response.data.failed[0].error, /outcome is unknown/i);
  assert.equal(h.dom.calls.clicks.filter(click => click.stage === "proceed").length, 1);
  const retry = await settle(h.dom, h.content.dispatch(h.request));
  assert.equal(retry.data.outcomeUnknown, true);
  assert.equal(h.dom.calls.clicks.filter(click => click.stage === "proceed").length, 1);
});

test("an old exact-title success alert plus list removal cannot fabricate a fresh withdrawal confirmation", async () => {
  const h = await interactionHarness({ confirmWithdrawal: false, removeRoleWithoutSuccess: true });
  h.dom.document.body.appendChild(new h.dom.Node("div", { id: "global-alert", role: "alert" },
    "Engineer 1 submission has been successfully withdrawn"));
  const response = await settle(h.dom, h.content.dispatch(h.request), 25000);
  assert.equal(response.data.withdrawn.length, 0);
  assert.equal(response.data.identityVerified, false);
  assert.equal(response.data.outcomeUnknown, true);
  assert.match(response.data.failed[0].error, /outcome is unknown/i);
  assert.equal(h.dom.calls.clicks.filter(click => click.stage === "proceed").length, 1);
});

test("a restarted worker cannot reuse the old page's open permission for Proceed", async () => {
  let restarted;
  const h = await interactionHarness({ onCommand: async ({ dom, method, parameters }) => {
    if (method === "Input.dispatchMouseEvent" && parameters.type === "mouseReleased" && parameters.y < 200) {
      restarted = createBackgroundHarness([{ ...tab }]);
      await restarted.ready;
      dom.schedule(() => {}, 0);
    }
  } });
  // Swap workers immediately after the acknowledged Open, before the next IPC.
  const originalDispatch = h.content.chrome.runtime.sendMessage;
  h.content.chrome.runtime.sendMessage = async message => {
    if (message.stage === "proceed" && restarted) return restarted.sandbox.dispatch(message, sender);
    return originalDispatch(message);
  };
  const response = await settle(h.dom, h.content.dispatch(h.request));
  assert.equal(response.data.withdrawn.length, 0);
  assert.equal(response.data.outcomeUnknown, false);
  assert.match(response.data.failed[0].error, /reviewed withdrawal selection|review the batch/i);
  assert.equal(h.dom.calls.clicks.filter(click => click.stage === "proceed").length, 0);
});

test("reinserted or restyled identical stale success cannot confirm an uncertain withdrawal", async () => {
  let stale;
  const h = await interactionHarness({ confirmWithdrawal: false,
    onCommand: ({ dom, method }) => {
      if (method !== "Runtime.evaluate" || dom.state.modal || !stale) return;
      dom.roles.get(jobA).card.remove();
      stale.remove(); dom.document.body.appendChild(stale);
      stale.style.opacity = "1";
    }
  });
  stale = new h.dom.Node("div", { id: "global-alert", role: "alert" }, "Engineer 1 submission has been successfully withdrawn");
  h.dom.document.body.appendChild(stale);
  const response = await settle(h.dom, h.content.dispatch(h.request), 25000);
  assert.equal(response.data.withdrawn.length, 0);
  assert.equal(response.data.outcomeUnknown, true);
  assert.equal(h.dom.calls.clicks.filter(click => click.stage === "proceed").length, 1);
});
