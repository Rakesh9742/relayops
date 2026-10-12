/**
 * Drive one scenario end to end against a running server and print what the
 * agents did. Usage:
 *   node --import tsx scripts/run-scenario.ts worker [http://127.0.0.1:5177] [--migrate]
 */
const scenario = process.argv[2] ?? "pool";
const base =
  process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:5177";
const migrate = process.argv.includes("--migrate");
const headers = { "Content-Type": "application/json", Origin: base };
let cookie = "";
const call = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}), cookie },
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const incidentFrom = async (id: string) => {
  const state = await call("/api/state");
  return {
    incident: state.nodes.find((n: any) => n.id === id),
    events: state.nodes
      .filter((n: any) => n.kind === "event" && n.incidentId === id)
      .sort((a: any, b: any) => a.createdAt - b.createdAt),
    nodes: state.nodes as any[],
    edges: state.edges as any[],
  };
};
const waitFor = async (id: string, statuses: string[], timeoutMs = 120000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { incident } = await incidentFrom(id);
    if (statuses.includes(incident.status)) return incident;
    if (incident.status === "error")
      throw new Error(`Incident errored: ${incident.error}`);
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for ${statuses.join("/")}`);
};

await call("/api/session", { method: "POST", body: "{}" });
const titles: Record<string, string> = {
  pool: "Checkout API is returning elevated errors",
  worker: "Checkout errors while a background queue grows",
  cache: "Customers are being logged out mid-checkout",
  migration: "Checkout failures after a database migration",
};
const created = await call("/api/incidents", {
  method: "POST",
  body: JSON.stringify({
    title: titles[scenario] ?? titles.pool,
    description: "",
    severity: "P1",
    scenario,
  }),
});
const id = created.id as string;
console.log(
  `\n== ${scenario} · ${created.number} · signals: ${created.signals.join(" | ")}`,
);
await call(`/api/incidents/${id}/action`, {
  method: "POST",
  body: JSON.stringify({ action: "start" }),
});
let incident = await waitFor(id, ["awaiting_approval"]);
console.log(
  `\nATLAS -> root cause ${incident.investigation.rootCauseService} (${incident.investigation.rootCauseServiceId})`,
);
console.log(`  ruled out: ${incident.investigation.ruledOut.join(", ")}`);
console.log(`  escalate:  ${incident.investigation.escalateTo ?? "-"}`);
console.log(
  `SAGE  -> ${incident.plan.procedureId} on ${incident.plan.target ?? incident.plan.database} (fact ${incident.plan.factId}) forbids ${JSON.stringify(incident.plan.forbidden)}`,
);
if (migrate) {
  const fresh = await call(`/api/incidents/${id}/action`, {
    method: "POST",
    body: JSON.stringify({ action: "migrate" }),
  });
  const after = (await incidentFrom(id)).incident;
  console.log(
    `MIGRATE -> plan=${after.plan} status=${after.status} sandbox.database=${after.sandbox.database}`,
  );
  try {
    await call(`/api/incidents/${id}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "approve" }),
    });
    console.log("  !! approve succeeded on an invalidated plan");
  } catch (e) {
    console.log(
      `  approve rejected: ${(e as Error).message.split('"error":')[1]}`,
    );
  }
  await call(`/api/incidents/${id}/action`, {
    method: "POST",
    body: JSON.stringify({ action: "resume" }),
  });
  incident = await waitFor(id, ["awaiting_approval"]);
  console.log(
    `SAGE (rebuilt) -> ${incident.plan.procedureId} on ${incident.plan.database} (fact ${incident.plan.factId})`,
  );
}
await call(`/api/incidents/${id}/action`, {
  method: "POST",
  body: JSON.stringify({ action: "approve" }),
});
incident = await waitFor(id, ["resolved"]);
const { events, nodes, edges } = await incidentFrom(id);
const learned = nodes.find((n) => n.id === `${id}:memory:outcome`);
const procedure = nodes.find((n) => n.id === incident.plan.procedureId);
console.log(
  `ECHO  -> resolved · learned "${learned?.title}" on ${learned?.serviceId} · ${procedure?.id} verifiedRuns=${procedure?.verifiedRuns}`,
);
console.log(
  `  ROOT_CAUSE edge: ${edges.some((e) => e.from === id && e.relation === "ROOT_CAUSE")}`,
);
console.log("\nTIMELINE");
for (const e of events) {
  if (!["atlas", "sage", "echo"].includes(e.agent)) continue;
  console.log(`- [${e.agent}] ${e.title}`);
  console.log(`  ${e.content}`);
  for (const t of e.traces ?? [])
    console.log(
      `    · ${t.tool}(${Object.values(t.args).join(", ")}) => ${t.summary}`,
    );
}

export {};
