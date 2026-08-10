# LIVE LAUNCH AUDIT — Ship-to-Production

| Field | Value |
|-------|--------|
| **Date** | 2026-07-19 |
| **Scope** | Codebase as it exists today (no proposals, no implementation) |
| **Assumed target** | Single Cloud Run service from existing `Dockerfile` |
| **Method** | Static review of repository files and load paths |

---

## 1. Current request flow

### Figma convert (primary product path)

1. Client UI (`client/src/App.jsx`) `POST`s to `/api/figma/convert` with `{ url, token? }` (legacy path; identical handler also exists at `/api/v1/convert`).
2. Express (`server/index.js`): validate body → resolve Figma auth (body PAT → in-memory OAuth → `FIGMA_TOKEN`) → `prepareFigmaSources()` (Resolver → Planner → Budget → Executor).
3. On Allow: `compile()` (`compiler/compile.js`) emits HTML/CSS/JS via artifacts adapter; response JSON includes `html`, `css`, `previewUrl`, `cache`, `budget`, `requestId`.
4. On MISS: covering snapshot written asynchronously under `OUTPUT_DIR` / `FIGMA_CACHE_DIR`.
5. Preview: browser loads `previewUrl` → Express `express.static` on `OUTPUT_DIR` (`/preview/<slug>/`).
6. Production UI: Express serves `client/dist` and SPA fallback.

### Site (Lovable URL) path

`POST /api/convert` → Puppeteer capture → `build()` (optional gated v2) → optional disk package for `format=dev` preview. Uses Chromium installed via Puppeteer (Dockerfile installs OS libs + `postinstall` Chrome).

### Docker / Cloud Run in this flow

- **`Dockerfile` exists** and is annotated for Cloud Run (`PORT`, `OUTPUT_DIR=/tmp/output`).
- **No `cloudbuild.yaml`, no `gcloud` scripts, and no Cloud Run service config** exist in the repository. `render.yaml` is present for Render.com (not Cloud Run).
- Container entrypoint is `node server/index.js` (`npm start` equivalent). Cloud Run would inject `PORT` (typically `8080`); the server binds `0.0.0.0` and reads `process.env.PORT`.

```text
HTTP → Express → validate/auth → Resolver → Planner → Budget
  → [Deny/Queue → 429/503]
  → [HIT/SUBTREE → snapshot] | [MISS → Figma REST Executor]
  → compile() → JSON (+ /preview static)
```

Claude / Anthropic is **not** on this path (`server/llm-enhance.js` is unwired).

---

## 2. Deployment audit

### Dockerfile (actual)

```text
FROM node:20-slim
… Chromium OS libs …
ENV NODE_ENV=production
ENV OUTPUT_DIR=/tmp/output
COPY package*.json ./
RUN npm install --omit=dev
COPY server ./server
COPY scripts ./scripts
EXPOSE 8080
CMD ["node", "server/index.js"]
```

| Item | Finding |
|------|---------|
| Startup command | `node server/index.js` — matches `package.json` `"start"` |
| `PORT` | Read from env (Cloud Run compatible) |
| Writable output | Forced to `/tmp/output` (Cloud Run ephemeral disk) |
| Puppeteer | OS libs + `postinstall` Chrome install — present |
| **`compiler/`** | **Not copied** — required by `require('../compiler/compile')` and startup validation |
| **`contracts/`** | **Not copied** — required at runtime (e.g. `contracts/suite.json`, IR stage registry) |
| **`client/` / `client/dist`** | **Not copied; no `npm run build`** — UI will not be in the image (`client/dist` is gitignored) |
| DevDependencies | Omitted — Vite unavailable inside image to build UI at runtime |

### Cloud Build / gcloud

| Item | Finding |
|------|---------|
| `cloudbuild.yaml` | **Absent** |
| Deploy scripts / docs invoking `gcloud run` | **Absent** in repo |
| In-repo Cloud Run deploy flow | **Not present** (only Dockerfile comments + Render blueprint) |

Operators can still build/push the image outside the repo, but **the image definition itself is incomplete** (see blockers).

### Environment variables (code-backed)

| Variable | Role | Required for first ship? |
|----------|------|---------------------------|
| `PORT` | Listen port | Injected by Cloud Run |
| `OUTPUT_DIR` | Cache + preview writes | Set in Dockerfile to `/tmp/output` |
| `FIGMA_TOKEN` and/or body PAT | Figma REST | PAT paste works in UI; env token optional if users paste |
| `FIGMA_CLIENT_ID` / `SECRET` / `REDIRECT_URI` | OAuth “Connect Figma” | Optional if PAT paste is acceptable |
| `NODE_ENV` | production in Dockerfile | Set |
| `LOG_LEVEL`, timeouts, cache dirs | Ops tuning | Defaults exist |
| `REQUIRE_API_KEY` / `CONVERT_API_KEY` | Optional gate on `/api/convert` | Default off — not required |
| `ANTHROPIC_*` | Unused on live routes | Not required |

### Health endpoints (implemented)

| Path | Behavior |
|------|----------|
| `GET /health`, `GET /api/v1/health` | `{ status, uptime, cache, budget, compiler }` |
| `GET /ready`, `GET /api/v1/ready` | `{ ready: true }` or 503 details |
| `GET /api/health` | `{ ok: true }` (Render blueprint uses this) |

Startup runs `runStartupValidation()` before listen; failure → `process.exit(1)`.

### Deployment blockers (from this section)

1. Docker image **cannot load the compiler** (missing `compiler/` + `contracts/`).
2. Docker image **does not include a built UI** (missing client build / `client/dist`).
3. No in-repo Cloud Build/gcloud pipeline — not fatal by itself if image is built correctly elsewhere, but today the Dockerfile alone is not shippable.

---

## 3. Runtime blockers

Issues that would stop a real user on a Cloud Run container built **from the current Dockerfile**:

1. **Process fails startup or convert** — `compiler` module missing from image; `startup.js` / `index.js` require `../compiler/compile`.
2. **Compile fingerprint / IR registry reads fail** if somehow past startup — `contracts/` missing from image.
3. **No product UI** — `client/dist` absent; Express falls back to plaintext “Build the client with `npm run build`…”. Users opening the service URL cannot use the stripmine console.
4. **Preview depends on writable `OUTPUT_DIR`** — satisfied by `/tmp/output` on a running instance; lost on instance recycle (degrades cache/preview durability, does not alone prevent a single convert on a warm instance).

Auth: if the user pastes a Figma PAT in the UI, convert does not require `FIGMA_TOKEN` in the environment. OAuth-only users need OAuth env vars (see §4).

---

## 4. Functional blockers

| Issue | Evidence |
|-------|----------|
| Container image omits compiler | `Dockerfile` copies only `server`, `scripts` |
| Container image omits contracts | Same; compiler reads `contracts/suite.json`, registries |
| Container image omits UI | No `COPY client`, no `vite build`; `client/dist` gitignored |
| Frontend ↔ API wiring | **OK in source**: App calls `/api/figma/convert` and `/api/convert`; server implements both |
| Preview route | **OK in source**: `/preview` → `OUTPUT_ROOT`; convert returns `previewUrl` |
| Health/ready | **OK in source** |
| Download/zip UX | UI uses copy + iframe preview only — **not broken**, just no zip endpoint required by current UI |
| OAuth “Connect Figma” on Cloud Run | Needs `FIGMA_REDIRECT_URI` matching the public HTTPS URL; default in code is `http://localhost:${PORT}/…` — **broken for OAuth on Cloud Run unless env is set** |
| Site convert (`/api/convert`) | Depends on Puppeteer Chrome in image — Dockerfile intent supports this **if** postinstall succeeds in build |

Broken routes / missing convert API in source: **not found** for the paths the UI uses.

---

## 5. Production blockers

Must fix before first public Cloud Run deployment:

1. **Fix the Docker image contents** so the running container includes:
   - `compiler/`
   - `contracts/`
   - a production `client/dist` (build step with Vite; multi-stage or CI artifact), served by existing Express static paths
2. **Verify the built image starts**: `GET /ready` → `ready: true`, `GET /health` → `status: ok`, and a smoke `POST /api/figma/convert` with a PAT (or configured `FIGMA_TOKEN`).
3. **Configure Figma auth for the deployment model you ship**:
   - Minimum: document that users paste a PAT **or** set `FIGMA_TOKEN` on the service; **and/or**
   - If “Connect Figma” is advertised in the UI: set `FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET`, and `FIGMA_REDIRECT_URI` to the Cloud Run HTTPS callback URL.

Everything else (Redis, CDN, persistent volume, OpenAPI, telemetry) is **not** required to unblock a single-instance first launch.

---

## 6. Nice-to-have items

Non-essential for first public single Cloud Run deploy:

- Redis / distributed cache / distributed locks  
- CDN  
- Multi-node / horizontal scale  
- Persistent volume for `OUTPUT_DIR` (survives instance recycle; improves HIT rates)  
- OpenAPI / SDK / contract-test CI gate  
- Telemetry / metrics dashboards  
- Product Modes  
- Switching UI to `/api/v1/convert` (legacy path works)  
- Zip download endpoint  
- Wiring Anthropic Claude enhance  
- In-repo `cloudbuild.yaml` / gcloud automation (helpful, not required if image is fixed and deployed manually)  
- `REQUIRE_API_KEY` on `/api/convert`  
- Raising Cloud Run request timeout / memory beyond defaults (tune after smoke tests)

---

## 7. Final verdict

# NOT READY TO SHIP

### Minimum set of changes required to ship

1. **Update the container build** so the image includes `compiler/`, `contracts/`, and a built `client/dist` (the current `Dockerfile` does not).
2. **Smoke-test that image** on Cloud Run (or locally via Docker): `/ready`, `/health`, one Figma convert with PAT or `FIGMA_TOKEN`, confirm UI loads and preview iframe works.
3. **Set Figma auth env for the chosen UX** (`FIGMA_TOKEN` and/or OAuth trio with correct public `FIGMA_REDIRECT_URI`).

No architecture redesign. No Redis/CDN/multi-node. Fix the image + auth config, then re-audit.
