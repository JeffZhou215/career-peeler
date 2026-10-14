const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { createAppleWithdrawalDom } = require("./helpers/appleWithdrawalDomHarness.cjs");

const source = fs.readFileSync(path.join(__dirname, "../lib/appleWithdrawalSafety.js"), "utf8");
const jobA = "200000001-0836";
const jobB = "200000002-9999";

function harness(options = {}) {
  const dom = createAppleWithdrawalDom(options);
  if (options.readyState) dom.document.readyState = options.readyState;
  const sandbox = { console, URL };
  dom.install(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "lib/appleWithdrawalSafety.js" });
  const create = settings => sandbox.CareerPeelerAppleWithdrawalSafety.create({
    jobId: jobA, batchId: "reviewed-batch-A", requestId: "withdraw-A", pageIndex: 1,
    readRole: dom.readRole, readPage: dom.readPage, findConfirmation: dom.findConfirmation,
    getFailure: dom.getFailure, ...settings
  });
  return { dom, sandbox, create };
}

async function settle(dom, promise, maximumMs = 18000) {
  let result;
  promise.then(value => { result = { value }; }, error => { result = { error }; });
  for (let elapsed = 0; !result && elapsed <= maximumMs; elapsed += 150) await dom.advanceTime(150);
  assert.ok(result, "the bounded operation must finish using only virtual timer tasks");
  if (result.error) throw result.error;
  return result.value;
}

async function open(dom, guard) {
  const point = await settle(dom, guard.prepare("open"));
  dom.clickAt(point.x, point.y);
  assert.equal(guard.finish("open").actionActivated, true);
  return point;
}

function noProceed(dom) {
  assert.equal(dom.calls.clicks.filter(click => click.stage === "proceed").length, 0,
    "the fixture's Apple handler must never receive an unauthorized Proceed click");
}

test("the synthetic DOM preserves event cancellation, timer ordering and observer reuse", async () => {
  const dom = createAppleWithdrawalDom();
  const role = dom.roles.get(jobA);
  let nativeActions = 0;
  role.withdrawButton.nativeDefaultAction = () => nativeActions++;
  dom.window.addEventListener("click", event => event.stopImmediatePropagation(), true);
  role.withdrawButton.dispatchEvent(new dom.Event("click"));
  assert.equal(nativeActions, 1, "stopping propagation does not prevent a browser default action");
  assert.equal(dom.calls.clicks.length, 0, "capture interception blocks Apple's bubbling handler");

  const ordering = [];
  dom.schedule(() => ordering.push("timer"), 5000);
  await Promise.resolve().then(() => ordering.push("promise"));
  assert.deepEqual(ordering, ["promise"]);
  await dom.advanceTime(5000);
  assert.deepEqual(ordering, ["promise", "timer"]);

  const observer = new dom.MutationObserver(() => {});
  observer.observe(dom.document.body, { subtree: true, attributes: true });
  observer.disconnect();
  observer.observe(dom.document.body, { subtree: true, attributes: true });
  role.card.hidden = true;
  assert.equal(observer.takeRecords().length, 1);
  assert.equal(role.withdrawButton.getBoundingClientRect().width, 0);
  role.card.hidden = false;
  role.withdrawButton.style.opacity = "0";
  const rect = role.withdrawButton.getBoundingClientRect();
  assert.equal(dom.document.elementFromPoint(rect.left + 1, rect.top + 1), role.withdrawButton,
    "a transparent control can still intercept actual pointer input");
});

test("the exact reviewed card opens one bound confirmation and one trusted Proceed", async () => {
  const { dom, create } = harness();
  const guard = create();
  await open(dom, guard);
  const point = await settle(dom, guard.prepare("proceed"));
  assert.deepEqual(JSON.parse(JSON.stringify(point)), { x: 270, y: 320, jobId: jobA,
    batchId: "reviewed-batch-A", requestId: "withdraw-A", identityVerified: true });
  dom.clickAt(point.x, point.y);
  assert.equal(guard.proceeded, true);
  assert.equal(guard.finish("proceed").actionActivated, true,
    "the acknowledgment proves activation, not a fabricated withdrawal result");
  assert.deepEqual(dom.calls.clicks, [{ stage: "open", jobId: jobA }, { stage: "proceed", jobId: jobA }]);
  await dom.flushMutations();
  assert.equal(guard.finish("proceed").identityVerified, true, "legitimate modal removal retains activation evidence");
  guard.dispose();
  assert.equal(dom.observerCount, 0);
});

test("an existing identityless popup cannot acquire a new role's withdrawal authority", () => {
  const { dom, create } = harness();
  dom.showModal(jobB);
  assert.throws(() => create(), /existing popup/i);
  noProceed(dom);
});

test("a helper installed after document loading refuses withdrawal authority", () => {
  const { dom, create } = harness({ readyState: "complete" });
  assert.throws(() => create(), /reload the Apple page/i);
  assert.equal(dom.observerCount, 0);
  assert.equal(dom.calls.clicks.length, 0);
});

test("the inert document-start gate runs before subsequently registered Apple capture handlers", async () => {
  const { dom, create } = harness();
  dom.document.readyState = "complete";
  let appleCaptureCalls = 0;
  dom.window.addEventListener("click", () => { appleCaptureCalls++; }, true);
  dom.document.body.dispatchEvent(new dom.Event("click"));
  assert.equal(appleCaptureCalls, 1, "ordinary browsing remains inert before a reviewed action");
  const guard = create();
  const point = await settle(dom, guard.prepare("open"));
  dom.roles.get(jobA).favorite.checked = true;
  dom.clickAt(point.x, point.y);
  assert.equal(appleCaptureCalls, 1, "invalid input is intercepted before Apple's capture handler");
  assert.equal(dom.calls.clicks.length, 0);
  guard.dispose();
  dom.document.body.dispatchEvent(new dom.Event("click"));
  assert.equal(appleCaptureCalls, 2, "the permanent early gate becomes inert again after disposal");
});

test("first confirmation appearance, delayed enabled state and stable geometry are awaited", async () => {
  const { dom, create } = harness();
  const guard = create();
  dom.state.automaticallyOpen = false;
  await open(dom, guard);
  dom.schedule(() => {
    const confirmation = dom.showModal(jobA);
    confirmation.modal.style.display = "none";
    confirmation.proceedButton.disabled = true;
    dom.schedule(() => { confirmation.modal.style.display = "block"; }, 150);
    dom.schedule(() => { confirmation.proceedButton.rect.left = 200; confirmation.proceedButton.disabled = false; }, 450);
  }, 300);
  const point = await settle(dom, guard.prepare("proceed"));
  assert.equal(point.x, 290);
  dom.clickAt(point.x, point.y);
  assert.equal(guard.finish("proceed").actionActivated, true);
  guard.dispose();
});

test("a replacement A-to-B popup before the observer callback cannot become the first bound popup", async () => {
  const { dom, create } = harness();
  const guard = create();
  const point = await settle(dom, guard.prepare("open"));
  dom.roles.get(jobA).withdrawButton.defaultAction = () => {
    dom.calls.clicks.push({ stage: "open", jobId: jobA });
    dom.showModal(jobA);
    dom.showModal(jobB); // Same task, same generic heading and same coordinates.
  };
  dom.clickAt(point.x, point.y);
  assert.throws(() => guard.finish("open"), /removed|replaced|replacement/i);
  await assert.rejects(settle(dom, guard.prepare("proceed")), /removed|replaced|replacement/i);
  noProceed(dom);
  guard.dispose();
});

for (const [label, mutation] of [
  ["different popup with identical text and coordinates", dom => dom.showModal(jobB)],
  ["same popup removed and reinserted in one task", dom => dom.detachAndReinsertModal()],
  ["same popup hidden and reopened in one task", dom => dom.hideAndReopenModal()],
  ["original Proceed button replaced", dom => {
    const old = dom.state.modal.proceedButton;
    const next = old.cloneNode(true);
    next.defaultAction = old.defaultAction;
    old.replaceWith(next); dom.state.modal.proceedButton = next;
  }],
  ["selected card replaced with an identical copy", dom => dom.replaceRole(jobA)],
  ["selected full job identity changed only in the suffix", dom => {
    dom.roles.get(jobA).title.href = `https://jobs.apple.com/en-us/details/200000001-9999/engineer`;
  }],
  ["star checked through a property without a mutation event", dom => { dom.roles.get(jobA).favorite.checked = true; }],
  ["page ordinal changed through a property without a mutation event", dom => { dom.state.pageIndex = 2; }],
  ["same-document navigation changed the account context", dom => {
    dom.window.history.pushState(null, "", "https://jobs.apple.com/app/en-us/profile/roles?changed=1");
  }]
]) {
  test(`the bound confirmation is rejected after ${label}`, async () => {
    const { dom, create } = harness();
    const guard = create();
    await open(dom, guard);
    mutation(dom);
    await assert.rejects(settle(dom, guard.prepare("proceed")), /removed|replaced|rerendered|visibility|identity|starred|page|context/i);
    noProceed(dom);
    guard.dispose();
  });
}

test("Open and Proceed permissions are single-use, including concurrent preparation", async () => {
  const { dom, create } = harness();
  const guard = create();
  const first = guard.prepare("open");
  await assert.rejects(guard.prepare("open"), /already used|out of order/i);
  const point = await settle(dom, first);
  dom.clickAt(point.x, point.y); guard.finish("open");
  const proceed = guard.prepare("proceed");
  await assert.rejects(guard.prepare("proceed"), /already used|out of order/i);
  const target = await settle(dom, proceed);
  dom.clickAt(target.x, target.y); guard.finish("proceed");
  await assert.rejects(guard.prepare("proceed"), /already used|out of order/i);
  assert.equal(dom.calls.clicks.filter(click => click.stage === "proceed").length, 1);
  guard.dispose();
});

test("a stale DOM Proceed click after a consumed activation is capture-blocked", async () => {
  const { dom, create } = harness();
  dom.state.automaticallyClose = false;
  const guard = create();
  await open(dom, guard);
  const point = await settle(dom, guard.prepare("proceed"));
  dom.clickAt(point.x, point.y); guard.finish("proceed");
  dom.clickAt(point.x, point.y);
  assert.equal(dom.calls.clicks.filter(click => click.stage === "proceed").length, 1);
  assert.ok(dom.calls.events.some(event => event.type === "click" && event.defaultPrevented));
  guard.dispose();
});

for (const stage of ["before mouseDown", "between mouseDown and mouseUp"]) {
  test(`replacement ${stage} is blocked at trusted input dispatch`, async () => {
    const { dom, create } = harness();
    const guard = create();
    await open(dom, guard);
    const point = await settle(dom, guard.prepare("proceed"));
    if (stage === "between mouseDown and mouseUp") {
      dom.mouse("pointerdown", point.x, point.y, { buttons: 1 });
      dom.mouse("mousedown", point.x, point.y, { buttons: 1 });
    }
    dom.showModal(jobB);
    // No microtask boundary: the capture guard must inspect pending records.
    if (stage === "before mouseDown") dom.mouse("mousedown", point.x, point.y, { buttons: 1 });
    dom.mouse("mouseup", point.x, point.y);
    dom.mouse("click", point.x, point.y);
    assert.throws(() => guard.finish("proceed"), /removed|replaced|interrupted/i);
    noProceed(dom);
    assert.ok(dom.calls.events.some(event => event.defaultPrevented));
    guard.dispose();
  });
}

test("an overlay that obscures Proceed after preparation blocks the actual trusted click", async () => {
  const { dom, create } = harness();
  const guard = create();
  await open(dom, guard);
  const point = await settle(dom, guard.prepare("proceed"));
  dom.state.hitOverride = () => dom.document.body;
  dom.clickAt(point.x, point.y);
  assert.throws(() => guard.finish("proceed"), /interrupted/i);
  noProceed(dom);
  guard.dispose();
});

test("replacing header text after preparation blocks Proceed even when the modal nodes remain identical", async () => {
  const { dom, create } = harness();
  const guard = create();
  await open(dom, guard);
  const point = await settle(dom, guard.prepare("proceed"));
  // Real browsers emit childList for Element.textContent=, not characterData.
  dom.state.modal.header.textContent = "Confirm a different action";
  dom.clickAt(point.x, point.y);
  assert.throws(() => guard.finish("proceed"), /changed|confirmation|interrupted/i);
  noProceed(dom);
  guard.dispose();
});

test("rerendering body text inside a ready confirmation invalidates its single-use authority", async () => {
  const { dom, create } = harness();
  const guard = create();
  await open(dom, guard);
  const point = await settle(dom, guard.prepare("proceed"));
  dom.state.modal.modal.appendChild(new dom.Node("p", {}, "A different confirmation body"));
  dom.clickAt(point.x, point.y);
  assert.throws(() => guard.finish("proceed"), /contents|rerendered|interrupted/i);
  noProceed(dom);
  guard.dispose();
});

test("the first disabled confirmation's body cannot be retargeted before Proceed enables", async () => {
  const { dom, create } = harness();
  const guard = create();
  const original = dom.roles.get(jobA).withdrawButton.defaultAction;
  dom.roles.get(jobA).withdrawButton.defaultAction = () => {
    original(); dom.state.modal.proceedButton.disabled = true;
  };
  await open(dom, guard);
  const preparation = guard.prepare("proceed");
  dom.schedule(() => { dom.state.modal.bodyText.textContent = "Withdraw another role"; }, 150);
  dom.schedule(() => { dom.state.modal.proceedButton.disabled = false; }, 300);
  await assert.rejects(settle(dom, preparation), /contents|rerendered|changed/i);
  noProceed(dom);
  guard.dispose();
});

test("disabled-first body replacement in the Open click task is detected before any observer callback", async () => {
  const { dom, create } = harness();
  const guard = create();
  const point = await settle(dom, guard.prepare("open"));
  const original = dom.roles.get(jobA).withdrawButton.defaultAction;
  dom.roles.get(jobA).withdrawButton.defaultAction = () => {
    original();
    dom.state.modal.proceedButton.disabled = true;
    dom.state.modal.bodyText.textContent = "Withdraw another role";
    dom.state.modal.proceedButton.disabled = false;
  };
  dom.clickAt(point.x, point.y);
  assert.throws(() => guard.finish("open"), /contents|rerendered|changed/i);
  await assert.rejects(settle(dom, guard.prepare("proceed")), /contents|rerendered|changed/i);
  noProceed(dom);
  guard.dispose();
});

test("untrusted script clicks cannot consume a bound withdrawal permission", async () => {
  const { dom, create } = harness();
  const guard = create();
  await open(dom, guard);
  const point = await settle(dom, guard.prepare("proceed"));
  dom.state.modal.proceedButton.dispatchEvent(new dom.Event("click", { isTrusted: false,
    clientX: point.x, clientY: point.y }));
  assert.throws(() => guard.finish("proceed"), /unexpected|unavailable/i);
  noProceed(dom);
  guard.dispose();
});

test("a disabled or missing original Proceed times out without replaying Open", async () => {
  const { dom, create } = harness();
  const guard = create();
  await open(dom, guard);
  dom.state.modal.proceedButton.disabled = true;
  await assert.rejects(settle(dom, guard.prepare("proceed")), /did not become ready/i);
  await assert.rejects(guard.prepare("proceed"), /already used/i);
  assert.equal(dom.calls.clicks.filter(click => click.stage === "open").length, 1);
  noProceed(dom);
  guard.dispose();
});

test("disposal clears observers and capture listeners and expires unfinished authority", async () => {
  const { dom, create } = harness();
  const guard = create();
  await open(dom, guard);
  guard.dispose();
  assert.equal(dom.observerCount, 0);
  assert.throws(() => guard.verify(), /expired/i);
  dom.state.modal.cancelButton.click();
  assert.equal(dom.state.modal, null, "cleanup leaves ordinary user controls usable");
});

for (const field of ['withdrawButton', 'favorite', 'title']) {
  test(`a mismatched ${field} identity cannot acquire withdrawal authority`, () => {
    const { dom, create } = harness();
    const role = dom.roles.get(jobA);
    role[field].id = field === 'withdrawButton' ? `js-withdraw-link-${jobB}` :
      field === 'favorite' ? `addToFavoriteId-favorite-${jobB}` : `role-title-${jobB}`;
    assert.throws(() => create(), /identity|unstarred/i);
    assert.equal(dom.calls.clicks.length, 0);
  });
}
