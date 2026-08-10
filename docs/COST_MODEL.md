# Current REST Cost Model

| Field | Value |
|-------|--------|
| **Status** | Audit of live code paths — no redesign |
| **Date** | 2026-07-18 |
| **Code** | `server/index.js` (`/api/figma/convert`), `server/figma-fetch.js`, `server/figma-snapshot.js`, `server/figma-generate.js` (`reconstructSvgMarkup`), `server/figma-build.js` |

---

## 1. Request graph (MISS)

```text
POST /api/figma/convert
        │
        ├─ loadSnapshot(fileKey, nodeId)  ──HIT──► 0 REST → compile
        │
        └─ MISS / refresh
              │
              ├─[T1] GET /v1/files/{key}/nodes?ids={nodeId}&geometry=paths
              │        OR (no nodeId) GET /v1/files/{key}?depth=100&geometry=paths
              │
              ├─ analyze(document)
              ├─ reconstructSvgMarkup(svgNodes)     ← local, 0 REST
              │
              ├─ if missingSvg.length > 0
              │     └─[T1] GET /v1/images/{key}?ids=…&format=svg   (chunks of ≤60)
              │           └─ HTTP GET CDN URLs (not Tier)
              │
              ├─[T2] GET /v1/files/{key}/images                  (whole-file fill map)
              │        └─ filter to used imageRef only (local)
              │
              ├─ if pngIds.length > 0  (nodes needing raster without imageRef)
              │     └─[T1] GET /v1/images/{key}?ids=…&format=png&scale=2
              │           └─ HTTP GET CDN URLs (not Tier)
              │
              ├─ compile(...)                         ← local
              └─ saveSnapshotAtomic (bg)              ← CDN downloads, not Tier
```

Exact cache key today: `fileKey + nodeId` → `output/figma-cache/{fileKey}__{nodeId}/`.

Subtree / parent / page HIT: **not implemented** (see `RFC_SNAPSHOT_CACHE_GRANULARITY.md`).

---

## 2. Call taxonomy

| Call | Function | Endpoint | Official tier | When |
|------|----------|----------|---------------|------|
| Nodes | `fetchNode` | `GET …/nodes` or `GET …/files` | **Tier 1** | Every MISS |
| SVG export | `fetchSvgMarkup` → `exportImages('svg')` | `GET …/images?format=svg` | **Tier 1** | Only if reconstruct fails for some vector ids |
| Image fills | `fetchImageFills` | `GET …/files/{key}/images` | **Tier 2** | Every MISS |
| PNG export | `exportImages('png')` | `GET …/images?format=png` | **Tier 1** | Nodes in `imageNodeIds` without usable IMAGE fill / not SVG |
| CDN bytes | `fetch(url)` | Figma CDN | **0 Tier** | After export/fills; also snapshot save |

Retries: `figmaGet(..., tries=4)` may retry if `Retry-After ≤ 30s`. Each successful response increments `restCounter.n`. Failed long locks throw without counting as success.

---

## 3. Cost by cache outcome

| Outcome | Tier 1 | Tier 2 | Total REST | Notes |
|---------|-------:|-------:|-----------:|-------|
| **Exact HIT** | 0 | 0 | **0** | Validated snapshot + local assets |
| **Subtree HIT** (proposed) | 0 | 0 | **0** | Extract child from parent `document.json` |
| **Warm MISS** (same file, new node, no parent snap) | 2–3 | 1 | **3–4** | Same as cold for REST; CDN may be warm |
| **Cold MISS — minimal card** | 1–2 | 1 | **2–3** | nodes + fills; SVG local; PNG 0–1 |
| **Cold MISS — worst convert path** | 3 | 1 | **4** | nodes + svg export + fills + png (+ extra chunks if >60 ids) |
| **Full-file MISS (no nodeId)** | 1–3 | 1 | **2–4** | `GET file` instead of nodes; larger payload |

### Typical “per convert” (product default: URL with `node-id`)

| Scenario | Expected REST | Starter monthly burn (Tier 1 only) |
|----------|---------------|-------------------------------------|
| Exact HIT | 0 | 0 |
| MISS tiny section (SVG reconstruct OK, 1 fill, 0–1 png) | **2–3** | **33–50% of 6** |
| MISS with SVG export + PNG | **3–4** | **50–67% of 6** |

---

## 4. Per page / per section (model)

Definitions used in simulations (`SCALABILITY_PLAN.md` / final report):

| Unit | Assumed REST if **exact MISS each time** | Assumed REST if **page cached once, sections sliced** |
|------|------------------------------------------|------------------------------------------------------|
| **Section convert** | 2–4 | **0** after page/parent HIT |
| **Page** (20 sections, naive) | 20 × (2–4) = **40–80** | **2–4 once** + 0 × 19 |
| **File** (1 page × 20 sections, naive) | 40–80 | 2–4 |
| **File** (prefetch page root) | 2–4 | 2–4 |

**Hidden cost today:** selecting a different `node-id` under an already-converted parent is always Exact MISS → full Tier‑1 burn again. Proven: cached `2:2` contains `2:5` but convert of `2:5` still MISS (`RFC_SNAPSHOT_CACHE_GRANULARITY.md`).

---

## 5. SVG vs PNG economics (current heuristics)

| Path | REST? | Logic in code |
|------|-------|----------------|
| Reconstruct VECTOR/LINE/… from `geometry=paths` | No | `reconstructSvgMarkup` |
| Export SVG for remaining `svgNodeIds` | Tier 1 | Only missing after reconstruct |
| IMAGE fill via `imageRef` + fills map | Tier 2 once/file tree | Prefer over PNG |
| Rasterize node without `imageRef` | Tier 1 PNG | `imageNodeIds` minus svg nodes |

Challenge: `fetchImageFills` always pulls the **whole-file** map (Tier 2 × 1), then filters locally. For huge libraries this is correct for API count (still 1 call) but heavy on JSON size/latency — not a Tier multiplier.

Challenge: PNG export may duplicate bytes already available via `imageRef` fills for some nodes; planner should prefer fills (`REQUEST_PLANNER.md`).

---

## 6. Compile-time vs REST-time

| Phase | Dominated by | Scales with |
|-------|--------------|-------------|
| REST MISS | Network + Figma render queue | Plan limits |
| Snapshot HIT | Disk I/O + compile | Local CPU |
| Snapshot asset download (bg) | CDN concurrency | Image count (not Tier) |
| `compile()` | Pipeline engines | Node count |

REST savings do **not** always equal wall-clock savings if compile is large — but on Starter, REST is the **hard ceiling**.

---

## 7. Recommendation cards

### C1 — Instrument request planner before more engines

| | |
|--|--|
| **Problem** | Calls are imperative in `convert` |
| **Evidence** | Fixed sequence in `index.js` |
| **Tradeoffs** | One orchestration layer |
| **API savings** | Enables skip of PNG/SVG/fills when cache/subtree supplies them |
| **Perf** | Fewer round-trips |
| **Complexity** | Medium |
| **Priority** | **P0** |

### C2 — Subtree HIT closes the largest bug-shaped hole

| | |
|--|--|
| **Problem** | Exact key only |
| **Evidence** | RFC proof + live 429 on child node |
| **API savings** | **100%** of redundant child MISSes |
| **Perf** | Seconds → ms for cache path |
| **Complexity** | Low–medium |
| **Priority** | **P0** |
