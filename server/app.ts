import express from "express";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Store } from "./store";
import { Engine, SCENARIOS } from "./engine";
import { WORKSPACES } from "./seed";

export function createApp(
  store: Store,
  engine: Engine,
  options: { secret?: string; accessCode?: string; startedAt?: number } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  const accessCode = options.accessCode ?? process.env.DEMO_ACCESS_CODE ?? "";
  let secret = options.secret;
  if (!secret) {
    mkdirSync(".data", { recursive: true });
    if (!existsSync(".data/session-secret"))
      writeFileSync(".data/session-secret", randomBytes(48).toString("hex"), {
        mode: 0o600,
      });
    secret = readFileSync(".data/session-secret", "utf8");
  }
  const sign = (payload: string) =>
    createHmac("sha256", secret!).update(payload).digest("base64url");
  const issue = (res: express.Response, tenant: string) => {
    const payload = Buffer.from(
      JSON.stringify({
        tenant,
        memberships: ["acme", "orbit"],
        exp: Date.now() + 7 * 86400000,
      }),
    ).toString("base64url");
    res.cookie("relay_session", `${payload}.${sign(payload)}`, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 7 * 86400000,
      path: "/",
    });
  };
  app.use(express.json({ limit: "32kb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET" && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) {
          res
            .status(403)
            .json({ error: "Cross-origin writes are not allowed" });
          return;
        }
      } catch {
        res.status(403).json({ error: "Invalid origin" });
        return;
      }
    }
    next();
  });
  app.get("/api/health", async (_req, res) => {
    const graphs = store.stats
      ? await Promise.all(WORKSPACES.map((w) => store.stats!(w.id))).catch(
          () => undefined,
        )
      : undefined;
    res.json({ ok: true, backend: store.backend, graphs });
  });
  app.post("/api/session", (req, res) => {
    const address = req.socket.remoteAddress ?? "";
    if (
      !accessCode &&
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)
    ) {
      res
        .status(403)
        .json({ error: "Remote demo access requires DEMO_ACCESS_CODE" });
      return;
    }
    if (accessCode && req.body?.code !== accessCode) {
      res.status(401).json({ error: "Enter the demo access code" });
      return;
    }
    issue(res, "acme");
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    try {
      const cookie = req.headers.cookie
        ?.split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith("relay_session="))
        ?.slice("relay_session=".length);
      if (!cookie) throw new Error();
      const [payload, signature] = decodeURIComponent(cookie).split(".");
      const actual = Buffer.from(signature ?? "");
      const expected = Buffer.from(sign(payload));
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error();
      const session = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (
        session.exp < Date.now() ||
        !session.memberships.includes(session.tenant) ||
        !WORKSPACES.some((w) => w.id === session.tenant)
      )
        throw new Error();
      res.locals.session = session;
      next();
    } catch {
      res
        .status(401)
        .json({ error: "Session expired. Reconnect to your workspace." });
    }
  });
  app.get("/api/state", async (_req, res) => {
    const tenant = res.locals.session.tenant;
    const [nodes, edges] = await Promise.all([
      store.all(tenant),
      store.edges(tenant),
    ]);
    res.json({
      workspace: WORKSPACES.find((w) => w.id === tenant),
      workspaces: WORKSPACES.filter((w) =>
        res.locals.session.memberships.includes(w.id),
      ),
      nodes,
      edges,
      backend: store.backend,
      model: engine.modelInfo.provider,
      modelInfo: engine.modelInfo,
      serverStartedAt: options.startedAt ?? 0,
      live: engine.live(tenant),
      graphStats: store.stats
        ? await store.stats(tenant).catch(() => undefined)
        : undefined,
      critical: await engine.graph
        .criticalServices(tenant, 5)
        .then((rows) => rows.map((r) => ({ id: r.node.id, score: r.score })))
        .catch(() => []),
    });
  });
  app.post("/api/model/check", async (_req, res) => {
    res.json(await engine.checkModel());
  });
  app.post("/api/workspace", (req, res) => {
    const id = z.string().parse(req.body.id);
    if (!res.locals.session.memberships.includes(id)) {
      res
        .status(403)
        .json({ error: "You do not have access to this workspace" });
      return;
    }
    issue(res, id);
    res.json({ ok: true });
  });
  app.post("/api/incidents", async (req, res) => {
    const data = z
      .object({
        title: z.string().trim().min(5).max(120),
        description: z.string().trim().max(2000).default(""),
        severity: z.enum(["P1", "P2", "P3"]).default("P1"),
        scenario: z
          .enum(["pool", "worker", "cache", "migration"])
          .default("pool"),
      })
      .parse(req.body);
    res.status(201).json(await engine.create(res.locals.session.tenant, data));
  });
  app.get("/api/scenarios", (_req, res) => {
    res.json(Object.entries(SCENARIOS).map(([id, s]) => ({ id, ...s })));
  });
  // Read-only graph questions, the same ones the agents use.
  const nodeId = z.string().regex(/^[a-z0-9:_-]{1,80}$/i);
  app.get("/api/graph/:tool/:serviceId", async (req, res) => {
    const tool = z
      .enum([
        "suspects",
        "blast_radius",
        "similar_incidents",
        "who_knows",
        "decisions",
      ])
      .parse(req.params.tool);
    const serviceId = nodeId.parse(req.params.serviceId);
    const tenant = res.locals.session.tenant;
    const g = engine.graph;
    const result =
      tool === "suspects"
        ? await g.suspects(tenant, serviceId)
        : tool === "blast_radius"
          ? await g.blastRadius(tenant, serviceId)
          : tool === "similar_incidents"
            ? await g.similarIncidents(tenant, serviceId)
            : tool === "who_knows"
              ? await g.whoKnows(tenant, serviceId)
              : await g.decisions(tenant, serviceId);
    res.json(result);
  });
  app.get("/api/graph/critical", async (_req, res) => {
    res.json(await engine.graph.criticalServices(res.locals.session.tenant));
  });
  app.get("/api/graph/search", async (req, res) => {
    const q = z.string().trim().min(2).max(120).parse(req.query.q);
    res.json(await engine.graph.searchMemory(res.locals.session.tenant, q));
  });
  app.get("/api/graph/path", async (req, res) => {
    const from = nodeId.parse(req.query.from);
    const to = nodeId.parse(req.query.to);
    res.json(
      (await engine.graph.path(res.locals.session.tenant, from, to)) ?? null,
    );
  });
  app.post("/api/incidents/:id/action", async (req, res) => {
    const action = z
      .enum(["start", "pause", "resume", "approve", "migrate"])
      .parse(req.body.action);
    const tenant = res.locals.session.tenant;
    if (action === "migrate") await engine.migrate(tenant, req.params.id);
    else await engine.action(tenant, req.params.id, action);
    res.json({ ok: true });
  });
  app.post("/api/incidents/:id/messages", async (req, res) => {
    const text = z.string().trim().min(1).max(2000).parse(req.body.text);
    res
      .status(201)
      .json(
        await engine.message(res.locals.session.tenant, req.params.id, text),
      );
  });
  app.get("/api/export", async (_req, res) => {
    const tenant = res.locals.session.tenant;
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="relayops-${tenant}-memory.json"`,
    );
    res.json({
      workspace: tenant,
      exportedAt: new Date().toISOString(),
      nodes: await store.all(tenant),
      edges: await store.edges(tenant),
    });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found" }),
  );
  if (existsSync("dist/index.html")) {
    app.use(express.static(resolve("dist")));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve("dist/index.html")),
    );
  }
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = err instanceof z.ZodError ? 400 : (err.status ?? 500);
      if (status === 500) console.error("Request failed:", err.message);
      res.status(status).json({
        error:
          err instanceof z.ZodError
            ? err.issues[0]?.message
            : status === 500
              ? "The request could not be completed. Check the server and try again."
              : err.message,
      });
    },
  );
  return app;
}
