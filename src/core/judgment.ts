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
export type CaseSide = "pro" | "con";
export type ArgumentQuality = "strong" | "moderate" | "weak";
export type AttackImpact = "decisive" | "material" | "marginal";

export interface CaseLineAssessment {
  edgeId: string;
  side: CaseSide;
  quality?: ArgumentQuality;
  impact?: AttackImpact;
  confidence: JudgmentConfidence;
  cluster: string;
  /** A direct pro line explicitly certified as sufficient to establish the thesis. */
  proves?: boolean;
  reasoning?: string;
}

export interface CaseLineWeight {
  edgeId: string;
  side: CaseSide;
  sourceId: string;
  cluster: string;
  base: number;
  confidence: number;
  confidenceLabel: JudgmentConfidence;
  survival: number;
  pressure: number;
  independence: number;
  weight: number;
  quality?: ArgumentQuality;
  impact?: AttackImpact;
  /** Certified as sufficient to establish the thesis. Pro lines only. */
  proves?: boolean;
  reasoning?: string;
}

export interface CaseBalance {
  pro: number;
  con: number;
  margin: number;
  threshold: number;
  lines: CaseLineWeight[];
  assessed: boolean;
}

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
  /** Non-thesis nodes that survive a live `weakens` ruling. A condition, not a structural status. */
  weakened: string[];
  /** Direct thesis defeats that count as a hard fall under the corroboration rule. */
  hardDefeats: string[];
  /** Direct `defeats` rulings that did not meet the corroboration rule. */
  withheldHardDefeats: string[];
  /** Direct pro supports certified as sufficient to establish the thesis. */
  proofs: string[];
  /** A certified proof and a corroborated direct defeat both exist. */
  proofConflict: boolean;
  thesisStatus: ArgumentStatus;
  /** Support edges from a standing argument to the thesis. */
  liveSupports: string[];
  /** Direct thesis attacks that remain live without striking the thesis. */
  liveAttacks: string[];
  /** Live supports with no live attack against their source. */
  cleanSupports: string[];
  unsupportedThesis: boolean;
  outcome: JudgmentOutcome;
  balance: CaseBalance;
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
  assessments: CaseLineAssessment[];
  balance: CaseBalance;
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
  pro: "The motion must show a clear advantage over the surviving objections.",
  con: "The con case must show a clear advantage over the motion's support.",
  preponderance: "The heavier surviving case wins; a near-tie remains undecided."
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

export const QUALITY_LABEL: Record<ArgumentQuality, string> = {
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak"
};

export const IMPACT_LABEL: Record<AttackImpact, string> = {
  decisive: "Decisive",
  material: "Material",
  marginal: "Marginal"
};

export const QUALITY_POINTS: Record<ArgumentQuality, number> = {
  strong: 3,
  moderate: 2,
  weak: 1
};

export const IMPACT_POINTS: Record<AttackImpact, number> = {
  decisive: 3,
  material: 2,
  marginal: 1
};

export const RATING_CONFIDENCE_FACTOR: Record<JudgmentConfidence, number> = {
  high: 1,
  medium: 0.75,
  low: 0.5
};

/** Initial burden calibration. These are points, not probabilities. */
export const BURDEN_THRESHOLDS: Record<StandardOfProof, number> = {
  pro: 2,
  con: 2,
  preponderance: 0.5
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
  standard: StandardOfProof = "preponderance",
  assessments: CaseLineAssessment[] = []
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
  let thesisStatus = statuses[debate.thesisId] ?? "contested";
  const verdictByEdge = new Map(verdicts.map((verdict) => [verdict.edgeId, verdict]));
  const assessmentByEdge = new Map(assessments.map((item) => [item.edgeId, item]));
  const setThesisStatus = (next: ArgumentStatus) => {
    if (thesisStatus === next) return;
    for (const list of [standing, defeated, contested]) {
      const index = list.indexOf(debate.thesisId);
      if (index >= 0) list.splice(index, 1);
    }
    thesisStatus = next;
    statuses[debate.thesisId] = next;
    if (next === "standing") standing.push(debate.thesisId);
    else if (next === "defeated") defeated.push(debate.thesisId);
    else contested.push(debate.thesisId);
  };

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

  // Weakened is a condition, not another structural status. It records that a
  // surviving node was explicitly damaged by a live weakens ruling. It is
  // derived from the current fixed point, so reinstatement clears it
  // automatically, and the thesis is excluded because the motion card speaks
  // in outcomes rather than node conditions.
  const weakened = new Set<string>();
  for (const verdict of verdicts) {
    if (verdict.verdict !== "weakens") continue;
    if (verdict.to === debate.thesisId) continue;
    if (!nodeIds.has(verdict.from) || !nodeIds.has(verdict.to)) continue;
    if (!statuses[verdict.from] || statuses[verdict.from] === "defeated") continue;
    if (statuses[verdict.to] === "defeated") continue;
    const edge = debate.edges.find((candidate) => candidate.id === verdict.edgeId);
    if (!edge || !isClashEdge(edge)) continue;
    weakened.add(verdict.to);
  }

  // A direct `defeats` ruling is not automatically a hard fall. Once the
  // weighing pass has rated the case, a thesis defeat must be corroborated by
  // a decisive con-line assessment, and the defeating attacker must not itself
  // be weakened. Without assessments (local structural review or a failed
  // weighing pass), retain the structural fallback.
  const directDefeatEdges = debate.edges.filter(
    (edge) =>
      edge.to === debate.thesisId &&
      isClashEdge(edge) &&
      statuses[edge.from] === "standing" &&
      verdictByEdge.get(edge.id)?.verdict === "defeats"
  );
  const hardDefeatEdges =
    assessments.length === 0
      ? directDefeatEdges
      : directDefeatEdges.filter((edge) => {
          if (weakened.has(edge.from)) return false;
          const assessment = assessmentByEdge.get(edge.id);
          return (
            assessment?.side === "con" &&
            assessment.impact === "decisive" &&
            assessment.confidence !== "low"
          );
        });
  const hardDefeatIds = new Set(hardDefeatEdges.map((edge) => edge.id));
  const withheldHardDefeats = directDefeatEdges
    .filter((edge) => !hardDefeatIds.has(edge.id))
    .map((edge) => edge.id);

  // A proof is a higher bar than a strong support: it must be clean, strong,
  // high-confidence, and explicitly certified by the weighing pass as carrying
  // the thesis. A proof and a corroborated direct defeat are opposing decisive
  // claims; they leave the thesis contested rather than letting either side's
  // binary rule decide the motion alone.
  const proofEdges = supportEdges.filter((edge) => {
    if (statuses[edge.from] !== "standing") return false;
    if (!cleanSupports.includes(edge.id)) return false;
    const assessment = assessmentByEdge.get(edge.id);
    return (
      assessment?.side === "pro" &&
      assessment.proves === true &&
      assessment.quality === "strong" &&
      assessment.confidence === "high"
    );
  });
  const proofIds = new Set(proofEdges.map((edge) => edge.id));
  const proofConflict = proofIds.size > 0 && hardDefeatIds.size > 0;

  if (proofConflict) {
    setThesisStatus("contested");
  } else if (proofIds.size > 0) {
    setThesisStatus("standing");
  } else if (assessments.length > 0 && thesisStatus === "defeated" && hardDefeatEdges.length === 0) {
    setThesisStatus("contested");
  }

  const unsupportedThesis = Boolean(thesis) && thesisStatus === "standing" && liveSupports.length === 0;
  const balance = buildCaseBalance({
    debate,
    verdicts,
    assessments,
    statuses,
    liveSupports,
    liveAttacks,
    cleanSupports,
    standard
  });

  // The burden is a threshold, not a veto. The record can be so lopsided that
  // it carries even the side with the burden; only a close record lets the
  // standard decide. A direct defeat of the thesis is still a hard fall.
  let outcome: JudgmentOutcome;
  if (proofConflict) {
    outcome = "undecided";
  } else if (proofIds.size > 0) {
    outcome = "stands";
  } else if (thesisStatus === "defeated") {
    outcome = "falls";
  } else if (balance.pro <= 0) {
    outcome = "unestablished";
  } else if (standard === "pro") {
    outcome =
      balance.margin >= BURDEN_THRESHOLDS.pro
        ? "stands"
        : balance.margin <= -BURDEN_THRESHOLDS.con
          ? "falls"
          : "unestablished";
  } else if (standard === "con") {
    outcome = balance.margin <= -BURDEN_THRESHOLDS.con ? "falls" : "stands";
  } else {
    outcome =
      balance.margin > BURDEN_THRESHOLDS.preponderance
        ? "stands"
        : balance.margin < -BURDEN_THRESHOLDS.preponderance
          ? "falls"
          : "undecided";
  }

  return {
    statuses,
    standing,
    defeated,
    contested,
    weakened: debate.nodes.filter((node) => weakened.has(node.id)).map((node) => node.id),
    hardDefeats: [...hardDefeatIds],
    withheldHardDefeats,
    proofs: [...proofIds],
    proofConflict,
    thesisStatus,
    liveSupports,
    liveAttacks,
    cleanSupports,
    unsupportedThesis,
    outcome,
    balance,
    counts: {
      standing: standing.length,
      defeated: defeated.length,
      contested: contested.length
    }
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clusterKey(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || fallback;
}

function fallbackImpact(verdict: ClashVerdict | undefined): AttackImpact {
  if (verdict === "defeats") return "decisive";
  if (verdict === "undecided") return "material";
  return "material";
}

/**
 * Turn the surviving direct case lines into a weighted balance. Only direct
 * supports and direct attacks on the thesis are case lines; replies earn
 * their effect through the status and pressure of the line they answer.
 *
 * Without judge assessments, a neutral structural rating is used. That keeps
 * replay and local review deterministic while making the lack of quality
 * information visible in `assessed`.
 */
export function buildCaseBalance(input: {
  debate: Debate;
  verdicts: ClashJudgment[];
  assessments: CaseLineAssessment[];
  statuses: Record<string, ArgumentStatus>;
  liveSupports: string[];
  liveAttacks: string[];
  cleanSupports: string[];
  standard: StandardOfProof;
}): CaseBalance {
  const assessmentByEdge = new Map(input.assessments.map((item) => [item.edgeId, item]));
  const rulingByEdge = new Map(input.verdicts.map((item) => [item.edgeId, item]));
  const clean = new Set(input.cleanSupports);
  const lines: CaseLineWeight[] = [];

  for (const edgeId of input.liveSupports) {
    const edge = input.debate.edges.find((candidate) => candidate.id === edgeId);
    if (!edge || edge.type !== "support") continue;
    const source = nodeById(input.debate, edge.from);
    if (!source || input.statuses[source.id] !== "standing") continue;
    const assessment = assessmentByEdge.get(edgeId);
    const quality = assessment?.side === "pro" ? assessment.quality ?? "moderate" : "moderate";
    const confidenceLabel = assessment?.side === "pro" ? assessment.confidence : "high";
    const pressure = clean.has(edgeId) ? 1 : 0.6;
    const base = QUALITY_POINTS[quality];
    const confidence = RATING_CONFIDENCE_FACTOR[confidenceLabel];
    lines.push({
      edgeId,
      side: "pro",
      sourceId: source.id,
      cluster: clusterKey(assessment?.side === "pro" ? assessment.cluster : undefined, edgeId),
      base,
      confidence,
      confidenceLabel,
      survival: 1,
      pressure,
      independence: 1,
      weight: base * confidence * pressure,
      quality,
      proves:
        assessment?.side === "pro" &&
        assessment.proves === true &&
        assessment.quality === "strong" &&
        assessment.confidence === "high" &&
        clean.has(edgeId),
      reasoning: assessment?.side === "pro" ? assessment.reasoning : undefined
    });
  }

  for (const edgeId of input.liveAttacks) {
    const edge = input.debate.edges.find((candidate) => candidate.id === edgeId);
    if (!edge || !isClashEdge(edge)) continue;
    const source = nodeById(input.debate, edge.from);
    if (!source) continue;
    const sourceStatus = input.statuses[source.id];
    if (!sourceStatus || sourceStatus === "defeated") continue;
    const assessment = assessmentByEdge.get(edgeId);
    const impact =
      assessment?.side === "con"
        ? assessment.impact ?? "material"
        : fallbackImpact(rulingByEdge.get(edgeId)?.verdict);
    const confidenceLabel =
      assessment?.side === "con"
        ? assessment.confidence
        : rulingByEdge.get(edgeId)?.confidence ?? "medium";
    const base = IMPACT_POINTS[impact];
    const confidence = RATING_CONFIDENCE_FACTOR[confidenceLabel];
    const survival = sourceStatus === "standing" ? 1 : 0.5;
    lines.push({
      edgeId,
      side: "con",
      sourceId: source.id,
      cluster: clusterKey(assessment?.side === "con" ? assessment.cluster : undefined, edgeId),
      base,
      confidence,
      confidenceLabel,
      survival,
      pressure: 1,
      independence: 1,
      weight: base * confidence * survival,
      impact,
      reasoning: assessment?.side === "con" ? assessment.reasoning : undefined
    });
  }

  const groups = new Map<string, CaseLineWeight[]>();
  for (const line of lines) {
    const key = `${line.side}:${line.cluster}`;
    const group = groups.get(key) ?? [];
    group.push(line);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => b.weight - a.weight || a.edgeId.localeCompare(b.edgeId));
    group.forEach((line, index) => {
      line.independence = index === 0 ? 1 : index === 1 ? 0.5 : 0.25;
      line.weight = line.weight * line.independence;
    });
    const best = group[0]?.weight ?? 0;
    const total = group.reduce((sum, line) => sum + line.weight, 0);
    const cap = best * 1.5;
    if (total > cap && total > 0) {
      const scale = cap / total;
      for (const line of group) line.weight *= scale;
    }
  }

  const proRaw = lines.filter((line) => line.side === "pro").reduce((sum, line) => sum + line.weight, 0);
  const conRaw = lines.filter((line) => line.side === "con").reduce((sum, line) => sum + line.weight, 0);
  for (const line of lines) line.weight = round2(line.weight);
  for (const side of ["pro", "con"] as const) {
    const sideLines = lines.filter((line) => line.side === side);
    if (!sideLines.length) continue;
    const raw = sideLines.reduce((sum, line) => sum + line.weight, 0);
    const target = round2(side === "pro" ? proRaw : conRaw);
    const diff = round2(target - raw);
    if (diff) sideLines[0]!.weight = round2(sideLines[0]!.weight + diff);
  }
  const pro = round2(lines.filter((line) => line.side === "pro").reduce((sum, line) => sum + line.weight, 0));
  const con = round2(lines.filter((line) => line.side === "con").reduce((sum, line) => sum + line.weight, 0));
  const margin = round2(pro - con);
  const threshold =
    input.standard === "pro"
      ? BURDEN_THRESHOLDS.pro
      : input.standard === "con"
        ? -BURDEN_THRESHOLDS.con
        : BURDEN_THRESHOLDS.preponderance;

  return {
    pro,
    con,
    margin,
    threshold,
    lines,
    assessed: lines.length > 0 && lines.every((line) => assessmentByEdge.has(line.edgeId))
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

function topCaseLines(balance: CaseBalance, side: CaseSide, count = 3): CaseLineWeight[] {
  return balance.lines
    .filter((line) => line.side === side)
    .sort((a, b) => b.weight - a.weight || a.edgeId.localeCompare(b.edgeId))
    .slice(0, count);
}

function caseSteps(
  debate: Debate,
  verdicts: ClashJudgment[],
  caseLines: CaseLineWeight[]
): DecisiveStep[] {
  return caseLines.flatMap((line) => {
    const edge = debate.edges.find((candidate) => candidate.id === line.edgeId);
    if (!edge) return [];
    return [
      {
        edgeId: edge.id,
        from: edge.from,
        to: edge.to,
        kind: line.side === "pro" ? ("support" as const) : ("attack" as const),
        verdict: judgmentForEdge(verdicts, edge.id)?.verdict
      }
    ];
  });
}

/**
 * A short, human-readable account of why the outcome holds. This is not a
 * substitute for the ruling record; it is the sentence the judge would read
 * before striking the gavel.
 */
export function judgmentSummary(
  debate: Debate,
  verdicts: ClashJudgment[],
  standard: StandardOfProof = "preponderance",
  assessments: CaseLineAssessment[] = []
): {
  summary: string;
  outcome: JudgmentOutcome;
  decisive: DecisiveStep[];
  balance: CaseBalance;
} {
  const snapshot = solveJudgment(debate, verdicts, standard, assessments);
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
  const proLines = topCaseLines(snapshot.balance, "pro");
  const conLines = topCaseLines(snapshot.balance, "con");
  const margin = `${snapshot.balance.margin >= 0 ? "+" : ""}${snapshot.balance.margin}`;
  const proofSteps = snapshot.proofs.flatMap((edgeId) => {
    const edge = debate.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) return [];
    return [{ edgeId, from: edge.from, to: edge.to, kind: "support" as const }];
  });
  const conflictSteps = snapshot.hardDefeats.flatMap((edgeId) => {
    const edge = debate.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) return [];
    return [
      {
        edgeId,
        from: edge.from,
        to: edge.to,
        kind: "attack" as const,
        verdict: judgmentForEdge(verdicts, edgeId)?.verdict
      }
    ];
  });

  if (snapshot.proofConflict) {
    return {
      outcome: "undecided",
      balance: snapshot.balance,
      summary:
        "The motion remains contested. A clean direct support is certified as a proof, while a direct objection is a live defeat; neither can displace the other on this record.",
      decisive: [...proofSteps, ...conflictSteps].slice(0, 6)
    };
  }

  if (snapshot.outcome === "falls") {
    if (snapshot.thesisStatus === "defeated") {
      const chosen = strongest(
        directStanding
          .map((edge) => judgmentForEdge(verdicts, edge.id))
          .filter((verdict): verdict is ClashJudgment => Boolean(verdict))
      );
      const source = chosen ? titleOf(debate, chosen.from) : "A standing objection";
      return {
        outcome: snapshot.outcome,
        balance: snapshot.balance,
        summary: `The motion falls. The objection “${source}” defeats the thesis, and the supporting case cannot restore it.`,
        decisive: directStanding.slice(0, 3).map((edge) => ({
          edgeId: edge.id,
          from: edge.from,
          to: edge.to,
          kind: "attack" as const,
          verdict: judgmentForEdge(verdicts, edge.id)?.verdict
        }))
      };
    }
    return {
      outcome: snapshot.outcome,
      balance: snapshot.balance,
      summary: `The motion falls. The con case outweighs the surviving support by ${Math.abs(snapshot.balance.margin)} points under the ${burden} standard.`,
      decisive: caseSteps(debate, verdicts, conLines)
    };
  }

  if (snapshot.outcome === "stands") {
    if (snapshot.proofs.length) {
      return {
        outcome: snapshot.outcome,
        balance: snapshot.balance,
        summary:
          "The motion stands. A clean direct support is certified as a proof of the thesis; no corroborated direct defeat survives against it.",
        decisive: proofSteps
      };
    }
    return {
      outcome: snapshot.outcome,
      balance: snapshot.balance,
      summary:
        standard === "con" && snapshot.balance.margin < 0
          ? `The motion stands. The con case did not clear the con burden; the weighted margin is ${margin} points.`
          : `The motion stands. The supporting case leads the weighted record by ${margin} points and meets the ${burden} threshold.`,
      decisive: caseSteps(debate, verdicts, proLines)
    };
  }

  if (snapshot.outcome === "undecided") {
    const firstLine = [...snapshot.balance.lines].sort(
      (a, b) => b.weight - a.weight || a.edgeId.localeCompare(b.edgeId)
    )[0];
    const source = firstLine ? titleOf(debate, firstLine.sourceId) : "A live clash";
    return {
      outcome: snapshot.outcome,
      balance: snapshot.balance,
      summary: `The motion remains undecided. The weighted record is within the preponderance band at ${margin} points; “${source}” is the strongest live line.`,
      decisive: firstLine ? caseSteps(debate, verdicts, [firstLine]) : []
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
    balance: snapshot.balance,
    summary:
      snapshot.liveAttacks.length > 0
        ? `The motion is unestablished under the ${burden} standard. A live objection remains on the record; the supporting case is at ${margin} points and has not carried the motion.`
        : liveSupports.length > 0
          ? `The motion is unestablished under the ${burden} standard. The supporting case remains contested at ${margin} points and has not carried the motion.`
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
  assessments?: CaseLineAssessment[];
  warnings?: string[];
  id: string;
  createdAt?: number;
}): JudgmentRun {
  const assessments = input.assessments ?? [];
  const ordered = orderVerdicts(input.debate, input.verdicts);
  const summary = judgmentSummary(input.debate, ordered.verdicts, input.standard, assessments);
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
    assessments,
    balance: summary.balance,
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

  if (run.balance.lines.length) {
    lines.push("## Balance");
    lines.push("");
    lines.push(`- **Pro case:** ${run.balance.pro} points`);
    lines.push(`- **Con case:** ${run.balance.con} points`);
    lines.push(`- **Margin:** ${run.balance.margin >= 0 ? "+" : ""}${run.balance.margin} points`);
    lines.push(`- **Threshold:** ${run.balance.threshold >= 0 ? "+" : ""}${run.balance.threshold} points`);
    lines.push(`- **Basis:** ${run.balance.assessed ? "judge-rated case lines" : "structural weights"}`);
    lines.push("");
    for (const line of run.balance.lines) {
      const rating = line.proves
        ? "Proves"
        : line.side === "pro"
          ? line.quality ? QUALITY_LABEL[line.quality] : "Moderate"
          : line.impact ? IMPACT_LABEL[line.impact] : "Material";
      lines.push(`- **${titleOf(debate, line.sourceId)}** — ${line.side === "pro" ? "pro" : "con"}, ${rating}, ${line.weight} points`);
    }
    lines.push("");
  }

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
