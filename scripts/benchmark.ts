import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { createStore } from "../server/store";
import { Engine } from "../server/engine";
import { entity } from "../server/seed";

const store = await createStore();
const tenant = "benchmark";
const workers = Number(process.env.BENCH_WORKERS ?? 50);
const writesPerWorker = 20;
const run = randomUUID();
const samples: number[] = [];
const started = performance.now();
await Promise.all(
  Array.from({ length: workers }, async (_, worker) => {
    for (let i = 0; i < writesPerWorker; i++) {
      const id = `${run}-${worker}-${i}`;
      const start = performance.now();
      await store.commit(tenant, [
        entity(id, "event", {
          title: "Benchmark write",
          run,
          worker,
          sequence: i,
        }),
      ]);
      const found = await store.get(tenant, id);
      if (!found || found.sequence !== i)
        throw new Error("Read-after-write mismatch");
      samples.push(performance.now() - start);
    }
  }),
);
const duration = performance.now() - started;
const task = entity(`claim-${run}`, "task", { status: "ready", leaseUntil: 0 });
await store.commit(tenant, [task]);
const engine = new Engine(store, 0, false);
const claims = await Promise.all(
  Array.from({ length: workers }, () => engine.claim(tenant, task.id)),
);
const stored = (await store.all(tenant)).filter((n) => n.run === run).length;
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      backend: store.backend,
      workers,
      writes: workers * writesPerWorker,
      stored,
      missingWrites: workers * writesPerWorker - stored,
      readWritePairsPerSecond: Math.round(samples.length / (duration / 1000)),
      p95ReadWritePairMs: Number(
        samples[Math.floor(samples.length * 0.95)].toFixed(2),
      ),
      elapsedMs: Math.round(duration),
      successfulClaims: claims.filter(Boolean).length,
      duplicateClaims: Math.max(0, claims.filter(Boolean).length - 1),
      note: "Local load-generator results; no model calls. SQLite serializes synchronous operations inside one process. These results do not establish FalkorDB throughput or production scalability.",
    },
    null,
    2,
  ),
);
await store.close();
