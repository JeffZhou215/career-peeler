import { useEffect, useId, useRef } from "react";
export function Sheet({ open, onClose, title, busy = false, children }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="ios-sheet" aria-labelledby={id}
    onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} onClose={onClose}>
    <div className="sheet-grabber" aria-hidden="true" /><h2 id={id}>{title}</h2>{children}
  </dialog>;
}
