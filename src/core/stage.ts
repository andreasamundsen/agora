import { Debate, DebateEdge, DebateNode, Speaker, Stance } from "./model";

/**
 * Staging engine.
 *
 * A debate is not a slideshow: the sequence matters. We order the arguments
 * tied directly to the motion into alternating sides, then drain each root's
 * replies before moving to the next root. This is the same branch rhythm the
 * bench uses, but the stage seed is fresh for every cut. Same seed -> same
 * performance; a new seed -> a new cut.
 */

export type TurnKind = "opening" | "statement" | "support" | "attack" | "undercut" | "closing";

export interface DebateTurn {
  id: string;
  speaker: Speaker;
  stance: Stance;
  kind: TurnKind;
  nodeId?: string;
  targetId?: string;
  edgeId?: string;
  heading: string;
  text: string;
  reveal: string[];
  litEdges: string[];
  duration: number;
}

export interface StagedDebate {
  seed: number;
  turns: DebateTurn[];
  order: string[];
  stagedNodes: number;
  totalNodes: number;
  stats: { pro: number; con: number; undercuts: number; contested?: string };
}

const MAX_SUBSTANTIVE = 17;

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)] ?? items[0]!;
}

function cap(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed[0]!.toUpperCase() + trimmed.slice(1) : trimmed;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function shortTitle(title: string, max = 58): string {
  const clean = title.trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function spokenPremises(node: DebateNode): string[] {
  if (node.premises.length) return node.premises.filter(Boolean);
  return [node.text || node.title];
}

function argumentSpeech(node: DebateNode, rand: () => number): string {
  const premises = spokenPremises(node);
  const conclusion = sentence(node.conclusion || node.title);
  const p1 = sentence(premises[0] ?? "");
  const p2 = sentence(premises[1] ?? "");
  const extra = premises.length > 2 ? ` ${sentence(premises[2]!)}` : "";

  if (node.speaker === "challenger") {
    const options = [
      `Let's examine the steps, not just the headline. ${p1} ${p2}${extra} Even granting those, the leap to the conclusion needs defending: ${conclusion}`,
      `The case for the motion leans here: ${p1} ${p2}${extra} What worries me is the inference. ${conclusion}`,
      `Put the claim under pressure. ${p1} ${p2}${extra} That is supposed to establish the conclusion: ${conclusion} But the move is not automatic.`
    ];
    return pick(options, rand);
  }
  if (node.speaker === "you") {
    const options = [
      `My case, in my own words. ${p1} ${p2}${extra} That is how I get to this: ${conclusion}`,
      `I start from something I take to be true: ${p1} ${p2}${extra} The conclusion I draw is this: ${conclusion}`,
      `Here is why I hold the position. ${p1} ${p2}${extra} Taken together, they make the case. ${conclusion}`
    ];
    return pick(options, rand);
  }
  if (node.speaker === "moderator") {
    return `For the record, the claim before the chamber: ${sentence(node.text || node.title)}`;
  }
  const options = [
    `I'll build the case in two steps. ${p1} ${p2}${extra} That leads me to this conclusion: ${conclusion}`,
    `Begin with this: ${p1} Then add this: ${p2}${extra} The conclusion follows. ${conclusion}`,
    `The argument is not complicated. ${p1} ${p2}${extra} And so: ${conclusion}`
  ];
  return pick(options, rand);
}

function targetName(node: DebateNode, max = 58): string {
  return node.kind === "statement" && node.stance === "neutral" ? "the motion" : shortTitle(node.title, max);
}

function relationTail(
  edge: DebateEdge,
  target: DebateNode,
  direction: "out" | "in",
  rand: () => number
): string {
  const name = targetName(target);
  if (direction === "in") {
    const options = [
      `This is the claim ${target.speaker === "you" ? "the mover" : "already on the table"} is circling.`,
      `That claim now has to answer what has already been said about it.`,
      `It arrives with the earlier objection still standing.`
    ];
    return pick(options, rand);
  }
  if (edge.type === "support") {
    if (target.stance === "neutral") {
      return pick(
        ["That is a direct reason to affirm the motion.", "That props up the motion at its load-bearing point.", "So the motion has more support than it first appeared."],
        rand
      );
    }
    return pick(
      [`That strengthens ${name}.`, `It gives ${name} more weight, not merely more volume.`, `This is support for ${name} at the joint where it needs it.`],
      rand
    );
  }
  if (edge.type === "undercut") {
    return pick(
      [
        `Notice what this does: it does not deny the conclusion — it removes the ground ${name} stands on.`,
        `This is not a rival conclusion; it is an attack on the reasoning inside ${name}.`,
        `The move undercuts ${name}: grant its words, and the support still collapses.`
      ],
      rand
    );
  }
  return pick(
    [
      `That is the objection to ${name}.`,
      `So ${name} does not stand as stated.`,
      `This is where ${name} has to answer.`
    ],
    rand
  );
}

function turnHeading(node: DebateNode, edge: DebateEdge | undefined, target: DebateNode | undefined, direction: "out" | "in"): string {
  const speaker =
    node.speaker === "you" ? "You" : node.speaker === "advocate" ? "Advocate" : node.speaker === "challenger" ? "Challenger" : "Moderator";
  if (!edge || !target) return `${speaker} states a claim`;
  if (direction === "in") return `${speaker} takes up ${targetName(target, 44)}`;
  const verb = edge.type === "support" ? "supports" : edge.type === "undercut" ? "undercuts" : "challenges";
  return `${speaker} ${verb} ${targetName(target, 44)}`;
}

interface StageLink {
  node: DebateNode;
  edge: DebateEdge;
  target: DebateNode;
  direction: "out" | "in";
}

function stageRank(value: string, seed: number): number {
  let hash = 2166136261;
  const input = `${seed}|${value}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sortByStageSeed<T>(items: T[], key: (item: T) => string, seed: number): T[] {
  return [...items].sort(
    (a, b) => stageRank(key(a), seed) - stageRank(key(b), seed) || key(a).localeCompare(key(b))
  );
}

/**
 * Order the substantive nodes the way the bench plays a record: direct roots
 * alternate sides, and each root's replies are drained before the next root
 * begins. Unlike the bench's stable debate id, the stage seed is fresh for
 * every cut, so the same shape produces a different performance each time.
 */
function planStage(debate: Debate, thesis: DebateNode, seed: number): StageLink[] {
  const byId = new Map(debate.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>([thesis.id]);
  const plan: StageLink[] = [];

  const add = (node: DebateNode, edge: DebateEdge, target: DebateNode, direction: "out" | "in"): boolean => {
    if (node.id === thesis.id || visited.has(node.id) || plan.length >= MAX_SUBSTANTIVE) return false;
    visited.add(node.id);
    plan.push({ node, edge, target, direction });
    return true;
  };

  const childrenByTarget = new Map<string, DebateEdge[]>();
  for (const edge of debate.edges) {
    if (edge.from === edge.to || edge.from === thesis.id) continue;
    const list = childrenByTarget.get(edge.to) ?? [];
    list.push(edge);
    childrenByTarget.set(edge.to, list);
  }

  const drain = (parentId: string) => {
    if (plan.length >= MAX_SUBSTANTIVE) return;
    const children = sortByStageSeed(childrenByTarget.get(parentId) ?? [], (edge) => edge.id, seed);
    for (const edge of children) {
      if (plan.length >= MAX_SUBSTANTIVE) return;
      const child = byId.get(edge.from);
      const target = byId.get(edge.to);
      if (!child || !target || visited.has(child.id)) continue;
      if (add(child, edge, target, "out")) drain(child.id);
    }
  };

  const directByNode = new Map<string, DebateEdge[]>();
  for (const edge of debate.edges) {
    if (edge.to !== thesis.id || edge.from === thesis.id) continue;
    const list = directByNode.get(edge.from) ?? [];
    list.push(edge);
    directByNode.set(edge.from, list);
  }

  const bySide: Record<Stance, StageLink[]> = { pro: [], con: [], neutral: [] };
  for (const [nodeId, direct] of directByNode) {
    const node = byId.get(nodeId);
    if (!node) continue;
    const support = sortByStageSeed(direct.filter((edge) => edge.type === "support"), (edge) => edge.id, seed)[0];
    const clash = sortByStageSeed(direct.filter((edge) => edge.type !== "support"), (edge) => edge.id, seed)[0];
    const edge = support ?? clash;
    if (!edge) continue;
    const side: Stance = node.stance === "pro" || node.stance === "con" ? node.stance : support ? "pro" : "con";
    bySide[side].push({ node, edge, target: thesis, direction: "out" });
  }
  for (const side of ["pro", "con", "neutral"] as const) {
    bySide[side] = sortByStageSeed(bySide[side], (item) => item.node.id, seed);
  }

  const orderedRoots: StageLink[] = [];
  const startSide: "pro" | "con" = stageRank("case-order", seed) % 2 === 0 ? "pro" : "con";
  let turn: "pro" | "con" = startSide;
  while (bySide.pro.length || bySide.con.length) {
    if (turn === "pro" && bySide.pro.length) orderedRoots.push(bySide.pro.shift()!);
    else if (turn === "con" && bySide.con.length) orderedRoots.push(bySide.con.shift()!);
    else if (bySide.pro.length) orderedRoots.push(bySide.pro.shift()!);
    else if (bySide.con.length) orderedRoots.push(bySide.con.shift()!);
    turn = turn === "pro" ? "con" : "pro";
  }
  orderedRoots.push(...bySide.neutral);

  for (const root of orderedRoots) {
    if (plan.length >= MAX_SUBSTANTIVE) break;
    if (visited.has(root.node.id)) continue;
    if (add(root.node, root.edge, root.target, root.direction)) drain(root.node.id);
  }

  // A disconnected or merely awkward graph should still stage every reachable
  // claim. Roots and branches normally cover it; this is the safety net.
  const leftovers = sortByStageSeed(
    debate.nodes.filter((node) => node.id !== thesis.id && !visited.has(node.id)),
    (node) => node.id,
    seed
  );
  for (const node of leftovers) {
    if (plan.length >= MAX_SUBSTANTIVE) break;
    const edges = sortByStageSeed(
      debate.edges.filter((edge) => edge.from === node.id || edge.to === node.id),
      (edge) => edge.id,
      seed
    );
    const edge =
      edges.find((candidate) => candidate.from === node.id && visited.has(candidate.to)) ??
      edges.find((candidate) => candidate.to === node.id && visited.has(candidate.from));
    if (!edge) continue;
    const outgoing = edge.from === node.id;
    const target = byId.get(outgoing ? edge.to : edge.from);
    if (!target) continue;
    if (add(node, edge, target, outgoing ? "out" : "in")) drain(node.id);
  }

  return plan;
}

export function stageDebate(debate: Debate, seed = randomSeed()): StagedDebate {
  const rand = mulberry32(seed);
  const byId = new Map(debate.nodes.map((n) => [n.id, n]));
  const thesis = byId.get(debate.thesisId) ?? debate.nodes[0];
  const turns: DebateTurn[] = [];
  const revealed = new Set<string>();
  const order: string[] = [];

  if (!thesis) {
    return { seed, turns: [], order: [], stagedNodes: 0, totalNodes: 0, stats: { pro: 0, con: 0, undercuts: 0 } };
  }

  let turnIndex = 0;
  const pushTurn = (turn: Omit<DebateTurn, "id" | "duration"> & { duration?: number }) => {
    turnIndex += 1;
    const words = turn.text.split(/\s+/).length;
    turns.push({
      ...turn,
      id: `turn_${turnIndex}`,
      duration: turn.duration ?? Math.max(3200, Math.min(14000, 2400 + words * 180))
    });
  };

  pushTurn({
    speaker: "moderator",
    stance: "neutral",
    kind: "opening",
    heading: "The chamber opens",
    text: `The chamber is in session. The motion before it: “${debate.motion}”. ${
      debate.position ? "Our guest has come to defend a position, not merely to hear one described." : "The map is set; now let it be spoken."
    }`,
    reveal: [],
    litEdges: []
  });

  const hasUserVoice = Boolean(debate.position) || (debate.origin !== "imported" && thesis.speaker === "you");
  if (hasUserVoice) {
    const cameIn = debate.position
      ?.replace(/\s*(?:debate me|change my mind)\.?\s*$/i, "")
      .replace(/^i\s+(?:think|believe|feel|argue|hold|reckon)\s+(?:that\s+)?/i, "")
      .trim();
    const sameAsThesis =
      cameIn && cameIn.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ===
        thesis.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const echo = cameIn && !sameAsThesis ? ` I came in saying: “${sentence(cameIn)}”` : "";
    pushTurn({
      speaker: "you",
      stance: "neutral",
      kind: "statement",
      heading: "You put your position on the table",
      text: `${sentence(thesis.text || thesis.title)}${echo} Debate me.`.replace(/\s+/g, " ").trim(),
      nodeId: thesis.id,
      reveal: [thesis.id],
      litEdges: []
    });
  } else {
    pushTurn({
      speaker: "moderator",
      stance: "neutral",
      kind: "statement",
      heading: "The motion is read",
      text: `The claim before the chamber: ${sentence(thesis.text || thesis.title)} The question is whether it survives the strongest case that can be made against it.`,
      nodeId: thesis.id,
      reveal: [thesis.id],
      litEdges: []
    });
  }
  revealed.add(thesis.id);
  order.push(thesis.id);

  const plan = planStage(debate, thesis, seed);
  for (const chosen of plan) {
    const node = chosen.node;
    const target = chosen.target;
    const speech = node.kind === "argument" ? argumentSpeech(node, rand) : sentence(node.text || node.title);
    const tail = relationTail(chosen.edge, target, chosen.direction, rand);
    const text = `${speech} ${tail}`.replace(/\s+/g, " ").trim();

    pushTurn({
      speaker: node.speaker,
      stance: node.stance,
      kind: chosen.edge.type,
      nodeId: node.id,
      targetId: target.id,
      edgeId: chosen.edge.id,
      heading: turnHeading(node, chosen.edge, target, chosen.direction),
      text,
      reveal: [node.id],
      litEdges: [chosen.edge.id]
    });
    revealed.add(node.id);
    order.push(node.id);
  }

  const spoken = debate.nodes.filter((node) => revealed.has(node.id));
  const pro = spoken.filter((node) => node.stance === "pro").length;
  const con = spoken.filter((node) => node.stance === "con").length;
  const undercuts = turns.filter((turn) => turn.kind === "undercut").length;
  const contestedIds = new Set<string>();
  for (const edge of debate.edges) {
    if (revealed.has(edge.from) && revealed.has(edge.to) && (edge.type === "attack" || edge.type === "undercut")) {
      contestedIds.add(edge.to);
    }
  }
  const contested = [...contestedIds]
    .map((id) => byId.get(id))
    .filter((node): node is DebateNode => Boolean(node))
    .sort((a, b) => {
      const aCount = debate.edges.filter((edge) => edge.to === a.id && edge.type !== "support").length;
      const bCount = debate.edges.filter((edge) => edge.to === b.id && edge.type !== "support").length;
      return bCount - aCount;
    })[0];

  const unspoken = debate.nodes.length - revealed.size;
  pushTurn({
    speaker: "moderator",
    stance: "neutral",
    kind: "closing",
    heading: "The chamber adjourns",
    text: `The chamber has heard ${pro} ${pro === 1 ? "argument" : "arguments"} for the motion and ${con} against it${
      undercuts ? `, with ${undercuts} of the exchanges undercutting the reasoning rather than the conclusion` : ""
    }. ${
      contested ? `The sharpest pressure fell on “${shortTitle(contested.title, 70)}”.` : "The exchange leaves the central claim still contested."
    }${unspoken > 0 ? ` ${unspoken} ${unspoken === 1 ? "node was" : "nodes were"} left unstaged.` : ""} The question stays open — the map is yours to extend.`,
    reveal: [],
    litEdges: []
  });

  return {
    seed,
    turns,
    order,
    stagedNodes: revealed.size,
    totalNodes: debate.nodes.length,
    stats: { pro, con, undercuts, contested: contested?.id }
  };
}
