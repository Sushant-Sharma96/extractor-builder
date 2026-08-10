# Phase 1 Implementation Report — Subtree HIT

| Field | Value |
|-------|--------|
| **Status** | Complete — awaiting manual review |
| **Date** | 2026-07-18 |
| **Spec** | `docs/FINAL_IMPLEMENTATION_SPEC.md` §11 Phase 1 + §4 Smart Cache |
| **Next** | **STOP** — do not start Phase 2 until approved |

---

## 1. Files modified

| File | Change |
|------|--------|
| `server/figma-snapshot.js` | Subtree extract, asset filter, file index, metadata `rootNodeId`/`kind`, index upsert on save |
| `server/scalability/cache-resolver.js` | Lookup: Exact → Subtree → MISS; `cacheStatus: 'SUBTREE'` |
| `server/scalability/planner.js` | `offline_compile` for Exact **or** Subtree (`cachePath`) |
| `server/scalability/index.js` | Uses `resolve()`; logs `SUBTREE HIT` |

## Untouched

- `compiler/**`, `contracts/**`
- `server/scalability/executor.js` (still opaque `fromSnapshot` / `executeMiss`)
- `server/scalability/budget.js` (still always Allow)
- Client / UI
- Page ingest, PNG gates, content-hash, Product Modes

---

## 2. New algorithms

| Algorithm | Location | Purpose |
|-----------|----------|---------|
| `findNodeById` | `figma-snapshot.js` | DFS locate node by Figma id |
| `extractSubtree` | `figma-snapshot.js` | Return node + descendants (same shape as REST `/nodes`) |
| `collectNodeIds` / `collectImageRefsFromFigmaNode` | `figma-snapshot.js` | Drive asset filtering |
| `filterAssetsForSubtree` | `figma-snapshot.js` | Narrow fills / png / svg / urlToAbs |
| `materializeSubtreeSnap` | `figma-snapshot.js` | Snap-shaped object for Executor |
| `listValidatedRoots` | `figma-snapshot.js` | Index first, else disk scan of `{fileKey}__*` |
| `loadSubtreeSnapshot` | `figma-snapshot.js` | First covering root that contains `nodeId` |
| `upsertFileIndex` | `figma-snapshot.js` | Maintain per-file `index.json` on save |
| `resolve` | `cache-resolver.js` | Exact → Subtree → MISS |

---

## 3. Cache lookup flow

```text
refresh?
  yes → MISS (refresh_requested) — no subtree
  no  →
    1. loadSnapshot(fileKey, nodeId)     → HIT / exact
    2. else loadSubtreeSnapshot(...)     → SUBTREE
    3. else                              → MISS
```

Orchestration (`prepareFigmaSources`):

```text
resolve() → plan(cacheHit, cachePath) → budget.Allow →
  hit?  executor.fromSnapshot(snap)   // Exact and Subtree identical call
  miss? executor.executeMiss(...)     // unchanged REST path
→ compile() unchanged
```

Executor never branches on Exact vs Subtree.

---

## 4. Subtree extraction algorithm

1. Load covering parent snapshot document `D` (root = previously requested node).
2. DFS: if `node.id === requestedNodeId`, return that node object (includes `children`).
3. That object is the `document` passed to `compile()` — same structural role as `fetchNode`’s `document`.
4. Reject identity case (`D.id === nodeId`) so we do not fake Exact when Exact validation failed.

Proven smoke (local cache): parent `2:2` → child `2:5` → `cacheStatus: 'SUBTREE'`, `document.id === '2:5'`.

---

## 5. Asset filtering logic

From extracted document:

- **imageRefs** — walk fills (`type === 'IMAGE'`, visible) → filter `imageFillsRemote`
- **node ids** — DFS all ids → filter `pngRemote` and `svgFallback`
- **urlToAbs** — keep only URLs still present in filtered remote maps (local bytes under **parent** snapshot dir)

Missing parent assets for a child → compile may lack that image locally; no REST in Phase 1 (same as serving incomplete offline data). Future phases may partial-fetch; not in scope.

---

## 6. Index format

Path: `output/figma-cache/{fileKey}/index.json`

```json
{
  "fileKey": "fYKUEGHAxVkJwn8CwvJCsp",
  "updatedAt": "ISO-8601",
  "roots": [
    {
      "nodeId": "2:2",
      "path": "fYKUEGHAxVkJwn8CwvJCsp__2_2",
      "containsHint": "full-tree",
      "figmaVersion": "…",
      "kind": "exact",
      "updatedAt": "ISO-8601"
    }
  ]
}
```

- Written/updated on successful `saveSnapshotAtomic`.
- Read by `listValidatedRoots`; each root re-validated before use.
- **Fallback:** if no index, scan `CACHE_DIR` for `{fileKey}__*` (supports pre-Phase-1 snapshots).

### Metadata additions (on new saves)

```text
rootNodeId, kind: 'exact'|'page' (default exact), figmaVersion (already present)
```

`schemaVersion` remains **1** so existing snapshots stay valid.

---

## 7. Complexity analysis

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Exact load | O(1) path + validate | Unchanged |
| List roots | O(R) index or O(dirs) scan | R = roots per file (small) |
| Extract | O(N) DFS | N = nodes in covering document |
| Filter assets | O(N + map sizes) | |
| Per convert worst case | O(R × N) | Linear scan until first cover; newest roots first |

No global node→root bitmap (per spec).

---

## 8. Manual verification steps

1. Restart API so nodemon loads changes.
2. Confirm parent exact cache exists, e.g. `output/figma-cache/fYKUEGHAxVkJwn8CwvJCsp__2_2/`.
3. Generate URL with **child** `node-id` (e.g. `2:5` or `2:3`) **without** refresh.
4. Expect API JSON: `cache.status: "SUBTREE"`, `cache.restCalls: 0`.
5. Server log: `[figma] cache SUBTREE HIT`.
6. Preview HTML should match a prior Exact convert of that child (if you have one), or match structure of parent’s child region.
7. `refresh: true` on child → must **MISS** (may 429 on Starter) — subtree must not bypass refresh.
8. Unknown id → `MISS`.
9. Exact parent URL → still `HIT` (not SUBTREE).

Offline smoke (no server):

```bash
node -e "console.log(require('./server/scalability/cache-resolver').resolve({fileKey:'fYKUEGHAxVkJwn8CwvJCsp',nodeId:'2:5',refresh:false}).cacheStatus)"
```

Expect: `SUBTREE`.

---

## 9. Edge cases handled

| Case | Behavior |
|------|----------|
| Refresh | Skip Exact and Subtree → MISS |
| Exact exists | Prefer Exact (`HIT`) over Subtree |
| Pre-Phase-1 cache, no index | Disk scan still finds covering roots |
| Multiple covering roots | Newest `updatedAt` first; first match wins |
| Root equals requested id | Skipped in subtree loop |
| `nodeId` null/empty | No subtree attempt |
| Index entry points at invalid snap | Skipped via `validateSnapshot` |
| Index upsert failure | Logged; snapshot save still succeeds |

---

## 10. Risks

| Risk | Mitigation |
|------|------------|
| Stale parent after Figma edit | Refresh still forces REST; no soft version check in Phase 1 |
| Child needs asset not in parent snap | Offline gap; rare if parent MISS saved full used maps |
| Large covering docs slow DFS | Acceptable for v1; page ingest (Phase 3) reduces root count |
| Underscore node-id decoding | Roots use `metadata.nodeId`, not reverse parsing from path |

---

## 11. Rollback plan

1. Revert `cache-resolver.js` to Exact-only `resolveExact` (or make `resolve` skip subtree).
2. Revert `prepareFigmaSources` to call Exact-only.
3. Optional: leave extract/index helpers unused (harmless) or revert `figma-snapshot.js`.
4. Existing exact snapshots remain valid (`schemaVersion` unchanged).
5. Delete `{fileKey}/index.json` dirs if desired (not required for rollback).

---

## 12. Known limitations

- No page/frame **ingest** policy (still stores whatever node was converted).
- No Budget / cost UI.
- No Planner asset gating.
- Subtree does not write a new exact child snapshot (next Exact HIT still needs prior exact save or repeated subtree).
- Sibling without shared cached ancestor → still MISS.
- No content-hash asset store.

---

## 13. Why REST becomes zero

Subtree HIT path:

1. Never calls `executor.executeMiss`.
2. Never calls `figma-fetch` (`fetchNode` / fills / images).
3. `restCounter.n` stays **0**.
4. `compile()` receives extracted `document` + filtered URL maps + `localByUrl` from parent disk assets.

Same offline property as Exact HIT; difference is document source = extract vs stored exact root.

---

## 14. Future extension points

| Phase | Hook |
|-------|------|
| Phase 2 Budget | `authz` already returned; still unused |
| Phase 3 Page ingest | Set `kind: 'page'` on save; prefer page roots in `listValidatedRoots` |
| Phase 4 Planner gates | Gate inside Executor using `plan.needs` (still unused) |
| Optional | On SUBTREE HIT, optionally `saveSnapshotAtomic` for child Exact (faster next Exact) — **not** done now |

---

## Success criteria checklist

| Criterion | Status |
|-----------|--------|
| Parent snap + child inside → 0 REST | **Met** (smoke + design) |
| `cache.status` indicates Subtree HIT | **`SUBTREE`** |
| Executor unaware Exact vs Subtree | **Met** (`fromSnapshot` only) |
| Document shape = node subtree like Figma `/nodes` | **Met** |
| No Phase 2+ features | **Met** |

---

## STOP

Phase 1 is complete. **Awaiting human approval before any further phase.**
