import { useEffect, useMemo, useRef } from "react";
import type { Debate } from "../../core/model";
import {
  BURDEN_SHARE,
  buildJudgmentRecord,
  CRITERION_LABEL,
  IMPACT_LABEL,
  OUTCOME_LABEL,
  OUTCOME_SHORT,
  QUALITY_LABEL,
  STANDARD_LABEL,
  STANDARD_NOTE,
  STATUS_LABEL,
  VERDICT_LABEL,
  VERDICT_NOTE,
  type CaseBalance,
  type ClashJudgment,
  type JudgmentRun,
  type JudgmentSnapshot,
  type SupportAssessment,
  type TargetComponent
} from "../../core/judgment";

const COMPONENT_LABEL: Record<TargetComponent, string> = {
  conclusion: "the conclusion",
  inference: "the inference",
  premise: "a premise",
  scope: "the scope",
  unknown: "the target"
};

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 2.5 13 8l-9 5.5z" fill="currentColor" />
    </svg>
  );
}

function StepIcon({ direction }: { direction: "prev" | "next" }) {
  return direction === "prev" ? (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M10.5 3 5.5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="m5.5 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function titleFor(debate: Debate, id: string): string {
  return debate.nodes.find((node) => node.id === id)?.title ?? "an argument";
}

function effectLine(judgment: ClashJudgment, snapshot: JudgmentSnapshot, thesisId: string): string {
  const source = snapshot.statuses[judgment.from];
  const target = snapshot.statuses[judgment.to];
  const isThesis = judgment.to === thesisId;
  if (judgment.verdict === "defeats") {
    if (source === "defeated") return "The ruling is recorded, but the attacker is itself defeated; it cannot carry.";
    if (source === "contested") return "The ruling is recorded, but the attacker is itself contested; it cannot carry.";
    if (!source) return "The ruling is recorded, but the attacker is no longer standing; it cannot carry.";
    if (isThesis && snapshot.proofConflict && target === "contested") {
      return "The target remains contested: a proof and a corroborated defeat cancel each other.";
    }
    if (isThesis && snapshot.withheldHardDefeats.includes(judgment.edgeId) && target !== "defeated") {
      if (snapshot.proofs.length && !snapshot.proofConflict) {
        return "The direct defeat is not corroborated; the target stands on a proved support.";
      }
      if (snapshot.weakened.includes(judgment.from)) {
        return "The ruling is recorded, but the attacker is itself weakened; it cannot deliver a hard fall.";
      }
      return "The link was ruled a defeat, but the local link assessment did not corroborate a decisive strike; the target remains contested.";
    }
    if (target === "defeated") return "The target is struck from the record.";
    if (target === "contested") return "The target remains contested; this strike does not settle it.";
  }
  if (target === "defeated") return "The target was already defeated by another clash.";
  if (target === "contested") return "The target remains contested on the record.";
  if (snapshot.liveAttacks.includes(judgment.edgeId)) return "The objection remains live against the motion.";
  return "The target survives this clash.";
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function thresholdText(balance: CaseBalance, standard: JudgmentRun["standard"]): string {
  const share = `${Math.round(BURDEN_SHARE * 5)}/5`;
  if (standard === "pro") {
    return `Pro must lead by at least ${formatPoints(Math.abs(balance.threshold))} points and hold ${share} of the weighted case.`;
  }
  if (standard === "con") {
    return `Con must lead by at least ${formatPoints(Math.abs(balance.threshold))} points and hold ${share} of the weighted case.`;
  }
  return `The margin must clear ±${formatPoints(balance.threshold)} points.`;
}

function BalanceCard({
  debate,
  balance,
  standard
}: {
  debate: Debate;
  balance: CaseBalance;
  standard: JudgmentRun["standard"];
}) {
  const lines = [...balance.lines].sort((a, b) => b.weight - a.weight || a.edgeId.localeCompare(b.edgeId));
  const marginLabel = `${balance.margin >= 0 ? "+" : ""}${formatPoints(balance.margin)}`;
  return (
    <section className="case-balance" aria-label="Weighted balance of the record">
      <div className="case-balance-head">
        <div>
          <div className="eyebrow">Weighted record</div>
          <h3>Balance of the case</h3>
        </div>
        <span className={`balance-basis ${balance.assessed ? "is-judged" : "is-structural"}`}>
          {balance.assessed ? "judge-rated" : "structural"}
        </span>
      </div>

      <div className="balance-score">
        <div className="balance-side balance-side--pro">
          <span>Pro case</span>
          <b>{formatPoints(balance.pro)}</b>
        </div>
        <div className={`balance-margin ${balance.margin >= 0 ? "is-pro" : "is-con"}`}>
          <span>Margin</span>
          <b>{marginLabel}</b>
        </div>
        <div className="balance-side balance-side--con">
          <span>Con case</span>
          <b>{formatPoints(balance.con)}</b>
        </div>
      </div>

      <div className="balance-threshold">
        <span>Burden threshold</span>
        <b>{thresholdText(balance, standard)}</b>
      </div>

      <details className="balance-lines">
        <summary>
          <span>Case lines</span>
          <em>{lines.length}</em>
        </summary>
        {lines.length ? (
          <ul>
            {lines.map((line) => {
              const rating = line.proves
                ? "Proved"
                : line.side === "pro"
                  ? line.quality ? QUALITY_LABEL[line.quality] : "Moderate"
                  : line.impact ? IMPACT_LABEL[line.impact] : "Material";
              return (
                <li
                  key={line.edgeId}
                  className={`balance-line balance-line--${line.side}`}
                  title={`${rating} ${formatPoints(line.base)} × ${line.confidenceLabel} confidence ${formatPoints(line.confidence)} × ${
                    line.side === "pro"
                      ? line.survival === 0.5
                        ? "contested support"
                        : line.pressure === 1
                          ? "clean"
                          : "under attack"
                      : line.survival === 1
                        ? "standing"
                        : "contested"
                  } ${formatPoints(line.side === "pro" ? line.pressure * line.survival : line.survival)} × overlap ${formatPoints(line.independence)} = ${formatPoints(line.weight)}`}
                >
                  <div className="balance-line-main">
                    <span className="balance-line-side">{line.side === "pro" ? "Pro" : "Con"}</span>
                    <b>{titleFor(debate, line.sourceId)}</b>
                    <span className="balance-line-rating">{rating}</span>
                    <span className="balance-line-weight">{formatPoints(line.weight)}</span>
                  </div>
                  <div className="balance-line-meta">
                    <span>{line.confidenceLabel} confidence</span>
                    {line.proves && <span>proved</span>}
                    <span>
                      {line.side === "pro"
                        ? line.survival === 0.5
                          ? "support contested"
                          : line.pressure === 1
                            ? "clean line"
                            : "under attack"
                        : line.survival === 1
                          ? "attacker standing"
                          : "attacker contested"}
                    </span>
                    {line.independence < 1 && <span>overlap ×{formatPoints(line.independence)}</span>}
                    {line.cluster && line.cluster !== line.sourceId && <span>cluster: {line.cluster}</span>}
                  </div>
                  {line.reasoning && <p className="balance-line-reasoning">{line.reasoning}</p>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="balance-empty">No direct case lines survive on this record.</p>
        )}
      </details>
    </section>
  );
}

export function JudgmentPanel({
  debate,
  run,
  step,
  playing,
  speed,
  snapshot,
  restored,
  counts,
  onTogglePlay,
  onNext,
  onPrevious,
  onRestart,
  onSeek,
  onSpeedChange,
  onExit,
  onNewRun,
  onOpenSettings,
  onReport,
  onInspectSupport,
  caseLineId,
  caseLinePinned = false
}: {
  debate: Debate;
  run: JudgmentRun;
  step: number;
  playing: boolean;
  speed: number;
  snapshot: JudgmentSnapshot;
  restored: string[];
  counts: JudgmentSnapshot["counts"];
  caseLineId?: string;
  caseLinePinned?: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onRestart: () => void;
  onSeek: (step: number) => void;
  onInspectSupport: (edgeId: string) => void;
  onSpeedChange: (speed: number) => void;
  onExit: () => void;
  onNewRun: () => void;
  onOpenSettings: () => void;
  onReport: () => void;
}) {
  const total = run.verdicts.length;
  const complete = step >= total;
  const current = step > 0 ? run.verdicts[step - 1] : undefined;
  const caseLine = caseLineId ? debate.edges.find((edge) => edge.id === caseLineId) : undefined;
  const caseSupport: SupportAssessment | undefined = caseLine
    ? run.links.find(
        (link): link is SupportAssessment => link.type === "support" && link.edgeId === caseLine.id
      )
    : undefined;
  const record = useMemo(() => buildJudgmentRecord(run), [run]);
  const supportCount = record.filter((entry) => entry.kind === "support").length;
  const caseLineWave = caseLine
    ? run.waves.find((wave) => wave.rootEdgeId === caseLine.id)?.label
    : undefined;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (caseLineId) scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [caseLineId]);
  const waveFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const wave of run.waves) for (const id of wave.verdictIds) map.set(id, wave.label);
    return map;
  }, [run.waves]);
  const currentWave = current ? waveFor.get(current.edgeId) : undefined;
  const restoredTitles = restored.slice(0, 2).map((id) => titleFor(debate, id));

  return (
    <aside className="chamber judgment-panel" aria-label="Judgment record">
      <header className="chamber-head judgment-head">
        <div>
          <div className="eyebrow">The bench</div>
          <h2 className="chamber-title">{complete ? "Judgment" : "In session"}</h2>
        </div>
        <div className={`judge-pill ${run.engine === "local" ? "is-local" : ""}`}>
          <span className="judge-pill-dot" />
          <span>{run.engine === "local" ? "structural" : run.judge.model}</span>
        </div>
      </header>

      <div className="judgment-scroll" ref={scrollRef}>
        {run.engine === "local" && !complete && (
          <div className="judge-mode-note">
            <b>Structural demonstration</b>
            <p>No judge model is connected. These rulings exercise the procedure, not the substance of the arguments.</p>
            <button type="button" className="text-link" onClick={onOpenSettings}>Connect a judge model</button>
          </div>
        )}

        {!complete && step > 0 && (
          <div className="judgment-session-line">
            <span><b>{step}</b> of {total} rulings</span>
            <span className="judgment-session-sep" />
            <span>{counts.standing} standing</span>
            <span>{counts.defeated} struck</span>
            <span>{counts.contested} contested</span>
          </div>
        )}

        {restoredTitles.length > 0 && (
          <div className="judgment-restored" role="status">
            <span className="restored-mark">↺</span>
            <p><b>“{restoredTitles.join("”, “")}”</b> {restoredTitles.length === 1 ? "returns" : "return"} to the record.</p>
          </div>
        )}

        {step === 0 && !complete && (
          <section className="bench-intro-card">
            <div className="bench-intro-mark">§</div>
            <div className="eyebrow">The bench is in session</div>
            <h3>One ruling at a time.</h3>
            <p>
              The judge assesses every arrow locally. The playback rules the conflicts one at a time, and the engine
              follows the consequences through the map.
            </p>
            <div className="bench-intro-meta">
              <span>{STANDARD_LABEL[run.standard]}</span>
              <span>{run.strictness}</span>
              <span>{run.engine === "local" ? "local review" : run.judge.model}</span>
            </div>
          </section>
        )}

        {caseLine && (
          <article className="ruling-card ruling-card--case-line" key={`case-line-${caseLine.id}`}>
            <div className="ruling-head">
              <span className="ruling-index">Case line</span>
              <span className="ruling-wave">{caseLineWave}</span>
            </div>
            <div className="ruling-verdict ruling-verdict--case-line">
              <span>{caseSupport ? `${QUALITY_LABEL[caseSupport.quality]} support` : "Support"}</span>
              <i>{caseSupport ? "A direct support in the case" : "The stem opens this case"}</i>
            </div>
            <div className="ruling-clash">
              <div className="ruling-party">
                <span>Support</span>
                <b>{titleFor(debate, caseLine.from)}</b>
              </div>
              <div className="ruling-arrow ruling-arrow--support" aria-hidden="true">→</div>
              <div className="ruling-party ruling-party--target">
                <span>Toward</span>
                <b>{titleFor(debate, caseLine.to)}</b>
              </div>
            </div>
            {caseSupport && (
              <div className="ruling-meta">
                <span className="ruling-criterion">Case line</span>
                <span className={`ruling-confidence confidence--${caseSupport.confidence}`}>{caseSupport.confidence} confidence</span>
                <span>{caseLine.to === debate.thesisId ? "supports the motion" : `supports ${titleFor(debate, caseLine.to)}`}</span>
              </div>
            )}
            {caseSupport?.reasoning && (
              <blockquote className="ruling-reasoning">{caseSupport.reasoning}</blockquote>
            )}
            <div className="ruling-effect">
              <span className="effect-mark effect-mark--standing" />
              {caseLinePinned
                ? caseLine.to === debate.thesisId
                  ? "This support contributes to the pro case."
                  : `This support contributes to the case for ${titleFor(debate, caseLine.to)}.`
                : "A case line is being introduced; the first ruling follows."}
            </div>
          </article>
        )}

        {current && !complete && !caseLine && (
          <article className={`ruling-card ruling-card--${current.verdict}`} key={current.edgeId}>
            <div className="ruling-head">
              <span className="ruling-index">Ruling {String(step).padStart(2, "0")} <i>/ {String(total).padStart(2, "0")}</i></span>
              <span className="ruling-wave">{currentWave}</span>
            </div>
            <div className={`ruling-verdict ruling-verdict--${current.verdict}`}>
              <span>{VERDICT_LABEL[current.verdict]}</span>
              <i>{VERDICT_NOTE[current.verdict]}</i>
            </div>
            <div className="ruling-clash">
              <div className="ruling-party">
                <span>Attacker</span>
                <b>{titleFor(debate, current.from)}</b>
              </div>
              <div className={`ruling-arrow ruling-arrow--${current.type}`} aria-hidden="true">
                {current.type === "undercut" ? "⌁" : "→"}
              </div>
              <div className="ruling-party ruling-party--target">
                <span>Target</span>
                <b>{titleFor(debate, current.to)}</b>
              </div>
            </div>
            <div className="ruling-meta">
              <span className="ruling-criterion">{CRITERION_LABEL[current.criterion]}</span>
              <span className={`ruling-confidence confidence--${current.confidence}`}>{current.confidence} confidence</span>
              <span>targets {COMPONENT_LABEL[current.targetComponent]}</span>
            </div>
            <blockquote className="ruling-reasoning">{current.reasoning}</blockquote>
            <div className="ruling-effect">
              <span className={`effect-mark effect-mark--${snapshot.statuses[current.to] ?? "contested"}`} />
              {effectLine(current, snapshot, debate.thesisId)}
            </div>
          </article>
        )}

        {complete && (
          <section className={`judgment-finale judgment-finale--${run.outcome}`}>
            <div className="finale-eyebrow">{run.engine === "local" ? "Structural review" : "Judgment"}</div>
            <div className="finale-outcome">
              <span>{OUTCOME_SHORT[run.outcome]}</span>
              <b>{OUTCOME_LABEL[run.outcome]}</b>
            </div>
            <p className="finale-summary">{run.summary}</p>
            <div className="finale-standard">
              <span>{STANDARD_LABEL[run.standard]}</span>
              <i>{STANDARD_NOTE[run.standard]}</i>
            </div>

            <BalanceCard debate={debate} balance={snapshot.balance} standard={run.standard} />

            {run.decisive.length > 0 && (
              <div className="finale-path">
                <div className="finale-label">Decisive path</div>
                <ol>
                  {run.decisive.map((stepItem) => (
                    <li key={`${stepItem.edgeId}-${stepItem.from}`}>
                      <span className={`path-mark path-mark--${stepItem.kind}`} />
                      <span><b>{titleFor(debate, stepItem.from)}</b> <i>→</i> {titleFor(debate, stepItem.to)}</span>
                      {stepItem.verdict && <em>{VERDICT_LABEL[stepItem.verdict]}</em>}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="finale-counts">
              <span><b>{snapshot.counts.standing}</b> standing</span>
              <span><b>{snapshot.counts.defeated}</b> struck</span>
              <span><b>{snapshot.counts.contested}</b> contested</span>
            </div>

            {run.warnings.length > 0 && (
              <div className="finale-warnings">
                {run.warnings.slice(0, 2).map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            )}

            <div className="finale-actions">
              <button type="button" className="btn btn--primary btn--small" onClick={onReport}>Save judgment report</button>
              <button type="button" className="btn btn--quiet btn--small" onClick={onNewRun}>New run</button>
            </div>
          </section>
        )}

        {record.length > 0 && (
          <div className="judgment-record">
            <div className="record-head">
              <span>Rulings</span>
              <span>{record.length} links · {total} rulings · {supportCount} {supportCount === 1 ? "support" : "supports"}</span>
            </div>
            <ol>
              {record.map((entry) => {
                if (entry.kind === "support") {
                  const isActive = caseLineId === entry.support.edgeId;
                  // A support sits at the boundary before its case-line cue. Do
                  // not reveal it as entered one ruling early; it becomes
                  // entered when the cue starts (active) or after the cursor
                  // has moved past that boundary.
                  const isFuture =
                    !isActive &&
                    (entry.step > step || (entry.step === step && step < total));
                  return (
                    <li key={`support:${entry.support.edgeId}`}>
                      <button
                        type="button"
                        className={`record-row record-row--support ${isActive ? "is-support-active" : ""} ${isFuture ? "is-future" : ""}`}
                        onClick={() => onInspectSupport(entry.support.edgeId)}
                        aria-label={
                          isActive
                            ? `Support ${titleFor(debate, entry.support.from)}, selected`
                            : isFuture
                              ? `Support ${titleFor(debate, entry.support.from)}, not yet entered`
                              : `Support ${titleFor(debate, entry.support.from)}`
                        }
                      >
                        <span className={`record-dot ${isFuture ? "" : "record-dot--support"}`} />
                        <span className="record-number" title="Support link">S</span>
                        <span className="record-clash">
                          <b>{titleFor(debate, entry.support.from)}</b>
                          <i>→</i>
                          {titleFor(debate, entry.support.to)}
                        </span>
                        <span className={`record-verdict ${isFuture ? "" : "record-verdict--support"}`}>
                          {isFuture ? "—" : `${QUALITY_LABEL[entry.support.quality]} support`}
                        </span>
                      </button>
                    </li>
                  );
                }

                const isCurrent = !caseLine && entry.index === step;
                const isFuture = entry.index > step;
                return (
                  <li key={`ruling:${entry.verdict.edgeId}`}>
                    <button
                      type="button"
                      className={`record-row ${isCurrent ? "is-current" : ""} ${isFuture ? "is-future" : ""}`}
                      onClick={() => onSeek(entry.index)}
                      aria-label={isFuture ? `Ruling ${entry.index}, not yet entered` : undefined}
                    >
                      <span className={`record-dot ${isFuture ? "" : `record-dot--${entry.verdict.verdict}`}`} />
                      <span className="record-number">{String(entry.index).padStart(2, "0")}</span>
                      <span className="record-clash">
                        <b>{titleFor(debate, entry.verdict.from)}</b>
                        <i>→</i>
                        {titleFor(debate, entry.verdict.to)}
                      </span>
                      <span className={`record-verdict ${isFuture ? "" : `record-verdict--${entry.verdict.verdict}`}`}>
                        {isFuture ? "—" : VERDICT_LABEL[entry.verdict.verdict]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {snapshot.unsupportedThesis && complete && (
          <div className="judgment-unsupported-note">
            The motion itself is still standing, but no supporting argument survives. It is unestablished.
          </div>
        )}

        {complete && snapshot.outcome === "unestablished" && snapshot.liveAttacks.length > 0 && !snapshot.unsupportedThesis && (
          <div className="judgment-unsupported-note">
            A live objection remains against the motion. Under the selected burden, the supporting case has not carried it.
          </div>
        )}

        {complete && snapshot.outcome === "unestablished" && snapshot.liveAttacks.length === 0 && snapshot.liveSupports.length > 0 && snapshot.cleanSupports.length === 0 && (
          <div className="judgment-unsupported-note">
            The supporting arguments remain contested. Under the selected burden, the supporting case has not carried the motion.
          </div>
        )}
      </div>

      <footer className="judgment-controls">
        <div className="judgment-transport">
          <button type="button" className="judge-control" onClick={onPrevious} disabled={step === 0} aria-label="Previous ruling">
            <StepIcon direction="prev" />
          </button>
          <button type="button" className="judge-control judge-control--play" onClick={complete ? onRestart : onTogglePlay} aria-label={complete ? "Replay" : playing ? "Pause" : "Play"}>
            <PlayIcon playing={playing && !complete} />
          </button>
          <button type="button" className="judge-control" onClick={onNext} disabled={complete} aria-label="Next ruling">
            <StepIcon direction="next" />
          </button>
          <button type="button" className="judge-control judge-control--restart" onClick={onRestart} aria-label="Restart judgment">
            ↺
          </button>
        </div>
        <div className="judgment-speed">
          {[0.5, 1, 1.5].map((value) => (
            <button
              key={value}
              type="button"
              className={`speed-btn ${speed === value ? "is-active" : ""}`}
              onClick={() => onSpeedChange(value)}
            >
              {value}×
            </button>
          ))}
        </div>
        {complete && (
          <>
            <button type="button" className="judgment-report" onClick={onNewRun} title="Convene a new judgment">
              New run
            </button>
            <button type="button" className="judgment-report" onClick={onReport} title="Download the judgment report">
              Report
            </button>
          </>
        )}
        <button type="button" className="judgment-exit" onClick={onExit}>Exit</button>
      </footer>
    </aside>
  );
}
