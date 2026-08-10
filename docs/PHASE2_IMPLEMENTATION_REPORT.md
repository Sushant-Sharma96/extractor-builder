# Phase 2 Implementation Report — Page / Frame First Ingest

| Field | Value |
|-------|--------|
| **Status** | Complete — awaiting manual review |
| **Date** | 2026-07-18 |
| **Scope** | Page/Frame-first covering ingest **only** |
| **Next** | **STOP** — do not start Budget Manager or later work until approved |

---

## 1. Files modified

| File | Change |
|------|--------|
| `server/scalability/covering.js` | **New** — path find + covering selection |
| `server/scalability/executor.js` | MISS: discover cover → fetch cover → assets for cover → compile extract |
| `server/figma-fetch.js` | `fetchFileStructure()` — GET file **without** `geometry=paths` |
| `server/figma-snapshot.js` | `coverageType` on metadata + file index |
| `server/index.js` | Snapshot save uses `coveringNodeId` + `coveringDocument` |
| `server/scalability/index.js` | Re-exports `covering` |

## Untouched

- `compiler/**`, `contracts/**`
- Resolver Exact → Subtree → MISS (unchanged)
- Budget (still Allow)
- Planner intelligence / PNG gates / content-hash / UI / Product Modes

---

## 2. Covering container selection algorithm

1. On MISS with `nodeId`:
   - **Fast path:** `GET nodes` for requested id with geometry. If type is `FRAME` | `SECTION` | `CANVAS`, that node **is** the cover (1 geometry fetch).
   - **Else:** `GET file?depth=100` **structure only** (no geometry) → DFS path root→node → `selectCoveringFromPath` → `GET nodes` for covering id with geometry.
2. Run SVG / fills / PNG asset pipeline on the **covering** document (so siblings get assets later).
3. `extractSubtree(covering, requestedNodeId)` → `document` passed to `compile()`.
4. Background snapshot stores **covering** tree under `fileKey__{coveringId}`, not the tiny child.

If structure discovery fails → fall back to requested node only (pre-Phase-2 behavior).

---

## 3. Why FRAME is preferred over PAGE

| Cover | Typical size | Subtree reuse | Risk |
|-------|--------------|---------------|------|
| Innermost FRAME (e.g. Hero only) | Small | Weak — Pricing not inside | Misses success scenario |
| **Top-level FRAME under CANVAS** (Desktop / Landing) | Medium | **Strong** — all sections inside | Best default |
| Full PAGE (CANVAS) | Large | Strongest | May include unrelated frames on same page |
| Full file (DOCUMENT) | Huge | — | **Forbidden** |

Preferring the **page desktop FRAME** (direct child of `CANVAS`) maximizes section reuse while keeping snapshots smaller than an entire PAGE or file.

---

## 4. Fallback order

```text
1. Top-level FRAME under CANVAS (on ancestor path)   → coverageType FRAME, kind page
2. Nearest FRAME (leaf → root, including self)       → FRAME
3. Nearest SECTION                                   → SECTION, kind page
4. PAGE (CANVAS)                                     → PAGE, kind page
5. Node itself                                       → NODE, kind exact
```

Never `DOCUMENT` / full file.

---

## 5. Snapshot format changes

Existing directory layout unchanged. `metadata.json` additions:

| Field | Meaning |
|-------|---------|
| `rootNodeId` | Covering id (same as snap folder nodeId) |
| `kind` | `page` \| `exact` |
| `coverageType` | `FRAME` \| `SECTION` \| `PAGE` \| `NODE` |

`schemaVersion` remains **1** (no mass invalidation).

---

## 6. Index changes

`output/figma-cache/{fileKey}/index.json` root entries now include:

```json
{
  "nodeId": "1:1",
  "path": "{fileKey}__1_1",
  "containsHint": "full-tree",
  "kind": "page",
  "coverageType": "FRAME",
  "figmaVersion": "…",
  "updatedAt": "…"
}
```

Subtree lookup (Phase 1) automatically uses these larger roots.

---

## 7. Cache lookup examples

### Landing page (Desktop `1:1` contains Hero, Pricing, FAQ, …)

| Request | Resolver | REST |
|---------|----------|------|
| Hero (first) | MISS → ingest Desktop FRAME → compile Hero | Structure? + covering nodes + fills (+ svg/png) |
| Pricing | **SUBTREE** from Desktop | **0** |
| FAQ | **SUBTREE** | **0** |
| Footer | **SUBTREE** | **0** |
| Exact Desktop URL later | **HIT** | **0** |

### User selects Desktop FRAME itself

| Request | Behavior |
|---------|----------|
| First | Self-cover fast path (1× nodes geometry) → store Desktop → compile Desktop |

### Pre-Phase-2 tiny Hero-only snap still on disk

| Request | Behavior |
|---------|----------|
| Pricing | May MISS if Pricing ∉ Hero snap; after one Frame-first MISS, Desktop root appears and siblings SUBTREE |

---

## 8. Performance impact

| Aspect | Impact |
|--------|--------|
| First MISS (child inside page frame) | Often **+1** Tier‑1 structure call vs old; covering geometry fetch may be **larger** JSON/time |
| First MISS (selection already FRAME) | Same order as before (1 geometry fetch) |
| Later sibling converts | **Much faster** (disk + compile only) |
| Snapshot size | Larger (full cover + all cover assets) — intentional |
| Compile CPU | Unchanged (still analyzes requested subtree only) |

---

## 9. API savings analysis

Assume landing page, 7 sections, typical MISS ≈ 2–4 REST without cover strategy.

| Strategy | First | Next 6 sections | Total Tier‑1-ish |
|----------|------:|----------------:|-----------------:|
| Old exact-only | 3 | 6×3 = 18 | ~21 |
| Phase 1 subtree only (if parent was Hero) | 3 | 6×3 MISS | ~21 |
| **Frame-first (this phase)** | ~3–5 (structure + cover + fills) | **0** | **~3–5** |

Savings on a 7-section browse: **~75–85%** REST after the first ingest (exact numbers depend on SVG/PNG needs).

Starter monthly Tier‑1: one Frame-first ingest is expensive once; exploring the rest of the page becomes free.

---

## 10. Edge cases

| Case | Handling |
|------|----------|
| Structure GET fails / 429 | Fall back to requested node only |
| Node not found in structure tree | Cover = requested id |
| Extract fails after covering fetch | Compile `direct.document` (same as old child fetch) |
| Multiple top-level frames on a page | Cover = the top-level FRAME **on the ancestor path** (the one containing the selection) — not other artboards |
| No `node-id` in URL | Existing first-frame pick; stored as covering `page` |
| Refresh | Still bypasses cache; re-ingests covering |
| Tiny icon FRAME as only FRAME on path | May store small cover (no top-level frame on path) — rare; SECTION/PAGE fallback may apply |

---

## 11. Manual testing steps

1. Restart API (`npm run dev`).
2. Pick a Figma page where Hero / Pricing share one Desktop FRAME.
3. **First:** Generate Hero URL (child node-id).  
   - Logs: `covering FRAME id=…` and/or `covering fetched`.  
   - After compile: snapshot dir `…__{desktopId}` (not only Hero id).  
   - `metadata.coverageType` = `FRAME`, `kind` = `page`.
4. **Second:** Generate Pricing URL (sibling).  
   - Expect `cache.status: "SUBTREE"`, `restCalls: 0`.
5. Confirm Hero HTML still matches a direct Hero-only expectation (same selection compile).
6. Offline unit check:

```bash
node -e "const c=require('./server/scalability/covering'); /* see report §2 smoke */"
```

(Already verified: Photo under Hero under Desktop → cover `Desktop`.)

---

## 12. Rollback strategy

1. Revert `executor.js` to Phase‑1 MISS (fetch requested node only).
2. Revert `index.js` snapshot payload to save `document` / `nodeId` as requested.
3. Optional: remove `covering.js` / `fetchFileStructure`.
4. Existing covering snapshots remain valid Subtree roots (harmless).
5. No schema bump → no forced cache wipe.

---

## 13. Known limitations

- Structure discovery is a full-depth file JSON **without geometry** — can still be large on huge files (not full-file geometry ingest).
- Does not implement Budget / cost UI / modes.
- Does not write an extra Exact snap for the child on first request (child Exact HIT still relies on Subtree or a later exact save).
- Innermost-only designs with no top-level frame ancestor may cover less than a full landing page.
- Asset export cost on first ingest scales with **covering** size (more PNGs possible).

---

## 14. Future extension points

| Later work | Hook |
|------------|------|
| Budget Manager | Count structure + covering as predicted T1 |
| Planner | Could declare `rest_page_ingest` explicitly (not required now) |
| Prefer SECTION when it wraps the page | Adjust `selectCoveringFromPath` |
| Skip structure when `depth=1` probe enough | Optimization only |
| Cap covering size / warn | Product Mode |

---

## Success criteria checklist

| Criterion | Status |
|-----------|--------|
| Compile only requested node | **Yes** (`extractSubtree`) |
| HTML intent identical for that selection | **Yes** (same compile inputs shape) |
| Store covering for reuse | **Yes** |
| Never full file geometry cache | **Yes** |
| Sibling sections → SUBTREE / 0 REST after first cover | **Yes** (when they share the cover) |
| No Budget / UI / Planner redesign | **Yes** |

---

## STOP

Phase 2 (Page / Frame First Ingest) is complete. **Awaiting human approval before any further implementation.**
