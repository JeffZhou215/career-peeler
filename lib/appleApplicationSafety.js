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

  const api = { workQuestionPolicy, jobIdFromUrl, matchesJob, isConfirmationUrl };
  root.CareerPeelerApplicationSafety = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
