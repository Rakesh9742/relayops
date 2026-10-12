import type { AgentId, Edge, Entity } from "../src/types";
import type { Store } from "./store";
import { entity } from "./seed";
import { IndexedGraph, type GraphTools } from "./graph";
import { investigate, plan as draftPlan, answer } from "./agents";
import {
  ReasoningClient,
  modelConfigFromEnv,
  type ModelConfig,
  type ConversationTurn,
} from "./model";
const randomUUID = () => globalThis.crypto.randomUUID();

/** Scenario presets: the signals an operator would paste from monitoring. */
export const SCENARIOS: Record<
  string,
  { signals: string[]; description: string }
> = {
  pool: {
    signals: [
      "pool.active = 20 / 20",
      "http.error_rate = 12.8%",
      "p95.latency = 2,840 ms",
    ],
    description:
      "Elevated 5xx responses. Database connection pool reports saturation.",
  },
  worker: {
    signals: [
      "pool.active = 20 / 20",
      "worker.queue_depth = 4,120",
      "http.error_rate = 9.1%",
    ],
    description:
      "Elevated 5xx responses. Pool saturated while the background worker queue is growing.",
  },
  cache: {
    signals: [
      "cache.evicted_keys = 18,400",
      "http.error_rate = 6.2%",
      "sessions.logout_spike = true",
    ],
    description:
      "Users are being logged out. Cache miss rate climbed sharply in the last ten minutes.",
  },
  migration: {
    signals: [
      "pool.active = 20 / 20",
      "http.error_rate = 12.8%",
      "p95.latency = 2,840 ms",
    ],
    description:
      "Elevated 5xx responses after a deployment. Database connection pool reports saturation.",
  },
};

export class ConflictError extends Error {
  status = 409;
}
export class MissingError extends Error {
  status = 404;
}
const agentFor = (stage: number): AgentId =>
  ["atlas", "sage", "sage", "echo"][stage] as AgentId;
const nextVersion = (n: Entity, data: Record<string, any>): Entity => ({
  ...n,
  ...data,
  version: n.version + 1,
});
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Engine {
  private reasoning: ReasoningClient;
  public graph: GraphTools;
  constructor(
    public store: Store,
    public delay = 1800,
    public useModel = true,
    modelConfig?: ModelConfig,
    graph?: GraphTools,
  ) {
    this.reasoning = new ReasoningClient(
      useModel
        ? (modelConfig ?? modelConfigFromEnv())
        : { provider: "simulation" },
    );
    this.graph = graph ?? new IndexedGraph(store);
  }
  get modelInfo() {
    return this.reasoning.info;
  }
  checkModel() {
    return this.reasoning.check();
  }
  private task(incidentId: string, stage: number) {
    return entity(`${incidentId}:task:${stage}`, "task", {
      incidentId,
      stage,
      agent: agentFor(stage),
      status: "ready",
      leaseUntil: 0,
    });
  }
  private event(
    incidentId: string,
    agent: string,
    title: string,
    content: string,
    extra: Record<string, any> = {},
  ) {
    return entity(`evt-${randomUUID()}`, "event", {
      incidentId,
      agent,
      title,
      content,
      ...extra,
    });
  }
  async create(
    tenant: string,
    data: {
      title: string;
      description: string;
      severity: string;
      scenario: string;
    },
  ) {
    const service = await this.store.get(tenant, "service-checkout");
    if (!service) throw new MissingError("Workspace not found");
    const topology = await this.databaseFact(tenant, service.id);
    const preset = SCENARIOS[data.scenario] ?? SCENARIOS.pool;
    const id = `inc-${randomUUID()}`;
    const incident = entity(id, "incident", {
      ...data,
      description: data.description || preset.description,
      number: `INC-${Date.now().toString().slice(-6)}`,
      serviceId: service.id,
      service: service.name,
      status: "open",
      stage: 0,
      environment: "simulation",
      signals: preset.signals,
      errorRate: 12.8,
      latency: 2840,
      sandbox: {
        database: topology?.database ?? "orders-db",
        pool: 20,
        healthy: false,
      },
      memoryReused: 0,
    });
    const event = this.event(
      id,
      "system",
      "Incident opened",
      incident.description,
      { type: "alert", evidence: preset.signals },
    );
    const task = this.task(id, 0);
    await this.store.commit(
      tenant,
      [incident, event, task],
      [
        { from: id, to: service.id, relation: "AFFECTS" },
        { from: id, to: event.id, relation: "HAS_EVENT" },
        { from: id, to: task.id, relation: "HAS_TASK" },
      ],
    );
    return incident;
  }
  async action(tenant: string, id: string, action: string) {
    const incident = await this.store.get(tenant, id);
    if (!incident || incident.kind !== "incident")
      throw new MissingError("Incident not found");
    if (incident.status === "resolved")
      throw new ConflictError(
        "This incident is already resolved. Start a new scenario.",
      );
    let patch: Record<string, any>;
    if (action === "start" && incident.status === "open")
      patch = { status: "investigating" };
    else if (
      action === "pause" &&
      ["investigating", "resolving"].includes(incident.status)
    )
      patch = { status: "paused", previousStatus: incident.status };
    else if (
      action === "resume" &&
      ["paused", "error"].includes(incident.status)
    )
      patch = {
        status: incident.stage < 2 ? "investigating" : "resolving",
        error: undefined,
      };
    else if (action === "approve" && incident.status === "awaiting_approval") {
      if (!incident.plan || !(await this.planIsCurrent(tenant, incident.plan)))
        throw new ConflictError(
          "This plan uses outdated memory. Introduce current evidence to rebuild it.",
        );
      patch = { status: "resolving", approvedAt: Date.now() };
    } else
      throw new ConflictError("The incident changed. Refresh and try again.");
    const event = this.event(
      id,
      "you",
      action === "approve"
        ? "Recovery plan approved"
        : action === "pause"
          ? "Investigation paused"
          : action === "resume"
            ? "Resumed from saved checkpoint"
            : "Investigation started",
      action === "approve"
        ? "Sage may apply the recovery procedure in the simulated environment."
        : "The shared memory and pending tasks are saved.",
      { type: "checkpoint" },
    );
    if (
      !(await this.store.commit(
        tenant,
        [nextVersion(incident, patch), event],
        [{ from: id, to: event.id, relation: "HAS_EVENT" }],
        [{ id, version: incident.version }],
      ))
    )
      throw new ConflictError(
        "Another agent updated this incident. Try again.",
      );
  }
  /** The active semantic fact naming the database behind a service: on the service or one hop upstream. */
  private async databaseFact(tenant: string, serviceId: string) {
    const own = (
      await this.graph.memoriesFor(tenant, serviceId, "semantic")
    ).find((m) => m.database);
    if (own) return own;
    for (const s of await this.graph.suspects(tenant, serviceId, 1)) {
      const fact = s.memories.find(
        (m) => m.category === "semantic" && m.database,
      );
      if (fact) return fact;
    }
    return undefined;
  }
  /** A plan is current only if every memory it cites is still active at the same version. */
  private async planIsCurrent(
    tenant: string,
    plan: { memoryIds: string[]; memoryVersions?: Record<string, number> },
  ) {
    for (const memoryId of plan.memoryIds) {
      const m = await this.store.get(tenant, memoryId);
      if (!m || m.status !== "active") return false;
      const expected = plan.memoryVersions?.[memoryId];
      if (expected !== undefined && m.version !== expected) return false;
    }
    return true;
  }
  async claim(tenant: string, id: string) {
    const task = await this.store.get(tenant, id);
    if (
      !task ||
      task.kind !== "task" ||
      task.status === "done" ||
      (task.status === "running" && task.leaseUntil > Date.now())
    )
      return undefined;
    const claimed = nextVersion(task, {
      status: "running",
      leaseUntil: Date.now() + 60000,
      claim: randomUUID(),
    });
    return (await this.store.commit(
      tenant,
      [claimed],
      [],
      [{ id, version: task.version }],
    ))
      ? claimed
      : undefined;
  }
  async step(tenant: string, id: string) {
    let incident = await this.store.get(tenant, id);
    if (
      !incident ||
      !["investigating", "resolving"].includes(incident.status) ||
      incident.stage >= 4
    )
      return false;
    const task = await this.claim(tenant, `${id}:task:${incident.stage}`);
    if (!task) return false;
    try {
      await pause(this.delay);
      incident = await this.store.get(tenant, id);
      if (
        !incident ||
        !["investigating", "resolving"].includes(incident.status) ||
        incident.stage !== task.stage
      ) {
        await this.release(tenant, task);
        return false;
      }
      const memory = await this.store.context(tenant, id);
      const nodes: Entity[] = [];
      const edges: Edge[] = [];
      let patch: Record<string, any> = { stage: incident.stage + 1 };
      let event: Entity;
      if (task.stage === 0) {
        const result = await investigate(
          this.reasoning,
          this.graph,
          tenant,
          incident,
        );
        const rootCause = await this.store.get(
          tenant,
          result.rootCauseServiceId,
        );
        if (!rootCause || rootCause.kind !== "service")
          throw new Error(
            `Atlas named an unknown root cause (${result.rootCauseServiceId}). Retry the investigation.`,
          );
        const touched = [...new Set(result.traces.flatMap((t) => t.nodeIds))];
        event = this.event(
          id,
          "atlas",
          `Root cause traced to ${rootCause.name}`,
          result.summary,
          {
            type: "finding",
            memoryIds: result.rootCauseMemoryIds,
            evidence: incident.signals ?? [],
            traces: result.traces,
            simulated: result.simulated,
          },
        );
        patch = {
          ...patch,
          memoryReused: touched.filter(
            (n) => n.startsWith("mem-") || n.includes(":memory:"),
          ).length,
          investigation: {
            summary: result.summary,
            rootCauseServiceId: result.rootCauseServiceId,
            rootCauseService: rootCause.name,
            rootCauseMemoryIds: result.rootCauseMemoryIds,
            ruledOut: result.ruledOut,
            impactedServiceIds: result.impactedServiceIds,
            escalateTo: result.escalateTo,
            toolCalls: result.traces.length,
            createdAt: Date.now(),
          },
        };
        edges.push({ from: id, to: rootCause.id, relation: "ROOT_CAUSE" });
        edges.push(
          ...result.rootCauseMemoryIds.map((memoryId: string) => ({
            from: task.id,
            to: memoryId,
            relation: "USES",
          })),
        );
      } else if (task.stage === 1) {
        if (!incident.investigation)
          throw new Error(
            "No investigation on record. Restart the incident so Atlas can trace the root cause.",
          );
        const draft = await draftPlan(
          this.reasoning,
          this.graph,
          tenant,
          incident,
          incident.investigation,
        );
        const procedure = await this.store.get(tenant, draft.procedureId);
        const fact = await this.store.get(tenant, draft.factId);
        if (
          !procedure ||
          procedure.kind !== "memory" ||
          procedure.status !== "active" ||
          !procedure.action
        )
          throw new Error(
            "Sage selected a procedure that is not an active procedural memory. Review shared memory.",
          );
        if (!fact || fact.kind !== "memory" || fact.status !== "active")
          throw new Error(
            "Sage selected a fact that is no longer current. Review shared memory.",
          );
        if (draft.forbidden.includes(procedure.action))
          throw new Error(
            `Procedure ${procedure.id} is forbidden by an engineering decision. Review decisions.`,
          );
        const rootCause = await this.store.get(
          tenant,
          incident.investigation.rootCauseServiceId,
        );
        const plan = {
          database: fact.database ?? incident.sandbox.database,
          target: fact.database ?? rootCause?.name ?? incident.service,
          action: procedure.action,
          targetPool: procedure.targetPool ?? incident.sandbox.pool,
          procedureId: procedure.id,
          factId: fact.id,
          memoryIds: [fact.id, procedure.id],
          memoryVersions: {
            [fact.id]: fact.version,
            [procedure.id]: procedure.version,
          },
          decisionIds: draft.decisionIds,
          forbidden: draft.forbidden,
          steps: procedure.steps,
          createdAt: Date.now(),
        };
        patch = { ...patch, status: "awaiting_approval", plan };
        event = this.event(
          id,
          "sage",
          "A recovery plan is ready for review",
          draft.summary,
          {
            type: "plan",
            memoryIds: plan.memoryIds,
            traces: draft.traces,
            simulated: draft.simulated,
          },
        );
        edges.push(
          ...plan.memoryIds.map((memoryId: string) => ({
            from: task.id,
            to: memoryId,
            relation: "USES",
          })),
          ...draft.decisionIds.map((decisionId: string) => ({
            from: task.id,
            to: decisionId,
            relation: "BASED_ON",
          })),
        );
      } else if (task.stage === 2) {
        const fact = incident.plan
          ? await this.store.get(tenant, incident.plan.factId)
          : undefined;
        if (
          !incident.plan ||
          !fact ||
          fact.status !== "active" ||
          (fact.database && incident.plan.database !== fact.database) ||
          incident.plan.database !== incident.sandbox.database
        )
          throw new Error(
            "The database changed. Refresh the shared fact and rebuild the recovery plan.",
          );
        patch = {
          ...patch,
          sandbox: {
            ...incident.sandbox,
            pool: incident.plan.targetPool,
            healthy: true,
          },
          errorRate: 0.3,
          latency: 186,
          appliedAt: Date.now(),
        };
        const applied =
          incident.plan.action === "increase-pool"
            ? `Updated the simulated pool capacity from ${incident.sandbox.pool} to ${incident.plan.targetPool} on ${incident.plan.database}.`
            : `Applied "${incident.plan.action}" to ${incident.plan.target ?? incident.plan.database} in the sandbox: ${(incident.plan.steps ?? []).join("; ")}.`;
        event = this.event(
          id,
          "sage",
          "Recovery applied · handed off to Echo",
          `${applied} The action and checkpoint were saved together. Echo can now verify the outcome.`,
          { type: "handoff", memoryIds: incident.plan.memoryIds },
        );
      } else {
        const healthy =
          incident.sandbox.healthy &&
          incident.errorRate < 1 &&
          incident.latency < 500;
        if (!healthy)
          throw new Error(
            "The simulated health checks failed. The incident remains unresolved.",
          );
        patch = { ...patch, status: "resolved", resolvedAt: Date.now() };
        const rootCauseId =
          incident.investigation?.rootCauseServiceId ?? incident.serviceId;
        const procedure = incident.plan
          ? await this.store.get(tenant, incident.plan.procedureId)
          : undefined;
        const learned = entity(`${id}:memory:outcome`, "memory", {
          category: "episodic",
          status: "active",
          title: `${procedure?.title ?? "Recovery"} verified on ${incident.plan?.target ?? incident.sandbox.database}`,
          content: `${incident.number}: ${incident.investigation?.rootCauseService ?? incident.service} was the root cause. Applying ${procedure?.id ?? "the plan"} (${incident.plan?.action ?? "recovery"}) reduced simulated errors from 12.8% to 0.3% and p95 latency from 2,840 ms to 186 ms.`,
          source: `${incident.number} · Echo verification`,
          serviceId: rootCauseId,
          agent: "echo",
          confidence: 1,
          incidentId: id,
          action: undefined,
        });
        nodes.push(learned);
        edges.push(
          { from: rootCauseId, to: learned.id, relation: "HAS_MEMORY" },
          { from: learned.id, to: id, relation: "LEARNED_FROM" },
        );
        if (procedure && procedure.status === "active")
          nodes.push(
            nextVersion(procedure, {
              verifiedRuns: (procedure.verifiedRuns ?? 0) + 1,
              lastVerifiedAt: Date.now(),
            }),
          );
        event = this.event(
          id,
          "echo",
          "Recovery verified. A new memory was saved.",
          "The simulated service is healthy: error rate 0.3%, p95 latency 186 ms. I saved the outcome and updated the procedure’s verification history for the next incident.",
          {
            type: "resolved",
            memoryIds: [learned.id],
            evidence: [
              "http.error_rate = 0.3%",
              "p95.latency = 186 ms",
              "health_check = passed",
            ],
          },
        );
      }
      nodes.push(
        nextVersion(incident, patch),
        nextVersion(task, {
          status: "done",
          completedAt: Date.now(),
          leaseUntil: 0,
        }),
        event,
      );
      edges.push({ from: id, to: event.id, relation: "HAS_EVENT" });
      if (patch.stage < 4) {
        const next = this.task(id, patch.stage);
        const existing = await this.store.get(tenant, next.id);
        if (existing) next.version = existing.version + 1;
        nodes.push(next);
        edges.push(
          { from: id, to: next.id, relation: "HAS_TASK" },
          { from: task.id, to: next.id, relation: "HANDS_OFF_TO" },
        );
      }
      // Guard the incident, the task, and every memory this stage relied on.
      const used = new Set<string>([
        ...(patch.plan?.memoryIds ?? []),
        ...(incident.plan?.memoryIds ?? []),
        ...(patch.investigation?.rootCauseMemoryIds ?? []),
      ]);
      const guards = [
        { id, version: incident.version },
        { id: task.id, version: task.version },
        ...memory
          .filter((m) => used.has(m.id))
          .map((m) => ({ id: m.id, version: m.version })),
      ];
      const committed = await this.store.commit(tenant, nodes, edges, guards);
      if (!committed) await this.release(tenant, task);
      return committed;
    } catch (err) {
      const current = await this.store.get(tenant, id);
      if (current && ["investigating", "resolving"].includes(current.status)) {
        const message =
          err instanceof Error ? err.message : "Agent execution failed";
        const event = this.event(
          id,
          task.agent,
          "Agent needs attention",
          message,
          { type: "error" },
        );
        await this.store.commit(
          tenant,
          [nextVersion(current, { status: "error", error: message }), event],
          [{ from: id, to: event.id, relation: "HAS_EVENT" }],
          [{ id, version: current.version }],
        );
      }
      await this.release(tenant, task);
      return false;
    }
  }
  private async release(tenant: string, task: Entity) {
    await this.store.commit(
      tenant,
      [nextVersion(task, { status: "ready", leaseUntil: 0 })],
      [],
      [{ id: task.id, version: task.version }],
    );
  }
  async migrate(tenant: string, id: string) {
    const incident = await this.store.get(tenant, id);
    if (!incident || incident.kind !== "incident")
      throw new MissingError("Incident not found");
    if (
      !["open", "awaiting_approval", "paused", "error"].includes(
        incident.status,
      )
    )
      throw new ConflictError(
        "Pause the investigation before introducing new evidence.",
      );
    const old =
      (incident.plan?.factId
        ? await this.store.get(tenant, incident.plan.factId)
        : undefined) ?? (await this.databaseFact(tenant, incident.serviceId));
    if (!old || old.status !== "active" || !old.database)
      throw new MissingError("No current database fact found");
    const database = `${old.database.replace(/-v\d+$/, "")}-v${old.version + 1}`;
    const fresh = entity(`mem-${randomUUID()}`, "memory", {
      category: "semantic",
      status: "active",
      title: `${incident.service} now connects to ${database}`,
      content: `Deployment evidence confirms the database migrated from ${old.database} to ${database}. Previous plans must be reviewed against this endpoint.`,
      source: "Simulated deployment manifest · operator confirmed",
      serviceId: old.serviceId ?? incident.serviceId,
      agent: "atlas",
      database,
      poolLimit: 20,
      signal: old.signal,
      supersedes: old.id,
      confidence: 1,
    });
    fresh.version = old.version + 1;
    const stale = nextVersion(old, {
      status: "superseded",
      supersededBy: fresh.id,
    });
    const event = this.event(
      id,
      "atlas",
      "New evidence superseded an outdated memory",
      `The database moved from ${old.database} to ${database}. The original fact is preserved. The pending plan has been invalidated, and Sage will build a fresh plan using the current fact.`,
      { type: "correction", memoryIds: [old.id, fresh.id] },
    );
    const task = this.task(id, 1);
    const priorTask = await this.store.get(tenant, task.id);
    if (priorTask) task.version = priorTask.version + 1;
    const updated = nextVersion(incident, {
      status: "paused",
      previousStatus: "investigating",
      stage: 1,
      plan: null,
      error: undefined,
      sandbox: { ...incident.sandbox, database },
      correctedAt: Date.now(),
    });
    const guards = [
      { id, version: incident.version },
      { id: old.id, version: old.version },
    ];
    if (priorTask) guards.push({ id: task.id, version: priorTask.version });
    if (
      !(await this.store.commit(
        tenant,
        [updated, stale, fresh, event, task],
        [
          { from: fresh.serviceId, to: fresh.id, relation: "HAS_MEMORY" },
          { from: fresh.id, to: old.id, relation: "SUPERSEDES" },
          { from: id, to: event.id, relation: "HAS_EVENT" },
          { from: id, to: task.id, relation: "HAS_TASK" },
        ],
        guards,
      ))
    )
      throw new ConflictError("Memory changed during the update. Try again.");
    return fresh;
  }
  async message(tenant: string, id: string, text: string) {
    const incident = await this.store.get(tenant, id);
    if (!incident || incident.kind !== "incident")
      throw new MissingError("Incident not found");
    const memory = await this.store.context(tenant, id);
    const user = entity(`msg-${randomUUID()}`, "message", {
      incidentId: id,
      role: "user",
      content: text,
    });
    const matching = memory
      .filter((m) =>
        `${m.title} ${m.content}`
          .toLowerCase()
          .split(/\W+/)
          .some(
            (word: string) =>
              word.length > 4 && text.toLowerCase().includes(word),
          ),
      )
      .slice(0, 3);
    const selected = matching.length ? matching : memory.slice(0, 3);
    const conversation: ConversationTurn[] = (await this.store.all(tenant))
      .filter(
        (n) =>
          n.kind === "message" &&
          n.incidentId === id &&
          ["user", "assistant"].includes(n.role),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-12)
      .map((n) => ({
        role: n.role,
        content: String(n.content).slice(0, 2000),
      }));
    const fallback = `The incident is ${incident.status.replaceAll("_", " ")}. ${selected.map((m) => m.content).join(" ")}${incident.status === "awaiting_approval" ? " The recovery plan is waiting for your approval." : ""}`;
    const result = await answer(
      this.reasoning,
      this.graph,
      tenant,
      incident,
      text,
      conversation,
      fallback,
    );
    const reply = entity(`msg-${randomUUID()}`, "message", {
      incidentId: id,
      role: "assistant",
      content: result.text,
      memoryIds: result.traces.length
        ? [...new Set(result.traces.flatMap((t) => t.nodeIds))]
            .filter((n) => n.startsWith("mem-"))
            .slice(0, 6)
        : selected.map((m) => m.id),
      traces: result.traces,
      agent: "atlas",
    });
    await this.store.commit(
      tenant,
      [user, reply],
      [
        { from: id, to: user.id, relation: "HAS_MESSAGE" },
        { from: id, to: reply.id, relation: "HAS_MESSAGE" },
      ],
    );
    return reply;
  }
}
