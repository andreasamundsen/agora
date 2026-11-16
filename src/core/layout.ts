import { Debate, DebateEdge, DebateNode } from "./model";

export type LayoutMode = "case" | "thread";
export type LayoutBranch = "pro" | "con" | "neutral";

export interface LayoutCard {
  node: DebateNode;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
  depth: number;
  branch?: LayoutBranch;
  parentId?: string;
}

export interface LayoutEdge {
  edge: DebateEdge;
  path: string;
  labelX: number;
  labelY: number;
  cross: boolean;
  secondary?: boolean;
}

export interface LayoutRail {
  side: "pro" | "con";
  label: string;
  x: number;
  y: number;
  width: number;
}

export interface GraphLayout {
  cards: LayoutCard[];
  edges: LayoutEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
  mode?: LayoutMode;
  rails?: LayoutRail[];
}

const COLUMN_GAP = 306;
const ROW_GAP = 20;
const CARD_WIDTH = 248;
const THESIS_WIDTH = 296;
const THREAD_GAP = 52;
const THREAD_SIBLING_GAP = 18;
const BRANCH_GAP = 54;

function cardSize(node: DebateNode, isThesis: boolean): { width: number; height: number } {
  if (isThesis) return { width: THESIS_WIDTH, height: 190 };
  const titleLines = Math.min(2, Math.max(1, Math.ceil(node.title.length / 30)));
  const textLines = Math.min(2, Math.max(1, Math.ceil((node.text || node.title).length / 39)));
  const premiseRows = node.premises.length ? 1 : 0;
  const height = 44 + titleLines * 18 + textLines * 16 + premiseRows * 11;
  return { width: CARD_WIDTH, height: Math.max(96, Math.min(138, height)) };
}

function depths(debate: Debate): Map<string, number> {
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
      if (!depth.has(next)) {
        depth.set(next, (depth.get(current) ?? 0) + 1);
        queue.push(next);
      }
    }
  }
  for (const node of debate.nodes) if (!depth.has(node.id)) depth.set(node.id, 1);
  return depth;
}

function columnFor(node: DebateNode, depth: number, isThesis: boolean): number {
  if (isThesis) return 0;
  if (node.stance === "neutral") return 0;
  // A wing only needs two visual rings: the first exchange and everything
  // that answers it. Stacking deeper rebuttals further out makes the map
  // unreadably wide without adding information the edges do not already show.
  return node.stance === "pro" ? -Math.min(2, Math.max(1, depth)) : Math.min(2, Math.max(1, depth));
}

/**
 * Layout entry point. "case" is the original three-wing scoreboard; "thread"
 * keeps the direct cases in place but attaches each response to the argument
 * it answers.
 */
export function computeLayout(debate: Debate, mode: LayoutMode = "case"): GraphLayout {
  return mode === "thread" ? computeThreadLayout(debate) : computeCaseLayout(debate);
}

/**
 * A deterministic three-wing layout:
 *   pro side | motion | con side
 * Deeper responses sit further out in their own wing, so second-order
 * rebuttals never stack on top of the first exchange. No force simulation,
 * no jitter: the same debate always lays out the same way.
 */
function computeCaseLayout(debate: Debate): GraphLayout {
  const depthMap = depths(debate);
  const cards: LayoutCard[] = [];

  const thesis = debate.nodes.find((n) => n.id === debate.thesisId);
  if (thesis) {
    const size = cardSize(thesis, true);
    cards.push({
      node: thesis,
      x: -size.width / 2,
      y: -size.height / 2,
      width: size.width,
      height: size.height,
      column: 0,
      depth: 0
    });
  }

  const byColumn = new Map<number, DebateNode[]>();
  for (const node of debate.nodes) {
    if (node.id === debate.thesisId) continue;
    const depth = depthMap.get(node.id) ?? 1;
    const column = columnFor(node, depth, false);
    const list = byColumn.get(column) ?? [];
    list.push(node);
    byColumn.set(column, list);
  }

  const columns = [...byColumn.keys()].sort((a, b) => a - b);
  for (const column of columns) {
    const nodes = byColumn.get(column) ?? [];
    nodes.sort((a, b) => {
      const da = depthMap.get(a.id) ?? 1;
      const db = depthMap.get(b.id) ?? 1;
      if (da !== db) return da - db;
      if (a.stance !== b.stance) return a.stance.localeCompare(b.stance);
      return a.title.localeCompare(b.title);
    });

    const sizes = nodes.map((node) => cardSize(node, false));
    const totalHeight = sizes.reduce((sum, size) => sum + size.height, 0) + ROW_GAP * Math.max(0, sizes.length - 1);
    let y = -totalHeight / 2;
    const centerX = column === 0 ? 0 : Math.sign(column) * (COLUMN_GAP * Math.abs(column));

    nodes.forEach((node, index) => {
      const size = sizes[index]!;
      const x = column === 0 ? -size.width / 2 : centerX - size.width / 2;
      cards.push({
        node,
        x,
        y,
        width: size.width,
        height: size.height,
        column,
        depth: depthMap.get(node.id) ?? 1
      });
      y += size.height + ROW_GAP;
    });
  }

  // Neutral context sits below the motion rather than colliding with its side.
  const neutral = cards.filter((card) => card.column === 0 && card.node.id !== debate.thesisId);
  if (neutral.length) {
    const root = cards.find((c) => c.node.id === debate.thesisId);
    let y = (root ? root.y + root.height + 52 : 220);
    for (const card of neutral) {
      card.y = y;
      y += card.height + ROW_GAP;
    }
  }

  const byId = new Map(cards.map((card) => [card.node.id, card]));
  const edges: LayoutEdge[] = [];
  for (const edge of debate.edges) {
    const source = byId.get(edge.from);
    const target = byId.get(edge.to);
    if (!source || !target) continue;
    const a = anchor(source, target);
    const b = anchor(target, source);
    const cross = Math.sign(source.column) !== Math.sign(target.column) && source.column !== 0 && target.column !== 0;
    const sameColumn = source.column === target.column;
    const bow = cross ? (a.y + b.y >= 0 ? 1 : -1) * Math.min(150, 44 + Math.abs(a.x - b.x) * 0.09) : sameColumn ? 16 : 10;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 + bow;
    const path = `M ${round(a.x)} ${round(a.y)} Q ${round(mx)} ${round(my)} ${round(b.x)} ${round(b.y)}`;
    edges.push({ edge, path, labelX: mx, labelY: my, cross });
  }

  const allX = cards.flatMap((c) => [c.x, c.x + c.width]);
  const allY = cards.flatMap((c) => [c.y, c.y + c.height]);
  const minX = Math.min(...allX, -200);
  const maxX = Math.max(...allX, 200);
  const minY = Math.min(...allY, -160);
  const maxY = Math.max(...allY, 160);
  return {
    cards,
    edges,
    mode: "case",
    bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
  };
}

interface ThreadTree {
  node: DebateNode;
  children: ThreadTree[];
  height: number;
}

/**
 * Parent-relative thread layout.
 *
 * Direct arguments stay in the two columns around the motion. Each response
 * hangs in the branch of the argument it answers and extends outward from the
 * centre; sibling responses stack vertically. A con response to a pro
 * argument therefore stays on the pro side of the map, where its parent is.
 */
function computeThreadLayout(debate: Debate): GraphLayout {
  const thesis = debate.nodes.find((node) => node.id === debate.thesisId);
  const byId = new Map(debate.nodes.map((node) => [node.id, node]));
  const cards: LayoutCard[] = [];

  if (thesis) {
    const size = cardSize(thesis, true);
    cards.push({
      node: thesis,
      x: -size.width / 2,
      y: -size.height / 2,
      width: size.width,
      height: size.height,
      column: 0,
      depth: 0,
      branch: "neutral"
    });
  }

  if (!thesis) {
    return {
      cards,
      edges: [],
      mode: "thread",
      rails: [],
      bounds: { minX: -200, minY: -160, maxX: 200, maxY: 160, width: 400, height: 320 }
    };
  }

  // Distance along the directed edge chain, measured backwards from the
  // thesis. A response should sit under the target that is nearest the
  // motion when it answers more than one argument.
  const incoming = new Map<string, string[]>();
  for (const node of debate.nodes) incoming.set(node.id, []);
  for (const edge of debate.edges) {
    if (edge.from !== edge.to) incoming.get(edge.to)?.push(edge.from);
  }
  const distanceToThesis = new Map<string, number>([[thesis.id, 0]]);
  const queue = [thesis.id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of incoming.get(current) ?? []) {
      if (!distanceToThesis.has(next)) {
        distanceToThesis.set(next, (distanceToThesis.get(current) ?? 0) + 1);
        queue.push(next);
      }
    }
  }

  const direct = new Set<string>();
  for (const edge of debate.edges) {
    if (edge.to === thesis.id && edge.from !== thesis.id) direct.add(edge.from);
  }

  const parentOf = new Map<string, string>();
  for (const node of debate.nodes) {
    if (node.id === thesis.id) continue;
    if (direct.has(node.id)) {
      parentOf.set(node.id, thesis.id);
      continue;
    }
    const candidates = debate.edges
      .filter((edge) => edge.from === node.id && edge.to !== node.id)
      .sort((a, b) => {
        const da = distanceToThesis.get(a.to) ?? Number.POSITIVE_INFINITY;
        const db = distanceToThesis.get(b.to) ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
        return a.to.localeCompare(b.to);
      });
    if (candidates[0]) parentOf.set(node.id, candidates[0].to);
  }

  const childrenOf = new Map<string, string[]>();
  for (const [child, parent] of parentOf.entries()) {
    const list = childrenOf.get(parent) ?? [];
    list.push(child);
    childrenOf.set(parent, list);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => {
      const na = byId.get(a);
      const nb = byId.get(b);
      return (na?.title ?? a).localeCompare(nb?.title ?? b);
    });
  }

  const placed = new Set<string>();
  const buildTree = (id: string, path: Set<string>): ThreadTree => {
    const node = byId.get(id)!;
    const nextPath = new Set(path);
    nextPath.add(id);
    const childIds = (childrenOf.get(id) ?? []).filter((child) => !nextPath.has(child));
    const children = childIds.map((child) => buildTree(child, nextPath));
    const ownHeight = cardSize(node, false).height;
    const childrenHeight = children.reduce((sum, child) => sum + child.height, 0) + THREAD_SIBLING_GAP * Math.max(0, children.length - 1);
    return { node, children, height: Math.max(ownHeight, childrenHeight) };
  };

  const placeTree = (
    tree: ThreadTree,
    centerX: number,
    centerY: number,
    direction: -1 | 1,
    branch: LayoutBranch,
    depth: number
  ) => {
    placed.add(tree.node.id);
    const size = cardSize(tree.node, false);
    cards.push({
      node: tree.node,
      x: centerX - size.width / 2,
      y: centerY - size.height / 2,
      width: size.width,
      height: size.height,
      column: direction,
      depth,
      branch,
      parentId: parentOf.get(tree.node.id)
    });

    const childrenHeight = tree.children.reduce((sum, child) => sum + child.height, 0) + THREAD_SIBLING_GAP * Math.max(0, tree.children.length - 1);
    let cursor = centerY - childrenHeight / 2;
    for (const child of tree.children) {
      placeTree(
        child,
        centerX + direction * (CARD_WIDTH + THREAD_GAP),
        cursor + child.height / 2,
        direction,
        branch,
        depth + 1
      );
      cursor += child.height + THREAD_SIBLING_GAP;
    }
  };

  const placeRoots = (roots: ThreadTree[], direction: -1 | 1, branch: "pro" | "con") => {
    const totalHeight = roots.reduce((sum, root) => sum + root.height, 0) + BRANCH_GAP * Math.max(0, roots.length - 1);
    let cursor = -totalHeight / 2;
    for (const root of roots) {
      placeTree(root, direction * COLUMN_GAP, cursor + root.height / 2, direction, branch, 1);
      cursor += root.height + BRANCH_GAP;
    }
  };

  const proRoots = debate.nodes
    .filter((node) => node.id !== thesis.id && node.stance === "pro" && parentOf.get(node.id) === thesis.id)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((node) => buildTree(node.id, new Set()));
  const conRoots = debate.nodes
    .filter((node) => node.id !== thesis.id && node.stance === "con" && parentOf.get(node.id) === thesis.id)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((node) => buildTree(node.id, new Set()));

  placeRoots(proRoots, -1, "pro");
  placeRoots(conRoots, 1, "con");

  // Neutral context and anything not placed in a direct case tree get a
  // quiet column below the motion rather than being dropped from the map.
  const neutral = debate.nodes
    .filter((node) => node.id !== thesis.id && !placed.has(node.id))
    .sort((a, b) => a.title.localeCompare(b.title));
  const rootCard = cards.find((card) => card.node.id === thesis.id);
  let neutralY = rootCard ? rootCard.y + rootCard.height + 56 : 220;
  for (const node of neutral) {
    const size = cardSize(node, false);
    cards.push({
      node,
      x: -size.width / 2,
      y: neutralY,
      width: size.width,
      height: size.height,
      column: 0,
      depth: 1,
      branch: node.stance === "pro" || node.stance === "con" ? node.stance : "neutral",
      parentId: parentOf.get(node.id)
    });
    neutralY += size.height + ROW_GAP;
  }

  const rails: LayoutRail[] = [];
  for (const side of ["pro", "con"] as const) {
    const wing = cards.filter((card) => card.branch === side);
    if (!wing.length) continue;
    const minX = Math.min(...wing.map((card) => card.x));
    const maxX = Math.max(...wing.map((card) => card.x + card.width));
    const minY = Math.min(...wing.map((card) => card.y));
    rails.push({
      side,
      label: side === "pro" ? "Pro case" : "Con case",
      x: minX,
      y: minY - 30,
      width: maxX - minX
    });
  }

  const byCardId = new Map(cards.map((card) => [card.node.id, card]));
  const edges: LayoutEdge[] = [];
  for (const edge of debate.edges) {
    const source = byCardId.get(edge.from);
    const target = byCardId.get(edge.to);
    if (!source || !target) continue;
    const a = anchor(source, target);
    const b = anchor(target, source);
    const sourceBranch = source.branch;
    const targetBranch = target.branch;
    const secondary = parentOf.has(edge.from) && parentOf.get(edge.from) !== edge.to;
    const sameBranch = Boolean(sourceBranch && targetBranch && sourceBranch === targetBranch);
    const crossesBranches = Boolean(
      sourceBranch &&
      targetBranch &&
      sourceBranch !== "neutral" &&
      targetBranch !== "neutral" &&
      sourceBranch !== targetBranch
    );
    const bow = secondary
      ? (a.y + b.y >= 0 ? 1 : -1) * Math.min(150, 44 + Math.abs(a.x - b.x) * 0.09)
      : sameBranch
        ? 12
        : 10;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 + bow;
    const path = `M ${round(a.x)} ${round(a.y)} Q ${round(mx)} ${round(my)} ${round(b.x)} ${round(b.y)}`;
    edges.push({ edge, path, labelX: mx, labelY: my, cross: crossesBranches, secondary });
  }

  const allX = cards.flatMap((card) => [card.x, card.x + card.width]);
  const allY = cards.flatMap((card) => [card.y, card.y + card.height]);
  const railTop = rails.length ? Math.min(...rails.map((rail) => rail.y)) : Number.POSITIVE_INFINITY;
  const minX = Math.min(...allX, -200);
  const maxX = Math.max(...allX, 200);
  const minY = Math.min(...allY, railTop, -160);
  const maxY = Math.max(...allY, 160);
  return {
    cards,
    edges,
    mode: "thread",
    rails,
    bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Point where the line between two card centres crosses the card border. */
function anchor(from: LayoutCard, toward: LayoutCard): { x: number; y: number } {
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const tx = toward.x + toward.width / 2;
  const ty = toward.y + toward.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx === 0 ? Infinity : (from.width / 2 + 7) / Math.abs(dx),
    dy === 0 ? Infinity : (from.height / 2 + 7) / Math.abs(dy)
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}
