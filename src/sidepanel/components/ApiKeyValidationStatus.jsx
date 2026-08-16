const STATUS_LABELS = {
  not_tested: "Not tested",
  testing: "Testing…",
  valid: "Valid",
  invalid: "Invalid API key",
  error: "Provider/network error"
};

// Deliberately separate visual weight for "invalid" (a confirmed problem with the key -- the provider
// rejected it) vs "error" (validation couldn't be completed at all -- a timeout, rate limit, outage, or
// connectivity issue says nothing about whether the key itself is good or bad). Collapsing these into
// one look would misrepresent the second case as a key problem when it might not be one.
export function ApiKeyValidationStatus({ status, message, testing, onTest }) {
  return (
    <div className="api-key-validation">
      <span className={`api-key-validation-status api-key-validation-status--${status}`}>{STATUS_LABELS[status] || "Not tested"}</span>
      {message && <span className="muted">{message}</span>}
      <button type="button" className="secondary" disabled={testing} onClick={onTest}>
        Test API Key
      </button>
    </div>
  );
}
