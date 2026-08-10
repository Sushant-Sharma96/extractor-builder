# API Budget Manager

| Field | Value |
|-------|--------|
| **Status** | Architecture proposal — not implemented |
| **Date** | 2026-07-18 |
| **Depends on** | `API_ECONOMICS.md`, `REQUEST_PLANNER.md`, `PRODUCT_MODES.md` |

---

## 1. Problem

Figma does **not** document remaining quota headers on success. Products must **estimate** budget from:

- Known plan/seat/tier tables
- Local counters of successful REST calls
- Observed 429 + `Retry-After` + `X-Figma-Plan-Tier` + `X-Figma-Rate-Limit-Type`

Without a Budget Manager, Starter users discover limits as hard failures mid-Generate.

---

## 2. Can remaining quota be estimated?

| Approach | Accuracy | Notes |
|----------|----------|-------|
| Official remaining header | **N/A** | Not documented on Rate Limits page |
| Local counter per (user, app, planTier, endpoint tier) | **Good for soft warnings** | Reset windows: rolling 60s for /min; calendar month for Starter Tier‑1 |
| Infer from 429 | **Hard truth** | Lock until `Retry-After` |
| Assume Pro 10/min blindly | **Dangerous** | File may still be `starter` |

**Operating rule:** Treat local estimates as **advisory**; treat 429 as **authoritative**.

---

## 3. Manager state machine

```text
PlanContext {
  resourcePlanTier: starter|pro|org|enterprise|unknown
  seatClass: low|high|unknown   // from X-Figma-Rate-Limit-Type when seen
  authKind: oauth|pat|plan_token
}

BudgetWindow {
  t1: { used, limit, resetAt }
  t2: { used, limit, resetAt }
  t3: { used, limit, resetAt }
}

authorize(plan: RequestPlan) →
  Allow | AllowWithWarnings | Degrade(plan') | Queue | Deny(upgradeLink?)
```

### Degrade strategies (highest ROI first)

1. Force cache-only / refuse refresh
2. Drop PNG export; keep fills
3. Drop SVG export; keep reconstruct
4. Skip version check
5. Serialize concurrency (paid plans: stay under /min)
6. Queue with ETA from `Retry-After`

---

## 4. Inputs / outputs for UX

| Output | UI use |
|--------|--------|
| `budgetHealth`: green/yellow/red | Badge |
| `estimatedRemainingT1` | “~N Tier‑1 calls left this window” |
| `predictedCost` from Planner | Before Generate confirm |
| `optimizationSuggestions[]` | “Convert page once”, “Disable refresh”, “Move file to Pro” |
| `upgradeLink` | From last 429 |

---

## 5. Enforcement vs Figma

Budget Manager **never** replaces Figma’s leaky bucket. It only:

- Prevents self-inflicted exhaustion
- Shapes concurrency (e.g. max 8 Tier‑1/min on Pro Full)
- Educates users

For multi-tenant SaaS: track budgets **per OAuth user** (official scope), not one global counter.

---

## 6. Recommendation cards

### B1 — Soft counters + hard 429 locks (P0)

| | |
|--|--|
| **Problem** | Blind firing until 429 |
| **Evidence** | No remaining headers; Starter 6/month |
| **Tradeoffs** | Counter drift if process restarts (persist to disk) |
| **API savings** | Prevents wasteful retries |
| **Complexity** | Low–medium |
| **Priority** | **P0** |

### B2 — Pre-flight cost estimate on Generate (P0)

| | |
|--|--|
| **Problem** | Users don’t know a click costs 2–4 Tier‑1 |
| **Evidence** | Cost model |
| **Complexity** | Low (once Planner exists) |
| **Priority** | **P0** |

### B3 — Persist windows across restarts (P1)

| | |
|--|--|
| **Problem** | Counters reset → false green |
| **Complexity** | Low |
| **Priority** | **P1** |
