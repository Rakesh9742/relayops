# How RelayOps works, in your own words

Read this before the demo or any judge Q&A. Each section is a question you
may be asked, the honest answer, and where to point in the code.

## "Why a graph? Why not Postgres with a few joins?"

Because the questions the agents ask are about *reach*, not rows. "What could
cause errors in checkout?" is "everything checkout depends on, up to two hops,
plus anything sharing a dependency with it". "What breaks if orders-db dies?"
is the reverse walk. "Who should I page?" is three different relationship
patterns unioned. In SQL each is a recursive CTE per question; in Cypher each
is one pattern, and the path comes back for free so the UI can show *why*.

The deciding example: the **Hidden neighbour** scenario. `checkout-api` shows
pool saturation and a growing worker queue. The nearest suspect (`orders-db`,
one hop) explains pool saturation. `notification-worker` is not on checkout's
call path at all; it shares `orders-db`. Only a sibling traversal
(`(checkout)-[:DEPENDS_ON]->(db)<-[:DEPENDS_ON]-(worker)`) finds it, and only
its memory's `signals: [worker.queue_depth, pool.active]` explains both live
signals. Point: `server/falkor.ts` → `suspects`, second query.

## "What does FalkorDB actually do here? Could you swap it out?"

No. `server/store.ts#createBackend` only knows FalkorDB; if it is unreachable
the server exits. Every read the agents do is a Cypher traversal in
`server/falkor.ts`. Every write is a guarded Cypher `MERGE`. The UI's graph
view is `MATCH (a)-[e]->(b)`. Full-text search is FalkorDB's index.
"Critical services" is `algo.betweenness` run in the database.

The in-memory `IndexedGraph` in `tests/doubles.ts` is a test oracle: the same
eight assertions run against it and against FalkorDB so I know the Cypher is
right. It is not reachable from the product.

## "Walk me through the data model."

One graph per workspace (`relayops_acme`, `relayops_orbit`): tenant isolation
by construction, not by a `WHERE tenant =`.

Labels are the kinds of things: `Service`, `Team`, `Person`, `Incident`,
`Memory`, `Decision`, plus workflow nodes `Task`, `Event`, `Message`.
Relationship types are the vocabulary in `src/types.ts#Relation`: structural
(`DEPENDS_ON`, `ROUTES_TO`), people (`OWNS`, `MEMBER_OF`, `ON_CALL_FOR`,
`RESOLVED`), incident (`AFFECTS`, `ROOT_CAUSE`), memory (`HAS_MEMORY`,
`LEARNED_FROM`, `SUPERSEDES`), decisions (`ABOUT`, `MADE_BY`, `BASED_ON`).

Two incident edges matter: `AFFECTS` is where the symptom appeared;
`ROOT_CAUSE` is where the cause was. The seed has incidents where they differ
(`INC-0975`: affects checkout, root cause worker). That gap is what the agents
learn from.

Memory has three categories (`episodic`: what happened; `semantic`: facts;
`procedural`: runbooks). Memory nodes carry `signals[]`: the monitoring
signals that pointed at this cause. That is how the agents match live
evidence to history.

Every node has `version` for optimistic concurrency and `payload` (the full
JSON) so the UI gets exactly what the engine wrote; the lifted properties
(`status`, `category`, `signals`, `database`...) exist so Cypher can filter.

## "How do the agents use it?"

`server/agents.ts`. Seven read-only tools, each a Cypher query:
`suspects`, `similar_incidents`, `blast_radius`, `decisions`, `who_knows`,
`memories`, `search_memory`, plus `path`. The model (OpenAI Responses or
Anthropic Messages, `server/model.ts#runTools`) sees the incident and the
tool list, calls tools for up to six rounds, and must end with a structured
`finish` verdict.

Atlas's rule: pick the suspect with the highest **fit** = live diagnostic
signals its memory explains, minus signals its memory predicts but which are
absent. Symptom signals on the affected service (error rate, latency) never
discriminate. The tool result includes `fit` and `contradictingAbsence` so the
model does not have to compute it.

Sage's rule: procedural memory on the root cause, semantic fact on the root
cause (fallback: affected service), decisions in scope. A `rejected` decision
with `forbids` removes that action.

Echo: checks the sandbox health gate, writes an episodic memory on the **root
cause** service with the real metric deltas and the diagnostic signals, bumps
the procedure's `verifiedRuns`.

Every tool call is a `ToolTrace` (`tool, args, summary, nodeIds, paths`) saved
on the event. The Live graph tab replays them.

No key: a deterministic policy runs the same tools with the same rule, so the
traces are real either way. If the model answers in prose without `finish`,
the policy picks from the tool results the model already fetched.

## "What about concurrency and memory correction?"

`FalkorStore.commit` is one query: guard `MATCH`es with `WHERE version = $v`,
then `WITH *`, then all `MERGE`s. If a guard misses, zero rows, nothing
written. Tasks have 60 s leases; `engine.claim` guards on the task version, so
50 workers racing produce one winner (test). A plan records
`memoryVersions`; approval re-checks each cited memory is active at that
version, so after `migrate` supersedes the fact, approve fails with 409 and
resume rebuilds the plan (test).

Supersession keeps the old node (`status: superseded`) and adds
`(new)-[:SUPERSEDES]->(old)`, so the history is in the graph, not deleted.

## "Why pattern comprehensions instead of OPTIONAL MATCH?"

Because chaining `OPTIONAL MATCH` after a `collect()` in FalkorDB returned
empty lists for the second match in my testing. `[(u)-[:HAS_MEMORY]->(m) |
m.payload]` inside `RETURN` evaluates per row and was correct every time. The
first version of `suspects` used `OPTIONAL MATCH` and failed the test; the
graph tests caught it. Also `shortestPath` must be in `WITH`/`RETURN`, not
`MATCH`.

## "What is pre-event and what is event work?"

Pre-event (Oct 12–13): the scaffold. UI, Express, the state machine, the
`GraphTools` interface, synthetic data, a SQLite stand-in so the UI could be
built. Disclosed in commit messages and README.

Event (Oct 15+): `server/falkor.ts` in full (schema, indexes, guarded writes,
every traversal, full-text, betweenness), removing SQLite and the offline demo
from the product, `search_memory` tool, critical services, docs, deploy.

The FalkorDB layer is not a port of the SQLite one: the SQLite store had no
typed labels or relationships and no graph tools; it was a blob store with an
edge table. The traversals were designed against FalkorDB.

## "What would you do next?"

Vector index on memory embeddings for semantic recall (`CREATE VECTOR INDEX`),
community detection to cluster services into blast domains, a real identity
provider, independent worker processes, retention.

## Numbers to have ready

Seed per workspace: 14 services, 8 people, 4 teams, 6 incidents, 15 memories,
4 decisions; 51 nodes, 97 relationships. Tests: 30 unit, 31 with FalkorDB
integration, 2 Playwright. Agent tool loop: max 6 rounds, 40 s timeout per
call. Lease: 60 s. Live-model accuracy on the three distinguishable scenarios,
interleaved: 6/6 after the signal-fit change.
