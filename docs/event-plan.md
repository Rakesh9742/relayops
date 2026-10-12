# Graph Hacks build plan (Oct 15–18, 2026)

Everything below is **not yet implemented** and must be written during the
event window. The pre-event scaffold (commits before Oct 15) provides the
store-agnostic `GraphTools` contract in `server/graph.ts`, an in-memory
reference implementation, the agent tool loop, the UI, and the tests. The
event work is the FalkorDB adapter that fulfils that contract natively, plus
deployment and submission material.

Running container on this Mac: `blast-radius-falkordb` on `127.0.0.1:6379`
(browser UI on :3000). The repo's `compose.yaml` uses 6387; either is fine.

## Day 1 (Oct 15): FalkorDB schema and `FalkorGraph`

Target: `MEMORY_BACKEND=falkordb npm test` with `TEST_FALKORDB=1` green.

### Schema (one graph per tenant: `relayops_<tenant>`)

Replace the single `:Entity`/`:LINK` model. Labels follow `NodeKind`;
relationship types follow `Relation` in `src/types.ts`.

```cypher
CREATE INDEX FOR (n:Service)  ON (n.id)
CREATE INDEX FOR (n:Incident) ON (n.id)
CREATE INDEX FOR (n:Memory)   ON (n.id)
CREATE INDEX FOR (n:Memory)   ON (n.status)
CREATE INDEX FOR (n:Person)   ON (n.id)
CREATE INDEX FOR (n:Team)     ON (n.id)
CREATE INDEX FOR (n:Decision) ON (n.id)
CREATE INDEX FOR (n:Task)     ON (n.id)
CREATE INDEX FOR (n:Event)    ON (n.id)
CREATE INDEX FOR (n:Message)  ON (n.id)
CREATE FULLTEXT INDEX FOR (n:Memory) ON (n.title, n.content)
```

Node properties: `id`, `version`, `createdAt`, `payload` (JSON of the full
entity for round-tripping) plus the queryable fields lifted out:
`name`, `status`, `category`, `serviceId`, `incidentId`, `signal`,
`signals` (array), `action`, `database`, `number`, `handle`, `forbids`.

Label from kind: `service→Service`, `incident→Incident`, `memory→Memory`,
`person→Person`, `team→Team`, `decision→Decision`, `task→Task`,
`event→Event`, `message→Message`.

### `commit` (one guarded query, unchanged contract)

```cypher
// guards
MATCH (g0 {id:$g0}) WHERE g0.version = $v0
...
WITH *
// nodes: label chosen server-side per node kind, not from params
MERGE (n0:Memory {id:$id0}) SET n0 += $props0
...
// edges: relationship type chosen server-side from a whitelist
WITH * MATCH (a0 {id:$from0}), (b0 {id:$to0}) MERGE (a0)-[:HAS_MEMORY]->(b0)
...
RETURN 1
```

Relationship type and label are interpolated only from the closed
`Relation`/`NodeKind` unions after validation; everything else is a param.

### `GraphTools` as Cypher

`suspects(serviceId, depth=2)`

```cypher
MATCH p = (s:Service {id:$id})-[:DEPENDS_ON|ROUTES_TO*1..2]->(u:Service)
WITH u, p, length(p) AS hops ORDER BY hops
WITH u, head(collect(p)) AS p, min(hops) AS hops
OPTIONAL MATCH (i:Incident)-[:ROOT_CAUSE]->(u)
OPTIONAL MATCH (u)-[:HAS_MEMORY]->(m:Memory {status:'active'})
RETURN u, hops, [r IN relationships(p) | {from:startNode(r).id, relation:type(r), to:endNode(r).id}] AS path,
       collect(DISTINCT i) AS rootCauseOf, collect(DISTINCT m) AS memories
UNION
// siblings sharing a direct dependency
MATCH (s:Service {id:$id})-[r1:DEPENDS_ON|ROUTES_TO]->(d:Service)<-[r2:DEPENDS_ON|ROUTES_TO]-(u:Service)
WHERE u.id <> $id
...
```

`blastRadius(serviceId, depth=3)`

```cypher
MATCH p = (u:Service)-[:DEPENDS_ON|ROUTES_TO*1..3]->(s:Service {id:$id})
WITH u, p ORDER BY length(p)
WITH u, head(collect(p)) AS p
RETURN u, length(p) AS hops, [r IN relationships(p) | {...}] AS path ORDER BY hops
```

`similarIncidents(serviceId)`

```cypher
MATCH (s:Service {id:$id})
OPTIONAL MATCH p = (s)-[:DEPENDS_ON|ROUTES_TO*1..2]->(scope:Service)
WITH collect(DISTINCT scope) + s AS services
UNWIND services AS svc
MATCH (i:Incident {status:'resolved'})-[rel:AFFECTS|ROOT_CAUSE]->(svc)
OPTIONAL MATCH (i)-[:ROOT_CAUSE]->(rc:Service)
OPTIONAL MATCH (who:Person)-[:RESOLVED]->(i)
OPTIONAL MATCH (m:Memory {status:'active'})-[:LEARNED_FROM]->(i)
RETURN DISTINCT i, rc, who, collect(DISTINCT m) AS learned, svc.id AS via
```

`whoKnows(serviceId)`

```cypher
MATCH (s:Service {id:$id})
OPTIONAL MATCH (p1:Person)-[:ON_CALL_FOR]->(s)
OPTIONAL MATCH (p2:Person)-[:MEMBER_OF]->(t:Team)-[:OWNS]->(s)
OPTIONAL MATCH (p3:Person)-[:RESOLVED]->(i:Incident)-[:AFFECTS|ROOT_CAUSE]->(s)
WITH collect({p:p1, why:'on call'}) + collect({p:p2, why:'member of ' + t.name}) + collect({p:p3, why:'resolved ' + i.number}) AS rows
UNWIND rows AS r WITH r WHERE r.p IS NOT NULL
RETURN r.p AS person, collect(r.why) AS reasons ORDER BY size(reasons) DESC
```

`decisions(serviceId)`

```cypher
MATCH (s:Service {id:$id})
OPTIONAL MATCH (s)-[:DEPENDS_ON|ROUTES_TO*1..2]->(dep:Service)
WITH collect(DISTINCT dep) + s AS scope
UNWIND scope AS svc
MATCH (d:Decision)-[:ABOUT]->(svc)
RETURN DISTINCT d, svc.id AS about
```

`path(from, to, max=4)`

```cypher
MATCH p = shortestPath((a {id:$from})-[*..4]->(b {id:$to}))
RETURN [r IN relationships(p) | {from:startNode(r).id, relation:type(r), to:endNode(r).id}] AS path
```

`memoriesFor(serviceId, category?)`

```cypher
MATCH (:Service {id:$id})-[:HAS_MEMORY]->(m:Memory {status:'active'})
WHERE $category IS NULL OR m.category = $category
RETURN m
```

`context(incidentId)` (existing Store method)

```cypher
MATCH (i:Incident {id:$id})-[:AFFECTS|ROOT_CAUSE]->(:Service)-[:DEPENDS_ON|ROUTES_TO*0..2]->(:Service)-[:HAS_MEMORY]->(m:Memory {status:'active'})
RETURN DISTINCT m
```

### Checklist

- [ ] `npm install falkordb`; pin version in package.json
- [ ] `FalkorStore` rewrite: labels, typed relationships, lifted properties, indexes on first connect
- [ ] `FalkorGraph implements GraphTools` in `server/graph.ts` (or `server/graph-falkor.ts`)
- [ ] `createStore()` returns both store and graph; `Engine` takes the graph
- [ ] Run `MEMORY_BACKEND=falkordb TEST_FALKORDB=1 npm test`; add a `graph.test.ts` variant that runs the same 8 assertions against FalkorDB
- [ ] `npm run benchmark` with `MEMORY_BACKEND=falkordb`; record numbers in `docs/verification.md`

## Day 2 (Oct 16): graph-native features the index cannot do

Pick two; each is a visible "only a graph does this" moment in the demo.

1. **Full-text memory search as a tool.** `CALL db.idx.fulltext.queryNodes('Memory', $q)` behind a `search_memory` tool. Chat questions like "anything about index drops?" hit it.
2. **PageRank or betweenness over the topology** to rank "critical services"; show on the overview as "if this fails, most things fail." `CALL algo.pageRank('Service','DEPENDS_ON')`.
3. **Vector similarity on memory** (optional): embed `title+content` with the configured provider, `CREATE VECTOR INDEX FOR (m:Memory) ON (m.embedding)`; `similar_memories` tool.
4. **Live graph view from FalkorDB**: `/api/graph/snapshot` returns nodes/edges from a single `MATCH (a)-[r]->(b)` so the UI's graph is provably the database, not the SQLite snapshot.

## Day 3 (Oct 17): deploy and polish

- [ ] FalkorDB Cloud free tier (or Fly.io volume with `falkordb/falkordb`); set `FALKORDB_HOST/PORT/USERNAME/PASSWORD`
- [ ] App on Fly/Railway/Render with `HOST=0.0.0.0`, `DEMO_ACCESS_CODE`, `COOKIE_SECURE=true`, `OPENAI_API_KEY`
- [ ] `/api/health` reports `backend: falkordb`
- [ ] Settings page shows the FalkorDB graph name and node/edge counts from a live `MATCH (n) RETURN count(n)`
- [ ] Error paths: FalkorDB unreachable at startup stops the server with a clear message (already designed; verify)
- [ ] Mobile pass on the new graph view and trace list

## Day 4 (Oct 18): submission

- [ ] README rewrite: what it is, the three tracks it addresses, architecture diagram (text is fine), honest limits
- [ ] 3-minute video. Script:
  1. (0:00) "Agents only know what they can reach. RelayOps puts the whole incident context in a FalkorDB graph." Show the graph view: 50 nodes, people, services, incidents, memory, decisions.
  2. (0:30) Start the **Hidden neighbour** scenario. Atlas calls `suspects`; expand the trace: the nearest service (orders-db) explains one signal, the worker two hops away explains both. Atlas picks the worker. Show the highlighted path on the graph.
  3. (1:15) Sage calls `decisions`, finds the rejected restart, proposes RB-11. Approve. Echo verifies and writes an episodic memory onto the worker node; RB-11's `verifiedRuns` increments.
  4. (1:50) Chat: "Who should I page and what else breaks if orders-db goes down?" Show the `who_knows` and `blast_radius` traces.
  5. (2:15) Memory correction: introduce migration evidence, show SUPERSEDES edge, plan invalidated, resume, rebuilt.
  6. (2:40) Switch to Orbit Financial: separate FalkorDB graph, nothing leaks. Show `relayops_acme` and `relayops_orbit` in FalkorDB Browser.
  7. (2:55) "Every answer carries its path. Every decision is on the graph."
- [ ] Blog post (side prize): "Why our incident agents stopped guessing: putting signals, people, and decisions on one graph." Use the worker-vs-db example as the hook.
- [ ] Submit to all three tracks with a sentence each:
  - Track 1: agents choose actions from graph tool results (suspects, blast radius, decisions)
  - Track 2: episodic/semantic/procedural memory, leases, handoffs, supersession, per-tenant graphs
  - Track 3: people, teams, ownership, on-call, decisions with rationale, traceable to incidents

## Honesty notes for the README

- Recovery actions are simulated state changes, not infrastructure changes.
- With no API key the agents follow a deterministic scoring policy over the same tool results; with a key, the model chooses which tools to call and interprets results. Both paths record identical trace structures.
- The pre-event scaffold is disclosed in the commit history; the FalkorDB implementation and everything in this plan is event-window work.
