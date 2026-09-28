import { useEffect, useMemo, useRef } from "react";
import { useAutofillActivity } from "../hooks/useAutofillActivity";
import { buildCycleViews, getActivityLinkUrl } from "../lib/activity";

// Both activity producers persist explicit cycles alongside their individual runtime steps. The
// outer cycle is the compact, durable result a user scans; opening it reveals the exact actions that
// led to that result. Older flat logs are split at setup/job boundaries by lib/activity.js so one
// previous job can never become the visual parent of another.
const TOOL_LABELS = {
  validate_api_key: "Validate API Key",
  extract_resume_profile: "Extract Resume Profile",
  read_job_description: "Read Job Description",
  local_match: "Local Match",
  llm_match: "LLM Match",
  evaluate_job_match: "Evaluate Job Match",
  open_application: "Open Application",
  read_page: "Read Page",
  type: "Type",
  select: "Select",
  click: "Click",
  upload: "Upload",
  generate: "Generate",
  question_agent: "Question Agent",
  verify: "Verify",
  save: "Save",
  submit_application: "Submit Application",
  done: "Done"
};

function RunningDots() {
  return (
    <span className="activity-running-dots" role="img" aria-label="Running">
      <span />
      <span />
      <span />
    </span>
  );
}

function CycleStatus({ status }) {
  if (status === "running") {
    return <RunningDots />;
  }
  return (
    <span
      className={`activity-cycle-status activity-cycle-status--${status}`}
      role="img"
      aria-label={status === "attention" ? "Needs Attention" : "Complete"}
    >
      {status === "attention" ? "!" : "•"}
    </span>
  );
}

function StepStatus({ status }) {
  if (status === "pending") {
    return <RunningDots />;
  }
  return (
    <span
      className={`activity-step-status activity-step-status--${status}`}
      role="img"
      aria-label={status === "error" ? "Error" : "Complete"}
    >
      {status === "error" ? "!" : "•"}
    </span>
  );
}

function ActivityStep({ step }) {
  return (
    <li className={`activity-step activity-step--${step.status}`}>
      <StepStatus status={step.status} />
      <div className="activity-step-body">
        <div className="activity-step-heading">
          <span className="activity-step-tool">{TOOL_LABELS[step.tool] || step.tool}</span>
          {step.label && <span className="activity-step-label">{step.label}</span>}
        </div>
        {step.observation && <div className="activity-step-observation">{step.observation}</div>}
      </div>
    </li>
  );
}

function ActivityCycle({ cycle }) {
  const linkUrl = getActivityLinkUrl(cycle.url);
  const stepCount = cycle.steps.length;
  const stepLabel = `${stepCount} ${stepCount === 1 ? "Step" : "Steps"}`;

  return (
    <li className={`activity-cycle activity-cycle--${cycle.status}`}>
      <details key={`${cycle.id}:${cycle.status}`} className="activity-cycle-details" open={cycle.status === "running"}>
        <summary className="activity-cycle-summary">
          <CycleStatus status={cycle.status} />
          <span className="activity-cycle-copy">
            {linkUrl ? (
              <a
                className="activity-cycle-title activity-cycle-title--link"
                href={linkUrl}
                target="_blank"
                rel="noreferrer"
                title="Open Job In A New Tab"
                onClick={(event) => event.stopPropagation()}
              >
                {cycle.title || "Current Job"}
              </a>
            ) : (
              <span className="activity-cycle-title">{cycle.title || "Activity"}</span>
            )}
            <span className="activity-cycle-meta">
              {cycle.outcome || (cycle.status === "running" ? "Running" : "Complete")} · {stepLabel}
            </span>
          </span>
        </summary>
        <ol className="activity-cycle-steps">
          {cycle.steps.map((step) => (
            <ActivityStep key={step.id} step={step} />
          ))}
          {!cycle.steps.length && <li className="activity-cycle-empty">Waiting For The First Step…</li>}
        </ol>
      </details>
    </li>
  );
}

export function AutofillActivityLog({ storageKey }) {
  const activity = useAutofillActivity(storageKey);
  const cycles = useMemo(() => buildCycleViews(activity), [activity]);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [cycles.length, activity.steps?.length]);

  if (!cycles.length) {
    return null;
  }

  return (
    <section className="activity-log">
      <h2>Activity</h2>
      <ul className="activity-cycle-list" ref={listRef}>
        {cycles.map((cycle) => (
          <ActivityCycle key={cycle.id} cycle={cycle} />
        ))}
      </ul>
    </section>
  );
}
