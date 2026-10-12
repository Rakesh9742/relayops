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

const DAY = 86400000;

/**
 * Workspace vocabulary. Both sample tenants share one topology shape so the
 * same agent workflow runs in each, but names, people, and history differ.
 */
interface Vocabulary {
  primary: string; // the customer-facing API the demo incident targets
  primaryDb: string;
  gateway: string;
  web: string;
  cache: string;
  catalog: string;
  catalogDb: string;
  money: string;
  moneyDb: string;
  risk: string;
  search: string;
  searchIndex: string;
  worker: string;
  external: string;
  teams: { commerce: string; platform: string; money: string; data: string };
  people: Record<
    | "lead"
    | "backend"
    | "sre"
    | "dba"
    | "moneyLead"
    | "riskEng"
    | "dataEng"
    | "newHire",
    { name: string; handle: string }
  >;
}

const ACME: Vocabulary = {
  primary: "checkout-api",
  primaryDb: "orders-db",
  gateway: "api-gateway",
  web: "storefront-web",
  cache: "session-cache",
  catalog: "inventory-api",
  catalogDb: "inventory-db",
  money: "payments-api",
  moneyDb: "payments-db",
  risk: "fraud-service",
  search: "search-api",
  searchIndex: "search-index",
  worker: "notification-worker",
  external: "email-provider",
  teams: {
    commerce: "Commerce",
    platform: "Platform",
    money: "Payments",
    data: "Data",
  },
  people: {
    lead: { name: "Priya Natarajan", handle: "priya" },
    backend: { name: "Marcus Lee", handle: "marcus" },
    sre: { name: "Dana Okafor", handle: "dana" },
    dba: { name: "Tomas Vieira", handle: "tomas" },
    moneyLead: { name: "Hana Sato", handle: "hana" },
    riskEng: { name: "Ibrahim Khan", handle: "ibrahim" },
    dataEng: { name: "Lena Fischer", handle: "lena" },
    newHire: { name: "Sam Reyes", handle: "sam" },
  },
};

const ORBIT: Vocabulary = {
  primary: "payments-api",
  primaryDb: "ledger-db",
  gateway: "api-gateway",
  web: "banking-web",
  cache: "session-cache",
  catalog: "accounts-api",
  catalogDb: "accounts-db",
  money: "transfers-api",
  moneyDb: "transfers-db",
  risk: "aml-screening",
  search: "statements-api",
  searchIndex: "statements-index",
  worker: "settlement-worker",
  external: "clearing-house",
  teams: {
    commerce: "Payments",
    platform: "Platform",
    money: "Transfers",
    data: "Risk",
  },
  people: {
    lead: { name: "Aisha Rahman", handle: "aisha" },
    backend: { name: "Jonas Berg", handle: "jonas" },
    sre: { name: "Mei Chen", handle: "mei" },
    dba: { name: "Rafael Costa", handle: "rafael" },
    moneyLead: { name: "Olivia Grant", handle: "olivia" },
    riskEng: { name: "Kwame Mensah", handle: "kwame" },
    dataEng: { name: "Yuki Tanaka", handle: "yuki" },
    newHire: { name: "Noor Haddad", handle: "noor" },
  },
};

export function buildWorkspaceGraph(workspaceId: string, now = Date.now()) {
  const v = workspaceId === "orbit" ? ORBIT : ACME;
  const nodes: Entity[] = [];
  const edges: Edge[] = [];
  const add = (
    id: string,
    kind: Entity["kind"],
    data: Record<string, any>,
    age = 0,
  ) => {
    const n = entity(id, kind, data, now - age);
    nodes.push(n);
    return n;
  };
  const link = (from: string, relation: Edge["relation"], to: string) =>
    edges.push({ from, to, relation });

  // ── Services ─────────────────────────────────────────────────────────
  const svc = (
    id: string,
    name: string,
    type: string,
    extra: Record<string, any> = {},
  ) =>
    add(
      id,
      "service",
      { name, type, environment: "production", ...extra },
      30 * DAY,
    );
  svc("service-web", v.web, "frontend", { tier: "edge" });
  svc("service-gateway", v.gateway, "gateway", { tier: "edge" });
  svc("service-checkout", v.primary, "api", { tier: "core", slo: "99.95%" });
  svc("service-db", v.primaryDb, "database", {
    tier: "core",
    engine: "postgres",
    region: "us-east-1",
  });
  svc("service-cache", v.cache, "cache", { engine: "redis" });
  svc("service-catalog", v.catalog, "api", { tier: "core" });
  svc("service-catalog-db", v.catalogDb, "database", { engine: "postgres" });
  svc("service-money", v.money, "api", { tier: "core", slo: "99.99%" });
  svc("service-money-db", v.moneyDb, "database", { engine: "postgres" });
  svc("service-risk", v.risk, "api", { tier: "supporting" });
  svc("service-search", v.search, "api", { tier: "supporting" });
  svc("service-search-index", v.searchIndex, "index", { engine: "opensearch" });
  svc("service-worker", v.worker, "worker", { tier: "supporting" });
  svc("service-external", v.external, "external", { vendor: true });

  // Topology: who calls whom
  link("service-web", "DEPENDS_ON", "service-gateway");
  link("service-gateway", "ROUTES_TO", "service-checkout");
  link("service-gateway", "ROUTES_TO", "service-catalog");
  link("service-gateway", "ROUTES_TO", "service-search");
  link("service-gateway", "ROUTES_TO", "service-money");
  link("service-checkout", "DEPENDS_ON", "service-db");
  link("service-checkout", "DEPENDS_ON", "service-cache");
  link("service-checkout", "DEPENDS_ON", "service-catalog");
  link("service-checkout", "DEPENDS_ON", "service-money");
  link("service-catalog", "DEPENDS_ON", "service-catalog-db");
  link("service-catalog", "DEPENDS_ON", "service-cache");
  link("service-money", "DEPENDS_ON", "service-money-db");
  link("service-money", "DEPENDS_ON", "service-risk");
  link("service-search", "DEPENDS_ON", "service-search-index");
  link("service-worker", "DEPENDS_ON", "service-db");
  link("service-worker", "DEPENDS_ON", "service-external");

  // ── Teams and people ─────────────────────────────────────────────────
  const team = (id: string, name: string, focus: string) =>
    add(id, "team", { name, focus }, 60 * DAY);
  team("team-commerce", v.teams.commerce, "Customer-facing order flow");
  team("team-platform", v.teams.platform, "Gateway, cache, and reliability");
  team("team-money", v.teams.money, "Money movement and risk");
  team("team-data", v.teams.data, "Search, indexing, and analytics");
  link("team-commerce", "OWNS", "service-checkout");
  link("team-commerce", "OWNS", "service-db");
  link("team-commerce", "OWNS", "service-catalog");
  link("team-commerce", "OWNS", "service-catalog-db");
  link("team-commerce", "OWNS", "service-worker");
  link("team-platform", "OWNS", "service-gateway");
  link("team-platform", "OWNS", "service-cache");
  link("team-platform", "OWNS", "service-web");
  link("team-money", "OWNS", "service-money");
  link("team-money", "OWNS", "service-money-db");
  link("team-money", "OWNS", "service-risk");
  link("team-data", "OWNS", "service-search");
  link("team-data", "OWNS", "service-search-index");

  const person = (
    key: keyof Vocabulary["people"],
    role: string,
    teamId: string,
    skills: string[],
  ) => {
    const p = v.people[key];
    const id = `person-${p.handle}`;
    add(
      id,
      "person",
      { name: p.name, handle: p.handle, role, skills },
      60 * DAY,
    );
    link(id, "MEMBER_OF", teamId);
    return id;
  };
  const lead = person("lead", "Engineering lead", "team-commerce", [
    "postgres",
    "connection pooling",
    "incident command",
  ]);
  const backend = person(
    "backend",
    "Senior backend engineer",
    "team-commerce",
    ["query tuning", "indexes"],
  );
  const sre = person("sre", "Site reliability engineer", "team-platform", [
    "redis",
    "capacity",
    "observability",
  ]);
  const dba = person("dba", "Database engineer", "team-commerce", [
    "postgres",
    "migrations",
    "replication",
  ]);
  const moneyLead = person("moneyLead", "Payments lead", "team-money", [
    "idempotency",
    "retries",
  ]);
  const riskEng = person("riskEng", "Risk engineer", "team-money", [
    "model serving",
    "latency",
  ]);
  const dataEng = person("dataEng", "Search engineer", "team-data", [
    "opensearch",
    "reindexing",
  ]);
  const newHire = person("newHire", "Backend engineer", "team-commerce", [
    "node",
    "typescript",
  ]);
  link(lead, "ON_CALL_FOR", "service-checkout");
  link(dba, "ON_CALL_FOR", "service-db");
  link(sre, "ON_CALL_FOR", "service-cache");
  link(sre, "ON_CALL_FOR", "service-gateway");
  link(moneyLead, "ON_CALL_FOR", "service-money");
  link(dataEng, "ON_CALL_FOR", "service-search");
  link(newHire, "ON_CALL_FOR", "service-worker");

  // ── Past incidents ───────────────────────────────────────────────────
  const incident = (
    id: string,
    number: string,
    title: string,
    affects: string,
    rootCause: string,
    resolver: string,
    age: number,
    extra: Record<string, any> = {},
  ) => {
    const service = nodes.find((n) => n.id === affects)!;
    add(
      id,
      "incident",
      {
        number,
        title,
        description: extra.description ?? "Previous simulated incident.",
        severity: extra.severity ?? "P2",
        status: "resolved",
        serviceId: affects,
        service: service.name,
        scenario: extra.scenario ?? "history",
        stage: 4,
        resolvedAt: now - age + (extra.duration ?? 45 * 60000),
        environment: "simulation",
        errorRate: 0.2,
        latency: 180,
        memoryReused: 0,
        ...extra,
      },
      age,
    );
    link(id, "AFFECTS", affects);
    link(id, "ROOT_CAUSE", rootCause);
    link(resolver, "RESOLVED", id);
  };
  incident(
    "inc-history",
    "INC-1038",
    workspaceId === "orbit"
      ? "Payment requests timing out"
      : "Connection pool exhausted during flash sale",
    "service-checkout",
    "service-db",
    lead,
    2 * DAY,
    {
      description:
        "Pool saturated under load. A restart cleared symptoms for four minutes before the pool filled again. Raising the pool limit resolved the incident.",
      severity: "P1",
      scenario: "pool",
      duration: 13 * 60000,
      errorRate: 0.3,
      latency: 186,
    },
  );
  incident(
    "inc-0975",
    "INC-0975",
    `${v.worker} backlog starved ${v.primaryDb} connections`,
    "service-checkout",
    "service-worker",
    dba,
    19 * DAY,
    {
      description: `${v.primary} errors looked like database saturation. The real cause was ${v.worker} retrying a stuck batch and holding ${v.primaryDb} connections open.`,
      severity: "P1",
      duration: 82 * 60000,
    },
  );
  incident(
    "inc-1021",
    "INC-1021",
    `${v.catalogDb} slow queries after index drop`,
    "service-catalog",
    "service-catalog-db",
    backend,
    11 * DAY,
    {
      description: `A migration dropped a composite index. ${v.catalog} p95 latency rose from 40 ms to 3 s, which cascaded into ${v.primary} timeouts.`,
      severity: "P2",
      duration: 37 * 60000,
    },
  );
  incident(
    "inc-1007",
    "INC-1007",
    `${v.cache} eviction storm`,
    "service-cache",
    "service-cache",
    sre,
    15 * DAY,
    {
      description: `Memory limit hit; ${v.cache} evicted active sessions. Checkout and catalog both saw elevated cache misses.`,
      severity: "P2",
      duration: 22 * 60000,
    },
  );
  incident(
    "inc-0992",
    "INC-0992",
    `${v.money} timeouts caused by ${v.risk} latency`,
    "service-money",
    "service-risk",
    riskEng,
    24 * DAY,
    {
      description: `A model deploy doubled ${v.risk} scoring latency. ${v.money} calls exceeded their 800 ms budget and ${v.primary} returned payment failures.`,
      severity: "P1",
      duration: 51 * 60000,
    },
  );
  incident(
    "inc-0960",
    "INC-0960",
    `${v.searchIndex} reindex saturated cluster`,
    "service-search",
    "service-search-index",
    dataEng,
    28 * DAY,
    {
      description: `A full reindex ran during peak hours. ${v.search} returned partial results; no impact on ${v.primary}.`,
      severity: "P3",
      duration: 60 * 60000,
    },
  );
  link("inc-0975", "SIMILAR_TO", "inc-history");

  // ── Memory ───────────────────────────────────────────────────────────
  const memory = (
    id: string,
    serviceId: string,
    category: "episodic" | "semantic" | "procedural",
    title: string,
    content: string,
    source: string,
    agent: string,
    age: number,
    extra: Record<string, any> = {},
    learnedFrom?: string,
  ) => {
    add(
      id,
      "memory",
      {
        category,
        title,
        content,
        status: "active",
        source,
        serviceId,
        agent,
        confidence: 1,
        ...extra,
      },
      age,
    );
    link(serviceId, "HAS_MEMORY", id);
    if (learnedFrom) link(id, "LEARNED_FROM", learnedFrom);
  };
  memory(
    "mem-topology",
    "service-db",
    "semantic",
    `${v.primary} connects to ${v.primaryDb}`,
    `The ${v.primary} service uses ${v.primaryDb} in us-east-1. Connection pool capacity is 20.`,
    "Service catalog · revision 12",
    "atlas",
    3 * DAY,
    { database: v.primaryDb, poolLimit: 20, signal: "pool.active" },
  );
  memory(
    "mem-past",
    "service-checkout",
    "episodic",
    "A restart did not resolve connection exhaustion",
    "During the previous incident, restarting the service briefly reduced errors, but the pool filled again. Increasing the pool limit resolved the failure.",
    "INC-1038 · verified outcome",
    "echo",
    2 * DAY,
    { failedAction: "restart" },
    "inc-history",
  );
  memory(
    "mem-playbook",
    "service-db",
    "procedural",
    "Recover an exhausted connection pool",
    "Confirm the current database. Inspect active connections. Increase the pool from 20 to 40 in the sandbox. Verify error rate and latency before recording a successful outcome.",
    "Runbook RB-07 · reviewed procedure",
    "sage",
    2 * DAY,
    {
      steps: [
        "Confirm the current database endpoint",
        "Inspect the connection pool",
        "Increase pool capacity to 40",
        "Verify error rate is below 1%",
      ],
      action: "increase-pool",
      targetPool: 40,
      verifiedRuns: 1,
    },
  );
  memory(
    "mem-owner",
    "service-checkout",
    "semantic",
    `${v.teams.commerce} team owns ${v.primary}`,
    `Escalate unresolved ${v.primary} incidents to the ${v.teams.commerce} team. Include the evidence and actions already attempted.`,
    "Ownership directory",
    "atlas",
    DAY,
  );
  memory(
    "mem-worker-pool",
    "service-worker",
    "episodic",
    `${v.worker} can starve ${v.primaryDb} connections`,
    `${v.worker} shares ${v.primaryDb} with ${v.primary}. A stuck retry loop held 14 connections for over an hour. Check worker queue depth before blaming ${v.primary}.`,
    "INC-0975 · verified outcome",
    "echo",
    19 * DAY,
    {
      signal: "worker.queue_depth",
      signals: ["worker.queue_depth", "pool.active"],
    },
    "inc-0975",
  );
  memory(
    "mem-worker-db",
    "service-worker",
    "semantic",
    `${v.worker} shares ${v.primaryDb} with ${v.primary}`,
    `${v.worker} writes to ${v.primaryDb} in us-east-1 using its own pool of 10 connections. Draining its queue frees ${v.primaryDb} connections for ${v.primary}.`,
    "Service catalog · revision 12",
    "atlas",
    18 * DAY,
    { database: v.primaryDb, poolLimit: 10 },
  );
  memory(
    "mem-worker-runbook",
    "service-worker",
    "procedural",
    `Drain a stuck ${v.worker} batch`,
    "Pause the worker. Move the poisoned batch to the dead-letter queue. Resume and confirm connection count drops.",
    "Runbook RB-11",
    "sage",
    18 * DAY,
    {
      steps: [
        "Pause the worker consumer",
        "Move the stuck batch to the dead-letter queue",
        "Resume the worker",
        "Verify database connections return to baseline",
      ],
      action: "drain-worker",
      verifiedRuns: 1,
    },
  );
  memory(
    "mem-catalog-index",
    "service-catalog-db",
    "semantic",
    `${v.catalogDb} requires the (sku, warehouse) composite index`,
    `Queries from ${v.catalog} rely on idx_stock_sku_warehouse. Dropping it raises p95 latency above 3 s within minutes.`,
    "INC-1021 postmortem",
    "atlas",
    11 * DAY,
    { index: "idx_stock_sku_warehouse" },
    "inc-1021",
  );
  memory(
    "mem-catalog-runbook",
    "service-catalog-db",
    "procedural",
    "Restore a dropped index concurrently",
    "Create the index CONCURRENTLY to avoid locking. Confirm the query planner uses it. Watch p95 latency return under 100 ms.",
    "Runbook RB-09",
    "sage",
    10 * DAY,
    {
      steps: [
        "Create the missing index CONCURRENTLY",
        "Verify the planner uses the new index",
        "Confirm p95 latency under 100 ms",
      ],
      action: "restore-index",
      verifiedRuns: 1,
    },
  );
  memory(
    "mem-cache-eviction",
    "service-cache",
    "episodic",
    `${v.cache} eviction storm symptoms`,
    `When ${v.cache} evicts sessions, ${v.primary} and ${v.catalog} both show cache-miss spikes and users are logged out. Errors do not appear in the database layer.`,
    "INC-1007 · verified outcome",
    "echo",
    15 * DAY,
    { signal: "cache.evicted_keys" },
    "inc-1007",
  );
  memory(
    "mem-cache-config",
    "service-cache",
    "semantic",
    `${v.cache} runs with 2 GB maxmemory`,
    `${v.cache} is a single Redis instance with maxmemory 2 GB and policy volatile-lru. Sessions for ${v.primary} and ${v.catalog} live here.`,
    "Service catalog · revision 12",
    "atlas",
    14 * DAY,
    { maxmemory: "2gb" },
  );
  memory(
    "mem-cache-runbook",
    "service-cache",
    "procedural",
    `Relieve ${v.cache} memory pressure`,
    "Raise maxmemory in the sandbox. Switch the eviction policy to allkeys-lru. Verify evicted_keys returns to zero.",
    "Runbook RB-05",
    "sage",
    14 * DAY,
    {
      steps: [
        "Raise maxmemory by 50%",
        "Set eviction policy to allkeys-lru",
        "Verify evicted_keys is zero for five minutes",
      ],
      action: "raise-maxmemory",
      verifiedRuns: 2,
    },
  );
  memory(
    "mem-risk-latency",
    "service-risk",
    "episodic",
    `${v.risk} latency propagates to ${v.primary} as payment failures`,
    `A ${v.risk} model deploy added 400 ms per score. ${v.money} timed out and ${v.primary} surfaced it as declined payments, not as its own errors.`,
    "INC-0992 · verified outcome",
    "echo",
    24 * DAY,
    {},
    "inc-0992",
  );
  memory(
    "mem-money-budget",
    "service-money",
    "semantic",
    `${v.money} has an 800 ms latency budget`,
    `${v.primary} aborts payment calls after 800 ms. Any upstream of ${v.money} that adds latency appears as checkout payment failures.`,
    "Service catalog · SLO sheet",
    "atlas",
    20 * DAY,
    { budgetMs: 800 },
  );
  memory(
    "mem-search-isolation",
    "service-search",
    "semantic",
    `${v.search} failures do not affect ${v.primary}`,
    `${v.search} is isolated from the order flow. Search incidents do not explain checkout errors.`,
    "INC-0960 postmortem",
    "atlas",
    28 * DAY,
    {},
    "inc-0960",
  );

  // ── Decisions ────────────────────────────────────────────────────────
  const decision = (
    id: string,
    title: string,
    rationale: string,
    about: string,
    by: string,
    basedOn: string[],
    age: number,
    extra: Record<string, any> = {},
  ) => {
    add(
      id,
      "decision",
      { title, rationale, status: "accepted", ...extra },
      age,
    );
    link(id, "ABOUT", about);
    link(id, "MADE_BY", by);
    for (const b of basedOn) link(id, "BASED_ON", b);
  };
  decision(
    "dec-12",
    `Keep ${v.primaryDb} pool at 20 per ${v.primary} replica`,
    "Twenty connections per replica keeps total connections under the database limit with four replicas. Raise only in the sandbox first, and never above 40.",
    "service-db",
    lead,
    ["inc-history"],
    2 * DAY,
    { constraint: { maxPool: 40 } },
  );
  decision(
    "dec-15",
    `${v.worker} must use its own connection pool`,
    `After INC-0975, the worker was given a separate pool so a stuck batch cannot starve ${v.primary}. If worker and API share a pool again, that is a regression.`,
    "service-worker",
    dba,
    ["inc-0975", "mem-worker-pool"],
    18 * DAY,
  );
  decision(
    "dec-18",
    `Rejected: automatic restart on pool exhaustion`,
    "Restarts hide the symptom for minutes and lose in-flight orders. Agents must not propose a restart as the primary recovery for pool exhaustion.",
    "service-checkout",
    lead,
    ["mem-past"],
    DAY,
    { status: "rejected", forbids: "restart" },
  );
  decision(
    "dec-20",
    `${v.risk} deploys require a latency canary`,
    `Any ${v.risk} release must prove p95 under 200 ms on 5% traffic before full rollout.`,
    "service-risk",
    moneyLead,
    ["inc-0992"],
    23 * DAY,
  );

  return { nodes, edges };
}

export async function seed(store: Store) {
  for (const workspace of WORKSPACES) {
    if (await store.get(workspace.id, "service-checkout")) continue;
    const { nodes, edges } = buildWorkspaceGraph(workspace.id);
    await store.commit(workspace.id, nodes, edges);
  }
}
