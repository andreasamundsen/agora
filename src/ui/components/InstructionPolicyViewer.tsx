import { useEffect, useRef, useState } from "react";
import { INSTRUCTION_POLICIES, type InstructionId } from "../../shared/instructions";

export function InstructionPolicyViewer() {
  const [activeId, setActiveId] = useState<InstructionId>("judge");
  const viewerRef = useRef<HTMLDivElement>(null);
  const active = INSTRUCTION_POLICIES.find((item) => item.id === activeId) ?? INSTRUCTION_POLICIES[0];

  useEffect(() => {
    const scroller = viewerRef.current?.closest(".modal-scroll");
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
  }, [activeId]);

  if (!active) return null;

  return (
    <div className="instruction-viewer" ref={viewerRef}>
      <div className="instruction-viewer-head">
        <div>
          <span className="field-label">Built-in policy</span>
          <h3>{active.title}</h3>
          <p>{active.summary}</p>
        </div>
        <span className="instruction-badge">Read-only</span>
      </div>

      <div className="instruction-tabs" role="tablist" aria-label="Model instruction roles">
        {INSTRUCTION_POLICIES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`instruction-tab-${item.id}`}
            aria-selected={item.id === active.id}
            aria-controls={`instruction-panel-${item.id}`}
            className={`instruction-tab ${item.id === active.id ? "is-active" : ""}`}
            onClick={() => setActiveId(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>

      <section
        className="instruction-panel"
        role="tabpanel"
        id={`instruction-panel-${active.id}`}
        aria-labelledby={`instruction-tab-${active.id}`}
      >
        <div className="instruction-copy">{active.policy}</div>
        {active.note && (
          <div className="instruction-note">
            <span className="field-label">Output note</span>
            <p>{active.note}</p>
          </div>
        )}
      </section>

      <p className="instruction-footnote">
        These are the built-in policy instructions. Agora also sends a fixed JSON output contract; it is not part of
        the reasoning policy and is not shown here. Model behavior varies by provider and model, and these instructions
        are not a guarantee of objectivity.
      </p>
    </div>
  );
}
