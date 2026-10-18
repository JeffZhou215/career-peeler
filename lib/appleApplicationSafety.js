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

  function normalizeApplicationQuestionKey(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function normalizeApplicationQuestionAnswers(value) {
    const answers = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return answers;
    for (const [question, answer] of Object.entries(value).slice(0, 100)) {
      const key = normalizeApplicationQuestionKey(question);
      const normalized = String(answer || "").trim().toLowerCase();
      if (key && key.length <= 500 && ["yes", "no"].includes(normalized)) {
        Object.defineProperty(answers, key, { value: normalized, enumerable: true, configurable: true, writable: true });
      }
    }
    return answers;
  }

  function normalizeSavedStartDate(value) {
    const text = String(value || "").trim();
    if (text === "immediate") return text;
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match || Number(match[1]) < 1900) return "";
    const date = new Date(`${text}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : "";
  }

  function isSavedStartDateCurrent(value, currentDate = new Date()) {
    const saved = normalizeSavedStartDate(value);
    if (!saved) return false;
    if (saved === "immediate") return true;
    const now = currentDate instanceof Date ? currentDate : new Date(currentDate);
    if (!Number.isFinite(now.getTime())) return false;
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return saved >= today;
  }

  function findSavedStartDateOption(options, desiredAnswer, currentDate = new Date()) {
    if (!isSavedStartDateCurrent(desiredAnswer, currentDate)) return null;
    const matches = (Array.isArray(options) ? options : []).filter(option => {
      const text = String(option || "").replace(/\s+/g, " ").trim();
      if (desiredAnswer === "immediate") return /^(?:immediately|as soon as possible|asap|right away|now)[.!]?$/i.test(text);
      if (text === desiredAnswer) return true;
      // Only unambiguous English dates with an explicit year. Numeric dates are locale-sensitive.
      const match = text.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i);
      if (!match) return false;
      const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
      const offered = `${match[3]}-${String(months.indexOf(match[1].toLowerCase()) + 1).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
      return normalizeSavedStartDate(offered) === desiredAnswer;
    });
    return matches.length === 1 ? String(matches[0]).replace(/\s+/g, " ").trim() : null;
  }

  function applicationQuestionPolicy(questionText, profile = {}, currentDate = new Date()) {
    const text = normalizeApplicationQuestionKey(questionText);
    const workPolicy = workQuestionPolicy(questionText, profile);
    if (workPolicy) return workPolicy;
    // EEO answers have their own explicit scalar/multi-select settings and option mapping.
    if (/\b(?:gender|race|ethnicity|ethnic origin|veteran|disabilit(?:y|ies))\b/.test(text)) return null;
    const exact = normalizeApplicationQuestionAnswers(profile.applicationQuestionAnswers)[text];
    const personalAnswer = (policyKey, key, simple, label) => {
      const answer = exact || (simple ? String(profile[key] || "").trim().toLowerCase() : "");
      if (!["yes", "no"].includes(answer)) return { policyKey,
        error: `Save an explicit ${simple ? label : "answer for this exact question"} in Setup, or review this question manually.` };
      return { policyKey, desiredAnswer: answer === "yes" ? "Yes" : "No", source: "saved_profile", sensitive: true };
    };
    const age = /\b(?:\d+\s+years\s+(?:(?:of\s+)?age|old|or older)|at least\s+\d+\s+years|age\s+(?:of\s+)?\d+|(?:under|over|older than|younger than|at least)\s+\d+|\d+\s+or\s+(?:older|younger))\b/.test(text);
    if (age) {
      const simple = /^(?:are you\s+)?(?:18 years of age or older|at least 18 years(?: old| of age)?)[?.]?$/i.test(text);
      return personalAnswer("age_eligibility", "ageOver18", simple, "18-Or-Older answer");
    }
    const previousEmployer = (/\b(?:ever|previously|before|in the past|former(?:ly)?|currently|have you|are you|were you)\b/.test(text) &&
      /\b(?:work(?:ed)? (?:for|at)|employ(?:ed|ee|ment)|provided services|contractor|consultant|contingent worker|agency worker)\b/.test(text)) ||
      (/\bapple\b/.test(text) && /\b(?:temporary|agency|independent|contractor|contingent)\b/.test(text));
    if (previousEmployer) {
      const simple = /^(?:have you ever been employed by apple|have you ever worked for apple as an employee|were you previously employed by apple)[?.]?$/.test(text);
      return personalAnswer("previous_apple_employment", "previousAppleEmployment", simple, "previous Apple employment answer");
    }
    // Criminal questions differ in scope (arrest, conviction, jurisdiction, time range). Only an
    // explicitly saved answer to this exact wording can resolve them; a broad resume fact cannot.
    if (/\bcriminal (?:history|record|offen[cs]e)\b|\b(?:convicted|conviction|felony|misdemeanor)\b|\b(?:ever|previously)\b.{0,50}\b(?:arrested|charged)\b|\b(?:found|pleaded|pled) guilty\b/.test(text)) {
      return personalAnswer("criminal_history", "", false, "criminal-history answer");
    }
    const startDate = /\b(?:earliest|available|availability)\b.*\b(?:date|start|begin)\b|\bwhen (?:can you start|are you available|will you be available)\b|\b(?:preferred|desired|your) start date\b|\bwhat date can you start\b/.test(text);
    const binaryStart = /^(?:are|can|could|would|will|do)\s+you\b.*\b(?:start|begin)\b/.test(text);
    if (startDate || binaryStart || /\bstart date\b/.test(text)) {
      if (binaryStart || /\b(?:and|or)\s+(?:are|do|will|can|would|have)\s+you\b/.test(text)) {
        return personalAnswer("availability_confirmation", "", false, "availability answer");
      }
      if (!startDate) return { policyKey: "earliest_start_date",
        error: "Review this date manually; the field does not identify application availability unambiguously." };
      const desiredAnswer = normalizeSavedStartDate(profile.availableStartDate);
      if (!isSavedStartDateCurrent(desiredAnswer, currentDate)) return { policyKey: "earliest_start_date",
        error: "Save an explicit, current start date or Immediately in Setup, or review this question manually." };
      return { policyKey: "earliest_start_date", desiredAnswer, source: "saved_profile", sensitive: true };
    }
    if (exact) return personalAnswer("saved_question", "", false, "answer for this exact question");
    // Binary screening answers require the user's choice even when they concern a topic not
    // represented by a dedicated setting. Essay prompts can still use grounded LLM drafting.
    const binaryScreening = /^(?:are|do|have|would|will|can|could|did|were|should)\s+you\b/.test(text);
    const essayPrompt = /\b(?:describe|explain|discuss|summari[sz]e|tell us|share (?:an? |your )?(?:example|experience|story)|provide (?:an? )?(?:example|overview)|why|how)\b/.test(text);
    if (binaryScreening && !essayPrompt) return personalAnswer("saved_question", "", false, "answer for this exact question");
    return null;
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

  // Verified Apple job-detail markup. The base-only version of these controls
  // is not evidence for a reviewed suffixed role: every identifier stays exact.
  function submittedControlEvidence(expectedJobId, value) {
    const text = item => typeof item === "string" ? item.replace(/\s+/g, " ").trim() : "";
    const ids = ["jobdetails-jobdetails-jobdetailheader-actions-jobdetailssubmitresume",
      "jobdetails-jobdetails-jobdetailfooter-actions-jobdetailssubmitresume"];
    if (!value || !matchesJob(expectedJobId, value.url) ||
        !/^\/[a-z]{2}-[a-z]{2}\/details\//i.test(new URL(value.url).pathname) ||
        value.authenticated !== true || text(value.roleNumber) !== String(expectedJobId) ||
        !text(value.title) || !Array.isArray(value.controls) || value.controls.length !== ids.length) return null;
    const title = text(value.title);
    const label = `Submitted: ${title} ${expectedJobId}`;
    for (const id of ids) {
      const controls = value.controls.filter(control => control?.id === id);
      const control = controls[0];
      if (controls.length !== 1 || control.tagName !== "A" || control.role !== "link" ||
          control.ariaDisabled !== "true" || control.tabIndex !== "-1" || control.href !== null ||
          control.disabledClass !== true || control.visible !== true || control.connected !== true ||
          text(control.text) !== "Submitted" || text(control.ariaLabel) !== label) return null;
    }
    return { jobId: String(expectedJobId), title, text: label, source: "apple_submitted_controls" };
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

  const api = { workQuestionPolicy, applicationQuestionPolicy, normalizeApplicationQuestionKey,
    normalizeApplicationQuestionAnswers, normalizeSavedStartDate, isSavedStartDateCurrent, findSavedStartDateOption,
    jobIdFromUrl, matchesJob, isConfirmationUrl, submittedControlEvidence, validateSubmittedHistoryInventory,
    validateWithdrawalInventoryEvidence };
  root.CareerPeelerApplicationSafety = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
