import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

let server;
let CompactRoleCard;
const role = { jobId: "200000001", title: "Example Engineer", score: 80, reason: "Example match explanation", url: "https://jobs.apple.com/en-us/details/200000001" };

before(async () => {
  server = await createServer({ configFile: false, plugins: [react()], appType: "custom", logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ CompactRoleCard } = await server.ssrLoadModule("/src/sidepanel/components/CompactRoleCard.jsx"));
});
after(async () => { await server?.close(); });

test("each role uses its list's disclosure group", () => {
  const ranked = CompactRoleCard({ role, disclosureGroup: "ranked" }).props.children;
  const queued = CompactRoleCard({ role, disclosureGroup: "queue" }).props.children;
  assert.equal(ranked.type, "details");
  assert.equal(ranked.props.name, "ranked");
  assert.equal(queued.props.name, "queue");
});

test("closing a role resets its nested disclosures", () => {
  const sections = [{ open: true }, { open: true }];
  const target = { open: false, querySelectorAll(selector) { assert.equal(selector, "details[open]"); return sections; } };
  const card = CompactRoleCard({ role }).props.children;
  card.props.onToggle({ target, currentTarget: target });
  assert.ok(sections.every(section => section.open === false));
});

test("nested toggle events cannot reset their parent role", () => {
  const card = CompactRoleCard({ role }).props.children;
  const parent = { open: false, querySelectorAll() { assert.fail("A child's toggle must not be handled as the role's toggle."); } };
  card.props.onToggle({ target: { open: false }, currentTarget: parent });
});

test("opening a role does not reset its content", () => {
  const target = { open: true, querySelectorAll() { assert.fail("Opening must leave content alone."); } };
  CompactRoleCard({ role }).props.children.props.onToggle({ target, currentTarget: target });
});

test("role actions and matching sections keep their DOM order", () => {
  const html = renderToStaticMarkup(createElement(CompactRoleCard, {
    role, disclosureGroup: "queue", actions: createElement("button", {}, "Remove From Queue")
  }, createElement("details", {}, createElement("summary", {}, "Local Resume Match"))));
  const positions = ["Example Engineer", "Open Job Page", "Remove From Queue", "Match Details", "Local Resume Match"].map(text => html.indexOf(text));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.ok(html.includes('name="queue"'));
});

test("disclosure layouts do not inherit the legacy evidence grid", async () => {
  const css = await readFile(new URL("../src/sidepanel/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.ranking-evidence\s*\{\s*display:\s*block/);
  assert.match(css, /\.compact-role-body\s*\{\s*display:\s*block/);
  assert.doesNotMatch(css, /\.ranking-evidence\s+div\s*\{/);
  assert.match(css, /\.compact-role > details:not\(\[open\]\) > \.compact-role-body/);
});

test("discovery status is visible in the collapsed role heading rather than hidden inside match details", async () => {
  const source = await readFile(new URL("../src/sidepanel/components/RankedJobsSection.jsx", import.meta.url), "utf8");
  assert.match(source, /status=\{`\$\{status\} · \$\{discoveryLabel\}`\}/);
  for (const discovery of ["Latest Scan", "Historical Cache", "Membership Unknown"]) {
    assert.ok(source.includes(discovery));
    const html = renderToStaticMarkup(createElement(CompactRoleCard, { role, status: `Strong Match · ${discovery}` }));
    assert.ok(html.indexOf(discovery) < html.indexOf("compact-role-body"));
  }
});
