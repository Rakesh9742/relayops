import { test } from "node:test";
import assert from "node:assert/strict";
import { SQLiteStore } from "../server/store";
import { seed, buildWorkspaceGraph } from "../server/seed";
import { IndexedGraph } from "../server/graph";

async function fixture() {
  const store = new SQLiteStore(":memory:");
  await seed(store);
  return { store, graph: new IndexedGraph(store) };
}

test("seed builds a connected topology with people, incidents, memory, and decisions", () => {
  const { nodes, edges } = buildWorkspaceGraph("acme");
  const kinds = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.kind] = (acc[n.kind] ?? 0) + 1;
    return acc;
  }, {});
  assert.equal(kinds.service, 14);
  assert.equal(kinds.person, 8);
  assert.equal(kinds.team, 4);
  assert.equal(kinds.incident, 6);
  assert.equal(kinds.memory, 13);
  assert.equal(kinds.decision, 4);
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    assert.ok(ids.has(e.from), `dangling edge from ${e.from}`);
    assert.ok(ids.has(e.to), `dangling edge to ${e.to}`);
  }
  assert.ok(edges.length > 90);
});

test("blast radius follows reverse dependencies to the edge", async () => {
  const { store, graph } = await fixture();
  try {
    const hits = await graph.blastRadius("acme", "service-db");
    const ids = hits.map((h) => h.node.id);
    assert.deepEqual(ids.slice(0, 2).sort(), ["service-checkout", "service-worker"]);
    assert.ok(ids.includes("service-gateway"));
    assert.ok(ids.includes("service-web"));
    assert.ok(!ids.includes("service-search"), "search is isolated from orders-db");
    const web = hits.find((h) => h.node.id === "service-web")!;
    assert.equal(web.depth, 3);
    assert.deepEqual(
      web.path.map((p) => p.relation),
      ["DEPENDS_ON", "ROUTES_TO", "DEPENDS_ON"],
    );
  } finally {
    await store.close();
  }
});

test("suspects ranks upstream services by how often they were the root cause", async () => {
  const { store, graph } = await fixture();
  try {
    const hits = await graph.suspects("acme", "service-checkout");
    const direct = hits.filter((h) => h.depth === 1).map((h) => h.node.id);
    assert.deepEqual(direct.sort(), [
      "service-cache",
      "service-catalog",
      "service-db",
      "service-money",
    ]);
    const db = hits.find((h) => h.node.id === "service-db")!;
    assert.equal(db.rootCauseOf.length, 1);
    assert.ok(db.memories.some((m) => m.id === "mem-playbook"));
    const risk = hits.find((h) => h.node.id === "service-risk")!;
    assert.equal(risk.depth, 2);
    assert.equal(risk.rootCauseOf[0]?.number, "INC-0992");
  } finally {
    await store.close();
  }
});

test("similar incidents surface history on the service and its dependencies with resolvers", async () => {
  const { store, graph } = await fixture();
  try {
    const hits = await graph.similarIncidents("acme", "service-checkout");
    const numbers = hits.map((h) => h.node.number);
    assert.ok(numbers.includes("INC-1038"));
    assert.ok(numbers.includes("INC-0975"));
    assert.ok(numbers.includes("INC-0992"), "money -> risk is two hops away");
    assert.ok(!numbers.includes("INC-0960"), "search is not upstream of checkout");
    const past = hits.find((h) => h.node.number === "INC-1038")!;
    assert.equal(past.rootCause?.id, "service-db");
    assert.equal(past.resolver?.handle, "priya");
    assert.ok(past.learned.some((m) => m.id === "mem-past"));
  } finally {
    await store.close();
  }
});

test("who knows combines on-call, ownership, and resolution history", async () => {
  const { store, graph } = await fixture();
  try {
    const hits = await graph.whoKnows("acme", "service-db");
    const tomas = hits.find((h) => h.node.handle === "tomas")!;
    assert.ok(tomas.reasons.includes("on call"));
    assert.ok(tomas.reasons.some((r) => r.startsWith("member of")));
    const priya = hits.find((h) => h.node.handle === "priya")!;
    assert.ok(priya.reasons.some((r) => r.includes("INC-1038")));
    assert.ok(!hits.some((h) => h.node.handle === "lena"));
    const checkout = await graph.whoKnows("acme", "service-checkout");
    const tomasCheckout = checkout.find((h) => h.node.handle === "tomas")!;
    assert.ok(tomasCheckout.reasons.some((r) => r.includes("INC-0975")));
  } finally {
    await store.close();
  }
});

test("decisions include rejected approaches reachable through dependencies", async () => {
  const { store, graph } = await fixture();
  try {
    const hits = await graph.decisions("acme", "service-checkout");
    const ids = hits.map((h) => h.node.id);
    assert.ok(ids.includes("dec-18"), "rejected restart decision is about checkout");
    assert.ok(ids.includes("dec-12"), "pool constraint is about orders-db, one hop");
    assert.ok(ids.includes("dec-20"), "risk canary is two hops away");
    const rejected = hits.find((h) => h.node.id === "dec-18")!.node;
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.forbids, "restart");
  } finally {
    await store.close();
  }
});

test("path explains how two nodes connect", async () => {
  const { store, graph } = await fixture();
  try {
    const path = await graph.path("acme", "service-web", "service-risk");
    assert.ok(path);
    assert.deepEqual(
      path.map((p) => p.to),
      ["service-gateway", "service-money", "service-risk"],
    );
    assert.equal(await graph.path("acme", "service-search", "service-db", 4), undefined);
  } finally {
    await store.close();
  }
});

test("graph tools respect tenant scope", async () => {
  const { store, graph } = await fixture();
  try {
    const acme = await graph.whoKnows("acme", "service-checkout");
    const orbit = await graph.whoKnows("orbit", "service-checkout");
    assert.ok(acme.some((h) => h.node.handle === "priya"));
    assert.ok(!orbit.some((h) => h.node.handle === "priya"));
    assert.ok(orbit.some((h) => h.node.handle === "aisha"));
  } finally {
    await store.close();
  }
});
