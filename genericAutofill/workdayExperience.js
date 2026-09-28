// Workday's repeated Work Experience/Education cards are structured records, not independent flat
// fields. This adapter still uses the generic engine's existing read/action primitives, but owns the
// row-level sequencing so an Add click is followed by a fresh row read before every write and a
// complete verification before the next record is created.
(function () {
  const GA = window.__careerPeelerGA;
  const {
    normalizeText,
    getActionLabel,
    getOptionLabel,
    isWorkdayHostname,
    commitWorkdayTextField,
    hasExplicitWorkdayFieldError,
    isFieldNowInvalid,
    simulateRealClick,
    openDropdownAndReadOptions,
    selectOpenedDropdownOption,
    closeWorkdayDropdownMenu,
    isDropdownValueConfirmed,
    waitForSettle
  } = GA;

  const WORKDAY_MY_EXPERIENCE_PAGE_SELECTOR = "[data-automation-id='applyFlowMyExpPage']";
  const WORKDAY_SECTION_CONFIG = {
    experience: {
      sectionLabel: "Work-Experience-section",
      rowPrefix: "Work-Experience-"
    },
    education: {
      sectionLabel: "Education-section",
      rowPrefix: "Education-"
    }
  };
  const MAX_WORKDAY_EXPERIENCE_ADDITIONS = 20;
  const MAX_WORKDAY_EDUCATION_ADDITIONS = 10;

  const MONTH_NUMBERS = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12
  };

  function parseWorkdayCandidateDate(value) {
    const text = normalizeText(value || "")
      .replace(/[.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) {
      return null;
    }
    if (/\b(?:present|current|currently|ongoing|now)\b/i.test(text)) {
      return { current: true, month: null, year: null };
    }

    let match = text.match(/^(\d{1,2})\s*[\/-]\s*(\d{4})$/);
    if (match) {
      const month = Number(match[1]);
      const year = Number(match[2]);
      return month >= 1 && month <= 12 ? { current: false, month, year } : null;
    }

    match = text.match(/^(\d{4})\s*[\/-]\s*(\d{1,2})(?:\s*[\/-]\s*\d{1,2})?$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      return month >= 1 && month <= 12 ? { current: false, month, year } : null;
    }

    match = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (match) {
      const month = MONTH_NUMBERS[match[1].toLowerCase()];
      return month ? { current: false, month, year: Number(match[2]) } : null;
    }

    return null;
  }

  function normalizeWorkdayIdentity(value) {
    return normalizeText(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function getWorkdayDegreeFamily(value) {
    const normalized = normalizeWorkdayIdentity(value).replace(/\bdegree\b/g, " ").replace(/\s+/g, " ").trim();
    if (/\b(?:phd|ph d|doctor|doctorate|doctoral)\b/.test(normalized)) return "doctorate";
    if (/\b(?:master|masters|ms|m s|ma|m a|meng|m eng|mba|m b a|mcs|m c s)\b/.test(normalized)) return "masters";
    if (/\b(?:bachelor|bachelors|bs|b s|ba|b a|beng|b eng|bcs|b c s)\b/.test(normalized)) return "bachelors";
    if (/\b(?:associate|associates|aa|a a|as|a s)\b/.test(normalized)) return "associates";
    if (/\b(?:high school|secondary school|ged)\b/.test(normalized)) return "high_school";
    return normalized;
  }

  function doesWorkdayDegreeOptionMatch(degree, optionText) {
    const wantedFamily = getWorkdayDegreeFamily(degree);
    const optionFamily = getWorkdayDegreeFamily(optionText);
    if (!wantedFamily || !optionFamily) {
      return false;
    }
    if (["doctorate", "masters", "bachelors", "associates", "high_school"].includes(wantedFamily)) {
      return wantedFamily === optionFamily;
    }
    return optionFamily.includes(wantedFamily) || wantedFamily.includes(optionFamily);
  }

  function buildWorkdayRoleDescription(entry, maxLength = 4000) {
    const lines = [];
    const seen = new Set();
    const addLine = (value, prefix = "") => {
      const text = normalizeText(value || "").trim();
      const identity = normalizeWorkdayIdentity(text);
      if (!text || seen.has(identity)) {
        return;
      }
      seen.add(identity);
      lines.push(`${prefix}${text}`);
    };

    addLine(entry?.summary);
    for (const responsibility of entry?.responsibilities || []) {
      addLine(responsibility, "• ");
    }
    if (entry?.technologies?.length) {
      addLine(`Technologies: ${entry.technologies.join(", ")}`);
    }

    return lines.join("\n").slice(0, Math.max(0, maxLength));
  }

  function getWorkdaySection(kind) {
    const config = WORKDAY_SECTION_CONFIG[kind];
    const page = document.querySelector(WORKDAY_MY_EXPERIENCE_PAGE_SELECTOR);
    if (!page || !config) {
      return null;
    }
    return page.querySelector(`[role='group'][aria-labelledby='${config.sectionLabel}']`);
  }

  function getWorkdayRows(kind) {
    const config = WORKDAY_SECTION_CONFIG[kind];
    const section = getWorkdaySection(kind);
    if (!section || !config) {
      return [];
    }
    return Array.from(section.querySelectorAll("[role='group'][aria-labelledby$='-panel']")).filter((row) =>
      String(row.getAttribute("aria-labelledby") || "").startsWith(config.rowPrefix)
    );
  }

  function getWorkdayRow(kind, index) {
    return getWorkdayRows(kind)[index] || null;
  }

  function readInputValue(root, selector, maxLength = 500) {
    return String(root?.querySelector?.(selector)?.value || "").trim().slice(0, maxLength);
  }

  function readWorkdayDate(root, wrapperAutomationId) {
    const wrapper = root?.querySelector?.(`[data-automation-id='${wrapperAutomationId}']`);
    if (!wrapper) {
      return "";
    }
    const month = readInputValue(wrapper, "[data-automation-id='dateSectionMonth-input']");
    const year = readInputValue(wrapper, "[data-automation-id='dateSectionYear-input']");
    return month && year ? `${Number(month)}/${year}` : "";
  }

  function parseWorkdayRoleDescription(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((line) => normalizeText(line).replace(/^[•*\-–—]+\s*/, "").trim().slice(0, 1000))
      .filter(Boolean)
      .slice(0, 40);
  }

  function captureWorkdayExperienceEntries() {
    return getWorkdayRows("experience")
      .map((row) => {
        const currentControl = row.querySelector("[data-automation-id='formField-currentlyWorkHere'] input[type='checkbox']");
        const current = Boolean(currentControl?.checked || currentControl?.getAttribute?.("aria-checked") === "true");
        const description = readInputValue(row, "[data-automation-id='formField-roleDescription'] textarea", 8000);
        return {
          company: readInputValue(row, "[data-automation-id='formField-companyName'] input"),
          title: readInputValue(row, "[data-automation-id='formField-jobTitle'] input"),
          location: readInputValue(row, "[data-automation-id='formField-location'] input"),
          startDate: readWorkdayDate(row, "formField-startDate"),
          endDate: current ? "Present" : readWorkdayDate(row, "formField-endDate"),
          summary: "",
          responsibilities: parseWorkdayRoleDescription(description),
          technologies: []
        };
      })
      .filter((entry) => entry.company || entry.title);
  }

  function captureWorkdayEducationEntries() {
    return getWorkdayRows("education")
      .map((row) => {
        const degree = row.querySelector("[data-automation-id='formField-degree'] [aria-haspopup='listbox']");
        return {
          institution: readInputValue(row, "[data-automation-id='formField-schoolName'] input"),
          degree: normalizeText(degree?.innerText || ""),
          field: readInputValue(row, "[data-automation-id='formField-fieldOfStudy'] input"),
          gradeAverage: readInputValue(row, "[data-automation-id='formField-gradeAverage'] input"),
          startDate: readWorkdayDate(row, "formField-startDate"),
          endDate: readWorkdayDate(row, "formField-endDate")
        };
      })
      .filter((entry) => entry.institution || entry.degree);
  }

  function captureWorkdayCandidateProfile() {
    if (!isWorkdayHostname(window.location.hostname) || !document.querySelector(WORKDAY_MY_EXPERIENCE_PAGE_SELECTOR)) {
      return { experience: [], education: [] };
    }
    return {
      experience: captureWorkdayExperienceEntries(),
      education: captureWorkdayEducationEntries()
    };
  }

  function workdayExperienceEntriesMatch(left, right) {
    return (
      Boolean(normalizeWorkdayIdentity(left?.company)) &&
      normalizeWorkdayIdentity(left?.company) === normalizeWorkdayIdentity(right?.company) &&
      Boolean(normalizeWorkdayIdentity(left?.title)) &&
      normalizeWorkdayIdentity(left?.title) === normalizeWorkdayIdentity(right?.title)
    );
  }

  function workdayEducationEntriesMatch(left, right) {
    const institution = normalizeWorkdayIdentity(left?.institution);
    if (!institution || institution !== normalizeWorkdayIdentity(right?.institution)) {
      return false;
    }
    const leftDegree = getWorkdayDegreeFamily(left?.degree);
    const rightDegree = getWorkdayDegreeFamily(right?.degree);
    return Boolean(leftDegree && rightDegree && leftDegree === rightDegree);
  }

  function findWorkdayAddButton(kind) {
    const section = getWorkdaySection(kind);
    return (
      Array.from(section?.querySelectorAll?.("button") || []).find((button) =>
        /^(?:add|add another)$/i.test(normalizeText(getActionLabel(button)))
      ) || null
    );
  }

  async function addWorkdayRow(kind) {
    const previousCount = getWorkdayRows(kind).length;
    const addButton = findWorkdayAddButton(kind);
    if (!addButton) {
      return null;
    }
    simulateRealClick(addButton);
    await waitForSettle();
    const rows = getWorkdayRows(kind);
    return rows.length === previousCount + 1 ? { index: rows.length - 1, previousCount } : null;
  }

  async function removeNewWorkdayRow(kind, index, previousCount) {
    const rows = getWorkdayRows(kind);
    if (rows.length !== previousCount + 1 || !rows[index]) {
      return false;
    }
    const deleteButton = Array.from(rows[index].querySelectorAll("button")).find(
      (button) => /^delete$/i.test(normalizeText(getActionLabel(button)))
    );
    if (!deleteButton) {
      return false;
    }
    simulateRealClick(deleteButton);
    await waitForSettle();
    return getWorkdayRows(kind).length === previousCount;
  }

  async function fillWorkdayRowText(kind, index, selector, value) {
    if (!value) {
      return true;
    }
    const input = getWorkdayRow(kind, index)?.querySelector(selector);
    if (!input) {
      return false;
    }
    const maxLength = Number(input.maxLength);
    const wanted = maxLength > 0 ? String(value).slice(0, maxLength) : String(value);
    const commit = await commitWorkdayTextField(input, wanted);
    const verifiedInput = getWorkdayRow(kind, index)?.querySelector(selector);
    return Boolean(
      commit.ok &&
        verifiedInput &&
        String(verifiedInput.value || "") === wanted &&
        !(await isFieldNowInvalid(verifiedInput))
    );
  }

  async function fillWorkdayRowDate(kind, index, wrapperAutomationId, date) {
    if (!date || date.current) {
      return false;
    }
    const row = getWorkdayRow(kind, index);
    const wrapper = row?.querySelector(`[data-automation-id='${wrapperAutomationId}']`);
    const monthInput = wrapper?.querySelector("[data-automation-id='dateSectionMonth-input']");
    const yearInput = wrapper?.querySelector("[data-automation-id='dateSectionYear-input']");
    if (!monthInput || !yearInput) {
      return false;
    }
    const monthCommit = await commitWorkdayTextField(monthInput, String(date.month));
    const refreshedWrapper = getWorkdayRow(kind, index)?.querySelector(`[data-automation-id='${wrapperAutomationId}']`);
    const refreshedYearInput = refreshedWrapper?.querySelector("[data-automation-id='dateSectionYear-input']");
    if (!monthCommit.ok || !refreshedYearInput) {
      return false;
    }
    const yearCommit = await commitWorkdayTextField(refreshedYearInput, String(date.year));
    return Boolean(yearCommit.ok && (await verifyWorkdayRowDate(kind, index, wrapperAutomationId, date)));
  }

  function rowHasRequiredDate(kind, index, wrapperAutomationId) {
    const wrapper = getWorkdayRow(kind, index)?.querySelector(`[data-automation-id='${wrapperAutomationId}']`);
    return Boolean(wrapper?.querySelector("abbr") || wrapper?.querySelector("[aria-required='true']"));
  }

  async function verifyRequiredTextInput(kind, index, selector, wantedValue) {
    const input = getWorkdayRow(kind, index)?.querySelector(selector);
    return Boolean(input && String(input.value || "") === wantedValue && !(await isFieldNowInvalid(input)));
  }

  async function verifyWorkdayRowDate(kind, index, wrapperAutomationId, date) {
    const wrapper = getWorkdayRow(kind, index)?.querySelector(`[data-automation-id='${wrapperAutomationId}']`);
    const monthInput = wrapper?.querySelector("[data-automation-id='dateSectionMonth-input']");
    const yearInput = wrapper?.querySelector("[data-automation-id='dateSectionYear-input']");
    if (!date || date.current || !monthInput || !yearInput) {
      return false;
    }

    const stateChecks = [];
    if (monthInput.hasAttribute?.("aria-valuenow")) {
      stateChecks.push(Number(monthInput.getAttribute("aria-valuenow")) === date.month);
    }
    if (yearInput.hasAttribute?.("aria-valuenow")) {
      stateChecks.push(Number(yearInput.getAttribute("aria-valuenow")) === date.year);
    }
    const monthDisplay = wrapper.querySelector("[data-automation-id='dateSectionMonth-display']");
    const yearDisplay = wrapper.querySelector("[data-automation-id='dateSectionYear-display']");
    if (monthDisplay) {
      stateChecks.push(Number(normalizeText(monthDisplay.textContent || "")) === date.month);
    }
    if (yearDisplay) {
      stateChecks.push(Number(normalizeText(yearDisplay.textContent || "")) === date.year);
    }
    const currentValue = Array.from(wrapper.querySelectorAll("[aria-hidden='true'][id^='helpText-']"))
      .map((element) => normalizeText(element.textContent || ""))
      .find((text) => /^current value is\b/i.test(text));
    if (currentValue) {
      stateChecks.push(new RegExp(`^current value is\\s+0?${date.month}/${date.year}$`, "i").test(currentValue));
    }

    return Boolean(
      Number(monthInput.value) === date.month &&
        Number(yearInput.value) === date.year &&
        stateChecks.length > 0 &&
        stateChecks.every(Boolean) &&
        !(await isFieldNowInvalid(monthInput)) &&
        !(await isFieldNowInvalid(yearInput))
    );
  }

  async function recommitRejectedWorkdayStructuredFields() {
    const controls = [...getWorkdayRows("experience"), ...getWorkdayRows("education")]
      .flatMap((row) => Array.from(row.querySelectorAll("input, textarea")))
      .filter((element) => !["checkbox", "radio", "hidden", "file"].includes(String(element.type || "").toLowerCase()))
      .filter((element) => Boolean(String(element.value || "").trim()) && hasExplicitWorkdayFieldError(element));
    let repaired = 0;
    let failed = 0;

    for (const original of controls) {
      const element = original.id ? document.getElementById(original.id) : original;
      if (!element?.isConnected) {
        failed += 1;
        continue;
      }
      const wanted = String(element.value || "");
      const commit = await commitWorkdayTextField(element, wanted);
      const verifiedElement = original.id ? document.getElementById(original.id) : element;
      if (
        commit.ok &&
        verifiedElement?.isConnected &&
        String(verifiedElement.value || "") === wanted &&
        !(await isFieldNowInvalid(verifiedElement))
      ) {
        repaired += 1;
      } else {
        failed += 1;
      }
    }

    return { attempted: controls.length, repaired, failed };
  }

  async function fillWorkdayExperienceEntry(index, entry) {
    const startDate = parseWorkdayCandidateDate(entry.startDate);
    const endDate = parseWorkdayCandidateDate(entry.endDate);
    if (!entry.company || !entry.title || !startDate || (!endDate && !/\b(?:present|current|ongoing|now)\b/i.test(entry.endDate || ""))) {
      return false;
    }

    const titleWritten = await fillWorkdayRowText(
      "experience",
      index,
      "[data-automation-id='formField-jobTitle'] input",
      entry.title
    );
    const companyWritten = await fillWorkdayRowText(
      "experience",
      index,
      "[data-automation-id='formField-companyName'] input",
      entry.company
    );
    await fillWorkdayRowText("experience", index, "[data-automation-id='formField-location'] input", entry.location);
    const startWritten = await fillWorkdayRowDate("experience", index, "formField-startDate", startDate);
    if (!titleWritten || !companyWritten || !startWritten) {
      return false;
    }

    const current = Boolean(endDate?.current);
    if (current) {
      const checkbox = getWorkdayRow("experience", index)?.querySelector(
        "[data-automation-id='formField-currentlyWorkHere'] input[type='checkbox']"
      );
      if (!checkbox) {
        return false;
      }
      if (!checkbox.checked) {
        simulateRealClick(checkbox);
      }
    } else {
      if (!(await fillWorkdayRowDate("experience", index, "formField-endDate", endDate))) {
        return false;
      }
    }

    const descriptionInput = getWorkdayRow("experience", index)?.querySelector(
      "[data-automation-id='formField-roleDescription'] textarea"
    );
    const description = buildWorkdayRoleDescription(entry, descriptionInput?.maxLength > 0 ? descriptionInput.maxLength : 4000);
    await fillWorkdayRowText("experience", index, "[data-automation-id='formField-roleDescription'] textarea", description);
    await waitForSettle();

    const titleOk = await verifyRequiredTextInput(
      "experience",
      index,
      "[data-automation-id='formField-jobTitle'] input",
      entry.title
    );
    const companyOk = await verifyRequiredTextInput(
      "experience",
      index,
      "[data-automation-id='formField-companyName'] input",
      entry.company
    );
    const startOk = await verifyWorkdayRowDate("experience", index, "formField-startDate", startDate);
    const endOk = current
      ? Boolean(
          getWorkdayRow("experience", index)?.querySelector(
            "[data-automation-id='formField-currentlyWorkHere'] input[type='checkbox']"
          )?.checked
        )
      : await verifyWorkdayRowDate("experience", index, "formField-endDate", endDate);
    return titleOk && companyOk && startOk && endOk;
  }

  async function chooseWorkdayDegree(index, degree) {
    const trigger = getWorkdayRow("education", index)?.querySelector(
      "[data-automation-id='formField-degree'] [aria-haspopup='listbox']"
    );
    if (!trigger) {
      return false;
    }
    const candidateOptions = await openDropdownAndReadOptions(trigger);
    const selection = await selectOpenedDropdownOption(candidateOptions, (optionText) =>
      doesWorkdayDegreeOptionMatch(degree, optionText)
    );
    const selectedLabel = normalizeText(getOptionLabel(selection.clickedOption));
    const selectedTrigger =
      getWorkdayRow("education", index)?.querySelector(
        "[data-automation-id='formField-degree'] [aria-haspopup='listbox']"
      ) || trigger;
    await closeWorkdayDropdownMenu(selectedTrigger, candidateOptions);
    // Workday often replaces the entire degree-field subtree after a selection. Verify the trigger
    // from the current row, not the pre-click node, or a successful choice can be misreported merely
    // because React detached the old button.
    const verifiedTrigger =
      getWorkdayRow("education", index)?.querySelector(
        "[data-automation-id='formField-degree'] [aria-haspopup='listbox']"
      ) || selectedTrigger;
    return Boolean(
      selection.clickedOption &&
        selectedLabel &&
        (await isDropdownValueConfirmed(verifiedTrigger, selectedLabel)) &&
        doesWorkdayDegreeOptionMatch(degree, verifiedTrigger.innerText || selectedLabel)
    );
  }

  async function fillWorkdayEducationEntry(index, entry) {
    if (!entry.institution || !entry.degree) {
      return false;
    }
    const startDate = parseWorkdayCandidateDate(entry.startDate);
    const endDate = parseWorkdayCandidateDate(entry.endDate);
    if (
      (rowHasRequiredDate("education", index, "formField-startDate") && !startDate) ||
      (rowHasRequiredDate("education", index, "formField-endDate") && !endDate)
    ) {
      return false;
    }

    if (!(await fillWorkdayRowText("education", index, "[data-automation-id='formField-schoolName'] input", entry.institution))) {
      return false;
    }
    if (!(await chooseWorkdayDegree(index, entry.degree))) {
      return false;
    }
    await fillWorkdayRowText("education", index, "[data-automation-id='formField-fieldOfStudy'] input", entry.field);
    await fillWorkdayRowText("education", index, "[data-automation-id='formField-gradeAverage'] input", entry.gradeAverage);
    if (startDate && !startDate.current) {
      const startWritten = await fillWorkdayRowDate("education", index, "formField-startDate", startDate);
      if (rowHasRequiredDate("education", index, "formField-startDate") && !startWritten) {
        return false;
      }
    }
    if (endDate && !endDate.current) {
      const endWritten = await fillWorkdayRowDate("education", index, "formField-endDate", endDate);
      if (rowHasRequiredDate("education", index, "formField-endDate") && !endWritten) {
        return false;
      }
    }
    await waitForSettle();

    const institutionOk = await verifyRequiredTextInput(
      "education",
      index,
      "[data-automation-id='formField-schoolName'] input",
      entry.institution
    );
    const degreeTrigger = getWorkdayRow("education", index)?.querySelector(
      "[data-automation-id='formField-degree'] [aria-haspopup='listbox']"
    );
    const degreeOk = Boolean(
      degreeTrigger?.getAttribute?.("value") && doesWorkdayDegreeOptionMatch(entry.degree, degreeTrigger.innerText || "")
    );
    const startOk = !rowHasRequiredDate("education", index, "formField-startDate") ||
      (await verifyWorkdayRowDate("education", index, "formField-startDate", startDate));
    const endOk = !rowHasRequiredDate("education", index, "formField-endDate") ||
      (await verifyWorkdayRowDate("education", index, "formField-endDate", endDate));
    return institutionOk && degreeOk && startOk && endOk;
  }

  async function autofillWorkdayExperiencePage(profile, { pushActivityStep, logTrace } = {}) {
    const emptyResult = {
      handled: false,
      filledFields: [],
      flaggedFields: [],
      repairedRejectedFieldCount: 0,
      observedCandidateProfile: { experience: [], education: [] }
    };
    if (!isWorkdayHostname(window.location.hostname) || !document.querySelector(WORKDAY_MY_EXPERIENCE_PAGE_SELECTOR)) {
      return emptyResult;
    }

    const result = { ...emptyResult, handled: true, filledFields: [], flaggedFields: [] };
    const rejectedFieldRepair = await recommitRejectedWorkdayStructuredFields();
    if (rejectedFieldRepair.attempted > 0) {
      if (rejectedFieldRepair.failed > 0) {
        result.flaggedFields.push({
          label: "Workday Required Fields",
          reason: `${rejectedFieldRepair.failed} visible Workday value(s) remained rejected after one staged input retry; please review them before continuing.`
        });
        await pushActivityStep?.(
          "verify",
          "Workday Required Fields",
          "error",
          `${rejectedFieldRepair.failed} value(s) remained rejected after staged input retry`
        );
      } else {
        result.repairedRejectedFieldCount = rejectedFieldRepair.repaired;
        await pushActivityStep?.(
          "verify",
          "Workday Required Fields",
          "success",
          `re-entered ${rejectedFieldRepair.repaired} rejected value(s) through Workday-compatible input events`
        );
      }
    }
    let observedExperience = captureWorkdayExperienceEntries();
    let experienceAdditions = 0;
    for (const entry of profile?.candidateProfile?.experience || []) {
      if (observedExperience.some((observed) => workdayExperienceEntriesMatch(entry, observed))) {
        continue;
      }
      const startDate = parseWorkdayCandidateDate(entry.startDate);
      const endDate = parseWorkdayCandidateDate(entry.endDate);
      if (!entry.company || !entry.title || !startDate || !endDate) {
        logTrace?.(`Skipped one CandidateProfile work-experience entry because Workday's required company, title, or month/year dates were missing.`);
        continue;
      }
      if (experienceAdditions >= MAX_WORKDAY_EXPERIENCE_ADDITIONS) {
        logTrace?.(`Stopped adding Workday experience entries at the ${MAX_WORKDAY_EXPERIENCE_ADDITIONS}-entry sweep cap.`);
        break;
      }

      const added = await addWorkdayRow("experience");
      if (!added) {
        logTrace?.("Could not create another Workday work-experience row.");
        break;
      }
      const filled = await fillWorkdayExperienceEntry(added.index, entry);
      if (!filled) {
        const removed = await removeNewWorkdayRow("experience", added.index, added.previousCount);
        if (!removed) {
          result.flaggedFields.push({
            label: "Work Experience",
            reason: "A new Workday work-experience row could not be completed or safely removed; please review it before continuing."
          });
          await pushActivityStep?.("type", "Work Experience", "error", "new row could not be completed or safely removed");
          break;
        }
        logTrace?.("Skipped one Workday work-experience entry after its required values could not be verified; the incomplete new row was removed.");
        continue;
      }

      experienceAdditions += 1;
      result.filledFields.push({ label: "Work Experience", value: "Added and verified one structured entry" });
      await pushActivityStep?.("type", "Work Experience", "success", "added and verified one structured entry");
      observedExperience = captureWorkdayExperienceEntries();
    }

    let observedEducation = captureWorkdayEducationEntries();
    let educationAdditions = 0;
    for (const entry of profile?.candidateProfile?.education || []) {
      if (observedEducation.some((observed) => workdayEducationEntriesMatch(entry, observed))) {
        continue;
      }
      if (!entry.institution || !entry.degree) {
        logTrace?.("Skipped one CandidateProfile education entry because Workday's required school or degree was missing.");
        continue;
      }
      if (educationAdditions >= MAX_WORKDAY_EDUCATION_ADDITIONS) {
        logTrace?.(`Stopped adding Workday education entries at the ${MAX_WORKDAY_EDUCATION_ADDITIONS}-entry sweep cap.`);
        break;
      }

      const added = await addWorkdayRow("education");
      if (!added) {
        logTrace?.("Could not create another Workday education row.");
        break;
      }
      const filled = await fillWorkdayEducationEntry(added.index, entry);
      if (!filled) {
        const removed = await removeNewWorkdayRow("education", added.index, added.previousCount);
        if (!removed) {
          result.flaggedFields.push({
            label: "Education",
            reason: "A new Workday education row could not be completed or safely removed; please review it before continuing."
          });
          await pushActivityStep?.("select", "Education", "error", "new row could not be completed or safely removed");
          break;
        }
        logTrace?.("Skipped one Workday education entry after its required values could not be verified; the incomplete new row was removed.");
        continue;
      }

      educationAdditions += 1;
      result.filledFields.push({ label: "Education", value: "Added and verified one structured entry" });
      await pushActivityStep?.("select", "Education", "success", "added and verified one structured entry");
      observedEducation = captureWorkdayEducationEntries();
    }

    result.observedCandidateProfile = captureWorkdayCandidateProfile();
    return result;
  }

  Object.assign(GA, {
    parseWorkdayCandidateDate,
    getWorkdayDegreeFamily,
    doesWorkdayDegreeOptionMatch,
    buildWorkdayRoleDescription,
    workdayExperienceEntriesMatch,
    workdayEducationEntriesMatch,
    captureWorkdayCandidateProfile,
    autofillWorkdayExperiencePage
  });
})();
