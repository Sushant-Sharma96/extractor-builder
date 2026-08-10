# Contract Test Report — Public API v1

| Field | Value |
|-------|--------|
| **Date** | 2026-07-18 |
| **OpenAPI** | `openapi.yaml` (3.1) |
| **Result** | PASSED |
| **Passed** | 19 |
| **Failed** | 0 |

## Results

| Test | Status | Detail |
|------|--------|--------|
| openapi.yaml exists | PASS |  |
| openapi.yaml declares v1 paths | PASS |  |
| openapi.yaml includes error examples 400/429/503 | PASS |  |
| errorEnvelope shape | PASS |  |
| successEnvelope shape | PASS |  |
| budgetErrorCode mapping | PASS |  |
| fixture ConvertSuccess | PASS |  |
| fixture Error 400 | PASS |  |
| fixture Error 429 BUDGET_DENY | PASS |  |
| fixture Error 503 BUDGET_QUEUE | PASS |  |
| fixture Health + Ready | PASS |  |
| live GET /api/v1/health | PASS |  |
| live GET /health legacy match | PASS |  |
| live GET /api/v1/ready | PASS |  |
| live GET /ready legacy | PASS |  |
| live GET /api/health compat | PASS |  |
| live POST /api/v1/convert 400 | PASS |  |
| live POST /api/figma/convert 400 alias | PASS |  |
| live POST /api/v1/convert 401 without token | PASS |  |

## Coverage

- OpenAPI document presence and required paths
- Envelope helpers (`ok` / `errorCode` / `message` / `error` / `requestId`)
- Fixtures: Convert success, 400, 429, 503, Health, Ready
- Live: `/api/v1/health`, `/api/v1/ready`, legacy aliases, convert 400/401
- Header: `X-API-Version: 1` on `/api/v1/*`

## Non-goals verified

- No planner / budget / resolver / executor / compiler logic changes in this suite
- Convert success path not exercised live (requires Figma) — schema covered by fixtures
