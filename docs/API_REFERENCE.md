# API Reference — Public API v1

Frozen external HTTP contract for SDKs and integrations.

**Canonical OpenAPI:** [`openapi.yaml`](../openapi.yaml)  
**Versioning policy:** [`API_VERSIONING.md`](./API_VERSIONING.md)  
**OpenAPI guide:** [`OPENAPI.md`](./OPENAPI.md)

---

## Endpoints

| Method | Canonical | Legacy alias | Purpose |
|--------|-----------|--------------|---------|
| `POST` | `/api/v1/convert` | `/api/figma/convert` | Figma URL → HTML/CSS |
| `GET` | `/api/v1/health` | `/health` | Liveness |
| `GET` | `/api/v1/ready` | `/ready` | Readiness |
| `GET` | — | `/api/health` | Compat `{ ok: true }` only |

`/api/v1/*` responses include header `X-API-Version: 1`.

---

## Response envelope

### Success (convert)

```json
{
  "ok": true,
  "requestId": "a1b2c3d4e5f60718",
  "html": "<!DOCTYPE html>...",
  "css": "/* ... */",
  "scripts": { "script.js": "" },
  "sectionsSummary": "…",
  "sections": [],
  "source": "figma-compiler",
  "cache": { "status": "HIT", "reason": "exact", "restCalls": 0, "compileMs": 120 },
  "compiler": { "graphId": "…", "steps": [], "artifactFingerprint": "…", "timings": {}, "fingerprint": {} },
  "output": { "dir": "…", "slug": "…", "assets": 0 },
  "previewUrl": "/preview/…/",
  "budget": { "outcome": "Allow", "reason": "…", "warnings": [] }
}
```

Domain fields (`html`, `cache`, `budget`, …) keep pre-v1 semantics.

### Error (all convert failures)

```json
{
  "ok": false,
  "errorCode": "INVALID_URL",
  "message": "Please provide a valid Figma design URL.",
  "error": "Please provide a valid Figma design URL.",
  "requestId": "a1b2c3d4e5f60718"
}
```

`error` is a legacy alias of `message`. Budget blocks also include `stage`, `fileKey`, `nodeId`, `cache`, `budget`.

---

## Convert

### Request

```http
POST /api/v1/convert
Content-Type: application/json

{
  "url": "https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/MyFile?node-id=1-2",
  "token": "figd_…",
  "refresh": false,
  "force": false
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `url` | yes | Figma `design` / `file` / `proto` URL |
| `token` | no | PAT; else `FIGMA_TOKEN` or OAuth session |
| `refresh` | no | `true` / `1` bypasses cache |
| `force` | no | Overrides soft budget Deny/Queue (not hard rate-limit lock) |

### Success `200`

See envelope above. `cache.status` is `HIT` | `SUBTREE` | `MISS`.

### Error `400`

```json
{
  "ok": false,
  "errorCode": "INVALID_URL",
  "message": "Please provide a valid Figma design URL.",
  "error": "Please provide a valid Figma design URL.",
  "requestId": "…"
}
```

Other codes: `INVALID_BODY`, `INVALID_FILE_KEY`, `INVALID_NODE_ID`, `INVALID_TOKEN`, `INVALID_REFRESH`, `INVALID_FORCE`, `INVALID_JSON`.

### Error `401`

```json
{
  "ok": false,
  "errorCode": "FIGMA_AUTH_REQUIRED",
  "message": "A Figma token is required. …",
  "error": "A Figma token is required. …",
  "requestId": "…"
}
```

### Error `429` (budget Deny / rate limit)

```json
{
  "ok": false,
  "errorCode": "BUDGET_DENY",
  "message": "Budget Deny: rate_limit_lock_active",
  "error": "Budget Deny: rate_limit_lock_active",
  "requestId": "…",
  "stage": "MISS",
  "fileKey": "AbCdEfGhIjKlMnOpQrStUv",
  "nodeId": "1:2",
  "cache": { "status": "MISS", "reason": "no_snapshot", "restCalls": 0, "compileMs": 5 },
  "budget": {
    "outcome": "Deny",
    "reason": "rate_limit_lock_active",
    "retryAfter": 60,
    "warnings": ["…"]
  }
}
```

### Error `503` (budget Queue)

```json
{
  "ok": false,
  "errorCode": "BUDGET_QUEUE",
  "message": "Budget Queue: soft_cap",
  "error": "Budget Queue: soft_cap",
  "requestId": "…",
  "stage": "MISS",
  "fileKey": "…",
  "nodeId": "…",
  "cache": { "status": "MISS", "reason": "no_snapshot", "restCalls": 0, "compileMs": 4 },
  "budget": { "outcome": "Queue", "reason": "soft_cap", "retryAfter": 30, "warnings": ["…"] }
}
```

---

## Health

```http
GET /api/v1/health
```

```json
{
  "status": "ok",
  "uptime": 3600,
  "cache": "ok",
  "budget": "ok",
  "compiler": "ok"
}
```

`cache` / `budget` / `compiler` are `ok` or `degraded`. No internal paths or secrets.

---

## Ready

```http
GET /api/v1/ready
```

**Ready `200`**

```json
{ "ready": true }
```

**Not ready `503`**

```json
{
  "ready": false,
  "configuration": "ok",
  "filesystem": "error",
  "budgetStore": "error",
  "cache": "error"
}
```

---

## Auth notes

- Convert auth is **not** Bearer-to-Figma on the public route by default.
- Supply Figma PAT in body `token`, or configure server `FIGMA_TOKEN` / OAuth.
- Optional gate for site convert (`/api/convert`): `CONVERT_API_KEY` / `REQUIRE_API_KEY` (separate from Figma convert).

---

## Out of public v1 surface

Plugin (`/api/figma/plugin`), OAuth login/callback, site URL convert (`/api/convert`), and preview static files are **not** part of the frozen public convert contract. Prefer OpenAPI for the frozen three operations.
