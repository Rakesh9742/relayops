import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../server/store";
import { seed } from "../server/seed";
import { Engine } from "../server/engine";

async function fixture() {
  const store = new SQLiteStore(":memory:");
  await seed(store);
  const engine = new Engine(store, 0, false);
  const incident = await engine.create("acme", {
    title: "Checkout service errors",
    description: "Test incident",
    severity: "P1",
    scenario: "pool",
  });
  return { store, engine, incident };
}
test("agents retrieve connected memory, hand off, await approval, and persist a verified outcome", async () => {
  const { store, engine, incident } = await fixture();
  try {
    await engine.action("acme", incident.id, "start");
    assert.equal(await engine.step("acme", incident.id), true);
    let current = await store.get("acme", incident.id);
    assert.equal(current?.stage, 1);
    assert.ok(current?.memoryReused >= 4);
    assert.equal(current?.investigation.rootCauseServiceId, "service-db");
    assert.ok(current?.investigation.ruledOut.includes("service-cache"));
    assert.ok(
      current?.investigation.impactedServiceIds.includes("service-gateway"),
    );
    const finding = (await store.all("acme")).find(
      (n) => n.kind === "event" && n.type === "finding",
    );
    assert.ok(finding?.traces.some((t: any) => t.tool === "suspects"));
    assert.ok(finding?.traces.some((t: any) => t.tool === "blast_radius"));
    await engine.step("acme", incident.id);
    current = await store.get("acme", incident.id);
    assert.equal(current?.status, "awaiting_approval");
    assert.equal(current?.plan.procedureId, "mem-playbook");
    assert.equal(current?.plan.factId, "mem-topology");
    assert.ok(
      current?.plan.forbidden.includes("restart"),
      "rejected decision forbids restart",
    );
    assert.ok(current?.plan.decisionIds.includes("dec-18"));
    assert.equal(await engine.step("acme", incident.id), false);
    await engine.action("acme", incident.id, "approve");
    await engine.step("acme", incident.id);
    await engine.step("acme", incident.id);
    current = await store.get("acme", incident.id);
    assert.equal(current?.status, "resolved");
    assert.equal(current?.sandbox.pool, 40);
    assert.ok(
      (await store.context("acme", incident.id)).some(
        (m) => m.incidentId === incident.id,
      ),
    );
    assert.equal(
      (await store.edges("acme")).filter((e) => e.relation === "HANDS_OFF_TO")
        .length,
      3,
    );
    assert.equal((await store.get("acme", "mem-playbook"))?.verifiedRuns, 2);
    const learned = await store.get("acme", `${incident.id}:memory:outcome`);
    assert.equal(
      learned?.serviceId,
      "service-db",
      "outcome attaches to the root cause",
    );
    assert.ok(
      (await store.edges("acme")).some(
        (e) =>
          e.from === incident.id &&
          e.relation === "ROOT_CAUSE" &&
          e.to === "service-db",
      ),
    );
  } finally {
    await store.close();
  }
});
test("a worker-queue signal steers the investigation to a different root cause and procedure", async () => {
  const store = new SQLiteStore(":memory:");
  try {
    await seed(store);
    const engine = new Engine(store, 0, false);
    const incident = await engine.create("acme", {
      title: "Checkout errors with worker backlog",
      description: "",
      severity: "P1",
      scenario: "worker",
    });
    await engine.action("acme", incident.id, "start");
    await engine.step("acme", incident.id);
    const current = await store.get("acme", incident.id);
    assert.equal(current?.investigation.rootCauseServiceId, "service-worker");
    assert.ok(
      current?.investigation.rootCauseMemoryIds.includes("mem-worker-pool"),
    );
    await engine.step("acme", incident.id);
    assert.equal(
      (await store.get("acme", incident.id))?.plan.procedureId,
      "mem-worker-runbook",
    );
  } finally {
    await store.close();
  }
});
test("50 workers competing for a task produce exactly one successful claim", async () => {
  const { store, engine, incident } = await fixture();
  try {
    const claims = await Promise.all(
      Array.from({ length: 50 }, () =>
        engine.claim("acme", `${incident.id}:task:0`),
      ),
    );
    assert.equal(claims.filter(Boolean).length, 1);
  } finally {
    await store.close();
  }
});
test("memory correction preserves history and prevents approval of an outdated plan", async () => {
  const { store, engine, incident } = await fixture();
  try {
    await engine.action("acme", incident.id, "start");
    await engine.step("acme", incident.id);
    await engine.step("acme", incident.id);
    const fresh = await engine.migrate("acme", incident.id);
    assert.equal(
      (await store.get("acme", "mem-topology"))?.status,
      "superseded",
    );
    assert.equal((await store.get("acme", incident.id))?.plan, null);
    await assert.rejects(() => engine.action("acme", incident.id, "approve"));
    const context = await store.context("acme", incident.id);
    assert.ok(context.some((m) => m.id === fresh.id));
    assert.ok(!context.some((m) => m.id === "mem-topology"));
    await engine.action("acme", incident.id, "resume");
    await engine.step("acme", incident.id);
    assert.equal(
      (await store.get("acme", incident.id))?.plan.database,
      fresh.database,
    );
    await engine.action("acme", incident.id, "approve");
    await engine.step("acme", incident.id);
    await engine.step("acme", incident.id);
    assert.equal((await store.get("acme", incident.id))?.status, "resolved");
  } finally {
    await store.close();
  }
});
test("workspace scope prevents cross-tenant lookup and graph traversal", async () => {
  const { store, engine, incident } = await fixture();
  try {
    assert.equal(await store.get("orbit", incident.id), undefined);
    assert.deepEqual(await store.context("orbit", incident.id), []);
    await assert.rejects(
      () => engine.action("orbit", incident.id, "start"),
      /not found/,
    );
    await engine.message("acme", incident.id, "What happened last time?");
    assert.equal(
      (await store.all("orbit")).filter((n) => n.kind === "message").length,
      0,
    );
    assert.equal(
      (await store.all("acme")).filter((n) => n.kind === "message").length,
      2,
    );
  } finally {
    await store.close();
  }
});
test("paused incident and conversation survive closing and reopening the database", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relayops-test-"));
  const path = join(dir, "memory.db");
  let store = new SQLiteStore(path);
  try {
    await seed(store);
    let engine = new Engine(store, 0, false);
    const incident = await engine.create("acme", {
      title: "Persistent incident test",
      description: "Restart this process",
      severity: "P1",
      scenario: "pool",
    });
    await engine.action("acme", incident.id, "start");
    await engine.step("acme", incident.id);
    await engine.action("acme", incident.id, "pause");
    await engine.message("acme", incident.id, "Remember this conversation");
    await store.close();
    store = new SQLiteStore(path);
    engine = new Engine(store, 0, false);
    assert.equal((await store.get("acme", incident.id))?.status, "paused");
    assert.equal(
      (await store.all("acme")).filter((n) => n.kind === "message").length,
      2,
    );
    await engine.action("acme", incident.id, "resume");
    await engine.step("acme", incident.id);
    assert.equal(
      (await store.get("acme", incident.id))?.status,
      "awaiting_approval",
    );
  } finally {
    await store.close();
    rmSync(dir, { recursive: true });
  }
});
test("an expired task lease can be reclaimed; the old worker cannot overwrite it", async () => {
  const { store, engine, incident } = await fixture();
  try {
    const claim = (await engine.claim("acme", `${incident.id}:task:0`))!;
    await store.commit(
      "acme",
      [{ ...claim, version: claim.version + 1, leaseUntil: Date.now() - 1 }],
      [],
      [{ id: claim.id, version: claim.version }],
    );
    const reclaimed = await engine.claim("acme", claim.id);
    assert.ok(reclaimed);
    assert.notEqual(claim.claim, reclaimed.claim);
    const stale = await store.commit(
      "acme",
      [{ ...claim, status: "done", version: claim.version + 1 }],
      [],
      [{ id: claim.id, version: claim.version }],
    );
    assert.equal(stale, false);
  } finally {
    await store.close();
  }
});
test("simultaneous incident runs do not duplicate a recovery or lose procedure updates", async () => {
  const { store, engine, incident } = await fixture();
  try {
    await engine.action("acme", incident.id, "start");
    await Promise.all(
      Array.from({ length: 20 }, () => engine.step("acme", incident.id)),
    );
    assert.equal((await store.get("acme", incident.id))?.stage, 1);
    await engine.step("acme", incident.id);
    await engine.action("acme", incident.id, "approve");
    await Promise.all(
      Array.from({ length: 20 }, () => engine.step("acme", incident.id)),
    );
    assert.equal(
      (await store.all("acme")).filter(
        (n) => n.kind === "event" && n.type === "handoff",
      ).length,
      1,
    );
  } finally {
    await store.close();
  }
});
test(
  "FalkorDB integration: scoped traversal, guarded writes, correction and complete recovery",
  { skip: process.env.TEST_FALKORDB !== "1" },
  async () => {
    process.env.FALKORDB_PREFIX = "relayops_test_engine";
    const { connectFalkor } = await import("../server/falkor");
    const { store, graph } = await connectFalkor();
    assert.equal(store.backend, "falkordb");
    try {
      await store.reset("acme");
      await store.reset("orbit");
      await seed(store);
      const engine = new Engine(store, 0, false, undefined, graph);
      const incident = await engine.create("acme", {
        title: "FalkorDB integration incident",
        description: "Graph-backed integration test",
        severity: "P2",
        scenario: "pool",
      });
      assert.ok((await store.context("acme", incident.id)).length >= 4);
      assert.equal((await store.context("orbit", incident.id)).length, 0);
      await engine.action("acme", incident.id, "start");
      const results = await Promise.all(
        Array.from({ length: 20 }, () => engine.step("acme", incident.id)),
      );
      assert.equal(results.filter(Boolean).length, 1);
      await engine.step("acme", incident.id);
      await engine.migrate("acme", incident.id);
      await engine.action("acme", incident.id, "resume");
      await engine.step("acme", incident.id);
      await engine.action("acme", incident.id, "approve");
      await engine.step("acme", incident.id);
      await engine.step("acme", incident.id);
      const done = await store.get("acme", incident.id);
      assert.equal(done?.status, "resolved");
      assert.equal(done?.investigation.rootCauseServiceId, "service-db");
      // Writes landed as typed labels and relationships, not a generic blob.
      const typed = await store.query(
        "acme",
        "MATCH (i:Incident {id:$id})-[:ROOT_CAUSE]->(s:Service) RETURN s.id AS id",
        { id: incident.id },
      );
      assert.equal(typed[0]?.id, "service-db");
      const learned = await store.query(
        "acme",
        "MATCH (s:Service {id:'service-db'})-[:HAS_MEMORY]->(m:Memory {category:'episodic'})-[:LEARNED_FROM]->(i:Incident {id:$id}) RETURN m.id AS id",
        { id: incident.id },
      );
      assert.equal(learned.length, 1);
      const superseded = await store.query(
        "acme",
        "MATCH (n:Memory)-[:SUPERSEDES]->(o:Memory {id:'mem-topology', status:'superseded'}) RETURN n.database AS db",
      );
      assert.equal(superseded[0]?.db, "orders-db-v2");
      // Graph-native features
      const found = await graph.searchMemory("acme", "connection pool");
      assert.ok(found.some((f) => f.node.id === "mem-playbook"));
      const critical = await graph.criticalServices("acme");
      assert.ok(critical.length > 0);
      assert.ok(critical.slice(0, 3).some((c) => ["service-checkout", "service-gateway"].includes(c.node.id)));
      const stats = await store.stats("acme");
      assert.ok(stats.nodes > 50 && stats.edges > 100);
      assert.equal(stats.graph, "relayops_test_engine_acme");
    } finally {
      await store.close();
    }
  },
);
