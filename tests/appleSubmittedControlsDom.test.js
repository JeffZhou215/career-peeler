const { test } = require("node:test");
const assert = require("node:assert/strict");
const fixture = require("./fixtures/appleSubmittedControls.json");
const safety = require("../lib/appleApplicationSafety.js");
const { createContentHarness } = require("./helpers/appleWorkflowHarness.cjs");

const jobId = fixture.expectedJobId;
const headerId = "jobdetails-jobdetails-jobdetailheader-actions-jobdetailssubmitresume";
const footerId = "jobdetails-jobdetails-jobdetailfooter-actions-jobdetailssubmitresume";

function controlEvidence() {
  return {
    url: fixture.url, authenticated: true, title: fixture.title, roleNumber: jobId,
    controls: fixture.wrapper.children.filter(node => [headerId, footerId].includes(node.attributes.id)).map(node => ({
      id: node.attributes.id, tagName: node.tagName, role: node.attributes.role,
      ariaDisabled: node.attributes["aria-disabled"], tabIndex: node.attributes.tabindex,
      href: Object.hasOwn(node.attributes, "href") ? node.attributes.href : null,
      text: node.text, ariaLabel: node.attributes["aria-label"],
      disabledClass: node.attributes.class.split(/\s+/).includes("disabled"), visible: true, connected: true
    }))
  };
}

test("sanitized observed full-ID controls satisfy the shared exact submitted-evidence policy", () => {
  const result = safety.submittedControlEvidence(jobId, controlEvidence());
  assert.equal(result.jobId, jobId);
  assert.equal(result.title, fixture.title);
  assert.equal(result.source, "apple_submitted_controls");
});

const invalidEvidence = [
  ["absent evidence", () => null],
  ["signed-out account", data => { data.authenticated = false; }],
  ["unknown account state", data => { delete data.authenticated; }],
  ["base role number", data => { data.roleNumber = fixture.baseIdentifierVariant.roleNumber; }],
  ["other full role number", data => { data.roleNumber = "200670922-9999"; }],
  ["missing role number", data => { delete data.roleNumber; }],
  ["blank title", data => { data.title = " \n "; }],
  ["untrusted origin", data => { data.url = fixture.url.replace("jobs.apple.com", "example.com"); }],
  ["application route", data => { data.url = `https://jobs.apple.com/app/en-us/apply/${jobId}`; }],
  ["base URL", data => { data.url = fixture.baseIdentifierVariant.url; }],
  ["wrong suffix URL", data => { data.url = fixture.url.replace("-0836", "-9999"); }],
  ["missing controls", data => { delete data.controls; }],
  ["missing footer", data => { data.controls.pop(); }],
  ["duplicate header", data => { data.controls[1] = { ...data.controls[0] }; }],
  ["extra duplicate footer", data => { data.controls.push({ ...data.controls[1] }); }]
];
for (const index of [0, 1]) {
  for (const [name, property, value] of [
    ["wrong id", "id", `${headerId}-other`], ["non-anchor tag", "tagName", "BUTTON"],
    ["wrong role", "role", "button"], ["enabled aria state", "ariaDisabled", "false"],
    ["missing aria state", "ariaDisabled", null], ["focusable tab index", "tabIndex", "0"],
    ["missing tab index", "tabIndex", null], ["empty href attribute", "href", ""],
    ["clickable href", "href", fixture.url], ["enabled class", "disabledClass", false],
    ["hidden control", "visible", false], ["detached control", "connected", false],
    ["wrong text", "text", "Submit Resume"], ["base aria identifier", "ariaLabel", fixture.baseIdentifierVariant.ariaLabel],
    ["wrong title aria label", "ariaLabel", `Submitted: Another Role ${jobId}`],
    ["wrong full aria identifier", "ariaLabel", `Submitted: ${fixture.title} 200670922-9999`]
  ]) invalidEvidence.push([`${index === 0 ? "header" : "footer"} ${name}`, data => { data.controls[index][property] = value; }]);
}
for (const [name, change] of invalidEvidence) {
  test(`shared evidence rejects ${name}`, () => {
    const data = controlEvidence();
    const returned = change(data);
    assert.equal(safety.submittedControlEvidence(jobId, returned === null ? null : data), null);
  });
}

// Minimal DOM tree, not a fake submitted-status result. The real content reader
// runs all selectors, visibility checks, attribute reads, and both observations.
// Selector support is explicit so a new production selector fails loudly instead
// of getting a canned response that duplicates the implementation's assumptions.
function matchesSelector(node, selector) {
  let remaining = selector.trim();
  const tag = remaining.match(/^[a-z][\w-]*/i);
  if (tag) { if (node.tagName !== tag[0].toUpperCase()) return false; remaining = remaining.slice(tag[0].length); }
  const id = remaining.match(/#([\w-]+)/);
  if (id) { if (node.getAttribute("id") !== id[1]) return false; remaining = remaining.replace(id[0], ""); }
  let attributesMatch = true;
  remaining = remaining.replace(/\[([\w-]+)(?:(\*=|=)["']([^"']*)["'])?\]/g, (all, name, operator, value) => {
    const actual = node.getAttribute(name);
    if (operator === "=" ? actual !== value : operator === "*=" ? actual === null || !actual.includes(value) : actual === null) attributesMatch = false;
    return "";
  });
  if (!attributesMatch) return false;
  if (remaining.trim()) throw new Error(`Unsupported DOM fixture selector: ${selector}`);
  return true;
}

function domNode(data) {
  const node = {
    tagName: data.tagName, attributes: { ...data.attributes }, children: [], parentElement: null,
    ownText: data.text || "", visible: data.visible !== false, connected: true, clickCount: 0,
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    getBoundingClientRect() {
      let rendered = this.visible && this.isConnected;
      for (let parent = this.parentElement; parent; parent = parent.parentElement) rendered = rendered && parent.visible;
      return { width: rendered ? 300 : 0, height: rendered ? 24 : 0, top: 0 };
    },
    querySelectorAll(selector) {
      const selectors = selector.split(",");
      const result = [];
      const visit = parent => { for (const child of parent.children) { if (selectors.some(part => matchesSelector(child, part))) result.push(child); visit(child); } };
      visit(this); return result;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; this.connected = false; },
    click() { this.clickCount += 1; throw new Error("Recovery DOM tests must never click a page control."); }
  };
  Object.defineProperties(node, {
    innerText: { get() { return [this.ownText, ...this.children.map(child => child.innerText)].filter(Boolean).join("\n"); }, set(value) { this.ownText = value; } },
    textContent: { get() { return this.innerText; } },
    isConnected: { get() { return this.connected && (!this.parentElement || this.parentElement.isConnected); } },
    classList: { get() { return { contains: value => String(this.attributes.class || "").split(/\s+/).includes(value) }; } },
    childNodes: { get() { return this.children; } },
    href: { get() { const value = this.getAttribute("href"); return value === null ? "" : new URL(value, fixture.url).href; } }
  });
  for (const child of data.children || []) node.appendChild(domNode(child));
  return node;
}

function createDomFixture() {
  const h = createContentHarness({ url: fixture.url });
  const body = domNode({ tagName: "BODY", children: [fixture.wrapper, ...fixture.accountControls] });
  h.document = {
    body, readyState: "complete", title: fixture.title,
    querySelectorAll: selector => body.querySelectorAll(selector),
    querySelector: selector => body.querySelector(selector),
    getElementById: id => body.querySelector(`#${id}`)
  };
  h.window.getComputedStyle = node => ({ visibility: node.visible ? "visible" : "hidden", display: "block" });
  h.performance = { timeOrigin: Date.now() };
  h.node = id => h.document.getElementById(id);
  h.append = data => body.appendChild(domNode(data));
  h.read = (notBefore = h.performance.timeOrigin) => h.dispatch({ type: "APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS",
    expectedJobId: jobId, requestId: "submitted-controls-dom", notBefore });
  return h;
}

function assertUnknown(response, reason) {
  assert.ok(response.ok !== true || response.data?.submissionOutcome === "unknown", `${reason}: ${JSON.stringify(response)}`);
  assert.notEqual(response.data?.proof, "apple_submitted_controls", reason);
}

test("real DOM reader confirms stable exact full-ID controls in a fresh signed-in document without clicking", async () => {
  const h = createDomFixture();
  const response = await h.read();
  assert.equal(response.ok, true, response.error);
  assert.equal(response.data.submissionOutcome, "confirmed");
  assert.equal(response.data.proof, "apple_submitted_controls");
  assert.equal(response.data.controlEvidence.roleNumber, jobId);
  assert.equal(response.data.signal.jobId, jobId);
  assert.equal(response.data.requestId, "submitted-controls-dom");
  assert.equal(h.observationCalls.messages.length, 0);
  assert.equal(h.document.querySelectorAll("a").reduce((sum, node) => sum + node.clickCount, 0), 0);
});

const domMutations = [
  ["base-only markup at the exact full URL", h => {
    h.node("jobdetails-jobnumber").innerText = fixture.baseIdentifierVariant.roleNumber;
    for (const id of [headerId, footerId]) h.node(id).setAttribute("aria-label", fixture.baseIdentifierVariant.ariaLabel);
  }],
  ["base-only URL and markup", h => {
    h.window.location = new URL(fixture.baseIdentifierVariant.url);
    h.node("jobdetails-jobnumber").innerText = fixture.baseIdentifierVariant.roleNumber;
    for (const id of [headerId, footerId]) h.node(id).setAttribute("aria-label", fixture.baseIdentifierVariant.ariaLabel);
  }],
  ["different full suffix URL", h => { h.window.location = new URL(fixture.url.replace("-0836", "-9999")); }],
  ["another origin", h => { h.window.location = new URL(fixture.url.replace("jobs.apple.com", "example.com")); }],
  ["old document", h => { h.performance.timeOrigin -= 1000; }],
  ["loading document", h => { h.document.readyState = "loading"; }],
  ["absent document-start timestamp", h => { h.performance = {}; }],
  ["session expired text", h => { h.document.body.ownText = "Please sign in to continue"; }],
  ["missing signed-in account control", h => { h.node("search-localnav-link-sign-out").remove(); }],
  ["invalid logout href", h => { h.node("search-localnav-link-sign-out").setAttribute("href", "/en-us/profile"); }],
  ["hidden sign-out control", h => { h.node("search-localnav-link-sign-out").visible = false; }],
  ["duplicate sign-out controls", h => { h.append(fixture.accountControls[0]); }],
  ["visible sign-in control", h => { h.append({ tagName: "A", text: "Sign In", attributes: { id: "search-localnav-link-sign-in", href: "/en-us/login" } }); }],
  ["visible loading signal", h => { h.append({ tagName: "DIV", text: "Loading, please wait", attributes: { "aria-busy": "true" } }); }],
  ["contradictory error alert", h => { h.append({ tagName: "DIV", text: "Unable to verify application; error pending", attributes: { role: "alert" } }); }],
  ["missing role-number id", h => { h.node("jobdetails-jobnumber").removeAttribute("id"); }],
  ["wrong role-number itemprop", h => { h.node("jobdetails-jobnumber").setAttribute("itemprop", "name"); }],
  ["another full role-number id", h => { h.node("jobdetails-jobnumber").innerText = "200670922-9999"; }],
  ["hidden role number", h => { h.node("jobdetails-jobnumber").visible = false; }],
  ["missing title", h => { h.node("jobdetails-postingtitle").remove(); }],
  ["hidden title", h => { h.node("jobdetails-postingtitle").visible = false; }],
  ["changed title", h => { h.node("jobdetails-postingtitle").innerText = "Another Role"; }],
  ["duplicate title id", h => { h.node("jobdetails-wrapper").appendChild(domNode(fixture.wrapper.children[0])); }],
  ["duplicate role-number id", h => { h.node("jobdetails-wrapper").appendChild(domNode(fixture.wrapper.children[1])); }],
  ["duplicate wrapper id", h => { h.append(fixture.wrapper); }],
  ["hidden wrapper", h => { h.node("jobdetails-wrapper").visible = false; }],
  ["detached wrapper", h => { h.node("jobdetails-wrapper").connected = false; }],
  ["missing wrapper id", h => { h.node("jobdetails-wrapper").removeAttribute("id"); }],
  ["unexpected wrapper id", h => { h.node("jobdetails-wrapper").setAttribute("id", "other-jobdetails-wrapper"); }]
];
for (const id of [headerId, footerId]) {
  const label = id === headerId ? "header" : "footer";
  domMutations.push(
    [`missing ${label} control`, h => { h.node(id).remove(); }],
    [`changed ${label} id`, h => { h.node(id).setAttribute("id", `${id}-other`); }],
    [`duplicate ${label} id`, h => { const source = fixture.wrapper.children.find(node => node.attributes.id === id); h.node("jobdetails-wrapper").appendChild(domNode(source)); }],
    [`enabled ${label}`, h => { h.node(id).setAttribute("aria-disabled", "false"); }],
    [`clickable ${label}`, h => { h.node(id).setAttribute("href", "/en-us/apply"); }],
    [`wrong ${label} title`, h => { h.node(id).setAttribute("aria-label", `Submitted: Another Role ${jobId}`); }],
    [`wrong ${label} full identifier`, h => { h.node(id).setAttribute("aria-label", `Submitted: ${fixture.title} 200670922-9999`); }],
    [`hidden ${label}`, h => { h.node(id).visible = false; }],
    [`disconnected ${label}`, h => { h.node(id).connected = false; }]
  );
}
for (const [reason, mutate] of domMutations) {
  test(`real recovery reader leaves ${reason} unresolved`, async () => {
    const h = createDomFixture();
    const notBefore = h.performance.timeOrigin;
    mutate(h);
    assertUnknown(await h.read(notBefore), reason);
  });
}

for (const id of ["jobdetails-wrapper", headerId, footerId]) {
  for (const mode of ["remove", "replace"]) {
    test(`recovery rejects ${mode} of ${id} between its two live reads`, async () => {
      const h = createDomFixture();
      h.delay = async () => {
        const original = h.node(id);
        if (mode === "replace") {
          const source = id === "jobdetails-wrapper" ? fixture.wrapper : fixture.wrapper.children.find(node => node.attributes.id === id);
          original.parentElement.appendChild(domNode(source));
        }
        original.remove();
      };
      assertUnknown(await h.read(), `${mode} ${id}`);
    });
  }
}

for (const [reason, mutate] of [
  ["full job URL changes", h => { h.window.location = new URL(fixture.url.replace("-0836", "-9999")); }],
  ["role number changes", h => { h.node("jobdetails-jobnumber").innerText = "200670922-9999"; }],
  ["control becomes enabled", h => { h.node(headerId).setAttribute("aria-disabled", "false"); }],
  ["sign-out disappears", h => { h.node("search-localnav-link-sign-out").remove(); }],
  ["error arrives", h => { h.append({ tagName: "DIV", text: "Application failed", attributes: { role: "alert" } }); }],
  ["loading begins", h => { h.document.readyState = "loading"; }]
]) {
  test(`recovery rejects a second-read change when ${reason}`, async () => {
    const h = createDomFixture(); h.delay = async () => mutate(h);
    assertUnknown(await h.read(), reason);
  });
}

test("a delayed Submitted render is not confirmed until a later complete stable read", async () => {
  const h = createDomFixture();
  const footer = h.node(footerId); footer.remove();
  h.delay = async () => { h.node("jobdetails-wrapper").appendChild(footer); footer.connected = true; };
  assertUnknown(await h.read(), "first observation incomplete");
  h.delay = async () => {};
  const response = await h.read();
  assert.equal(response.ok, true, response.error);
  assert.equal(response.data.submissionOutcome, "confirmed");
});

test("a delayed matching-title toast with no exact job id cannot replace missing controls", async () => {
  const h = createDomFixture(); h.node(footerId).remove();
  h.delay = async () => { h.append({ tagName: "DIV", text: `Your application for ${fixture.title} has been submitted`, attributes: { role: "alert" } }); };
  assertUnknown(await h.read(), "title-only toast");
});
