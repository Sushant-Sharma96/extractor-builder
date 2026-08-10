# API Versioning — Public HTTP Contract

## Current version

| Item | Value |
|------|--------|
| Path version | **v1** (`/api/v1/…`) |
| OpenAPI `info.version` | `1.0.0` |
| Response header | `X-API-Version: 1` on `/api/v1/*` |
| Status | **Frozen** for external SDKs |

## Compatibility rules

1. **Legacy routes stay.**  
   `POST /api/figma/convert`, `GET /health`, `GET /ready`, `GET /api/health` remain supported and share handlers with v1 where applicable.

2. **Additive changes are allowed** within v1 (new optional response fields, new optional request fields) if they do not change meaning of existing fields.

3. **Breaking changes require a new path version** (`/api/v2/…`) and a new OpenAPI major document section / file. Do not silently break `/api/v1`.

4. **Payload semantics** for convert (`html`, `cache`, `budget`, HTTP status meanings for 429/503) are part of the frozen contract.

## What counts as breaking

- Removing or renaming a required response field
- Changing type or meaning of `ok`, `errorCode`, `cache.status`, `budget.outcome`
- Changing HTTP status mapping for budget Deny (429) / Queue (503)
- Requiring a new auth header for convert without a dual-support period

## What does not require a new version

- Bug fixes that restore documented behavior
- New optional fields
- New non-public / internal routes
- Documentation clarifications

## Deprecation

1. Announce legacy alias deprecation in docs (keep serving).
2. Keep alias for at least one major product release cycle.
3. Remove only in a future major API version with migration notes.

## SDK guidance

- Prefer `/api/v1/convert`, `/api/v1/health`, `/api/v1/ready`.
- Always read `errorCode` + `message`; keep fallback to `error` for older servers.
- Propagate `requestId` in client logs.
- Honor `budget.retryAfter` on 429/503 when present.

## Out of scope for versioning

Product Modes, Redis, CDN, telemetry, planner/budget/executor redesigns — those are product/architecture phases, not API version bumps unless they change the public HTTP contract.
