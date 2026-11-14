import { useEffect, useRef } from "react";
import type { Debate } from "../../core/model";
import type { UiSettings } from "../api";

interface Props {
  debate: Debate | null;
  settings: UiSettings | null;
  busy: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onOpenSettings: () => void;
}

const SUGGESTIONS = [
  "Add the strongest counterargument",
  "Attack the weakest premise",
  "Steel-man the other side",
  "What is the real crux here?"
];

export function ChatPanel({ debate, settings, busy, draft, onDraftChange, onSend, onOpenSettings }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [debate?.chat.length, debate?.id, busy]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(140, Math.max(42, element.scrollHeight))}px`;
  }, [draft]);

  const engineLabel = settings?.ready ? settings.model || "Model connected" : "Local reasoner";
  const engineDot = settings?.ready ? "ready" : "local";

  return (
    <aside className="chamber" aria-label="Debate chamber chat">
      <div className="chamber-head">
        <div>
          <div className="eyebrow">The chamber</div>
          <h2 className="chamber-title">Pressure-test the map</h2>
        </div>
        <button type="button" className={`engine-pill engine-pill--${engineDot}`} onClick={onOpenSettings} title="Model settings">
          <span className="engine-dot" />
          <span>{engineLabel}</span>
        </button>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {!debate && (
          <div className="chat-empty">
            <p>The chamber opens once a motion is on the table.</p>
          </div>
        )}

        {debate && debate.chat.length === 0 && (
          <div className="chat-intro">
            <div className="chat-intro-mark">§</div>
            <p className="chat-intro-lead">
              This is the chamber. The map is not a verdict — it is the state of the argument.
            </p>
            <p>
              Ask for an objection you have missed, a stronger version of the other side, or a rebuttal to any
              node. Every request can extend the map.
            </p>
            <ol>
              <li>State a position</li>
              <li>Inspect the branches</li>
              <li>Stage the debate</li>
            </ol>
          </div>
        )}

        {debate?.chat.map((entry) => {
          if (entry.role === "system") {
            return (
              <div key={entry.id} className="chat-system">
                <span>Note</span>
                <p>{entry.text}</p>
              </div>
            );
          }
          if (entry.role === "user") {
            return (
              <div key={entry.id} className="chat-message chat-message--user">
                <div className="chat-message-meta">You</div>
                <div className="chat-user-bubble">{entry.text}</div>
              </div>
            );
          }
          return (
            <div key={entry.id} className="chat-message chat-message--assistant">
              <div className="chat-message-meta">
                <span>Cartographer</span>
                {entry.kind === "intake" && <i>map note</i>}
              </div>
              <p>{entry.text}</p>
            </div>
          );
        })}

        {busy && (
          <div className="chat-message chat-message--assistant chat-thinking" aria-live="polite">
            <div className="chat-message-meta">Cartographer</div>
            <div className="thinking-dots"><span /><span /><span /></div>
            <p className="thinking-label">{settings?.ready ? "Extending the map" : "Adding a scaffold"}</p>
          </div>
        )}
      </div>

      <div className="chamber-composer">
        {debate && (
          <div className="suggestions" aria-label="Suggested requests">
            {SUGGESTIONS.map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                className="suggestion"
                disabled={busy}
                onClick={() => {
                  onDraftChange(suggestion);
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        <div className={`composer-box ${busy ? "is-busy" : ""}`}>
          <textarea
            id="chamber-input"
            ref={textareaRef}
            value={draft}
            rows={1}
            disabled={!debate || busy}
            placeholder={debate ? "Challenge this map, ask for a missing argument…" : "Open a debate first"}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
          />
          <button
            type="button"
            className="send-btn"
            onClick={onSend}
            disabled={!debate || busy || !draft.trim()}
            aria-label="Send message"
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M3 10h12M10 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="composer-hint">Enter to send <span>·</span> Shift + Enter for a new line</div>
      </div>
    </aside>
  );
}
