import type { Entity, Edge } from "../src/types";

export interface Guard {
  id: string;
  version: number;
}
export interface Store {
  backend: "falkordb";
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
  /** Graph name and size for one tenant. */
  stats?(
    tenant: string,
  ): Promise<{ graph: string; nodes: number; edges: number }>;
  close(): Promise<void>;
}

/**
 * The product runs on FalkorDB only. Tests use an in-memory double from
 * tests/doubles.ts so the unit suite can run without a database; nothing in
 * server/ or src/ depends on it.
 */
export async function createBackend(): Promise<{
  store: Store;
  graph: import("./graph").GraphTools;
}> {
  const backend = process.env.MEMORY_BACKEND ?? "falkordb";
  if (backend !== "falkordb")
    throw new Error(
      `MEMORY_BACKEND=${backend} is not supported. RelayOps runs on FalkorDB; the graph is the product, not a mirror.`,
    );
  const { connectFalkor } = await import("./falkor");
  try {
    return await connectFalkor();
  } catch (err) {
    throw new Error(
      `FalkorDB is not reachable at ${process.env.FALKORDB_HOST ?? "127.0.0.1"}:${process.env.FALKORDB_PORT ?? 6379}. Start it with: docker compose up -d. (${err instanceof Error ? err.message : err})`,
    );
  }
}
