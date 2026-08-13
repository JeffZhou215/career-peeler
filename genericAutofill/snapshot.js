// Snapshot: read the whole page once.
//
// Modeled on Pie's extractPageContentHardened -- "snapshot is the central read primitive": a single,
// self-contained upfront pass walks every relevant interactive element and returns a structured
// list, which loop.js then classifies and acts on. Previously, fields, questions, and dropdowns were
// each discovered by separate, repeated DOM queries scattered through one big function (worse:
// question containers were searched once PER matching rule) -- collapsing that into one read phase
// means every element is found exactly once, in exactly one place, which is also what makes the
// trace log's snapshot line ("N fields, N questions, ...") an honest summary of what the sweep is
// about to do, not just a running commentary on scattered queries.
//
// Unlike Pie, this snapshot is never handed to an LLM to decide actions from -- decisions in loop.js
// stay deterministic (pattern-based classification, same as before), with the LLM used only for the
// narrow, already-established case of drafting free-text answers. See the plan doc for why: an LLM
// autonomously deciding which button to click on a job application is a materially different risk
// than one drafting a paragraph a human then reviews before submitting.
(function () {
  const GA = window.__careerPeelerGA;
  const {
    isElementVisible,
    isActionDisabled,
    getFieldKind,
    getElementLabel,
    isRequiredField,
    findAllQuestionContainers,
    getOptionControls,
    getQuestionLabel,
    findResumeFileInput
  } = GA;

  function snapshotPage() {
    const entries = [];

    const fieldElements = Array.from(document.querySelectorAll("input, select, textarea"))
      .filter((element) => isElementVisible(element))
      .filter((element) => !isActionDisabled(element));

    for (const element of fieldElements) {
      const fieldKind = getFieldKind(element);

      if (["hidden", "submit", "button", "reset", "radio", "file"].includes(fieldKind)) {
        continue; // radio groups and file inputs get their own entry types below
      }

      const label = getElementLabel(element);
      entries.push({
        type: "field",
        element,
        label,
        fieldKind,
        required: isRequiredField(element, label)
      });
    }

    for (const container of findAllQuestionContainers()) {
      const options = getOptionControls(container);
      entries.push({
        type: "question",
        element: container,
        label: getQuestionLabel(container, options),
        options
      });
    }

    const allDropdownLikeElements = Array.from(
      document.querySelectorAll("[role='combobox'], [role='listbox'], [aria-haspopup='listbox']")
    ).filter((element) => isElementVisible(element));
    const topLevelDropdowns = allDropdownLikeElements.filter(
      (element) => !allDropdownLikeElements.some((other) => other !== element && other.contains(element))
    );
    for (const dropdown of topLevelDropdowns) {
      entries.push({ type: "dropdown", element: dropdown, label: getElementLabel(dropdown) });
    }

    const resumeInput = findResumeFileInput();
    if (resumeInput) {
      entries.push({ type: "file", element: resumeInput, label: getElementLabel(resumeInput) });
    }

    return entries;
  }

  Object.assign(GA, { snapshotPage });
})();
