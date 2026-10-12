import { test } from "node:test";
import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { Express } from "express";
import { SQLiteStore } from "../server/store";
import { seed } from "../server/seed";
import { Engine } from "../server/engine";
import { createApp } from "../server/app";

// Exercise Express middleware and routes without a listening socket. This does not test the HTTP transport.
function request(
  app: Express,
  path: string,
  options: {
    method?: string;
    cookie?: string;
    body?: any;
    origin?: string;
  } = {},
): Promise<{ status: number; headers: Record<string, any>; body: any }> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
    const req = new IncomingMessage(socket);
    req.method = options.method ?? "GET";
    req.url = path;
    const data = options.body === undefined ? "" : JSON.stringify(options.body);
    req.headers = {
      host: "localhost",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(data
        ? {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(data).toString(),
          }
        : {}),
    };
    const res = new ServerResponse(req);
    res.end = ((chunk: any) => {
      try {
        resolve({
          status: res.statusCode,
          headers: res.getHeaders(),
          body: chunk ? JSON.parse(chunk.toString()) : null,
        });
      } catch (err) {
        reject(err);
      }
      return res;
    }) as typeof res.end;
    app(req, res);
    if (data) req.push(Buffer.from(data));
    req.push(null);
  });
}
test("API enforces session, membership, tenant scope, origin, and input validation", async () => {
  const store = new SQLiteStore(":memory:");
  await seed(store);
  const app = createApp(store, new Engine(store, 0, false), {
    secret: "test-session-secret",
  });
  try {
    assert.equal((await request(app, "/api/state")).status, 401);
    const login = await request(app, "/api/session", {
      method: "POST",
      body: {},
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    assert.ok(cookie.includes("relay_session="));
    assert.equal(
      (
        await request(app, "/api/workspace", {
          method: "POST",
          cookie,
          body: { id: "private-company" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(app, "/api/incidents", {
          method: "POST",
          cookie,
          body: { title: "bad" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(app, "/api/incidents", {
          method: "POST",
          cookie,
          origin: "https://evil.example",
          body: {},
        })
      ).status,
      403,
    );
    const created = await request(app, "/api/incidents", {
      method: "POST",
      cookie,
      body: { title: "Private Acme incident", tenant: "orbit" },
    });
    assert.equal(created.status, 201);
    assert.ok(await store.get("acme", created.body.id));
    assert.equal(await store.get("orbit", created.body.id), undefined);
    const switched = await request(app, "/api/workspace", {
      method: "POST",
      cookie,
      body: { id: "orbit" },
    });
    const orbitCookie = String(switched.headers["set-cookie"]).split(";")[0];
    const denied = await request(
      app,
      `/api/incidents/${created.body.id}/action`,
      { method: "POST", cookie: orbitCookie, body: { action: "start" } },
    );
    assert.equal(denied.status, 404);
    const tampered = cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a");
    assert.equal(
      (await request(app, "/api/state", { cookie: tampered })).status,
      401,
    );
  } finally {
    await store.close();
  }
});
test("a hosted demo access code is required and is not disclosed by API responses", async () => {
  const store = new SQLiteStore(":memory:");
  await seed(store);
  const app = createApp(store, new Engine(store, 0, false), {
    secret: "test-session-secret",
    accessCode: "sample-demo-code",
  });
  try {
    const denied = await request(app, "/api/session", {
      method: "POST",
      body: { code: "wrong" },
    });
    assert.equal(denied.status, 401);
    assert.ok(!JSON.stringify(denied.body).includes("sample-demo-code"));
    const allowed = await request(app, "/api/session", {
      method: "POST",
      body: { code: "sample-demo-code" },
    });
    assert.equal(allowed.status, 200);
    assert.ok(String(allowed.headers["set-cookie"]).includes("HttpOnly"));
    assert.ok(
      String(allowed.headers["set-cookie"]).includes("SameSite=Strict"),
    );
  } finally {
    await store.close();
  }
});

test("model status and connection checks require a session and never return the API key", async (t) => {
  const store = new SQLiteStore(":memory:");
  await seed(store);
  const engine = new Engine(store, 0, true, {
    provider: "openai",
    key: "test-secret-key",
    model: "gpt-5.4-mini",
  });
  const app = createApp(store, engine, { secret: "test-session-secret" });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "READY" }],
          },
        ],
      }),
    );
  });
  try {
    assert.equal(
      (await request(app, "/api/model/check", { method: "POST", body: {} }))
        .status,
      401,
    );
    assert.equal(calls, 0);
    const login = await request(app, "/api/session", {
      method: "POST",
      body: {},
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const before = await request(app, "/api/state", { cookie });
    assert.equal(before.body.model, "openai");
    assert.equal(before.body.modelInfo.status, "unverified");
    assert.ok(!JSON.stringify(before.body).includes("test-secret-key"));
    const checked = await request(app, "/api/model/check", {
      method: "POST",
      cookie,
      body: {},
    });
    assert.equal(checked.status, 200);
    assert.equal(checked.body.status, "ready");
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(checked.body).includes("test-secret-key"));
  } finally {
    await store.close();
  }
});
