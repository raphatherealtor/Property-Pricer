# Property Pricer — PWA + API-backed SaaS shell + MCP server

Four layers sit on top of the existing React/Vite pricing app, which stays where
it is under `app-react/`. Nothing in `src/engine/` was modified.

| Layer | Lives in | What it does |
|---|---|---|
| **Installable PWA** | `app-react/public/` (`manifest.webmanifest`, `sw.js`, `icons/`), `app-react/src/lib/pwa/`, `app-react/src/components/saas/pwa-boot.tsx` | Installable on desktop, iPhone and Android; offline app shell; the last local scenario survives reloads and dropped connections |
| **Backend API** | `db/app-schema-v1.sql`, `app-react/migrations/`, `app-react/src/lib/api/`, `app-react/src/lib/crypto/` | Users, workspaces, properties, saved scenarios + history, exports, AI runs, CRM connections and sync logs |
| **AI + CRM** | `app-react/src/lib/ai/`, `app-react/src/lib/crm/`, `app-react/src/routes/api/crm/figgy/webhook.ts` | OpenAI / Anthropic Claude / Grok / Mistral (plus Kimi/DeepSeek via env) through server routes, plus the Figgy AI CRM connector (outbound push + signed inbound webhook) |
| **MCP server** | `app-react/src/lib/mcp/`, `app-react/src/routes/api/mcp/`, `app-react/public/.well-known/property-pricer-mcp.json` | A Model Context Protocol server (Streamable HTTP + SSE + REST bridge) exposing the locked engine as 15 tools, 8 resources and 6 prompts to any LLM client |

---

## 1. Guardrails, and how they are enforced

| Guardrail | Enforcement |
|---|---|
| Do not edit `src/engine/` | `app-react/scripts/engine.lock.json` pins the SHA-256 of every engine file. `npm run check:locks` fails on any add/change/delete. |
| Treat `src/engine/` as a locked SDK | It is only ever *called*, from `app-react/src/lib/api/engine-bridge.server.ts`. |
| Do not invent mock pricing/math | The client sends **inputs only**. The server re-prices with the locked engine before storing anything or building a prompt: `app-react/src/lib/ai/prompt.test.ts` walks the emitted prompt payload and fails if any number in it is not present in the engine's own export. |
| UI consumes computed outputs from the store/engine | `App` computes once with `compute()` and threads that `EngineOutput` into `Desk`, `Deck`, `Consumer`, and the Cloud panel — no panel recomputes a figure. |
| API keys never in frontend code | Keys are AES-256-GCM encrypted at rest (`src/lib/crypto/secrets.server.ts`) and are write-only across the API. Provider endpoints and secret env-var names exist only in server-only modules; `npm run check:secrets` fails the build if a client-bundled file so much as names one. |
| Never call providers from the browser | All vendor calls are server-side. The scanner above is the automated half of that rule. |

---

## 2. Database

`db/app-schema-v1.sql` is the reviewed DDL. It is applied through two byte-identical
copies, because the runtime reads a directory rather than an arbitrary path:

- `app-react/migrations/0002_app_schema_v1.sql` — applied by `src/lib/db.ts` on the
  embedded PGlite fallback (dev/preview) and by `scripts/migrate.mjs` against
  `DATABASE_URL` (Neon / Postgres) during `npm run build`.
- `app-react/public/app-schema-v1.sql` — downloadable reference, matching how
  `schema-v1.6.sql` ships.

Drift between the three is a build failure (`npm run check:locks`). To apply it by
hand:

```bash
psql "$DATABASE_URL" -f db/app-schema-v1.sql
```

Tables: `users`, `workspaces`, `properties`, `scenarios`, `scenario_exports`,
`ai_providers`, `ai_runs`, `crm_connections`, `crm_sync_events` — exactly the
specified schema, with no extra columns.

**How a signed-in user maps to `users.id`.** The schema types `users.id` as `uuid`
while the auth layer issues text ids. Rather than widen the schema, the app derives
a *deterministic* uuid from the auth id (`src/lib/api/ids.server.ts`), and keys the
row on the `email` unique constraint so two federated identities that share an
address converge on one workspace.

---

## 3. Environment variables

All optional; every one is read server-side only.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon/Postgres connection. Unset → embedded PGlite (dev/preview). |
| `APP_ENCRYPTION_KEY` | 32+ byte hex/base64/text key for the credential vault. Falls back to `BETTER_AUTH_SECRET`, then to a process-local key (reported as non-durable in the Install tab). |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROK_API_KEY` / `XAI_API_KEY`, `MISTRAL_API_KEY` | Server-side fallback keys, so a workspace can run without storing a key. |
| `KIMI_API_KEY` / `MOONSHOT_API_KEY`, `DEEPSEEK_API_KEY` | Server-side fallback keys for the two extra MCP-only vendors (OpenAI-compatible; not in the DB `ai_providers` enum). |
| `FIGGY_API_KEY`, `FIGGY_BASE_URL`, `FIGGY_SCENARIO_PATH` | Figgy CRM fallback key, base URL (default `https://api.figgy.ai`) and push path (default `/api/v1/scenarios`). |
| `PROPERTY_PRICER_MCP_TOKEN` | The global MCP bearer token. Unset → no global gateway token (per-client tokens in `mcp_clients` still work). |
| `MCP_REQUIRE_AUTH` | `"false"` to allow anonymous MCP reads; any other value (the default) requires a bearer token. |
| `MCP_PUBLIC_BASE_URL` | Optional absolute base URL advertised to LLM clients when the request host is not the public host. |

Set `APP_ENCRYPTION_KEY` before storing any credential in a real deployment —
without it the vault key is process-local and stored keys stop decrypting after a
restart (the Install tab states this explicitly).

---

## 4. Installable PWA

- **Manifest**: `app-react/public/manifest.webmanifest`, declared first in the
  document head. A document may only have one *effective* manifest (the browser
  honors the first `rel="manifest"` link), so the platform's
  `/__grok/manifest.webmanifest` is kept as a second, ignored declaration to keep
  the platform's head-injection dedupe happy. Regenerate with `npm run pwa:icons`.
- **Icons**: 192 and 512 (`any`), a 512 `maskable`, and a 180 apple-touch icon,
  all generated dependency-free by `app-react/scripts/generate-pwa-icons.mjs`. The
  same 180px render is also written to `public/__grok/icon-180.png`, which is the
  path the platform's head injector points `apple-touch-icon` at — so iOS gets the
  app icon with exactly one link and no middleware override.
- **Service worker**: `app-react/public/sw.js`. Navigations are network-first with
  an offline shell fallback; content-hashed `/assets/*` and static files are
  cache-first. `/api/*`, `/__grok/*`, `/_serverFn`, `/__app-env`, and the dev
  server's module graph (`/@*`, `/src/*`, `/node_modules/*`) are never intercepted —
  caching those would serve stale modules, break HMR, or put authenticated JSON in a
  shared cache.
- **Last local scenario**: `app-react/src/store/pricer.ts` persists the whole
  bundle (intake, persona extensions, persona, mode, slide) plus a `savedAt`
  timestamp to `localStorage` on every change, and restores it on load. Only
  *inputs* are stored; every figure is recomputed on-device by the locked engine.
- **Install UI**: the header's **Cloud → Install** tab. Chromium's
  `beforeinstallprompt` is captured and replayed from a user gesture; iOS Safari
  never fires it, so that platform gets the Share → Add to Home Screen copy and a
  link to the platform's own tutorial. The same tab shows the workspace summary
  (signed-in identity, provider/CRM state, property count) and warns when the
  credential vault has no durable key — see §3.

Offline behaviour is complete against a **production build** (`npm run build && npm run preview`,
or a deploy). In `npm run dev` the worker intentionally refuses to cache the dev
module graph, so offline reload shows the cached shell and offline notice rather
than a fully hydrated app.

---

## 5. API surface

All app data is reached through `createServerFn` handlers — callable from React,
never importable as a database client.

| Module | Functions |
|---|---|
| `src/lib/api/cloud.ts` | `getCloudStatus`, `listProperties` |
| `src/lib/api/scenarios.ts` | `saveScenario`, `listSavedScenarios`, `getSavedScenario`, `deleteSavedScenario`, `getScenarioHistory` |
| `src/lib/api/ai.ts` | `listAiProviders`, `saveAiProvider`, `deleteAiProvider`, `runScenarioAi`, `listAiRunHistory` |
| `src/lib/api/crm.ts` | `getCrmStatus`, `saveCrmConnection`, `rotateCrmWebhookSecret`, `deleteCrmConnection`, `pushScenarioToCrm`, `listCrmSyncLog` |

**Deliberately deferred verbs.** `saveProperty`, `deleteProperty`,
`updateSavedScenario`, and explicit export record/list wrappers are *not* exposed,
because nothing calls them and each would be untested surface that rots. The
capabilities themselves are live and exercised server-side: `saveScenario` calls
`upsertProperty` when the save form carries an address, accepts an `id` to revise a
scenario in place, and writes a `json` row to `scenario_exports` on every save. So
every table the spec lists has a live write path today; add the client verb back
alongside the UI that needs it. (Both `src/lib/api/cloud.ts` and
`src/lib/api/scenarios.ts` carry a comment at the exact insertion point.)

`POST /api/crm/figgy/webhook?connection=<uuid>` is the only session-less endpoint.
It verifies `x-figgy-signature: sha256=<hmac-of-raw-body>` (or an exact
`x-webhook-secret` header, compared in constant time) against the connection's
secret, refuses unsigned traffic, and records every attempt in `crm_sync_events`:
`handshake`, `scenario.request` (answered with the stored engine output matching
`input_hash` or `case_id`), and `scenario.note`.

Every AI run is recorded on `ai_runs` (`running` → `succeeded`/`failed`) together
with the engine snapshot the narrative was written from, so a stored summary can be
traced back to an engine version and input hash.

---

## 5.5 MCP server

Property Pricer is an MCP server: any MCP-capable client (ChatGPT, Claude, Grok,
Mistral, Kimi, DeepSeek, local agents) connects to it and calls the locked engine
through one canonical tool layer — the AI/CRM layers underneath are not special in
MCP tool logic.

**Transports**

| Transport | Endpoint |
|---|---|
| Streamable HTTP (canonical) | `POST /api/mcp` |
| SSE handshake + messages | `GET /api/mcp/sse`, `POST /api/mcp/messages` |
| REST bridge (non-MCP clients) | `POST /api/mcp/tools/list`, `POST /api/mcp/tools/call`, `GET /api/mcp/resources/list`, `POST /api/mcp/resources/read`, `GET /api/mcp/prompts/list`, `POST /api/mcp/prompts/get` |

All three share one JSON-RPC dispatcher (`src/lib/mcp/server.ts`), so they can
never expose different tools. A client manifest ships at
`/.well-known/property-pricer-mcp.json`.

**Client onboarding & machine-readable spec** (public, read-only — no secrets)

| Endpoint | Purpose |
|---|---|
| `GET /api/mcp/clients/presets` | Catalog of AI-platform presets — ChatGPT, Claude, Grok, Mistral, Kimi, Z.ai, DeepSeek, generic MCP client, generic REST/OpenAPI client. |
| `GET /api/mcp/clients/{id}/setup` | One preset's setup steps + copy-paste block (404 for an unknown id). |
| `GET /api/openapi.json` | OpenAPI 3.1 for the MCP endpoint, the REST bridge and the onboarding routes. |

Each preset carries a descriptive OAuth `client_id` (a public identifier, **not a
secret**), allowed redirect-URI patterns, default scopes, its auth method
(`public_pkce` unless the platform requires a confidential client) and setup
instructions. The OpenAPI document declares two security schemes: `mcpOAuth`
(OAuth 2.0 authorization code **with PKCE**) and `mcpBearer` (the static gateway
token as a bearer header). The catalog lives in `src/lib/mcp/clients.ts`; the spec
is generated from the live tool/resource/prompt registry by
`src/lib/mcp/openapi.ts`, so it cannot drift. The bearer token appears only as the
`YOUR_MCP_TOKEN` placeholder in anything served to a client.

**Auth** — `Authorization: Bearer <token>`. Accepted in order: no token (only when
`MCP_REQUIRE_AUTH=false`), the global `PROPERTY_PRICER_MCP_TOKEN` (owns one
deterministic workspace), or a per-client token hashed in `mcp_clients` (scoped to
one workspace). Rejection happens before any tool runs.

**Tools** (15) — `price_scenario`, `validate_inputs`, `suggest_inputs_from_text`,
`apply_input_patch`, `explain_math`, `save_scenario`, `load_scenario`,
`list_scenarios`, `compare_scenarios`, `generate_client_summary`,
`generate_risk_review`, `push_scenario_to_figgy`, `draft_crm_followup`,
`export_scenario`, `get_app_capabilities`. Every tool validates with zod, returns
structured JSON, never returns secrets, and re-runs the engine server-side when
pricing is needed.

**Resources** (6 + 2 templates) — engine contract, personas, input schema, output
schema, client-explanation guide, Figgy contract, plus
`property-pricer://scenario/{scenarioId}` and `…/engine-output` (templates).

**Prompts** (6) — `seller_pricing_summary`, `listing_agent_strategy`,
`lender_risk_review`, `investor_memo`, `commercial_broker_memo`, `figgy_crm_note`.
Each embeds the engine's own fact sheet so the client has the exact numbers to use.

**Rate limits** — 60 general, 10 AI-generating, and 5 Figgy calls per minute per
token (in-process fixed window; per-instance on serverless).

**Audit** — every accepted/rejected call is written to `mcp_calls` (schema in
`db/mcp-schema-v1.sql`, applied by `migrations/0003_mcp_gateway.sql`).

The admin panel lives in the **Cloud → MCP** tab: endpoint URL + copy buttons
(Claude Desktop config, generic config, bridge instructions), per-platform
onboarding cards (the nine presets, each with its own copy-paste setup), the tool
list, a live smoke test through `price_scenario`, and the last ten calls. It never
shows the token — only the `YOUR_MCP_TOKEN` placeholder.

---

## 6. Verify

```bash
cd app-react
npm run check      # frozen engine + schema parity + enum parity + no client secrets
npm run typecheck
npm test           # the guard suites plus the guarded src tests
npm run verify     # check + typecheck + test, in order
npm run build      # vite build + db:migrate
npm run mcp:inspect   # print the tool/resource/prompt registry
npm run verify:mcp    # mcp tests + secrets + locks
```

Current state: `npm run verify` and `npm run build` both exit 0. `npm run lint`
reports nothing in any file this work added or changed (4 pre-existing problems in
untouched platform files remain — see below).

| Suite | Script | Tests |
|---|---|---|
| PWA manifest/icons/service worker | `test:guards` (part) | 13 |
| Frozen engine + schema parity + enum parity | `test:guards` (part) | 7 |
| Client-bundle secret boundary | `test:guards` (part) | 11 |
| Local-scenario store (`pricer.ts`) | `test:src` (part) | 11 |
| Engine-grounded prompts | `test:src` (part) | 8 |
| MCP tools / resources / prompts / dispatcher | `mcp:test` | 22 |
| MCP contract (registry, auth, secrets, engine) | `mcp:test` | 11 |
| MCP onboarding presets + OpenAPI 3.1 | `mcp:test` | 8 |
| Platform src tests (pre-existing) | `test:src` (part) | 55 |

**The enum-parity guard.** `check:locks` compares each Postgres `CHECK (col IN …)`
constraint against the app enum that mirrors it, and (for personas) against the
locked engine's `Persona` union — including the MCP `client_type` and `status`
checks against `src/lib/mcp/schemas.ts`. A compile-time assertion in the wire
schema can prove the TypeScript enums agree, but nothing else proves the *database*
does — and a persona added to the engine and UI but not the DDL inserts fine in dev
and fails in production. Note this check reads `src/engine/types.ts`; it does not
write it.

**The MCP audit row.** `mcp_calls` is written on every accepted/rejected call. The
unit tests assert the DDL and the dispatcher's audit wiring; the row *insert* runs
against the real database in the built/deployed app, because the platform's DB
layer uses Vite's `import.meta.glob` for migrations and therefore cannot boot under
Node's test runner.

**Why `npm test` is not `npm run test:all`.** This checkout is a front-end hand-off
package: it ships no `.grok/` directory, no `AGENTS.md`, and no `SKILL.md`, and
Windows cannot create symlinks without elevation. 17 assertions in the platform's
own suites (`brand-check`, `grok-pwa-plugin`, `check-auth-invariant`,
`with-app-env`, `write-atomic`) therefore fail on missing fixtures or `EPERM` —
verified pre-existing by running them against the unmodified files, and by
re-running them with the original icon restored (identical 17 failures). They are
not caused by this work, and `npm run test:all` still runs them for anyone
building inside the full app-builder workspace.

The same is true of `npm run lint`: its 1 error and 3 warnings all predate this work
and live in files this change never touched (`src/lib/app-data/client.server.ts`,
`src/lib/auth/use-current-user.ts`, `scripts/engine-selftest.mjs`). They were left
alone deliberately, to keep this diff to the change that was asked for.

The original `test` script also used a shell-quoted glob
(`node --test 'scripts/**/*.test.mjs'`), which on Windows reaches Node *with the
quotes attached*, so it silently discovered **zero** tests. `test:all` uses the
unquoted `scripts/*.test.mjs`, which Node's own glob expands identically on
Windows, macOS and Linux.

One expectation in `scripts/migration-plan.test.mjs` was updated deliberately:
it asserted that the globbed `migrations/` directory contains no pending
migrations. That was true when the app had no schema of its own; it now asserts
the auth schema still ships outside the glob **and** that the globbed directory
contains exactly `0002_app_schema_v1.sql`, so an unreviewed migration appearing
there is caught.

Built-artifact checks (beyond source scanning):

- `sw.js`, `manifest.webmanifest` and all four icon PNGs land in the static build
  output; the webhook route is registered in the server bundle and its signature
  verification ships with it.
- All three client JS bundles in the build output were scanned for every provider
  endpoint and secret env-var name: **zero** hits.

---

## 7. Known limitations

- **One workspace per user.** `workspaces` supports many rows per owner and the
  schema is unchanged, but the UI bootstraps a single "Default Workspace".
- **Org sharing is not implemented** — there is no `workspace_members` table in the
  specified schema, so access is strictly per-owner.
- **PDF/deck exports are generated client-side** (the existing print stylesheet).
  The `scenario_exports` row for each save is recorded server-side as a `json`
  export; `pdf`/`deck`/`crm_payload` rows are supported by the schema and API but
  nothing writes them yet.
- **`crm_connections.webhook_secret` is plaintext**, per the specified schema. It is
  a shared verification token, not a credential this app presents to a third party.
