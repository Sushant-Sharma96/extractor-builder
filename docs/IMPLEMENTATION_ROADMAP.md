# Implementation Roadmap (Optimization Phase)

| Field | Value |
|-------|--------|
| **Status** | Roadmap only — **do not implement in this phase** |
| **Date** | 2026-07-18 |
| **Constraint** | No compiler architecture redesign |

Each item: Problem · Evidence · Tradeoffs · API savings · Perf · Complexity · Priority · ROI.

---

## P0 — Survive Starter / unlock paid UX

### P0.1 Subtree snapshot HIT

| | |
|--|--|
| **Problem** | Child `nodeId` MISS despite parent cache |
| **Evidence** | `RFC_SNAPSHOT_CACHE_GRANULARITY.md`; live 429 |
| **Tradeoffs** | Need fileKey index of snapshots |
| **API savings** | **100%** of descendant MISSes |
| **Perf** | High |
| **Complexity** | Low–medium |
| **ROI** | **Highest** |

### P0.2 Request Planner (minimal)

| | |
|--|--|
| **Problem** | Imperative full MISS tax |
| **Evidence** | `COST_MODEL.md` |
| **Tradeoffs** | Refactor convert orchestration only |
| **API savings** | Skip empty PNG/SVG/fills |
| **Perf** | Medium |
| **Complexity** | Medium |
| **ROI** | Very high |

### P0.3 Budget Manager stub + UI cost estimate

| | |
|--|--|
| **Problem** | Users hit opaque 429 |
| **Evidence** | No remaining headers; Starter 6/month |
| **Tradeoffs** | Estimate drift |
| **API savings** | Prevents suicide retries |
| **Complexity** | Low–medium |
| **ROI** | High (trust + retention) |

### P0.4 Starter Mode policies

| | |
|--|--|
| **Problem** | Refresh + concurrency burn monthly budget |
| **Evidence** | `PRODUCT_MODES.md` |
| **Tradeoffs** | Stricter UX |
| **API savings** | Large on free tier |
| **Complexity** | Low |
| **ROI** | High |

### P0.5 Prefer fills; gate PNG; persist long Retry-After locks

| | |
|--|--|
| **Problem** | Extra Tier‑1 + useless retries |
| **Evidence** | Official tiers; `figma-fetch.js` |
| **Complexity** | Low |
| **ROI** | High |

---

## P1 — Multi-section product economics

### P1.1 Page / file primary snapshot

| | |
|--|--|
| **Problem** | Sibling sections still MISS |
| **Evidence** | Simulation A/B |
| **API savings** | **~95%** on 20-section pages |
| **Complexity** | Medium |
| **ROI** | Extremely high |

### P1.2 Content-addressed asset store

| | |
|--|--|
| **Problem** | URL-hash churn; duplicates |
| **Evidence** | `IMAGE_STRATEGY.md` |
| **API savings** | Indirect (skip re-export) |
| **Complexity** | Medium |
| **ROI** | High at volume |

### P1.3 Expand SVG reconstruct coverage

| | |
|--|--|
| **Problem** | Residual SVG exports |
| **Evidence** | Current fallback path |
| **API savings** | Up to 1 Tier‑1 / convert |
| **Complexity** | Medium |
| **ROI** | Medium–high |

### P1.4 Persist budget windows; Professional Mode token bucket

| | |
|--|--|
| **Complexity** | Medium |
| **ROI** | Medium–high |

### P1.5 UX: Cache Status / REST Saved / Offline badge

| | |
|--|--|
| **Complexity** | Low |
| **ROI** | Medium (conversion education) |

---

## P2 — Team / early SaaS

### P2.1 S3/R2 L3 + CDN for outputs

### P2.2 Version-aware soft freshness (Tier‑3 meta)

### P2.3 OAuth-per-user enforcement in Budget Manager

### P2.4 Background page-ingest jobs

### P2.5 Artifact fingerprint short-circuit (skip re-emit)

| ROI | Medium; more CPU than API |

---

## P3 — Enterprise scale

### P3.1 Webhook invalidation

### P3.2 Multi-region compile + partitioned cache index

### P3.3 Org admin API spend dashboards

### P3.4 Plan access tokens for CI bots (isolated budgets)

### P3.5 Image optimization pipeline (webp/avif) on owned CDN

| ROI | Ops / margin; not Tier savings |

---

## Suggested sequence (practical)

```text
Week 1–2:  P0.1 subtree → P0.5 PNG gate → P0.3 budget stub → P0.4 Starter Mode
Week 3–4:  P0.2 Planner → P1.1 page snapshot → P1.5 UX badges
Month 2:   P1.2 assets → P1.3 SVG → P1.4 Pro pacing
Month 3+:  P2 object store → jobs → P3 enterprise
```

---

## Explicit non-goals (this phase)

- Redesigning NDG → EmitPlan
- Second HTML emitter
- Replacing Figma REST with Plugin API as primary (optional future research only)
