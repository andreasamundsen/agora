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
  /** Short same-lane link routed around the outside of its column. */
  laneRoute?: boolean;
}

export interface GraphLayout {
  cards: LayoutCard[];
  edges: LayoutEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
  mode?: LayoutMode;
}

const COLUMN_GAP = 306;
const ROW_GAP = 20;
const CARD_WIDTH = 248;
const THESIS_WIDTH = 296;
const THREAD_GAP = 52;
const THREAD_SIBLING_GAP = 18;
const THREAD_ROW_GAP = 32;

function cardSize(node: DebateNode, isThesis: boolean): { width: number; height: number } {
  if (isThesis) {
    const titleLines = Math.min(3, Math.max(1, Math.ceil(node.title.length / 26)));
    const textLines = Math.min(5, Math.max(1, Math.ceil((node.text || node.title).length / 46)));
    const height = 44 + titleLines * 23 + textLines * 15;
    return { width: THESIS_WIDTH, height: Math.max(130, Math.min(210, height)) };
  }
  const titleLines = Math.min(2, Math.max(1, Math.ceil(node.title.length / 30)));
  const textLines = Math.min(3, Math.max(1, Math.ceil((node.text || node.title).length / 39)));
  const height = 42 + titleLines * 18 + textLines * 17;
  return { width: CARD_WIDTH, height: Math.max(96, Math.min(150, height)) };
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

/**
 * Parent-relative thread layout.
 *
 * Direct arguments stay in the two columns around the motion. Each response
 * hangs in the branch of the argument it answers and extends outward from the
 * centre. Replies at the same depth share an outward lane, packed beside the
 * direct columns rather than reserving a full subtree block in the direct
 * column. A con response to a pro argument stays on the pro side of the map,
 * where its parent is.
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

  // Direct arguments and replies use separate vertical lanes. A direct
  // argument's replies therefore do not reserve vertical space in the direct
  // column; the lanes are packed independently and can share the same rows.
  const branchNodes = new Map<"pro" | "con", Map<number, DebateNode[]>>([
    ["pro", new Map()],
    ["con", new Map()]
  ]);

  const visitBranch = (id: string, branch: "pro" | "con", depth: number, path: Set<string>) => {
    const node = byId.get(id);
    if (!node || path.has(id)) return;
    if (depth > 1) {
      const lanes = branchNodes.get(branch)!;
      const list = lanes.get(depth) ?? [];
      list.push(node);
      lanes.set(depth, list);
    }
    const nextPath = new Set(path);
    nextPath.add(id);
    for (const child of childrenOf.get(id) ?? []) visitBranch(child, branch, depth + 1, nextPath);
  };

  const proRoots = debate.nodes
    .filter((node) => node.id !== thesis.id && node.stance === "pro" && parentOf.get(node.id) === thesis.id)
    .sort((a, b) => a.title.localeCompare(b.title));
  const conRoots = debate.nodes
    .filter((node) => node.id !== thesis.id && node.stance === "con" && parentOf.get(node.id) === thesis.id)
    .sort((a, b) => a.title.localeCompare(b.title));

  for (const root of proRoots) visitBranch(root.id, "pro", 1, new Set());
  for (const root of conRoots) visitBranch(root.id, "con", 1, new Set());

  const placed = new Set<string>();
  const cardById = new Map<string, LayoutCard>();
  const addCard = (
    node: DebateNode,
    centerX: number,
    top: number,
    depth: number,
    branch: LayoutBranch,
    parentId: string | undefined
  ) => {
    const size = cardSize(node, false);
    const card: LayoutCard = {
      node,
      x: centerX - size.width / 2,
      y: top,
      width: size.width,
      height: size.height,
      column: branch === "pro" ? -Math.min(3, depth) : branch === "con" ? Math.min(3, depth) : 0,
      depth,
      branch,
      parentId
    };
    cards.push(card);
    cardById.set(node.id, card);
    placed.add(node.id);
    return card;
  };

  const placeDirectLane = (roots: DebateNode[], direction: -1 | 1, branch: "pro" | "con") => {
    const sizes = roots.map((node) => cardSize(node, false));
    const totalHeight = sizes.reduce((sum, size) => sum + size.height, 0) + THREAD_ROW_GAP * Math.max(0, roots.length - 1);
    let y = -totalHeight / 2;
    roots.forEach((node, index) => {
      const size = sizes[index]!;
      addCard(node, direction * COLUMN_GAP, y, 1, branch, thesis.id);
      y += size.height + THREAD_ROW_GAP;
    });
  };

  const placeReplyLanes = (branch: "pro" | "con", direction: -1 | 1) => {
    const lanes = branchNodes.get(branch)!;
    const laneDepths = [...lanes.keys()].sort((a, b) => a - b);
    for (const depth of laneDepths) {
      const nodes = lanes.get(depth)!;
      const items = nodes.map((node) => {
        const size = cardSize(node, false);
        const parent = parentOf.get(node.id);
        const parentCard = parent ? cardById.get(parent) : undefined;
        const preferred = parentCard ? parentCard.y + parentCard.height / 2 : 0;
        return { node, size, parentId: parent, preferred, center: 0 };
      });

      // Treat the replies to one parent as a small fan. One reply sits on the
      // parent's centre; several replies are distributed around it instead of
      // all being pushed downward.
      const siblingGroups = new Map<string, typeof items>();
      for (const item of items) {
        const key = item.parentId ?? `root:${item.node.id}`;
        const list = siblingGroups.get(key) ?? [];
        list.push(item);
        siblingGroups.set(key, list);
      }
      for (const group of siblingGroups.values()) {
        group.sort((a, b) => a.node.title.localeCompare(b.node.title));
        const wholeHeight = group.reduce((sum, item) => sum + item.size.height, 0) + THREAD_SIBLING_GAP * Math.max(0, group.length - 1);
        let offset = -wholeHeight / 2;
        for (const item of group) {
          const parentCard = item.parentId ? cardById.get(item.parentId) : undefined;
          const parentCenter = parentCard ? parentCard.y + parentCard.height / 2 : 0;
          item.preferred = parentCenter + offset + item.size.height / 2;
          offset += item.size.height + THREAD_SIBLING_GAP;
        }
      }
      items.sort((a, b) => a.preferred - b.preferred || a.node.title.localeCompare(b.node.title));

      // Replies to one parent form a small fan: one sits on the parent's
      // centre, several distribute around it. Remaining collisions are packed
      // downward just enough to keep the lane readable. There is deliberately
      // no lane-wide recentering after that.
      let nextTop = Number.NEGATIVE_INFINITY;
      for (const item of items) {
        const top = Math.max(item.preferred - item.size.height / 2, nextTop);
        item.center = top + item.size.height / 2;
        nextTop = top + item.size.height + THREAD_SIBLING_GAP;
      }
      const centerX = direction * (COLUMN_GAP + (depth - 1) * (CARD_WIDTH + THREAD_GAP));
      for (const item of items) {
        addCard(item.node, centerX, item.center - item.size.height / 2, depth, branch, parentOf.get(item.node.id));
      }
    }
  };

  placeDirectLane(proRoots, -1, "pro");
  placeDirectLane(conRoots, 1, "con");
  placeReplyLanes("pro", -1);
  placeReplyLanes("con", 1);

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
    const span = Math.hypot(a.x - b.x, a.y - b.y);
    // A large bow on a short diagonal link makes the path turn back at the
    // target, so the arrowhead can point away from the card. Keep short
    // secondary links straight; reserve the decorative bow for longer links.
    const secondaryBow = span < 90
      ? 0
      : (a.y + b.y >= 0 ? 1 : -1) * Math.min(150, 44 + Math.abs(a.x - b.x) * 0.09);
    const bow = secondary
      ? secondaryBow
      : sameBranch
        ? 12
        : 10;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 + bow;
    const lanePath = shortLanePath(source, target, secondary);
    const path = lanePath
      ?? `M ${round(a.x)} ${round(a.y)} Q ${round(mx)} ${round(my)} ${round(b.x)} ${round(b.y)}`;
    edges.push({ edge, path, labelX: mx, labelY: my, cross: crossesBranches, secondary, laneRoute: Boolean(lanePath) });
  }

  const allX = cards.flatMap((card) => [card.x, card.x + card.width]);
  const allY = cards.flatMap((card) => [card.y, card.y + card.height]);
  const minX = Math.min(...allX, -200);
  const maxX = Math.max(...allX, 200);
  const minY = Math.min(...allY, -160);
  const maxY = Math.max(...allY, 160);
  return {
    cards,
    edges,
    mode: "thread",
    bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Short same-lane links have almost no room for a normal top/bottom edge:
 * the cards are only a sibling gap apart, and the secondary bow used for
 * longer links dives behind the lower card. Route these links around the
 * outside of their lane instead, so the line and arrowhead stay visible.
 */
const SHORT_LANE_GAP = 64;
const SHORT_LANE_MARGIN = 12;
const SHORT_LANE_BOW = 26;

function shortLanePath(
  source: LayoutCard,
  target: LayoutCard,
  secondary?: boolean
): string | undefined {
  if (!secondary) return undefined;
  if (Math.abs(source.x - target.x) > 0.5) return undefined;

  const sourceAbove = source.y + source.height <= target.y;
  const targetAbove = target.y + target.height <= source.y;
  const gap = sourceAbove
    ? target.y - (source.y + source.height)
    : targetAbove
      ? source.y - (target.y + target.height)
      : -1;
  if (gap < 0 || gap > SHORT_LANE_GAP) return undefined;

  const wing = source.column !== 0
    ? Math.sign(source.column)
    : target.column !== 0
      ? Math.sign(target.column)
      : source.x + source.width / 2 >= 0
        ? 1
        : -1;
  const sideX = wing > 0
    ? Math.max(source.x + source.width, target.x + target.width) + SHORT_LANE_MARGIN
    : Math.min(source.x, target.x) - SHORT_LANE_MARGIN;
  const controlX = sideX + wing * SHORT_LANE_BOW;
  const startY = sourceAbove ? source.y + source.height - 10 : source.y + 10;
  const endY = sourceAbove ? target.y + 10 : target.y + target.height - 10;
  const controlY = (startY + endY) / 2;

  return `M ${round(sideX)} ${round(startY)} Q ${round(controlX)} ${round(controlY)} ${round(sideX)} ${round(endY)}`;
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
