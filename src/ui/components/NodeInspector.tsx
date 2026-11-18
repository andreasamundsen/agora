import type { Debate, DebateNode } from "../../core/model";

interface Props {
  debate: Debate;
  node: DebateNode;
  onClose: () => void;
  onAsk: (prompt: string) => void;
}

const STANCE_LABEL = { pro: "For the motion", con: "Against the motion", neutral: "Context" } as const;
const SPEAKER_LABEL = { advocate: "Advocate", challenger: "Challenger", moderator: "Moderator", you: "You" } as const;
const RELATION_LABEL = { support: "is supported by", attack: "is attacked by", undercut: "is undercut by" } as const;

export function NodeInspector({ debate, node, onClose, onAsk }: Props) {
  const byId = new Map(debate.nodes.map((n) => [n.id, n]));
  const incoming = debate.edges.filter((edge) => edge.to === node.id);
  const outgoing = debate.edges.filter((edge) => edge.from === node.id);
  const isThesis = node.id === debate.thesisId;
  const promptTitle = node.title.length > 62 ? `${node.title.slice(0, 61)}…` : node.title;

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

        <div className="inspector-section">
          <div className="inspector-label">In the map</div>
          <ul className="connection-list">
            {incoming.slice(0, 4).map((edge) => {
              const other = byId.get(edge.from);
              if (!other) return null;
              return (
                <li key={edge.id}>
                  <span className={`connection-mark connection-mark--${edge.type}`} />
                  <span className="connection-text">
                    {RELATION_LABEL[edge.type]} <em>{other.title}</em>
                  </span>
                </li>
              );
            })}
            {outgoing.slice(0, 4).map((edge) => {
              const other = byId.get(edge.to);
              if (!other) return null;
              const verb = edge.type === "support" ? "supports" : edge.type === "undercut" ? "undercuts" : "attacks";
              return (
                <li key={edge.id}>
                  <span className={`connection-mark connection-mark--${edge.type}`} />
                  <span className="connection-text">{verb} <em>{other.title}</em></span>
                </li>
              );
            })}
            {!incoming.length && !outgoing.length && <li className="connection-empty">No relations yet.</li>}
          </ul>
        </div>

        <div className="inspector-meta">
          <span>{SPEAKER_LABEL[node.speaker]}</span>
          {node.tags.filter((tag) => !["motion", "thesis", "pro", "con", "neutral", "advocate", "challenger", "moderator", "you", "user"].includes(tag)).slice(0, 3).map((tag) => (
            <span key={tag} className="inspector-tag">#{tag}</span>
          ))}
        </div>
      </div>

      <div className="inspector-actions">
        <span className="inspector-actions-label">Ask about this card</span>
        <button
          type="button"
          className="inspector-action"
          onClick={() => onAsk(`What is the weakest premise in “${promptTitle}”, and what would defeat it?`)}
        >
          Weakest premise
        </button>
        <button
          type="button"
          className="inspector-action inspector-action--ghost"
          onClick={() => onAsk(`What is the strongest evidence or mechanism that could support “${promptTitle}”?`)}
        >
          Strongest support
        </button>
      </div>
    </aside>
  );
}
