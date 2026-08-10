# Request Planner

| Field | Value |
|-------|--------|
| **Status** | Architecture proposal — not implemented |
| **Date** | 2026-07-18 |
| **Goal** | Replace imperative REST sequence with a declarative plan that never calls Figma when local data suffices |

---

## 1. Problem

Today `convert` always runs a fixed MISS pipeline:

nodes → optional SVG export → image fills → optional PNG export.

There is no single place that answers: **“Do we already have enough to compile?”**

---

## 2. Planner contract

```text
Input:  { fileKey, nodeId, refresh, auth, productMode, budget }
Output: RequestPlan {
  cachePath: Exact|Subtree|Parent|Page|File|None
  documentSource: local|rest
  needs: { nodes, imageFills, svgExportIds[], pngExportIds[], versionCheck }
  restCalls: PlannedCall[]
  estimatedTier: { t1, t2, t3 }
  warnings: string[]
}
```

**Rule:** If `needs.*` is empty/false → `restCalls = []` → compile offline.

---

## 3. Decision tree

```text
refresh?
  yes → plan REST (still batch; still prefer reconstruct)
  no  → Exact HIT? → needs=none
        else Subtree HIT? → needs=none (filter assets)
        else Parent/Page/File HIT covering node? → needs=none
        else plan minimal REST:
              nodes = true
              analyze locally
              svgExportIds = ids where reconstruct failed
              imageFills = true iff usedRefs not all in workspace asset store
              pngExportIds = ids lacking imageRef AND lacking local bytes
              versionCheck = mode.allows && budget.allows
```

---

## 4. Need flags (semantics)

| Need | REST if true | Skip when |
|------|--------------|-----------|
| `nodes` | Tier 1 GET nodes/file | Any snapshot supplies document subtree |
| `imageFills` | Tier 2 GET fills | All `imageRef` resolved in L0 asset store or snapshot |
| `svgExport` | Tier 1 GET image svg | Reconstruct OK or svg-fallback present |
| `pngExport` | Tier 1 GET image png | imageRef+fill bytes OR prior PNG bytes |
| `versionCheck` | Tier 3 metadata | Starter Mode; or soft-TTL not expired |

---

## 5. Batching & ordering

Official guidance: batch image ids (we already chunk ≤60).

Recommended order after plan approve:

1. Version check (optional, cheap Tier 3) — only if freshness required
2. Nodes (Tier 1) — required for analyze
3. Local reconstruct + need refinement (may clear svg/png needs)
4. Image fills (Tier 2) — if still needed
5. SVG/PNG exports (Tier 1) — last, batched

**Challenge:** fetching fills before knowing used refs is wasteful on latency, not on Tier count (still 1). Planner may analyze after nodes, then decide fills — **current code already does this** for SVG/PNG; keeps fills always-on. Optimization: skip fills entirely when tree has zero IMAGE paints.

---

## 6. Integration points (no compiler redesign)

```text
RequestPlanner.plan()
  → BudgetManager.authorize(plan)   // may downgrade / queue / refuse
  → Executor.execute(plan)          // only planned calls
  → SnapshotWriter
  → compile()
```

---

## 7. Recommendation card

| | |
|--|--|
| **Problem** | Imperative MISS always pays full tax |
| **Evidence** | `index.js` sequence; Cost Model |
| **Tradeoffs** | New module; must preserve behavior on refresh |
| **API savings** | 0–2 Tier‑1 calls/convert when PNG/SVG unnecessary; 100% with cache HIT |
| **Perf** | Lower latency on sparse trees |
| **Complexity** | Medium |
| **Priority** | **P0** (with Budget Manager stub) |
