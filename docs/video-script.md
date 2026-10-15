# Demo video script (3 minutes)

Record at 1440×900 or larger, light theme, Chrome, with the server running on
FalkorDB and an API key set. Reset the graph first so the numbers match:

```sh
docker exec <falkordb-container> redis-cli GRAPH.DELETE relayops_acme
docker exec <falkordb-container> redis-cli GRAPH.DELETE relayops_orbit
# restart the server; it reseeds
```

Have two browser tabs ready: the app, and FalkorDB Browser
(http://127.0.0.1:3017 with compose, or :3000 with the default image).

Speak slowly. The pauses are where the UI needs a second to animate.

---

## 0:00 – 0:20 · The problem (Overview page)

**Screen:** Overview. Stats row visible: Knowledge graph 51 nodes, Active
memory, Critical services panel on the right.

> "Agents only know what they can reach. In an incident, what matters isn't
> the symptom, it's what the symptom is connected to. RelayOps puts the whole
> picture in a FalkorDB graph: services, who owns them, what broke before,
> what was learned, and what engineering already decided."

**Action:** hover the Critical services panel.

> "This ranking is betweenness centrality, computed in the database."

## 0:20 – 0:40 · The graph (Shared memory → Graph view)

**Action:** click **Shared memory** in the sidebar, then **Graph view**. Let the
layout settle (2 s). Hover `orders-db`. Drag it slightly. Scroll to zoom once.

> "One graph per workspace. People on the left, services in the middle,
> memory and decisions on the right. Every edge here is a typed relationship:
> DEPENDS_ON, ON_CALL_FOR, ROOT_CAUSE, SUPERSEDES."

**Action:** hover `notification-worker`, then `orders-db` again so the
`DEPENDS_ON` label shows.

> "Checkout depends on orders-db. So does this worker. Remember that."

## 0:40 – 1:25 · The investigation (the key 45 seconds)

**Action:** click **New incident**. Select **Hidden neighbour**. Click
**Create incident**. Click **Start investigation**.

The panel switches itself to **Live graph**. Step chips appear one at a time.

> "Same symptom as a classic pool exhaustion: the database pool is full. But
> there's a second signal, the worker queue is growing. Atlas calls
> `suspects`."

**Action:** when the first chip appears, hover it. When the graph lights up,
point at the red path from `checkout-api` through `orders-db` to
`notification-worker`.

> "orders-db is one hop away and explains the pool signal. The worker is two
> hops away, not even on checkout's call path, but it shares the database.
> Its memory explains both signals. Atlas picks the worker and rules out the
> nearer suspect."

**Action:** wait for Sage's chips. Point at the plan card with "Will not
restart".

> "Sage reads the decisions graph, finds that automatic restart was rejected,
> and proposes the worker drain runbook instead."

## 1:25 – 1:45 · The write-back

**Action:** click **Approve & resolve**. Wait for the green signal strip.

> "Echo verifies in the sandbox. Queue depth 4,120 to 38, pool back to 9 of
> 20."

**Action:** scroll the Live graph tab to "What the agents changed in the
graph".

> "And writes back: a ROOT_CAUSE edge from the incident to the worker, a new
> episodic memory on the worker node with the signals that pointed there, and
> the runbook's verified count goes up. The next incident starts from here."

## 1:45 – 2:10 · Ask the graph (Conversation tab)

**Action:** click **Conversation**. Click the suggestion "Who should I page?"
or type: *Who should I page and what else breaks if orders-db goes down?*
Send. Wait for the reply (5–10 s). Expand the trace.

> "Operators ask in plain language. The agent runs `who_knows` and
> `blast_radius` and cites the people and services it found. Every answer
> shows the queries behind it."

## 2:10 – 2:35 · Memory correction

**Action:** **New incident → Memory correction → Create → Start**. Wait for
"Approve & resolve". Click **Introduce new evidence**. Try **Approve** (it is
refused). Click **Resume from checkpoint**. Wait for the rebuilt plan.

> "New evidence: the database migrated. The old fact is superseded, not
> deleted, with a SUPERSEDES edge. The plan built on it is invalid, approval
> is refused, and Sage rebuilds against the new endpoint. The graph keeps the
> history."

## 2:35 – 2:50 · Prove it's the database (FalkorDB Browser tab)

**Action:** switch to the FalkorDB Browser tab. Graph `relayops_acme`. Run:

```cypher
MATCH (i:Incident)-[:ROOT_CAUSE]->(s:Service) RETURN i.number, s.name
```

> "This is the same database. Those ROOT_CAUSE edges were written by the
> agents a minute ago."

**Action:** run:

```cypher
MATCH (n:Memory)-[:SUPERSEDES]->(o:Memory) RETURN n.title, o.title
```

> "And the correction."

## 2:50 – 3:00 · Close

**Action:** back to the app. Click the workspace switcher, choose **Orbit
Financial**. Show the empty incident list.

> "Each workspace is its own FalkorDB graph; nothing leaks. RelayOps: agents
> that act on connected data, remember across sessions, and can show you the
> path behind every answer."

**End card:** repo URL, FalkorDB logo, three track names.

---

## If something goes wrong on camera

- Model is slow: the Live graph tab still animates per tool call; narrate the
  chips as they land.
- Model picks orders-db instead of the worker: it happens roughly 1 in 10.
  Cut, delete the incident's graph (`GRAPH.DELETE relayops_acme`), restart,
  retake.
- Chat says it can't find something: rephrase with the service name
  ("orders-db").
- Keep the FalkorDB Browser queries in a text file to paste.

## Timing check

Total speaking lines above run about 2:40 at a calm pace. The rest is UI
time. If over 3:00, cut the memory-correction section to just the
"Introduce new evidence → approve refused" beat (saves 15 s).
