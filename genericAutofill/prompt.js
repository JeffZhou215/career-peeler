// Bridge one bounded application question to the background resolver. It may return only answer_text
// or one exact observed option; loop.js keeps all DOM action/verification authority. If the resolver
// cannot answer, return null and let the submit guard block on the flagged field -- never fall back to
// a blocking native prompt dialog, which used to stall the whole sweep on an ordinary question.
(function () {
  const GA = window.__careerPeelerGA;
  const { normalizeText } = GA;

  async function askApplicationQuestionAgent({ questionText, options = [], fieldKind = "unknown" }) {
    const response = await chrome.runtime
      .sendMessage({
        type: "APPLE_CAREERS_RESOLVE_APPLICATION_QUESTION",
        questionText,
        options,
        fieldKind,
        pageTitle: document.title,
        siteLabel: window.location.hostname
      })
      .catch((error) => ({ ok: false, error: error?.message }));

    if (!response?.ok) {
      return null;
    }

    // `answer` is accepted only for backward compatibility with the old one-shot essay response while
    // an extension reload can leave an older service worker paired with this newly injected script.
    const action = response.data?.action || (response.data?.answer ? "answer_text" : "");
    const value = normalizeText(response.data?.value || response.data?.answer || "");
    return action && value ? { action, value, reason: response.data.reason || "" } : null;
  }

  // Backward-compatible narrow wrapper retained for the existing test API and any already-injected
  // copy of loop.js during an extension reload. New code calls askApplicationQuestionAgent directly.
  async function askLlmForAnswer(label) {
    const decision = await askApplicationQuestionAgent({
      questionText: label,
      fieldKind: "text"
    });

    return decision?.action === "answer_text" ? decision.value : null;
  }

  Object.assign(GA, { askApplicationQuestionAgent, askLlmForAnswer });
})();
