# Architecture Validation Report — Product Scalability System

| Field | Value |
|-------|--------|
| **Status** | Integration validation only — **no code changes** |
| **Date** | 2026-07-18 |
| **Scope** | Product shell: Resolver · Planner · Budget · Executor · Snapshot · `compile()` |
| **Prior report** | Compiler-foundation validation preserved as `ARCHITECTURE_VALIDATION_REPORT_COMPILER_FOUNDATION.md` |
| **Authority** | `FINAL_IMPLEMENTATION_SPEC.md` + Phase 0–4 implementation reports |

---

## Verdict

The **product scalability architecture is integrated and coherent**. Layers call each other in the approved order; the compiler remains a pure sink of `document` + asset maps.  

Gaps are **operational** (tests, multi-process safety, observability), not architectural redesign needs.

---

## 1. Final architecture diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│  Client / POST /api/figma/convert                                │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  server/index.js                                                 │
│  auth · parse URL · response shaping · bg snapshot · compile()   │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  prepareFigmaSources (server/scalability/index.js)               │
│                                                                  │
│   Cache Resolver ──► Planner ──► Budget ──► Executor|offline     │
│   (exact→subtree     (plan+refine)  (Allow…)   (REST only)       │
│    →MISS)                                                        │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Snapshot I/O (figma-snapshot.js)  ·  Figma REST (figma-fetch)   │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  compile()  [FROZEN]  NDG→…→EmitPlan→artifacts                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. End-to-end request flow

```text
1. Validate URL + Figma auth
2. prepareFigmaSources
   a. resolve(fileKey, nodeId, refresh)     → HIT | SUBTREE | MISS
   b. plan({ cacheHit, refresh, nodeId })   → execution plan
   c. authorize(plan, cacheStatus, …)       → Allow|Warn|Queue|Degrade|Deny
   d. If Deny/Queue → return (0 REST)
   e. If offline_compile + hit → fromSnapshot
   f. Else executeMiss(plan) → refine loops → REST as needed
   g. recordUsage on MISS success
3. analyze + reconstructSvg merge (route)
4. compile({ document, imageUrls, imageFillUrls, svgMarkup, … })
5. On MISS: setImmediate(saveSnapshotAtomic covering root)
6. JSON: ok, cache, budget, compiler, previewUrl
```

---

## 3. Execution sequence (MISS, child under page frame)

```text
resolve → MISS
plan → execute_rest, pending_geometry, needs.geometry=true
authorize → Allow (or Warn/Degrade)
executeMiss:
  fetchNode(requested) [geometry]
  refineAfterGeometry → discover
  fetchFileStructure
  refineCoveringFromStructure → coveringId
  fetchNode(covering) [geometry]
  refineAfterCovering → needs.fills/svg/png
  fetch fills/svg/png if needed
  extractSubtree(requested) → compile document
compile()
bg save covering snapshot + file index
```

---

## 4. Responsibilities of every layer

| Layer | Responsibility | Must not |
|-------|----------------|----------|
| **Resolver** | Exact → Subtree → MISS; opaque snap | Call Figma; compile |
| **Planner** | Decide cache/covering/needs; refine | Call Figma |
| **Budget** | Allow/Warn/Queue/Degrade/Deny; locks; counters | Call Figma; fetch |
| **Executor** | Perform planned REST; package sources | Choose covering/assets policy |
| **Snapshot** | Validate/load/save/index/extract | Plan or budget |
| **Compiler** | IR → HTML/CSS/JS | Know Figma/cache |
| **index route** | HTTP, compile call, response, bg save | Own fetch policy |

---

## 5. Every cache path

| Path | Trigger | Outcome |
|------|---------|---------|
| **Exact** | Valid snap at `fileKey+nodeId` | `HIT`, 0 REST, offline document |
| **Subtree** | Exact miss; ancestor snap contains id | `SUBTREE`, 0 REST, extracted doc + filtered assets |
| **MISS** | No cover; or refresh | REST per Planner; save covering snap |
| **Refresh** | `refresh=true` | Bypass Exact/Subtree; treat as MISS/covering |

---

## 6. REST sequence by scenario

| Scenario | Typical `api.figma.com` calls |
|----------|-------------------------------|
| Exact HIT | **0** |
| Subtree HIT | **0** |
| Budget Deny (lock) | **0** |
| MISS self-cover FRAME | nodes(+svg?)(+png?) + fills? ≈ **1–4** |
| MISS child → discover cover | structure + nodes×1–2 + fills? + svg? + png? ≈ **2–5** |
| Refresh | Same as MISS covering path |
| No node-id | file/nodes root frame + assets ≈ **1–4** |

CDN image downloads are **not** Tier calls.

---

## 7. Cache sequence by scenario

| Scenario | Disk read | Disk write |
|----------|-----------|------------|
| Exact HIT | Load exact dir | None |
| Subtree | Scan index/roots; load parent; extract | None |
| MISS success | Miss | Bg atomic covering snap + `index.json` upsert |
| Deny | Probe only | None (unless prior lock file) |
| Refresh MISS | Skip HIT | Overwrite covering snap |

---

## 8. Budget decision examples

| Input | Outcome | Notes |
|-------|---------|-------|
| HIT, pred 0 | **Allow** | Even if 429 lock active |
| SUBTREE, pred 0 | **Allow** | Offline |
| MISS, soft headroom OK | **Allow** / **Warn** | pred ≈ 4/1 |
| MISS, low remaining | **Degrade** | Recommendations only |
| MISS, month soft exhausted | **Deny** | No Executor |
| MISS, minute soft cap | **Queue** | HTTP 503 |
| MISS + active Retry-After lock | **Deny** | No Figma |
| `force=true` soft Deny | **Warn** | Lock Deny not overridden |

---

## 9. Planner decision examples

| Input | Plan highlights |
|-------|-----------------|
| Exact/Subtree HIT | `offline_compile`, all needs false, pred 0 |
| MISS RECTANGLE child | `pending_geometry` → refine → `discover` + structure |
| MISS FRAME URL | refine → `self`, no structure |
| Covering text-only | refineAfterCovering → fills/svg/png false |
| Refresh | `cacheStrategy=refresh`, covering forced |

---

## 10. Performance analysis

| Path | Dominant cost |
|------|----------------|
| HIT / SUBTREE | Disk + `compile()` |
| First covering MISS | Figma latency + large JSON + asset exports |
| Sibling after cover | Offline compile only |
| Structure GET | Full-depth file JSON without geometry — can be large |

Amortization: one covering ingest → N section compiles at ~0 REST.

---

## 11. Complexity analysis

| Area | Complexity | Comment |
|------|------------|---------|
| Orchestration (`prepareFigmaSources`) | Low–Med | Clear linear pipeline |
| Planner refine chain | Med | Three pure stages |
| Executor | Med | Branching for root vs nodeId |
| Snapshot + index | Med | Atomic rename; scan fallback |
| Budget persistence | Low–Med | Single JSON file |
| Compiler | High (frozen) | Out of scope |

Overall product-shell complexity is **appropriate** for the problem; not microservice-heavy.

---

## 12. Failure scenarios

| Failure | System behavior |
|---------|-----------------|
| Figma 429 | Error + `recordRateLimit`; later MISS Deny |
| Figma 401/403 | Route maps to 401 |
| Structure discover fail | Fallback to requested node |
| Snapshot incomplete | Exact/Subtree miss → MISS |
| compile() throw | 500; may have already spent REST |
| Budget state corrupt | `loadState` resets to default |
| Covering extract miss | Falls back to direct document |

---

## 13. Recovery behavior

| Condition | Recovery |
|-----------|----------|
| Rate-limit lock | Wait until `retryAfterUntil`; offline HIT still works |
| Soft Deny | Wait / upgrade plan / move file / `force` (soft only) |
| Bad snapshot | Delete dir or bump compiler version invalidates |
| Partial bg snapshot fail | Logged; convert already returned success |
| Process crash mid-MISS | No snap; counters may miss last write |

---

## 14. Regression checklist

- [ ] Exact HIT → `cache.status=HIT`, `restCalls=0`, `budget.predictedTier1=0`
- [ ] Child under cached cover → `SUBTREE`, `restCalls=0`
- [ ] First Hero on shared Desktop → covering FRAME saved; Pricing later SUBTREE
- [ ] `refresh=true` bypasses HIT
- [ ] Active lock + MISS → Deny, 0 REST
- [ ] Active lock + HIT → Allow offline
- [ ] Text-only cover → skip fills log
- [ ] Plugin `/api/figma/plugin` still compiles (bypasses shell)
- [ ] `npm run test:compile` / `test:artifacts` still green (compiler)

---

## 15. Thread safety review

| Concern | Assessment |
|---------|------------|
| Node single-threaded requests | No true threads; async concurrency exists |
| Budget `loadState`/`saveState` | **Race**: concurrent converts can lose updates (last-write-wins) |
| Snapshot atomic rename | Good for single writer; concurrent saves same key can clobber |
| In-memory OAuth token | Single-process assumption |

**Not thread-safe for multi-writer production** without file locking or external store.

---

## 16. Concurrency review

| Concern | Assessment |
|---------|------------|
| Parallel `/api/figma/convert` | Supported by Express; budget/snap races as above |
| Budget Queue | Does not actually delay — returns 503 immediately |
| Figma rate limits | Shared PAT → shared bucket across concurrent users |
| Bg `setImmediate` snapshot | Can overlap with next request’s Subtree read of incomplete? Validation requires `complete:true` — partial tmp dirs ignored |

---

## 17. Memory usage review

| Risk | Notes |
|------|-------|
| Covering document in memory | Entire frame tree + geometry paths |
| Structure file JSON | Full depth=100 tree |
| Concurrent MISSes | Multiple large trees simultaneously |
| compile() IR | Existing compiler footprint |

Mitigation today: none beyond Node defaults. Acceptable for single-user; watch for large enterprise files.

---

## 18. Cache growth review

| Growth driver | Behavior |
|---------------|----------|
| Per covering root | One dir under `figma-cache/` |
| Assets | Downloaded fills/png per snap |
| Index | Small JSON per fileKey |
| Eviction | **None** |
| Dedup | **None** (URL-hash names; Phase content-hash not built) |

Long-running use → unbounded disk. Operational cleanup required.

---

## 19. Potential production risks

1. Soft budget defaults to **starter** limits → false Deny for Pro until 429 sets plan tier  
2. Budget file races under load  
3. No automated tests for `server/scalability/*`  
4. Snapshot bg failure invisible to client  
5. Shared PAT / single OAuth slot  
6. Structure fetch size on huge files  
7. `force=true` can bypass soft protections  
8. Client may ignore new `budget` field  

---

## 20. Recommended future roadmap (no implementation now)

| Priority | Item |
|----------|------|
| P0 | Automated tests: Resolver/Planner/Budget/Executor integration |
| P0 | File lock or atomic merge for budget state |
| P1 | Surface `budget` in UI; honor Degrade in Planner needs |
| P1 | Cache eviction / size caps |
| P2 | Content-hash assets; Product Modes |
| P2 | Multi-user OAuth identity for budget keys |
| P3 | Object storage / CDN for artifacts |

---

## Integration validation summary

| Subsystem | Integrated? | Evidence |
|-----------|-------------|----------|
| Resolver | Yes | `cache-resolver` → prepare |
| Planner | Yes | plan + refine in executor loop |
| Budget | Yes | gate before Executor; API `budget` |
| Executor | Yes | plan-driven REST |
| Snapshot | Yes | load/subtree/save/index |
| Compiler | Yes | unchanged sink via `compile()` |

**Architecture: COMPLETE for intended local/product-shell scope.**  
**Production: not fully ready** — see `PRODUCTION_READINESS_REPORT.md`.

---

*End of architecture validation. No code modified.*
