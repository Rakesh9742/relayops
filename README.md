# RelayOps

**A team that remembers.** A premium incident workspace where Atlas investigates, Sage prepares and applies approved sandbox recovery plans, and Echo verifies the result. Their shared memory survives sessions and keeps the evidence behind each decision.

## Run locally

On this Mac, double-click **`Start RelayOps.command`** in Finder. It builds the app and starts the UI and API together at **http://127.0.0.1:5177**, without development file watchers. Keep its Terminal window open while using RelayOps. You can also run it from Terminal:

```sh
cd /Users/rakesh/relayops
./"Start RelayOps.command"
```

To try the interface immediately, open **`preview.html`** in Chrome or Safari. This is a standalone interactive browser demo: it uses the same agent workflow with a browser-local sample store, requires no server or API key, and saves progress on this device. Use one tab at a time; its local workspace separation is not a security boundary. The normal app below uses authenticated server routes and SQLite or FalkorDB.

Node.js 22.13 or newer is required (Node 24 recommended for built-in SQLite).

```sh
npm install
cp .env.example .env
npm run dev
```

Open **http://127.0.0.1:5177**. The API uses port 4177. Local preview uses SQLite at `.data/relayops.db`, with no API key required. Do not delete `.data` if you want to keep memory and sessions.

```sh
npm run build
npm start
```

After building, the API also serves the app at **http://127.0.0.1:4177**.

`ERR_CONNECTION_REFUSED` means nothing is accepting the connection at that address. Start one of the commands above before opening its matching URL, and leave it running. If `npm run dev` fails with `EMFILE: too many open files, watch`, use the Mac launcher or `npm run build` followed by `npm start`; those do not use development watchers. A standalone `preview.html` does not start a localhost server.

## What works

- Three named specialists with durable task claims, version checks, expiring leases, and saved handoffs.
- Episodic incident outcomes, semantic service facts, and procedural runbooks with verification history.
- Graph-shaped retrieval: incident → affected service → connected memory, up to three hops.
- Explicit recovery approval before applying a simulated change.
- Memory correction: preserve the original fact, create a replacement, invalidate the current plan, and resume using the current endpoint.
- Persisted conversations with source-linked context; AI follow-ups use the last 12 messages from that incident.
- Server-side OpenAI or Claude explanations, with an in-app connection check and explicit simulation mode.
- Two sample workspaces with server-authenticated scope. A demo owner can intentionally switch between them.
- Desktop and mobile dashboard, timeline, graph view, searchable memory library, source details, agents, and settings.
- Tenant-scoped export and an in-app demo playbook.

## Use FalkorDB

FalkorDB is the intended primary store. SQLite is explicitly a local preview and does **not** satisfy the hackathon's FalkorDB requirement.

```sh
docker compose up -d
npm install falkordb
```

Change `.env`:

```dotenv
MEMORY_BACKEND=falkordb
FALKORDB_HOST=127.0.0.1
FALKORDB_PORT=6387
```

Restart the API. Each tenant gets its own graph (`relayops_acme`, `relayops_orbit`). Nodes, relationships, tasks, conversations, and memory are written to FalkorDB; the adapter is not a secondary visualization mirror. Context retrieval uses a Cypher traversal, and multi-entity state transitions use one guarded Cypher query. Request bodies cannot select arbitrary tenant graphs.

The optional SDK is dynamically imported only in FalkorDB mode. Failure to connect stops startup instead of silently switching stores. The Compose volume persists database files; AOF uses `everysec`, which is not a zero-data-loss durability guarantee. For a submission, pin the tested database image digest and SDK version after running the integration suite in your own environment.

## Connect OpenAI

Create a project API key in your OpenAI account and add it to the local `.env` file. A ChatGPT or Codex login is not an API key for this app. Do not paste the key into chat, browser storage, or a `VITE_*` variable.

```dotenv
MODEL_PROVIDER=auto
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-5.4-mini
```

Restart the server, open **Settings & connections**, then select **Test AI connection**. This sends one short request without incident data. The UI distinguishes an untested configuration, a successful request, and a failed request. Each check uses the configured provider's API. The standalone `preview.html` always remains in simulation mode.

The default OpenAI model is GPT-5.4 mini. Set `OPENAI_MODEL` to another Responses-compatible model available to your project if needed. Requests use the [Responses API](https://developers.openai.com/api/docs/guides/text), a 25-second timeout, and `store: false`. RelayOps stores its own conversations; `store: false` does not mean the provider has no abuse-monitoring retention. See the [API data controls](https://developers.openai.com/api/docs/guides/your-data).

`MODEL_PROVIDER=auto` prefers OpenAI, then Anthropic, and uses simulation when no key exists. To select Claude explicitly, set `MODEL_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_MODEL` (default `claude-sonnet-4-5`). An explicitly selected provider with a missing key stops startup with setup instructions. `MODEL_PROVIDER=simulation` disables calls even if keys exist. A failed configured provider never silently switches provider or returns a simulated answer.

Without a key, this is a **deterministic multi-agent workflow simulation**, not an LLM-powered autonomous incident responder. With a key, the model generates evidence-grounded explanations and conversation answers; task routing, tool selection, and recovery remain constrained to the demonstrated scenario. The model cannot run shell commands or mutate production infrastructure. Model failures pause workflow progress with an actionable error and can be retried from the saved checkpoint. Current memory takes priority over older conversation text. Only the incident's workspace evidence and up to 12 recent conversation messages (2,000 characters per message) are sent; no other incident or tenant's conversation is included.

## Test

```sh
npm test
npm run build
npm run test:browser
npm run benchmark
```

The core suite checks the complete workflow, exactly one winner among competing claim requests, tenant boundaries, immutable memory history, stale-plan invalidation, persisted conversation and resume after opening a new store connection, expired-lease reclaim, and session/origin/input checks.

API tests inject Node request/response objects into Express without opening a listening socket. They test middleware and routes, not network transport. Rebuild the standalone demo after changes with `npm run build:demo`.

Install a browser if needed:

```sh
npx playwright install chromium
```

Run the same critical graph workflow against a dedicated FalkorDB development instance:

```sh
MEMORY_BACKEND=falkordb TEST_FALKORDB=1 npm test
MEMORY_BACKEND=falkordb npm run benchmark
```

The graph integration test seeds and writes sample graphs. Do not point it at production data. Benchmarks write to a separate `relayops_benchmark` graph (or SQLite tenant) and print the actual backend, measured latency, throughput, stored-write counts, and claim winners. SQLite uses synchronous calls within one process; its benchmark is not evidence of FalkorDB performance or distributed scalability.

## Demo in three minutes

1. Start the preloaded Acme incident. Atlas recalls that restarting did not resolve the last pool exhaustion incident.
2. Sage prepares a recovery plan and waits for approval. Inspect its source memories.
3. Click **Introduce new evidence**. A simulated database migration supersedes the old fact and invalidates the plan. Inspect both versions in Shared memory.
4. Reload the browser, or restart the API. Click **Resume from checkpoint**. Sage produces a plan for the current database.
5. Approve the plan. Echo checks the simulated recovery and records an episodic outcome plus procedural verification history.
6. Switch to **Orbit Financial**. Acme's incidents and messages are absent.

To demonstrate abrupt worker recovery, kill only the app process while a task is running, restart it, and allow its 60-second lease to expire. The task can then be claimed again; an old worker's version cannot overwrite the new claim. Recovery effects in this prototype are stored state changes and committed atomically with their task checkpoint. Real external actions would require downstream idempotency support or an outbox, reconciliation, and independent verification.

## Architecture and limits

React + TypeScript + Vite, Express, a small persisted state-machine runner, and interchangeable FalkorDB / SQLite stores. UI polling is scoped to the authenticated workspace. The prototype loads the small workspace graph into the UI; pagination, bounded server-side search, richer graph layouts, independent worker processes, retention policies, and production identity/roles are future work.

Hosted demo access requires `DEMO_ACCESS_CODE` and an explicit `HOST` value. Anyone with that demo code is a demo owner of both sample workspaces. This is **not production multitenant identity management**. Use HTTPS and `COOKIE_SECURE=true` when hosting. Replace demo access with an identity provider and per-user membership provisioning before using real company data. Only sample data is seeded.

## Build provenance and event eligibility

This prototype was started **October 12, 2026**, before Graph Hacks. The [published rules](https://www.wemakedevs.org/hackathons/falkordb) require the submission and main FalkorDB implementation to be new work completed during **October 15–18, 2026**. This repository must not be represented as work first created during that window. Confirm what pre-event material is permitted with the organizers and build the qualifying entry accordingly.

The initial environment restricted Docker socket access and external package downloads. The SQLite preview can be validated here; FalkorDB integration and live model calls require an environment with the corresponding service and credentials. See `docs/verification.md` for the concrete validation record.

## References

- [FalkorDB TypeScript client](https://github.com/FalkorDB/falkordb-ts)
- [Parameterized graph queries](https://docs.falkordb.com/commands/graph.query)
- [FalkorDB persistence](https://docs.falkordb.com/operations/durability/persistence)
- [Claude Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [OpenAI API authentication](https://developers.openai.com/api/reference/overview)
- [OpenAI text generation and response parsing](https://developers.openai.com/api/docs/guides/text)
- [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
