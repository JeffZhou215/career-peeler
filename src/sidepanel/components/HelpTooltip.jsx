import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function HelpTooltip({ text, label = "Function Help" }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const box = popoverRef.current.getBoundingClientRect();
    setPosition({ left: Math.max(12, Math.min(anchor.right - box.width, window.innerWidth - box.width - 12)),
      top: Math.max(12, anchor.bottom + box.height + 18 <= window.innerHeight ? anchor.bottom + 6 : anchor.top - box.height - 6) });
  }, [open, text]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event) => {
      if (!buttonRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); buttonRef.current?.focus(); } };
    const reposition = (event) => { if (!(event.target instanceof Node) || !popoverRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);
  return <>
    <button ref={buttonRef} type="button" className="help" aria-label={`Help: ${label}`}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value); }}>?</button>
    {open && createPortal(<div ref={popoverRef} id={id} className="help-popover" role="dialog" aria-label={label}
      style={position} onClick={(event) => event.stopPropagation()}>
      <div className="help-popover-heading"><strong>{label}</strong><button type="button" className="help-close" aria-label="Close Help"
        onClick={() => { setOpen(false); buttonRef.current?.focus(); }}>×</button></div>
      <p>{text}</p>
    </div>, document.body)}
  </>;
}
