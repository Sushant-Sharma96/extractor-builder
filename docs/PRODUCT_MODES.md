# Product Modes

| Field | Value |
|-------|--------|
| **Status** | Architecture proposal — not implemented |
| **Date** | 2026-07-18 |

Modes adapt **infrastructure policy** to Figma plan economics. They do **not** change compiler IR stages.

Detection: `X-Figma-Plan-Tier` (on 429 or probe) + user setting override + file location hints.

---

## 1. Mode matrix

| Capability | Starter Mode | Professional Mode | Enterprise Mode |
|------------|--------------|-------------------|-----------------|
| Exact cache | **Required** | On | On |
| Subtree / parent / page cache | **Required** | On | On |
| Request Planner | **Strict** | On | On |
| Auto refresh / version poll | **Off** | Manual / rare | Webhook + optional poll |
| Parallel REST | **1** in flight | Up to ~6–8/min Tier‑1 headroom | Up to ~12–15 with pacing |
| Prefetch page root | Prompt once | Default on multi-section | Default + batch jobs |
| Offline compile after HIT | Default | Default | Default |
| PNG export | Last resort | Allowed | Allowed |
| SVG export | Last resort | Allowed | Allowed |
| Budget warnings | Aggressive | Normal | Ops dashboards |
| Shared object store | Optional | Recommended | Required at scale |

---

## 2. Starter Mode (commercial survival)

**Goal:** Maximize conversions per ~6 Tier‑1/month.

Policies:

- Refuse `refresh` unless user confirms “costs API”
- Prefer page/file fetch once → all sections offline
- Subtree HIT mandatory
- Concurrency = 1
- Show predicted cost before every MISS
- Suggest moving file to paid team when `plan-tier: starter` and usage > 50%

Realistic throughput (see final report): on the order of **1–3 cold MISSes/month** if each costs 2–3 Tier‑1 — unless cache absorbs the rest.

---

## 3. Professional Mode

**Goal:** Interactive Explore UX under **10 Tier‑1/min** (Dev/Full, file on Pro).

Policies:

- Allow light parallelism with token bucket (e.g. 8/min)
- Prefetch page when user opens file
- Soft version check at most once per session hour
- CDN optional

Rough capacity: **hundreds of section compiles/day** if page-cached; **tens of cold file fetches/hour** if naive.

---

## 4. Enterprise Mode

**Goal:** Org-scale batch + multi-user.

Policies:

- Plan tokens or OAuth per user (never one shared PAT for CI + humans)
- Distributed cache (L3 object store)
- Webhook invalidation
- Queue workers with global rate limiter per plan
- Audit logs of REST spend per team

Capacity: limited more by **workers and disk** than by 20/min Tier‑1 if caching is competent.

---

## 5. UX surfaces (Part 10 — condensed)

Expose in product UI:

| Widget | Data source |
|--------|-------------|
| Estimated API Cost | Planner `estimatedTier` |
| Cache Status | Exact / Subtree / Parent / Page / MISS |
| REST Saved | Counter vs baseline naive cost |
| Offline Compile | HIT && restCalls=0 |
| Predicted Requests | PlannedCall[] |
| Estimated Compile Time | p50 from local telemetry |
| Budget Health | Budget Manager |
| Optimization Suggestions | Rules engine (“compile page once”) |

---

## 6. Recommendation card

| | |
|--|--|
| **Problem** | One policy for all plans burns Starter and underuses Enterprise |
| **Evidence** | Economics tables |
| **Tradeoffs** | Mode detection edge cases |
| **API savings** | Starter: existential; Pro+: smoother UX |
| **Complexity** | Medium |
| **Priority** | **P0** (Starter policies); **P1** (full matrix) |
