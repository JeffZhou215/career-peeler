export function HelpTooltip({ text }) {
  return (
    <span className="help" tabIndex={0} aria-label={`Help: ${text}`}>
      ?
    </span>
  );
}
