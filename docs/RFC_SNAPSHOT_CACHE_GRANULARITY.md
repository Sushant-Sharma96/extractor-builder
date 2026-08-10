# RFC: Snapshot Cache Granularity — Parent Subtree Reuse

| Field | Value |
|-------|--------|
| **Status** | Draft — investigation only (not implemented) |
| **Date** | 2026-07-18 |
| **Related** | `docs/FIGMA_API_FORENSICS_REPORT.md` |
| **Scope** | Cache key design; no compiler / architecture changes |

---

## 1. Problem statement

Current snapshot key:

```text
fileKey + nodeId
```

(`server/figma-snapshot.js` → `snapshotKey`)

Consequence: requesting a **child** node after caching a **parent** is always a **MISS**, even when the child subtree already exists inside the parent’s `document.json`.

Observed failure:

| Item | Value |
|------|--------|
| Cached | `fYKUEGHAxVkJwn8CwvJCsp` + **`2:2`** (Group) |
| Requested | same file + **`2:5`** (Rectangle image) |
| Result | `stage: "MISS"` → Figma REST → 429 |

---

## 2. Evidence: can `2:5` be taken from cached `2:2`?

**Yes.** Proven by loading the on-disk HIT snapshot and walking IDs.

| Check | Result |
|-------|--------|
| Cached root | `2:2` GROUP `Group 1171276007` |
| Nodes in snapshot | **12** |
| Contains `2:5`? | **Yes** — RECTANGLE `Rectangle 34624226`, path `2:2 → 2:5`, leaf |
| Document JSON size | **~14.7 KB** |
| Image fill URLs in snap | 1 |
| PNG remote map entries | 1 |

Figma `/files/.../nodes?ids=2:2` returns the selected node **and its full descendant tree**. Children keep stable `id` fields. Therefore a DFS/`id` lookup can return the subtree rooted at `2:5` with **zero REST**.

That subtree is the same shape `fetchNode(fileKey, "2:5")` would return as `document`.

---

## 3. Evaluation: should child requests reuse a parent snapshot?

### 3.1 Feasibility

| Direction | Feasible without REST? | Notes |
|-----------|------------------------|-------|
| Parent cached → child requested | **Yes**, if `childId` is found under parent `document` | Extract subtree by `id` |
| Child cached → parent requested | **No** | Parent is not in child snapshot |
| Sibling A cached → sibling B | **No** (unless a common ancestor snapshot exists) | Need ancestor or file-level cache |
| Unrelated node / other page | **No** | Must MISS |

### 3.2 Proposed lookup order (conceptual — not implemented)

```text
1. Exact key HIT (fileKey, nodeId)          → current behavior
2. Else: scan complete snapshots for same fileKey
         where document tree contains nodeId
         → extract subtree; reuse asset maps (filtered)
3. Else: MISS → REST (current)
```

Optional stronger design later: cache **file-level** (or page-level) once; always slice by `nodeId`. Out of scope for this RFC’s “subtree reuse” minimum.

---

## 4. Impact analysis (if subtree reuse were implemented)

### 4.1 Memory impact

| Factor | Estimate |
|--------|----------|
| Extra RAM per lookup | Transient: parse `document.json` + walk (~14 KB for this card; larger frames = MBs) |
| Persistent disk | **No increase** if reuse exact parent dir (no duplicate snapshot required) |
| Optional index `fileKey → [{nodeId, path, containedIds}]` | Small (KB–tens of KB per file); rebuildable from metadata + one tree walk on save |
| Worst case | Many large incomplete scans without an index → CPU, not large sustained RAM |

**Verdict:** Memory impact **low** for typical frames; index recommended if many snapshots per file.

### 4.2 Performance impact

| Path | Today | With reuse |
|------|-------|------------|
| Exact HIT | Fast (load one dir) | Unchanged |
| Child of cached parent | MISS + 2–4 REST + network | Disk load + O(n) tree walk (ms–tens of ms) |
| Cold MISS | REST | Unchanged |

**Verdict:** Child-of-parent path becomes **orders of magnitude faster** than REST; small CPU cost vs network/429.

### 4.3 Correctness impact

| Concern | Assessment |
|---------|------------|
| Tree shape | Subtree rooted at child matches `/nodes?ids=child` document root |
| Geometry | Child keeps `absoluteBoundingBox`; emit already treats selected node as root — **same as direct fetch** |
| Image fills | Parent snap stores remote fill map (file-scoped, often filtered to used refs). Child’s `imageRef` must be present. For this sample, `2:5`’s fill is in the parent snap — **OK**. Risk if parent snap filtered fills too aggressively and omitted a child-only ref (mitigate: store full `/images` map on parent, or re-filter from full map kept in snap) |
| PNG export map | Keyed by node id; leaf image may use `imageRef` not png id — reuse fills map |
| SVG fallback | Parent may have reconstructed SVGs for descendant lines; child-only request may not need them |
| Stale design | Same as today’s exact HIT: version pinned at fetch time; no worse |
| Selecting child vs parent **output** | Different roots → different HTML (expected). Reuse must extract **subtree**, not return whole parent as document |

**Verdict:** Correctness **acceptable** with subtree extract + careful asset-map reuse; main risk is **over-filtered fill maps** on parent snapshots.

---

## 5. Measure: REST caused solely by different `nodeId`s (same file)

### 5.1 Local cache census (this workspace)

| Snapshot | fileKey | nodeId | Complete |
|----------|---------|--------|----------|
| A | `fYKUEGHAxVkJwn8CwvJCsp` | `2:2` | Yes |
| B | `VWuDrw96Uc0xcXXHcEDZcQ` | `1118:49781` | Yes |

No second nodeId entry exists for the Untitled file. Incomplete `.tmp` dirs do not count as HIT.

### 5.2 Incident measurement (proven)

| Event | REST caused by nodeId granularity? |
|-------|-------------------------------------|
| Generate with `2:5` while `2:2` cached | **Yes — 100% of that attempt’s REST** (would be 0 with reuse) |
| Theoretical MISS budget avoided | **~2–4** `api.figma.com` calls (nodes + fills + optional png/svg) |

### 5.3 Broader estimate (behavioral model)

Assume users often:

1. Cache a **frame/group** (`nodeId = F`)
2. Later paste URLs / select **N** descendants (`d1…dN`) that lie under `F`

| Without reuse | With reuse |
|---------------|------------|
| 1 + N MISSes (if each descendant requested once) | 1 MISS (parent) + N offline extracts |
| REST ≈ `(1+N) × C` where `C ≈ 2–4` | REST ≈ `1 × C` |

**REST reduction for that pattern:**

```text
reduction ≈ N / (N+1)   of descendant-triggered converts
```

Examples:

| N descendant converts after parent cached | Fraction of those converts that avoid REST |
|------------------------------------------:|--------------------------------------------:|
| 1 (e.g. only `2:5`) | **100%** of that convert |
| 5 | **~83%** of the 6 total converts are parent+children; children: 5/6 ≈ 83% offline |
| 11 (every node in this 12-node group once) | **11/12 ≈ 92%** of node-specific converts after first parent HIT |

**Not reducible by subtree reuse alone:**

- First fetch of a file/ancestor (cold)
- Requests for nodes **outside** any cached ancestor
- `refresh=true` forced MISS
- Parent requested when only child is cached

---

## 6. Estimated REST reduction if subtree reuse were implemented

### 6.1 This product’s recent failure mode

| Metric | Estimate |
|--------|----------|
| REST calls avoided on the failing `2:5` click | **All of them (2–4)** |
| User-visible effect | Offline HIT-equivalent instead of 429 |

### 6.2 Steady-state (same file, exploratory node clicking)

| Scenario | REST reduction |
|----------|----------------|
| Always convert same nodeId | **0%** (exact HIT already) |
| Convert parent once, then many children | **~70–95%** of subsequent converts for that file |
| Random nodes across large file without shared ancestor snap | **Low** unless file-level cache added |

### 6.3 Interaction with rate limits

Subtree reuse does **not** raise Figma quotas. It **avoids spending** quota on redundant MISSes. For Starter plans already near lockout, avoiding even **one** unnecessary `/nodes` call is decisive.

---

## 7. Alternatives (for later design; not chosen here)

| Option | Granularity | Pros | Cons |
|--------|-------------|------|------|
| A. Status quo | file + node | Simple | Child MISS storm |
| B. Subtree reuse (this RFC) | file + node store; ancestor search | Low change; big win for child URLs | Scan/index; child→parent still MISS |
| C. File-level snapshot | fileKey only | Max reuse | Larger download; must slice; versioning |
| D. Alias symlinks | Write child keys pointing at parent | Fast exact HIT | Write amplification; invalidation complexity |

**RFC recommendation (design only):** Prefer **B** as incremental fix; consider **C** if multi-frame files are common.

---

## 8. Conclusions

1. **Cache granularity is too fine for real Figma URLs**, where `node-id` often points at a selected child while a parent frame/group was already fetched.
2. **Yes — compiler/pipeline can extract `2:5` from cached `2:2` without Figma REST**, with correct subtree rooting; proven on disk for this file.
3. **Memory:** low. **Performance:** large win vs REST. **Correctness:** sound if subtree extract + asset maps cover child refs.
4. **REST caused solely by different nodeIds:** at least **one full MISS sequence** in production evidence (`2:5` vs cached `2:2`); in exploratory use, most follow-on node converts for that file would be avoidable.
5. **Reduction if implemented:** ~**100%** for child-of-cached-parent converts; ~**70–95%** of same-file follow-on converts in typical “frame then inspect children” workflows.

---

## 9. Non-goals / stop line

- **Do not implement** in this RFC.
- Do not change compiler IR, NDG, or emit architecture.
- Implementation would be confined to snapshot load resolution in the Figma product path (`figma-snapshot` / `index.js` MISS gate).

---

## 10. References

- `server/figma-snapshot.js` — `snapshotKey`, `loadSnapshot`
- `server/figma-fetch.js` — `fetchNode` returns selected node as document root + descendants
- `docs/FIGMA_API_FORENSICS_REPORT.md` — MISS/`2:5`/429 chain
- On-disk proof — `output/figma-cache/fYKUEGHAxVkJwn8CwvJCsp__2_2`
