const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const source = name => fs.readFileSync(path.join(root, name), "utf8");
const event = () => {
  const listeners = new Set();
  return { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener),
    emit: (...args) => Promise.all([...listeners].map(listener => listener(...args))) };
};

function createContentHarness(options = {}) {
  const listeners = [];
  const timers = new Map();
  const observers = [];
  const calls = { messages: [] };
  const sandbox = {
    URL, console, setTimeout, clearTimeout, Event: class Event {},
    fetch: async () => { throw new Error("Real network requests are forbidden in workflow tests."); },
    chrome: { runtime: { id: options.observe ? "test-extension" : undefined,
      onMessage: { addListener: listener => listeners.push(listener) },
      sendMessage: async message => { calls.messages.push(message); return { ok: true }; } } },
    document: { body: { innerText: "", scrollHeight: 0 }, title: "Apple Application",
      querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    window: { location: new URL(options.url || "https://jobs.apple.com/app/en-us/apply/200123456-0836"),
      scrollTo() {}, getComputedStyle: () => ({ visibility: "visible", display: "block" }) }
  };
  if (options.observe) {
    let timerId = 0;
    sandbox.setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
    sandbox.clearTimeout = id => timers.delete(id);
    sandbox.MutationObserver = class { constructor(callback) { observers.push(callback); } observe() {} };
  }
  vm.createContext(sandbox);
  vm.runInContext(source("lib/appleApplicationSafety.js"), sandbox);
  vm.runInContext(source("lib/appleWithdrawalSafety.js"), sandbox);
  vm.runInContext(source("content.js"), sandbox);
  sandbox.delay = async () => {};
  sandbox.waitForCondition = async predicate => Boolean(predicate());
  sandbox.dispatch = (message, sender = {}) => new Promise(resolve => listeners[0](message, sender, resolve));
  sandbox.observationCalls = calls;
  sandbox.mutate = () => observers.forEach(callback => callback());
  sandbox.flushObservationTimers = async () => {
    const pending = [...timers.values()]; timers.clear();
    for (const callback of pending) await callback();
    await Promise.resolve();
  };
  return sandbox;
}

function radioQuestion(text, selected = null) {
  const container = {
    tagName: "FIELDSET", innerText: `${text}\nYes\nNo`, required: true, isConnected: true,
    getAttribute: () => null, closest() { return this; }, querySelector: () => null,
    getBoundingClientRect: () => ({ width: 400, height: 60, top: 0 })
  };
  const radios = ["Yes", "No"].map(label => ({
    tagName: "INPUT", type: "radio", value: label.toLowerCase(), innerText: "", checked: label.toLowerCase() === selected,
    isConnected: true, labels: [{ innerText: label }], className: "", clicks: 0,
    getAttribute: name => name === "type" ? "radio" : null,
    getBoundingClientRect: () => ({ width: 20, height: 20, top: 0 }),
    closest: () => container, querySelector: () => null, scrollIntoView() {},
    click() { this.clicks++; for (const option of radios) option.checked = option === this; }
  }));
  container.querySelectorAll = selector => /radio|label|button/.test(selector) ? radios : [];
  return { container, radios };
}

function installQuestions(sandbox, questions) {
  sandbox.document.querySelectorAll = selector => selector === "fieldset, section, div, li"
    ? questions.map(question => question.container) : [];
}

function createBackgroundHarness(tabs = [{ id: 1, windowId: 1, status: "complete",
  url: "https://jobs.apple.com/app/en-us/apply/200123456-0836", title: "Apple Role" }], options = {}) {
  const data = options.data || {};
  const listeners = [];
  const intervals = new Map();
  let intervalId = 0;
  const calls = { checkpoints: [], messages: [], injected: [], removed: [], created: [], updated: [],
    intervalDelays: [], clearedIntervals: [], platformReads: 0, reloaded: [] };
  const get = async keys => Object.fromEntries((typeof keys === "string" ? [keys] : keys || Object.keys(data))
    .filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])]));
  const store = { get, set: async updates => Object.assign(data, structuredClone(updates)),
    remove: async keys => { for (const key of [].concat(keys)) delete data[key]; },
    patch: async (key, value) => { data[key] = structuredClone(value); },
    getMetadata: async key => structuredClone(data[key]),
    updateMetadata: async (key, update) => { const value = update(structuredClone(data[key])); data[key] = structuredClone(value); return structuredClone(value); },
    getRecords: async (key, ids, field = null) => {
      const records = field ? data[key]?.[field] : data[key];
      return Object.fromEntries(ids.filter(id => records?.[id]).map(id => [id, structuredClone(records[id])]));
    },
    putRecords: async (key, records) => { data[key] = { ...data[key], ...structuredClone(records) }; } };
  const sandbox = { URL, console, setTimeout, clearTimeout,
    setInterval: (callback, delay) => { calls.intervalDelays.push(delay); intervals.set(++intervalId, callback); return intervalId; },
    clearInterval: id => { calls.clearedIntervals.push(id); intervals.delete(id); },
    fetch: async () => { throw new Error("Real network requests are forbidden in workflow tests."); },
    chrome: {
      storage: { local: store, session: store, onChanged: event() },
      runtime: { onMessage: { addListener: listener => listeners.push(listener) }, sendMessage: async () => ({ ok: true }),
        getPlatformInfo: async () => { calls.platformReads++; return options.getPlatformInfo ? options.getPlatformInfo() : { os: "mac", arch: "arm64" }; } },
      sidePanel: { setPanelBehavior: async () => {} },
      scripting: { executeScript: async request => { calls.injected.push(request); return []; } },
      tabs: { onActivated: event(), onUpdated: event(),
        get: async id => { const tab = tabs.find(tab => tab.id === id); if (!tab) throw new Error("Tab closed"); return { ...tab }; },
        query: async query => tabs.filter(tab => query?.windowId === undefined || tab.windowId === query.windowId).map(tab => ({ ...tab })),
        create: async properties => {
          calls.created.push(structuredClone(properties));
          const tab = { id: Math.max(0, ...tabs.map(tab => tab.id)) + 1, status: "complete", ...properties };
          tabs.push(tab); return { ...tab };
        },
        update: async (id, updates) => { calls.updated.push({ id, ...updates }); const tab = tabs.find(tab => tab.id === id); Object.assign(tab, updates); return { ...tab }; },
        reload: async (id, properties) => { calls.reloaded.push({ id, ...properties }); },
        remove: async id => calls.removed.push(id),
        sendMessage: async (id, message) => {
          calls.messages.push(message);
          if (options.sendMessage) return options.sendMessage(id, message);
          throw new Error(`Unmocked message: ${message.type}`);
        }
      }
    }, CareerPeelerJobStore: store };
  vm.createContext(sandbox);
  sandbox.importScripts = (...files) => {
    for (const file of files) {
      // These tests exercise workflow code, not IndexedDB migration. The adapter
      // retains the asynchronous storage boundary without loading browser IDB.
      if (file !== "lib/appleJobStore.js") vm.runInContext(source(file), sandbox, { filename: file });
    }
  };
  vm.runInContext(source("background.js"), sandbox, { filename: "background.js" });
  sandbox.delay = async () => {};
  sandbox.recordAppliedCheckpoint = async job => calls.checkpoints.push(job.jobId);
  sandbox.dispatch = (message, sender = {}) => new Promise(resolve => listeners[0](message, sender, resolve));
  const ready = vm.runInContext("appleWorkflowReady", sandbox);
  return { sandbox, calls, data, tabs, ready, intervals };
}

module.exports = { createContentHarness, createBackgroundHarness, radioQuestion, installQuestions };
