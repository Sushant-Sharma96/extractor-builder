# Branch Summary: `feat/offline-snapshot-cache`

| Field | Value |
|-------|--------|
| **Branch** | `feat/offline-snapshot-cache` |
| **Product** | Lovable Extractor — Figma → HTML/CSS/JS converter |
| **Audience** | Engineers joining this branch / stakeholders reviewing progress |
| **Date** | 2026-07-23 |

---

## 1. Why this branch exists (the beginning)

### The original problem

Early on, every Figma conversion called the **Figma REST API** for geometry, images, and fills.

On the **Free / Starter Figma plan**, Tier‑1 file/node/image reads are extremely limited (on the order of **~6 requests per month**). Even a **small design** burned that quota after only a few converts.

**Symptoms we saw:**

- HTTP **429** (rate limit) after a handful of conversions
- Repeated convert of the **same URL** still hit Figma again
- Section-by-section browsing multiplied cost (each `node-id` = new REST)
- Product felt unusable for real Free-plan users

### What we already had

The **compiler foundation** was largely complete and frozen:

```text
Raw Figma document
  → NDG → Layout / Component / Token / Semantic / Responsive / A11y IRs
  → ResolvedIR → EmitPlan → compile() → HTML/CSS/JS
```

So the bottleneck was **not IR quality**. It was **API economics + lack of a durable offline path**.

### Branch goal

Make repeated (and related) conversions **safe on a Free Figma plan** by:

1. Persisting validated **snapshots** of Figma sources on disk  
2. Serving converts from cache with **0 REST** when possible  
3. Planning and budgeting REST only when a true MISS requires it  
4. Keeping the frozen `compile()` pipeline unchanged as the emitter  

---

## 2. What we set up (and why)

| Setup | Why |
|-------|-----|
| **Disk snapshot cache** (`server/figma-snapshot.js`) | Own a validated copy of document + asset maps so we do not re-fetch Figma for the same design |
| **Atomic save + validation** | Avoid corrupt/partial cache that would cause silent bad previews or forced re-MISS |
| **Cache Resolver** (`server/scalability/cache-resolver.js`) | Single lookup order: Exact → Subtree → MISS |
| **Request Planner** (`server/scalability/planner.js`) | Decide offline compile vs REST; gate SVG/PNG/fills needs; covering strategy |
| **Budget Manager** (`server/scalability/budget.js`) | Soft caps + post-429 lock so we stop hammering Figma after rate limit |
| **Executor** (`server/scalability/executor.js`) | Execute plan only: `fromSnapshot` (0 REST) or `executeMiss` (network) |
| **Covering ingest** (`server/scalability/covering.js`) | Fetch a page/frame container once so child sections can Subtree-HIT later |
| **Orchestration seam** (`prepareFigmaSources`) | Wire Resolver → Planner → Budget → Executor around frozen `compile()` |
| **Public API v1** (`/api/v1/convert`, OpenAPI) | Stable contract while keeping legacy `/api/figma/convert` |
| **Security / config / health** | Validate input, mask secrets, `/health` + `/ready` for ops |
| **Local E2E + live validation** | Prove 0 REST on repeated Exact HIT with a real Figma URL |

---

## 3. What we built on this branch (high level)

### Request path (as implemented)

```text
User POST /api/v1/convert (or /api/figma/convert)
  → validate + Figma auth
  → Resolver (Exact / Subtree / MISS)
  → Planner (offline_compile | execute_rest)
  → Budget (Allow / Warn / Queue / Degrade / Deny)
  → Executor (fromSnapshot | executeMiss)
  → compile()
  → [MISS only] save covering snapshot (async)
  → JSON + /preview/<slug>/
```

### Optimizations that matter most

1. **Exact Cache HIT** — same `fileKey` + `nodeId` → **0 REST** (solved the “convert again burns quota” bug)  
2. **Covering snapshot + Subtree HIT** — one page/frame ingest → many section converts offline  
3. **Asset need-gating + local SVG reconstruct** — fewer REST calls on unavoidable MISS  
4. **Budget Deny after 429 lock** — offline HIT still allowed; MISS blocked until retry window  

### Live validation (runtime evidence)

Same cached Figma URL, `refresh: false`, local API:

| Metric | Result |
|--------|--------|
| Converts | **50** |
| Cache | **50 Exact HIT** |
| Figma REST | **0** |
| HTTP 429 | **0** |
| Budget Deny | **0** |
| Preview | **YES** (all runs) |

**Conclusion:** Repeated conversion of the **same cached URL** no longer consumes Free-plan Figma quota.

---

## 4. Challenges we faced

| Challenge | What happened | How we handled it |
|-----------|---------------|-------------------|
| **Free-plan quota exhaustion** | Few converts → 429 | Snapshot offline path; Exact HIT never calls Figma |
| **Exact-only cache was too narrow** | Parent HIT did not help child `node-id`s | Covering ingest + Subtree extract from ancestor snapshot |
| **MISS still expensive** | Cold path did geometry + SVG + PNG + fills always | Planner `refineAfterCovering` skips unused asset exports |
| **429 storms** | Retries after limit made things worse | Persist rate-limit lock; Budget Deny on MISS; HIT still offline |
| **Soft budget vs real Figma quota** | Advisory `t1Month: 6` can Deny before Figma would | Documented; Budget still useful as guardrail; Free-plan users rely on cache first |
| **Dockerfile / Cloud Run incomplete** | Image missing `compiler/`, client build | Audited as **not ready to ship** container; local path preferred for validation |
| **Vite preview proxy** | `/preview` on `:5173` may fail; works on API `:3001` | Documented for local E2E |
| **Budget Degrade not enforced** | Outcome exists; Executor ignores `skipPng`/`skipSvg` | Noted in architecture review as minor follow-up |
| **Keeping compiler frozen** | Risk of “fixing” emit while optimizing fetch | Scalability shell only; `compile()` ownership unchanged |

---

## 5. Key folders / files on this branch

| Path | Role |
|------|------|
| `compiler/` | Frozen compile pipeline |
| `contracts/` | IR / stage contracts |
| `server/scalability/` | Resolver, Planner, Budget, Executor, covering |
| `server/figma-snapshot.js` | Disk snapshot I/O + subtree extract |
| `server/figma-fetch.js` | Figma REST + `restCounter` + short 429 retry |
| `server/index.js` | Convert handlers + snapshot after MISS |
| `server/api/v1/` | Versioned API envelope |
| `docs/` | Architecture, lifecycle, audits, phase reports |
| `openapi.yaml` | Public API surface |

---

## 6. What “done” means on this branch vs what’s next

### Done (this branch’s core intent)

- Offline Exact HIT path proven in live runs  
- Subtree / covering architecture wired for multi-section reuse  
- Budget + Planner + Executor shell around frozen compiler  
- Docs + live validation of repeated same-URL convert  

### Still open / out of scope for “quota fix”

- Full Cloud Run packaging (Dockerfile completeness)  
- Enforcing Budget `Degrade` asset skips  
- Pixel-perfect live design QA across many real files  
- Redis/CDN or multi-instance shared cache (not required for local Exact HIT)  

---

## 7. One-paragraph summary

We started with a working Figma→HTML compiler that **could not survive Free-plan rate limits** because every convert hit Figma REST. On `feat/offline-snapshot-cache` we built a **snapshot cache + Resolver/Planner/Budget/Executor** shell so repeated and related converts run **offline** when a validated snapshot exists. Live tests showed **50 consecutive Exact HITs with 0 REST and 0×429**, which is why the same cached URL is now safe to convert repeatedly on a Free Figma plan.
