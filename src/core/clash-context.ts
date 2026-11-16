import { Debate, DebateEdge, DebateNode, nodeById } from "./model";

/** How many of the target's outgoing relations we will spend prompt space on. */
export const MAX_DIRECT_CONTEXT_RELATIONS = 4;

export type ClashContextRole =
  | "the thesis itself"
  | "direct case line"
  | "first response"
  | "deeper response"
  | "no directed path to the thesis";

export interface ClashContextRelation {
  edge: DebateEdge;
  destination: DebateNode;
}

export interface ClashContextStep {
  edge: DebateEdge;
  from: DebateNode;
  to: DebateNode;
}

export interface ClashContext {
  target: DebateNode;
  role: ClashContextRole;
  /** What the target itself supports, attacks, or undercuts. */
  directRelations: ClashContextRelation[];
  omittedDirectRelations: number;
  /** One shortest directed path from the target to the thesis. */
  path: ClashContextStep[];
}

function shortestPathToThesis(debate: Debate, from: string): ClashContextStep[] {
  if (from === debate.thesisId) return [];

  const queue = [from];
  const seen = new Set([from]);
  const previous = new Map<string, { from: string; edge: DebateEdge }>();

  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of debate.edges) {
      if (edge.from !== current || seen.has(edge.to)) continue;
      const destination = nodeById(debate, edge.to);
      if (!destination) continue;
      seen.add(edge.to);
      previous.set(edge.to, { from: current, edge });

      if (edge.to === debate.thesisId) {
        const steps: ClashContextStep[] = [];
        let cursor = debate.thesisId;
        while (cursor !== from) {
          const prior = previous.get(cursor);
          if (!prior) return [];
          const stepFrom = nodeById(debate, prior.from);
          const stepTo = nodeById(debate, cursor);
          if (!stepFrom || !stepTo) return [];
          steps.unshift({ edge: prior.edge, from: stepFrom, to: stepTo });
          cursor = prior.from;
        }
        return steps;
      }

      queue.push(edge.to);
    }
  }

  return [];
}

function roleFor(target: DebateNode, thesisId: string, path: ClashContextStep[]): ClashContextRole {
  if (target.id === thesisId) return "the thesis itself";
  if (!path.length) return "no directed path to the thesis";
  if (path.length === 1) return "direct case line";
  if (path.length === 2) return "first response";
  return "deeper response";
}

/**
 * Build the minimal chain context for one clash: what the target itself
 * attacks or supports, plus one shortest directed path to the thesis.
 * The target's outgoing relations are capped, but the first edge of the
 * shortest path is always retained.
 */
export function buildClashContext(
  debate: Debate,
  edge: Pick<DebateEdge, "to">
): ClashContext | null {
  const target = nodeById(debate, edge.to);
  if (!target) return null;

  const path = shortestPathToThesis(debate, target.id);
  const outgoing = debate.edges.filter((candidate) => candidate.from === target.id);
  const shortestEdge = path[0]?.edge;

  const selected: DebateEdge[] = [];
  if (shortestEdge) selected.push(shortestEdge);
  for (const candidate of outgoing) {
    if (selected.length >= MAX_DIRECT_CONTEXT_RELATIONS) break;
    if (!selected.some((chosen) => chosen.id === candidate.id)) selected.push(candidate);
  }

  const directRelations = selected.flatMap((selectedEdge) => {
    const destination = nodeById(debate, selectedEdge.to);
    return destination ? [{ edge: selectedEdge, destination }] : [];
  });

  return {
    target,
    role: roleFor(target, debate.thesisId, path),
    directRelations,
    omittedDirectRelations: Math.max(0, outgoing.length - directRelations.length),
    path
  };
}
