import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Engine } from "../server/engine";
import { seed, WORKSPACES } from "../server/seed";
import type { Store, Guard } from "../server/store";
import type { Entity, Edge } from "./types";
import "./styles.css";

// Deliberately separate, single-tab browser demo. It is not the server's memory store or authentication layer.
class BrowserDemoStore implements Store {
  backend = "browser" as const;
  private read(tenant: string): { nodes: Entity[]; edges: Edge[] } {
    const value = localStorage.getItem(`relayops.browser-demo.v2.${tenant}`);
    return value ? JSON.parse(value) : { nodes: [], edges: [] };
  }
  async all(tenant: string) {
    return this.read(tenant).nodes;
  }
  async edges(tenant: string) {
    return this.read(tenant).edges;
  }
  async get(tenant: string, id: string) {
    return this.read(tenant).nodes.find((n) => n.id === id);
  }
  async commit(
    tenant: string,
    nodes: Entity[],
    edges: Edge[] = [],
    guards: Guard[] = [],
  ) {
    const data = this.read(tenant);
    if (
      guards.some(
        (g) => data.nodes.find((n) => n.id === g.id)?.version !== g.version,
      )
    )
      return false;
    for (const node of nodes) {
      const index = data.nodes.findIndex((n) => n.id === node.id);
      if (index < 0) data.nodes.push(node);
      else data.nodes[index] = node;
    }
    for (const edge of edges)
      if (
        !data.edges.some(
          (e) =>
            e.from === edge.from &&
            e.to === edge.to &&
            e.relation === edge.relation,
        )
      )
        data.edges.push(edge);
    localStorage.setItem(
      `relayops.browser-demo.v2.${tenant}`,
      JSON.stringify(data),
    );
    return true;
  }
  async context(tenant: string, id: string) {
    const data = this.read(tenant);
    let frontier = new Set([id]);
    const found = new Set([id]);
    for (let depth = 0; depth < 3; depth++) {
      const next = new Set<string>();
      for (const e of data.edges)
        if (frontier.has(e.from)) {
          next.add(e.to);
          found.add(e.to);
        }
      frontier = next;
    }
    return data.nodes.filter(
      (n) => found.has(n.id) && n.kind === "memory" && n.status === "active",
    );
  }
  async close() {}
}
async function start() {
  const store = new BrowserDemoStore();
  await seed(store);
  const engine = new Engine(store, 1400, false, {
    provider: "simulation",
  });
  if (
    !(await store.all("acme")).some(
      (n) => n.kind === "incident" && n.id !== "inc-history",
    )
  )
    await engine.create("acme", {
      title: "Checkout API is returning elevated errors",
      description:
        "Error rate crossed 10% after the latest traffic spike. Customers are seeing intermittent failures at checkout.",
      severity: "P1",
      scenario: "pool",
    });
  let tenant = sessionStorage.getItem("relayops.browser-demo.tenant") ?? "acme";
  if (!WORKSPACES.some((w) => w.id === tenant)) tenant = "acme";
  const startedAt = Date.now();
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : input.url;
    if (!path.startsWith("/api/")) return originalFetch(input, init);
    try {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      let result: any = { ok: true };
      if (path === "/api/state")
        result = {
          workspace: WORKSPACES.find((w) => w.id === tenant),
          workspaces: WORKSPACES,
          nodes: await store.all(tenant),
          edges: await store.edges(tenant),
          backend: "browser",
          model: "simulation",
          modelInfo: engine.modelInfo,
          serverStartedAt: startedAt,
        };
      else if (path === "/api/workspace") {
        if (!WORKSPACES.some((w) => w.id === body.id))
          throw new Error("Unknown demo workspace");
        tenant = body.id;
        sessionStorage.setItem("relayops.browser-demo.tenant", tenant);
      } else if (path === "/api/incidents")
        result = await engine.create(tenant, body);
      else if (path.match(/^\/api\/incidents\/[^/]+\/action$/)) {
        const id = path.split("/")[3];
        if (body.action === "migrate") await engine.migrate(tenant, id);
        else await engine.action(tenant, id, body.action);
      } else if (path.match(/^\/api\/incidents\/[^/]+\/messages$/))
        result = await engine.message(tenant, path.split("/")[3], body.text);
      else if (path !== "/api/session")
        throw new Error("This action requires the local server.");
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error: any) {
      return new Response(
        JSON.stringify({ error: error.message ?? "Demo action failed" }),
        {
          status: error.status ?? 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  };
  document.addEventListener("click", async (event) => {
    const target = (event.target as Element).closest('a[href="/api/export"]');
    if (!target) return;
    event.preventDefault();
    const json = JSON.stringify(
      {
        workspace: tenant,
        mode: "browser-demo",
        exportedAt: new Date().toISOString(),
        nodes: await store.all(tenant),
        edges: await store.edges(tenant),
      },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([json], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `relayops-demo-${tenant}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  let working = false;
  setInterval(async () => {
    if (working) return;
    working = true;
    try {
      for (const w of WORKSPACES)
        for (const incident of (await store.all(w.id)).filter(
          (n) =>
            n.kind === "incident" &&
            ["investigating", "resolving"].includes(n.status),
        ))
          await engine.step(w.id, incident.id);
    } finally {
      working = false;
    }
  }, 1000);
  createRoot(document.getElementById("root")!).render(<App />);
}
start().catch((error) => {
  const root = document.getElementById("root")!;
  root.textContent = `The browser demo could not start: ${error.message}. Open the README for local-server setup.`;
});
