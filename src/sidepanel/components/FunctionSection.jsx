import { useEffect, useRef } from "react";
import { HelpTooltip } from "./HelpTooltip";

export function FunctionSection({ title, help, meta, running = false, defaultOpen = false, sectionRef, headerAction, children }) {
  const localRef = useRef(null);
  const ref = sectionRef || localRef;
  useEffect(() => {
    if (running && ref.current) ref.current.open = true;
  }, [running, ref]);
  return <details ref={ref} name="careerPeelerFunctions" className="function-section" open={defaultOpen || undefined}>
    <summary className="function-heading">
      <h2 className="function-title">{title}<HelpTooltip label={title} text={help} /></h2>
      {meta && <span className="function-meta">{meta}</span>}
      {headerAction && <span className="function-header-action" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>{headerAction}</span>}
    </summary>
    <div className="function-body">{children}</div>
  </details>;
}
