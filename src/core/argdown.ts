import { Debate, DebateEdge, DebateNode } from "./model";

/**
 * Argdown serializer for Agora debates.
 *
 * Argdown defines a relation underneath the node it applies TO:
 *
 *   [The motion]
 *     - <A reason against>
 *
 * means the argument attacks the motion. We therefore emit each node's
 * definition once, then list every source acting on it. This survives the
 * official @argdown parser and keeps a clean pros/cons reading in the map.
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

function premiseComments(node: DebateNode): string[] {
  if (node.kind !== "argument" || !node.premises.length) return [];
  const lines: string[] = ["  // The reasoning behind this argument:"];
  node.premises.forEach((premise, index) => {
    lines.push(`  //   (${index + 1}) ${oneLine(premise)}`);
  });
  if (node.conclusion) lines.push(`  //   ∴ ${oneLine(node.conclusion)}`);
  return lines;
}

function sortNodes(debate: Debate): DebateNode[] {
  const root = debate.nodes.find((n) => n.id === debate.thesisId);
  const others = debate.nodes.filter((n) => n.id !== debate.thesisId);
  const order = new Map<string, number>([
    ["For the motion", 0],
    ["Against the motion", 1],
    ["Crossfire", 2]
  ]);
  others.sort((a, b) => {
    const ga = order.get(a.group) ?? 3;
    const gb = order.get(b.group) ?? 3;
    if (ga !== gb) return ga - gb;
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    if (a.stance !== b.stance) return a.stance.localeCompare(b.stance);
    return a.title.localeCompare(b.title);
  });
  return root ? [root, ...others] : others;
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

  let currentGroup = "";
  for (const node of sortNodes(debate).filter((n) => n.id !== debate.thesisId)) {
    const group = node.group || "Crossfire";
    if (group !== currentGroup) {
      currentGroup = group;
      lines.push(`## ${oneLine(group) || "Crossfire"}`);
      lines.push("");
    }
    lines.push(definitionFor(node));
    const tags = tagLine(node);
    if (tags) lines.push(tags);
    for (const edge of sortEdges(incoming.get(node.id) ?? [])) {
      const source = byId.get(edge.from);
      if (!source) continue;
      lines.push(`  ${RELATION_SYMBOL[edge.type]} ${referenceFor(source)}`);
    }
    lines.push(...premiseComments(node));
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
