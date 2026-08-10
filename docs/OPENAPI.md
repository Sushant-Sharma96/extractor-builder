# OpenAPI — Public API v1

## Canonical document

Repository root: [`openapi.yaml`](../openapi.yaml)

- Spec version: **OpenAPI 3.1.0**
- API version: **1.0.0** (`info.version`)
- HTTP contract version: **v1** (path prefix `/api/v1`)

## How to use

| Consumer | Recommendation |
|----------|----------------|
| Humans | Read [`API_REFERENCE.md`](./API_REFERENCE.md) |
| SDK authors | Import `openapi.yaml` into codegen (openapi-generator, speakeasy, etc.) |
| CI | `npm run test:api-contract` |

## Documented operations

| operationId | Path |
|-------------|------|
| `convertV1` | `POST /api/v1/convert` |
| `healthV1` | `GET /api/v1/health` |
| `readyV1` | `GET /api/v1/ready` |
| `convertLegacy` | `POST /api/figma/convert` |
| `healthLegacy` | `GET /health` |
| `readyLegacy` | `GET /ready` |
| `healthCompatMinimal` | `GET /api/health` |

## Schemas

Key components under `components.schemas`:

- `ConvertRequest` / `ConvertSuccess`
- `ErrorEnvelope`
- `ConvertBudgetError` / `ConvertRuntimeError`
- `CacheInfo` / `BudgetInfo`
- `HealthResponse` / `ReadyOk` / `ReadyNotOk`

## Security

Figma authentication is primarily **body `token`** or server env / OAuth — not a standard HTTP Bearer scheme for Figma. The OpenAPI `securitySchemes` entries document that for SDK clarity.

Optional `CONVERT_API_KEY` applies to `/api/convert` (site capture), not the frozen Figma convert route.

## Validation

Contract tests mirror these schemas in `server/api/v1/schemas.js` and assert live `/api/v1/*` responses. Report: [`CONTRACT_TEST_REPORT.md`](./CONTRACT_TEST_REPORT.md).

## Change control

Do not edit response field semantics without a versioning decision — see [`API_VERSIONING.md`](./API_VERSIONING.md).
