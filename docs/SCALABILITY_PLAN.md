# Commercial Scalability Plan

| Field | Value |
|-------|--------|
| **Status** | Architecture proposal — not implemented |
| **Date** | 2026-07-18 |

---

## 1. Real product simulations

Assumptions (challengeable):

- Avg section MISS = **3 REST** (2× Tier‑1 + 1× Tier‑2) if exact MISS each time
- Page prefetch once = **3 REST**, then 20 sections = **0 REST** with page/subtree cache
- Compile wall time ≈ **0.5–3s** local after HIT; **3–15s** on cold MISS (network dominated)
- Snapshot disk ≈ **0.5–5 MB** per section (JSON + assets); page snap ≈ **5–50 MB**

### Scenario A — 10 files × 20 sections = 200 sections

| Strategy | Tier‑1 REST | Tier‑2 REST | Notes |
|----------|------------:|------------:|-------|
| Naive exact MISS × 200 | **400–600** | **200** | Impossible on Starter; hours of pacing on Pro |
| Page cache × 10 files | **20–30** | **10** | Viable on Pro in minutes |
| File already cached, recompile only | **0** | **0** | Ideal steady state |

| Plan | Feasible? |
|------|-----------|
| Starter | **Only** with near-perfect cache; ~2–3 cold files/month max if each page costs 2–3 T1 |
| Professional | Yes with page cache; naive 200 MISSes needs ~40–60 min of Tier‑1 budget pacing |
| Org / Enterprise | Comfortable with page cache; batch OK |

Disk (page strategy): ~10 × 20 MB ≈ **200 MB** order-of-magnitude.

### Scenario B — 100 files × 20 sections

| Strategy | Tier‑1 | Feasibility |
|----------|-------:|-------------|
| Naive | 4k–6k | Needs Enterprise-class pacing + days |
| Page × 100 | **200–300** | Pro: ~20–30 min pure Tier‑1; Org/Ent faster |
| Steady-state recompile | 0 | Product goal |

Disk: ~2–20 GB depending on imagery.

### Scenario C — 500 files

Page strategy Tier‑1 ≈ **1k–1.5k** one-time ingest.  
Requires **object storage**, job queue, and Org/Enterprise or multi-day Pro ingest.

### Scenario D — Enterprise customer 1000 files

One-time ingest Tier‑1 ≈ **2k–3k** with page strategy.  
At 20/min → theoretical floor ~2–3 hours pure API; real world longer with Tier‑2, exports, backoff.

Architecture: worker fleet + shared L3 cache + per-user OAuth budgets + CDN for outputs.

---

## 2. Infrastructure evolution by user count

| Users | Cache | Compute | API auth | CDN |
|------:|-------|---------|----------|-----|
| **10** | Local disk / single VM | One Node process | OAuth or PAT | Optional |
| **100** | Shared NAS or S3 + Redis index | Small API tier + workers | OAuth per user | Cloudflare/Bunny for artifacts |
| **1000** | S3/R2 content-addressed + Dynamo/Postgres index | Autoscaled workers, rate limiter service | OAuth + plan tokens for bots | Required |
| **10000** | Multi-region object store, partitioned indexes | Regional compile farms | Strict per-tenant budgets | Multi-CDN, image optimizer |

### Local → shared → distributed → cloud

```text
Solo:     L1 memory + L2 disk
Team:     L2 on shared volume OR L3 S3; single Budget Manager
SaaS:     L3 authoritative; L2 edge cache on workers; L4 CDN for HTML/assets
Global:   geo-replicated L3; compile near users; never centralize Figma REST through one PAT
```

**Figma API is not your CDN.** Scale **owned artifacts**; minimize **REST**.

---

## 3. Hidden costs at scale

| Cost | Why it hurts |
|------|----------------|
| Snapshot duplication per nodeId | Disk × N sections |
| Re-download on URL change | Bandwidth |
| Compiler fingerprint miss after tiny bump | CPU |
| Shared PAT in CI | One 429 locks all pipelines |
| Starter files in mixed orgs | Surprise monthly locks |
| Unbounded `refresh` | Turns cache into liability |

---

## 4. Recommendation cards

### S1 — Page-ingest job as primary commercial API

| | |
|--|--|
| **Problem** | Section-oriented UX × REST economics |
| **Evidence** | Simulations A–D |
| **API savings** | ~95%+ vs naive |
| **Complexity** | Medium |
| **Priority** | **P0** |

### S2 — Content-addressed L3 before 100 users

| | |
|--|--|
| **Problem** | Disk explosion |
| **Priority** | **P1** |
