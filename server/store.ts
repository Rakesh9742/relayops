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

export async function createStore(): Promise<Store> {
  return (await createBackend()).store;
}

/** Store plus the graph tools that answer agent questions natively on that store. */
export async function createBackend(): Promise<{
  store: Store;
  graph?: import("./graph").GraphTools;
}> {
  if (process.env.MEMORY_BACKEND === "falkordb") {
    const { connectFalkor } = await import("./falkor");
    try {
      return await connectFalkor();
    } catch (err) {
      throw new Error(
        `FalkorDB is not reachable at ${process.env.FALKORDB_HOST ?? "127.0.0.1"}:${process.env.FALKORDB_PORT ?? 6379}. Start it with: docker compose up -d. (${err instanceof Error ? err.message : err})`,
      );
    }
  }
  return { store: new SQLiteStore(process.env.SQLITE_PATH ?? ".data/relayops.db") };
}
