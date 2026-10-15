import type { Edge, Entity, NodeKind, PathStep, Relation } from "../src/types";
import type { Store, Guard } from "./store";
import type {
  GraphTools,
  Hit,
  PersonHit,
  SimilarHit,
  SuspectHit,
} from "./graph";

/**
 * FalkorDB adapter. One graph per tenant (`relayops_<tenant>`). Every node
 * kind is a label, every relation is a relationship type, and the fields the
 * agents query on are first-class properties. The full entity is kept as a
 * JSON `payload` so it round-trips unchanged.
 *
 * All multi-entity writes are one guarded query: if any guard's version does
 * not match, the query yields no rows and nothing is written.
 */

const LABELS: Record<NodeKind, string> = {
  service: "Service",
  incident: "Incident",
  memory: "Memory",
  person: "Person",
  team: "Team",
  decision: "Decision",
  task: "Task",
  event: "Event",
  message: "Message",
};
const RELATIONS = new Set<Relation>([
  "DEPENDS_ON",
  "ROUTES_TO",
  "OWNS",
  "MEMBER_OF",
  "ON_CALL_FOR",
  "RESOLVED",
  "AFFECTS",
  "ROOT_CAUSE",
  "SIMILAR_TO",
  "HAS_MEMORY",
  "LEARNED_FROM",
  "SUPERSEDES",
  "ABOUT",
  "MADE_BY",
  "BASED_ON",
  "HAS_EVENT",
  "HAS_TASK",
  "HAS_MESSAGE",
  "HANDS_OFF_TO",
  "USES",
]);
/** Properties lifted out of the payload so Cypher can filter and sort on them. */
const LIFTED = [
  "name",
  "number",
  "title",
  "status",
  "category",
  "serviceId",
  "incidentId",
  "type",
  "tier",
  "handle",
  "role",
  "action",
  "database",
  "signal",
  "signals",
  "forbids",
  "verifiedRuns",
  "agent",
  "stage",
  "leaseUntil",
  "createdAt",
] as const;

const labelOf = (kind: string) => {
  const l = LABELS[kind as NodeKind];
  if (!l) throw new Error(`Unknown node kind ${kind}`);
  return l;
};
const relationOf = (rel: string) => {
  if (!RELATIONS.has(rel as Relation)) throw new Error(`Unknown relation ${rel}`);
  return rel;
};
const STRUCTURAL = "DEPENDS_ON|ROUTES_TO";

interface GraphHandle {
  query(
    q: string,
    options?: { params: Record<string, any> },
  ): Promise<{ data?: unknown[] }>;
  delete(): Promise<void>;
}
export interface FalkorClient {
  selectGraph(name: string): GraphHandle;
  list(): Promise<string[]>;
  close(): Promise<void>;
}

const props = (n: Entity) => {
  const p: Record<string, any> = {
    id: n.id,
    kind: n.kind,
    version: n.version,
    payload: JSON.stringify(n),
  };
  for (const k of LIFTED) {
    const v = n[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x === "string" || typeof x === "number")) p[k] = v;
    } else if (["string", "number", "boolean"].includes(typeof v)) p[k] = v;
  }
  return p;
};
const toEntity = (node: any): Entity => JSON.parse(node.properties.payload);
const toSteps = (raw: any): PathStep[] =>
  Array.isArray(raw)
    ? raw
        .filter((s) => s && s.from && s.to)
        .map((s) => ({ from: s.from, relation: s.relation, to: s.to }))
    : [];
/** Cypher fragment that turns a path into [{from,relation,to}] */
const PATH_STEPS = (p: string) =>
  `[r IN relationships(${p}) | {from: startNode(r).id, relation: type(r), to: endNode(r).id}]`;

export class FalkorStore implements Store {
  backend = "falkordb" as const;
  private prepared = new Set<string>();
  constructor(
    private db: FalkorClient,
    public prefix = process.env.FALKORDB_PREFIX ?? "relayops",
  ) {}

  graphName(tenant: string) {
    if (!/^[a-z0-9_-]{1,64}$/.test(tenant)) throw new Error("Invalid workspace");
    return `${this.prefix}_${tenant}`;
  }
  private graph(tenant: string) {
    return this.db.selectGraph(this.graphName(tenant));
  }
  async query(tenant: string, q: string, params: Record<string, any> = {}) {
    await this.prepare(tenant);
    const result = await this.graph(tenant).query(q, { params });
    return (result.data ?? []) as Record<string, any>[];
  }
  /** Create indexes once per tenant graph. Idempotent. */
  private async prepare(tenant: string) {
    if (this.prepared.has(tenant)) return;
    this.prepared.add(tenant);
    const g = this.graph(tenant);
    for (const label of Object.values(LABELS)) {
      try {
        await g.query(`CREATE INDEX FOR (n:${label}) ON (n.id)`);
      } catch {
        /* already indexed */
      }
    }
    for (const [label, field] of [
      ["Memory", "status"],
      ["Memory", "serviceId"],
      ["Incident", "status"],
      ["Task", "status"],
      ["Event", "incidentId"],
      ["Message", "incidentId"],
    ]) {
      try {
        await g.query(`CREATE INDEX FOR (n:${label}) ON (n.${field})`);
      } catch {
        /* already indexed */
      }
    }
    try {
      await g.query(
        `CREATE FULLTEXT INDEX FOR (m:Memory) ON (m.title, m.content)`,
      );
    } catch {
      /* already indexed */
    }
  }

  async all(tenant: string) {
    return (await this.query(tenant, "MATCH (n) RETURN n.payload AS payload")).map(
      (r) => JSON.parse(r.payload),
    );
  }
  async get(tenant: string, id: string) {
    const rows = await this.query(
      tenant,
      "MATCH (n {id:$id}) RETURN n.payload AS payload",
      { id },
    );
    return rows[0] ? (JSON.parse(rows[0].payload) as Entity) : undefined;
  }
  async edges(tenant: string) {
    return (await this.query(
      tenant,
      "MATCH (a)-[e]->(b) RETURN a.id AS from, b.id AS to, type(e) AS relation",
    )) as Edge[];
  }
  async commit(
    tenant: string,
    nodes: Entity[],
    edges: Edge[] = [],
    guards: Guard[] = [],
  ) {
    if (!nodes.length && !edges.length) return true;
    const params: Record<string, any> = {};
    const parts: string[] = [];
    guards.forEach((g, i) => {
      params[`g${i}`] = g.id;
      params[`v${i}`] = g.version;
      parts.push(`MATCH (g${i} {id:$g${i}}) WHERE g${i}.version = $v${i}`);
    });
    if (guards.length) parts.push("WITH *");
    nodes.forEach((n, i) => {
      params[`p${i}`] = props(n);
      params[`id${i}`] = n.id;
      // Label is chosen server-side from a closed set; never from input.
      parts.push(`MERGE (n${i}:${labelOf(n.kind)} {id:$id${i}}) SET n${i} = $p${i}`);
    });
    edges.forEach((e, i) => {
      params[`f${i}`] = e.from;
      params[`t${i}`] = e.to;
      parts.push(
        `WITH * MATCH (a${i} {id:$f${i}}), (b${i} {id:$t${i}}) MERGE (a${i})-[:${relationOf(e.relation)}]->(b${i})`,
      );
    });
    parts.push("RETURN 1 AS committed");
    const rows = await this.query(tenant, parts.join("\n"), params);
    return rows.length > 0;
  }
  /** Active memory reachable from the incident: affected/root-cause service, two structural hops, attached memory. */
  async context(tenant: string, incidentId: string) {
    return (
      await this.query(
        tenant,
        `MATCH (i:Incident {id:$id})-[:AFFECTS|ROOT_CAUSE]->(s:Service)
         WITH s, [(s)-[:${STRUCTURAL}*1..2]->(u:Service) | u] AS ups
         UNWIND [s] + ups AS svc
         MATCH (svc)-[:HAS_MEMORY]->(m:Memory {status:'active'})
         RETURN DISTINCT m.payload AS payload`,
        { id: incidentId },
      )
    ).map((r) => JSON.parse(r.payload));
  }
  async stats(tenant: string) {
    const [nodes, edges] = await Promise.all([
      this.query(tenant, "MATCH (n) RETURN count(n) AS c"),
      this.query(tenant, "MATCH ()-[e]->() RETURN count(e) AS c"),
    ]);
    return { graph: this.graphName(tenant), nodes: nodes[0]?.c ?? 0, edges: edges[0]?.c ?? 0 };
  }
  async reset(tenant: string) {
    try {
      await this.graph(tenant).delete();
    } catch {
      /* no graph yet */
    }
    this.prepared.delete(tenant);
  }
  async close() {
    await this.db.close();
  }
}

/** The agent tool set, answered with native traversals. */
export class FalkorGraph implements GraphTools {
  constructor(private store: FalkorStore) {}
  private q(tenant: string, query: string, params: Record<string, any> = {}) {
    return this.store.query(tenant, query, params);
  }

  async resolve(tenant: string, ref: string) {
    const rows = await this.q(
      tenant,
      `MATCH (n) WHERE n.id = $ref OR toLower(n.name) = $low OR toLower(n.number) = $low OR toLower(n.handle) = $low
       RETURN n.id AS id LIMIT 1`,
      { ref, low: ref.trim().toLowerCase() },
    );
    return rows[0]?.id as string | undefined;
  }

  async blastRadius(tenant: string, serviceId: string, depth = 3) {
    const rows = await this.q(
      tenant,
      `MATCH p = (u:Service)-[:${STRUCTURAL}*1..${depth}]->(s:Service {id:$id})
       WITH u, p ORDER BY length(p)
       WITH u, head(collect(p)) AS p
       RETURN u.payload AS payload, length(p) AS depth, ${PATH_STEPS("p")} AS path
       ORDER BY depth`,
      { id: serviceId },
    );
    // Paths come back oriented u -> s; present them from the perspective of s.
    return rows.map((r) => ({
      node: JSON.parse(r.payload),
      depth: r.depth,
      path: toSteps(r.path).reverse(),
    })) as Hit[];
  }

  async suspects(tenant: string, serviceId: string, depth = 2) {
    const upstream = await this.q(
      tenant,
      `MATCH p = (s:Service {id:$id})-[:${STRUCTURAL}*1..${depth}]->(u:Service)
       WITH u, p ORDER BY length(p)
       WITH u, head(collect(p)) AS p
       RETURN u.payload AS payload, length(p) AS depth, ${PATH_STEPS("p")} AS path,
              [(i:Incident)-[:ROOT_CAUSE]->(u) | i.payload] AS incidents,
              [(u)-[:HAS_MEMORY]->(m:Memory {status:'active'}) | m.payload] AS memories
       ORDER BY depth`,
      { id: serviceId },
    );
    const seen = new Set<string>([serviceId]);
    const hits: SuspectHit[] = upstream.map((r) => {
      const node = JSON.parse(r.payload);
      seen.add(node.id);
      return {
        node,
        depth: r.depth,
        path: toSteps(r.path),
        rootCauseOf: (r.incidents as string[]).map((p) => JSON.parse(p)),
        memories: (r.memories as string[]).map((p) => JSON.parse(p)),
      };
    });
    // Siblings sharing a direct dependency (e.g. a worker holding the same database).
    const siblings = await this.q(
      tenant,
      `MATCH (s:Service {id:$id})-[r1:${STRUCTURAL}]->(d:Service)<-[r2:${STRUCTURAL}]-(u:Service)
       WHERE u.id <> $id
       RETURN DISTINCT u.payload AS payload, d.id AS via, type(r1) AS r1, type(r2) AS r2,
              [(i:Incident)-[:ROOT_CAUSE]->(u) | i.payload] AS incidents,
              [(u)-[:HAS_MEMORY]->(m:Memory {status:'active'}) | m.payload] AS memories`,
      { id: serviceId },
    );
    for (const r of siblings) {
      const node = JSON.parse(r.payload);
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      hits.push({
        node,
        depth: 2,
        path: [
          { from: serviceId, relation: r.r1, to: r.via },
          { from: node.id, relation: `${r.r2} (shared)`, to: r.via },
        ],
        rootCauseOf: (r.incidents as string[]).map((p) => JSON.parse(p)),
        memories: (r.memories as string[]).map((p) => JSON.parse(p)),
      });
    }
    return hits.sort(
      (a, b) => a.depth - b.depth || b.rootCauseOf.length - a.rootCauseOf.length,
    );
  }

  /** The affected service plus everything up to two structural hops upstream, each with the path from the service. */
  private scopeQuery = `MATCH (s:Service {id:$id})
       OPTIONAL MATCH p = (s)-[:${STRUCTURAL}*1..2]->(u:Service)
       WITH s, u, p ORDER BY length(p)
       WITH s, u, head(collect(p)) AS p
       WITH s, collect({svc: u, path: ${PATH_STEPS("p")}}) AS ups
       WITH [{svc: s, path: []}] + [x IN ups WHERE x.svc IS NOT NULL] AS scope
       UNWIND scope AS row
       WITH row.svc AS svc, row.path AS path`;

  async similarIncidents(tenant: string, serviceId: string) {
    const rows = await this.q(
      tenant,
      `${this.scopeQuery}
       MATCH (i:Incident {status:'resolved'})-[rel:AFFECTS|ROOT_CAUSE]->(svc)
       WITH i, svc, path, type(rel) AS rel ORDER BY size(path)
       WITH i, head(collect({svc: svc.id, path: path, rel: rel})) AS best
       RETURN i.payload AS payload, best,
              head([(i)-[:ROOT_CAUSE]->(rc:Service) | rc.payload]) AS rc,
              head([(who:Person)-[:RESOLVED]->(i) | who.payload]) AS who,
              [(m:Memory {status:'active'})-[:LEARNED_FROM]->(i) | m.payload] AS learned
       ORDER BY size(best.path), i.createdAt DESC`,
      { id: serviceId },
    );
    return rows.map((r) => {
      const node = JSON.parse(r.payload);
      const base = toSteps(r.best.path);
      return {
        node,
        rootCause: r.rc ? JSON.parse(r.rc) : undefined,
        resolver: r.who ? JSON.parse(r.who) : undefined,
        learned: (r.learned as string[]).map((p) => JSON.parse(p)),
        path: [...base, { from: node.id, relation: r.best.rel, to: r.best.svc }],
        depth: base.length + 1,
      } as SimilarHit;
    });
  }

  async whoKnows(tenant: string, serviceId: string) {
    const rows = await this.q(
      tenant,
      `MATCH (s:Service {id:$id})
       WITH s,
         [(p:Person)-[:ON_CALL_FOR]->(s) | {p: p.payload, why: 'on call', path: [{from: p.id, relation: 'ON_CALL_FOR', to: s.id}]}] AS a,
         [(p:Person)-[:MEMBER_OF]->(t:Team)-[:OWNS]->(s) | {p: p.payload, why: 'member of ' + t.name, path: [{from: p.id, relation: 'MEMBER_OF', to: t.id}, {from: t.id, relation: 'OWNS', to: s.id}]}] AS b,
         [(p:Person)-[:RESOLVED]->(i:Incident)-[rel:AFFECTS|ROOT_CAUSE]->(s) | {p: p.payload, why: 'resolved ' + i.number, path: [{from: p.id, relation: 'RESOLVED', to: i.id}, {from: i.id, relation: type(rel), to: s.id}]}] AS c
       UNWIND a + b + c AS r
       RETURN r.p AS payload, collect(r.why) AS reasons, collect(r.path) AS paths`,
      { id: serviceId },
    );
    return rows
      .map((r) => {
        const paths = (r.paths as any[]).map(toSteps);
        const path = paths.sort((a, b) => a.length - b.length)[0] ?? [];
        return {
          node: JSON.parse(r.payload),
          reasons: [...new Set(r.reasons as string[])],
          path,
          depth: path.length,
        } as PersonHit;
      })
      .sort((a, b) => b.reasons.length - a.reasons.length || a.depth - b.depth);
  }

  async decisions(tenant: string, serviceId: string) {
    const rows = await this.q(
      tenant,
      `${this.scopeQuery}
       MATCH (d:Decision)-[:ABOUT]->(svc)
       WITH d, svc, path ORDER BY size(path)
       WITH d, head(collect({svc: svc.id, path: path})) AS best
       RETURN d.payload AS payload, best
       ORDER BY size(best.path)`,
      { id: serviceId },
    );
    return rows.map((r) => {
      const node = JSON.parse(r.payload);
      const base = toSteps(r.best.path);
      return {
        node,
        path: [...base, { from: node.id, relation: "ABOUT", to: r.best.svc }],
        depth: base.length + 1,
      } as Hit;
    });
  }

  async memoriesFor(tenant: string, serviceId: string, category?: string) {
    const rows = await this.q(
      tenant,
      `MATCH (:Service {id:$id})-[:HAS_MEMORY]->(m:Memory {status:'active'})
       WHERE $category IS NULL OR m.category = $category
       RETURN m.payload AS payload ORDER BY m.createdAt`,
      { id: serviceId, category: category ?? null },
    );
    return rows.map((r) => JSON.parse(r.payload) as Entity);
  }

  async path(tenant: string, from: string, to: string, max = 4) {
    if (from === to) return [];
    const rows = await this.q(
      tenant,
      `MATCH (a {id:$from}), (b {id:$to})
       WITH shortestPath((a)-[*..${max}]->(b)) AS p
       WHERE p IS NOT NULL AND length(p) > 0
       RETURN ${PATH_STEPS("p")} AS path LIMIT 1`,
      { from, to },
    );
    return rows[0] ? toSteps(rows[0].path) : undefined;
  }

  /** Full-text search over memory titles and content. */
  async searchMemory(tenant: string, text: string, limit = 8) {
    const rows = await this.q(
      tenant,
      `CALL db.idx.fulltext.queryNodes('Memory', $q) YIELD node, score
       WHERE node.status = 'active'
       RETURN node.payload AS payload, score ORDER BY score DESC LIMIT ${limit}`,
      { q: text },
    );
    return rows.map((r) => ({ node: JSON.parse(r.payload) as Entity, score: r.score as number }));
  }

  /** Services ranked by how much of the call graph flows through them. */
  async criticalServices(tenant: string, limit = 6) {
    const rows = await this.q(
      tenant,
      `CALL algo.betweenness({nodeLabels: ['Service'], relationshipTypes: ['DEPENDS_ON', 'ROUTES_TO']}) YIELD node, score
       WITH node, score WHERE score > 0
       RETURN DISTINCT node.payload AS payload, score ORDER BY score DESC LIMIT ${limit}`,
    );
    return rows.map((r) => ({ node: JSON.parse(r.payload) as Entity, score: r.score as number }));
  }
}

export async function connectFalkor(env = process.env) {
  const { FalkorDB } = await import("falkordb");
  const db = await FalkorDB.connect({
    socket: {
      host: env.FALKORDB_HOST ?? "127.0.0.1",
      port: Number(env.FALKORDB_PORT ?? 6379),
      connectTimeout: 5000,
    },
    username: env.FALKORDB_USERNAME || undefined,
    password: env.FALKORDB_PASSWORD || undefined,
  });
  const store = new FalkorStore(db as unknown as FalkorClient);
  return { store, graph: new FalkorGraph(store) };
}
