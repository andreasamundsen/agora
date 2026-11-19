import type { Debate, DebateNode } from "../../core/model";

interface Props {
  debate: Debate;
  node: DebateNode;
  onClose: () => void;
}

const STANCE_LABEL = { pro: "For the motion", con: "Against the motion", neutral: "Context" } as const;

export function NodeInspector({ debate, node, onClose }: Props) {
  const isThesis = node.id === debate.thesisId;

  return (
    <aside className="graph-inspector" aria-label="Node inspector">
      <button type="button" className="inspector-close" onClick={onClose} aria-label="Close inspector">×</button>
      <div className="inspector-scroll">
        <div className="inspector-eyebrow">
          <span>{isThesis ? "The motion" : node.kind === "argument" ? "Argument" : "Statement"}</span>
          <span className={`inspector-stance stance-${node.stance}`}>{STANCE_LABEL[node.stance]}</span>
        </div>
        <h3 className="inspector-title">{node.title}</h3>
        <p className="inspector-text">{node.text}</p>

        {node.premises.length > 0 && (
          <div className="inspector-section">
            <div className="inspector-label">Premises</div>
            <ol className="premise-list">
              {node.premises.map((premise, index) => (
                <li key={`${index}-${premise.slice(0, 12)}`}>{premise}</li>
              ))}
            </ol>
            {node.conclusion && (
              <p className="inspector-conclusion">
                <span>Therefore</span> {node.conclusion}
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
