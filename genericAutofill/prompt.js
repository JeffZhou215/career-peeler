// Ask the LLM to draft an answer for a free-text question, grounded in the user's saved resume/
// profile summary (see lib/core.js's generateFreeTextAnswer). If the LLM is disabled, unconfigured,
// or has nothing it can answer from, this returns null and the caller (loop.js) flags the field for
// manual review rather than filling it -- deliberately does NOT fall back to a blocking native popup
// dialog asking the user to type an answer. That used to stall the whole autofill sweep on one field
// just to ask the user something ordinary, and sites like Workday already surface their own
// validation error for anything required that's left blank, so there's nothing Career Peeler needs
// to ask for up front.
(function () {
  const GA = window.__careerPeelerGA;
  const { normalizeText } = GA;

  async function askLlmForAnswer(label) {
    const response = await chrome.runtime
      .sendMessage({
        type: "APPLE_CAREERS_GENERATE_ANSWER",
        questionText: label,
        pageTitle: document.title,
        siteLabel: window.location.hostname
      })
      .catch((error) => ({ ok: false, error: error?.message }));

    const llmAnswer = response?.ok ? normalizeText(response.data?.answer || "") : "";

    return llmAnswer || null;
  }

  Object.assign(GA, { askLlmForAnswer });
})();
