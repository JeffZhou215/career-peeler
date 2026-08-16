import { useAutofillActivity } from "../hooks/useAutofillActivity";

// Pie-style live activity log: genericAutofill/loop.js and background.js's known-site
// runApplicationWorkflow each push one entry per real action taken (not every skip/diagnostic -- see
// loop.js's logTrace vs. pushActivityStep split) straight to chrome.storage.local as they happen;
// useAutofillActivity picks each one up via chrome.storage.onChanged. Driven entirely by runtime
// events, never LLM-generated text. One component, parameterized by storageKey, shared by both flows
// rather than a second copy -- see useAutofillActivity's own comment for why a single hook/component
// pair works for both a content-script sweep and a service-worker-driven multi-step workflow.
const TOOL_LABELS = {
  validate_api_key: "Validate API key",
  extract_resume_profile: "Extract resume profile",
  read_job_description: "Read job description",
  evaluate_job_match: "Evaluate job match",
  open_application: "Open application",
  read_page: "Read page",
  type: "Type",
  select: "Select",
  click: "Click",
  upload: "Upload",
  generate: "Generate",
  verify: "Verify",
  submit_application: "Submit application",
  done: "Done"
};

const STATUS_SYMBOL = {
  pending: "…", // ellipsis
  success: "✓", // check
  error: "!"
};

export function AutofillActivityLog({ storageKey }) {
  const { steps } = useAutofillActivity(storageKey);

  if (!steps.length) {
    return null;
  }

  return (
    <section className="activity-log">
      <h2>Activity</h2>
      <ul className="activity-log-list">
        {steps.map((step) => (
          <li key={step.id} className={`activity-step activity-step--${step.status}`}>
            <span className="activity-step-icon" aria-hidden="true">
              {STATUS_SYMBOL[step.status] || ""}
            </span>
            <span className="activity-step-body">
              <span className="activity-step-heading">
                <span className="activity-step-tool">{TOOL_LABELS[step.tool] || step.tool}</span>
                {step.label && <span className="activity-step-label">{step.label}</span>}
              </span>
              {step.observation && <span className="activity-step-observation">{step.observation}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
