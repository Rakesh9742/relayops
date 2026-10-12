import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Entity, Edge } from "../src/types";

export interface Guard {
  id: string;
  version: number;
}
export interface Store {
  backend: "sqlite" | "falkordb" | "browser";
  all(tenant: string): Promise<Entity[]>;
  edges(tenant: string): Promise<Edge[]>;
  get(tenant: string, id: string): Promise<Entity | undefined>;
  commit(
    tenant: string,
    nodes: Entity[],
    edges?: Edge[],
    guards?: Guard[],
  ): Promise<boolean>;
  context(tenant: string, incidentId: string): Promise<Entity[]>;
  close(): Promise<void>;
}

export class SQLiteStore implements Store {
  backend = "sqlite" as const;
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS nodes (tenant TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(tenant,id));
      CREATE TABLE IF NOT EXISTS edges (tenant TEXT NOT NULL,src TEXT NOT NULL,dst TEXT NOT NULL,relation TEXT NOT NULL,PRIMARY KEY(tenant,src,dst,relation));
      CREATE INDEX IF NOT EXISTS node_kinds ON nodes(tenant,kind);
      CREATE INDEX IF NOT EXISTS edge_destinations ON edges(tenant,dst);`);
  }
  async all(tenant: string) {
    return this.db
      .prepare("SELECT payload FROM nodes WHERE tenant=?")
      .all(tenant)
      .map((r) => JSON.parse(r.payload as string));
  }
  async edges(tenant: string) {
    return this.db
      .prepare(
        'SELECT src AS "from", dst AS "to", relation FROM edges WHERE tenant=?',
      )
      .all(tenant) as unknown as Edge[];
  }
  async get(tenant: string, id: string) {
    const row = this.db
      .prepare("SELECT payload FROM nodes WHERE tenant=? AND id=?")
      .get(tenant, id);
    return row ? (JSON.parse(row.payload as string) as Entity) : undefined;
  }
  async commit(
    tenant: string,
    nodes: Entity[],
    edges: Edge[] = [],
    guards: Guard[] = [],
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const guard of guards) {
        const row = this.db
          .prepare("SELECT version FROM nodes WHERE tenant=? AND id=?")
          .get(tenant, guard.id);
        if (!row || row.version !== guard.version) {
          this.db.exec("ROLLBACK");
          return false;
        }
      }
      const put = this.db.prepare(
        "INSERT INTO nodes VALUES (?,?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET kind=excluded.kind,version=excluded.version,payload=excluded.payload",
      );
      for (const n of nodes)
        put.run(tenant, n.id, n.kind, n.version, JSON.stringify(n));
      const link = this.db.prepare(
        "INSERT OR IGNORE INTO edges VALUES (?,?,?,?)",
      );
      for (const e of edges) link.run(tenant, e.from, e.to, e.relation);
      this.db.exec("COMMIT");
      return true;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
  async context(tenant: string, incidentId: string) {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE paths(id, depth) AS (
      SELECT ?, 0 UNION SELECT e.dst, p.depth + 1 FROM edges e JOIN paths p ON e.src=p.id WHERE e.tenant=? AND p.depth<3
    ) SELECT DISTINCT n.payload FROM nodes n JOIN paths p ON n.id=p.id WHERE n.tenant=? AND n.kind='memory'`,
      )
      .all(incidentId, tenant, tenant);
    return rows
      .map((r) => JSON.parse(r.payload as string) as Entity)
      .filter((n) => n.status === "active");
  }
  async close() {
    this.db.close();
  }
}

export class FalkorStore implements Store {
  backend = "falkordb" as const;
  constructor(
    private db: {
      selectGraph(name: string): {
        query(
          query: string,
          options: { params: Record<string, any> },
        ): Promise<{ data?: unknown }>;
      };
      close(): Promise<void>;
    },
    private prefix = "relayops",
  ) {}
  private graph(tenant: string) {
    if (!/^[a-z0-9_-]{1,64}$/.test(tenant))
      throw new Error("Invalid workspace");
    return this.db.selectGraph(`${this.prefix}_${tenant}`);
  }
  private async query(
    tenant: string,
    query: string,
    params: Record<string, any> = {},
  ) {
    const result = await this.graph(tenant).query(query, { params });
    return (result.data ?? []) as Record<string, any>[];
  }
  async all(tenant: string) {
    return (
      await this.query(tenant, "MATCH (n:Entity) RETURN n.payload AS payload")
    ).map((r) => JSON.parse(r.payload));
  }
  async get(tenant: string, id: string) {
    const rows = await this.query(
      tenant,
      "MATCH (n:Entity {id:$id}) RETURN n.payload AS payload",
      { id },
    );
    return rows[0] ? (JSON.parse(rows[0].payload) as Entity) : undefined;
  }
  async edges(tenant: string) {
    return (await this.query(
      tenant,
      "MATCH (a:Entity)-[e:LINK]->(b:Entity) RETURN a.id AS from, b.id AS to, e.relation AS relation",
    )) as Edge[];
  }
  async commit(
    tenant: string,
    nodes: Entity[],
    edges: Edge[] = [],
    guards: Guard[] = [],
  ) {
    if (!nodes.length) return true;
    const params: Record<string, any> = {};
    const parts: string[] = [];
    guards.forEach((g, i) => {
      params[`g${i}`] = g.id;
      params[`v${i}`] = g.version;
      parts.push(`MATCH (g${i}:Entity {id:$g${i}}) WHERE g${i}.version=$v${i}`);
    });
    if (guards.length) parts.push("WITH *");
    nodes.forEach((n, i) => {
      params[`id${i}`] = n.id;
      params[`payload${i}`] = JSON.stringify(n);
      params[`kind${i}`] = n.kind;
      params[`version${i}`] = n.version;
      params[`status${i}`] = n.status ?? "";
      params[`incident${i}`] = n.incidentId ?? "";
      parts.push(
        `MERGE (n${i}:Entity {id:$id${i}}) SET n${i}.payload=$payload${i}, n${i}.kind=$kind${i}, n${i}.version=$version${i}, n${i}.status=$status${i}, n${i}.incidentId=$incident${i}`,
      );
    });
    edges.forEach((e, i) => {
      params[`from${i}`] = e.from;
      params[`to${i}`] = e.to;
      params[`rel${i}`] = e.relation;
      parts.push(
        `WITH * MATCH (a${i}:Entity {id:$from${i}}), (b${i}:Entity {id:$to${i}}) MERGE (a${i})-[:LINK {relation:$rel${i}}]->(b${i})`,
      );
    });
    parts.push("RETURN 1 AS committed");
    return (await this.query(tenant, parts.join("\n"), params)).length > 0;
  }
  async context(tenant: string, incidentId: string) {
    return (
      await this.query(
        tenant,
        `MATCH (i:Entity {id:$incidentId})-[:LINK*1..3]->(m:Entity)
      WHERE m.kind='memory' AND m.status='active' RETURN DISTINCT m.payload AS payload`,
        { incidentId },
      )
    ).map((r) => JSON.parse(r.payload));
  }
  async close() {
    await this.db.close();
  }
}

export async function createStore(): Promise<Store> {
  if (process.env.MEMORY_BACKEND === "falkordb") {
    const packageName = "falkordb";
    const { FalkorDB } = await import(packageName).catch(() => {
      throw new Error(
        "Install the FalkorDB adapter with: npm install falkordb",
      );
    });
    const db = await FalkorDB.connect({
      socket: {
        host: process.env.FALKORDB_HOST ?? "127.0.0.1",
        port: Number(process.env.FALKORDB_PORT ?? 6387),
        connectTimeout: 5000,
        reconnectStrategy: false,
      },
      username: process.env.FALKORDB_USERNAME || undefined,
      password: process.env.FALKORDB_PASSWORD || undefined,
    });
    return new FalkorStore(db);
  }
  return new SQLiteStore(process.env.SQLITE_PATH ?? ".data/relayops.db");
}
