import type { Edge, Entity, PathStep } from "../src/types";
import type { Store } from "./store";

/**
 * Graph questions the agents can ask. Each answer carries the path that
 * produced it so the UI can show how the agent got there.
 *
 * This interface is store-agnostic. `IndexedGraph` answers from an in-memory
 * index built from the store snapshot. A graph database adapter answers the
 * same questions with native traversals.
 */
export interface Hit<T = Entity> {
  node: T;
  path: PathStep[];
  depth: number;
}
export interface SuspectHit extends Hit {
  rootCauseOf: Entity[];
  memories: Entity[];
}
export interface SimilarHit extends Hit {
  rootCause?: Entity;
  resolver?: Entity;
  learned: Entity[];
}
export interface PersonHit extends Hit {
  reasons: string[];
}
export interface GraphTools {
  /** Resolve a node id, exact name, or case-insensitive name/number to an id. */
  resolve(tenant: string, ref: string): Promise<string | undefined>;
  /** Services that break if `serviceId` fails: reverse DEPENDS_ON / ROUTES_TO. */
  blastRadius(tenant: string, serviceId: string, depth?: number): Promise<Hit[]>;
  /** Services `serviceId` depends on, with incidents where each was the root cause and active memory. */
  suspects(tenant: string, serviceId: string, depth?: number): Promise<SuspectHit[]>;
  /** Resolved incidents on this service or on anything it depends on. */
  similarIncidents(tenant: string, serviceId: string): Promise<SimilarHit[]>;
  /** People connected to a service by on-call, ownership, or having resolved an incident there. */
  whoKnows(tenant: string, serviceId: string): Promise<PersonHit[]>;
  /** Accepted or rejected decisions about a service or anything it depends on. */
  decisions(tenant: string, serviceId: string): Promise<Hit[]>;
  /** Active memory attached to a service, optionally filtered by category. */
  memoriesFor(tenant: string, serviceId: string, category?: string): Promise<Entity[]>;
  /** Shortest directed path between two nodes, following any relation. */
  path(tenant: string, from: string, to: string, max?: number): Promise<PathStep[] | undefined>;
}

const STRUCTURAL = new Set(["DEPENDS_ON", "ROUTES_TO"]);

class Index {
  nodes = new Map<string, Entity>();
  out = new Map<string, Edge[]>();
  in = new Map<string, Edge[]>();
  constructor(nodes: Entity[], edges: Edge[]) {
    for (const n of nodes) this.nodes.set(n.id, n);
    for (const e of edges) {
      if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) continue;
      (this.out.get(e.from) ?? this.out.set(e.from, []).get(e.from)!).push(e);
      (this.in.get(e.to) ?? this.in.set(e.to, []).get(e.to)!).push(e);
    }
  }
  get(id: string) {
    return this.nodes.get(id);
  }
  outgoing(id: string, relations?: Set<string>) {
    return (this.out.get(id) ?? []).filter((e) => !relations || relations.has(e.relation));
  }
  incoming(id: string, relations?: Set<string>) {
    return (this.in.get(id) ?? []).filter((e) => !relations || relations.has(e.relation));
  }
  /** Breadth-first walk. `forward` follows from->to; otherwise to->from. */
  walk(start: string, relations: Set<string> | undefined, depth: number, forward: boolean) {
    const seen = new Map<string, PathStep[]>([[start, []]]);
    const queue: Array<{ id: string; path: PathStep[] }> = [{ id: start, path: [] }];
    const hits: Hit[] = [];
    while (queue.length) {
      const { id, path } = queue.shift()!;
      if (path.length >= depth) continue;
      const edges = forward ? this.outgoing(id, relations) : this.incoming(id, relations);
      for (const e of edges) {
        const next = forward ? e.to : e.from;
        if (seen.has(next)) continue;
        const step: PathStep = { from: e.from, relation: e.relation, to: e.to };
        const nextPath = [...path, step];
        seen.set(next, nextPath);
        const node = this.get(next)!;
        hits.push({ node, path: nextPath, depth: nextPath.length });
        queue.push({ id: next, path: nextPath });
      }
    }
    return hits;
  }
}

export class IndexedGraph implements GraphTools {
  constructor(private store: Store) {}
  private async index(tenant: string) {
    const [nodes, edges] = await Promise.all([this.store.all(tenant), this.store.edges(tenant)]);
    return new Index(nodes, edges);
  }
  private active(n: Entity | undefined): n is Entity {
    return !!n && n.kind === "memory" && n.status === "active";
  }

  async resolve(tenant: string, ref: string) {
    const g = await this.index(tenant);
    if (g.get(ref)) return ref;
    const needle = ref.trim().toLowerCase();
    if (!needle) return undefined;
    for (const n of g.nodes.values()) {
      if (
        String(n.name ?? "").toLowerCase() === needle ||
        String(n.number ?? "").toLowerCase() === needle ||
        String(n.handle ?? "").toLowerCase() === needle
      )
        return n.id;
    }
    return undefined;
  }

  async blastRadius(tenant: string, serviceId: string, depth = 3) {
    const g = await this.index(tenant);
    if (!g.get(serviceId)) return [];
    return g
      .walk(serviceId, STRUCTURAL, depth, false)
      .filter((h) => h.node.kind === "service")
      .sort((a, b) => a.depth - b.depth);
  }

  async suspects(tenant: string, serviceId: string, depth = 2) {
    const g = await this.index(tenant);
    if (!g.get(serviceId)) return [];
    const upstream = g.walk(serviceId, STRUCTURAL, depth, true).filter((h) => h.node.kind === "service");
    // Siblings: other services that share a direct dependency. They are not on
    // the call path but can starve a shared resource (e.g. a worker holding
    // database connections).
    const seen = new Set([serviceId, ...upstream.map((h) => h.node.id)]);
    const siblings: Hit[] = [];
    for (const dep of upstream.filter((h) => h.depth === 1))
      for (const e of g.incoming(dep.node.id, STRUCTURAL)) {
        if (seen.has(e.from)) continue;
        const node = g.get(e.from);
        if (!node || node.kind !== "service") continue;
        seen.add(e.from);
        siblings.push({
          node,
          path: [...dep.path, { from: e.from, relation: `${e.relation} (shared)`, to: dep.node.id }],
          depth: 2,
        });
      }
    return [...upstream, ...siblings]
      .map((h) => ({
        ...h,
        rootCauseOf: g
          .incoming(h.node.id, new Set(["ROOT_CAUSE"]))
          .map((e) => g.get(e.from)!)
          .filter(Boolean),
        memories: g
          .outgoing(h.node.id, new Set(["HAS_MEMORY"]))
          .map((e) => g.get(e.to))
          .filter(this.active),
      }))
      .sort((a, b) => a.depth - b.depth || b.rootCauseOf.length - a.rootCauseOf.length);
  }

  async similarIncidents(tenant: string, serviceId: string) {
    const g = await this.index(tenant);
    if (!g.get(serviceId)) return [];
    const scope = [
      { id: serviceId, path: [] as PathStep[] },
      ...g.walk(serviceId, STRUCTURAL, 2, true).map((h) => ({ id: h.node.id, path: h.path })),
    ];
    const out: SimilarHit[] = [];
    const seen = new Set<string>();
    for (const s of scope) {
      for (const e of g.incoming(s.id, new Set(["AFFECTS", "ROOT_CAUSE"]))) {
        const inc = g.get(e.from);
        if (!inc || inc.kind !== "incident" || inc.status !== "resolved" || seen.has(inc.id)) continue;
        seen.add(inc.id);
        const rootCause = g.outgoing(inc.id, new Set(["ROOT_CAUSE"])).map((x) => g.get(x.to))[0];
        const resolver = g.incoming(inc.id, new Set(["RESOLVED"])).map((x) => g.get(x.from))[0];
        const learned = g
          .incoming(inc.id, new Set(["LEARNED_FROM"]))
          .map((x) => g.get(x.from))
          .filter(this.active);
        out.push({
          node: inc,
          rootCause,
          resolver,
          learned,
          path: [...s.path, { from: inc.id, relation: e.relation, to: s.id }],
          depth: s.path.length + 1,
        });
      }
    }
    return out.sort((a, b) => a.depth - b.depth || b.node.createdAt - a.node.createdAt);
  }

  async whoKnows(tenant: string, serviceId: string) {
    const g = await this.index(tenant);
    if (!g.get(serviceId)) return [];
    const people = new Map<string, PersonHit>();
    const add = (id: string, reason: string, path: PathStep[]) => {
      const node = g.get(id);
      if (!node || node.kind !== "person") return;
      const hit = people.get(id) ?? { node, path, depth: path.length, reasons: [] };
      hit.reasons.push(reason);
      if (path.length < hit.path.length) hit.path = path;
      people.set(id, hit);
    };
    for (const e of g.incoming(serviceId, new Set(["ON_CALL_FOR"])))
      add(e.from, "on call", [{ from: e.from, relation: "ON_CALL_FOR", to: serviceId }]);
    for (const own of g.incoming(serviceId, new Set(["OWNS"])))
      for (const m of g.incoming(own.from, new Set(["MEMBER_OF"])))
        add(m.from, `member of ${g.get(own.from)?.name}`, [
          { from: m.from, relation: "MEMBER_OF", to: own.from },
          { from: own.from, relation: "OWNS", to: serviceId },
        ]);
    for (const aff of g.incoming(serviceId, new Set(["AFFECTS", "ROOT_CAUSE"])))
      for (const r of g.incoming(aff.from, new Set(["RESOLVED"])))
        add(r.from, `resolved ${g.get(aff.from)?.number}`, [
          { from: r.from, relation: "RESOLVED", to: aff.from },
          { from: aff.from, relation: aff.relation, to: serviceId },
        ]);
    return [...people.values()].sort((a, b) => b.reasons.length - a.reasons.length || a.depth - b.depth);
  }

  async decisions(tenant: string, serviceId: string) {
    const g = await this.index(tenant);
    if (!g.get(serviceId)) return [];
    const scope = [
      { id: serviceId, path: [] as PathStep[] },
      ...g.walk(serviceId, STRUCTURAL, 2, true).map((h) => ({ id: h.node.id, path: h.path })),
    ];
    const hits: Hit[] = [];
    const seen = new Set<string>();
    for (const s of scope)
      for (const e of g.incoming(s.id, new Set(["ABOUT"]))) {
        const d = g.get(e.from);
        if (!d || d.kind !== "decision" || seen.has(d.id)) continue;
        seen.add(d.id);
        hits.push({
          node: d,
          path: [...s.path, { from: d.id, relation: "ABOUT", to: s.id }],
          depth: s.path.length + 1,
        });
      }
    return hits.sort((a, b) => a.depth - b.depth);
  }

  async memoriesFor(tenant: string, serviceId: string, category?: string) {
    const g = await this.index(tenant);
    return g
      .outgoing(serviceId, new Set(["HAS_MEMORY"]))
      .map((e) => g.get(e.to))
      .filter(this.active)
      .filter((m) => !category || m.category === category);
  }

  async path(tenant: string, from: string, to: string, max = 4) {
    const g = await this.index(tenant);
    if (from === to) return [];
    const hit = g.walk(from, undefined, max, true).find((h) => h.node.id === to);
    return hit?.path;
  }
}
