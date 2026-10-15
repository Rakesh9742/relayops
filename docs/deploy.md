# Deploy

## Option A: one box with Docker Compose (simplest)

```sh
cp .env.example .env         # set OPENAI_API_KEY and DEMO_ACCESS_CODE
docker compose --profile app up -d --build
```

App on :4177, FalkorDB Browser on :3017. Put a TLS proxy (Caddy, nginx) in
front and set `COOKIE_SECURE=true`.

## Option B: Fly.io app + FalkorDB Cloud

1. Create a FalkorDB Cloud instance (free tier is fine). Note host, port,
   username, password.
2. `fly launch --no-deploy` (uses the Dockerfile). Then:

```sh
fly secrets set MEMORY_BACKEND=falkordb \
  FALKORDB_HOST=<cloud-host> FALKORDB_PORT=<port> \
  FALKORDB_USERNAME=<user> FALKORDB_PASSWORD=<pass> \
  DEMO_ACCESS_CODE=<code> COOKIE_SECURE=true \
  MODEL_PROVIDER=openai OPENAI_API_KEY=sk-...
fly deploy
```

`fly.toml` needs `internal_port = 4177`. The app sets `HOST=0.0.0.0` in the
image.

## Option C: Railway / Render

Same image. Set the same environment variables. Add a FalkorDB service from
the `falkordb/falkordb` image with a persistent volume, or use FalkorDB Cloud.

## After deploy

- `GET /api/health` returns `backend: "falkordb"` and node/edge counts per graph.
- Open the app, enter the demo access code, run **Hidden neighbour**.
- Open FalkorDB Browser against the same instance and run
  `MATCH (i:Incident)-[:ROOT_CAUSE]->(s) RETURN i.number, s.name` to show the
  agents' writes.
