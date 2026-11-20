import { useEffect, useMemo, useState } from "react";
import type { Debate } from "../../core/model";
import {
  BURDEN_SHARE,
  clashEdges,
  STANDARD_LABEL,
  STANDARD_NOTE,
  STRICTNESS_LABEL,
  STRICTNESS_NOTE,
  type JudgeStrictness,
  type StandardOfProof
} from "../../core/judgment";
import type { UiSettings } from "../api";
import { Modal } from "./Modals";

export interface JudgeRunInput {
  model?: string;
  standard: StandardOfProof;
  strictness: JudgeStrictness;
}

const WAIT_LINES = [
  "Reading the attacker",
  "Testing the inference",
  "Weighing the objection",
  "Recording the ruling"
];

const BURDEN_SHARE_LABEL = `${Math.round(BURDEN_SHARE * 5)}/5`;

function ScalesMark({ animated = false }: { animated?: boolean }) {
  return (
    <svg className={`bench-scales ${animated ? "is-weighing" : ""}`} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 7v47M20 54h24M12 17h40M32 17 18 33M32 17l14 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8 33h20M36 33h20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8 33c0 5 4.5 9 10 9s10-4 10-9M36 33c0 5 4.5 9 10 9s10-4 10-9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="32" cy="7" r="2.2" fill="currentColor" />
    </svg>
  );
}

export function JudgmentModal({
  debate,
  settings,
  onRun,
  onClose,
  onOpenSettings
}: {
  debate: Debate;
  settings: UiSettings | null;
  onRun: (input: JudgeRunInput) => Promise<void>;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const [model, setModel] = useState(settings?.model ?? "");
  const [standard, setStandard] = useState<StandardOfProof>("pro");
  const [strictness, setStrictness] = useState<JudgeStrictness>("balanced");
  const [submitting, setSubmitting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const clashes = useMemo(() => clashEdges(debate), [debate]);
  const ready = Boolean(settings?.ready);
  const estimate = ready ? `about ${Math.max(10, Math.ceil(clashes.length / 4) * 6)} seconds` : "a few seconds locally";

  useEffect(() => {
    if (!submitting) return;
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [submitting]);

  const submit = async () => {
    if (submitting || clashes.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onRun({
        model: model.trim() || undefined,
        standard,
        strictness
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The bench could not return a judgment.");
      setSubmitting(false);
    }
  };

  const waitLine = WAIT_LINES[Math.min(WAIT_LINES.length - 1, Math.floor(seconds / 4))];
  const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <Modal
      eyebrow={submitting ? "Judgment in session" : "Judgment"}
      title={submitting ? "The bench is reading" : "Convene the bench"}
      onClose={onClose}
      busy={submitting}
      wide="lg"
      actions={
        submitting ? undefined : (
          <>
            <div className="modal-note">
              {clashes.length === 0
                ? "This map has no attacks or undercuts. Add an objection in the chamber first."
                : `${clashes.length} clash${clashes.length === 1 ? "" : "es"} to hear · ${estimate}`}
            </div>
            <div className="modal-action-group">
              <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={clashes.length === 0}>
                Begin judgment
              </button>
            </div>
          </>
        )
      }
    >
      {submitting ? (
        <div className="bench-wait">
          <div className="bench-wait-mark"><ScalesMark animated /></div>
          <div className="bench-wait-copy">
            <div className="eyebrow">Convened · {elapsed}</div>
            <h3>{waitLine}</h3>
            <p>
              {clashes.length} clash{clashes.length === 1 ? "" : "es"} on the record. The judge rules one at a time;
              the engine follows the consequences.
            </p>
            <div className="bench-wait-track">
              <span style={{ width: `${Math.min(94, 8 + (seconds / Math.max(12, clashes.length * 2.4)) * 86)}%` }} />
            </div>
            <div className="bench-wait-foot">
              <span>{ready ? model.trim() || settings?.model || "Configured judge" : "Local structural review"}</span>
              <span>{STANDARD_LABEL[standard]}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="judge-setup">
          <div className="judge-question">
            <div className="eyebrow">The question before the bench</div>
            <p>{debate.motion}</p>
          </div>

          <p className="modal-lede judge-lede">
            The judge does not decide the whole debate in one breath. It rules on each clash, names the criterion that
            decided it, and hands the consequence back to the map. After the clashes, the bench weighs the surviving case
            lines against the standard of proof.
          </p>

          {!ready && (
            <div className="judge-warning">
              <span className="judge-warning-mark">!</span>
              <div>
                <b>No judge model is connected.</b>
                <p>
                  You can run a structural demonstration, but its rulings are placeholders. For a substantive judgment,
                  connect a model in Settings first.
                </p>
                <button type="button" className="text-link" onClick={onOpenSettings}>Open settings</button>
              </div>
            </div>
          )}

          <div className="judge-model-row">
            <label className="field judge-model-field">
              <span className="field-label">Judge model <em>uses your configured provider and key</em></span>
              <input
                type="text"
                className="field-input"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={settings?.model || "e.g. gpt-4o-mini"}
              />
            </label>
            <div className={`judge-provider ${ready ? "is-ready" : ""}`}>
              <span className="judge-provider-dot" />
              <span>{ready ? settings?.provider || "configured" : "local"}</span>
              <b>{ready ? "model connected" : "structural only"}</b>
            </div>
          </div>

          <div className="judge-choice-grid">
            <label className="field">
              <span className="field-label">Standard of proof</span>
              <select
                className="field-input"
                value={standard}
                onChange={(event) => setStandard(event.target.value as StandardOfProof)}
              >
                {(["pro", "con", "preponderance"] as StandardOfProof[]).map((value) => (
                  <option key={value} value={value}>{STANDARD_LABEL[value]}</option>
                ))}
              </select>
              <span className="field-hint">
                {STANDARD_NOTE[standard]}
                {standard === "preponderance"
                  ? ""
                  : ` The winning side must lead by at least two points and hold ${BURDEN_SHARE_LABEL} of the weighted case.`}
              </span>
            </label>

            <div className="field">
              <span className="field-label">Evidence bar <em>separate from the burden</em></span>
              <div className="judge-segmented">
                {(["strict", "balanced", "generous"] as JudgeStrictness[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`judge-segment ${strictness === value ? "is-selected" : ""}`}
                    onClick={() => setStrictness(value)}
                  >
                    {STRICTNESS_LABEL[value]}
                  </button>
                ))}
              </div>
              <span className="field-hint">
                {STRICTNESS_NOTE[strictness]} This sets the confidence needed to strike; the standard above sets the burden.
              </span>
            </div>
          </div>

          <div className="judge-rubric">
            <span className="judge-rubric-title">The bench asks</span>
            <ol>
              <li><b>Relevance</b><span>Does the attack meet the claim actually made?</span></li>
              <li><b>Grounds</b><span>Are its premises earned, or merely asserted?</span></li>
              <li><b>Sufficiency</b><span>If they hold, does the target fail?</span></li>
              <li><b>Scope</b><span>Does it answer the strongest form of the target?</span></li>
              <li><b>Burden</b><span>Does it meet the standard this claim requires?</span></li>
            </ol>
          </div>

          {error && <div className="form-error">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
