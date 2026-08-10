# Deployment Checklist

Use this before promoting a build to production. Security & operations readiness only — no feature flags for Product Modes / Redis / CDN.

---

## Pre-flight

- [ ] Architecture / compiler freeze still in effect (no unplanned compiler or shell logic changes in this release)
- [ ] `npm run test:scalability` passes
- [ ] `npm run bench:scalability` passes (or recorded baseline acceptable)
- [ ] Client built if UI is served: `npm run build`
- [ ] `.env` / secrets **not** in the image or git tree
- [ ] TLS terminator configured for public traffic
- [ ] Network egress allowed to `api.figma.com` (HTTPS)

---

## Configuration

- [ ] `NODE_ENV=production`
- [ ] `PORT` set and free
- [ ] `OUTPUT_DIR` on persistent writable volume
- [ ] `FIGMA_CACHE_DIR` / `FIGMA_BUDGET_DIR` set or accept defaults under `OUTPUT_DIR`
- [ ] `TEMP_DIRECTORY` writable
- [ ] `LOG_LEVEL=INFO` (or `WARN`)
- [ ] `REQUEST_TIMEOUT` reviewed (default 30000 ms)
- [ ] `JSON_BODY_LIMIT` reviewed (default `60mb` for plugin payloads)
- [ ] `FIGMA_TOKEN` **or** OAuth (`FIGMA_CLIENT_ID` + `FIGMA_CLIENT_SECRET` + `FIGMA_REDIRECT_URI`) configured
- [ ] Production API gate: `REQUIRE_API_KEY=1` and strong `CONVERT_API_KEY` (if exposing `/api/convert`)
- [ ] `MAX_CACHE_SIZE` / `MAX_LOG_SIZE` noted for ops (advisory)

---

## Startup validation

- [ ] Process starts without immediate exit
- [ ] Log contains `startup_ok` (no secrets in fields)
- [ ] Log contains `server_listen`
- [ ] `GET /health` returns `status: ok` with cache/budget/compiler status
- [ ] `GET /ready` returns `{ "ready": true }`
- [ ] `GET /api/health` still returns `{ "ok": true }` (compat)

---

## Security

- [ ] Secrets not present in application logs (spot-check convert + OAuth)
- [ ] Error responses include `requestId` / `errorCode` and **no** stack traces
- [ ] Invalid Figma URL rejected with 400
- [ ] Preview and cache paths not world-writable beyond the service user
- [ ] Plugin CORS exposure understood (edge restrict if needed)

---

## Functional smoke (behavior unchanged)

- [ ] Cached convert returns expected HTML (HIT / SUBTREE as applicable)
- [ ] Forced refresh still works
- [ ] Budget object still present on convert responses
- [ ] Deny / Queue still return prior HTTP semantics (429 / 503)
- [ ] No HTML / compiler fingerprint regressions vs golden if available

---

## Ops readiness

- [ ] Liveness probe → `/health`
- [ ] Readiness probe → `/ready`
- [ ] Graceful shutdown on SIGTERM verified
- [ ] Runbook linked: `docs/OPERATIONS_RUNBOOK.md`
- [ ] Security review linked: `docs/SECURITY_REVIEW.md`
- [ ] Rollback target (previous image/tag) identified
- [ ] Cache cleanup schedule agreed
- [ ] Secret rotation owner assigned

---

## Post-deploy

- [ ] Monitor ERROR logs for 30–60 minutes
- [ ] Confirm Figma 429 handling still records budget lock
- [ ] Confirm disk growth under cache is within expectations
- [ ] Sign off for manual review gate (no Product Modes / Redis / etc. in this release)

---

## Explicit do-not-deploy items

Do **not** enable or ship in this phase:

- Product Modes
- Redis / distributed cache / distributed locks
- CDN
- Telemetry backend / metrics dashboard
- Planner / budget / resolver / executor redesigns
- Compiler or HTML changes
