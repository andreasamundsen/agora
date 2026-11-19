import { Debate, DebateEdge, DebateNode } from "./model";

/**
 * Argdown serializer for Agora debates.
 *
 * Argdown defines a relation underneath the node it applies TO:
 *
 *   [The motion]
 *     - <A reason against>
 *
 * means the argument attacks the motion. We emit each node's definition once
 * in branch-first order, then list every source acting on it. Argument
 * reasoning is written as a native premise-conclusion structure so it is
 * available to the parser rather than hidden in comments.
 */

const RELATION_SYMBOL = {
  support: "+",
  attack: "-",
  undercut: "_"
} as const;

function oneLine(text: string): string {
  return String(text ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\[\]]/g, (m) => (m === "[" ? "(" : ")"))
    .replace(/[<>]/g, (m) => (m === "<" ? "(" : ")"))
    .trim();
}

function definitionFor(node: DebateNode): string {
  const title = oneLine(node.title).replace(/]/g, ")") || "Untitled";
  const body = oneLine(node.text || node.title);
  return node.kind === "argument" ? `<${title}>: ${body}` : `[${title}]: ${body}`;
}

function referenceFor(node: DebateNode): string {
  const title = oneLine(node.title).replace(/]/g, ")").replace(/>/g, ")") || "Untitled";
  return node.kind === "argument" ? `<${title}>` : `[${title}]`;
}

function tagLine(node: DebateNode): string {
  const tags = new Set<string>();
  if (node.stance !== "neutral") tags.add(node.stance);
  if (node.speaker === "you") tags.add("you");
  for (const tag of node.tags) {
    if (["motion", "thesis", "pro", "con", "advocate", "challenger", "you", "moderator", "neutral"].includes(tag)) {
      if (tag === "pro" || tag === "con" || tag === "you" || tag === "motion") tags.add(tag);
    } else if (/^[a-z0-9-]+$/.test(tag)) {
      tags.add(tag);
    }
  }
  if (!tags.size) return "";
  return `  ${[...tags].map((t) => `#${t}`).join(" ")}`;
}

function pcsLines(node: DebateNode): string[] {
  if (node.kind !== "argument" || !node.premises.length || !node.conclusion) return [];
  const premises = node.premises.map((premise, index) => `(${index + 1}) ${oneLine(premise)}`);
  const conclusion = `(${premises.length + 1}) ${oneLine(node.conclusion)}`;
  return ["", ...premises, "----", conclusion];
}

function structuralOrder(debate: Debate, incoming: Map<string, DebateEdge[]>): DebateNode[] {
  const byId = new Map(debate.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const order: DebateNode[] = [];
  const visit = (node: DebateNode | undefined) => {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);
    order.push(node);
    for (const edge of sortEdges(incoming.get(node.id) ?? [])) {
      visit(byId.get(edge.from));
    }
  };
  visit(byId.get(debate.thesisId));
  for (const node of debate.nodes) visit(node);
  return order;
}

export function toArgdown(debate: Debate): string {
  const byId = new Map(debate.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, DebateEdge[]>();
  for (const node of debate.nodes) incoming.set(node.id, []);
  for (const edge of debate.edges) {
    if (byId.has(edge.from) && byId.has(edge.to)) incoming.get(edge.to)?.push(edge);
  }

  const lines: string[] = [];
  lines.push("# The motion");
  lines.push("");

  const thesis = debate.nodes.find((n) => n.id === debate.thesisId);
  if (thesis) {
    lines.push(definitionFor(thesis));
    const tags = tagLine({ ...thesis, stance: "neutral" });
    if (tags) lines.push(tags);
    for (const edge of sortEdges(incoming.get(thesis.id) ?? [])) {
      const source = byId.get(edge.from);
      if (!source) continue;
      lines.push(`  ${RELATION_SYMBOL[edge.type]} ${referenceFor(source)}`);
    }
    lines.push("");
  }

  for (const node of structuralOrder(debate, incoming).filter((n) => n.id !== debate.thesisId)) {
    lines.push(definitionFor(node));
    const tags = tagLine(node);
    if (tags) lines.push(tags);
    for (const edge of sortEdges(incoming.get(node.id) ?? [])) {
      const source = byId.get(edge.from);
      if (!source) continue;
      lines.push(`  ${RELATION_SYMBOL[edge.type]} ${referenceFor(source)}`);
    }
    lines.push(...pcsLines(node));
    lines.push("");
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function sortEdges(edges: DebateEdge[]): DebateEdge[] {
  const rank = { support: 0, attack: 1, undercut: 2 } as const;
  return [...edges].sort((a, b) => rank[a.type] - rank[b.type] || a.from.localeCompare(b.from));
}

/**
 * A compact, line-addressable view for LLM prompts. Keeps token use low while
 * giving the model the actual IDs and relation directions it must extend.
 */
export function debateContext(debate: Debate, maxChars = 9000): string {
  const parts: string[] = [];
  parts.push(`MOTION: ${debate.motion}`);
  parts.push(`THESIS (${debate.thesisId}): ${debate.thesisText}`);
  parts.push("NODES:");
  for (const n of debate.nodes) {
    const connector = n.kind === "argument" ? "ARG" : "STMT";
    parts.push(`- [${n.id}] ${connector} ${n.title} — ${n.text}${n.premises.length ? ` (premises: ${n.premises.join(" | ")})` : ""}`);
  }
  parts.push("EDGES:");
  for (const e of debate.edges) {
    if (e.note === "Attached automatically to keep the map connected") continue;
    parts.push(`- ${e.from} --${e.type}--> ${e.to}`);
  }
  return parts.join("\n").slice(0, maxChars);
}
