# Phase 4 Implementation Report — Planner Intelligence

| Field | Value |
|-------|--------|
| **Status** | Complete — awaiting manual review |
| **Date** | 2026-07-18 |
| **Scope** | Planner Intelligence **only** |
| **Next** | **STOP** — no further phases until approved |

---

## 1. Files modified

| File | Change |
|------|--------|
| `server/scalability/planner.js` | Full plan object + `refineAfterGeometry` / `refineCoveringFromStructure` / `refineAfterCovering` |
| `server/scalability/executor.js` | Executes plan flags only; no covering/asset business rules |
| `server/scalability/index.js` | Passes `plan` + `nodeId` into Planner; Executor receives plan |
| `server/scalability/budget.js` | Prefers `plan.prediction` when present |

## Untouched

- Compiler / contracts / Resolver / covering selection helpers (still pure, called by **Planner**)
- Content hash / telemetry / Product Modes / UI
- Budget outcomes / 429 locks (unchanged semantics)

---

## 2. Planner decision flow

```text
plan(cacheHit, refresh, nodeId)
  ├─ HIT exact/subtree → offline_compile, needs all false, pred 0
  ├─ MISS no nodeId   → root_frame, geometry + assets (conservative)
  └─ MISS/refresh     → pending_geometry, geometry=true, assets conservative

Executor: fetch geometry (if needs.geometry)
  → refineAfterGeometry(doc)
       ├─ FRAME|SECTION|CANVAS → coveringStrategy=self, no structure
       └─ else → discover, needs.structure=true

Executor: fetch structure (if needs.structure)
  → refineCoveringFromStructure(tree)
       → coveringNodeId / coveringGeometry flag

Executor: fetch covering geometry (if needs.coveringGeometry)
  → refineAfterCovering(coveringDoc)
       → needs.imageFills / svg / png + id lists

Executor: fetch only flagged assets
  → compile extract (unchanged)
```

Planner never calls Figma. Refines are pure functions on already-fetched JSON.

---

## 3. New plan object

```js
{
  action: 'offline_compile' | 'execute_rest',
  cacheStrategy: 'exact' | 'subtree' | 'miss' | 'refresh',
  coveringStrategy: 'none' | 'pending_geometry' | 'self' | 'discover' | 'root_frame',
  cachePath,
  needs: {
    structure,
    geometry,
    coveringGeometry,
    imageFills,
    svg,
    png
  },
  svgIds: [],
  pngIds: [],
  coveringNodeId,
  coverageType,
  kind,
  requestedNodeId,
  prediction: { t1, t2 },
  estimate: { t1, t2, t3 },  // synced from prediction (Budget)
  reason,
  warnings: []
}
```

---

## 4. Decision rules (deterministic)

| Rule | Result |
|------|--------|
| Exact / Subtree HIT | No REST; all needs false |
| Refresh | `cacheStrategy=refresh`; force covering path (same discover/self rules) |
| Geometry type FRAME/SECTION/CANVAS | `coveringStrategy=self`; skip structure |
| Else | `discover` + structure + optional covering geometry |
| After covering analyze: reconstruct covers all SVG | `needs.svg=false` |
| No IMAGE `imageRef`s in tree | `needs.imageFills=false` |
| No PNG candidate ids | `needs.png=false` |
| No node-id in URL | `root_frame` (existing first-frame fetch) |

Conservative initial MISS flags assume assets needed until `refineAfterCovering`.

---

## 5. Executor simplifications

Removed from Executor:

- Self vs discover branching logic (now Planner refine)
- `selectCoveringFromPath` / path decisions (Planner)
- Implicit “always fetch fills” (now `needs.imageFills`)
- Inline SVG/PNG gating (now `needs.svg` / `needs.png` + id lists)

Executor retains:

- `fetchNode` / `fetchFileStructure` / export helpers
- `executeAssetNeeds(plan, …)` — only if flags true
- `extractSubtree` for compile document
- Snapshot `fetchedMeta` assembly from plan fields

---

## 6. API savings

| Scenario | Savings vs always-fetch assets |
|----------|--------------------------------|
| HIT / SUBTREE | Unchanged (0) |
| Covering with **no** images | **−1 Tier‑2** (skip fills) |
| Vectors fully reconstructed | **−1 Tier‑1** (skip SVG export) when applicable |
| No raster candidates | **−1 Tier‑1** (skip PNG) when applicable |
| Self-cover FRAME | Unchanged vs Phase 2 (no structure call) |

Compiler HTML unchanged when skips apply (nothing to fetch).

---

## 7. Manual tests

1. Restart API.
2. **Subtree HIT** → `plan.action=offline_compile`, `restCalls=0`.
3. **MISS on FRAME URL** → logs `coveringStrategy=self`, no structure fetch.
4. **MISS on child inside Desktop** → `discover` → structure → covering fetch → assets per refine.
5. Design with **text only** (no images) → log `skipping image fills (planner)`.
6. Compare HTML for same node before/after on a known fixture (should match).

Offline:

```bash
node -e "require('./server/scalability/planner').plan({cacheHit:true,cachePath:'exact',refresh:false})"
```

---

## 8. Edge cases

| Case | Behavior |
|------|----------|
| Structure discover throws | Executor fallback to requested node; warnings on plan |
| Covering id == requested | Skip second geometry fetch |
| Refine with empty covering | All asset needs false |
| Budget runs before refine | Still uses conservative initial `prediction` (4/1) — safe |

---

## 9. Rollback strategy

1. Restore Phase‑3 `planner.js` (thin) + Phase‑2-style `executor.js` (decisions inside).
2. Revert `executeMiss({ plan })` call site to old signature.
3. No schema / compiler rollback needed.

---

## 10. Known limitations

- Asset skips only after covering JSON exists (cannot skip fills before geometry).
- Initial Budget prediction still conservative (pre-refine).
- Degrade recommendations from Budget still not applied to Planner needs.
- Double `analyze` on compile subtree vs covering (covering analyze inside refine; compile analyzes extract) — same as prior covering path cost order.

---

## 11. Future extension points

| Later | Hook |
|-------|------|
| Budget Degrade | Merge `authz.degrade` into plan.needs before Executor |
| Content hash | Planner flag `reuseLocalAsset` |
| Product Modes | Stricter/looser initial needs |

---

## 12. Why compiler behavior is unchanged

- `compile()` still receives the **requested** node document (extract) + same asset map shapes.
- Skipped endpoints only when there is nothing to export (empty id/ref sets).
- No `compiler/` or `contracts/` edits.

---

## 13. Performance impact

| Path | Impact |
|------|--------|
| HIT | None |
| MISS with images/vectors needing export | ≈ Phase 2 |
| MISS text-only / reconstruct-only SVG | Fewer REST round-trips; faster |

---

## 14. Planner vs Executor responsibilities

| Concern | Owner |
|---------|--------|
| Cache strategy / offline vs REST | **Planner** |
| Covering self vs discover | **Planner** |
| Which covering node id | **Planner** |
| Whether fills/svg/png run + ids | **Planner** |
| HTTP to Figma | **Executor** |
| Snapshot field packaging | **Executor** |
| Soft quota Allow/Deny | **Budget** (unchanged) |
| IR / HTML emit | **Compiler** (frozen) |

---

## Success criteria checklist

| Criterion | Status |
|-----------|--------|
| Planner is SSOT for execution decisions | **Met** |
| Executor only performs requested actions | **Met** |
| Compiler output intent identical | **Met** (skip only empty work) |
| No later-phase features | **Met** |

---

## STOP

Phase 4 (Planner Intelligence) is complete. **Awaiting human approval before any further implementation.**
