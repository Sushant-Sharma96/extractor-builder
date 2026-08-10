# FINAL IMPLEMENTATION SPEC

| Field | Value |
|-------|--------|
| **Status** | **SINGLE SOURCE OF TRUTH for implementation** — awaiting human approval |
| **Date** | 2026-07-18 |
| **Scope** | Product scalability only (API · cache · planner · budget · images · modes · UX) |
| **Out of scope** | Compiler IR, NDG→EmitPlan, new emitters, architecture redesign |
| **Precedence** | This document wins for the optimization/implementation phase. Prior research docs (`API_ECONOMICS.md`, `CACHE_ARCHITECTURE.md`, etc.) are **background**. Where they conflict with this spec, **this spec wins**. |
| **Action until approval** | **No code. No project modifications beyond this document.** |

---

## 1. Executive Summary

### What is currently implemented

| Layer | Status |
|-------|--------|
| Compiler pipeline Raw → NDG → … → ResolvedIR → EmitPlan → `compile()` | **Complete / frozen** |
| Product adapter → legacy `figma-build` emit → HTML/CSS/JS | **Working** |
| Figma fetch: nodes, optional SVG export, image fills, optional PNG export | **Working** |
| Exact disk snapshot (`fileKey + nodeId`) with local assets | **Working** |
| SVG reconstruct-first | **Working** |
| REST counter + basic 429 handling (`Retry-After` ≤ 30s retry) | **Partial** |
| Subtree / page cache, Request Planner, Budget Manager, Product Modes | **Not built** |

### What is already good

- Compiler ownership and stage order are correct — do not reopen.
- Convert already goes through `compile()` (no emit-only bypass).
- Exact offline HIT = **0 REST** when `nodeId` matches.
- Reconstruct-before-SVG-export and fill-filter-after-analyze are the right instincts.
- Snapshot downloads owned bytes (correct vs ephemeral Figma CDN URLs).

### What should NEVER change

1. **Compiler stage order and IR contracts** (`contracts/`, `compiler/` engines).
2. **Decision Runtime / Policy / Kernel ownership** as frozen in architecture lock.
3. **Single emit path** via existing product adapter + legacy emitter (no second compiler).
4. **Figma as source adapter only** — fetch supplies `document` + asset maps; compiler does not call Figma.

### Compiler boundaries (hard wall)

```text
ALLOWED to change (this phase):
  server/index.js          — orchestration around convert
  server/figma-fetch.js    — only if Planner/Executor needs cleaner seams
  server/figma-snapshot.js — cache I/O, indexing, subtree extract
  server/figma-generate.js — SVG reconstruct coverage only (optional)
  client UI                — cost/cache/budget surfaces
  NEW modules under server/scalability/ (or equivalent) — planner, budget, cache resolver

FORBIDDEN:
  contracts/** IR schemas / stage ids
  compiler/engines/** semantics
  New EmitPlan / ResolvedIR designs
  Replacing figma-build emit with a parallel HTML compiler
```

### Architecture freeze

**Foundation Freeze v1 remains in force for the compiler.**  
This phase adds a **cache-first product shell** around the frozen compiler. Nothing below `compile({ document, … })` is redesigned.

---

## 2. Root Cause Analysis

### Why we waste API calls

Figma Tier‑1 (`GET nodes` / `GET file` / `GET image`) is scarce on Starter (~**6/month**) and still finite on Pro (**10/min**). One convert MISS costs **~2–4 REST** calls. The product UX (paste URL with arbitrary `node-id`) multiplies that cost because **cache identity is too narrow** and **fetch is imperative**.

### Root causes (ranked)

| ID | Root cause | Severity | Evidence |
|----|------------|----------|----------|
| RC1 | **Exact cache only** (`fileKey+nodeId`) — child of cached parent always MISS | **Critical** | RFC proof: `2:5` inside cached `2:2`; live 429 |
| RC2 | **No page-level ingest** — section browsing = N independent MISSes | **Critical** | Cost model: 20 sections × 2–4 = 40–80 REST |
| RC3 | **No Request Planner** — fixed MISS sequence always pays fills ± SVG ± PNG | **High** | `server/index.js` convert path |
| RC4 | **No Budget Manager** — users discover limits as hard 429 / multi-day lock | **High** | Starter + `Retry-After` hours; no remaining headers |
| RC5 | **PNG export when fills suffice** — burns Tier‑1 | **High** | Official: `GET image` = T1; fills = T2 |
| RC6 | **SVG export residual** — Tier‑1 when reconstruct fails | **Medium** | Current fallback path (correct order; coverage gaps) |
| RC7 | **Refresh / remount / retry culture** — accidental budget burn | **Medium** | Product Mode missing; short 429 retries OK, long locks not |
| RC8 | **URL-hashed asset names** — re-export → duplicate files, weak dedup | **Medium** | `figma-snapshot.js` `hashName(url)` |
| RC9 | **Whole-file fills always fetched on MISS** even if tree has zero IMAGE paints | **Low** | Still 1× Tier‑2; latency only |
| RC10 | **Shared PAT risk** (ops, not code) | **Low** (solo) / **High** (team) | Official PAT sharing |

### What is *not* the root cause

- Compiler IR quality  
- Missing engines below EmitPlan  
- “Need a distributed cache microservice” (premature)  
- CDN for Figma origin (wrong layer)

---

## 3. Final Target Architecture

### Diagram

```text
┌─────────────────────────────────────────────────────────────┐
│  UI (Generate / Refresh / Cache badge / Cost estimate)      │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Product Mode Resolver                                      │
│  (Starter | Professional | Enterprise) from plan signals    │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Request Planner                                            │
│  Declares needs + estimated Tier cost. Never fetches.       │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Budget Manager                                             │
│  Allow | Warn | Degrade | Queue | Deny                      │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Cache Resolver                                             │
│  Exact → Subtree (incl. parent/page documents) → MISS       │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Executor (Figma REST only for authorized needs)            │
│  nodes → analyze → refine needs → fills / svg / png         │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Snapshot Writer                                            │
│  Persist document slice + owned assets + file index         │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  compile()  ← FROZEN BOUNDARY                               │
│  NDG → … → EmitPlan → product adapter → Artifacts           │
└─────────────────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Responsibility | Why it exists |
|-------|----------------|---------------|
| **UI** | Intent + feedback; never raw REST | Users must not manage quotas |
| **Product Mode** | Policy knobs (concurrency, refresh, prefetch) | One codebase, three economics regimes |
| **Request Planner** | Decide *what* is needed | Stops imperative over-fetch |
| **Budget Manager** | Decide *whether* allowed now | Starter survival; polite Pro pacing |
| **Cache Resolver** | Satisfy needs from disk first | Primary API savings lever |
| **Executor** | Perform only authorized REST | Single place for batching/429 |
| **Snapshot Writer** | Make next convert free | Offline product promise |
| **Compiler** | Pure transform `document` → site | Already done; stay out |

### Simplification vs prior research

Prior docs listed Exact → Subtree → Parent → Page → File → Workspace.  
**This spec collapses that:**

- **Parent** is not a separate cache type — it is a **subtree extract** from a larger stored document (page/parent/exact root).
- **File** cache is optional Phase‑2; **Page/frame snapshot** is the primary commercial unit.
- **Workspace asset cache** is deferred (content-hash store can start **per machine / per file index** without a workspace abstraction).

---

## 4. Smart Cache Architecture

### What we build

| Cache | Build? | Role |
|-------|--------|------|
| **Exact** | **Yes** (exists) | HIT when `fileKey+nodeId` snapshot validates |
| **Subtree** | **Yes (P0)** | Extract `nodeId` from any complete snapshot of same `fileKey` whose `document` tree contains that id |
| **Page / frame primary** | **Yes (P1)** | Prefer storing the linked frame/page once; all section converts slice from it |
| **Parent (named tier)** | **No** | Redundant with Subtree |
| **Full-file dump** | **Later / optional** | Only if page strategy insufficient; large payloads |
| **Workspace-wide cache** | **No (v1)** | Premature multi-tenant complexity |
| **Distributed Redis cache** | **No (v1)** | Local disk + index is enough until multi-instance SaaS |

### Lookup order (normative)

```text
1. Exact(fileKey, nodeId)           → if valid, HIT
2. SubtreeSearch(fileKey, nodeId)   → scan file index for covering roots;
                                      DFS extract document by id;
                                      filter asset maps to used refs/ids
3. MISS                             → Planner may propose PageIngest instead of tiny node fetch
                                      when mode says so / user confirms “Compile page”
```

### Indexing

Per `fileKey`, maintain `index.json`:

```text
{
  "roots": [
    { "nodeId": "2:2", "path": "…__2_2", "containsHint": "full-tree", "figmaVersion": "…", "updatedAt": "…" }
  ]
}
```

v1 may use **linear scan of roots + DFS** (N roots small). Do not build a global node→root bitmap until measured pain.

### Snapshot structure (evolve current; do not invent parallel formats)

Keep current directory shape under `output/figma-cache/` (or `FIGMA_CACHE_DIR`):

```text
{fileKey}__{nodeId}/
  metadata.json          # schemaVersion, compilerVersion, complete, figmaVersion?, planTier?
  document.json          # { document, name, fileName, version }
  image-fills.json / .remote.json
  png-ids.json / png-remote.json
  svg-fallback.json
  url-local.json
  assets/fills|png/…
```

**Additions only:**

- `metadata.figmaVersion` (when known)
- `metadata.rootNodeId`, `metadata.kind`: `exact|page`
- file-level `index.json`

### Invalidation & versioning

| Event | Behavior |
|-------|----------|
| `compilerVersion` / `schemaVersion` mismatch | Invalid (existing) |
| Incomplete / missing assets | Invalid (existing) |
| User **Refresh** | Bypass cache; rewrite snapshot |
| Soft freshness | **v1: off by default** on Starter; optional later via Tier‑3 metadata |
| Figma remote URL expiry | Irrelevant if bytes owned — **do not** invalidate solely because remote URL aged |

### Refresh

- Explicit user action only in Starter Mode.
- Professional+: allowed; Budget Manager may warn if cost high.
- Refresh replaces the **covering root** (prefer page root), not every section key.

### Storage

- **v1:** local disk (current).
- **Assets source of truth:** local files referenced by `url-local.json`, keyed increasingly by **content hash** (Phase P1), not ephemeral URL.
- **CDN / S3:** out of v1 scope (see §13 / §14).

---

## 5. Request Planner

### Role

Pure function: inputs → `RequestPlan`. **No network.**

```text
Input:  { url, fileKey, nodeId, refresh, mode, cacheProbe }
Output: {
  cachePath: exact|subtree|none,
  action: offline_compile | rest_node | rest_page_ingest,
  needs: { nodes, imageFills, svgExport, pngExport, versionCheck },
  estimate: { t1, t2, t3 },
  warnings: string[]
}
```

### Decision tree

```text
IF refresh:
  action = rest_page_ingest if mode.preferPage else rest_node
  needs.nodes = true
  (asset needs refined after analyze — see Executor)
ELSE IF Exact HIT:
  action = offline_compile; needs = all false; estimate = 0
ELSE IF Subtree HIT:
  action = offline_compile; needs = all false; estimate = 0
ELSE IF mode.preferPage OR user chose “Compile page”:
  action = rest_page_ingest; needs.nodes = true
ELSE:
  action = rest_node; needs.nodes = true
```

### Per-need rules (after nodes available / on MISS path)

| Need | True when | False when |
|------|-----------|------------|
| `nodes` | action requires REST | cache HIT |
| `imageFills` | tree has ≥1 `imageRef` not in local asset index | no IMAGE paints OR all refs resolved locally |
| `svgExport` | reconstruct failed for some vector ids | all reconstructed or in svg-fallback |
| `pngExport` | node needs raster **and** no usable imageRef/local bytes | fills cover it OR not an image node |
| `versionCheck` | mode allows **and** user asked freshness | Starter default; v1 usually false |
| REST | any need true | offline_compile |

### Batching

- Image export ids: chunks of **≤60** (keep current).
- Never N calls for N images when one batched call works.
- Page ingest: **one** `GET nodes` (or file slice) for the page/frame id, not 30 section calls.

### Fallbacks

1. Reconstruct SVG → else export SVG.  
2. imageRef + fills → else PNG export.  
3. Budget Deny → offer offline from stale cache if present.  
4. Long `Retry-After` → do not spin; surface lock + upgrade/move-file guidance.

### Executor refine step

Planner’s first estimate may say `imageFills/png/svg = unknown`.  
Executor after `analyze(document)` **must re-evaluate** needs before calling those endpoints. This is mandatory to avoid Tier‑1 PNG when fills suffice.

---

## 6. Budget Manager

### Role

Gate `RequestPlan` against estimated windows. **Advisory counters + authoritative 429.**

Figma does not document remaining quota on success → we **estimate**:

- Starter Tier‑1: monthly counter (persist on disk).
- Paid Tier‑1/2/3: rolling 60s token bucket sized to official /min with safety margin (e.g. Pro T1 use **8/min** soft cap, not 10).

### Behavior by plan

| Mode / plan | Soft policy |
|-------------|-------------|
| **Starter** | Aggressive warn at 50% monthly T1; block refresh by default; concurrency **1**; prefer page ingest; Deny when estimate would exceed remaining |
| **Professional** | Token bucket ~8 T1/min; warn on burst; allow refresh with cost chip |
| **Organization** | Same as Pro with higher bucket (~12); no separate codepath required beyond limits table |
| **Enterprise** | Higher bucket (~16); optional queue for batch jobs (Phase P2+) |

Detect resource plan from last `X-Figma-Plan-Tier` (and user override). **File on Starter always uses Starter rules** even if user has Pro elsewhere.

### Outcomes

| Outcome | Meaning |
|---------|---------|
| **Allow** | Execute as planned |
| **Warn** | Execute; show estimate + remaining |
| **Degrade** | Drop PNG export / version check / force page-from-cache |
| **Queue** | Wait for bucket refill (paid); show ETA |
| **Deny** | No REST; explain; offer cache-only if possible |

### 429 handling

| `Retry-After` | Behavior |
|---------------|----------|
| ≤ 30s | Existing short retry OK (Executor) |
| > 30s | **No retry loop**; persist lock until `now+Retry-After`; UI shows wait / upgrade / move file |
| Any | Record `plan-tier`, `rate-limit-type`, `upgrade-link` |

### Warnings UX (copy intent, not pixels)

- “This compile uses ~2 API reads. ~4 left this month on this file’s plan.”
- “You’re rate-limited until … File plan: Starter. Move file to a paid team or wait.”

---

## 7. Image Strategy

### Source of truth (normative)

| Artifact | Source of truth |
|----------|-----------------|
| Design structure | Snapshot `document.json` (from Figma nodes at ingest time) |
| Placed photos | **Owned bytes** under `assets/fills/`, keyed by `imageRef` (+ content hash) |
| Flattened / effect rasters | Owned bytes under `assets/png/` only when fills insufficient |
| Icons / vectors | Prefer reconstructed SVG; else `svg-fallback.json` |
| Ephemeral Figma CDN URLs | **Transport only** — never long-term truth |

### Rules

1. Prefer **`imageRef` + fills (Tier 2)** over **PNG export (Tier 1)**.  
2. Download bytes on ingest; compile uses local paths (`localByUrl` / url-local).  
3. Move naming from URL-hash → **content hash after download** (P1).  
4. Dedup: same hash → one file; multiple logical refs point to it.  
5. CDN / object storage: **not in v1**; when multi-user appears, upload **owned** hashes only.

### SVG

Keep reconstruct-first. Expand coverage opportunistically (P1), never block P0 cache work on perfect SVG parity.

---

## 8. Product Modes

Modes are **policy profiles**, not forks of the compiler.

| Knob | Starter | Professional | Enterprise |
|------|---------|--------------|------------|
| Default action on new URL | Prompt **Compile page** | Compile page | Compile page / batch |
| Subtree lookup | On | On | On |
| Refresh | Confirm + cost | Allowed | Allowed + jobs |
| REST concurrency | 1 | Soft bucket | Soft bucket + queue |
| Version polling | Off | Off (manual) | Optional later |
| Budget UI | Always visible | On warn | Dashboard later |
| PNG export | Last resort | Normal | Normal |

**Organization:** use Professional behavior with Org limit numbers — **do not** ship a fourth mode UI.

Auto-select mode from `X-Figma-Plan-Tier` when known; allow manual override for testing.

---

## 9. User Workflow (commercial)

Users should think “Generate design,” not “Tier‑1 budget.”

### Happy path (new file / new page)

```text
Paste Figma URL
    ↓
Parse fileKey + nodeId
    ↓
Cache Resolver probe (Exact → Subtree)
    ↓
If HIT → Compile offline → Show preview
           badges: Offline · 0 API · Subtree/Exact
    ↓
If MISS → Planner estimate (e.g. “~3 API reads”)
    ↓
UI: [Compile this selection]  [Compile whole page — recommended]
    ↓
Budget Manager Allow/Warn
    ↓
Executor ingest (page preferred)
    ↓
Snapshot Writer + index update
    ↓
compile() → Artifacts
    ↓
Subsequent section URLs → Subtree HIT → Offline
```

### Rebuild / iterate

```text
Change selection (same page) → Offline slice + compile
Design changed → User hits Refresh → one page re-ingest → replace snapshot
```

### Rate limited

```text
429 long Retry-After
    ↓
Stop · show unlock time · upgrade/move-file link
    ↓
If any snapshot exists → still allow Offline compile from cache
```

### Product principles

1. **Page-first, section-cheap.**  
2. **Estimate before spend.**  
3. **Cache badge always visible after first success.**  
4. **Never busy-wait multi-hour locks.**

---

## 10. Real World Examples

Assumptions: typical MISS = **2 T1 + 1 T2** after planner gates; page ingest ≈ same **once**.

### A — 1 page, 30 sections

| Phase | REST | UX |
|-------|------|----|
| First “Compile page” | ~2–3 | One progress wait |
| 30 section Generates | **0** | Instant/offline badges |
| Naive old system | ~60–120 | Starter dies immediately |

### B — 10 pages, 200 sections

| Strategy | Tier‑1 | Notes |
|----------|-------:|-------|
| Page ingest × 10 | ~20–30 | Then 200 offline compiles |
| Exact-only old | ~400–600 | Not viable on Starter; slow on Pro |

### C — 100 files

| | |
|--|--|
| One-time ingest | ~200–300 Tier‑1 if 1 page/file |
| Steady state | 0 REST for recompile |
| UX | Batch “Import library” job (P2); v1 = sequential with budget pacing |

### D — 1000 files

| | |
|--|--|
| Needs | Enterprise/Org limits + queue + disk/object store (P2+) |
| v1 stance | **Out of scope** — architecture ready via page ingest + budget; infra later |
| User experience v1 | Not promised |

### Cache behavior summary

| Event | Cache |
|-------|-------|
| Page ingest | Write page root snapshot + index |
| Section URL | Subtree extract from page root |
| Refresh page | Replace page root; sections inherit |
| Exact section refresh (discouraged) | Optional; prefer page refresh |

---

## 11. Final Implementation Plan

**No code in this document.** Phases below are the only authorized build sequence after approval.

---

### Phase 0 — Foundations (orchestration seams)

| Field | Content |
|-------|---------|
| **Goal** | Extract convert flow into Planner → Budget → Resolver → Executor without behavior change |
| **Files to modify** | `server/index.js` |
| **New modules** | `server/scalability/planner.js`, `budget.js`, `cache-resolver.js`, `executor.js` (thin wrappers initially) |
| **Existing** | `figma-fetch.js`, `figma-snapshot.js` unchanged functionally |
| **Risk** | Regress convert; mitigate with same REST count assertions |
| **Dependencies** | None |
| **Complexity** | Medium |
| **Time** | 1–2 days |
| **API savings** | ~0 (plumbing) |
| **Perf** | Neutral |
| **User impact** | None if done right |

---

### Phase 1 — Subtree HIT (P0 critical)

| Field | Content |
|-------|---------|
| **Goal** | Child `nodeId` served from ancestor snapshot with **0 REST** |
| **Files** | `figma-snapshot.js`, `cache-resolver.js`, `index.js` response `cache.status` |
| **New** | `extractSubtree(document, nodeId)`, file `index.json` update on save |
| **Risk** | Wrong subtree / missing assets — validate id exists; filter fills/png/svg maps |
| **Dependencies** | Phase 0 preferred (can land tightly coupled if needed) |
| **Complexity** | Low–medium |
| **Time** | 1–2 days |
| **API savings** | **~100%** on descendant converts |
| **Perf** | Large (skip network) |
| **User impact** | Section browsing stops burning quota |

---

### Phase 2 — Budget + cost estimate UI (P0)

| Field | Content |
|-------|---------|
| **Goal** | Persist counters; block/warn; show estimate; honor long 429 locks |
| **Files** | `budget.js`, `figma-fetch.js` (lock persistence), `client` Generate UI |
| **Risk** | False Deny — allow override “Force anyway” in Pro |
| **Dependencies** | Phase 0 |
| **Complexity** | Low–medium |
| **Time** | 1–2 days |
| **API savings** | Prevents wasted retries; protects Starter |
| **User impact** | Trust; clear errors |

---

### Phase 3 — Page-first workflow (P0/P1)

| Field | Content |
|-------|---------|
| **Goal** | Default ingest = page/frame covering selection; UI recommends it |
| **Files** | Planner, Executor, client workflow, snapshot `kind:page` |
| **Risk** | Large documents — use selected frame / parent frame, not entire multi-page file |
| **Dependencies** | Phase 1 |
| **Complexity** | Medium |
| **Time** | 2–3 days |
| **API savings** | **~95%** on multi-section pages |
| **User impact** | Feels like a commercial importer |

---

### Phase 4 — Planner asset gates (P1)

| Field | Content |
|-------|---------|
| **Goal** | Skip fills if no IMAGE; skip PNG if imageRef; skip SVG if reconstruct OK (tighten) |
| **Files** | `executor.js`, `index.js` logic move |
| **Risk** | Missing images — keep conservative fallbacks + tests |
| **Dependencies** | Phase 0 |
| **Complexity** | Medium |
| **Time** | 1–2 days |
| **API savings** | 0–2 Tier‑1 per MISS |
| **User impact** | Faster cold compile |

---

### Phase 5 — Product Modes (P1)

| Field | Content |
|-------|---------|
| **Goal** | Starter vs Pro/Enterprise policy switches |
| **Files** | `modes.js`, budget limits table, UI badges |
| **Dependencies** | Phase 2–3 |
| **Complexity** | Low |
| **Time** | 1 day |
| **API savings** | Policy-driven |
| **User impact** | Automatic “smart” behavior |

---

### Phase 6 — Content-hash assets (P1)

| Field | Content |
|-------|---------|
| **Goal** | Dedup owned bytes; stable names across re-export |
| **Files** | `figma-snapshot.js`, package-site naming alignment if needed |
| **Dependencies** | Phase 1 |
| **Complexity** | Medium |
| **Time** | 1–2 days |
| **API savings** | Indirect |
| **User impact** | Smaller disk; fewer broken refresh duplicates |

---

### Phase 7 — Hardening (P2)

| Field | Content |
|-------|---------|
| **Goal** | Telemetry (REST saved), cache status chips, regression tests for subtree/page |
| **Files** | client, tests under existing test scripts |
| **Complexity** | Low–medium |
| **Time** | 1–2 days |
| **API savings** | Measurement |
| **User impact** | Polish |

---

### Explicitly deferred (not in v1 implementation plan)

- S3/R2/CDN  
- Webhooks / version polling  
- Workspace-global asset DB  
- Batch 1000-file ingest service  
- Expanding SVG reconstruct to perfection  
- Organization-specific UI mode  

---

## 12. Risks

| Risk | Why | Mitigation |
|------|-----|------------|
| Stale subtree after Figma edit | Cache serves old JSON | Explicit Refresh; show snapshot age |
| Page ingest too large | Memory/time | Ingest selected frame / parent frame, not whole file |
| Subtree missing assets | Parent snap incomplete | Validate asset presence; partial MISS → fetch fills only if Budget allows |
| Budget false positives | Counter drift / multi-process | Persist locks; “Force” on Pro; trust 429 |
| Planner skips needed PNG | Effects/flattened nodes | Conservative: if no imageRef and node in imageNodeIds → PNG |
| Index scan slow | Many roots | Cap roots per file; prefer single page root |
| Touching compiler by accident | Scope creep | Hard wall in §1; PR checklist |
| User ignores page recommend | Still burns API | Starter Mode default page; warn on selection MISS |
| File still on Starter after Pro upgrade | Surprise 6/month | Surface `X-Figma-Plan-Tier`; help copy to move file |

---

## 13. Things We Should NOT Build

| Idea | Verdict | Why |
|------|---------|-----|
| Separate “Parent cache” product | **Reject** | Subtree covers it |
| Full-file cache as v1 default | **Reject** | Page/frame is enough; files are huge |
| Workspace asset microservice | **Reject v1** | No multi-tenant proof yet |
| Redis / distributed cache | **Reject v1** | Single-node disk works |
| CDN in front of Figma API | **Reject** | Wrong; own the bytes instead |
| Second HTML compiler | **Reject** | Architecture freeze |
| Version polling on Starter | **Reject** | Burns scarce Tier‑3/1 attention |
| Complex queue service for solo app | **Reject v1** | In-process bucket enough |
| Four Product Modes (incl. Org UI) | **Reject** | Org = Pro + numbers |
| Perfect SVG reconstruct project | **Defer** | Cache ROI dominates |
| GraphQL / event bus between planner pieces | **Reject** | Plain functions |
| Background prefetch of all pages unread | **Reject** | Surprise API burn |

---

## 14. Better Ideas (challenge prior research)

Prior research was directionally right but **over-layered**. Corrections:

### 14.1 Collapse the cache taxonomy

**Better:** Two real mechanisms only — **(A) store covering documents**, **(B) extract by node id**.  
Everything else is naming. “Parent/Page/File” are just **different roots** you choose to store.

### 14.2 Page-first UX beats smarter MISS

A brilliant Planner on per-section MISS still loses to **one page ingest**.  
**Product default must change**, not only backend cache.

### 14.3 Budget Manager should stay dumb

Do not invent ML remaining-quota. Persist: counters, locks, plan-tier.  
**Smart enough.**

### 14.4 Skip “Workspace cache” until SaaS

Content-hash **local** dedup gives 80% of the value with 20% of the complexity.

### 14.5 Prefer frame over page when page is a junk drawer

Many Figma “pages” contain dozens of unrelated frames.  
**Better ingest target:** nearest `FRAME` / `SECTION` ancestor of selection (or explicit user pick), not always `CANVAS`.

### 14.6 Optional: metadata-only freshness later

Tier‑3 `GET file metadata` is cheap on paid plans — **not** Starter-critical. Defer.

### 14.7 If we must cut scope further

**Minimum shippable optimization:** Phase 1 Subtree HIT alone.  
That single change fixes the proven footgun and buys time. Page-first is the commercial unlock next.

---

## 15. FINAL VERDICT

Only features that should actually be built:

| Feature | Implement? | Priority | Expected ROI | Risk | Complexity | Reason |
|---------|------------|----------|--------------|------|------------|--------|
| Subtree extract HIT + file index | **Yes** | **P0** | Extreme | Low | Low–Med | Fixes proven API waste |
| Page/frame-first ingest + UX | **Yes** | **P0** | Extreme | Med | Med | Commercial multi-section model |
| Thin Request Planner + Executor refine | **Yes** | **P0** | High | Low | Med | Stops blind PNG/SVG/fills |
| Budget Manager (counters, locks, warn/deny) | **Yes** | **P0** | High | Low | Low–Med | Starter survival + trust |
| Product Modes (Starter / Pro / Ent policies) | **Yes** | **P1** | High | Low | Low | Auto economics |
| Cost / cache / offline UI badges | **Yes** | **P1** | Med–High | Low | Low | Users stop fighting API |
| Gate PNG behind fills; skip empty fills | **Yes** | **P1** | High | Low | Low | Tier‑1 savings |
| Content-hash owned assets | **Yes** | **P1** | Med | Low | Med | Dedup + stability |
| Long Retry-After lock persistence | **Yes** | **P0** | Med | Low | Low | Stop useless retries |
| Orchestration module seams | **Yes** | **P0** | Enabler | Med | Med | Keep convert maintainable |
| Named Parent cache layer | **No** | — | — | — | — | Redundant with subtree |
| Full-file cache default | **No** | — | — | — | — | Too heavy for v1 |
| Workspace / Redis / CDN / S3 | **No (v1)** | — | — | — | — | Premature |
| Version polling / webhooks | **No (v1)** | — | — | — | — | Low ROI now |
| Org-specific product mode UI | **No** | — | — | — | — | Use Pro + limits |
| Compiler / IR changes | **No** | — | — | — | — | **Frozen** |
| Second emitter | **No** | — | — | — | — | **Frozen** |
| Perfect SVG reconstruct program | **No (v1)** | — | — | — | — | Defer |
| 1000-file batch platform | **No (v1)** | — | — | — | — | After page+budget proven |

---

## Approval gate

Implementation starts only after explicit human approval of this document.

**Suggested first merge after approval:** Phase 1 (Subtree HIT), even if Phases 0/2 follow immediately in the same sprint.

**Success metric:**  
Converting a child node under a previously compiled parent/page performs **0** `api.figma.com` calls and reports `cache.status = subtree|exact`.

---

*End of FINAL IMPLEMENTATION SPEC.*
