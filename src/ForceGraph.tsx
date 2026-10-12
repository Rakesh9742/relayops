import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { drag } from "d3-drag";
import "d3-transition";
import type { Edge, Entity } from "./types";

/**
 * Force-directed graph over workspace entities. Pure presentation: the caller
 * decides which nodes/edges to show and which are highlighted. Physics runs
 * once per data change; positions are kept across re-renders so highlights
 * can change without the layout jumping.
 */

export interface GraphHighlight {
  /** Nodes on the latest result: strong colour, labels always on. */
  hot?: Set<string>;
  /** Nodes on earlier results this session: warm colour. */
  seen?: Set<string>;
  /** Edge keys `${from}|${relation}|${to}` */
  hotEdges?: Set<string>;
  seenEdges?: Set<string>;
  /** Node currently being queried. */
  pending?: string;
  /** Anchor nodes (the incident, its service) that never dim. */
  anchors?: Set<string>;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  entity: Entity;
  r: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  relation: string;
  key: string;
}

export const NODE_COLORS: Record<string, string> = {
  service: "#3b7a5c",
  database: "#204e3e",
  person: "#5675ca",
  team: "#7b8fcf",
  incident: "#c39149",
  "incident-open": "#d2553a",
  decision: "#8a7a4a",
  "decision-rejected": "#b65a4a",
  semantic: "#a088b6",
  episodic: "#d19d64",
  procedural: "#6c9b7e",
};
export const nodeColor = (n: Entity) => {
  if (n.kind === "service")
    return n.type === "database" || n.type === "index"
      ? NODE_COLORS.database
      : NODE_COLORS.service;
  if (n.kind === "incident")
    return n.status === "resolved"
      ? NODE_COLORS.incident
      : NODE_COLORS["incident-open"];
  if (n.kind === "decision")
    return n.status === "rejected"
      ? NODE_COLORS["decision-rejected"]
      : NODE_COLORS.decision;
  if (n.kind === "memory")
    return NODE_COLORS[n.category] ?? NODE_COLORS.semantic;
  return NODE_COLORS[n.kind] ?? "#888";
};
const radiusFor = (n: Entity) =>
  n.kind === "service"
    ? n.tier === "core" || n.type === "database"
      ? 13
      : 10
    : n.kind === "incident"
      ? n.status === "resolved"
        ? 8
        : 11
      : n.kind === "team"
        ? 9
        : n.kind === "person"
          ? 7
          : n.kind === "decision"
            ? 7
            : 6;
export const labelFor = (n: Entity) => n.name ?? n.number ?? n.title ?? n.id;
const short = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

const STRUCTURAL = new Set(["DEPENDS_ON", "ROUTES_TO"]);
const linkDistance = (rel: string) =>
  STRUCTURAL.has(rel)
    ? 95
    : rel === "HAS_MEMORY"
      ? 55
      : rel === "MEMBER_OF"
        ? 50
        : 75;
const linkStrength = (rel: string) =>
  STRUCTURAL.has(rel) ? 0.8 : rel === "HAS_MEMORY" ? 0.5 : 0.35;

export function ForceGraph({
  nodes,
  edges,
  highlight,
  onSelect,
  focusId,
  height = 560,
  legend = true,
  className = "",
}: {
  nodes: Entity[];
  edges: Edge[];
  highlight?: GraphHighlight;
  onSelect?: (n: Entity) => void;
  /** Node to centre and expand when the graph first lays out. */
  focusId?: string;
  height?: number;
  legend?: boolean;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [, bump] = useState(0);
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(
    null,
  );
  const nodesRef = useRef<Map<string, SimNode>>(new Map());
  const linksRef = useRef<SimLink[]>([]);
  const [size, setSize] = useState({ w: 900, h: height });

  // Track container width.
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: Math.max(320, e.contentRect.width), h: height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // Signature of the data so we only restart physics when the set changes.
  const dataKey = useMemo(
    () =>
      `${nodes
        .map((n) => n.id)
        .sort()
        .join(",")}#${edges
        .map((e) => `${e.from}>${e.relation}>${e.to}`)
        .sort()
        .join(",")}`,
    [nodes, edges],
  );

  useEffect(() => {
    const prev = nodesRef.current;
    const map = new Map<string, SimNode>();
    const cx = size.w / 2;
    const cy = size.h / 2;
    for (const n of nodes) {
      const old = prev.get(n.id);
      map.set(n.id, {
        id: n.id,
        entity: n,
        r: radiusFor(n),
        x: old?.x ?? cx + (Math.random() - 0.5) * 200,
        y: old?.y ?? cy + (Math.random() - 0.5) * 200,
        vx: 0,
        vy: 0,
      });
    }
    const links: SimLink[] = edges
      .filter((e) => map.has(e.from) && map.has(e.to))
      .map((e) => ({
        source: map.get(e.from)!,
        target: map.get(e.to)!,
        relation: e.relation,
        key: `${e.from}|${e.relation}|${e.to}`,
      }));
    nodesRef.current = map;
    linksRef.current = links;
    const list = [...map.values()];
    // Light kind-based gravity so people drift left, memory/decisions right,
    // services centre. Keeps the layout readable without columns.
    const xBias = (n: SimNode) =>
      n.entity.kind === "person" || n.entity.kind === "team"
        ? cx - size.w * 0.3
        : n.entity.kind === "memory" || n.entity.kind === "decision"
          ? cx + size.w * 0.28
          : n.entity.kind === "incident"
            ? cx + size.w * 0.08
            : cx;
    simRef.current?.stop();
    const sim = forceSimulation<SimNode>(list)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => linkDistance(l.relation))
          .strength((l) => linkStrength(l.relation)),
      )
      .force(
        "charge",
        forceManyBody<SimNode>().strength((d) => -30 * d.r),
      )
      .force(
        "collide",
        forceCollide<SimNode>()
          .radius((d) => d.r + 14)
          .strength(0.9),
      )
      .force("x", forceX<SimNode>(xBias).strength(0.06))
      .force("y", forceY<SimNode>(cy).strength(0.05))
      .force("center", forceCenter(cx, cy).strength(0.02))
      .alpha(prev.size ? 0.5 : 1)
      .alphaDecay(0.03)
      .on("tick", () => bump((v) => v + 1));
    if (focusId && map.has(focusId)) {
      const f = map.get(focusId)!;
      f.fx = cx;
      f.fy = cy;
      setTimeout(() => {
        f.fx = null;
        f.fy = null;
      }, 1200);
    }
    simRef.current = sim;
    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, size.w, size.h]);

  // Zoom + pan.
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = select(svgRef.current);
    const g = select(gRef.current);
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.35, 3.5])
      .filter((event) => !event.button)
      .on("zoom", (event) => g.attr("transform", event.transform.toString()));
    svg.call(z);
    zoomRef.current = z;
    return () => {
      svg.on(".zoom", null);
    };
  }, []);

  // Drag.
  const dragBehaviour = useMemo(
    () =>
      drag<SVGGElement, SimNode>()
        .clickDistance(4)
        .on("start", (event, d) => {
          if (!event.active) simRef.current?.alphaTarget(0.25).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simRef.current?.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    [],
  );
  useEffect(() => {
    if (!gRef.current) return;
    const map = nodesRef.current;
    const sel = select(gRef.current).selectAll<SVGGElement, SimNode>(
      "g.fg-node",
    );
    // React owns the DOM; attach each element's datum by id, then wire drag.
    sel.each(function () {
      const id = this.getAttribute("data-id");
      const d = id ? map.get(id) : undefined;
      if (d) (this as any).__data__ = d;
    });
    sel.call(dragBehaviour);
  });

  const fit = () => {
    if (!svgRef.current || !zoomRef.current) return;
    const list = [...nodesRef.current.values()];
    if (!list.length) return;
    const xs = list.map((n) => n.x ?? 0);
    const ys = list.map((n) => n.y ?? 0);
    const minX = Math.min(...xs) - 40,
      maxX = Math.max(...xs) + 40,
      minY = Math.min(...ys) - 40,
      maxY = Math.max(...ys) + 40;
    const k = Math.min(size.w / (maxX - minX), size.h / (maxY - minY), 1.6);
    const t = zoomIdentity
      .translate(size.w / 2, size.h / 2)
      .scale(k)
      .translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
    select(svgRef.current)
      .transition()
      .duration(450)
      .call(zoomRef.current.transform, t);
  };
  // Fit once the simulation settles the first time.
  const fitted = useRef("");
  useEffect(() => {
    if (fitted.current === dataKey) return;
    const t = setTimeout(() => {
      fitted.current = dataKey;
      fit();
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  const hot = highlight?.hot ?? new Set<string>();
  const seen = highlight?.seen ?? new Set<string>();
  const hotEdges = highlight?.hotEdges ?? new Set<string>();
  const seenEdges = highlight?.seenEdges ?? new Set<string>();
  const anchors = highlight?.anchors ?? new Set<string>();
  const dimming = hot.size > 0 || seen.size > 0;
  const neighbours = useMemo(() => {
    if (!hover) return null;
    const s = new Set<string>([hover]);
    for (const l of linksRef.current) {
      const a = (l.source as SimNode).id,
        b = (l.target as SimNode).id;
      if (a === hover) s.add(b);
      if (b === hover) s.add(a);
    }
    return s;
  }, [hover, dataKey]);

  const simNodes = [...nodesRef.current.values()];
  const links = linksRef.current;
  const hovered = hover ? nodesRef.current.get(hover) : undefined;

  return (
    <div className={`force-graph ${className}`} style={{ height }}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        role="group"
        aria-label="Workspace graph"
      >
        <defs>
          <marker
            id="fg-arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="fg-arrow" />
          </marker>
          <marker
            id="fg-arrow-hot"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="fg-arrow-hot" />
          </marker>
          <marker
            id="fg-arrow-seen"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="fg-arrow-seen" />
          </marker>
        </defs>
        <g ref={gRef}>
          <g className="fg-links">
            {links.map((l) => {
              const s = l.source as SimNode,
                t = l.target as SimNode;
              if (s.x == null || t.x == null) return null;
              const isHot = hotEdges.has(l.key);
              const isSeen = !isHot && seenEdges.has(l.key);
              const near = neighbours
                ? neighbours.has(s.id) &&
                  neighbours.has(t.id) &&
                  (s.id === hover || t.id === hover)
                : false;
              const dim =
                (dimming && !isHot && !isSeen) || (neighbours && !near);
              // Shorten the line so the arrow lands on the circle edge.
              const dx = t.x! - s.x!,
                dy = t.y! - s.y!;
              const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len,
                uy = dy / len;
              const x1 = s.x! + ux * (s.r + 2),
                y1 = s.y! + uy * (s.r + 2);
              const x2 = t.x! - ux * (t.r + 3),
                y2 = t.y! - uy * (t.r + 3);
              return (
                <g
                  key={l.key}
                  className={`fg-link ${isHot ? "hot" : isSeen ? "seen" : ""} ${STRUCTURAL.has(l.relation) ? "structural" : ""}`}
                  opacity={dim ? 0.12 : 1}
                >
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    markerEnd={
                      isHot
                        ? "url(#fg-arrow-hot)"
                        : isSeen
                          ? "url(#fg-arrow-seen)"
                          : "url(#fg-arrow)"
                    }
                  />
                  {(isHot || near) && (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 4}
                      textAnchor="middle"
                      className="fg-rel"
                    >
                      {l.relation}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
          <g className="fg-nodes">
            {simNodes.map((n) => {
              if (n.x == null) return null;
              const isHot = hot.has(n.id);
              const isSeen = !isHot && seen.has(n.id);
              const isAnchor = anchors.has(n.id);
              const isPending = highlight?.pending === n.id;
              const near = neighbours ? neighbours.has(n.id) : true;
              const dim =
                (dimming && !isHot && !isSeen && !isAnchor && !isPending) ||
                !near;
              const showLabel =
                isHot ||
                isAnchor ||
                isPending ||
                n.id === hover ||
                (neighbours
                  ? near && n.id !== hover
                    ? false
                    : true
                  : n.r >= 9);
              const superseded = n.entity.status === "superseded";
              return (
                <g
                  key={n.id}
                  data-id={n.id}
                  className={`fg-node ${isHot ? "hot" : ""} ${isSeen ? "seen" : ""} ${isPending ? "pending" : ""} ${isAnchor ? "anchor" : ""}`}
                  transform={`translate(${n.x},${n.y})`}
                  opacity={dim ? 0.22 : 1}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelect?.(n.entity)}
                  role={onSelect ? "button" : undefined}
                  tabIndex={onSelect ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (onSelect && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onSelect(n.entity);
                    }
                  }}
                >
                  <title>{`${n.entity.kind}: ${labelFor(n.entity)}`}</title>
                  {(isHot || isPending) && (
                    <circle r={n.r + 7} className="fg-halo" />
                  )}
                  <circle
                    r={n.r}
                    fill={nodeColor(n.entity)}
                    className="fg-circle"
                    strokeDasharray={superseded ? "3 2" : undefined}
                  />
                  {n.entity.kind === "service" &&
                    (n.entity.type === "database" ||
                      n.entity.type === "index") && (
                      <rect
                        x={-3.5}
                        y={-3.5}
                        width={7}
                        height={7}
                        rx={1}
                        className="fg-glyph"
                      />
                    )}
                  {n.entity.kind === "person" && (
                    <circle r={2.4} className="fg-glyph" />
                  )}
                  {showLabel && (
                    <text
                      y={n.r + 12}
                      textAnchor="middle"
                      className={`fg-label ${isHot || isAnchor ? "strong" : ""}`}
                    >
                      {short(
                        labelFor(n.entity),
                        isHot || isAnchor || n.id === hover ? 34 : 20,
                      )}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      {hovered && (
        <div
          className="fg-tooltip"
          style={{ left: 12, bottom: legend ? 54 : 12 }}
        >
          <span
            className="fg-tt-kind"
            style={{ background: nodeColor(hovered.entity) }}
          >
            {hovered.entity.kind === "memory"
              ? hovered.entity.category
              : hovered.entity.kind}
          </span>
          <strong>{labelFor(hovered.entity)}</strong>
          {hovered.entity.kind === "person" && (
            <span>{hovered.entity.role}</span>
          )}
          {hovered.entity.kind === "service" && (
            <span>
              {hovered.entity.type}
              {hovered.entity.tier ? ` · ${hovered.entity.tier}` : ""}
            </span>
          )}
          {hovered.entity.kind === "incident" && (
            <span>{hovered.entity.title}</span>
          )}
          {hovered.entity.kind === "decision" && (
            <span>{hovered.entity.status}</span>
          )}
          {hovered.entity.kind === "memory" && (
            <span>{short(String(hovered.entity.content ?? ""), 120)}</span>
          )}
        </div>
      )}
      <div className="fg-controls">
        <button type="button" aria-label="Fit graph to view" onClick={fit}>
          Fit
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() =>
            svgRef.current &&
            zoomRef.current &&
            select(svgRef.current)
              .transition()
              .duration(200)
              .call(zoomRef.current.scaleBy, 1.4)
          }
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() =>
            svgRef.current &&
            zoomRef.current &&
            select(svgRef.current)
              .transition()
              .duration(200)
              .call(zoomRef.current.scaleBy, 0.7)
          }
        >
          −
        </button>
      </div>
      {legend && (
        <div className="fg-legend">
          {[
            ["service", "Service"],
            ["database", "Data store"],
            ["person", "Person"],
            ["team", "Team"],
            ["incident", "Incident"],
            ["semantic", "Semantic"],
            ["episodic", "Episodic"],
            ["procedural", "Procedural"],
            ["decision", "Decision"],
          ].map(([k, l]) => (
            <span key={k}>
              <i style={{ background: NODE_COLORS[k] }} />
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
