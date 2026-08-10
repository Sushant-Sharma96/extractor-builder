# Phase 3 Implementation Report — Budget Manager

| Field | Value |
|-------|--------|
| **Status** | Complete — awaiting manual review |
| **Date** | 2026-07-18 |
| **Scope** | Budget Manager **only** |
| **Next** | **STOP** — no further phases until approved |

---

## 1. Files modified

| File | Change |
|------|--------|
| `server/scalability/budget.js` | Full Budget Manager (predict, authorize, locks, usage, API shape) |
| `server/scalability/budget-state.js` | **New** — local JSON persistence + session counters |
| `server/scalability/index.js` | Gate Executor on Deny/Queue; record usage after MISS |
| `server/index.js` | `budget` on success/deny/429 responses; `force` override; record 429 |
| `server/figma-fetch.js` | Attach `retryAfter`, `planTier`, `upgradeLink` on 429 errors (seam for locks) |

## Untouched

- Compiler / contracts / Resolver / covering / Planner intelligence / PNG gates / UI / Modes

---

## 2. Budget decision flow

```text
Resolver → Planner → Budget.authorize() → …
                              │
              ┌───────────────┼───────────────────┐
              ▼               ▼                   ▼
         pred = 0 REST    lock active         soft budget
         (HIT/SUBTREE)    & pred > 0          checks
              │               │                   │
           Allow            Deny              Allow|Warn|
           (offline OK      (no Executor)     Queue|Degrade|
            even if lock)                     Deny
```

- **Deny / Queue** → `prepareFigmaSources` returns without calling Executor (`restCalls: 0`).
- **Allow / Warn / Degrade** → Executor runs; Degrade recommendations are **not** enforced yet.

---

## 3. Counter strategy

Advisory only (not Figma-authoritative):

| Scope | Storage | Tracks |
|-------|---------|--------|
| User (`local`) | `state.json` → `counters.users` | monthly t1/t2 + minute buckets |
| File | `counters.files[fileKey]` | same |
| Workspace (`default`) | `counters.workspaces` | same |
| Session | in-memory `sessionCounters` | process lifetime |

Month/minute keys roll automatically. Soft limits depend on `lastPlanTier` (from 429) or default **starter-like** (6 Tier‑1 / month advisory).

---

## 4. Retry-After persistence

Path: `output/figma-cache/_budget/state.json` (override with `FIGMA_BUDGET_DIR`).

On Figma **429**, convert catch calls `recordRateLimit`:

- Writes locks: `global`, `user:local`, `file:{fileKey}`
- Stores `retryAfterUntil`, `planTier`, `upgradeLink`, `recordedAt`

While `Date.now() < retryAfterUntil` and predicted REST &gt; 0 → **Deny** (no Executor).

Offline HIT/SUBTREE still **Allow** under an active lock (0 REST).

---

## 5. Prediction algorithm (conservative)

| Situation | predictedTier1 | predictedTier2 |
|-----------|---------------:|---------------:|
| Exact HIT | 0 | 0 |
| Subtree HIT | 0 | 0 |
| Covering / normal MISS | **4** | **1** |
| Refresh MISS | **4** | **1** |

Rationale (Phase 2 covering): structure + nodes + svg + png (T1) + fills (T2). Intentionally high so soft Deny protects Starter.

---

## 6. Decision object

```js
{
  outcome: 'Allow'|'Warn'|'Queue'|'Degrade'|'Deny',
  reason,
  predictedTier1,
  predictedTier2,
  remainingEstimate,  // advisory
  retryAfterUntil,    // epoch ms or null
  warnings: [],
  degrade: { preferCache, skipPng, skipSvg, queueRequest } | null,
  predictionReason,
  planTier
}
```

---

## 7. API response changes

Extended (not redesigned):

```json
{
  "ok": true,
  "cache": { "...": "unchanged" },
  "budget": {
    "outcome": "Allow",
    "reason": "exact_hit",
    "predictedTier1": 0,
    "predictedTier2": 0,
    "warnings": [],
    "retryAfter": null,
    "retryAfterUntil": null,
    "estimatedRemaining": {
      "t1Month": 6,
      "t1Minute": 6,
      "t2Minute": 5,
      "planTier": "starter"
    },
    "degrade": null,
    "predictionReason": "exact_hit"
  }
}
```

Budget block responses: HTTP **429** (Deny) or **503** (Queue), `ok: false`, same `budget` object, `cache.restCalls: 0`.

Optional body flag: `force: true` overrides soft Deny/Queue (not active 429 lock).

---

## 8. Manual testing

1. Restart API.
2. **Exact HIT** URL → `budget.predictedTier1 === 0`, `outcome: Allow`, `restCalls: 0`.
3. **Subtree** child URL → same, `predictionReason: subtree_hit`.
4. **MISS** (new file / refresh) with quota → `predictedTier1: 4`, `predictedTier2: 1`, Allow/Warn/Degrade.
5. Simulate lock:

```bash
node -e "require('./server/scalability/budget').recordRateLimit({retryAfterSec:3600,planTier:'starter',fileKey:'TEST'})"
```

Then MISS convert → **Deny**, no Figma. HIT convert → **Allow** offline.
6. Clear locks: delete `output/figma-cache/_budget/state.json` or set `locks: {}`.
7. Real 429 from Figma → error includes `budget`, lock file updated; next MISS Deny.

---

## 9. Edge cases

| Case | Behavior |
|------|----------|
| Lock + HIT/SUBTREE | Allow offline |
| Lock + MISS | Deny, 0 REST |
| Soft monthly exhausted | Deny `insufficient_estimated_tier1` |
| Soft per-minute exhausted | Queue ~60s |
| Low remaining | Degrade recommendations (not enforced) |
| Unknown plan tier | Treat as starter soft limits |
| `force: true` | Soft Deny/Queue → Warn; lock Deny stays |
| Process restart | Session counters reset; disk locks/counters survive |

---

## 10. Rollback strategy

1. Revert `budget.js` to always-Allow stub; remove gate in `index.js` (scalability).
2. Remove `budget` field from API responses in `server/index.js`.
3. Optional: delete `_budget/state.json`.
4. Keep `figma-fetch` 429 header fields (harmless) or revert.

---

## 11. Known limitations

- Soft limits are **estimates**; Pro users default to starter until a 429 sets `lastPlanTier`.
- Usage split t1/t2 from `restCounter.n` is approximate (`n-1` / `1`).
- Degrade does **not** change Executor yet.
- No Product Modes / UI chips.
- No multi-user OAuth identity (userKey fixed `local`).

---

## 12. Future extension points

| Later | Hook |
|-------|------|
| Planner PNG/SVG gates | Honor `decision.degrade` in Executor |
| Product Modes | Pass different soft limits into `authorize` |
| OAuth user id | `userKey` from token subject |
| UI | Render `budget` from convert response |

---

## 13. Why no compiler regression

- Budget runs **before** Executor; on Allow paths, `compile()` inputs are unchanged.
- Offline paths never touch fetch.
- No edits under `compiler/` or `contracts/`.

---

## 14. Performance impact

| Path | Impact |
|------|--------|
| HIT/SUBTREE | Negligible (JSON read of state file) |
| Deny under lock | **Faster** (skips all Figma I/O) |
| MISS Allow | +disk write for counters after success |

---

## Success criteria checklist

| Criterion | Status |
|-----------|--------|
| Exact HIT → pred 0 → Allow | **Met** (smoke) |
| Subtree HIT → pred 0 → Allow | **Met** |
| Covering MISS → predict REST | **Met** (4/1) |
| 429 lock → Deny, no Figma | **Met** |
| Budget independent of Compiler/Executor/Resolver | **Met** (evaluate-only module) |
| No later-phase features | **Met** |

---

## STOP

Phase 3 (Budget Manager) is complete. **Awaiting human approval before any further implementation.**
