# Operations Runbook

**Service:** lovable-extractor API (`server/index.js`)  
**Audience:** Operators deploying a single-node production instance

---

## Startup

1. Ensure Node.js LTS is installed and dependencies: `npm ci`
2. Provide env (file or platform secrets) — see `docs/DEPLOYMENT_CHECKLIST.md`
3. Start: `node server/index.js` or `npm start` (if defined)
4. Startup validation runs **before** listen:
   - Config valid
   - `OUTPUT_DIR`, cache, budget, temp writable
   - Compiler module loads
5. On failure the process **exits with code 1** — fix env/disk and restart
6. Confirm:
   - `GET /health` → `status: ok`
   - `GET /ready` → `ready: true`
   - Structured log event `startup_ok` then `server_listen`

---

## Shutdown

- Prefer `SIGTERM` / `SIGINT` — server closes HTTP then exits
- Force exit after ~10s if connections hang
- In-flight converts may abort; clients should retry with backoff
- OAuth in-memory token is lost on restart (users re-connect or use `FIGMA_TOKEN`)

---

## Deployment

1. Build client if serving UI: `npm run build`
2. Deploy artifact **without** `.env` committed
3. Mount or create writable volumes for `OUTPUT_DIR` (cache + preview)
4. Set `NODE_ENV=production`, `LOG_LEVEL=INFO`
5. Enable `REQUIRE_API_KEY=1` + strong `CONVERT_API_KEY` when exposing `/api/convert`
6. Put TLS terminator in front (nginx / cloud LB)
7. Health checks: liveness `/health`, readiness `/ready`
8. Roll forward one instance at a time; wait for `/ready` before shifting traffic

---

## Rollback

1. Redeploy previous known-good artifact / image tag
2. Keep the same `OUTPUT_DIR` volume unless the release corrupted cache (see below)
3. Verify `/health` and `/ready`
4. Spot-check one cached convert and one forced refresh convert
5. If budget state is bad, quarantine budget files (below) rather than rolling back code unnecessarily

---

## Cache cleanup

Default cache: `{OUTPUT_DIR}/figma-cache` (or `FIGMA_CACHE_DIR`).

```bash
# List size
du -sh "$OUTPUT_DIR/figma-cache"

# Remove old snapshot dirs (example: older than 14 days) — stop traffic first if unsure
find "$OUTPUT_DIR/figma-cache" -mindepth 1 -maxdepth 1 -type d -mtime +14 ! -name '_budget' -exec rm -rf {} +
```

Do **not** delete `_budget` unless intentionally resetting budget (see below).

After cleanup, `/ready` should still pass; next convert may MISS and refetch.

---

## Recover corrupt cache

Symptoms: convert errors mentioning snapshot JSON parse, missing `metadata.json`, or unexpected MISS loops.

1. Identify bad dir under `FIGMA_CACHE_DIR` (name `{fileKey}__{nodeId}`)
2. Move aside (do not delete until confirmed):

```bash
mv "$FIGMA_CACHE_DIR/<bad-snap>" "$FIGMA_CACHE_DIR/.quarantine-$(date +%s)-<bad-snap>"
```

3. Retry convert (MISS → refetch → new atomic snapshot)
4. If file index under `{fileKey}/index.json` is corrupt, quarantine that file the same way

Atomic writes use temp + rename; partial files named `*.tmp-*` can be deleted safely when the process is stopped.

---

## Recover corrupt budget state

Budget files live under `FIGMA_BUDGET_DIR` (default `{cache}/_budget`).

1. Stop or drain traffic
2. Quarantine the budget directory:

```bash
mv "$FIGMA_BUDGET_DIR" "${FIGMA_BUDGET_DIR}.corrupt-$(date +%s)"
mkdir -p "$FIGMA_BUDGET_DIR"
```

3. Restart process (startup recreates writable budget dir)
4. Counters reset — expect more Allow until steady state rebuilds
5. Confirm `/ready` and a convert that returns a `budget` object

---

## Rotate secrets

| Secret | Steps |
|--------|--------|
| `FIGMA_TOKEN` | Create new PAT in Figma → update env → restart → revoke old PAT |
| OAuth client secret | Rotate in Figma developer settings → update `FIGMA_CLIENT_SECRET` → restart → users re-OAuth |
| `CONVERT_API_KEY` | Generate new key → update env → restart → update clients → retire old key |
| Pasted body tokens | Not stored server-side; advise users to revoke compromised PATs |

Never commit rotated values to git or paste them into tickets/logs.

---

## Health checks

| Endpoint | Meaning | Action on fail |
|----------|---------|----------------|
| `GET /health` | Process up; cache/budget/compiler summarized as ok/degraded | Restart if repeatedly non-ok |
| `GET /ready` | Config + filesystem + budget + cache writable | Do not route traffic until `ready: true` |
| `GET /api/health` | Legacy `{ ok: true }` | Compat only |

Example:

```bash
curl -sS http://127.0.0.1:3001/health
curl -sS http://127.0.0.1:3001/ready
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Process exits immediately | Config / disk / compiler startup fail | Read stderr / `startup_*` logs; fix env or permissions |
| `/ready` 503 | Volume not writable | Fix mount permissions; ensure dirs exist |
| 401 Figma auth | Missing PAT / OAuth / env token | Set `FIGMA_TOKEN` or Connect Figma |
| 429 / budget Deny | Figma or local budget limits | Wait Retry-After; inspect budget dir; consider cache HIT |
| 400 `INVALID_*` | Bad URL / node-id / body | Fix client payload |
| Converts slow / timeout | Upstream Figma or large trees | Raise `REQUEST_TIMEOUT` cautiously; prefer cache |
| Preview 404 | Slug missing under `OUTPUT_DIR` | Re-run convert; check disk space |
| Logs show `***` | Expected redaction | Do not disable masking |

---

## Log levels

Set `LOG_LEVEL` to `DEBUG` | `INFO` | `WARN` | `ERROR`. Production default recommendation: `INFO`.
