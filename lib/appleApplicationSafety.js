// Pure rules shared by the Apple content script and classic background worker.
(function (root) {
  function workQuestionPolicy(questionText, profile = {}) {
    const text = String(questionText || "").replace(/\s+/g, " ").trim().toLowerCase();
    const sponsorship = /\bsponsorship\b|\bvisa transfer\b|\b(?:employment|work) visa\b|\bimmigration (?:support|assistance)\b|\b(?:requir\w*|need\w*|seek\w*)\b.{0,50}\b(?:sponsor(?:ship)?|work visa|immigration support)\b|\bnow or in the future\b.*\b(?:sponsorship|visa)\b/.test(text);
    const authorization = /\blegally authorized\b|\bauthorized to work\b|\beligible to work\b|\b(?:right|permission)[\s\-‐‑‒–—]+to[\s\-‐‑‒–—]+work\b|\bwork authori[sz]ation\b/.test(text);
    const categorical = /\b(?:right[\s\-‐‑‒–—]+to[\s\-‐‑‒–—]+work|work authori[sz]ation|sponsorship)\s+status\b|\b(?:ever|previous|prior|currently sponsored)\b/.test(text);
    if (!sponsorship && !authorization && !/\bwork in the (?:us|u\.s\.|united states)\b/.test(text)) return null;
    const key = sponsorship ? "requiresSponsorship" : "workAuthorized";
    const policyKey = sponsorship ? "sponsorship" : "work_authorization";
    const ambiguous = /\bnot\s+(?:legally\s+)?(?:authorized|eligible|require|need)\b|\b(?:hold|have|possess|on)\b.{0,30}\b(?:employment|work) visa\b|\b(?:willing|want)\b.{0,30}\bwork in\b/.test(text);
    if (categorical || ambiguous || (sponsorship && authorization)) {
      return { policyKey, error: "Review this work-eligibility question manually; saved Yes/No settings cannot resolve its categorical or combined wording." };
    }
    const answer = String(profile[key] || "").trim().toLowerCase();
    if (!["yes", "no"].includes(answer)) {
      return { policyKey, error: `Save an explicit ${sponsorship ? "sponsorship" : "work authorization"} answer in Setup before continuing.` };
    }
    return { policyKey, desiredAnswer: answer === "yes" ? "Yes" : "No" };
  }

  function jobIdFromUrl(value) {
    try {
      const url = new URL(value);
      if (url.origin !== "https://jobs.apple.com") return null;
      return url.pathname.match(/^\/(?:[^/]+\/details|app\/[^/]+\/apply)\/(\d+(?:-\d+)?)(?:\/|$)/i)?.[1] || null;
    } catch (_) { return null; }
  }

  function matchesJob(expectedJobId, url) {
    return /^\d+(?:-\d+)?$/.test(String(expectedJobId || "")) && jobIdFromUrl(url) === String(expectedJobId);
  }

  function isConfirmationUrl(value) {
    try {
      const url = new URL(value);
      return url.origin === "https://jobs.apple.com" && /^\/app\/[^/]+\/profile\/(?:info|roles)\/?$/i.test(url.pathname);
    } catch (_) { return false; }
  }

  function validateSubmittedHistoryInventory(data) {
    const fail = () => { throw new Error("Apple did not confirm a complete active-submission inventory. Sync Your Roles again; capacity is unknown."); };
    if (!Number.isInteger(data?.pageCount) || data.pageCount < 1 || data.pageCount > 100 ||
      !Array.isArray(data.pages) || data.pages.length !== data.pageCount) fail();
    const roles = [];
    const ids = new Set();
    for (let index = 0; index < data.pages.length; index++) {
      const page = data.pages[index];
      if (!page || page.accountVerified !== true || page.pageIndex !== index + 1 || page.pageCount !== data.pageCount ||
        page.hasNextPage !== (index + 1 < data.pageCount) || page.withdrawalConfirmationOpen !== false ||
        !Array.isArray(page.roles)) fail();
      if (!page.roles.length) {
        if (data.pageCount !== 1 || page.inventoryState !== "confirmed_empty") fail();
      } else {
        if (page.inventoryState !== "confirmed") fail();
        for (const role of page.roles) {
          if (!role || role.active !== true || typeof role.jobId !== "string" ||
            !/^\d+(?:-\d+)?$/.test(role.jobId) || ids.has(role.jobId)) fail();
          ids.add(role.jobId);
          roles.push(role);
        }
      }
    }
    return { roles, inventoryState: roles.length ? "confirmed" : "confirmed_empty", complete: true,
      accountVerified: true, pagesRead: data.pages.length, pageCount: data.pageCount };
  }

  // A withdrawal's absence must be observed in repeated, complete live reads.
  // Page notifications and a missing card on one pagination page are not proof.
  function validateWithdrawalInventoryEvidence(evidence, { notBefore = 0, now = Date.now(), maxAgeMs = 60000 } = {}) {
    const fail = () => { throw new Error("Apple did not confirm a fresh, complete, stable active-submission inventory. The withdrawal outcome is unknown; sync submissions before retrying."); };
    if (!Array.isArray(evidence?.passes) || evidence.passes.length < 2 ||
        !Number.isFinite(notBefore) || !Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) fail();
    let previousCompletedAt = null;
    let signature = null;
    let latest;
    for (const pass of evidence.passes) {
      if (pass?.complete !== true || pass?.accountVerified !== true) fail();
      const startedAt = pass?.readStartedAt;
      const completedAt = pass?.readCompletedAt;
      if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || startedAt < notBefore ||
          completedAt < startedAt || completedAt > now || now - startedAt > maxAgeMs ||
          (previousCompletedAt !== null && startedAt < previousCompletedAt)) fail();
      const inventory = validateSubmittedHistoryInventory(pass);
      if (pass.inventoryState !== inventory.inventoryState) fail();
      const currentSignature = `${inventory.pageCount}|${inventory.roles.map(role => role.jobId).sort().join("|")}`;
      if (signature !== null && signature !== currentSignature) fail();
      signature = currentSignature;
      previousCompletedAt = completedAt;
      latest = inventory;
    }
    const lastPass = evidence.passes[evidence.passes.length - 1];
    return { ...lastPass, ...latest, passes: evidence.passes,
      readStartedAt: evidence.passes[0].readStartedAt, readCompletedAt: lastPass.readCompletedAt };
  }

  const api = { workQuestionPolicy, jobIdFromUrl, matchesJob, isConfirmationUrl, validateSubmittedHistoryInventory,
    validateWithdrawalInventoryEvidence };
  root.CareerPeelerApplicationSafety = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
