# Final Optimization Report — Product Scalability

| Field | Value |
|-------|--------|
| **Status** | Research complete — **no code implemented in this phase** |
| **Date** | 2026-07-18 |
| **Companion docs** | `API_ECONOMICS.md`, `COST_MODEL.md`, `CACHE_ARCHITECTURE.md`, `REQUEST_PLANNER.md`, `IMAGE_STRATEGY.md`, `BUDGET_MANAGER.md`, `PRODUCT_MODES.md`, `SCALABILITY_PLAN.md`, `IMPLEMENTATION_ROADMAP.md` |

---

## Executive verdict

The compiler is done. The product’s growth ceiling is now **Figma API economics + cache granularity**, not IR quality.

On **Starter**, Tier‑1 is effectively **~6 requests/month** for file content/images. Our cold convert spends **~2–4** of those. Exact-only cache makes section browsing suicidal. **Subtree + page cache + Request Planner + Budget Manager** are the production path.

On **Professional+** (file on paid plan, Dev/Full seat), per-minute budgets make interactive use viable **if** you still cache; naive per-section MISS remains wasteful and slow.

---

## Evidence summary

### Official limits (Nov 17, 2025+)

| Tier | Starter (View/Collab; Starter files) | Pro Dev/Full | Org | Ent |
|------|--------------------------------------|--------------|-----|-----|
| 1 (file/nodes/image) | **≤6/month** | 10/min | 15/min | 20/min |
| 2 (fills, …) | ≤5/min | 25/min | 50/min | 100/min |
| 3 (metadata, …) | ≤10/min | 50/min | 100/min | 150/min |

Limits follow **resource plan × seat × auth scope** (OAuth: per-user×plan×app; PAT: per-owner×plan). 429 headers: `Retry-After`, `X-Figma-Plan-Tier`, `X-Figma-Rate-Limit-Type`, `X-Figma-Upgrade-Link`. Remaining quota **not** officially exposed for success responses.

### Our cost (audited)

| Outcome | REST |
|---------|------|
| Exact HIT | **0** |
| Subtree HIT (proposed) | **0** |
| Typical MISS | **2–4** (T1 nodes ± svg ± png + T2 fills) |

### Industry alignment

Cache aggressively (Figma docs; MCP cache forks); download assets (14d/30d URL expiry); batch exports; intermediate CDN for **owned** outputs (Builder.io pattern) — not for Figma origin.

---

## Architecture target (cache + infra only)

```text
UI / Product Modes
       ↓
Request Planner  →  Budget Manager  →  Executor
       ↓
Cache hierarchy: Exact → Subtree → Parent → Page → File → (Workspace assets) → REST
       ↓
Owned asset store (content-hash) → compile() → artifact CDN
```

Compiler pipeline unchanged.

---

## Expected REST savings after subtree cache

| Pattern | Savings |
|---------|---------|
| Child under cached parent | **~100%** of that convert’s REST |
| 20 sections after 1 page ingest | **~95%+** vs naive |
| Starter monthly | Each avoided MISS saves **⅓–½** of monthly Tier‑1 |

---

## Highest ROI optimizations (ranked)

1. **Subtree HIT** — closes proven footgun  
2. **Page/file primary ingest** — commercial multi-section UX  
3. **Request Planner** — never pay for unneeded exports  
4. **Budget Manager + Starter Mode** — stop opaque lockouts  
5. **Content-addressed images** — scale disk + skip re-export  
6. **SVG reconstruct expansion** — Tier‑1 avoidance  
7. **L3 object store + CDN** — multi-user scale  

---

## Risks (challenged assumptions)

| Risk | Mitigation |
|------|------------|
| Subtree serves stale child after edit | Version metadata + explicit refresh |
| Page snapshot huge | Depth limits; lazy asset download |
| Local budget counters lie | Persist; trust 429 |
| “User is on Pro” but file is Starter | Surface `X-Figma-Plan-Tier`; guide file move |
| Shared PAT | Ban for SaaS; prefer OAuth |
| Assuming remaining headers exist | Don’t |

---

# Practical operating guide

### Which Figma plan is sufficient?

| Workload | Minimum viable |
|----------|----------------|
| Personal demos, ≤2 cold converts/month, rest offline | **Starter** *only if* subtree/page cache live |
| Daily design iteration, tens of sections, one team | **Professional** Full/Dev + file **in** Pro team |
| Multi-team libraries, CI bots, 100s of files | **Organization** |
| 1000s of files, webhooks, audit, parallel ingest | **Enterprise** |

### Realistic conversions (order-of-magnitude)

Assume Dev/Full seat and file on that plan; **with page cache**.

| Plan | Cold page ingests / day | Section compiles / day (cached) |
|------|-------------------------|-----------------------------------|
| Starter | **≪1** (budget is monthly ~6 T1) | Unlimited offline after cache |
| Professional | Tens (pace ≤10 T1/min) | Thousands (CPU-bound) |
| Organization | Higher concurrency headroom | Thousands+ |
| Enterprise | Batch ingest hours for 1k files | Effectively unlimited offline |

**Without** page/subtree cache, divide Starter viability by ~20 (sections) — product is not shippable.

### 10 files × 20 sections — efficient workflow

1. Move files into a **paid** team if you need iteration.  
2. **Ingest each page/frame once** (one MISS / page).  
3. Convert all sections **offline** (subtree/page HIT).  
4. Use **refresh** only when design version changes.  
5. Watch Budget Health; stop when yellow on Starter.

Expected REST: **~30 Tier‑1 + ~10 Tier‑2** one-time (page strategy) vs **400–600 Tier‑1** naive.

### When compile once and serve from cache?

- Any repeat of same `fileKey+nodeId`  
- Any descendant of a cached ancestor (after P0.1)  
- Any section of an ingested page (after P1.1)  
- CI preview environments: bake snapshots into artifact store  

### When avoid REST entirely?

- Validated snapshot HIT  
- Subtree/page HIT  
- `refresh=false` and soft TTL OK  
- Budget Manager Deny / Degrade to cache-only  
- Starter Mode default after first success  

### Highest ROI next builds

See `IMPLEMENTATION_ROADMAP.md` P0.1 → P0.5 → P1.1.

### Production-ready at scale means

1. Cache hierarchy beyond exact key  
2. Planner + budget gates  
3. Owned content-addressed assets + CDN for outputs  
4. OAuth per user (no shared PAT)  
5. Page-ingest jobs for enterprise libraries  
6. Plan-aware Product Modes  

Not a bigger compiler.

---

## Document index

| Doc | Question it answers |
|-----|---------------------|
| `API_ECONOMICS.md` | Official limits & enforcement |
| `COST_MODEL.md` | What *we* spend per convert |
| `CACHE_ARCHITECTURE.md` | Smart cache design |
| `REQUEST_PLANNER.md` | When to call Figma at all |
| `IMAGE_STRATEGY.md` | PNG/fills/CDN/SVG |
| `BUDGET_MANAGER.md` | Soft quotas & warnings |
| `PRODUCT_MODES.md` | Starter/Pro/Enterprise policies + UX |
| `SCALABILITY_PLAN.md` | Simulations A–D & infra stages |
| `IMPLEMENTATION_ROADMAP.md` | P0–P3 sequenced work |

---

*End of research phase. No implementation performed.*
