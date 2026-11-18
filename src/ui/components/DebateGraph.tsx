import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Debate, DebateEdge, DebateNode } from "../../core/model";
import { computeLayout, LayoutCard, LayoutMode } from "../../core/layout";
import {
  OUTCOME_SHORT,
  type ArgumentStatus,
  type ClashVerdict,
  type JudgmentOutcome
} from "../../core/judgment";

export interface GraphStage {
  active: boolean;
  revealed: Set<string>;
  focusId?: string;
  litEdges: Set<string>;
  turnKey: string;
}

export interface GraphJudgment {
  active: boolean;
  statuses: Record<string, ArgumentStatus>;
  weakened: string[];
  activeEdgeId?: string;
  activeNodeIds: string[];
  /** A direct support being introduced before its first incoming clash. */
  caseLineEdgeId?: string;
  caseLineNodeId?: string;
  reinstated: string[];
  /** Direct supports certified as proved after the assessment completes. */
  proved: string[];
  /** The motion itself carries a proof marker. */
  motionProved: boolean;
  verdictByEdge: Record<string, ClashVerdict>;
  complete: boolean;
  outcome?: JudgmentOutcome;
  /** Outcome shown on the motion card; may be provisional while in session. */
  motionDisposition: JudgmentOutcome;
  motionProvisional: boolean;
  unsupportedThesis: boolean;
}

export interface GraphHandle {
  fit: () => void;
  smart: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface Props {
  debate: Debate;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  stage?: GraphStage;
  judgment?: GraphJudgment;
}

const EDGE_COLORS: Record<DebateEdge["type"], string> = {
  support: "var(--pro)",
  attack: "var(--con)",
  undercut: "var(--under)"
};

const STATUS_LABEL: Record<ArgumentStatus | "unsupported", string> = {
  standing: "Stands",
  defeated: "Defeated",
  contested: "Contested",
  unsupported: "Unsupported"
};

export const DebateGraph = forwardRef<GraphHandle, Props>(function DebateGraph(
  { debate, selectedId, onSelect, stage, judgment },
  ref
) {
  const [view, setView] = useState<LayoutMode>("case");
  // Judgment reads as a branch walk, so it always uses Thread view. The
  // reader's previous view returns when the bench closes.
  const activeView: LayoutMode = judgment?.active ? "thread" : view;
  const layout = useMemo(() => computeLayout(debate, activeView), [debate, activeView]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(0.9);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [smooth, setSmooth] = useState(true);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const sizeRef = useRef(size);
  const previousSizeRef = useRef(size);
  const autoViewRef = useRef(true);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);

  zoomRef.current = zoom;
  panRef.current = pan;
  sizeRef.current = size;

  useEffect(() => {
    setView("case");
  }, [debate.id]);

  const fit = useCallback(() => {
    const el = containerRef.current;
    const width = el?.clientWidth || sizeRef.current.width;
    const height = el?.clientHeight || sizeRef.current.height;
    if (!width || !height) return;
    autoViewRef.current = true;
    const b = layout.bounds;
    const pad = Math.min(84, Math.max(30, Math.min(width, height) * 0.1));
    const z = Math.max(0.24, Math.min(1.06, Math.min((width - pad * 2) / b.width, (height - pad * 2) / b.height)));
    const cx = b.minX + b.width / 2;
    const cy = b.minY + b.height / 2;
    setZoom(z);
    setPan({ x: width / 2 - cx * z, y: height / 2 - cy * z });
    setSmooth(true);
  }, [layout]);

  /**
   * Dense maps open as a complete overview; small maps open at a readable
   * scale. The Fit control is always available either way.
   */
  const smartView = useCallback(() => {
    const el = containerRef.current;
    const width = el?.clientWidth || sizeRef.current.width;
    const height = el?.clientHeight || sizeRef.current.height;
    if (!width || !height) return;
    autoViewRef.current = true;
    const b = layout.bounds;
    const pad = Math.min(84, Math.max(30, Math.min(width, height) * 0.1));
    const fitZoom = Math.min((width - pad * 2) / b.width, (height - pad * 2) / b.height);
    if (debate.nodes.length > 10 || fitZoom >= 0.5) {
      fit();
      return;
    }
    const root = layout.cards.find((card) => card.node.id === debate.thesisId) ?? layout.cards[0];
    if (!root) return;
    const z = Math.min(0.8, Math.max(0.62, (width - 40) / (2 * 306 + 248)));
    const cx = root.x + root.width / 2;
    const cy = root.y + root.height / 2;
    setZoom(z);
    setPan({ x: width / 2 - cx * z, y: height * 0.5 - cy * z });
    setSmooth(true);
  }, [fit, layout, debate.thesisId, debate.nodes.length]);

  const zoomAround = useCallback((clientX: number, clientY: number, nextZoom: number) => {
    const container = containerRef.current;
    if (!container) return;
    autoViewRef.current = false;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;
    const worldX = (x - currentPan.x) / currentZoom;
    const worldY = (y - currentPan.y) / currentZoom;
    setZoom(nextZoom);
    setPan({ x: x - worldX * nextZoom, y: y - worldY * nextZoom });
    setSmooth(false);
  }, []);

  useImperativeHandle(ref, () => ({
    fit,
    smart: smartView,
    zoomIn: () => {
      const s = sizeRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      zoomAround((rect?.left ?? 0) + s.width / 2, (rect?.top ?? 0) + s.height / 2, Math.min(1.7, zoomRef.current * 1.18));
    },
    zoomOut: () => {
      const s = sizeRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      zoomAround((rect?.left ?? 0) + s.width / 2, (rect?.top ?? 0) + s.height / 2, Math.max(0.22, zoomRef.current / 1.18));
    }
  }), [fit, smartView, zoomAround]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const initialisedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!size.width || !size.height) return;
    if (initialisedFor.current === debate.id) return;
    initialisedFor.current = debate.id;
    smartView();
  }, [debate.id, size.width, size.height, smartView]);

  // Static view follows the frame: refit while the camera is automatic, and
  // preserve the world centre once the reader has panned or zoomed. The
  // staging and judgment cameras keep their own behaviour.
  useEffect(() => {
    const previous = previousSizeRef.current;
    previousSizeRef.current = size;
    if (!size.width || !size.height || !previous.width || !previous.height) return;
    if (size.width === previous.width && size.height === previous.height) return;
    if (stage?.active || judgment?.active) return;
    if (autoViewRef.current) {
      smartView();
      return;
    }
    const currentZoom = zoomRef.current;
    const centerX = (previous.width / 2 - panRef.current.x) / currentZoom;
    const centerY = (previous.height / 2 - panRef.current.y) / currentZoom;
    setPan({
      x: size.width / 2 - centerX * currentZoom,
      y: size.height / 2 - centerY * currentZoom
    });
    setSmooth(true);
  }, [size, stage?.active, judgment?.active, smartView]);

  const wasStaging = useRef(false);
  useEffect(() => {
    if (stage?.active) {
      wasStaging.current = true;
      return;
    }
    if (!wasStaging.current) return;
    wasStaging.current = false;
    const timer = window.setTimeout(() => smartView(), 460);
    return () => window.clearTimeout(timer);
  }, [stage?.active, smartView]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".graph-inspector")) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0013);
      const next = Math.max(0.22, Math.min(1.7, zoomRef.current * factor));
      zoomAround(event.clientX, event.clientY, next);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [zoomAround]);

  // Stage camera: keep the node being argued in view.
  useEffect(() => {
    if (!stage?.active || !stage.focusId) return;
    const card = layout.cards.find((c) => c.node.id === stage.focusId);
    const { width, height } = sizeRef.current;
    if (!card || !width || !height) return;
    const targetZoom = Math.max(0.78, Math.min(1.12, zoomRef.current));
    const cx = card.x + card.width / 2;
    const cy = card.y + card.height / 2;
    setZoom(targetZoom);
    setPan({ x: width / 2 - cx * targetZoom, y: height * 0.44 - cy * targetZoom });
    setSmooth(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage?.turnKey, stage?.focusId, stage?.active, layout]);

  useEffect(() => {
    if (!stage?.active) {
      if (!judgment?.active) smartView();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debate.id, layout, judgment?.active]);

  const wasJudging = useRef(false);
  useEffect(() => {
    if (judgment?.active) {
      wasJudging.current = true;
      const timer = window.setTimeout(() => fit(), 420);
      return () => window.clearTimeout(timer);
    }
    if (!wasJudging.current) return;
    wasJudging.current = false;
    const timer = window.setTimeout(() => smartView(), 460);
    return () => window.clearTimeout(timer);
  }, [judgment?.active, fit, smartView]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedId) onSelect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, onSelect]);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".graph-node, .graph-controls, .graph-legend, .graph-hidden, .graph-inspector")) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, moved: false };
    setDragging(true);
    setSmooth(false);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      drag.moved = true;
      autoViewRef.current = false;
    }
    setPan({ x: drag.panX + dx, y: drag.panY + dy });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag && !drag.moved) onSelect(null);
    dragRef.current = null;
    setDragging(false);
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  const revealed = stage?.active ? stage.revealed : null;
  const isCurrent = (id: string) => Boolean(stage?.active && stage.focusId === id);
  const hiddenCount = useMemo(() => {
    if (!size.width || !size.height) return 0;
    const minX = -pan.x / zoom;
    const minY = -pan.y / zoom;
    const maxX = (size.width - pan.x) / zoom;
    const maxY = (size.height - pan.y) / zoom;
    return layout.cards.filter(
      (card) =>
        card.x + card.width < minX + 18 ||
        card.x > maxX - 18 ||
        card.y + card.height < minY + 18 ||
        card.y > maxY - 18
    ).length;
  }, [layout, pan, zoom, size]);
  const edgesVisible = layout.edges.filter(({ edge }) => {
    if (!revealed) return true;
    return revealed.has(edge.from) && revealed.has(edge.to);
  });
  const viewLocked = Boolean(stage?.active || judgment?.active);

  return (
    <div
      ref={containerRef}
      className={`graph ${activeView === "thread" ? "is-thread" : ""} ${dragging ? "is-dragging" : ""} ${stage?.active ? "is-staging" : ""} ${judgment?.active ? "is-judging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="application"
      aria-label="Debate argument map. Drag to pan, scroll to zoom. Select a node for details."
    >
      {judgment?.active ? (
        <div className="graph-legend graph-legend--judgment" aria-hidden="true">
          <span className="legend-title">The record</span>
          <span className="legend-item"><i className="status-swatch status-swatch--standing" /> stands</span>
          <span className="legend-item"><i className="status-swatch status-swatch--weakened" /> weakened</span>
          <span className="legend-item"><i className="status-swatch status-swatch--contested" /> contested</span>
          <span className="legend-item"><i className="status-swatch status-swatch--defeated" /> defeated</span>
          <span className="legend-item"><i className="status-swatch status-swatch--proved" /> proved</span>
        </div>
      ) : (
        <div className="graph-legend" aria-hidden="true">
          <span className="legend-title">The map</span>
          <span className="legend-item"><i className="line line--support" /> supports</span>
          <span className="legend-item"><i className="line line--attack" /> attacks</span>
          <span className="legend-item"><i className="line line--undercut" /> undercuts</span>
        </div>
      )}

      {judgment?.active && judgment.complete && judgment.outcome && (
        <div className={`judgment-seal judgment-seal--${judgment.outcome}`} aria-hidden="true">
          <span>The motion</span>
          <b>{OUTCOME_SHORT[judgment.outcome]}</b>
        </div>
      )}

      <div className="graph-controls">
        <button type="button" className="icon-btn" onClick={() => zoomAround(
          (containerRef.current?.getBoundingClientRect().left ?? 0) + size.width / 2,
          (containerRef.current?.getBoundingClientRect().top ?? 0) + size.height / 2,
          Math.max(0.22, zoom / 1.18)
        )} aria-label="Zoom out">−</button>
        <span className="graph-zoom-label">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-btn" onClick={() => zoomAround(
          (containerRef.current?.getBoundingClientRect().left ?? 0) + size.width / 2,
          (containerRef.current?.getBoundingClientRect().top ?? 0) + size.height / 2,
          Math.min(1.7, zoom * 1.18)
        )} aria-label="Zoom in">+</button>
        <span className="control-sep" />
        <button type="button" className="icon-btn icon-btn--wide" onClick={fit} aria-label="Fit map to view">Fit</button>
        <span className="control-sep" />
        <div className="graph-view-toggle" role="group" aria-label="Map layout">
          <button
            type="button"
            className={activeView === "case" ? "is-active" : ""}
            aria-pressed={activeView === "case"}
            onClick={() => setView("case")}
            disabled={viewLocked}
            title="Case view: arguments grouped by side"
          >
            Case
          </button>
          <button
            type="button"
            className={activeView === "thread" ? "is-active" : ""}
            aria-pressed={activeView === "thread"}
            onClick={() => setView("thread")}
            disabled={viewLocked}
            title="Thread view: responses attached to the argument they answer"
          >
            Thread
          </button>
        </div>
      </div>

      {!stage?.active && !judgment?.active && hiddenCount > 0 && (
        <button type="button" className="graph-hidden" onClick={fit} title="Zoom out to show the whole map">
          <span className="graph-hidden-dot" />
          {hiddenCount} node{hiddenCount === 1 ? "" : "s"} outside the frame
          <b>Fit</b>
        </button>
      )}

      {!dragging && (
        <div className="graph-hint" aria-hidden="true">
          {judgment?.active
            ? judgment.caseLineEdgeId
              ? "a case line is entered · select a node to inspect"
              : "the bench is following the record · select a node to inspect"
            : activeView === "thread"
              ? <>responses follow the argument they answer <span>·</span> drag to pan <span>·</span> scroll to zoom</>
              : <>drag to pan <span>·</span> scroll to zoom <span>·</span> select a node to inspect</>}
        </div>
      )}

      {size.width > 0 && (
        <>
          <svg className="graph-edges" width={size.width} height={size.height} aria-hidden="true">
            <defs>
              {(Object.keys(EDGE_COLORS) as DebateEdge["type"][]).map((type) => (
                <marker
                  key={type}
                  id={`arrow-${type}`}
                  viewBox="0 0 12 12"
                  refX="9"
                  refY="6"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 1 1 L 10 6 L 1 11 z" style={{ fill: EDGE_COLORS[type] }} />
                </marker>
              ))}
              <marker
                id="arrow-judge"
                viewBox="0 0 12 12"
                refX="9"
                refY="6"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 1 1 L 10 6 L 1 11 z" style={{ fill: "var(--gold)" }} />
              </marker>
            </defs>
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`} className={smooth ? "edge-layer smooth" : "edge-layer"}>
              {edgesVisible.map(({ edge, path, labelX, labelY, secondary }) => {
                const active = stage?.active && stage.litEdges.has(edge.id);
                const clash = Boolean(judgment?.active && judgment.activeEdgeId === edge.id);
                const caseLine = Boolean(judgment?.active && judgment.caseLineEdgeId === edge.id);
                const judged = judgment?.active ? judgment.verdictByEdge[edge.id] : undefined;
                const connected = hoverId && (edge.from === hoverId || edge.to === hoverId);
                const dim = Boolean(hoverId) && !connected;
                const color = EDGE_COLORS[edge.type];
                const lit = active || clash || caseLine;
                return (
                  <g
                    key={edge.id}
                    className={`graph-edge ${active ? "is-active" : ""} ${clash ? "is-clash" : ""} ${caseLine ? "is-case-line" : ""} ${judged ? `is-judged is-judged--${judged}` : ""} ${dim ? "is-dim" : ""} ${connected ? "is-connected" : ""} ${secondary ? "is-secondary" : ""}`}
                    style={{ ["--edge-color" as string]: color }}
                  >
                    <path
                      d={path}
                      className={`edge-path edge-path--${edge.type} ${edge.type === "undercut" ? "is-dashed" : ""}`}
                      markerEnd={clash ? "url(#arrow-judge)" : `url(#arrow-${edge.type})`}
                    />
                    {lit && (
                      <>
                        <circle r="9" className="edge-halo">
                          <animateMotion dur="2.2s" repeatCount="indefinite" path={path} />
                        </circle>
                        <circle r="3.6" className="edge-pulse-dot">
                          <animateMotion dur="2.2s" repeatCount="indefinite" path={path} />
                        </circle>
                      </>
                    )}
                    <text x={labelX} y={labelY - 7} className="edge-glyph">
                      {edge.type === "support" ? "+" : edge.type === "attack" ? "−" : "⌁"}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          <div
            className={`graph-node-layer ${smooth ? "smooth" : ""}`}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            {layout.cards.map((card) => {
              const nodeRevealed = !stage?.active || stage.revealed.has(card.node.id);
              const judgmentStatus = judgment?.statuses[card.node.id];
              const roleIndex = judgment?.active ? judgment.activeNodeIds.indexOf(card.node.id) : -1;
              const judgmentRole = roleIndex === 0 ? "source" : roleIndex === 1 ? "target" : undefined;
              const judgmentDim = Boolean(
                judgment?.active &&
                judgment.activeNodeIds.length > 0 &&
                roleIndex < 0 &&
                !judgment.complete
              );
              return (
                <NodeCard
                  key={card.node.id}
                  card={card}
                  debate={debate}
                  isThesis={card.node.id === debate.thesisId}
                  selected={selectedId === card.node.id}
                  hovered={hoverId === card.node.id}
                  current={isCurrent(card.node.id)}
                  dimmed={!nodeRevealed}
                  judgmentDim={judgmentDim}
                  staged={Boolean(stage?.active)}
                  judging={Boolean(judgment?.active)}
                  judgmentStatus={judgmentStatus}
                  weakened={Boolean(judgment?.weakened.includes(card.node.id))}
                  caseLine={Boolean(judgment?.active && judgment.caseLineNodeId === card.node.id)}
                  judgmentRole={judgmentRole}
                  motionDisposition={judgment?.motionDisposition}
                  motionProvisional={Boolean(judgment?.motionProvisional)}
                  proved={Boolean(judgment?.proved.includes(card.node.id))}
                  motionProved={Boolean(judgment?.motionProved && card.node.id === debate.thesisId)}
                  reinstated={Boolean(judgment?.reinstated.includes(card.node.id))}
                  unsupported={Boolean(judgment?.unsupportedThesis && card.node.id === debate.thesisId)}
                  onHover={setHoverId}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
});

interface NodeCardProps {
  card: LayoutCard;
  debate: Debate;
  isThesis: boolean;
  selected: boolean;
  hovered: boolean;
  current: boolean;
  dimmed: boolean;
  judgmentDim: boolean;
  staged: boolean;
  judging: boolean;
  judgmentStatus?: ArgumentStatus;
  weakened: boolean;
  caseLine: boolean;
  judgmentRole?: "source" | "target";
  motionDisposition?: JudgmentOutcome;
  motionProvisional: boolean;
  proved: boolean;
  motionProved: boolean;
  reinstated: boolean;
  unsupported: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

function NodeCard({
  card,
  isThesis,
  selected,
  hovered,
  current,
  dimmed,
  judgmentDim,
  staged,
  judging,
  judgmentStatus,
  weakened,
  caseLine,
  judgmentRole,
  motionDisposition,
  motionProvisional,
  proved,
  motionProved,
  reinstated,
  unsupported,
  onHover,
  onSelect
}: NodeCardProps) {
  const node = card.node;
  const motion = isThesis && judging ? motionDisposition : undefined;
  const displayStatus = !motion && unsupported && judgmentStatus === "standing" ? "unsupported" : judgmentStatus;
  const showWeakened = weakened && !isThesis && !motion && displayStatus === "standing";
  const statusKey = motion ? undefined : showWeakened ? "weakened" : displayStatus;
  const statusLabel = motion
    ? OUTCOME_SHORT[motion]
    : showWeakened
      ? "Weakened"
      : displayStatus
        ? STATUS_LABEL[displayStatus]
        : null;
  return (
    <button
      type="button"
      className={[
        "graph-node",
        `graph-node--${node.kind}`,
        `stance-${node.stance}`,
        isThesis ? "graph-node--thesis" : "",
        selected ? "is-selected" : "",
        hovered ? "is-hovered" : "",
        current ? "is-current" : "",
        dimmed ? "is-unrevealed" : "",
        judgmentDim ? "is-judgment-dim" : "",
        staged ? "is-staged" : "",
        judging ? "is-judging" : "",
        motion ? `is-motion-${motion}` : statusKey ? `is-${statusKey}` : "",
        showWeakened ? "is-weakened" : "",
        caseLine ? "is-case-line" : "",
        judgmentRole ? `is-clash-${judgmentRole}` : "",
        proved ? "is-proved" : "",
        motionProved ? "is-motion-proved" : "",
        reinstated ? "is-reinstated" : ""
      ].join(" ")}
      style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
      onClick={(event) => {
        event.stopPropagation();
        if (dimmed) return;
        onSelect(node.id);
      }}
      onPointerEnter={() => onHover(node.id)}
      onPointerLeave={() => onHover(null)}
      aria-label={`${node.kind === "argument" ? "Argument" : "Statement"}: ${node.title}. ${node.stance === "pro" ? "For the motion" : node.stance === "con" ? "Against the motion" : "Neutral"}.${statusLabel ? ` ${motion ? "Motion status" : "Status"}: ${statusLabel}${motion && motionProvisional ? " (in session)" : ""}.` : ""}${proved ? " Proved." : ""}${motionProved ? " The motion is proved." : ""}`}
    >
      <div className="node-top">
        <span className={`node-kind ${isThesis ? "node-kind--motion" : ""}`}>
          {isThesis ? "The motion" : node.kind === "argument" ? "Argument" : "Statement"}
        </span>
        <div className="node-badges">
          {statusLabel ? (
            <span
              className={`node-judgment ${motion ? `node-judgment--motion node-judgment--${motion}` : `node-judgment--${statusKey}`}`}
              title={motion && motionProvisional ? "Provisional while the bench is in session" : showWeakened ? "Survives, but a ruling says the argument was weakened." : undefined}
            >
              {statusLabel}
              {motion && motionProvisional && <i className="node-judgment-provisional">in session</i>}
            </span>
          ) : !isThesis ? (
            <span className={`node-stance stance-dot-${node.stance}`}>
              {node.stance === "pro" ? "For" : node.stance === "con" ? "Against" : "Context"}
            </span>
          ) : null}
          {proved && !isThesis && (
            <span className="node-proof-seal" title="Clean, strong direct support proved.">
              Proved
            </span>
          )}
          {motionProved && (
            <span className="node-proof-motion" title="A clean direct support is proved.">
              Proved
            </span>
          )}
        </div>
      </div>
      <div className="node-title">{node.title}</div>
      {!isThesis && <div className="node-text">{node.text}</div>}
      {isThesis && <div className="node-text node-text--thesis">{node.text}</div>}
      {reinstated && <span className="node-restored">Restored</span>}
    </button>
  );
}
