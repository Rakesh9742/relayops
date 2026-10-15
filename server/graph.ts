import type { Edge, Entity, PathStep } from "../src/types";
import type { Store } from "./store";

/**
 * Graph questions the agents can ask. Each answer carries the path that
 * produced it so the UI can show how the agent got there.
 *
 * Implemented by FalkorGraph (server/falkor.ts) with native Cypher traversals.
 * tests/doubles.ts has an in-memory reference implementation used to check
 * that the Cypher returns the same answers as a plain graph walk.
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
  blastRadius(
    tenant: string,
    serviceId: string,
    depth?: number,
  ): Promise<Hit[]>;
  /** Services `serviceId` depends on, with incidents where each was the root cause and active memory. */
  suspects(
    tenant: string,
    serviceId: string,
    depth?: number,
  ): Promise<SuspectHit[]>;
  /** Resolved incidents on this service or on anything it depends on. */
  similarIncidents(tenant: string, serviceId: string): Promise<SimilarHit[]>;
  /** People connected to a service by on-call, ownership, or having resolved an incident there. */
  whoKnows(tenant: string, serviceId: string): Promise<PersonHit[]>;
  /** Accepted or rejected decisions about a service or anything it depends on. */
  decisions(tenant: string, serviceId: string): Promise<Hit[]>;
  /** Active memory attached to a service, optionally filtered by category. */
  memoriesFor(
    tenant: string,
    serviceId: string,
    category?: string,
  ): Promise<Entity[]>;
  /** Full-text search over memory titles and content. */
  searchMemory(
    tenant: string,
    text: string,
    limit?: number,
  ): Promise<Array<{ node: Entity; score: number }>>;
  /** Services ranked by betweenness over the call graph: the ones most traffic flows through. */
  criticalServices(
    tenant: string,
    limit?: number,
  ): Promise<Array<{ node: Entity; score: number }>>;
  /** Shortest directed path between two nodes, following any relation. */
  path(
    tenant: string,
    from: string,
    to: string,
    max?: number,
  ): Promise<PathStep[] | undefined>;
}
