# Production Readiness Report

| Field | Value |
|-------|--------|
| **Status** | Evaluation only — **no code changes** |
| **Date** | 2026-07-18 |
| **System** | lovable-extractor Figma convert path (Phases 0–4 product shell + frozen compiler) |

Scoring: **0–10** (10 = production-grade for multi-tenant SaaS). Context: current product is closer to a **local/power-user tool**; scores reflect that gap honestly.

---

## Scorecard

| Category | Score | Summary |
|----------|------:|---------|
| Security | **4** | Tokens in body/env; no tenant isolation; `force` bypass |
| Scalability | **3** | Single-node disk cache; no eviction; budget file races |
| Maintainability | **7** | Clear layers; phase reports; some coupling remains |
| Extensibility | **8** | Planner/Budget/Executor seams are real |
| Performance | **7** | Excellent offline paths; MISS still Figma-bound |
| Reliability | **5** | Good offline/lock story; weak concurrent persistence |
| Observability | **4** | Console logs; no metrics/tracing/alerts |
| Deployment readiness | **4** | Local-dev oriented; OAuth in-memory |
| Rate-limit resilience | **8** | Strong: cache + budget locks + covering reuse |
| Recovery behavior | **7** | Offline under lock; soft Deny; incomplete ops story |
| Testability | **3** | Compiler well-tested; scalability shell almost untested |

**Overall (weighted toward resilience + architecture): ~5.5 / 10** — strong architecture for a single-operator tool; **not** multi-tenant production without the blockers below.

---

## Category detail

### Security — 4/10

**Strengths:** Optional `CONVERT_API_KEY`; PAT/OAuth separation in headers.  

**Weaknesses:** Figma token accepted in request body; OAuth token global in process memory; no audit log of file access; `force=true` weakens budget; cache dirs may hold design IP on disk unencrypted.

### Scalability — 3/10

**Strengths:** Subtree + covering ingest amortize API.  

**Weaknesses:** Local disk only; unbounded cache growth; one Node process; budget JSON not multi-writer safe; no horizontal scale story.

### Maintainability — 7/10

**Strengths:** `server/scalability/*` boundaries; Phase reports; frozen compiler wall.  

**Weaknesses:** `index.js` still large; Planner↔Executor refine dance requires discipline; dual docs history (compiler vs product validation).

### Extensibility — 8/10

**Strengths:** New needs flags, degrade hooks, modes can plug into Planner/Budget without touching IR.  

**Weaknesses:** Plugin path bypasses shell (intentional but divergent).

### Performance — 7/10

**Strengths:** 0-REST HIT/SUBTREE; asset skips when empty.  

**Weaknesses:** Structure fetch can be huge; no streaming; compile cost unchanged.

### Reliability — 5/10

**Strengths:** Atomic snapshot rename; validation gates; 429 lock prevents stampede.  

**Weaknesses:** Bg snapshot errors not surfaced; budget lost-update races; soft limits mis-default to starter.

### Observability — 4/10

**Strengths:** Structured console lines (`cache HIT`, `budget Deny`, covering logs); `budget` + `cache` in API.  

**Weaknesses:** No metrics, no request IDs, no persistent convert audit, UI may ignore `budget`.

### Deployment readiness — 4/10

**Strengths:** Env-based ports/tokens; nodemon scoped.  

**Weaknesses:** Assumes writable `output/`; in-memory OAuth; no health checks for cache/budget; no multi-instance sticky session story.

### Rate-limit resilience — 8/10

**Strengths:** Best part of the system — Exact/Subtree/covering + Budget Deny on lock + Planner skips.  

**Weaknesses:** Soft quota ≠ Figma truth; first MISS still expensive on Starter.

### Recovery behavior — 7/10

**Strengths:** Offline compile under lock; fallback when discover fails.  

**Weaknesses:** No automatic lock clear UI; no repair tool for corrupt snaps; Queue doesn’t wait.

### Testability — 3/10

**Strengths:** Compiler suite extensive (`test:compile`, etc.).  

**Weaknesses:** **Zero** automated tests for Resolver/Planner/Budget/Executor/Snapshot integration; manual checklists only.

---

## Blockers before production (must fix)

| # | Blocker | Why |
|---|---------|-----|
| B1 | **No scalability automated tests** | Regressions will ship silently |
| B2 | **Budget state concurrency** | Lost counters/locks under parallel converts |
| B3 | **Cache eviction policy** | Disk will fill |
| B4 | **Secret handling** | Stop accepting long-lived PAT in body for hosted SaaS; isolate tenants |
| B5 | **Observability minimum** | Request id + metrics for 429/HIT/MISS/Deny |
| B6 | **Multi-instance story** | Shared cache + budget store or sticky single writer |
| B7 | **Plan-tier calibration** | Don’t soft-Deny Pro users as Starter by default without detection |

### Non-blockers (acceptable for private beta / single user)

- Degrade not enforced in Executor  
- No CDN/S3  
- Plugin path separate  
- Content-hash not implemented  

---

## Go / No-Go

| Target | Recommendation |
|--------|----------------|
| Local / single power user | **GO** (with monitoring of disk + Figma plan) |
| Small team beta (one server) | **CONDITIONAL GO** after B1, B3, B5 |
| Multi-tenant SaaS | **NO-GO** until B1–B7 addressed |

---

*End of production readiness evaluation. No code modified.*
