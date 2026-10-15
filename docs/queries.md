# Cypher queries and graph algorithms

Every query the product depends on, as written in `server/falkor.ts`. The agents
call these through the read-only tool set in `server/agents.ts`; the UI calls a
subset through `/api/graph/*`. There is no other data path: if FalkorDB is
down the server refuses to start.

Conventions:

- One graph per workspace: `relayops_<tenant>` (`relayops_acme`, `relayops_orbit`).
- `STRUCTURAL` = `DEPENDS_ON|ROUTES_TO`, the call graph.
- `PATH_STEPS(p)` = `[r IN relationships(p) | {from: startNode(r).id, relation: type(r), to: endNode(r).id}]`.
  Every tool returns this so the UI can draw the path behind the answer.
- Node payloads: each node carries `payload` (the full entity as JSON) plus
  lifted properties used in `WHERE`/`ORDER BY` (`id`, `status`, `category`,
  `name`, `number`, `signals`, `database`, `version`, ...).

## Indexes (created on first connect, idempotent)

```cypher
CREATE INDEX FOR (n:Service)  ON (n.id)        -- and every other label
CREATE INDEX FOR (n:Memory)   ON (n.status)
CREATE INDEX FOR (n:Memory)   ON (n.serviceId)
CREATE INDEX FOR (n:Incident) ON (n.status)
CREATE INDEX FOR (n:Task)     ON (n.status)
CREATE INDEX FOR (n:Event)    ON (n.incidentId)
CREATE INDEX FOR (n:Message)  ON (n.incidentId)
CREATE FULLTEXT INDEX FOR (m:Memory) ON (m.title, m.content)
```

## Writes

### Guarded multi-entity commit

One query writes an incident update, its task checkpoint, new events, new
memory, and all edges atomically. If any guard's version has moved, the
`MATCH` yields no rows and nothing after it executes. This is what makes
"exactly one worker wins a task" and "a stale plan cannot be approved" true.

```cypher
MATCH (g0 {id:$g0}) WHERE g0.version = $v0
MATCH (g1 {id:$g1}) WHERE g1.version = $v1
WITH *
MERGE (n0:Incident {id:$id0}) SET n0 = $p0
MERGE (n1:Task     {id:$id1}) SET n1 = $p1
MERGE (n2:Event    {id:$id2}) SET n2 = $p2
MERGE (n3:Memory   {id:$id3}) SET n3 = $p3
WITH * MATCH (a0 {id:$f0}), (b0 {id:$t0}) MERGE (a0)-[:HAS_EVENT]->(b0)
WITH * MATCH (a1 {id:$f1}), (b1 {id:$t1}) MERGE (a1)-[:ROOT_CAUSE]->(b1)
WITH * MATCH (a2 {id:$f2}), (b2 {id:$t2}) MERGE (a2)-[:HAS_MEMORY]->(b2)
WITH * MATCH (a3 {id:$f3}), (b3 {id:$t3}) MERGE (a3)-[:LEARNED_FROM]->(b3)
RETURN 1 AS committed
```

Labels and relationship types are chosen server-side from the closed sets in
`src/types.ts`; only values are parameters.

## Reads used by the workflow

### Incident context (memory an incident can see)

Affected or root-cause service, two structural hops upstream, their active
memory. Used by the engine to guard plans and by chat as fallback context.

```cypher
MATCH (i:Incident {id:$id})-[:AFFECTS|ROOT_CAUSE]->(s:Service)
WITH s, [(s)-[:DEPENDS_ON|ROUTES_TO*1..2]->(u:Service) | u] AS ups
UNWIND [s] + ups AS svc
MATCH (svc)-[:HAS_MEMORY]->(m:Memory {status:'active'})
RETURN DISTINCT m.payload AS payload
```

## Agent tools

### `suspects` — what upstream could be the cause

Every service the affected one depends on, up to two hops, with the incidents
where it was previously the root cause and its active memory. The agent
compares each suspect's memory `signals` against the live signals.

```cypher
MATCH p = (s:Service {id:$id})-[:DEPENDS_ON|ROUTES_TO*1..2]->(u:Service)
WITH u, p ORDER BY length(p)
WITH u, head(collect(p)) AS p
RETURN u.payload AS payload, length(p) AS depth, PATH_STEPS(p) AS path,
       [(i:Incident)-[:ROOT_CAUSE]->(u) | i.payload] AS incidents,
       [(u)-[:HAS_MEMORY]->(m:Memory {status:'active'}) | m.payload] AS memories
ORDER BY depth
```

Plus siblings: services that share a direct dependency with the affected one
(a worker holding the same database's connections is not on the call path but
can still be the cause).

```cypher
MATCH (s:Service {id:$id})-[r1:DEPENDS_ON|ROUTES_TO]->(d:Service)<-[r2:DEPENDS_ON|ROUTES_TO]-(u:Service)
WHERE u.id <> $id
RETURN DISTINCT u.payload AS payload, d.id AS via, type(r1) AS r1, type(r2) AS r2,
       [(i:Incident)-[:ROOT_CAUSE]->(u) | i.payload] AS incidents,
       [(u)-[:HAS_MEMORY]->(m:Memory {status:'active'}) | m.payload] AS memories
```

### `blast_radius` — what breaks if this fails

Reverse traversal of the call graph, three hops, shortest path per service.

```cypher
MATCH p = (u:Service)-[:DEPENDS_ON|ROUTES_TO*1..3]->(s:Service {id:$id})
WITH u, p ORDER BY length(p)
WITH u, head(collect(p)) AS p
RETURN u.payload AS payload, length(p) AS depth, PATH_STEPS(p) AS path
ORDER BY depth
```

### Shared scope prefix

`similar_incidents` and `decisions` look at the affected service plus
everything up to two structural hops upstream, keeping the path to each.

```cypher
MATCH (s:Service {id:$id})
OPTIONAL MATCH p = (s)-[:DEPENDS_ON|ROUTES_TO*1..2]->(u:Service)
WITH s, u, p ORDER BY length(p)
WITH s, u, head(collect(p)) AS p
WITH s, collect({svc: u, path: PATH_STEPS(p)}) AS ups
WITH [{svc: s, path: []}] + [x IN ups WHERE x.svc IS NOT NULL] AS scope
UNWIND scope AS row
WITH row.svc AS svc, row.path AS path
```

### `similar_incidents` — what happened before, and who fixed it

```cypher
<scope prefix>
MATCH (i:Incident {status:'resolved'})-[rel:AFFECTS|ROOT_CAUSE]->(svc)
WITH i, svc, path, type(rel) AS rel ORDER BY size(path)
WITH i, head(collect({svc: svc.id, path: path, rel: rel})) AS best
RETURN i.payload AS payload, best,
       head([(i)-[:ROOT_CAUSE]->(rc:Service) | rc.payload]) AS rc,
       head([(who:Person)-[:RESOLVED]->(i) | who.payload]) AS who,
       [(m:Memory {status:'active'})-[:LEARNED_FROM]->(i) | m.payload] AS learned
ORDER BY size(best.path), i.createdAt DESC
```

### `decisions` — what engineering has already decided (including rejections)

```cypher
<scope prefix>
MATCH (d:Decision)-[:ABOUT]->(svc)
WITH d, svc, path ORDER BY size(path)
WITH d, head(collect({svc: svc.id, path: path})) AS best
RETURN d.payload AS payload, best
ORDER BY size(best.path)
```

A decision with `status:'rejected'` and a `forbids` property stops Sage from
proposing that action.

### `who_knows` — who to page

Three reasons a person is connected to a service, each with its own path.

```cypher
MATCH (s:Service {id:$id})
WITH s,
  [(p:Person)-[:ON_CALL_FOR]->(s) |
     {p: p.payload, why: 'on call',
      path: [{from: p.id, relation: 'ON_CALL_FOR', to: s.id}]}] AS a,
  [(p:Person)-[:MEMBER_OF]->(t:Team)-[:OWNS]->(s) |
     {p: p.payload, why: 'member of ' + t.name,
      path: [{from: p.id, relation: 'MEMBER_OF', to: t.id}, {from: t.id, relation: 'OWNS', to: s.id}]}] AS b,
  [(p:Person)-[:RESOLVED]->(i:Incident)-[rel:AFFECTS|ROOT_CAUSE]->(s) |
     {p: p.payload, why: 'resolved ' + i.number,
      path: [{from: p.id, relation: 'RESOLVED', to: i.id}, {from: i.id, relation: type(rel), to: s.id}]}] AS c
UNWIND a + b + c AS r
RETURN r.p AS payload, collect(r.why) AS reasons, collect(r.path) AS paths
```

### `memories` — active memory on one service

```cypher
MATCH (:Service {id:$id})-[:HAS_MEMORY]->(m:Memory {status:'active'})
WHERE $category IS NULL OR m.category = $category
RETURN m.payload AS payload ORDER BY m.createdAt
```

### `path` — how are these two things connected

```cypher
MATCH (a {id:$from}), (b {id:$to})
WITH shortestPath((a)-[*..4]->(b)) AS p
WHERE p IS NOT NULL AND length(p) > 0
RETURN PATH_STEPS(p) AS path LIMIT 1
```

### `search_memory` — full-text over all memory

Question words are stemmed, stop-worded, and OR-ed as prefix terms.

```cypher
CALL db.idx.fulltext.queryNodes('Memory', $q) YIELD node, score
WHERE node.status = 'active'
RETURN node.payload AS payload, score ORDER BY score DESC LIMIT 8
-- $q = 'dropp*|index*'
```

### Name resolution (tools accept ids or names)

```cypher
MATCH (n) WHERE n.id = $ref OR toLower(n.name) = $low OR toLower(n.number) = $low OR toLower(n.handle) = $low
RETURN n.id AS id LIMIT 1
```

## Graph algorithms

### Critical services — betweenness centrality

Shown on the overview as "critical services": the ones most call paths flow
through. Computed in the database, not in the app.

```cypher
CALL algo.betweenness({nodeLabels: ['Service'], relationshipTypes: ['DEPENDS_ON', 'ROUTES_TO']})
YIELD node, score
WITH node, score WHERE score > 0
RETURN DISTINCT node.payload AS payload, score ORDER BY score DESC LIMIT 6
```

## Housekeeping

```cypher
MATCH (n) RETURN n.payload AS payload                               -- snapshot for the UI
MATCH (a)-[e]->(b) RETURN a.id AS from, b.id AS to, type(e) AS relation
MATCH (n {id:$id}) RETURN n.payload AS payload
MATCH (n) RETURN count(n) AS c                                      -- stats
MATCH ()-[e]->() RETURN count(e) AS c
```

## Verifying the Cypher

`tests/graph.test.ts` runs the same eight assertions twice: once against an
in-memory graph walk (`tests/doubles.ts`) and once against FalkorDB with
`TEST_FALKORDB=1`. Both must agree. `tests/engine.test.ts` adds an end-to-end
run on FalkorDB that checks, with direct Cypher, that `ROOT_CAUSE`,
`HAS_MEMORY`, `LEARNED_FROM`, and `SUPERSEDES` relationships were written with
the right labels.
