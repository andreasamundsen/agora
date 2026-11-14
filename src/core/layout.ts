import { Debate, DebateEdge, DebateNode } from "./model";

export interface LayoutCard {
  node: DebateNode;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
  depth: number;
}

export interface LayoutEdge {
  edge: DebateEdge;
  path: string;
  labelX: number;
  labelY: number;
  cross: boolean;
}

export interface GraphLayout {
  cards: LayoutCard[];
  edges: LayoutEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
}

const COLUMN_GAP = 306;
const ROW_GAP = 20;
const CARD_WIDTH = 248;
const THESIS_WIDTH = 296;

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
 * A deterministic three-wing layout:
 *   pro side | motion | con side
 * Deeper responses sit further out in their own wing, so second-order
 * rebuttals never stack on top of the first exchange. No force simulation,
 * no jitter: the same debate always lays out the same way.
 */
export function computeLayout(debate: Debate): GraphLayout {
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
