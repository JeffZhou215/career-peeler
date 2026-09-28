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
// Unlike Pie, the LLM never receives DOM handles/selectors and cannot issue arbitrary browser actions.
// loop.js keeps deterministic mappings first; for an unresolved application question it serializes
// only the question plus offered option text, receives a typed answer_text/choose_option decision, and
// locally executes + verifies that bounded action against the fresh snapshot.
(function () {
  const GA = window.__careerPeelerGA;
  const {
    isElementVisible,
    isActionDisabled,
    getFieldKind,
    getElementLabel,
    isRequiredField,
    isQuestionControlRequired,
    isWorkdayHostname,
    isWorkdayDropdownStatusLabel,
    findAllQuestionContainers,
    getOptionControls,
    getQuestionLabel,
    findResumeFileInput
  } = GA;

  // Selector shared between the field-exclusion and dropdown-detection passes. Some Workday tenants
  // expose a multiSelectContainer whose search input has no combobox role; without the structural
  // selector, its filter text is mistaken for the actual saved answer even though Workday says
  // "0 items selected."
  const DROPDOWN_LIKE_SELECTOR =
    "[role='combobox'], [role='listbox'], [aria-haspopup='listbox'], [data-automation-id='multiSelectContainer']";

  function isWorkdayDropdownMenuElement(element) {
    return (
      isWorkdayHostname(window.location.hostname) &&
      element.getAttribute?.("role") === "listbox" &&
      Boolean(element.querySelector?.("[role='option']"))
    );
  }

  // Workday single-selects render a real button and a sibling <input type="text"> that stores the
  // selected option's opaque ID. The backing input can have non-zero geometry even though it is not a
  // user-editable text field, so visibility checks alone misclassify it and the sweep tries to TYPE a
  // profile value into it after already handling the real dropdown. Treat a direct sibling of a
  // listbox trigger as part of that dropdown instead. This is structural rather than CSS-class based,
  // so it works across tenants whose generated class names differ.
  function isDropdownBackingInput(element) {
    if (element.tagName?.toLowerCase() !== "input") {
      return false;
    }
    if (element.closest?.(DROPDOWN_LIKE_SELECTOR)) {
      return true;
    }
    return Boolean(element.parentElement?.querySelector?.(":scope > [aria-haspopup='listbox']"));
  }

  function snapshotPage() {
    const entries = [];

    const fieldElements = Array.from(document.querySelectorAll("input, select, textarea"))
      .filter((element) => isElementVisible(element))
      .filter((element) => !isActionDisabled(element))
      // A custom combobox's own typing/filter surface is very often a real <input> (or, less
      // commonly, has role="combobox" directly on it) -- without this exclusion it gets picked up
      // AGAIN here as an ordinary text field, and inferGenericFieldMapping/fillTextField would type
      // arbitrary profile text straight into what's actually only a filter box for a fixed option
      // list. closest() also matches the element itself, not just ancestors, so this covers both the
      // "input nested inside a combobox wrapper" and "role=combobox is on the input itself" shapes.
      .filter((element) => !isDropdownBackingInput(element));

    for (const element of fieldElements) {
      const fieldKind = getFieldKind(element);

      if (["hidden", "submit", "button", "reset", "radio", "file"].includes(fieldKind)) {
        continue; // radio groups and file inputs get their own entry types below
      }
      if (fieldKind === "checkbox") {
        const group = element.closest("fieldset, [role='group'], [data-form-field-id], [data-form-field-i18n-name]");
        const groupedOptions = group?.querySelectorAll?.("input[type='checkbox'], [role='checkbox']") || [];
        if (groupedOptions.length >= 2) {
          continue;
        }
      }

      const label = getElementLabel(element);
      entries.push({
        type: "field",
        element,
        label,
        fieldKind,
        required: isRequiredField(element, label),
        questionRequired: isQuestionControlRequired(element, label)
      });
    }

    for (const container of findAllQuestionContainers()) {
      const options = getOptionControls(container);
      const label = getQuestionLabel(container, options);
      entries.push({
        type: "question",
        element: container,
        label,
        options,
        required: isQuestionControlRequired(container, label)
      });
    }

    const allDropdownLikeElements = Array.from(document.querySelectorAll(DROPDOWN_LIKE_SELECTOR)).filter((element) =>
      isElementVisible(element)
    );
    const topLevelDropdowns = allDropdownLikeElements.filter(
      (element) => !allDropdownLikeElements.some((other) => other !== element && other.contains(element))
    );
    for (const dropdown of topLevelDropdowns) {
      if (isWorkdayDropdownMenuElement(dropdown)) {
        continue;
      }
      const label = getElementLabel(dropdown);
      if (isWorkdayHostname(window.location.hostname) && isWorkdayDropdownStatusLabel(label)) {
        continue;
      }
      entries.push({
        type: "dropdown",
        element: dropdown,
        label,
        required: isQuestionControlRequired(dropdown, label)
      });
    }

    const resumeInput = findResumeFileInput();
    if (resumeInput) {
      entries.push({ type: "file", element: resumeInput, label: getElementLabel(resumeInput) });
    }

    return entries;
  }

  Object.assign(GA, { snapshotPage, isWorkdayDropdownMenuElement, isDropdownBackingInput });
})();
