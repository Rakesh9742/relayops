import type { Entity, Workspace, Edge } from "../src/types";
import type { Store } from "./store";
export const WORKSPACES: Workspace[] = [
  {
    id: "acme",
    name: "Acme Commerce",
    initials: "ac",
    domain: "acme.store",
    color: "#bfd69a",
  },
  {
    id: "orbit",
    name: "Orbit Financial",
    initials: "or",
    domain: "orbit.example",
    color: "#c1b5e0",
  },
];
export function entity(
  id: string,
  kind: Entity["kind"],
  data: Record<string, any>,
  createdAt = Date.now(),
): Entity {
  return { id, kind, version: 1, createdAt, ...data };
}
export async function seed(store: Store) {
  for (const workspace of WORKSPACES) {
    if (await store.get(workspace.id, "service-checkout")) continue;
    const now = Date.now();
    const orbit = workspace.id === "orbit";
    const service = orbit ? "payments-api" : "checkout-api";
    const nodes: Entity[] = [
      entity("service-checkout", "service", {
        name: service,
        type: "api",
        environment: "production",
        owner: orbit ? "Payments team" : "Commerce team",
      }),
      entity("service-db", "service", {
        name: orbit ? "ledger-db" : "orders-db",
        type: "database",
        environment: "production",
      }),
      entity("service-gateway", "service", {
        name: "api-gateway",
        type: "gateway",
        environment: "production",
      }),
      entity(
        "mem-topology",
        "memory",
        {
          category: "semantic",
          title: `${service} connects to ${orbit ? "ledger-db" : "orders-db"}`,
          content: `The ${service} service uses ${orbit ? "ledger-db" : "orders-db"} in us-east-1. Connection pool capacity is 20.`,
          status: "active",
          source: "Service catalog · revision 12",
          serviceId: "service-checkout",
          agent: "atlas",
          confidence: 1,
          database: orbit ? "ledger-db" : "orders-db",
          poolLimit: 20,
        },
        now - 86400000 * 3,
      ),
      entity(
        "mem-past",
        "memory",
        {
          category: "episodic",
          title: "A restart did not resolve connection exhaustion",
          content:
            "During the previous incident, restarting the service briefly reduced errors, but the pool filled again. Increasing the pool limit resolved the failure.",
          status: "active",
          source: "INC-1038 · verified outcome",
          serviceId: "service-checkout",
          agent: "echo",
          confidence: 1,
          failedAction: "restart",
        },
        now - 86400000 * 2,
      ),
      entity(
        "mem-playbook",
        "memory",
        {
          category: "procedural",
          title: "Recover an exhausted connection pool",
          content:
            "Confirm the current database. Inspect active connections. Increase the pool from 20 to 40 in the sandbox. Verify error rate and latency before recording a successful outcome.",
          status: "active",
          source: "Runbook RB-07 · reviewed procedure",
          serviceId: "service-checkout",
          agent: "sage",
          confidence: 1,
          steps: [
            "Confirm the current database endpoint",
            "Inspect the connection pool",
            "Increase pool capacity to 40",
            "Verify error rate is below 1%",
          ],
          action: "increase-pool",
          targetPool: 40,
        },
        now - 86400000 * 2,
      ),
      entity(
        "mem-owner",
        "memory",
        {
          category: "semantic",
          title: `${orbit ? "Payments" : "Commerce"} team owns the service`,
          content: `Escalate unresolved ${service} incidents to the ${orbit ? "Payments" : "Commerce"} team. Include the evidence and actions already attempted.`,
          status: "active",
          source: "Ownership directory",
          serviceId: "service-checkout",
          agent: "atlas",
          confidence: 1,
        },
        now - 86400000,
      ),
      entity(
        "inc-history",
        "incident",
        {
          number: "INC-1038",
          title: orbit
            ? "Payment requests timing out"
            : "Connection pool exhausted during flash sale",
          description:
            "Previous simulated incident. Recovery verified after increasing pool capacity.",
          severity: "P2",
          status: "resolved",
          serviceId: "service-checkout",
          service,
          scenario: "pool",
          stage: 4,
          resolvedAt: now - 86400000 * 2 + 780000,
          environment: "simulation",
          errorRate: 0.3,
          latency: 186,
          memoryReused: 0,
        },
        now - 86400000 * 2,
      ),
    ];
    const edges: Edge[] = [
      {
        from: "service-gateway",
        to: "service-checkout",
        relation: "ROUTES_TO",
      },
      { from: "service-checkout", to: "service-db", relation: "DEPENDS_ON" },
      { from: "inc-history", to: "service-checkout", relation: "AFFECTS" },
      ...nodes
        .filter((n) => n.kind === "memory")
        .map((n) => ({
          from: "service-checkout",
          to: n.id,
          relation: "HAS_MEMORY",
        })),
      { from: "mem-past", to: "inc-history", relation: "LEARNED_FROM" },
    ];
    await store.commit(workspace.id, nodes, edges);
  }
}
