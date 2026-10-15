# RelayOps

**Incident agents that work from a graph, not a guess.**

Three agents (Atlas investigates, Sage plans, Echo verifies) handle a
production incident by querying a FalkorDB graph of services, their
dependencies, the people who own and operate them, past incidents, what was
learned from each, and the engineering decisions already made. Every
conclusion carries the graph path that produced it. Every resolution writes
back into the graph so the next incident starts further ahead.

Built for [Graph Hacks: Context for AI Agents](https://www.wemakedevs.org/hackathons/falkordb)
(Oct 15–18, 2026). Tracks entered: **Agents That Act on Connected Data**,
**Agent Memory and Coordination**, **Company Brain**.

- Repository: https://github.com/Rakesh9742/relayops
- Live demo: _(add URL after deploy)_
- Video: _(add URL)_ · script in [`docs/video-script.md`](docs/video-script.md)

## Why a graph

The hard part of an incident is not the symptom, it is what the symptom is
connected to. "Checkout is returning errors and the database pool is full" has
at least two explanations: the database, or a background worker two hops away
that shares the database's connections. The nearer suspect is wrong. An agent
can only tell the difference if it can follow `checkout-api -DEPENDS_ON->
orders-db <-DEPENDS_ON- notification-worker -HAS_MEMORY-> "a stuck retry loop
held 14 connections"` and compare that memory's signals against what is live.

RelayOps puts all of that in FalkorDB and gives the agents seven read-only
graph tools. The model chooses which to call; the graph decides what is true.

## What the graph does

| Question | Tool | Traversal |
|---|---|---|
| What upstream could cause this? | `suspects` | `DEPENDS_ON\|ROUTES_TO*1..2` plus siblings sharing a dependency, each with `ROOT_CAUSE` history and active memory |
| What breaks if X fails? | `blast_radius` | reverse `DEPENDS_ON\|ROUTES_TO*1..3` |
| Has this happened before? Who fixed it? | `similar_incidents` | incidents on the service or its upstream, with `ROOT_CAUSE`, `RESOLVED`, `LEARNED_FROM` |
| What has engineering already decided? | `decisions` | `Decision -ABOUT-> Service` in scope, including rejections that forbid actions |
| Who should I page? | `who_knows` | `ON_CALL_FOR`, `MEMBER_OF -> OWNS`, `RESOLVED` |
| Anything in memory about *topic*? | `search_memory` | full-text index on `Memory.title, Memory.content` |
| How are these two things connected? | `path` | `shortestPath` |
| Which services matter most? | overview | `algo.betweenness` on the call graph |

The full Cypher for each is in [`docs/queries.md`](docs/queries.md).

The agents' writes are graph writes too: `(:Incident)-[:ROOT_CAUSE]->(:Service)`,
`(:Service)-[:HAS_MEMORY]->(:Memory)-[:LEARNED_FROM]->(:Incident)`,
`(:Memory)-[:SUPERSEDES]->(:Memory)`, `(:Task)-[:USES]->(:Memory)`,
`(:Task)-[:BASED_ON]->(:Decision)`, `(:Task)-[:HANDS_OFF_TO]->(:Task)`. All
multi-entity writes go through one guarded Cypher query so concurrent workers
cannot double-apply a recovery and a plan built on superseded memory cannot be
approved.

**There is no non-graph mode.** If FalkorDB is unreachable the server refuses
to start. The in-memory graph walk in `tests/doubles.ts` exists only to prove
the Cypher gives the same answers as a plain traversal.

## Graph data model

One graph per workspace: `relayops_acme`, `relayops_orbit`. Nothing crosses
graphs; a session is bound to one.

### Nodes

| Label | Key properties | Count (seed) |
|---|---|---|
| `Service` | `id, name, type (api/database/cache/gateway/worker/index/external), tier, environment` | 14 |
| `Team` | `id, name, focus` | 4 |
| `Person` | `id, name, handle, role, skills[]` | 8 |
| `Incident` | `id, number, title, severity, status, serviceId, scenario, signals[], metrics[], investigation{}, plan{}` | 6 history + live |
| `Memory` | `id, category (episodic/semantic/procedural), title, content, status (active/superseded), serviceId, signals[], database, action, steps[], verifiedRuns, metrics[]` | 15 |
| `Decision` | `id, title, rationale, status (accepted/rejected), forbids, constraint{}` | 4 |
| `Task` | `id, incidentId, stage, agent, status, leaseUntil, claim, version` | per incident |
| `Event` | `id, incidentId, agent, type, title, content, traces[]` | per incident |
| `Message` | `id, incidentId, role, content, traces[]` | per incident |

Every node also carries `version` (optimistic concurrency) and `payload`
(the full entity as JSON, so the UI gets exactly what the engine wrote).

### Relationships

```
(:Service)-[:DEPENDS_ON]->(:Service)      call graph
(:Service)-[:ROUTES_TO]->(:Service)       gateway fan-out
(:Team)-[:OWNS]->(:Service)
(:Person)-[:MEMBER_OF]->(:Team)
(:Person)-[:ON_CALL_FOR]->(:Service)
(:Person)-[:RESOLVED]->(:Incident)
(:Incident)-[:AFFECTS]->(:Service)        where the symptom appeared
(:Incident)-[:ROOT_CAUSE]->(:Service)     where the cause was (written by Atlas)
(:Incident)-[:SIMILAR_TO]->(:Incident)
(:Service)-[:HAS_MEMORY]->(:Memory)
(:Memory)-[:LEARNED_FROM]->(:Incident)
(:Memory)-[:SUPERSEDES]->(:Memory)        correction keeps history
(:Decision)-[:ABOUT]->(:Service)
(:Decision)-[:MADE_BY]->(:Person)
(:Decision)-[:BASED_ON]->(:Incident|:Memory)
(:Incident)-[:HAS_EVENT|HAS_TASK|HAS_MESSAGE]->(...)
(:Task)-[:HANDS_OFF_TO]->(:Task)
(:Task)-[:USES]->(:Memory)
(:Task)-[:BASED_ON]->(:Decision)
```

### Seed topology (per workspace)

```
storefront-web -> api-gateway -> checkout-api -> orders-db <- notification-worker -> email-provider
                             |              \-> session-cache
                             |              \-> inventory-api -> inventory-db, session-cache
                             |              \-> payments-api -> payments-db, fraud-service
                             \-> search-api -> search-index
```

Six resolved incidents give the graph history: pool exhaustion (orders-db),
worker starving the database (notification-worker), dropped index
(inventory-db), eviction storm (session-cache), fraud latency propagating to
checkout (fraud-service), and a reindex that affected only search. Four
decisions include one **rejected** ("automatic restart on pool exhaustion"),
which Sage reads and refuses to propose.

All data is synthetic. Companies, people, services, and incidents are invented.

## Run it

Requirements: Docker, Node.js 22.13+ (24 recommended).

```sh
git clone https://github.com/Rakesh9742/relayops.git && cd relayops
npm install
cp .env.example .env            # defaults point at the compose FalkorDB
docker compose up -d            # FalkorDB on 127.0.0.1:6387, browser UI on :3017
npm run build && npm start      # http://127.0.0.1:4177
```

Without an API key the agents run a deterministic policy over the same graph
tools, so every trace is still a real query. To let the model choose the
tools:

```dotenv
MODEL_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-mini
```

(or `MODEL_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`). Restart, then **Settings
→ Test AI connection**.

Development with hot reload: `npm run dev` (UI on :5177, API on :4177).

### Try it in three minutes

1. **Shared memory → Graph view.** Drag, zoom, hover. People left, services
   centre, memory and decisions right. This is the FalkorDB graph.
2. **New incident → Hidden neighbour → Start.** The panel switches to **Live
   graph**. Watch Atlas call `suspects`: orders-db explains one signal,
   notification-worker (two hops, sharing the database) explains two. Atlas
   picks the worker and names who to page.
3. Sage calls `decisions`, finds the rejected restart, proposes the worker
   drain runbook. The plan card says what it will not do. **Approve.**
4. Echo verifies: the signal strip turns green with real deltas, an episodic
   memory lands on the worker node, the runbook's verified count increments.
5. **Conversation:** "Who should I page and what else breaks if orders-db goes
   down?" The answer shows its `who_knows` and `blast_radius` queries.
6. **New incident → Memory correction.** At the approval step click
   **Introduce new evidence**. The fact is superseded (`SUPERSEDES` edge), the
   plan is invalidated, approve is refused, resume rebuilds it.
7. Switch to **Orbit Financial**: a different FalkorDB graph, different people,
   nothing from Acme.

Open the FalkorDB Browser (http://127.0.0.1:3017) and run
`MATCH (i:Incident)-[:ROOT_CAUSE]->(s) RETURN i.number, s.name` to see what the
agents wrote.

## Test

```sh
npm test                 # 30 unit tests on the in-memory double, no DB needed
npm run test:falkordb    # the same suite plus integration on a live FalkorDB (31 tests)
npm run test:browser     # Playwright end to end against a running server
npm run benchmark        # guarded-write throughput against FalkorDB
```

`tests/graph.test.ts` runs identical assertions against the in-memory walk and
against FalkorDB, so a Cypher regression fails the suite.

## Architecture

```
src/            React 19 + Vite UI. Force-directed graph (d3-force), live trace view, dark mode.
server/
  index.ts      boot: connect FalkorDB, seed, start worker loop
  app.ts        Express 5 routes, HMAC sessions, per-workspace scope, /api/graph/*
  engine.ts     persisted state machine: claims, 60 s leases, approval gate, supersession
  agents.ts     tool specs, tool runner with trace capture, Atlas/Sage/chat prompts, fallback policy
  model.ts      OpenAI Responses + Anthropic Messages tool loops (bounded, read-only)
  graph.ts      GraphTools interface
  falkor.ts     FalkorStore (guarded writes, indexes) + FalkorGraph (all Cypher)
  seed.ts       synthetic workspace graph
tests/doubles.ts  in-memory Store + GraphTools used only by tests
docs/queries.md   every query
docs/explainer.md how it works, for the author
```

Agent loop: the model receives the incident and the tool list; it calls graph
tools up to six rounds; every call is recorded as a trace with `nodeIds` and
`paths`; it must finish with a structured verdict (root cause, ruled out,
escalation; or procedure, fact, forbidden actions). The engine validates the
verdict against the graph (the root cause must be a `Service`, the procedure
must be active procedural memory, the fact must be active, nothing forbidden)
before writing. If the model answers in prose without a verdict, the
deterministic policy picks from the same tool results.

Recovery actions are simulated state changes in the sandbox, committed with the
task checkpoint. Nothing here touches real infrastructure.

## Build history and disclosure

- **Before Oct 15:** an incident-workspace scaffold (UI, Express server,
  agent state machine, tool interface, synthetic data) with a SQLite stand-in
  store. Commits `0e86a54` through `8701d7f` (Oct 12–13) are that work and are
  labelled as pre-event in their messages.
- **During the event (Oct 15 onward):** the FalkorDB implementation
  (`server/falkor.ts`: schema, indexes, guarded writes, every traversal,
  full-text search, betweenness), removal of all non-graph code paths,
  graph-native features in the UI, documentation, deployment. Commits from
  `7766c9e` onward.
- **AI assistance:** the code was written with Claude (via OpenCode) as a
  coding assistant. The graph model, the agent design, the choice of
  traversals, and every technical decision are the author's; the author can
  explain all of it (see `docs/explainer.md`).
- **Data:** entirely synthetic.

## Limits

Single-process worker loop; sample workspaces only; demo access code instead
of real identity; simulated recovery effects; 60 s leases are a demo constant.
Pagination, retention, and per-user membership are future work.
