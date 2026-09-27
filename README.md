# Flow Builder — Cosmic demo 05

**Describe a workflow, get a ready-to-import n8n automation.** Pick a trigger (schedule, webhook,
RSS, form, new Google Sheets row), add up to five steps from a curated catalogue (HTTP request,
IF filter, set fields, wait, merge, Telegram, Slack, Discord webhook, SMTP email, Google Sheets
append, Postgres insert), and download valid n8n workflow JSON. Six one-click samples.

- Live SVG graph of the workflow and a plain-English summary, both updated as you type.
- Exports: n8n JSON (download or copy), Mermaid flowchart, plain-text outline.
- The whole builder state lives in the URL hash, so a link reproduces a build exactly.
- Deterministic, no AI, no account, no upload. The same state always yields byte-identical JSON —
  node ids are hashed from the state, not random.

Served at `https://www.skabene.id.lv/demo/flow/`.

## How it is put together

| Path | What |
|---|---|
| `src/lib/catalog.ts` | Triggers/steps, their form fields and defaults |
| `src/lib/cron.ts` | Human schedule picker → cron, cron validator and describer |
| `src/lib/state.ts` | Normalising untrusted state, share-link codec, validation messages |
| `src/lib/graph.ts` | One topology used by the canvas, the exporter and the diagrams |
| `src/lib/n8n.ts` | State → n8n workflow JSON, plus a shape checker |
| `src/lib/summary.ts` | Plain-English summary, Mermaid and text exports |
| `src/ui/*` | Preact UI (builder, SVG canvas, export panel) |
| `server/server.mjs` | Zero-dependency static server + `/demo/flow/healthz` |

n8n node type ids, `typeVersion`s and parameter shapes were checked against n8n's node sources
(`packages/nodes-base/nodes` on GitHub). Versions are deliberately a step behind the newest
(e.g. `httpRequest` 4.2, `if` 2.2, `set` 3.4, `googleSheets` 4.5, `postgres` 2.5) so the file also
imports into self-hosted instances that lag. `test/n8n-schema.test.ts` checks every emitted node against n8n's own node descriptions: type,
typeVersion, every parameter name and option value, resource-locator modes (and their URL
validation), and credential slots. The fixture `test/fixtures/n8n-nodes.json` is a slice of
`n8n-nodes-base@2.15.1`'s `dist/types/nodes.json`; refresh it with `scripts/extract-n8n-fixture.mjs`.
Credentials are named placeholders — n8n flags each
node and asks you to pick a credential of the right type.

## Run locally

Node 22, pnpm 10.

```bash
pnpm install
pnpm dev            # http://localhost:5173/demo/flow/  (/theme.css is proxied from the live site)
pnpm test           # vitest: cron, exporter shape, n8n node definitions, share-link codec, validation, server
pnpm typecheck
pnpm build          # → dist/
PORT=3105 node server/server.mjs    # http://localhost:3105/demo/flow/
```

## Deploy (VPS, Docker)

```bash
docker compose up -d --build        # binds 127.0.0.1:3105 only
curl -s http://127.0.0.1:3105/demo/flow/healthz    # → ok
```

Then route the path in the `www.skabene.id.lv` Caddy block (full path passed through, no
prefix stripping; this demo is public, so it must sit outside any `forward_auth` matcher):

```caddy
handle /demo/flow/* {
	reverse_proxy 127.0.0.1:3105
}
```

The server serves static files only — there is no API, so no rate limiting or body parsing is
needed; it only accepts GET/HEAD, sets a strict CSP and caches hashed assets for a year.
