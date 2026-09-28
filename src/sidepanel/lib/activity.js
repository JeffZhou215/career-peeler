export function getActivityLinkUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch (_error) {
    return null;
  }
}

function normalizeCycleStatus(value) {
  return ["running", "success", "attention"].includes(value) ? value : "success";
}

function visibleSteps(steps) {
  return steps.filter((step) => !(step.tool === "done" && step.status === "success"));
}

function settlePendingSteps(steps, cycleStatus) {
  if (cycleStatus === "running") {
    return steps;
  }
  return steps.map((step) =>
    step.status === "pending"
      ? {
          ...step,
          status: cycleStatus === "attention" ? "error" : "success",
          observation:
            cycleStatus === "attention"
              ? step.tool === "submit_application"
                ? "Submit was clicked, but the outcome was not confirmed."
                : "The workflow stopped before this action was confirmed."
              : step.observation || "Completed."
        }
      : step
  );
}

function buildSetupView(cycle, steps, kind, suffix) {
  const hasError = steps.some((step) => step.status === "error");
  const hasPending = steps.some((step) => step.status === "pending");
  const status = hasError
    ? "attention"
    : hasPending || cycle.status === "running"
      ? "running"
      : normalizeCycleStatus(cycle.status);

  return {
    ...cycle,
    id: `${cycle.id}:${suffix}`,
    jobId: null,
    title: kind === "validation" ? "API Key Validation" : "Candidate Profile",
    url: null,
    status,
    outcome:
      status === "attention"
        ? "Needs Attention"
        : status === "running"
          ? kind === "validation"
            ? "Validating"
            : "Preparing"
          : kind === "validation"
            ? "Valid"
            : "Ready",
    steps
  };
}

function expandLegacySetupCycle(cycle, steps) {
  if (cycle.jobId !== "scan-setup" && cycle.title !== "Scan Setup") {
    return null;
  }

  const validationSteps = steps.filter((step) => step.tool === "validate_api_key");
  const profileSteps = steps.filter((step) => step.tool === "extract_resume_profile");
  const remainingSteps = steps.filter(
    (step) => step.tool !== "validate_api_key" && step.tool !== "extract_resume_profile"
  );
  const views = [];

  if (validationSteps.length) {
    views.push(buildSetupView(cycle, validationSteps, "validation", "validation"));
  }
  if (profileSteps.length) {
    views.push(buildSetupView(cycle, profileSteps, "profile", "profile"));
  }
  if (remainingSteps.length) {
    views.push({ ...cycle, status: normalizeCycleStatus(cycle.status), steps: remainingSteps });
  }

  return views;
}

function shouldStartLegacyJob(step, current) {
  if (step.tool === "read_job_description") {
    return true;
  }
  if (step.tool !== "evaluate_job_match" || !step.label) {
    return false;
  }
  if (!current || current.kind !== "job") {
    return true;
  }

  const currentUrl = getActivityLinkUrl(current.url);
  const nextUrl = getActivityLinkUrl(step.url);
  return Boolean(nextUrl && currentUrl && nextUrl !== currentUrl);
}

function inferLegacyOutcome(group, status) {
  if (status === "attention") {
    return "Needs Attention";
  }
  if (status === "running") {
    return group.steps.some((step) =>
      ["open_application", "type", "select", "click", "upload", "generate", "question_agent", "submit_application"].includes(
        step.tool
      )
    )
      ? "Applying"
      : "Reviewing";
  }
  if (group.kind === "validation") {
    return "Valid";
  }
  if (group.kind === "profile") {
    return "Ready";
  }

  const observationText = group.steps.map((step) => step.observation || "").join(" ").toLowerCase();
  if (/already (applied|submitted)/.test(observationText)) {
    return "Already Applied";
  }
  if (group.steps.some((step) => step.tool === "submit_application" && step.status === "success")) {
    return "Applied";
  }
  if (/hard skip|not applying|likely skip/.test(observationText)) {
    return "Skipped";
  }
  return group.kind === "job" ? "Reviewed" : "Complete";
}

function groupLegacySteps(activity, steps) {
  const groups = [];
  let current = null;

  const startGroup = (kind, title, url, step) => {
    current = {
      id: `legacy:${kind}:${groups.length + 1}:${step.id ?? groups.length + 1}`,
      kind,
      title,
      url: url || null,
      steps: []
    };
    groups.push(current);
  };

  for (const step of steps) {
    if (step.tool === "validate_api_key") {
      startGroup("validation", "API Key Validation", null, step);
    } else if (step.tool === "extract_resume_profile") {
      startGroup("profile", "Candidate Profile", null, step);
    } else if (shouldStartLegacyJob(step, current)) {
      startGroup("job", step.label || "Current Job", step.url, step);
    } else if (!current) {
      startGroup("activity", "Previous Activity", step.url, step);
    }

    current.steps.push(step);
    if (current.kind === "job") {
      current.title = current.title === "Current Job" && step.label ? step.label : current.title;
      current.url = current.url || step.url || null;
    }
  }

  return groups.map((group, index) => {
    const hasError = group.steps.some((step) => step.status === "error");
    const hasPending = group.steps.some((step) => step.status === "pending");
    const isCurrent = Boolean(activity.running) && index === groups.length - 1;
    const status = hasError ? "attention" : isCurrent ? "running" : hasPending ? "attention" : "success";
    return {
      id: group.id,
      title: group.title,
      url: group.url,
      status,
      outcome: inferLegacyOutcome(group, status),
      steps: settlePendingSteps(visibleSteps(group.steps), status)
    };
  });
}

export function buildCycleViews(activity = {}) {
  const steps = Array.isArray(activity.steps) ? activity.steps : [];
  const cycles = Array.isArray(activity.cycles) ? activity.cycles : [];
  const assignedSteps = new Set();
  const views = [];

  for (const cycle of cycles) {
    const cycleSteps = visibleSteps(
      steps.filter((step) => {
        if (step.cycleId !== cycle.id) {
          return false;
        }
        assignedSteps.add(step);
        return true;
      })
    );
    const expandedSetup = expandLegacySetupCycle(cycle, cycleSteps);
    if (expandedSetup) {
      views.push(...expandedSetup);
    } else {
      const status = normalizeCycleStatus(cycle.status);
      views.push({ ...cycle, status, steps: settlePendingSteps(cycleSteps, status) });
    }
  }

  const legacySteps = steps.filter((step) => !assignedSteps.has(step));
  if (legacySteps.length) {
    views.push(...groupLegacySteps(activity, legacySteps));
  }

  return views;
}
