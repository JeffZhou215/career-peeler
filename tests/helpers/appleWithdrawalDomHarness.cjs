// A synthetic Apple DOM with capture-phase input and queued mutation records.
// It models the browser boundaries under test without connecting to Chrome.
function createAppleWithdrawalDom(options = {}) {
  const roleIds = options.roleIds || ["200000001-0836", "200000002-9999"];
  const observers = new Set();
  const timers = new Map();
  let timerId = 0;
  let clock = Date.now();
  const calls = { clicks: [], blockedEvents: [], events: [], scrolls: [] };
  const state = { pageIndex: options.pageIndex || 1, pageCount: options.pageCount || 2,
    modal: null, modalSubject: null, hitOverride: null, automaticallyOpen: true, automaticallyClose: true };
  const listeners = new WeakMap();
  const addListener = (target, type, callback, settings = {}) => {
    const capture = typeof settings === "boolean" ? settings : Boolean(settings.capture);
    const entries = listeners.get(target) || [];
    if (!entries.some(entry => entry.type === type && entry.callback === callback && entry.capture === capture)) {
      entries.push({ type, callback, capture, once: Boolean(settings?.once) });
    }
    listeners.set(target, entries);
  };
  const removeListener = (target, type, callback, settings = {}) => {
    const capture = typeof settings === "boolean" ? settings : Boolean(settings.capture);
    listeners.set(target, (listeners.get(target) || []).filter(entry =>
      !(entry.type === type && entry.callback === callback && entry.capture === capture)));
  };
  const eventTarget = target => Object.assign(target, {
    addEventListener(type, callback, settings) { addListener(this, type, callback, settings); },
    removeEventListener(type, callback, settings) { removeListener(this, type, callback, settings); }
  });
  class FixtureEvent {
    constructor(type, settings = {}) {
      Object.assign(this, { type, bubbles: true, cancelable: true, isTrusted: true, defaultPrevented: false,
        button: 0, buttons: 0, clientX: 0, clientY: 0, detail: 1, stopped: false, immediate: false }, settings);
    }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
    stopImmediatePropagation() { this.stopped = true; this.immediate = true; }
    composedPath() { return this.path || []; }
  }
  function mutate(record) {
    for (const observer of observers) {
      if (!observer.target || !(observer.target === record.target || observer.options.subtree && observer.target.contains(record.target))) continue;
      if (!observer.options[record.type === "attributes" ? "attributes" : record.type === "characterData" ? "characterData" : "childList"]) continue;
      if (record.type === "attributes" && observer.options.attributeFilter && !observer.options.attributeFilter.includes(record.attributeName)) continue;
      observer.records.push(record);
      if (!observer.pending) {
        observer.pending = true;
        queueMicrotask(() => {
          observer.pending = false;
          const records = observer.takeRecords();
          if (records.length) observer.callback(records, observer);
        });
      }
    }
  }
  class FixtureMutationObserver {
    constructor(callback) { this.callback = callback; this.records = []; observers.add(this); }
    observe(target, settings) { this.target = target; this.options = settings; observers.add(this); }
    disconnect() { this.target = null; this.records = []; observers.delete(this); }
    takeRecords() { const result = this.records; this.records = []; return result; }
  }
  class Node {
    constructor(tagName, attributes = {}, text = "") {
      this.tagName = tagName.toUpperCase(); this.nodeType = 1;
      this.attributes = new Map(Object.entries(attributes)); this.children = []; this.parentElement = null;
      this._text = text; this._checked = false; this._value = "";
      this.rect = { left: 30, top: 20, width: 200, height: 35 };
      this.style = new Proxy({ display: "block", visibility: "visible", opacity: "1" }, {
        set: (style, name, value) => { const oldValue = JSON.stringify(style); style[name] = value;
          mutate({ type: "attributes", target: this, attributeName: "style", oldValue }); return true; }
      });
      eventTarget(this);
      // Apple effects are bubbling click listeners, not browser default actions.
      this.addEventListener("click", event => this.defaultAction?.(event));
    }
    get id() { return this.getAttribute("id") || ""; }
    set id(value) { this.setAttribute("id", value); }
    get className() { return this.getAttribute("class") || ""; }
    get type() { return this.getAttribute("type") || ""; }
    get href() { return this.getAttribute("href") || ""; }
    set href(value) { this.setAttribute("href", value); }
    get parentNode() { return this.parentElement; }
    get ownerDocument() { return document; }
    get childNodes() { return this.children; }
    get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
    get textContent() { return [this._text, ...this.children.map(child => child.textContent)].join("\n"); }
    set textContent(value) {
      const removedNodes = [...this.children];
      if (this._text) removedNodes.unshift({ nodeType: 3, textContent: this._text, contains(node) { return node === this; } });
      for (const child of this.children) child.parentElement = null;
      this.children = []; this._text = String(value);
      const addedNodes = this._text ? [{ nodeType: 3, textContent: this._text, contains(node) { return node === this; } }] : [];
      // Element.textContent replaces Text nodes and produces a child-list record.
      mutate({ type: "childList", target: this, addedNodes, removedNodes });
    }
    get innerText() { return this.textContent; }
    set innerText(value) { this.textContent = value; }
    get disabled() { return this.attributes.has("disabled"); }
    set disabled(value) { value ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
    get hidden() { return this.attributes.has("hidden"); }
    set hidden(value) { value ? this.setAttribute("hidden", "") : this.removeAttribute("hidden"); }
    get checked() { return this._checked; }
    set checked(value) { this._checked = Boolean(value); }
    get value() { return this._value; }
    set value(value) { this._value = String(value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { const oldValue = this.getAttribute(name); this.attributes.set(name, String(value));
      mutate({ type: "attributes", target: this, attributeName: name, oldValue }); }
    removeAttribute(name) { const oldValue = this.getAttribute(name); this.attributes.delete(name);
      mutate({ type: "attributes", target: this, attributeName: name, oldValue }); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    appendChild(node) { if (node.parentElement) node.remove(); this.children.push(node); node.parentElement = this;
      mutate({ type: "childList", target: this, addedNodes: [node], removedNodes: [] }); return node; }
    remove() { const parent = this.parentElement; if (!parent) return;
      parent.children = parent.children.filter(node => node !== this); this.parentElement = null;
      mutate({ type: "childList", target: parent, addedNodes: [], removedNodes: [this] }); }
    replaceWith(node) { const parent = this.parentElement; if (!parent) return;
      const index = parent.children.indexOf(this); this.parentElement = null; node.parentElement = parent;
      parent.children[index] = node;
      mutate({ type: "childList", target: parent, addedNodes: [node], removedNodes: [this] }); }
    cloneNode(deep = false) { const node = new Node(this.tagName, Object.fromEntries(this.attributes), this._text);
      node._checked = this._checked; node._value = this._value; node.rect = { ...this.rect };
      Object.assign(node.style, this.style);
      if (deep) for (const child of this.children) node.appendChild(child.cloneNode(true));
      return node; }
    matches(selector) {
      return selector.split(/,\s*/).some(part => {
        const pieces = part.trim().split(/\s+(?![^\[]*\])/);
        let current = this;
        if (!simpleMatch(current, pieces.pop())) return false;
        while (pieces.length) { const ancestor = pieces.pop(); current = current.parentElement;
          while (current && !simpleMatch(current, ancestor)) current = current.parentElement;
          if (!current) return false;
        }
        return true;
      });
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) { const found = [];
      const visit = node => { for (const child of node.children) { if (child.matches(selector)) found.push(child); visit(child); } };
      visit(this); return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() {
      let visible = this.isConnected;
      for (let node = this; node; node = node.parentElement) if (node.hidden || node.style.display === "none") visible = false;
      const rect = { ...this.rect, ...(visible ? {} : { width: 0, height: 0 }) };
      return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top };
    }
    scrollIntoView() { calls.scrolls.push(this.id); this.rect.top = Math.max(0, Math.min(this.rect.top, window.innerHeight - this.rect.height)); }
    dispatchEvent(event) { return dispatch(this, event); }
    click() { return dispatch(this, new FixtureEvent("click", { isTrusted: false })); }
  }
  function simpleMatch(node, selector) {
    if (!selector || selector === "*") return true;
    const structural = selector.replace(/\[[^\]]*\]/g, "");
    const tag = structural.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    const id = structural.match(/#([\w-]+)/)?.[1];
    if (id && node.id !== id) return false;
    for (const match of structural.matchAll(/\.([\w-]+)/g)) if (!node.className.split(/\s+/).includes(match[1])) return false;
    for (const match of selector.matchAll(/\[([\w-]+)(?:([*^$]?=)["']?([^"'\]]+)["']?)?\]/g)) {
      const actual = node.getAttribute(match[1]);
      if (actual === null) return false;
      if (match[2] === "=" && actual !== match[3]) return false;
      if (match[2] === "*=" && !actual.includes(match[3])) return false;
      if (match[2] === "^=" && !actual.startsWith(match[3])) return false;
      if (match[2] === "$=" && !actual.endsWith(match[3])) return false;
    }
    return true;
  }
  const document = eventTarget({ nodeType: 9, title: "Your Roles", visibilityState: "visible", readyState: "loading" });
  const window = eventTarget({ innerWidth: 600, innerHeight: 800,
    location: new URL("https://jobs.apple.com/app/en-us/profile/roles"),
    getComputedStyle: node => { let visibility = node.style.visibility;
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.style.visibility === "hidden") visibility = "hidden";
      }
      return { ...node.style, display: node.hidden ? "none" : node.style.display, visibility }; } });
  document.body = new Node("body"); document.documentElement = document.body;
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.querySelector = selector => selector === "body" ? document.body : document.body.querySelector(selector);
  document.getElementById = id => document.body.querySelector(`[id="${id}"]`);
  document.contains = node => document.body.contains(node);
  window.document = document;
  document.dispatchEvent = event => dispatch(document, event);
  window.dispatchEvent = event => dispatch(window, event);
  window.history = { pushState(_state, _title, url) { window.location = new URL(url, window.location.href); } };
  function dispatch(target, event) {
    const chain = target === window ? [window] : target === document ? [document, window] : [];
    if (target !== window && target !== document) {
      for (let node = target; node; node = node.parentElement) chain.push(node);
      if (target.isConnected) chain.push(document, window);
    }
    event.target = target; event.path = [...chain];
    const invoke = (node, capture) => {
      event.currentTarget = node; event.eventPhase = capture ? 1 : node === target ? 2 : 3;
      for (const entry of [...(listeners.get(node) || [])]) {
        if (entry.type !== event.type || entry.capture !== capture) continue;
        if (entry.once) removeListener(node, entry.type, entry.callback, entry.capture);
        entry.callback.call(node, event);
        if (event.immediate) break;
      }
    };
    for (const node of [...chain].reverse()) { invoke(node, true); if (event.stopped) break; }
    if (!event.stopped) for (const node of chain) { invoke(node, false); if (event.stopped || !event.bubbles) break; }
    calls.events.push({ type: event.type, target: target.id, defaultPrevented: event.defaultPrevented });
    if (event.defaultPrevented || event.stopped) calls.blockedEvents.push({ type: event.type, target: target.id });
    if (!event.defaultPrevented && event.type === "click") target.nativeDefaultAction?.(event);
    return !event.defaultPrevented;
  }
  const heading = new Node("h2", {}, "Your Active Submitted Roles"); document.body.appendChild(heading);
  const pagination = new Node("div", { id: "profile-roles-pagination" }); document.body.appendChild(pagination);
  const pageInput = new Node("input", { type: "number" }); pagination.appendChild(pageInput);
  Object.defineProperty(pageInput, "value", { get: () => String(state.pageIndex), set: value => { state.pageIndex = Number(value); } });
  const pageTotal = new Node("span", { "data-autom": "paginationTotalPages" }); pagination.appendChild(pageTotal);
  Object.defineProperty(pageTotal, "textContent", { get: () => String(state.pageCount) });
  const roles = new Map(roleIds.map((jobId, index) => {
    const card = new Node("div", { class: "rolecard" }); document.body.appendChild(card);
    const title = new Node("a", { id: `role-title-${jobId}`, href: `https://jobs.apple.com/en-us/details/${jobId}/engineer` }, `Engineer ${index + 1}`);
    const favorite = new Node("input", { type: "checkbox", id: `addToFavoriteId-favorite-${jobId}` });
    const withdrawButton = new Node("button", { id: `js-withdraw-link-${jobId}` }, "Withdraw");
    withdrawButton.rect = { left: 60, top: 100 + index * 80, width: 140, height: 35 };
    card.appendChild(title); card.appendChild(favorite); card.appendChild(withdrawButton);
    withdrawButton.defaultAction = () => { calls.clicks.push({ stage: "open", jobId }); if (state.automaticallyOpen) showModal(jobId); };
    return [jobId, { jobId, card, title, favorite, withdrawButton }];
  }));
  function makeModal(jobId) {
    const modal = new Node("div", { class: "rc-overlay-popup-outer" });
    modal.rect = { left: 0, top: 0, width: 600, height: 800 };
    const header = new Node("h2", { id: "yourroles-withdrawmodal-header" }, "Are you sure you want to withdraw this submission?");
    const bodyText = new Node("p", {}, "Note that you won’t be able to reapply for this role, and this action can’t be undone.");
    const proceedButton = new Node("button", { id: "yourroles-withdrawmodal-proceed-button" }, "Proceed");
    proceedButton.rect = { left: 180, top: 300, width: 180, height: 40 };
    const cancelButton = new Node("button", { id: "yourroles-withdrawmodal-cancel-button" }, "Cancel");
    const closeButton = new Node("button", { class: "rc-overlay-close", "aria-label": "Close" }, "Close");
    proceedButton.defaultAction = () => { calls.clicks.push({ stage: "proceed", jobId }); if (state.automaticallyClose) hideModal(); };
    cancelButton.defaultAction = closeButton.defaultAction = () => hideModal();
    modal.appendChild(header); modal.appendChild(bodyText); modal.appendChild(cancelButton); modal.appendChild(proceedButton); modal.appendChild(closeButton);
    return { modal, proceedButton, cancelButton, closeButton, header, bodyText };
  }
  function hideModal() { state.modal?.modal.remove(); state.modal = null; state.modalSubject = null; }
  function showModal(jobId = roleIds[0]) { hideModal(); const confirmation = makeModal(jobId);
    state.modal = confirmation; state.modalSubject = jobId; document.body.appendChild(confirmation.modal); return confirmation; }
  document.elementFromPoint = (x, y) => {
    if (state.hitOverride) return state.hitOverride(x, y);
    const candidates = state.modal ? [state.modal.proceedButton, state.modal.cancelButton, state.modal.closeButton, state.modal.modal]
      : [...roles.values()].map(role => role.withdrawButton).reverse();
    return candidates.find(node => { const rect = node.getBoundingClientRect();
      return window.getComputedStyle(node).visibility !== "hidden" && rect.width > 0 && rect.height > 0 &&
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom; }) || document.body;
  };
  function mouse(type, x, y, settings = {}) {
    const target = document.elementFromPoint(x, y);
    return dispatch(target, new FixtureEvent(type, { clientX: x, clientY: y, ...settings }));
  }
  function clickAt(x, y) { mouse("pointerdown", x, y, { buttons: 1 }); mouse("mousedown", x, y, { buttons: 1 });
    // Conservatively deliver click to the final hit target. A browser can instead
    // choose the down/up common ancestor; safety must hold for the stronger case.
    mouse("pointerup", x, y); mouse("mouseup", x, y); return mouse("click", x, y); }
  // Tests advance timer tasks explicitly, after Promise/observer microtasks.
  // Long watchdogs therefore cannot fire before an already-ready Promise resumes.
  const setTimeout = (callback, ms = 0) => { const id = ++timerId; timers.set(id, { callback, at: clock + ms }); return id; };
  async function advanceTime(ms = 0) {
    const until = clock + ms;
    await Promise.resolve(); await Promise.resolve();
    for (;;) {
      const first = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > until) break;
      clock = Math.max(clock, first[1].at); timers.delete(first[0]); first[1].callback();
      await Promise.resolve(); await Promise.resolve();
    }
    clock = until;
    await Promise.resolve(); await Promise.resolve();
  }
  const install = sandbox => Object.assign(sandbox, { document, window, MutationObserver: FixtureMutationObserver,
    Event: FixtureEvent, MouseEvent: FixtureEvent, PointerEvent: FixtureEvent, HTMLAnchorElement: Node,
    setTimeout, clearTimeout: id => timers.delete(id), Date: class extends Date { static now() { return clock; } } });
  const readRole = jobId => { const role = roles.get(jobId); if (!role?.card.isConnected) return null;
    return { jobId: role.title.href.match(/\/details\/([^/]+)/)?.[1], card: role.card, withdrawButton: role.withdrawButton,
      anchor: role.title, favoriteCheckbox: role.favorite,
      favorite: role.favorite.checked, title: role.title.textContent, url: role.title.href }; };
  const findConfirmation = () => state.modal?.modal.isConnected && state.modal.modal.style.display !== "none" &&
    state.modal.modal.style.visibility !== "hidden" && state.modal.modal.style.opacity !== "0" && !state.modal.modal.hidden &&
    state.modal.header.textContent === "Are you sure you want to withdraw this submission?" ? state.modal : null;
  return { document, window, state, calls, roles, Node, Event: FixtureEvent, MutationObserver: FixtureMutationObserver,
    install, readRole, readPage: () => ({ pageIndex: state.pageIndex }), findConfirmation,
    getFailure: () => null, getSuccess: () => null, showModal, hideModal, makeModal, mouse, clickAt,
    schedule: setTimeout, advanceTime, async flushMutations() { await Promise.resolve(); await Promise.resolve(); },
    detachAndReinsertModal() { const modal = state.modal?.modal; if (modal) { modal.remove(); document.body.appendChild(modal); } },
    hideAndReopenModal() { const modal = state.modal?.modal; if (modal) { modal.hidden = true; modal.hidden = false; } },
    replaceRole(jobId) { const prior = roles.get(jobId); const card = prior.card.cloneNode(true);
      const title = card.querySelector(`#role-title-${jobId}`);
      const favorite = card.querySelector(`#addToFavoriteId-favorite-${jobId}`);
      const withdrawButton = card.querySelector(`#js-withdraw-link-${jobId}`);
      withdrawButton.defaultAction = prior.withdrawButton.defaultAction;
      prior.card.replaceWith(card); const role = { jobId, card, title, favorite, withdrawButton }; roles.set(jobId, role); return role; },
    get clock() { return clock; }, get observerCount() { return observers.size; } };
}

module.exports = { createAppleWithdrawalDom };
