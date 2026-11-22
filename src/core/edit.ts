import type { Debate, DebateEdge, DebateNode, NodeKind, RelationType, Stance } from "./model";
import {
  cleanTag,
  cleanText,
  cleanTitle,
  deriveStances,
  nodeById,
  slugId,
  uid
} from "./model";

/**
 * Pure graph-editing operations for the explicit map editor.
 *
 * The editor works on a draft. These helpers return a new Debate and never
 * touch the filesystem, the network or the DOM. Stance and speaker are not
 * independent fields: they are derived from the graph, so they are deliberately
 * absent from the content patch and recalculated after structural edits.
 */

const MAX_PREMISES = 5;
const MAX_NODES = 42;

export interface NodeEditPatch {
  kind?: NodeKind;
  title?: string;
  text?: string;
  premises?: string[];
  conclusion?: string | null;
  tags?: string[];
}

export interface MotionEditPatch {
  title?: string;
  text?: string;
  premises?: string[];
  conclusion?: string | null;
  tags?: string[];
}

export interface AddResponseResult {
  debate: Debate;
  nodeId: string;
  edgeId: string;
}

export interface EdgeEditResult {
  ok: boolean;
  debate: Debate;
  edgeId?: string;
  error?: string;
}

export interface NodeEditResult {
  ok: boolean;
  debate: Debate;
  error?: string;
}

function cleanedTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  const out = new Set<string>();
  for (const tag of tags) {
    const clean = cleanTag(tag);
    if (clean) out.add(clean);
  }
  return [...out];
}

function cleanedPremises(premises: string[] | undefined): string[] {
  if (!Array.isArray(premises)) return [];
  return premises
    .map((premise) => cleanText(String(premise)))
    .filter(Boolean)
    .slice(0, MAX_PREMISES);
}

export function stanceForResponse(target: DebateNode, type: RelationType): Stance {
  if (target.stance === "con") return type === "support" ? "con" : "pro";
  if (target.stance === "pro") return type === "support" ? "pro" : "con";
  return type === "support" ? "pro" : "con";
}

function withNodes(debate: Debate, nodes: DebateNode[]): Debate {
  return { ...debate, nodes };
}

function withEdges(debate: Debate, edges: DebateEdge[]): Debate {
  return { ...debate, edges };
}

function reachableFromThesis(debate: Debate): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const node of debate.nodes) adjacency.set(node.id, []);
  for (const edge of debate.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }
  const seen = new Set<string>();
  const queue = [debate.thesisId];
  seen.add(debate.thesisId);
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** True when every node in the map is still reachable from the motion. */
export function isConnected(debate: Debate): boolean {
  const seen = reachableFromThesis(debate);
  return debate.nodes.every((node) => seen.has(node.id));
}

export function updateNode(debate: Debate, id: string, patch: NodeEditPatch): Debate {
  const current = nodeById(debate, id);
  if (!current) return debate;
  if (id === debate.thesisId) {
    return updateMotion(debate, {
      title: patch.title,
      text: patch.text,
      premises: patch.premises,
      conclusion: patch.conclusion,
      tags: patch.tags
    });
  }

  const kind: NodeKind = patch.kind === "statement" ? "statement" : patch.kind === "argument" ? "argument" : current.kind;
  const node: DebateNode = {
    ...current,
    kind,
    title: patch.title !== undefined ? patch.title : current.title,
    text: patch.text !== undefined ? patch.text : current.text,
    premises: patch.premises !== undefined ? cleanedPremises(patch.premises) : current.premises,
    conclusion: patch.conclusion !== undefined
      ? (patch.conclusion ? patch.conclusion : undefined)
      : current.conclusion,
    tags: patch.tags !== undefined ? cleanedTags(patch.tags) : current.tags
  };
  return withNodes(debate, debate.nodes.map((candidate) => candidate.id === id ? node : candidate));
}

export function updateMotion(debate: Debate, patch: MotionEditPatch): Debate {
  const current = nodeById(debate, debate.thesisId);
  if (!current) return debate;
  const title = patch.title !== undefined ? patch.title : current.title;
  const text = patch.text !== undefined ? patch.text : current.text;
  const thesis: DebateNode = {
    ...current,
    kind: "statement",
    title,
    text,
    stance: "neutral",
    speaker: "you",
    group: "The motion",
    premises: patch.premises !== undefined ? cleanedPremises(patch.premises) : current.premises,
    conclusion: patch.conclusion !== undefined
      ? (patch.conclusion ? patch.conclusion : undefined)
      : current.conclusion,
    tags: patch.tags !== undefined ? cleanedTags(patch.tags) : current.tags
  };
  return {
    ...debate,
    motion: title,
    thesisText: thesis.text,
    nodes: debate.nodes.map((node) => node.id === debate.thesisId ? thesis : node)
  };
}

/**
 * Add an argument and its relation in one step. The side and speaker are
 * derived from the target and relation, so the caller cannot create a card
 * whose colour contradicts its edge.
 */
export function addResponse(
  debate: Debate,
  targetId: string,
  type: RelationType,
  title = ""
): AddResponseResult {
  const target = nodeById(debate, targetId);
  if (!target) throw new Error("The response target is not on this map.");
  if (debate.nodes.length >= MAX_NODES) {
    throw new Error(`The map has reached its ${MAX_NODES}-argument limit. Remove an argument first.`);
  }
  const nodeId = slugId(uid("arg"), "argument");
  const edgeId = slugId(uid("edge"), "edge");
  const stance = stanceForResponse(target, type);
  const node: DebateNode = {
    id: nodeId,
    kind: "argument",
    title: cleanTitle(title, "New argument", 96),
    text: "",
    stance,
    speaker: stance === "con" ? "challenger" : "advocate",
    tags: [],
    group: "",
    premises: [],
    conclusion: undefined
  };
  const edge: DebateEdge = { id: edgeId, from: nodeId, to: target.id, type };
  const next = withEdges(withNodes(debate, [...debate.nodes, node]), [...debate.edges, edge]);
  deriveStances(next);
  return { debate: next, nodeId, edgeId };
}

export function addEdge(debate: Debate, from: string, to: string, type: RelationType): EdgeEditResult {
  if (from === to) return { ok: false, debate, error: "An argument cannot respond to itself." };
  if (!nodeById(debate, from) || !nodeById(debate, to)) {
    return { ok: false, debate, error: "Both ends of the relation must be on the map." };
  }
  if (debate.edges.some((edge) => edge.from === from && edge.to === to && edge.type === type)) {
    return { ok: false, debate, error: "That relation already exists." };
  }
  // A response cannot loop back into one of its own ancestors. The map is a
  // directed tree of responses; a cycle would make stance and layout undefined.
  const adjacency = new Map<string, string[]>();
  for (const edge of debate.edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  const queue = [to];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (current === from) {
      return { ok: false, debate, error: "That relation would create a loop in the map." };
    }
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(adjacency.get(current) ?? []));
  }
  const edgeId = uid("edge");
  const next = withEdges(debate, [...debate.edges, { id: edgeId, from, to, type }]);
  deriveStances(next);
  return { ok: true, debate: next, edgeId };
}

export function removeEdge(debate: Debate, edgeId: string): EdgeEditResult {
  const edge = debate.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return { ok: false, debate, error: "That relation is no longer on the map." };
  const next = withEdges(debate, debate.edges.filter((candidate) => candidate.id !== edgeId));
  if (!isConnected(next)) {
    return {
      ok: false,
      debate,
      error: "That relation is the only path to an argument. Remove the argument instead, or add another relation first."
    };
  }
  deriveStances(next);
  return { ok: true, debate: next };
}

export function changeEdgeType(debate: Debate, edgeId: string, type: RelationType): Debate {
  const edge = debate.edges.find((candidate) => candidate.id === edgeId);
  if (!edge || edge.type === type) return debate;
  const next = withEdges(debate, debate.edges.map((candidate) =>
    candidate.id === edgeId ? { ...candidate, type } : candidate
  ));
  deriveStances(next);
  return next;
}

export function removeNode(debate: Debate, nodeId: string): NodeEditResult {
  if (nodeId === debate.thesisId) {
    return { ok: false, debate, error: "The motion is the root of the map. Remove the debate instead." };
  }
  if (!nodeById(debate, nodeId)) {
    return { ok: false, debate, error: "That argument is no longer on the map." };
  }
  const next = withEdges(
    withNodes(debate, debate.nodes.filter((node) => node.id !== nodeId)),
    debate.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId)
  );
  if (!isConnected(next)) {
    return {
      ok: false,
      debate,
      error: "That argument still holds up other responses. Remove or reconnect those responses first."
    };
  }
  deriveStances(next);
  return { ok: true, debate: next };
}
