# Smart Cache Architecture

| Field | Value |
|-------|--------|
| **Status** | Product architecture proposal — not implemented |
| **Date** | 2026-07-18 |
| **Related** | `RFC_SNAPSHOT_CACHE_GRANULARITY.md`, `COST_MODEL.md`, Figma-Context-MCP cache designs |

---

## 1. Problem

Exact cache (`fileKey + nodeId`) is correct but **economically hostile**:

- Parent HIT does not serve child requests.
- Section-by-section UX multiplies Tier‑1 spend.
- Starter’s ~6 Tier‑1/month dies after a few clicks.

Compiler architecture is complete. Cache is now the product bottleneck.

---

## 2. Evidence from industry & peers

| Source | Pattern |
|--------|---------|
| Figma Rate Limits docs | “Cache results… refresh on explicit user action or periodic basis” |
| [Figma-Context-MCP cache](https://github.com/1yhy/Figma-Context-MCP/blob/main/docs/en/cache-architecture.md) | L1 memory LRU + L2 disk; version-aware keys; separate node vs image strategies |
| [figma-mcp-cached](https://github.com/Pactortester/figma-mcp-cached) | Persistent local cache + TTL + `forceRefresh` + prepare-file tool |
| Builder.io CDN guide | Intermediate cache; stale-while-revalidate; avoid cache-bust on hot path |
| Figma file endpoints | Export URLs expire (14d fills / 30d images) → **bytes must be owned** |

---

## 3. Proposed hierarchy (lookup order)

```text
1. Exact snapshot     (fileKey, nodeId)
2. Subtree extract    (any complete snapshot for fileKey whose document contains nodeId)
3. Parent chain       (known parent ids from URL history / last converts)
4. Page snapshot      (CANVAS / top FRAME for that page)
5. File snapshot      (depth-limited or full document slice index)
6. Workspace index    (optional: shared content-addressed assets across files)
7. REST               (Request Planner → Budget Manager)
```

**Invariant:** Never call Figma if a validated local artifact can produce the same `document` + asset maps the compiler needs.

### Can subtree extraction completely avoid REST?

**Yes for descendant-of-cached-ancestor** (proven in RFC: `2:5` inside cached `2:2`).

**No** when:

- No ancestor snapshot exists
- Design changed (version mismatch) and freshness required
- Sibling without common cached ancestor
- Assets missing from parent snap (rare if parent export was complete)

Partial snapshot reuse: reuse **fills by `imageRef`**, **PNG by content hash**, **SVG fallback by node id** across snapshots in the same file.

---

## 4. Layers

### L0 — Content-addressed asset store

Key: `sha256(bytes)` or `imageRef` + file version.  
Value: immutable blob (png/jpg/svg/webp).

Dedupes duplicate fills across nodes/files. Professional exporters all eventually land here.

### L1 — Process memory (LRU)

Hot `document` slices + fill maps. Cap by entries/MB. Invalidate on version bump.

### L2 — Local disk snapshots (current + extended)

Today: exact dirs under `output/figma-cache/`.  
Extend: `index.json` per `fileKey` listing roots and contained node id ranges/sets for O(1)/O(n) subtree search.

### L3 — Shared object storage (multi-user)

S3 / R2 / GCS: snapshots + assets. CDN in front for compiled HTML/CSS/images (not for Figma API).

### L4 — Edge CDN

Only for **compiler outputs** and **owned assets**. Never treat ephemeral Figma CDN URLs as origin-of-truth.

---

## 5. Versioning, fingerprinting, invalidation

| Signal | Use |
|--------|-----|
| Figma `GET file metadata` (`lastModified` / version) | Cheap Tier‑3 freshness check (when budget allows) |
| Snapshot `metadata.json` stores `figmaVersion` | Compare before serving HIT as “fresh” |
| Compiler checksums (`ndgChecksum`, `emitPlanChecksum`, …) | Skip re-emit when IR unchanged |
| `compilerVersion` / `schemaVersion` | Already invalidate on mismatch (`figma-snapshot.js`) |
| Explicit `refresh=true` | User-driven REST |

**Expiry policy (recommended):**

| Object | TTL / policy |
|--------|----------------|
| Node JSON snapshot | Soft TTL 7d + version check; hard keep until eviction |
| Remote URL strings | Do not rely after 14d; keep **local bytes** |
| Local asset bytes | Keep until LRU eviction or file deleted |
| Compiled site | Soft TTL tied to snapshot version |

**Challenge:** version check costs a Tier‑3 call. On Starter Mode, **skip** auto version checks; only refresh on user action. On Enterprise, optional webhook-driven invalidation.

---

## 6. Graph reuse & incremental compile

| Idea | Benefit | Complexity |
|------|---------|------------|
| Subtree extract | 0 REST for children | Low |
| NDG/IR fingerprint short-circuit | Skip engines when checksum match | Medium |
| EmitPlan-only re-run | Faster iterate on emitter | Medium |
| File-level node index | O(1) “which snapshot holds id?” | Medium |
| Workspace asset dedup | Disk/CDN savings | Medium |

Do **not** redesign compiler stages — only short-circuit **inputs** and **artifact emit** when fingerprints match.

---

## 7. Better architecture (if we could rebuild cache only)

**Preferred long-term:** **File (or Page) snapshot as primary unit**; Exact/Subtree become views.

```text
Fetch page/frame once → store document + assets
Every section convert = pure function slice(document, nodeId) → compile
```

Exact-first remains for tiny one-off nodes and for privacy isolation.

Tradeoff: first fetch is larger; amortized REST → near zero for exploration UX.

---

## 8. Recommendation cards

### K1 — Implement subtree HIT (P0)

| | |
|--|--|
| **Problem** | Child MISS burns Tier 1 |
| **Evidence** | RFC proof |
| **Tradeoffs** | Index scan cost; must filter asset maps |
| **API savings** | ~100% for descendant converts |
| **Perf** | Large |
| **Complexity** | Low–medium |
| **Priority** | **P0** |

### K2 — Page/file primary cache (P1)

| | |
|--|--|
| **Problem** | Many siblings without shared parent snap |
| **Evidence** | Cost model 40–80 REST/page naive |
| **Tradeoffs** | Larger first download |
| **API savings** | ~95%+ on multi-section pages |
| **Complexity** | Medium |
| **Priority** | **P1** |

### K3 — Content-addressed assets (P1)

| | |
|--|--|
| **Problem** | URL-hash names + duplicate bytes |
| **Evidence** | Figma expiry; industry pitfalls |
| **API savings** | Indirect (reuse avoids re-export) |
| **Complexity** | Medium |
| **Priority** | **P1** |

### K4 — Version-aware soft freshness (P2)

| | |
|--|--|
| **Problem** | Stale designs vs API burn |
| **Evidence** | MCP version-aware caches |
| **Tradeoffs** | Tier‑3 meta cost |
| **Priority** | **P2** (Enterprise Mode default) |
