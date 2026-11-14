/**
 * Judgment mode: a local, deterministic argumentation layer.
 *
 * The model's job is only to adjudicate one clash at a time. This module owns
 * the consequences: which arguments stand, which are defeated, which remain
 * contested, and whether the motion survives. Keeping that bookkeeping out of
 * the model makes the result reproducible and lets the UI replay it ruling by
 * ruling.
 */

import { Debate, DebateEdge, nodeById } from "./model";

export type ClashVerdict = "defeats" | "weakens" | "undecided" | "irrelevant";
export type JudgmentCriterion = "relevance" | "grounds" | "sufficiency" | "scope" | "burden";
export type JudgmentConfidence = "high" | "medium" | "low";
export type TargetComponent = "conclusion" | "inference" | "premise" | "scope" | "unknown";
export type ArgumentStatus = "standing" | "defeated" | "contested";
export type JudgmentOutcome = "stands" | "falls" | "undecided" | "unestablished";
export type StandardOfProof = "pro" | "con" | "preponderance";
export type JudgeStrictness = "strict" | "balanced" | "generous";
export type JudgeEngine = "llm" | "local";

export interface ClashEdge extends DebateEdge {
  type: "attack" | "undercut";
}

export interface ClashJudgment {
  edgeId: string;
  from: string;
  to: string;
  type: "attack" | "undercut";
  verdict: ClashVerdict;
  criterion: JudgmentCriterion;
  confidence: JudgmentConfidence;
  targetComponent: TargetComponent;
  reasoning: string;
}

export interface JudgmentWave {
  id: string;
  label: string;
  verdictIds: string[];
}

export interface JudgmentSnapshot {
  statuses: Record<string, ArgumentStatus>;
  standing: string[];
  defeated: string[];
  contested: string[];
  thesisStatus: ArgumentStatus;
  /** Support edges from a standing argument to the thesis. */
  liveSupports: string[];
  /** Direct thesis attacks that remain live without striking the thesis. */
  liveAttacks: string[];
  /** Live supports with no live attack against their source. */
  cleanSupports: string[];
  unsupportedThesis: boolean;
  outcome: JudgmentOutcome;
  counts: { standing: number; defeated: number; contested: number };
}

export interface DecisiveStep {
  edgeId: string;
  from: string;
  to: string;
  kind: "attack" | "support";
  verdict?: ClashVerdict;
}

export interface JudgmentRun {
  id: string;
  debateId: string;
  createdAt: number;
  engine: JudgeEngine;
  judge: { provider: string; model: string };
  standard: StandardOfProof;
  strictness: JudgeStrictness;
  verdicts: ClashJudgment[];
  waves: JudgmentWave[];
  warnings: string[];
  summary: string;
  outcome: JudgmentOutcome;
  decisive: DecisiveStep[];
}

export const VERDICT_LABEL: Record<ClashVerdict, string> = {
  defeats: "Defeats",
  weakens: "Weakens",
  undecided: "Undecided",
  irrelevant: "Irrelevant"
};

export const VERDICT_NOTE: Record<ClashVerdict, string> = {
  defeats: "The target fails on this clash.",
  weakens: "The target survives, with damage.",
  undecided: "Relevant, but not sufficient on the record.",
  irrelevant: "It does not meet the target's actual claim."
};

export const CRITERION_LABEL: Record<JudgmentCriterion, string> = {
  relevance: "Relevance",
  grounds: "Grounds",
  sufficiency: "Sufficiency",
  scope: "Scope",
  burden: "Burden"
};

export const STATUS_LABEL: Record<ArgumentStatus, string> = {
  standing: "Stands",
  defeated: "Defeated",
  contested: "Contested"
};

export const OUTCOME_LABEL: Record<JudgmentOutcome, string> = {
  stands: "The motion stands",
  falls: "The motion falls",
  undecided: "Undecided",
  unestablished: "Unestablished"
};

export const OUTCOME_SHORT: Record<JudgmentOutcome, string> = {
  stands: "Stands",
  falls: "Falls",
  undecided: "Undecided",
  unestablished: "Unestablished"
};

export const STANDARD_LABEL: Record<StandardOfProof, string> = {
  pro: "Pro must establish",
  con: "Con must establish",
  preponderance: "Preponderance of the record"
};

export const STANDARD_NOTE: Record<StandardOfProof, string> = {
  pro: "An unresolved clash counts against the motion.",
  con: "An unresolved clash counts for the motion.",
  preponderance: "The motion follows the weight of the surviving record."
};

export const STRICTNESS_LABEL: Record<JudgeStrictness, string> = {
  strict: "Strict",
  balanced: "Balanced",
  generous: "Generous"
};

export const STRICTNESS_NOTE: Record<JudgeStrictness, string> = {
  strict: "Only a high-confidence ruling can strike an argument.",
  balanced: "High or medium confidence can strike an argument.",
  generous: "The judge's ruling stands, even when it is unsure."
};

/**
 * The motion card speaks in outcomes, not in argument statuses. Before a run
 * is complete, show a standard-aware provisional disposition: under a con
 * burden the motion may stand until displaced, but under a pro burden or
 * preponderance it is not yet established.
 */
export function motionOutcomeForDisplay(input: {
  standard: StandardOfProof;
  step: number;
  complete: boolean;
  outcome: JudgmentOutcome;
}): { outcome: JudgmentOutcome; provisional: boolean } {
  if (input.complete) return { outcome: input.outcome, provisional: false };
  if (input.step === 0) {
    return {
      outcome: input.standard === "con" ? "stands" : "undecided",
      provisional: true
    };
  }
  return { outcome: input.outcome, provisional: true };
}

export function isClashEdge(edge: DebateEdge): edge is ClashEdge {
  return edge.type === "attack" || edge.type === "undercut";
}

export function clashEdges(debate: Debate): ClashEdge[] {
  return debate.edges.filter(isClashEdge);
}

export function judgmentForEdge(
  verdicts: ClashJudgment[],
  edgeId: string
): ClashJudgment | undefined {
  return verdicts.find((verdict) => verdict.edgeId === edgeId);
}

/**
 * Grounded argumentation semantics.
 *
 * - IN  (standing): every attacker is OUT.
 * - OUT (defeated): at least one attacker is IN.
 * - UNDECIDED (contested): the rest, including cycles.
 *
 * This is the least fixed point, so an argument can be reinstated when the
 * argument that defeated it is itself defeated. That is the part a single
 * model pass cannot reliably track.
 */
export function solveJudgment(
  debate: Debate,
  verdicts: ClashJudgment[],
  standard: StandardOfProof = "preponderance"
): JudgmentSnapshot {
  const nodeIds = new Set(debate.nodes.map((node) => node.id));
  const attackers = new Map<string, string[]>();
  for (const node of debate.nodes) attackers.set(node.id, []);

  for (const verdict of verdicts) {
    if (verdict.verdict !== "defeats") continue;
    if (!nodeIds.has(verdict.from) || !nodeIds.has(verdict.to)) continue;
    const edge = debate.edges.find((candidate) => candidate.id === verdict.edgeId);
    if (!edge || !isClashEdge(edge)) continue;
    attackers.get(edge.to)?.push(edge.from);
  }
  const inSet = new Set<string>();
  const outSet = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;

    const newlyIn: string[] = [];
    for (const node of debate.nodes) {
      if (inSet.has(node.id) || outSet.has(node.id)) continue;
      const incoming = attackers.get(node.id) ?? [];
      if (incoming.every((attacker) => outSet.has(attacker))) newlyIn.push(node.id);
    }
    if (newlyIn.length) {
      for (const id of newlyIn) inSet.add(id);
      changed = true;
    }

    const newlyOut: string[] = [];
    for (const node of debate.nodes) {
      if (inSet.has(node.id) || outSet.has(node.id)) continue;
      const incoming = attackers.get(node.id) ?? [];
      if (incoming.some((attacker) => inSet.has(attacker))) newlyOut.push(node.id);
    }
    if (newlyOut.length) {
      for (const id of newlyOut) outSet.add(id);
      changed = true;
    }
  }

  const statuses: Record<string, ArgumentStatus> = {};
  const standing: string[] = [];
  const defeated: string[] = [];
  const contested: string[] = [];
  for (const node of debate.nodes) {
    const status: ArgumentStatus = inSet.has(node.id)
      ? "standing"
      : outSet.has(node.id)
        ? "defeated"
        : "contested";
    statuses[node.id] = status;
    if (status === "standing") standing.push(node.id);
    else if (status === "defeated") defeated.push(node.id);
    else contested.push(node.id);
  }

  const thesis = nodeById(debate, debate.thesisId);
  const thesisStatus = statuses[debate.thesisId] ?? "contested";
  const verdictByEdge = new Map(verdicts.map((verdict) => [verdict.edgeId, verdict]));

  const supportEdges = debate.edges.filter(
    (edge) => edge.type === "support" && edge.to === debate.thesisId
  );
  const liveSupports = supportEdges
    .filter((edge) => statuses[edge.from] === "standing")
    .map((edge) => edge.id);

  // A support only carries the pro burden cleanly if no live attack remains
  // against its source. A weakened or unresolved support is still on the
  // record, but it is not an untouched part of the case.
  const cleanSupports = supportEdges
    .filter((edge) => statuses[edge.from] === "standing")
    .filter((edge) => {
      const incoming = debate.edges.filter(
        (candidate) => candidate.to === edge.from && isClashEdge(candidate)
      );
      return incoming.every((candidate) => {
        const ruling = verdictByEdge.get(candidate.id);
        return !ruling || ruling.verdict === "irrelevant" || statuses[candidate.from] === "defeated";
      });
    })
    .map((edge) => edge.id);

  // Weakens and undecided are not strikes, but they are still live pressure.
  // Counting only "defeats" here would let a judge say "this has real force"
  // and then let the motion stand as if nothing had happened.
  const liveAttacks = debate.edges
    .filter((edge) => edge.to === debate.thesisId && isClashEdge(edge))
    .filter((edge) => {
      const ruling = verdictByEdge.get(edge.id);
      return Boolean(
        ruling &&
          ruling.verdict !== "irrelevant" &&
          statuses[edge.from] &&
          statuses[edge.from] !== "defeated"
      );
    })
    .map((edge) => edge.id);

  const unsupportedThesis = Boolean(thesis) && thesisStatus === "standing" && liveSupports.length === 0;
  const hasLiveAttack = liveAttacks.length > 0;
  const hasLiveSupport = liveSupports.length > 0;
  const hasCleanSupport = cleanSupports.length > 0;

  // The standard of proof decides what live, unresolved pressure means for
  // the motion. A defeat still falls outright; a weakened or open clash can
  // stop "stands" without pretending the argument was struck from the map.
  let outcome: JudgmentOutcome;
  if (thesisStatus === "defeated") {
    outcome = "falls";
  } else if (thesisStatus === "contested") {
    outcome =
      standard === "pro"
        ? "unestablished"
        : standard === "con" && hasLiveSupport
          ? "stands"
          : "undecided";
  } else if (!hasLiveSupport) {
    outcome = "unestablished";
  } else if (!hasLiveAttack && hasCleanSupport) {
    outcome = "stands";
  } else if (standard === "pro") {
    outcome = "unestablished";
  } else if (standard === "con") {
    outcome = "stands";
  } else {
    outcome = "undecided";
  }

  return {
    statuses,
    standing,
    defeated,
    contested,
    thesisStatus,
    liveSupports,
    liveAttacks,
    cleanSupports,
    unsupportedThesis,
    outcome,
    counts: {
      standing: standing.length,
      defeated: defeated.length,
      contested: contested.length
    }
  };
}

function depthByNode(debate: Debate): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  for (const node of debate.nodes) adjacency.set(node.id, []);
  for (const edge of debate.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }
  const depth = new Map<string, number>([[debate.thesisId, 0]]);
  const queue = [debate.thesisId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, (depth.get(current) ?? 0) + 1);
      queue.push(next);
    }
  }
  for (const node of debate.nodes) if (!depth.has(node.id)) depth.set(node.id, 1);
  return depth;
}

/**
 * Put direct clashes on the motion first, then replies, then replies to
 * replies. The final fixed point is order-independent; this order exists so
 * the audience sees the case fall and then possibly recover.
 */
export function orderVerdicts(
  debate: Debate,
  verdicts: ClashJudgment[]
): { verdicts: ClashJudgment[]; waves: JudgmentWave[] } {
  const depth = depthByNode(debate);
  const sorted = [...verdicts].sort((a, b) => {
    const da = depth.get(a.to) ?? 1;
    const db = depth.get(b.to) ?? 1;
    if (da !== db) return da - db;
    const sa = depth.get(a.from) ?? 1;
    const sb = depth.get(b.from) ?? 1;
    if (sa !== sb) return sa - sb;
    return a.edgeId.localeCompare(b.edgeId);
  });

  const labels = ["The motion", "The first case", "The replies", "The deeper record"];
  const groups = new Map<number, ClashJudgment[]>();
  for (const verdict of sorted) {
    const raw = depth.get(verdict.to) ?? 1;
    const wave = Math.min(raw, labels.length - 1);
    const list = groups.get(wave) ?? [];
    list.push(verdict);
    groups.set(wave, list);
  }

  const waves: JudgmentWave[] = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, list]) => ({
      id: `wave-${index}`,
      label: labels[index] ?? "The record",
      verdictIds: list.map((verdict) => verdict.edgeId)
    }));

  return { verdicts: sorted, waves };
}

function confidenceRank(confidence: JudgmentConfidence): number {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
}

function strongest(judgments: ClashJudgment[]): ClashJudgment | undefined {
  return [...judgments].sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))[0];
}

function titleOf(debate: Debate, id: string): string {
  return nodeById(debate, id)?.title ?? "An argument";
}

/**
 * A short, human-readable account of why the outcome holds. This is not a
 * substitute for the ruling record; it is the sentence the judge would read
 * before striking the gavel.
 */
export function judgmentSummary(
  debate: Debate,
  verdicts: ClashJudgment[],
  standard: StandardOfProof = "preponderance"
): {
  summary: string;
  outcome: JudgmentOutcome;
  decisive: DecisiveStep[];
} {
  const snapshot = solveJudgment(debate, verdicts, standard);
  const burden = standard === "pro" ? "pro burden" : standard === "con" ? "con burden" : "preponderance";
  const standingById = new Set(snapshot.standing);
  const directAttacks = debate.edges.filter(
    (edge) => edge.to === debate.thesisId && isClashEdge(edge)
  );
  const directStanding = directAttacks.filter(
    (edge) => standingById.has(edge.from) && judgmentForEdge(verdicts, edge.id)?.verdict === "defeats"
  );
  const directLive = directAttacks.filter((edge) => {
    const ruling = judgmentForEdge(verdicts, edge.id);
    return Boolean(
      ruling &&
        ruling.verdict !== "irrelevant" &&
        snapshot.statuses[edge.from] &&
        snapshot.statuses[edge.from] !== "defeated"
    );
  });
  const directSupports = debate.edges.filter(
    (edge) => edge.to === debate.thesisId && edge.type === "support"
  );
  const liveSupports = directSupports.filter((edge) => snapshot.liveSupports.includes(edge.id));

  if (snapshot.outcome === "falls") {
    const chosen = strongest(
      directStanding
        .map((edge) => judgmentForEdge(verdicts, edge.id))
        .filter((verdict): verdict is ClashJudgment => Boolean(verdict))
    );
    const source = chosen ? titleOf(debate, chosen.from) : "A standing objection";
    return {
      outcome: snapshot.outcome,
      summary: `The motion falls. The objection “${source}” survives the record, and the supporting case does not answer it.`,
      decisive: directStanding.slice(0, 3).map((edge) => ({
        edgeId: edge.id,
        from: edge.from,
        to: edge.to,
        kind: "attack" as const,
        verdict: judgmentForEdge(verdicts, edge.id)?.verdict
      }))
    };
  }

  if (snapshot.outcome === "stands") {
    if (snapshot.liveAttacks.length > 0) {
      const live = snapshot.liveAttacks.slice(0, 3).map((id) => {
        const edge = debate.edges.find((candidate) => candidate.id === id)!;
        return {
          edgeId: edge.id,
          from: edge.from,
          to: edge.to,
          kind: "attack" as const,
          verdict: judgmentForEdge(verdicts, edge.id)?.verdict
        };
      });
      return {
        outcome: snapshot.outcome,
        summary: `The motion stands under the con burden. The con case has live objections, but it has not established that the motion falls.`,
        decisive: live
      };
    }
    if (snapshot.thesisStatus === "contested") {
      return {
        outcome: snapshot.outcome,
        summary: `The motion stands under the ${burden} standard. No standing objection defeats it, although the record remains contested.`,
        decisive: liveSupports.slice(0, 3).map((edge) => ({
          edgeId: edge.id,
          from: edge.from,
          to: edge.to,
          kind: "support" as const
        }))
      };
    }
    const supportTitle = liveSupports[0] ? titleOf(debate, liveSupports[0].from) : "The supporting case";
    return {
      outcome: snapshot.outcome,
      summary:
        liveSupports.length > 1
          ? `The motion stands. ${liveSupports.length} supporting arguments survive every standing objection on the record.`
          : `The motion stands. “${supportTitle}” survives every standing objection on the record.`,
      decisive: liveSupports.slice(0, 3).map((edge) => ({
        edgeId: edge.id,
        from: edge.from,
        to: edge.to,
        kind: "support" as const
      }))
    };
  }

  if (snapshot.outcome === "undecided") {
    const direct = directLive[0] ? judgmentForEdge(verdicts, directLive[0].id) : undefined;
    const open = direct ?? verdicts.find(
      (verdict) => verdict.verdict === "weakens" || verdict.verdict === "undecided"
    ) ?? verdicts.find((verdict) => verdict.verdict !== "defeats");
    const source = open ? titleOf(debate, open.from) : "A live clash";
    return {
      outcome: snapshot.outcome,
      summary: `The motion remains undecided. “${source}” is still contested, and the record does not give a sufficient cause for another strike.`,
      decisive: open
        ? [{ edgeId: open.edgeId, from: open.from, to: open.to, kind: "attack", verdict: open.verdict }]
        : []
    };
  }

  const liveSteps = directLive.slice(0, 3).map((edge) => ({
    edgeId: edge.id,
    from: edge.from,
    to: edge.to,
    kind: "attack" as const,
    verdict: judgmentForEdge(verdicts, edge.id)?.verdict
  }));
  const failedSupports = directSupports
    .filter((edge) => !snapshot.liveSupports.includes(edge.id))
    .slice(0, 3)
    .map((edge) => ({
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      kind: "support" as const
    }));
  const pressuredSupports = directSupports
    .filter(
      (edge) =>
        snapshot.liveSupports.includes(edge.id) && !snapshot.cleanSupports.includes(edge.id)
    )
    .slice(0, 3)
    .map((edge) => ({
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      kind: "support" as const
    }));

  return {
    outcome: snapshot.outcome,
    summary:
      snapshot.liveAttacks.length > 0
        ? `The motion is unestablished under the ${burden} standard. A live objection remains on the record, and the supporting case has not carried the motion.`
        : liveSupports.length > 0
          ? `The motion is unestablished under the ${burden} standard. The supporting case remains contested and has not carried the motion.`
          : "The motion is unestablished. No supporting argument survives the record, although no standing objection defeats the motion outright.",
    decisive: liveSteps.length ? liveSteps : pressuredSupports.length ? pressuredSupports : failedSupports
  };
}

export function buildJudgmentRun(input: {
  debate: Debate;
  engine: JudgeEngine;
  judge: { provider: string; model: string };
  standard: StandardOfProof;
  strictness: JudgeStrictness;
  verdicts: ClashJudgment[];
  warnings?: string[];
  id: string;
  createdAt?: number;
}): JudgmentRun {
  const ordered = orderVerdicts(input.debate, input.verdicts);
  const summary = judgmentSummary(input.debate, ordered.verdicts, input.standard);
  return {
    id: input.id,
    debateId: input.debate.id,
    createdAt: input.createdAt ?? Date.now(),
    engine: input.engine,
    judge: input.judge,
    standard: input.standard,
    strictness: input.strictness,
    verdicts: ordered.verdicts,
    waves: ordered.waves,
    warnings: input.warnings ?? [],
    summary: summary.summary,
    outcome: summary.outcome,
    decisive: summary.decisive
  };
}

export function judgmentMarkdown(debate: Debate, run: JudgmentRun): string {
  const lines: string[] = [];
  lines.push(`# Judgment: ${debate.motion}`);
  lines.push("");
  lines.push(`**Outcome:** ${OUTCOME_LABEL[run.outcome]}`);
  lines.push(`**Judge:** ${run.engine === "local" ? "Local structural review" : `${run.judge.model} (${run.judge.provider})`}`);
  lines.push(`**Standard:** ${STANDARD_LABEL[run.standard]}`);
  lines.push(`**Strictness:** ${STRICTNESS_LABEL[run.strictness]}`);
  lines.push(`**Date:** ${new Date(run.createdAt).toLocaleString()}`);
  lines.push("");
  lines.push(run.summary);
  lines.push("");

  if (run.decisive.length) {
    lines.push("## Decisive path");
    lines.push("");
    for (const step of run.decisive) {
      lines.push(`- **${titleOf(debate, step.from)}** → **${titleOf(debate, step.to)}**${step.verdict ? ` — ${VERDICT_LABEL[step.verdict]}` : ""}`);
    }
    lines.push("");
  }

  lines.push("## Rulings");
  lines.push("");
  if (!run.verdicts.length) {
    lines.push("_No attack or undercut edges were on the record._");
  }
  for (const [index, verdict] of run.verdicts.entries()) {
    lines.push(`### ${index + 1}. ${VERDICT_LABEL[verdict.verdict]} — ${titleOf(debate, verdict.from)} → ${titleOf(debate, verdict.to)}`);
    lines.push("");
    lines.push(`- Criterion: ${CRITERION_LABEL[verdict.criterion]}`);
    lines.push(`- Confidence: ${verdict.confidence}`);
    lines.push(`- Target component: ${verdict.targetComponent}`);
    lines.push("");
    lines.push(verdict.reasoning);
    lines.push("");
  }

  if (run.warnings.length) {
    lines.push("## Warnings");
    lines.push("");
    for (const warning of run.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
