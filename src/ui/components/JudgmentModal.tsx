import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  estimateJudgeRemainingMs,
  type JudgeProgressEvent,
  type JudgeProgressPhase
} from "../../shared/judge-progress";
import type { JudgeStreamOptions, UiSettings } from "../api";
import { Modal } from "./Modals";

export interface JudgeRunInput {
  model?: string;
  standard: StandardOfProof;
  strictness: JudgeStrictness;
}

const BURDEN_SHARE_LABEL = `${Math.round(BURDEN_SHARE * 5)}/5`;

const LINK_TYPE_LABEL: Record<"support" | "attack" | "undercut", string> = {
  support: "supports",
  attack: "attacks",
  undercut: "undercuts"
};

function formatRemaining(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

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
  onRun: (input: JudgeRunInput, options: JudgeStreamOptions) => Promise<void>;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const [model, setModel] = useState(settings?.model ?? "");
  const [standard, setStandard] = useState<StandardOfProof>("pro");
  const [strictness, setStrictness] = useState<JudgeStrictness>("balanced");
  const [submitting, setSubmitting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<JudgeProgressPhase>("clustering");
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(debate.edges.length);
  const [active, setActive] = useState<{ edgeId: string; index: number }[]>([]);
  const [doneIndexes, setDoneIndexes] = useState<number[]>([]);
  const [etaMs, setEtaMs] = useState<number | null>(null);
  const durationsRef = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  const clashes = useMemo(() => clashEdges(debate), [debate]);
  const links = debate.edges;
  const ready = Boolean(settings?.ready);
  const edgeById = useMemo(() => new Map(debate.edges.map((edge) => [edge.id, edge])), [debate.edges]);
  const nodeTitleById = useMemo(() => new Map(debate.nodes.map((node) => [node.id, node.title])), [debate.nodes]);

  useEffect(() => {
    if (!submitting) return;
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [submitting]);

  const handleProgress = useCallback((event: JudgeProgressEvent) => {
    if (cancelledRef.current) return;
    switch (event.type) {
      case "phase":
        setPhase(event.phase);
        setTotal(event.totalLinks);
        if (event.phase === "assessing" || event.phase === "local") {
          setCompleted(0);
          setActive([]);
          setDoneIndexes([]);
          setEtaMs(null);
          durationsRef.current = [];
        }
        if (event.phase === "resolving") {
          setActive([]);
          setCompleted(event.totalLinks);
          setDoneIndexes(Array.from({ length: event.totalLinks }, (_, index) => index));
          setEtaMs(0);
        }
        break;
      case "link-start":
        setActive((current) =>
          current.some((link) => link.edgeId === event.link.edgeId)
            ? current
            : [...current, { edgeId: event.link.edgeId, index: event.link.index }]
        );
        break;
      case "link-done": {
        durationsRef.current = [...durationsRef.current, event.durationMs];
        setActive((current) => current.filter((link) => link.edgeId !== event.link.edgeId));
        setDoneIndexes((current) =>
          current.includes(event.link.index) ? current : [...current, event.link.index]
        );
        setCompleted(event.completed);
        setTotal(event.link.total);
        const remaining = Math.max(0, event.link.total - event.completed);
        setEtaMs(estimateJudgeRemainingMs(durationsRef.current, remaining));
        break;
      }
      default:
        break;
    }
  }, []);

  const submit = async () => {
    if (submitting || links.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    cancelledRef.current = false;
    setSubmitting(true);
    setError(null);
    setPhase("clustering");
    setCompleted(0);
    setTotal(links.length);
    setActive([]);
    setDoneIndexes([]);
    setEtaMs(null);
    durationsRef.current = [];
    try {
      await onRun(
        {
          model: model.trim() || undefined,
          standard,
          strictness
        },
        { signal: controller.signal, onProgress: handleProgress }
      );
    } catch (caught) {
      if (cancelledRef.current || controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "The bench could not return a judgment.");
      setSubmitting(false);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    setSubmitting(false);
    setActive([]);
    setEtaMs(null);
    setError("Judgment cancelled.");
  };

  const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const activeLinks = active.slice(0, 4);
  const progressPct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const etaLabel =
    phase === "assessing"
      ? etaMs === null
        ? "Estimating after the first link"
        : etaMs > 0
          ? `About ${formatRemaining(etaMs)} remaining`
          : "Finishing the record"
      : phase === "clustering"
        ? "Estimating after the first link"
        : phase === "local"
          ? "Structural review"
          : "Finishing the record";
  const phaseTitle =
    phase === "clustering"
      ? "Grouping the arguments"
      : phase === "assessing"
        ? "Reading the links"
        : phase === "local"
          ? "Building the structural record"
          : "Resolving the record";
  const phaseCopy =
    phase === "clustering"
      ? "The bench is grouping related arguments before it assesses any link."
      : phase === "assessing"
        ? completed >= total
          ? "All links assessed. Resolving the record."
          : activeLinks.length
            ? `${completed} of ${total} link${total === 1 ? "" : "s"} assessed. ${activeLinks.length} link${activeLinks.length === 1 ? " is" : "s are"} in flight.`
            : `${completed} of ${total} link${total === 1 ? "" : "s"} assessed. Starting the next links.`
        : phase === "local"
          ? "No judge model is connected. The structural record is being assembled."
          : "The link assessments are complete. The engine is applying the standard of proof.";
  const modalTitle = submitting
    ? phase === "clustering"
      ? "The bench is grouping"
      : phase === "local"
        ? "The bench is reviewing"
        : phase === "resolving"
          ? "The bench is resolving"
          : "The bench is reading"
    : "Convene the bench";

  return (
    <Modal
      eyebrow={submitting ? "Judgment in session" : "Judgment"}
      title={modalTitle}
      onClose={onClose}
      busy={submitting}
      wide="lg"
      actions={
        submitting ? (
          <div className="modal-action-group">
            <button type="button" className="btn btn--quiet" onClick={cancel}>
              Cancel judgment
            </button>
          </div>
        ) : (
          <>
            <div className="modal-note">
              {links.length === 0
                ? "This map has no argument links. Add a support or objection in the chamber first."
                : `${links.length} link${links.length === 1 ? "" : "s"} to assess${clashes.length ? ` · ${clashes.length} ruling${clashes.length === 1 ? "" : "s"} to play` : ""} · ${ready ? "progress and a measured estimate appear after the first link returns" : "the structural review runs immediately"}`}
            </div>
            <div className="modal-action-group">
              <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={links.length === 0}>
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
            <h3>{phaseTitle}</h3>
            <p>{phaseCopy}</p>
            <div className="bench-progress">
              <div className={`bench-wait-track ${phase === "clustering" || phase === "local" ? "is-indeterminate" : ""}`}>
                {phase === "clustering" || phase === "local" ? (
                  <span className="bench-wait-sweep" />
                ) : (
                  <span style={{ width: `${progressPct}%` }} />
                )}
              </div>
              <div className="bench-link-track" aria-hidden="true">
                {Array.from({ length: total }, (_, index) => (
                  <span
                    key={index}
                    className={`bench-link-pip${doneIndexes.includes(index) ? " is-done" : activeLinks.some((link) => link.index === index) ? " is-active" : ""}`}
                  />
                ))}
              </div>
              <div className="bench-progress-meta">
                <span>{completed} / {total}</span>
                <span>{etaLabel}</span>
              </div>
            </div>
            {phase === "assessing" && (
              <div className="bench-link-list">
                {activeLinks.length ? (
                  activeLinks.map((activeLink) => {
                    const edge = edgeById.get(activeLink.edgeId);
                    const source = edge ? nodeTitleById.get(edge.from) ?? "Untitled argument" : "Argument link";
                    const target = edge ? nodeTitleById.get(edge.to) ?? "Untitled argument" : "";
                    return (
                      <div className="bench-link-row" key={activeLink.edgeId}>
                        <span className={`bench-link-type is-${edge?.type ?? "support"}`}>
                          {LINK_TYPE_LABEL[edge?.type ?? "support"]}
                        </span>
                        <span className="bench-link-path" title={`${source} → ${target}`}>
                          <b>{source}</b>
                          <i>→</i>
                          <span>{target}</span>
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <p className="bench-link-empty">Starting the first links…</p>
                )}
              </div>
            )}
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
            The judge does not decide the whole debate in one breath. It assesses every arrow locally — supports for
            strength, attacks and undercuts for a verdict and impact — and the engine follows the consequences through
            the map. The rulings playback shows the conflicts one at a time; the balance applies the standard of proof.
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
