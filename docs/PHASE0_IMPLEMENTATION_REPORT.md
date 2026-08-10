# Phase 0 Implementation Report

| Field | Value |
|-------|--------|
| **Status** | Complete — awaiting manual review |
| **Date** | 2026-07-18 |
| **Spec** | `docs/FINAL_IMPLEMENTATION_SPEC.md` §11 Phase 0 |
| **Next** | **STOP** — do not start Phase 1 until approved |

---

## 1. Files modified

| File | Change |
|------|--------|
| `server/index.js` | `/api/figma/convert` now calls `prepareFigmaSources()`; removed inline HIT/MISS fetch body and local helpers |

## Files added

| File | Role |
|------|------|
| `server/scalability/planner.js` | Thin Request Planner |
| `server/scalability/budget.js` | Thin Budget Manager (always Allow) |
| `server/scalability/cache-resolver.js` | Exact-only cache probe |
| `server/scalability/executor.js` | HIT mapping + MISS REST sequence (moved logic) |
| `server/scalability/index.js` | Barrel + `prepareFigmaSources` orchestration |

## Untouched (by design)

- `compiler/**`, `contracts/**`
- `server/figma-fetch.js`, `server/figma-snapshot.js`, `server/figma-build.js`, `server/figma-generate.js`
- Client / UX
- `/api/figma/plugin`

---

## 2. Every function added

| Module | Function | Responsibility |
|--------|----------|----------------|
| `planner.js` | `plan({ refresh, cacheHit })` | Returns `offline_compile` vs `rest_node` plan object (no network) |
| `budget.js` | `authorize(plan)` | Always `{ outcome: 'Allow', … }` |
| `cache-resolver.js` | `resolveExact({ fileKey, nodeId, refresh })` | Exact `loadSnapshot` / `probeMissReason` only |
| `executor.js` | `fromSnapshot(snap)` | Map snapshot → compile source fields |
| `executor.js` | `executeMiss({…})` | Pre-Phase-0 MISS REST path |
| `executor.js` | `collectUsedImageRefs` | Moved from `index.js` |
| `executor.js` | `filterObjectKeys` | Moved from `index.js` |
| `index.js` (scalability) | `prepareFigmaSources(opts)` | Wire Resolver → Planner → Budget → Executor |

---

## 3. Every function moved

| From | To | Notes |
|------|----|-------|
| `index.js` `collectUsedImageRefs` | `executor.js` | Identical |
| `index.js` `filterObjectKeys` | `executor.js` | Identical |
| Inline HIT branch (`loadSnapshot` + field assign) | `cache-resolver.resolveExact` + `executor.fromSnapshot` | Same fields |
| Inline MISS branch (fetchNode → SVG → fills → PNG) | `executor.executeMiss` | Same order, logs, filters |

Not moved: `compile()`, snapshot save (`saveSnapshotAtomic`), response JSON, OAuth, plugin route.

---

## 4. Execution flow before

```text
POST /api/figma/convert
  → parse URL, auth
  → if !refresh: loadSnapshot(fileKey, nodeId)
  → HIT: use snap fields
  → MISS: fetchNode → analyze → reconstructSvg → maybe fetchSvg
          → fetchImageFills → filter → maybe exportImages png
  → analyze (if needed) → reconstructSvgMarkup merge
  → compile(...)
  → bg saveSnapshotAtomic on MISS
  → JSON response (cache.status HIT|MISS, restCalls, …)
```

---

## 5. Execution flow after

```text
POST /api/figma/convert
  → parse URL, auth
  → prepareFigmaSources(...)
       → cacheResolver.resolveExact   (exact only; same loadSnapshot / probeMissReason)
       → planner.plan                 (HIT→offline_compile, else rest_node)
       → budget.authorize             (always Allow; no branch)
       → HIT:  executor.fromSnapshot
       → MISS: executor.executeMiss   (same REST sequence as before)
  → analyze (if needed) → reconstructSvgMarkup merge
  → compile(...)                      ← unchanged
  → bg saveSnapshotAtomic on MISS     ← unchanged
  → JSON response                     ← same shape
```

**Ordering note:** Spec diagram lists Planner before Cache Resolver. Phase 0 probes cache **first** so Planner can set `cacheHit` identically to today’s branch. Behavior matches the Planner decision tree in the spec (`Exact HIT?` / `refresh?`).

---

## 6. Why there is zero functional regression

- MISS REST calls, order, chunking, filters, and logs are the same code path relocated to `executeMiss`.
- HIT still uses `loadSnapshot` via `resolveExact` and the same field mapping.
- `compile()` inputs (`document`, `imageUrls`, `imageFillUrls`, `svgMarkup`, `fonts`, `localByUrl`, `useCache`) are assembled the same way after prepare.
- Snapshot persistence condition unchanged: `cacheStatus === 'MISS' && fetchedMeta`.
- Response contract unchanged (`cache.status`, `restCalls`, compiler fingerprints, preview URL).
- No compiler / contracts edits.
- Budget never Deny/Degrade; Planner `needs` are **not** used to skip endpoints.

---

## 7. Why runtime behaviour is identical

| Concern | Phase 0 behavior |
|---------|------------------|
| Exact cache key | Still `fileKey+nodeId` via `figma-snapshot` |
| Subtree / page | **Not implemented** |
| PNG/SVG/fills gating | Same as before (length checks inside Executor) |
| Refresh | Still forces MISS + `refresh_requested` |
| API count | Same 2–4 REST on typical MISS; 0 on HIT |
| UX | No client changes |
| Errors / 429 | Still thrown from `figma-fetch`; same status mapping in route |

---

## 8. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Subtle field rename in prepare return | Low | Field names mirror previous locals |
| Future contributor gates on `plan.needs` too early | Med | Comments + this report: Phase 0 needs are informational |
| `prepareFigmaSources` return leaks `plan`/`authz` unused | Low | Harmless extras; not sent to client |
| Require-path / nodemon watch | Low | `server/` already watched |

---

## 9. Known limitations (intentional)

- No subtree lookup  
- No page ingest  
- No budget counters / Deny  
- No cost estimate in API response  
- No UX badges  
- Planner does not refine needs after analyze  
- Organization/Enterprise modes not present  

These are **Phase 1+** per the approved spec.

---

## 10. How to manually test Phase 0

1. Restart API (`npm run dev`) so nodemon loads `server/scalability/`.
2. **HIT path:** Convert a URL whose exact snapshot already exists under `output/figma-cache/{fileKey}__{nodeId}/`.  
   Expect: `cache.status: "HIT"`, `restCalls: 0`, same preview as before.
3. **MISS path (if quota allows):** Convert a new `node-id` or use `refresh: true`.  
   Expect: same REST log sequence (`node fetched` → fills → optional PNG/SVG), then compile; `cache.status: "MISS"`.
4. **Refresh:** `refresh: true` with existing snap → must MISS with reason `refresh_requested` (not serve HIT).
5. **Plugin path:** `/api/figma/plugin` still works (untouched).
6. **Smoke (no Figma):**  
   `node -e "require('./server/scalability')"` loads cleanly.

Do **not** expect API savings or subtree HIT in this phase.

---

## 11. What to verify before Phase 1

- [ ] HIT and MISS still produce valid HTML/preview for a known fixture  
- [ ] `restCalls` on HIT is 0  
- [ ] Snapshot still written after MISS (bg log `SNAPSHOT SAVED`)  
- [ ] No accidental imports from `compiler/` into scalability modules beyond existing convert→compile boundary  
- [ ] Reviewers agree Resolver-before-Planner order is acceptable for Phase 1 subtree work  

---

## 12. Diff summary

```text
server/index.js
  - remove collectUsedImageRefs, filterObjectKeys
  - remove inline HIT/MISS fetch
  - add prepareFigmaSources(...) then same compile/snapshot/response

server/scalability/   (new)
  planner.js
  budget.js
  cache-resolver.js
  executor.js
  index.js            (prepareFigmaSources)
```

Net: architectural seams only; no product behavior change.

---

## 13. Concerns found during implementation

1. **Spec layer order vs data dependency:** Planner needs `cacheHit`, so exact probe must run first. Documented above; Phase 1 should keep this (Resolver probe → Plan → Budget → Execute).
2. **`plan.needs` look “smart” but are unused for gating.** Risk of false confidence in code review — Phase 1 must explicitly start gating in Executor, not assume Phase 0 already did.
3. **`authz` is dead until Phase 2.** Left in the prepare return for the seam; route ignores it.

---

## 14. Improvements before Phase 1 (recommendations only — do not implement yet)

| Suggestion | Why |
|------------|-----|
| Add a tiny unit test: `resolveExact` refresh vs hit vs miss reasons | Locks Phase 0 semantics |
| Keep `executeMiss` as the single place Phase 1 adds subtree short-circuit *before* REST | Clear extension point |
| When adding subtree, extend `cache-resolver` only; do not re-inline into `index.js` | Preserves Phase 0 boundary |
| Do not expand SVG reconstruct or content-hash in Phase 1 | Spec: Phase 1 = subtree HIT |

---

## STOP

Phase 0 is complete. **Awaiting human approval before Phase 1 (Subtree HIT).**
