import { Debate, DebateEdge, DebateNode, Speaker, Stance } from "./model";

/**
 * Staging engine.
 *
 * A debate is not a slideshow: the sequence matters. We perform a seeded
 * random walk over the argument graph, always introducing a node that is
 * connected to something already said, preferring genuine clashes and
 * alternating sides. Same seed -> same performance; a new seed -> a new cut.
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

  const edgesByNode = new Map<string, DebateEdge[]>();
  for (const node of debate.nodes) edgesByNode.set(node.id, []);
  for (const edge of debate.edges) {
    edgesByNode.get(edge.from)?.push(edge);
    edgesByNode.get(edge.to)?.push(edge);
  }

  let lastStance: Stance = "neutral";
  let lastNodeId = thesis.id;
  let substantive = 0;
  let forced = 0;

  while (substantive < MAX_SUBSTANTIVE) {
    const candidates: {
      node: DebateNode;
      edge: DebateEdge;
      target: DebateNode;
      direction: "out" | "in";
      weight: number;
    }[] = [];

    for (const node of debate.nodes) {
      if (revealed.has(node.id)) continue;
      let best: { edge: DebateEdge; target: DebateNode; direction: "out" | "in"; weight: number } | null = null;
      for (const edge of edgesByNode.get(node.id) ?? []) {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) continue;
        const outgoing = edge.from === node.id;
        const target = outgoing ? to : from;
        if (!revealed.has(target.id)) continue;
        const base = edge.type === "attack" ? 4.2 : edge.type === "undercut" ? 3.4 : 1.25;
        const random = 0.65 + rand() * 0.85;
        let weight = (outgoing ? base : base * 0.45) * random;
        if (target.id === lastNodeId) weight *= 2.1;
        candidates.push({ node, edge, target, direction: outgoing ? "out" : "in", weight });
        if (!best || weight > best.weight) best = { edge, target, direction: outgoing ? "out" : "in", weight };
      }
      if (!best) continue;
      // If the candidate only has an incoming edge, lower it further so the
      // debate prefers arguments that act on what has already been said.
      if (best.direction === "in") best.weight *= 0.55;
    }

    // Collapse to one best link per candidate.
    const bestByNode = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      const current = bestByNode.get(candidate.node.id);
      if (!current || candidate.weight > current.weight) bestByNode.set(candidate.node.id, candidate);
    }
    let pool = [...bestByNode.values()];
    if (!pool.length) break;

    // The first two substantive turns guarantee one clash from each side.
    if (forced < 2) {
      const wanted: Stance = forced === 0 ? "con" : "pro";
      const preferred = pool.filter((c) => c.node.stance === wanted);
      if (preferred.length) pool = preferred;
      forced += 1;
    } else {
      for (const candidate of pool) {
        if (lastStance !== "neutral" && candidate.node.stance !== "neutral" && candidate.node.stance !== lastStance) {
          candidate.weight *= 1.55;
        }
        if (candidate.node.stance === "neutral") candidate.weight *= 0.35;
      }
    }

    const total = pool.reduce((sum, candidate) => sum + candidate.weight, 0);
    let roll = rand() * total;
    let chosen = pool[pool.length - 1]!;
    for (const candidate of pool) {
      roll -= candidate.weight;
      if (roll <= 0) {
        chosen = candidate;
        break;
      }
    }

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
    lastStance = node.stance;
    lastNodeId = node.id;
    substantive += 1;
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
