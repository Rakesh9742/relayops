import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  modelConfigFromEnv,
  ReasoningClient,
  type ModelConfig,
} from "../server/model";
import { SQLiteStore, IndexedGraph } from "./doubles";
import { seed, entity } from "../server/seed";
import { Engine } from "../server/engine";

const config: ModelConfig = {
  provider: "openai",
  key: "test-only-key",
  model: "gpt-5.4-mini",
};
const completed = (text: string) => ({
  status: "completed",
  output: [
    { type: "reasoning", summary: [] },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  ],
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
/** A Responses API turn that calls one function. */
const toolCall = (
  name: string,
  args: Record<string, unknown>,
  id = `call_${name}`,
) => ({
  status: "completed",
  output: [
    { type: "reasoning", summary: [] },
    {
      type: "function_call",
      call_id: id,
      name,
      arguments: JSON.stringify(args),
    },
  ],
});
/** The first user turn of a Responses API request body. */
const firstInput = (init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  const user = body.input.find((t: any) => t.role === "user");
  return JSON.parse(user.content);
};

test("provider selection is explicit; missing keys cannot silently change provider", () => {
  assert.deepEqual(modelConfigFromEnv({}), { provider: "simulation" });
  assert.equal(
    modelConfigFromEnv({
      OPENAI_API_KEY: " openai ",
      ANTHROPIC_API_KEY: "claude",
    }).provider,
    "openai",
  );
  assert.equal(
    modelConfigFromEnv({ ANTHROPIC_API_KEY: "claude" }).provider,
    "anthropic",
  );
  assert.deepEqual(
    modelConfigFromEnv({ MODEL_PROVIDER: "simulation", OPENAI_API_KEY: "key" }),
    { provider: "simulation" },
  );
  assert.throws(
    () =>
      modelConfigFromEnv({
        MODEL_PROVIDER: "openai",
        ANTHROPIC_API_KEY: "key",
      }),
    /OPENAI_API_KEY/,
  );
  assert.throws(
    () => modelConfigFromEnv({ MODEL_PROVIDER: "unknown" }),
    /MODEL_PROVIDER/,
  );
});

test("OpenAI uses server authorization, stateless Responses, and parses text after reasoning items", async () => {
  let requests = 0;
  const client = new ReasoningClient(config, async (url, init) => {
    requests++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer test-only-key",
    );
    assert.ok(init?.signal instanceof AbortSignal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.equal(body.instructions, "Use only evidence.");
    assert.equal(body.input, "Evidence here.");
    assert.equal(body.model, "gpt-5.4-mini");
    assert.equal(body.tools, undefined);
    return response(completed("Grounded answer [mem-topology]."));
  });
  assert.equal(client.info.status, "unverified");
  assert.equal(
    await client.generate("Use only evidence.", "Evidence here."),
    "Grounded answer [mem-topology].",
  );
  assert.equal(requests, 1);
  assert.equal(client.info.status, "ready");
  assert.ok(client.info.checkedAt);
  assert.ok(!JSON.stringify(client.info).includes("test-only-key"));
});

test("failures, partial answers, refusals, and invalid output are surfaced without leaking provider bodies", async (t) => {
  for (const status of [401, 404, 429, 500]) {
    await t.test(`HTTP ${status}`, async () => {
      const client = new ReasoningClient(config, async () =>
        response({ error: "test-only-key private-evidence" }, status),
      );
      await assert.rejects(
        () => client.generate("instructions", "data"),
        new RegExp(String(status)),
      );
      assert.equal(client.info.status, "error");
      assert.ok(!JSON.stringify(client.info).includes("test-only-key"));
      assert.ok(!JSON.stringify(client.info).includes("private-evidence"));
    });
  }
  for (const body of [
    { ...completed("partial"), status: "incomplete" },
    { ...completed("failed"), status: "failed" },
    { status: "completed", output: [] },
    {
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "refusal", refusal: "private-evidence" }],
        },
      ],
    },
    null,
  ]) {
    const client: ReasoningClient = new ReasoningClient(config, async () =>
      response(body),
    );
    await assert.rejects(() => client.generate("instructions", "data"));
    assert.equal(client.info.status, "error");
  }
  const client = new ReasoningClient(config, async () => {
    throw new DOMException("private-evidence", "TimeoutError");
  });
  await assert.rejects(
    () => client.generate("instructions", "data"),
    /timed out/,
  );
  assert.ok(!client.info.error?.includes("private-evidence"));
});

test("connection checks share an in-flight call; simulation makes no network requests", async () => {
  let requests = 0;
  const transport: typeof fetch = async (_url, init) => {
    requests++;
    assert.equal(JSON.parse(String(init?.body)).input, "Connection check.");
    return response(completed("READY"));
  };
  const client = new ReasoningClient(config, transport);
  const results = await Promise.all([
    client.check(),
    client.check(),
    client.check(),
  ]);
  assert.equal(requests, 1);
  assert.ok(results.every((result) => result.status === "ready"));
  const simulation = new ReasoningClient({ provider: "simulation" }, transport);
  assert.equal((await simulation.check()).status, "simulation");
  assert.equal(requests, 1);
});

test("the existing Anthropic provider remains available", async () => {
  const client = new ReasoningClient(
    {
      provider: "anthropic",
      key: "test-claude-key",
      model: "claude-sonnet-4-5",
    },
    async (url, init) => {
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      assert.equal(
        new Headers(init?.headers).get("x-api-key"),
        "test-claude-key",
      );
      assert.deepEqual(JSON.parse(String(init?.body)).messages, [
        { role: "user", content: "Question" },
      ]);
      return response({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Answer" }],
      });
    },
  );
  assert.equal(await client.generate("Instructions", "Question"), "Answer");
});

test("AI follow-ups retrieve saved incident conversation after restart and exclude other tenants and incidents", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relayops-model-test-"));
  const path = join(dir, "memory.db");
  let store = new SQLiteStore(path);
  const inputs: any[] = [];
  const bodies: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      bodies.push(String(init.body));
      inputs.push(firstInput(init));
      return response(
        completed("The pool procedure is relevant [mem-playbook]."),
      );
    },
  );
  try {
    await seed(store);
    let engine = new Engine(store, new IndexedGraph(store), 0, true, config);
    const incident = await engine.create("acme", {
      title: "Remember operator context",
      description: "Sample",
      severity: "P1",
      scenario: "pool",
    });
    await engine.message(
      "acme",
      incident.id,
      "The operator is Jamie. What happened last time?",
    );
    await store.commit("orbit", [
      entity("orbit-private", "message", {
        incidentId: incident.id,
        role: "user",
        content: "ORBIT_PRIVATE",
      }),
    ]);
    await store.commit("acme", [
      entity("other-private", "message", {
        incidentId: "other-incident",
        role: "user",
        content: "OTHER_INCIDENT_PRIVATE",
      }),
    ]);
    await store.close();
    store = new SQLiteStore(path);
    engine = new Engine(store, new IndexedGraph(store), 0, true, config);
    await engine.message(
      "acme",
      incident.id,
      "Who is the operator and what should they do next?",
    );
    const followup = inputs.at(-1);
    assert.equal(followup.conversation.length, 2);
    assert.ok(
      followup.conversation.some((turn: any) => turn.content.includes("Jamie")),
    );
    assert.ok(
      followup.conversation.some((turn: any) => turn.role === "assistant"),
    );
    assert.ok(!bodies.join().includes("ORBIT_PRIVATE"));
    assert.ok(!bodies.join().includes("OTHER_INCIDENT_PRIVATE"));
    assert.equal(followup.incident.id, incident.id);
    assert.ok(
      bodies.at(-1)!.includes('"name":"who_knows"'),
      "graph tools are offered",
    );
    assert.equal(
      (await store.all("acme")).filter(
        (n) => n.kind === "message" && n.incidentId === incident.id,
      ).length,
      4,
    );
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("model failure preserves the task checkpoint and an explicit retry completes the handoff", async (t) => {
  const store = new SQLiteStore(":memory:");
  let fail = true;
  const script = [
    toolCall("suspects", { serviceId: "service-checkout" }),
    toolCall("finish", {
      summary:
        "Pool exhaustion on orders-db is supported by memory [mem-topology].",
      rootCauseServiceId: "service-db",
      rootCauseMemoryIds: ["mem-topology", "mem-playbook"],
      ruledOut: ["service-cache"],
      impactedServiceIds: ["service-gateway"],
    }),
  ];
  let turn = 0;
  const toolResults: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      if (fail) return response({ error: "test-only-key" }, 429);
      const body = JSON.parse(String(init.body));
      for (const item of body.input)
        if (item.type === "function_call_output") toolResults.push(item.output);
      return response(script[turn++]);
    },
  );
  try {
    await seed(store);
    const engine = new Engine(store, new IndexedGraph(store), 0, true, config);
    const incident = await engine.create("acme", {
      title: "Provider retry workflow",
      description: "Sample",
      severity: "P1",
      scenario: "pool",
    });
    await engine.action("acme", incident.id, "start");
    assert.equal(await engine.step("acme", incident.id), false);
    const failed = await store.get("acme", incident.id);
    assert.equal(failed?.status, "error");
    assert.equal(failed?.stage, 0);
    assert.match(failed?.error, /429/);
    assert.ok(
      !JSON.stringify(await store.all("acme")).includes("test-only-key"),
    );
    fail = false;
    await engine.action("acme", incident.id, "resume");
    assert.equal(await engine.step("acme", incident.id), true);
    const after = await store.get("acme", incident.id);
    assert.equal(after?.stage, 1);
    assert.equal(after?.investigation.rootCauseServiceId, "service-db");
    assert.equal(
      after?.investigation.toolCalls,
      1,
      "finish is not a graph query",
    );
    assert.ok(
      toolResults[0].includes("service-db"),
      "model received real graph results",
    );
    const finding = (await store.all("acme")).find(
      (n) => n.kind === "event" && n.type === "finding",
    );
    assert.equal(finding?.traces.length, 1);
    assert.equal(finding?.traces[0].tool, "suspects");
    assert.ok(finding?.traces[0].paths.length > 0, "trace carries graph paths");
    assert.ok(
      (await store.edges("acme")).some(
        (e) =>
          e.from === incident.id &&
          e.to === "service-db" &&
          e.relation === "ROOT_CAUSE",
      ),
    );
    assert.equal(engine.modelInfo.status, "ready");
  } finally {
    await store.close();
  }
});
