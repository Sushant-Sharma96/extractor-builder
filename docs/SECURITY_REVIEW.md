# Security Review — Operations Readiness

**Scope:** Security & operations readiness only. No product features, Redis, CDN, planner/budget/resolver/executor logic changes, or compiler changes.

**Date:** 2026-07-18  
**Status:** Ready for manual review

---

## 1. Threat model

| Actor | Goal | Primary assets |
|-------|------|----------------|
| Unauthenticated client | Abuse convert endpoints, scrape, DoS | CPU, disk, Figma rate budget |
| Authenticated (PAT/OAuth) caller | Convert designs | Figma tokens, design documents, cache |
| Compromised log sink | Steal secrets from logs | Tokens, OAuth secrets, API keys |
| Malicious URL / body | Path traversal, injection, oversized payloads | Filesystem under `OUTPUT_DIR` / cache |

**Trust boundaries**

- Client → Express (`/api/*`, `/health`, `/ready`)
- Process → Figma REST API (outbound HTTPS)
- Process → local filesystem (cache, budget, preview output)
- Process → environment / secrets store (`.env`, OS env)

---

## 2. Security findings

| ID | Area | Severity | Finding | Mitigation |
|----|------|----------|---------|------------|
| S1 | Secrets | High (pre) | Tokens could appear in free-form logs | Structured logs redact `token`/`secret`/`authorization` keys; mask `Bearer` and `figd_*` |
| S2 | Errors | Medium (pre) | Stack traces / raw messages to clients | `sendError` — no stacks; `errorCode` + `message` + `requestId`; stacks only in development console |
| S3 | Input | Medium | Weak URL / nodeId checks | `server/security/validate.js` — Figma URL, fileKey, nodeId, body flags |
| S4 | Paths | Medium | Slug / cache key traversal | `safeSlug`; cache segment checks reject `..` and path separators |
| S5 | Config | Medium | Scattered env reads | Central `server/config.js` + startup fail-fast |
| S6 | Process | Medium | Unhandled rejections | Handlers log safely; uncaughtException exits |
| S7 | Payload | Low | Large JSON bodies | Configurable `JSON_BODY_LIMIT` (default `60mb` for plugin) |
| S8 | Timeout | Low | Hung Figma fetches | `REQUEST_TIMEOUT` / `FIGMA_REQUEST_TIMEOUT_MS` + AbortController |
| S9 | Auth gate | Info | Convert API key optional | Set `REQUIRE_API_KEY=1` + `CONVERT_API_KEY` in production |
| S10 | OAuth | Info | In-memory token; callback previously echoed errors | Callback no longer returns raw exception text |

---

## 3. Secret handling

**Sources**

- `FIGMA_TOKEN`, `FIGMA_CLIENT_SECRET`, `CONVERT_API_KEY`
- Request body `token` (PAT paste)
- In-memory OAuth access token

**Controls**

- Config object exposes only booleans (`_hasFigmaToken`, etc.), never secret values
- Logs: key-name redaction + string masking (`Bearer ***`, `figd_***`)
- Cache / snapshots store design documents and asset URLs — **not** PATs or OAuth tokens
- Client responses do not include tokens; `/api/figma/status` returns `{ connected: boolean }` only
- Authorization headers are not logged

**Operator duty**

- Keep `.env` out of git and image layers
- Rotate Figma PAT / OAuth client secret / `CONVERT_API_KEY` on compromise (see runbook)

---

## 4. Logging review

| Level | Use |
|-------|-----|
| DEBUG | Verbose diagnostics (default in non-production) |
| INFO | Startup, convert lifecycle, cache events |
| WARN | Startup warnings, soft degradation |
| ERROR | Failures, unhandled rejection/exception |

**Fields:** `ts` (ISO-8601), `level`, `component`, `event`, plus safe context (`requestId`, `fileKey`, `nodeId`, timings).

**Avoided:** Duplicate human + JSON lines for the same convert lifecycle event (structured JSON preferred). Development may still print stacks for local debugging.

---

## 5. Input validation

| Input | Rules |
|-------|--------|
| Figma URL | https, `figma.com`, `/design|file|proto/`, length ≤ 2048 |
| fileKey | Parsed from URL; `[A-Za-z0-9_-]{10,128}` |
| nodeId | Optional; `digits:digits` form, length ≤ 64 |
| token | Optional string ≤ 512 |
| refresh / force | Boolean or 0/1 |
| Site convert URL | http(s) only |
| OAuth `code` | Present, string, length ≤ 512 |
| Output slug | Alphanumeric + hyphen via `safeSlug` |

Invalid input → HTTP 400 with `errorCode`, `message`, `requestId` (legacy `error` field retained).

---

## 6. Configuration review

Central module: `server/config.js`.

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `3001` | |
| `OUTPUT_DIR` | `./output` | |
| `FIGMA_CACHE_DIR` | `{OUTPUT_DIR}/figma-cache` | |
| `FIGMA_BUDGET_DIR` | `{CACHE}/_budget` | |
| `TEMP_DIRECTORY` | `{OUTPUT_DIR}/.tmp` | |
| `LOG_LEVEL` | `DEBUG` (dev) / `INFO` (prod) | |
| `REQUEST_TIMEOUT` | `30000` | ms |
| `MAX_CACHE_SIZE` | 5 GiB | Advisory for ops |
| `MAX_LOG_SIZE` | 50 MiB | Advisory for ops |
| `JSON_BODY_LIMIT` | `60mb` | |
| `REQUIRE_API_KEY` | `false` | Enable for production |
| `CONVERT_API_KEY` | empty | Required if `REQUIRE_API_KEY=1` |
| `FIGMA_TOKEN` | empty | Optional if OAuth / paste |

Startup (`server/startup.js`) validates config, writable dirs, and compiler load — **exits process** on hard failure.

---

## 7. Remaining risks

1. **No distributed rate limit** — single-node budget only; multi-instance needs an ops layer (out of scope).
2. **Plugin CORS `*`** — intentional for Figma plugin sandbox; do not expose plugin route publicly without a gateway.
3. **Preview static files** — anyone who can reach `/preview/<slug>/` can read generated bundles; protect at network edge if needed.
4. **OAuth state fixed** — CSRF risk on multi-user hosts; acceptable for single-user local tool; tighten before multi-tenant.
5. **MAX_CACHE_SIZE not enforced at write** — advisory only; schedule cleanup via runbook.
6. **Pastes of PAT in body** — transit must be HTTPS in production.

---

## 8. Explicit non-goals (this phase)

Product Modes, Redis, CDN, distributed cache/locks, telemetry backends, planner/budget/resolver/executor redesign, compiler changes, HTML changes, new product APIs.
