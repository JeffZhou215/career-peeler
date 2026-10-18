import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import vm from "node:vm";
import { IDBFactory } from "fake-indexeddb";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const read = relative => readFile(new URL(`../${relative}`, import.meta.url));
const json = async relative => JSON.parse(await read(relative));
let server, ExtensionBrand;

before(async () => {
  server = await createServer({ configFile: false, plugins: [react()], appType: "custom", logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ ExtensionBrand } = await server.ssrLoadModule("/src/sidepanel/components/ExtensionBrand.jsx"));
});
after(async () => { await server?.close(); });

test("Rolebeam release metadata is consistent across the extension, package and lockfile", async () => {
  const [manifest, pkg, lock, panel] = await Promise.all([
    json("manifest.json"), json("package.json"), json("package-lock.json"), read("sidepanel.html")
  ]);
  assert.equal(manifest.name, "Rolebeam");
  assert.equal(manifest.version, "0.2.5");
  assert.equal(pkg.name, "rolebeam");
  assert.equal(pkg.version, manifest.version);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[""].name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.match(String(panel), /<title>Rolebeam<\/title>/);
});

test("the real panel brand renders Rolebeam and Apple Careers with a decorative local letterform icon", async () => {
  const html = renderToStaticMarkup(createElement(ExtensionBrand));
  assert.match(html, /<p\b[^>]*>Rolebeam<\/p>/);
  assert.match(html, /<h1>Apple Careers<\/h1>/);
  assert.doesNotMatch(html, /Career Peeler/);
  const image = html.match(/<img\b[^>]*>/)?.[0];
  assert.ok(image);
  assert.match(image, /src="\.\/icons\/icon128\.png"/);
  assert.match(image, /width="32"/);
  assert.match(image, /height="32"/);
  assert.match(image, /alt=""/);
  assert.ok((await read("icons/icon128.png")).length > 0);
});

test("all declared Chrome icons have their advertised PNG dimensions and editable Rolebeam letterform sources", async () => {
  const manifest = await json("manifest.json");
  assert.deepEqual(Object.keys(manifest.icons).sort(), ["128", "16", "48"]);
  for (const [size, relative] of Object.entries(manifest.icons)) {
    const bytes = await read(relative);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], relative);
    assert.equal(bytes.toString("ascii", 12, 16), "IHDR", relative);
    assert.equal(bytes.readUInt32BE(16), Number(size), relative);
    assert.equal(bytes.readUInt32BE(20), Number(size), relative);
    const svg = String(await read(relative.replace(/\.png$/, ".svg")));
    assert.match(svg, /aria-label="Rolebeam letterform logo"/);
    for (const color of ["#25215a", "#fff", "#78edd0"]) assert.ok(svg.includes(color), `${relative}: ${color}`);
    assert.doesNotMatch(svg, /Career Peeler|>\s*C\s*<|>\s*CP\s*</);
  }
  assert.deepEqual(await read("store-assets/store-icon-128x128.png"), await read(manifest.icons["128"]));
});

test("rebranding preserves existing job storage, workflow journals and cross-context change notifications", async () => {
  const source = String(await read("lib/appleJobStore.js"));
  const indexedDB = new IDBFactory();
  const databases = new Set(), channels = new Set();
  const rankingKey = "appleJobRanking", workflowKey = "appleApplicationWorkflow";
  const ranking = { jobs: { "200123456-0836": { jobId: "200123456-0836", queueStatus: "queued" } }, searches: {}, applicationFailures: {} };
  const workflow = { status: "interrupted", jobs: { "200123456-0836": { outcome: "unknown" } } };
  const localData = { [rankingKey]: structuredClone(ranking), [workflowKey]: structuredClone(workflow) };
  class Channel {
    constructor(name) { this.name = name; channels.add(this); }
    postMessage(data) {
      for (const channel of channels) {
        if (channel !== this && channel.name === this.name) channel.onmessage?.({ data: structuredClone(data) });
      }
    }
  }
  function context() {
    const sandbox = { indexedDB, BroadcastChannel: Channel, console,
      chrome: { storage: { local: {
        get: async keys => structuredClone(Object.fromEntries(keys.filter(key => Object.hasOwn(localData, key)).map(key => [key, localData[key]]))),
        remove: async keys => { for (const key of keys) delete localData[key]; }
      }, onChanged: { addListener() {}, removeListener() {} } } } };
    vm.runInNewContext(source, sandbox, { filename: "lib/appleJobStore.js" });
    return sandbox.CareerPeelerJobStore;
  }
  try {
    const first = context();
    assert.equal(first.DATABASE_NAME, "CareerPeelerJobs");
    const database = await first.ready();
    databases.add(database);
    assert.equal(database.name, "CareerPeelerJobs");
    const reopened = context();
    databases.add(await reopened.ready());
    const restored = JSON.parse(JSON.stringify(await reopened.get([rankingKey, workflowKey])));
    assert.deepEqual(restored[rankingKey], ranking);
    assert.deepEqual(restored[workflowKey], workflow);
    const changes = [];
    first.onChanged.addListener(() => {});
    reopened.onChanged.addListener((value, area) => changes.push({ keys: Object.keys(value), area }));
    assert.equal(channels.size, 2);
    assert.ok([...channels].every(channel => channel.name === "career-peeler-job-storage"));
    await first.updateMetadata(workflowKey, value => ({ ...value, stopRequested: true }));
    assert.deepEqual(changes, [{ keys: [workflowKey], area: "indexeddb" }]);
    const saved = JSON.parse(JSON.stringify(await reopened.getMetadata(workflowKey)));
    assert.equal(saved.stopRequested, true);
    assert.equal(saved.jobs["200123456-0836"].outcome, "unknown");
  } finally {
    for (const database of databases) database.close();
  }
});
