/**
 * Pure domain model for a debate map.
 *
 * Nothing in this file touches the filesystem, the network or the DOM. The
 * server and the browser both import it, which is what keeps the Argdown
 * export, the staging engine and the UI working from one shape of truth.
 */

export type NodeKind = "statement" | "argument";
export type Stance = "pro" | "con" | "neutral";
export type Speaker = "advocate" | "challenger" | "moderator" | "you";
export type RelationType = "support" | "attack" | "undercut";
export type DebateOrigin = "authored" | "imported" | "seed";

export interface DebateNode {
  id: string;
  kind: NodeKind;
  title: string;
  text: string;
  stance: Stance;
  speaker: Speaker;
  tags: string[];
  group: string;
  premises: string[];
  conclusion?: string;
}

export interface DebateEdge {
  id: string;
  /** The node doing the supporting, attacking or undercutting. */
  from: string;
  /** The node being supported, attacked or undercut. */
  to: string;
  type: RelationType;
  note?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
  kind?: "intake" | "expand" | "note" | "error";
}

export interface Debate {
  id: string;
  motion: string;
  thesisId: string;
  thesisText: string;
  nodes: DebateNode[];
  edges: DebateEdge[];
  origin: DebateOrigin;
  position?: string;
  authorNote?: string;
  chat: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface DebateSummary {
  id: string;
  motion: string;
  thesisText: string;
  nodeCount: number;
  edgeCount: number;
  origin: DebateOrigin;
  updatedAt: number;
}

export interface DebatePatch {
  motion?: string;
  thesisText?: string;
  nodes: Partial<DebateNode>[];
  edges: Partial<DebateEdge>[];
  authorNote?: string;
}

export const STANCE_LABEL: Record<Stance, string> = {
  pro: "For the motion",
  con: "Against the motion",
  neutral: "Crossfire"
};

export const SPEAKER_LABEL: Record<Speaker, string> = {
  advocate: "Advocate",
  challenger: "Challenger",
  moderator: "Moderator",
  you: "You"
};

const MAX_TITLE = 96;
const MAX_TEXT = 520;
const MAX_PREMISES = 5;
const MAX_NODES = 42;

let fallbackCounter = 0;

export function uid(prefix: string): string {
  fallbackCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${fallbackCounter.toString(36)}${rand}`;
}

export function slugId(input: string, fallback = "node"): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  let i = 2;
  while (taken.has(id)) {
    id = `${base}-${i}`;
    i += 1;
  }
  taken.add(id);
  return id;
}

/** Collapse whitespace and strip Argdown's bracket syntax out of labels. */
export function cleanInline(input: string): string {
  return String(input ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\[\]<>{}\\]/g, (m) => ({ "[": "(", "]": ")", "<": "(", ">": ")", "{": "(", "}": ")", "\\": "/" }[m] ?? ""))
    .trim();
}

export function cleanTitle(input: string, fallback = "Untitled argument", max = MAX_TITLE): string {
  const clean = cleanInline(input).replace(/#/g, "").trim();
  if (!clean) return fallback;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function cleanText(input: string): string {
  const clean = cleanInline(input);
  if (!clean) return "";
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1).trimEnd()}…` : clean;
}

export function cleanTag(input: string): string {
  return String(input ?? "")
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function normaliseTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const clean = cleanTag(tag);
    if (clean) out.add(clean);
  }
  return [...out];
}

export function normaliseStance(value: unknown): Stance {
  return value === "pro" || value === "con" || value === "neutral" ? value : "neutral";
}

export function normaliseSpeaker(value: unknown): Speaker {
  return value === "advocate" || value === "challenger" || value === "moderator" || value === "you"
    ? value
    : "moderator";
}

export function normaliseRelation(value: unknown): RelationType | null {
  if (value === "support" || value === "attack" || value === "undercut") return value;
  if (value === "pro" || value === "supports") return "support";
  if (value === "con" || value === "contra" || value === "attacks" || value === "contradiction" || value === "contrary")
    return "attack";
  if (value === "undermine" || value === "undercuts") return "undercut";
  return null;
}

function textOf(node: Partial<DebateNode>): string {
  return cleanText(node.text || "") || cleanTitle(node.title || "");
}

function normaliseNode(raw: Partial<DebateNode>, index: number): DebateNode {
  const kind: NodeKind = raw.kind === "argument" ? "argument" : "statement";
  const title = cleanTitle(raw.title || raw.text || "", `Argument ${index + 1}`, kind === "statement" ? 160 : MAX_TITLE);
  const stance = normaliseStance(raw.stance);
  const tags = normaliseTags(raw.tags);
  const speaker = normaliseSpeaker(raw.speaker ?? (stance === "pro" ? "advocate" : stance === "con" ? "challenger" : "moderator"));
  const premises = Array.isArray(raw.premises)
    ? raw.premises.map((p) => cleanText(String(p))).filter(Boolean).slice(0, MAX_PREMISES)
    : [];
  return {
    id: String(raw.id || "").trim(),
    kind,
    title,
    text: textOf(raw),
    stance,
    speaker,
    tags,
    group: cleanTitle(raw.group || STANCE_LABEL[stance], STANCE_LABEL[stance]),
    premises,
    conclusion: raw.conclusion ? cleanText(raw.conclusion) : undefined
  };
}

/**
 * Make any raw debate shape safe and whole:
 * - ids, titles and relations are unique and valid
 * - every non-thesis node is reachable from the thesis
 * - stance is recomputed from the actual graph topology (support preserves a
 *   side, attack/undercut flip it), so colours and speakers can never lie
 *   about what the map says
 */
export function reconcileDebate(raw: {
  id?: string;
  motion?: string;
  thesisId?: string;
  thesisText?: string;
  nodes: Partial<DebateNode>[];
  edges: Partial<DebateEdge>[];
  origin?: DebateOrigin;
  position?: string;
  authorNote?: string;
  chat?: ChatMessage[];
  createdAt?: number;
  updatedAt?: number;
}): Debate {
  const now = Date.now();
  const nodes: DebateNode[] = [];
  const takenIds = new Set<string>();
  const usedTitles = new Set<string>();

  for (const [index, candidate] of raw.nodes.slice(0, MAX_NODES).entries()) {
    const node = normaliseNode(candidate, index);
    const baseId = node.id ? slugId(node.id, `node-${index + 1}`) : slugId(node.title, `node-${index + 1}`);
    node.id = uniqueId(baseId, takenIds);

    let title = node.title;
    let suffix = 2;
    while (usedTitles.has(title.toLowerCase())) {
      title = `${node.title.replace(/…$/, "")} (${suffix})`;
      suffix += 1;
    }
    usedTitles.add(title.toLowerCase());
    node.title = title;
    node.tags = normaliseTags([...node.tags, node.stance, node.speaker]);
    nodes.push(node);
  }

  // The thesis always exists and is always a statement.
  let thesis =
    nodes.find((n) => n.id === raw.thesisId) ??
    nodes.find((n) => n.tags.includes("motion") || n.tags.includes("thesis")) ??
    nodes[0];

  if (!thesis) {
    thesis = normaliseNode(
      {
        id: "thesis",
        kind: "statement",
        title: cleanTitle(raw.thesisText || raw.motion || "The motion"),
        text: cleanText(raw.thesisText || raw.motion || "The motion"),
        stance: "neutral",
        speaker: "you",
        tags: ["motion"]
      },
      0
    );
    thesis.id = uniqueId("thesis", takenIds);
    nodes.unshift(thesis);
  } else {
    thesis.kind = "statement";
    thesis.stance = "neutral";
    thesis.tags = normaliseTags([...thesis.tags, "motion"]);
    if (!thesis.text) thesis.text = thesis.title;
  }
  thesis.speaker = "you";
  thesis.group = "The motion";

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: DebateEdge[] = [];
  const edgeKeys = new Set<string>();
  for (const rawEdge of raw.edges) {
    const from = String(rawEdge.from ?? "").trim();
    const to = String(rawEdge.to ?? "").trim();
    const type = normaliseRelation(rawEdge.type);
    if (!type || !byId.has(from) || !byId.has(to) || from === to) continue;
    const key = `${from}|${to}|${type}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({
      id: String(rawEdge.id || `e_${from}_${type}_${to}`).slice(0, 120),
      from,
      to,
      type,
      note: rawEdge.note ? cleanText(rawEdge.note) : undefined
    });
  }

  // Connect components so every argument can be staged and seen.
  const connected = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const e of edges) {
    adjacency.get(e.from)?.push(e.to);
    adjacency.get(e.to)?.push(e.from);
  }
  const queue = [thesis.id];
  connected.add(thesis.id);
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!connected.has(next)) {
        connected.add(next);
        queue.push(next);
      }
    }
  }
  for (const node of nodes) {
    if (node.id === thesis.id || connected.has(node.id)) continue;
    const type: RelationType = node.stance === "con" ? "attack" : "support";
    edges.push({
      id: `e_auto_${node.id}`,
      from: node.id,
      to: thesis.id,
      type,
      note: "Attached automatically to keep the map connected"
    });
    connected.add(node.id);
  }

  const debate: Debate = {
    id: raw.id || uid("debate"),
    motion: cleanTitle(raw.motion || thesis.title, "Open debate", 160),
    thesisId: thesis.id,
    thesisText: thesis.text || thesis.title,
    nodes,
    edges,
    origin: raw.origin ?? "authored",
    position: raw.position ? cleanText(raw.position) : undefined,
    authorNote: raw.authorNote ? cleanText(raw.authorNote) : undefined,
    chat: Array.isArray(raw.chat) ? raw.chat.slice(-80) : [],
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now
  };

  deriveStances(debate);
  return debate;
}

/**
 * Propagate positions through the graph. A supporter of a pro node is pro;
 * an attacker of a pro node is con; an attacker of a con node is pro again.
 * The first path wins, which is stable for the tree-like maps we produce.
 */
export function deriveStances(debate: Debate): void {
  const byId = new Map(debate.nodes.map((n) => [n.id, n]));
  const thesis = byId.get(debate.thesisId);
  if (!thesis) return;

  const sign = new Map<string, 1 | -1>([[debate.thesisId, 1]]);
  const queue = [debate.thesisId];

  const neighbours = new Map<string, { id: string; type: RelationType; outgoing: boolean }[]>();
  for (const node of debate.nodes) neighbours.set(node.id, []);
  for (const edge of debate.edges) {
    neighbours.get(edge.from)?.push({ id: edge.to, type: edge.type, outgoing: true });
    neighbours.get(edge.to)?.push({ id: edge.from, type: edge.type, outgoing: false });
  }

  while (queue.length) {
    const current = queue.shift()!;
    const currentSign = sign.get(current);
    if (!currentSign) continue;
    for (const step of neighbours.get(current) ?? []) {
      if (sign.has(step.id)) continue;
      const flips = step.type !== "support";
      sign.set(step.id, flips ? ((currentSign * -1) as 1 | -1) : currentSign);
      queue.push(step.id);
    }
  }

  for (const node of debate.nodes) {
    if (node.id === debate.thesisId) {
      node.stance = "neutral";
      node.speaker = "you";
      continue;
    }
    const s = sign.get(node.id);
    if (s === 1) node.stance = "pro";
    else if (s === -1) node.stance = "con";
    else node.stance = node.stance === "neutral" ? "neutral" : node.stance;

    const taggedYou = node.tags.includes("you") || node.tags.includes("user");
    node.speaker = taggedYou ? "you" : node.stance === "pro" ? "advocate" : node.stance === "con" ? "challenger" : "moderator";
    if (!node.group || node.group === "Crossfire" || node.group === "For the motion" || node.group === "Against the motion") {
      node.group = STANCE_LABEL[node.stance];
    }
    node.tags = normaliseTags([...node.tags, node.stance, node.speaker]);
  }
}

export function debateSummary(debate: Debate): DebateSummary {
  return {
    id: debate.id,
    motion: debate.motion,
    thesisText: debate.thesisText,
    nodeCount: debate.nodes.length,
    edgeCount: debate.edges.length,
    origin: debate.origin,
    updatedAt: debate.updatedAt
  };
}

export function nodeById(debate: Debate, id: string): DebateNode | undefined {
  return debate.nodes.find((n) => n.id === id);
}

export function claimFromPrompt(prompt: string): string {
  const cleaned = cleanInline(prompt)
    .replace(/^i\s+(?:think|believe|feel|argue|hold|reckon)\s+(?:that\s+)?/i, "")
    .replace(/\s*(?:debate me|change my mind)\.?\s*$/i, "")
    .trim();
  if (!cleaned) return "";
  const isQuestion = /\?\s*$/.test(cleaned);
  const text = cleaned.replace(/[.?!]+$/, "").trim();
  if (!text) return "";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${isQuestion ? "?" : ""}`;
}

export function topicFromPrompt(prompt: string): string {
  const cleaned = claimFromPrompt(prompt) || cleanInline(prompt).replace(/[.?!]+$/, "");
  const about = cleaned.match(/\b(?:about|regarding|concerning|on the question of)\s+(.{3,120})$/i);
  if (about?.[1]) return cleanTitle(about[1].replace(/[.?!]+$/, ""), "Open debate");
  return cleanTitle(cleaned, "Open debate");
}

export function message(role: ChatMessage["role"], text: string, kind?: ChatMessage["kind"]): ChatMessage {
  return { id: uid("msg"), role, text, at: Date.now(), kind };
}
