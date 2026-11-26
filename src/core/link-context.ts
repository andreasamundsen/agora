import { nodeById, type Debate, type DebateEdge, type DebateNode } from "./model";

export type LinkTargetRole =
  | "thesis itself"
  | "direct case line"
  | "first response"
  | "deeper response"
  | "no directed path";

export interface LinkPathStep {
  edge: DebateEdge;
  from: DebateNode;
  to: DebateNode;
}

export interface LinkContext {
  target: DebateNode;
  role: LinkTargetRole;
  /** One shortest directed path from the target to the thesis, if one exists. */
  path: LinkPathStep[];
}

function shortestPathToThesis(debate: Debate, from: string): LinkPathStep[] {
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
        const steps: LinkPathStep[] = [];
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

function roleFor(target: DebateNode, thesisId: string, path: LinkPathStep[]): LinkTargetRole {
  if (target.id === thesisId) return "thesis itself";
  if (!path.length) return "no directed path";
  if (path.length === 1) return "direct case line";
  if (path.length === 2) return "first response";
  return "deeper response";
}

/**
 * Build the compact structural context for one judged link: where its target
 * sits relative to the thesis, plus one shortest path to the thesis.
 */
export function buildLinkContext(
  debate: Debate,
  edge: Pick<DebateEdge, "to">
): LinkContext | null {
  const target = nodeById(debate, edge.to);
  if (!target) return null;
  const path = shortestPathToThesis(debate, target.id);
  return {
    target,
    role: roleFor(target, debate.thesisId, path),
    path
  };
}
