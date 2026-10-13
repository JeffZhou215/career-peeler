export function SelectionCapacitySummary({ selectedCount, capacity, hiddenCount = 0 }) {
  const known = Boolean(capacity?.known);
  const slots = Math.max(0, Math.floor(Number(capacity?.remaining) || 0));
  const remaining = Math.max(0, slots - selectedCount);
  const tone = !known || selectedCount < slots ? "neutral" : slots > 0 && selectedCount === slots ? "filled" : "excess";
  const counter = !known ? "Capacity Will Be Verified"
    : selectedCount < slots ? `${remaining} ${remaining === 1 ? "Slot" : "Slots"} Remaining`
      : `${slots} Open ${slots === 1 ? "Slot" : "Slots"}`;
  const notice = !known || selectedCount < slots ? null
    : slots === 0 ? "No Open Slots. Selected Roles Will Stay Queued."
      : selectedCount === slots ? "Enough Roles Selected To Fill Your Open Slots."
        : `Up To ${slots} Can Be Submitted. Extra Roles Stay Queued.`;

  return <div className={`selection-capacity selection-capacity-${tone}`} role="status" aria-live="polite" aria-atomic="true">
    <strong>{selectedCount} Selected · {counter}</strong>
    {notice && <span>{notice}</span>}
    {hiddenCount > 0 && <span className="muted">{hiddenCount} Selected {hiddenCount === 1 ? "Role" : "Roles"} Hidden By Search</span>}
  </div>;
}
