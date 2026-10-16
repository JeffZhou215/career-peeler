const { test } = require("node:test");
const assert = require("node:assert/strict");
const safety = require("../lib/appleApplicationSafety.js");
const { createContentHarness } = require("./helpers/appleWorkflowHarness.cjs");
const { createAppleWithdrawalDom } = require("./helpers/appleWithdrawalDomHarness.cjs");

const jobA = "209900001";
const jobB = "209900002";
const jobC = "209900003";

// Sanitized structure derived from the supplied Apple Active-list HTML. Keep
// card extraction and pagination parsing real; only the browser DOM is modeled.
function inventoryHarness({ pages = [[jobA, jobB]], initialPage = 1, titles = {}, onPage } = {}) {
  const dom = createAppleWithdrawalDom({ roleIds: [], pageIndex: initialPage, pageCount: pages.length });
  const content = createContentHarness({ url: dom.window.location.href });
  dom.install(content);
  content.delay = ms => new Promise(resolve => dom.schedule(resolve, ms));
  const list = new dom.Node("div", { id: "profile-role-list", role: "presentation" });
  const roleList = new dom.Node("div", { role: "list" });
  list.appendChild(roleList); dom.document.body.appendChild(list);
  const nav = dom.document.querySelector("#profile-roles-pagination");
  list.appendChild(nav);
  const previous = new dom.Node("button", { type: "button", "aria-label": "Previous Page" });
  const next = new dom.Node("button", { type: "button", "aria-label": "Next Page" });
  nav.appendChild(previous); nav.appendChild(next);
  const visited = [];
  const currentCards = new Map();
  const render = index => {
    for (const card of currentCards.values()) card.remove();
    currentCards.clear();
    dom.state.pageIndex = pages.length ? index : 0;
    dom.state.pageCount = pages.length;
    for (const jobId of pages[index - 1] || []) {
      const title = titles[jobId] || "Software Engineer";
      const card = new dom.Node("div", { class: "row large-12 small-12 u-border-bottom rolecard", role: "listitem" });
      const column = new dom.Node("div", { class: "large-8 small-12 row" });
      const heading = new dom.Node("h3", { class: "t-eyebrow-reduced word-break-break-word" });
      // Browser anchor.href resolves the relative href found in Apple's HTML.
      heading.appendChild(new dom.Node("a", { id: `role-title-${jobId}`, "aria-label": `${title} ${jobId}`,
        href: `https://jobs.apple.com/en-us/details/${jobId}/Software-Engineer` }, title));
      column.appendChild(heading); card.appendChild(column);
      const actions = new dom.Node("div", { class: "rolecard-actions-section" });
      const favorite = new dom.Node("input", { type: "checkbox", id: `addToFavoriteId-favorite-${jobId}` });
      actions.appendChild(favorite);
      actions.appendChild(new dom.Node("button", { id: `js-withdraw-link-${jobId}`, "aria-label": `Withdraw ${title} ${jobId}` }, "Withdraw"));
      card.appendChild(actions); roleList.appendChild(card); currentCards.set(jobId, card);
    }
    previous.disabled = !pages.length || index <= 1;
    previous.setAttribute("aria-disabled", String(previous.disabled));
    next.disabled = !pages.length || index >= pages.length;
    next.setAttribute("aria-disabled", String(next.disabled));
    visited.push(index);
    onPage?.({ index, dom, list, roleList, next, previous, currentCards });
  };
  previous.defaultAction = () => { if (!previous.disabled) render(dom.state.pageIndex - 1); };
  next.defaultAction = () => { if (!next.disabled) render(dom.state.pageIndex + 1); };
  render(initialPage);
  return { dom, content, pages, visited, currentCards, render,
    alert(text) { dom.document.querySelector("#global-alert")?.remove();
      dom.document.body.appendChild(new dom.Node("div", { id: "global-alert", role: "alert" }, text)); } };
}

async function settle(h, promise, maximumMs = 20000) {
  let result;
  promise.then(value => { result = { value }; }, error => { result = { error }; });
  for (let elapsed = 0; !result && elapsed <= maximumMs; elapsed += 150) await h.dom.advanceTime(150);
  assert.ok(result, "inventory read must terminate within its bounded timer budget");
  if (result.error) throw result.error;
  return result.value;
}

function proofPass(ids, startedAt = 1000, completedAt = startedAt + 100) {
  const roles = ids.map(jobId => ({ jobId, active: true }));
  const inventoryState = roles.length ? "confirmed" : "confirmed_empty";
  return { complete: true, accountVerified: true, inventoryState, readStartedAt: startedAt,
    readCompletedAt: completedAt, pageCount: 1, pages: [{ pageIndex: 1, pageCount: 1, accountVerified: true,
      hasNextPage: false, withdrawalConfirmationOpen: false, inventoryState, roles }] };
}

test("pagination-reset success notification cannot confirm a still-active selected exact job", async () => {
  const h = inventoryHarness({ pages: [[jobB], [jobA]], initialPage: 1 });
  h.alert("Software Engineer submission has been successfully withdrawn");
  const outcome = await settle(h, h.content.waitForSubmittedRoleWithdrawal(jobA, "Software Engineer", 2, 1, false));
  assert.equal(outcome.withdrawn, false);
  assert.equal(outcome.outcome, "active");
  assert.equal(outcome.inventory.complete, true);
  assert.deepEqual(Array.from(outcome.inventory.roles, role => role.jobId).sort(), [jobA, jobB]);
  assert.ok(h.visited.filter(index => index === 2).length >= 2, "proof reads page two in both complete passes");
  assert.equal(h.content.findSubmittedRoleCard(jobA).jobId, jobA);
});

test("same-page contradictory active evidence overrides a delayed matching-title notification", async () => {
  const h = inventoryHarness({ pages: [[jobA, jobB]] });
  h.dom.schedule(() => h.alert("Software Engineer submission has been successfully withdrawn"), 300);
  const outcome = await settle(h, h.content.waitForSubmittedRoleWithdrawal(jobA, "Software Engineer", 1, 2, false));
  assert.equal(outcome.outcome, "active");
  assert.equal(outcome.withdrawn, false);
});

test("two jobs sharing a title never substitute a success notification for exact-ID absence", async () => {
  const h = inventoryHarness({ pages: [[jobA]], titles: { [jobA]: "Shared Title", [jobB]: "Shared Title" } });
  h.alert("Shared Title submission has been successfully withdrawn");
  const outcome = await settle(h, h.content.waitForSubmittedRoleWithdrawal(jobA, "Shared Title", 1, 2, false));
  assert.equal(outcome.outcome, "active");
  assert.equal(outcome.withdrawn, false);
});

test("selected job moved to another page is active even though the starting page omits it", async () => {
  const h = inventoryHarness({ pages: [[jobB], [jobC], [jobA]] });
  const outcome = await settle(h, h.content.waitForSubmittedRoleWithdrawal(jobA, "Software Engineer", 1, 1, true));
  assert.equal(outcome.outcome, "active");
  assert.equal(outcome.inventory.pagesRead, 3);
  assert.equal(h.visited.filter(index => index === 3).length, 2);
});

test("exact-ID absence in repeated complete live inventories confirms inactivity without a notification", async () => {
  const h = inventoryHarness({ pages: [[jobB], [jobC]] });
  const before = h.dom.clock;
  const outcome = await settle(h, h.content.waitForSubmittedRoleWithdrawal(jobA, "Software Engineer", 2, 2, false));
  assert.equal(outcome.withdrawn, true);
  assert.equal(outcome.outcome, "inactive");
  assert.equal(outcome.inventory.passes.length, 2);
  assert.ok(outcome.inventory.readStartedAt >= before);
  assert.ok(outcome.inventory.readCompletedAt > outcome.inventory.readStartedAt);
  assert.equal(outcome.inventory.roles.some(role => role.jobId === jobA), false);
});

test("confirmed-empty inventory requires Apple's zero-page metadata in two stable passes", async () => {
  const h = inventoryHarness({ pages: [] });
  const outcome = await settle(h, h.content.waitForSubmittedRoleWithdrawal(jobA, "Software Engineer", 1, 1, false));
  assert.equal(outcome.outcome, "inactive");
  assert.equal(outcome.inventory.inventoryState, "confirmed_empty");
  assert.equal(outcome.inventory.roles.length, 0);
  const ambiguous = inventoryHarness({ pages: [[]] });
  const unknown = await settle(ambiguous, ambiguous.content.waitForSubmittedRoleWithdrawal(jobA, "Software Engineer", 1, 1, false, 2000));
  assert.equal(unknown.outcome, "unknown");
  assert.equal(unknown.inventory, undefined);
});

test("an incomplete second page remains unknown despite a fresh success notification", async () => {
  const h = inventoryHarness({ pages: [[jobB], [jobC]], onPage({ index, dom }) {
    if (index === 2 && !dom.document.querySelector("[role='progressbar']"))
      dom.document.body.appendChild(new dom.Node("div", { role: "progressbar" }, "Loading"));
  } });
  h.alert("Software Engineer submission has been successfully withdrawn");
  const outcome = await settle(h, h.content.waitForSubmittedRoleWithdrawal(jobA, "Software Engineer", 1, 1, true, 2500), 4000);
  assert.equal(outcome.withdrawn, false);
  assert.equal(outcome.outcome, "unknown");
  assert.equal(outcome.inventory, undefined);
});

test("initial SPA loading waits for actual parser readiness before building proof", async () => {
  const h = inventoryHarness({ pages: [[jobB]] });
  const busy = new h.dom.Node("div", { role: "progressbar" }, "Loading");
  h.dom.document.body.appendChild(busy);
  h.dom.schedule(() => busy.remove(), 900);
  const before = h.dom.clock;
  const outcome = await settle(h, h.content.waitForSubmittedRoleWithdrawal(jobA, "Software Engineer", 1, 1, false, 5000), 6000);
  assert.equal(outcome.outcome, "inactive");
  assert.equal(outcome.inventory.passes.length, 2);
  assert.ok(outcome.inventory.passes[0].readCompletedAt >= before + 1500);
});

test("a wrong pagination page interrupts consecutive stability reads", async () => {
  const h = inventoryHarness({ pages: [[jobA], [jobB]] });
  const before = h.dom.clock;
  h.dom.schedule(() => h.render(2), 300);
  h.dom.schedule(() => h.render(1), 600);
  const settled = await settle(h, h.content.waitForAppleSubmittedHistoryPage(1, undefined, 3000), 4000);
  assert.equal(settled.pageIndex, 1);
  assert.ok(h.dom.clock >= before + 1200, "return requires three consecutive matching reads after the intervening wrong page");
});

test("changing full inventories exhaust bounded passes rather than certify absence", async () => {
  let visit = 0;
  const h = inventoryHarness({ pages: [[jobB]], onPage({ currentCards }) {
    visit++;
    if (visit > 1) return;
    assert.equal(currentCards.size, 1);
  } });
  // Change a valid DOM between complete passes without overriding its parser.
  const original = h.content.collectAllAppleSubmittedHistoryPages;
  let reads = 0;
  h.content.collectAllAppleSubmittedHistoryPages = async options => {
    const snapshot = await original(options);
    h.pages[0] = ++reads % 2 ? [jobC] : [jobB]; h.render(1);
    return snapshot;
  };
  const outcome = await settle(h, h.content.waitForSubmittedRoleWithdrawal(jobA, "Software Engineer", 1, 1, false));
  assert.equal(reads, 3);
  assert.equal(outcome.outcome, "unknown");
  assert.equal(outcome.withdrawn, false);
});

test("withdrawal evidence rejects stale, pre-intent, incomplete, conflicting, or reordered-time snapshots", () => {
  const good = { passes: [proofPass([jobB], 1000, 1100), proofPass([jobB], 1200, 1300)] };
  assert.equal(safety.validateWithdrawalInventoryEvidence(good, { now: 1400, notBefore: 1000 }).roles[0].jobId, jobB);
  const variants = [
    { passes: [proofPass([jobB], 0, 100), proofPass([jobB], 200, 300)] },
    { passes: [proofPass([jobB], 900, 1100), proofPass([jobB], 1200, 1300)] },
    { passes: [proofPass([jobB], 1000, 1250), proofPass([jobB], 1200, 1300)] },
    { passes: [proofPass([jobB], 1000, 1100), proofPass([jobA], 1200, 1300)] },
    { passes: [proofPass([jobB], 1000, 1100), { ...proofPass([jobB], 1200, 1300), complete: false }] },
    { passes: [proofPass([jobB], 1000, 1100)] },
    { passes: [proofPass([jobB], 1000, 1100), { ...proofPass([jobB], 1200, 1300), accountVerified: false }] }
  ];
  for (const evidence of variants) assert.throws(() => safety.validateWithdrawalInventoryEvidence(evidence, { now: 1400, notBefore: 1000 }));
  assert.throws(() => safety.validateWithdrawalInventoryEvidence(good, { now: 62000 }), /fresh/);
  assert.throws(() => safety.validateWithdrawalInventoryEvidence(good, { now: 1250 }), /fresh/);
});

test("contradictory top-level cached roles cannot override verified exact IDs in proof passes", () => {
  const evidence = { roles: [], complete: true, passes: [proofPass([jobA], 1000, 1100), proofPass([jobA], 1200, 1300)] };
  const verified = safety.validateWithdrawalInventoryEvidence(evidence, { now: 1400, notBefore: 1000 });
  assert.deepEqual(verified.roles.map(role => role.jobId), [jobA]);
});
