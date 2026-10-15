import { createBackend } from "./store";
import { seed, WORKSPACES } from "./seed";
import { Engine } from "./engine";
import { createApp } from "./app";
const startedAt = Date.now();
const { store, graph } = await createBackend();
await seed(store);
const engine = new Engine(store, graph);
if (
  !(await store.all("acme")).some(
    (n) => n.kind === "incident" && n.id !== "inc-history",
  )
) {
  await engine.create("acme", {
    title: "Checkout API is returning elevated errors",
    description:
      "Error rate crossed 10% after the latest traffic spike. Customers are seeing intermittent failures at checkout.",
    severity: "P1",
    scenario: "pool",
  });
}
const app = createApp(store, engine, { startedAt });
const host = process.env.HOST ?? "127.0.0.1";
if (
  !["127.0.0.1", "localhost", "::1"].includes(host) &&
  !process.env.DEMO_ACCESS_CODE
)
  throw new Error(
    "Set DEMO_ACCESS_CODE before exposing this demo on a network.",
  );
const server = app.listen(Number(process.env.PORT ?? 4177), host, () =>
  console.log(
    `RelayOps API · http://${host}:${process.env.PORT ?? 4177} · ${store.backend} · ${engine.modelInfo.provider === "simulation" ? "simulation" : `${engine.modelInfo.provider} configured (${engine.modelInfo.model})`}`,
  ),
);
let ticking = false;
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    await Promise.all(
      WORKSPACES.map(async (w) => {
        const incidents = (await store.all(w.id)).filter(
          (n) =>
            n.kind === "incident" &&
            ["investigating", "resolving"].includes(n.status),
        );
        await Promise.all(incidents.map((i) => engine.step(w.id, i.id)));
      }),
    );
  } catch (err) {
    console.error("Worker error:", err instanceof Error ? err.message : err);
  } finally {
    ticking = false;
  }
}, 1200);
async function shutdown() {
  clearInterval(timer);
  server.close();
  await store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
