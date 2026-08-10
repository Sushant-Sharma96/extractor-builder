# FIGMA API FORENSICS REPORT

| Field | Value |
|-------|--------|
| **Date** | 2026-07-18 |
| **Scope** | Investigation only — no code changes |
| **Triggering error** | `Figma rate limit exceeded (plan: starter). File reads are locked for ~111 hour(s).` |
| **Failing request body** | `stage: "MISS"`, `nodeId: "2:5"`, `fileKey` from URL |

---

## Executive root cause (evidence-backed)

**Two facts together explain the failure:**

1. **Cache key includes `nodeId`.** Disk has a valid snapshot for `2:2` only. The failing Generate used **`node-id=2:5`** → **MISS** → REST is mandatory.
2. **The Starter-plan token is already locked** (~111 hours) from earlier REST usage in this workspace (proven by prior server logs on the same plan tier). The first REST call on MISS receives **HTTP 429** immediately.

This is **not** “8 nodes × N API calls per node.” Node traversal is in-memory after one `/nodes` fetch. The tiny design still hits the wall because **MISS + already-exhausted Starter quota**.

---

## STEP 1 — Every Figma REST call site (code map)

All `api.figma.com` traffic goes through `server/figma-fetch.js` → `figmaGet()`, except OAuth token exchange.

| # | Function | Method | URL pattern | Purpose | Called from |
|---|----------|--------|-------------|---------|-------------|
| 1 | `fetchNode` | GET | `/v1/files/{fileKey}/nodes?ids={nodeId}&geometry=paths` | Load selected node subtree | `server/index.js` MISS path |
| 2 | `fetchNode` | GET | `/v1/files/{fileKey}?depth=100&geometry=paths` | Whole file (only if **no** nodeId) | `fetchNode` else-branch |
| 3 | `fetchImageFills` | GET | `/v1/files/{fileKey}/images` | Image-fill URL map for file | `index.js` MISS |
| 4 | `exportImages` | GET | `/v1/images/{fileKey}?ids=…&format=png\|svg&scale=…` | Render export URLs | PNG path + SVG path |
| 5 | `fetchSvgMarkup` | GET | (4) then **CDN** `fetch(url)` | SVG bytes from export URL | MISS when local SVG reconstruct incomplete |
| 6 | OAuth callback | POST | `/v1/oauth/token` | Exchange code (Connect Figma only) | `index.js` `/api/figma/callback` |

**Not present in codebase (searched):** comment fetch, variable fetch, component library fetch, style endpoint, axios, polling of Figma.

**Headers (PAT):** `X-Figma-Token: <token>` via `authHeaders()`  
**Headers (OAuth):** `Authorization: Bearer <token>`

**Instrumentation note:** There is **no** per-request timestamp/stack logger today. Forensics below use **static call graph + disk cache + error JSON + prior terminal logs**.

---

## STEP 2 — Count / group (one Generate, CACHE MISS)

Happy-path MISS sequence for a node URL (code order in `server/index.js` ~228–256):

| Order | Kind | Endpoint | Count (typical tiny card) |
|------:|------|----------|---------------------------:|
| 1 | Node fetch | `/files/…/nodes` | **1** |
| 2 | Image (SVG export) | `/images/…&format=svg` | **0–1** (only if `reconstructSvgMarkup` misses IDs) |
| 3 | Image fills map | `/files/…/images` | **1** |
| 4 | Image (PNG export) | `/images/…&format=png` | **0–1** (only if leaf image nodes need export) |

**Typical total REST for this ~12-node card on MISS: 2–4 calls.**  
**Not** proportional to node count (no per-node REST in traversal).

| Category | Present? |
|----------|----------|
| File fetch (full `/files/{key}`) | Only if URL has **no** `node-id` |
| Node fetch | Yes (MISS) |
| Image fetch (`/images`) | Yes if PNG/SVG export needed |
| Comment / Variable / Component / Style | **No** |
| Duplicate intentional loops over same file | **No** in success path |
| Retry amplification | **Yes** — see Step 4 |

`restCounter.n` increments **only on HTTP 200** (`figmaGet` success). A 429 still **consumes** Figma quota but may leave `restCalls: 0` in the error JSON.

---

## STEP 3 — Duplicates

| Question | Finding |
|----------|---------|
| Same `/files/…/nodes` twice in one convert? | **No** — single `await fetchNode` |
| Same `/files/…/images` twice? | **No** — single `fetchImageFills` |
| Same `/images` for same ids twice? | **No** in one convert (PNG and SVG are different `format=` calls if both run) |
| Across converts? | **Yes if MISS again** — every MISS re-fetches |

**Cache key causes “duplicate work” across clicks:**

```18:19:server/figma-snapshot.js
function snapshotKey(fileKey, nodeId) {
  return `${fileKey}__${(nodeId || 'root').replace(/[^\w.-]/g, '_')}`;
}
```

Disk proof:

- Exists: `output/figma-cache/fYKUEGHAxVkJwn8CwvJCsp__2_2` (`complete: true`, `nodeId: "2:2"`)
- Missing: `…__2_5`

Failing UI error: `nodeId: "2:5"`, `stage: "MISS"`.

Figma UI URL in forensic screenshots uses `node-id=2-5` (selected rectangle). Prior successful cache was built with `node-id=2-2` (parent group). **Same file, different node → treated as different cache entry → REST again.**

---

## STEP 4 — Retry analysis

**Location:** `figmaGet` in `server/figma-fetch.js` lines 29–62.

| Mechanism | Evidence |
|-----------|----------|
| Loop retry | `for (let attempt = 0; ; attempt++)` |
| Max tries | `tries = 4` (default) → up to **5 attempts** (0..4) |
| Network/timeout retry | On catch: sleep `1000*(attempt+1)`, continue if `attempt < tries` |
| 429 + `retry-after` ≤ 30s | Sleep that many seconds, retry |
| 429 + no `retry-after` | Sleep `1500*(attempt+1)`, retry while `attempt < tries` |
| 429 + `retry-after` > 30s | **No retry** — throw (matches ~111 hour lock message) |
| axios / recursive retry / Promise retry libs | **None** |
| exportImages 429 | Re-throws; does not swallow |

**Amplification:** If Figma returns short 429s, one logical call can become up to **5** HTTP attempts. With a long lock (~111h), the first 429 throws — **1 HTTP attempt**, still fails.

---

## STEP 5 — Cache analysis

| Scenario | REST? | Evidence |
|----------|-------|----------|
| HIT (`loadSnapshot` ok) | **Zero** `figmaGet` | `index.js` loads document + URL maps from disk; jumps to `compile()` |
| MISS | REST sequence above | `stage: "MISS"` in error |
| Same URL twice (same fileKey+nodeId) after complete snapshot | 2nd = **HIT**, 0 REST | Designed behavior |
| Same **file**, different **node-id** | 2nd = **MISS** | `2:2` cached, `2:5` not |

**Why cache existed but API still called (this incident):**

- Cache present for **`2:2`**
- Request used **`2:5`**
- `loadSnapshot(fileKey, "2:5")` → null → MISS → `fetchNode` → 429

Background `saveSnapshotAtomic` (after compile) downloads **CDN** asset URLs only — **not** `api.figma.com`.

---

## STEP 6 — Image analysis

| Kind | REST? | Notes |
|------|-------|-------|
| `/files/…/images` | Yes (MISS) | Entire file fill map (1 call) |
| `/images/…&format=png` | Yes (MISS) | Batched ≤60 ids/chunk |
| `/images/…&format=svg` | Yes if local SVG reconstruct incomplete | Lines often reconstructed locally via `reconstructSvgMarkup` → **0 REST** |
| CDN download of export URL | Host ≠ `api.figma.com` | Does **not** count toward Figma REST rate limit the same way |
| `packageSite` asset download | CDN / local copy | Not Figma REST |

Images are **not** requested once per node in a loop over the tree; export is batched.

---

## STEP 7 — Node traversal

| Question | Answer | Evidence |
|----------|--------|----------|
| How many REST calls per node? | **0** after document loaded | `figmaBuild.analyze` walks JSON in memory |
| How many traversals? | Analyze once on MISS; emit walks tree | No API inside analyze/emit |
| Expected vs actual | 1 document fetch, not N× nodes | `fetchNode` once |

---

## STEP 8 — Token analysis

| Check | Result |
|-------|--------|
| PAT recreated per request? | **No** — `process.env.FIGMA_TOKEN` or body token or in-memory OAuth |
| Validated via extra Figma API? | **No** |
| Unnecessary auth endpoints on Generate? | **No** — only OAuth on Connect/callback |

---

## STEP 9 — Backend `/api/figma/convert`

| Check | Result |
|-------|--------|
| Handlers per click | **One** Express route invocation |
| Figma REST inside | Only on **MISS** (or refresh) |
| compile() | Local — no Figma REST |

---

## STEP 10–11 — Frontend / StrictMode

| Check | Result | Evidence |
|-------|--------|----------|
| Generate clicks | **One** `fetch('/api/figma/convert')` | `App.jsx` `convert()` |
| Double submit guard | Soft (`loading` state) — no hard abort of in-flight | |
| React StrictMode | Present in `main.jsx` | |
| StrictMode double-invokes `convert`? | **No** — `convert` is click/Enter handler, **not** a `useEffect` | StrictMode double-mount does not fire Generate |
| Browser Network (user screenshot) | **1** `convert` XHR | Matches |

---

## STEP 12 — Background jobs

| Job | Hits Figma REST? |
|-----|------------------|
| Snapshot bg download | No (CDN) |
| `/api/health` | No |
| `/api/figma/status` | No (local booleans) |
| Vite HMR | No |
| capture.js `setInterval` | Lovable capture only — not Figma convert |

---

## STEP 13 — GET FILE frequency

| Condition | Calls |
|-----------|------:|
| URL with `node-id` | **1×** `/files/…/nodes` (not full file) |
| URL without `node-id` | **1×** `/files/{key}?depth=100` |
| Per Generate MISS | At most one of the above before other endpoints |

No code path issues four sequential full-file GETs in one convert.

---

## STEP 14 — Totals & root cause

### One click (this failure)

| Item | Value |
|------|--------|
| Frontend requests to our API | **1** |
| Backend convert handlers | **1** |
| Cache | **MISS** (`nodeId=2:5`; disk has `2:2` only) |
| Figma REST attempted | ≥ **1** (`fetchNode`) |
| Figma response | **429** Starter lock ~111h |
| compile() | Never reached (throws in fetch) |

### Theoretical MISS budget (unlocked token, this design)

| Endpoint group | ~Count |
|----------------|-------:|
| Node | 1 |
| Fills map | 1 |
| PNG export | 0–1 |
| SVG export | 0–1 |
| **Total** | **2–4** (+ retries if short 429s) |

### Historical quota burn (same workspace logs)

Prior sessions already recorded Starter **429 / ~111 hour** locks while fetching larger/cached-miss designs (e.g. TechMonk refresh / Inner-circle). That exhausts the same PAT/plan before this tiny file’s MISS.

---

## Root cause (exact)

1. **Immediate cause of this error JSON:** Generate used **`node-id=2:5`**, cache only for **`2:2`** → **MISS** → `fetchNode` → Figma returned **429 plan:starter ~111h**.
2. **Why Starter is locked:** Cumulative prior REST from this project’s converts/retries/refreshes against the same token/plan (logged earlier), not “8 nodes × API.”
3. **Not the cause:** Compiler, NDG, per-node REST, StrictMode double Generate, comment/variable APIs, background Figma polling.

### What would have avoided this click’s REST

Use the **same** `node-id` as the cached snapshot (`2-2` / group), **or** wait out / replace the rate-limited token. Cached HIT path performs **zero** Figma REST.

---

## Code evidence index

| Claim | Location |
|-------|----------|
| All REST via `figmaGet` | `server/figma-fetch.js:29-62` |
| Retry ≤4 / 429 rules | `server/figma-fetch.js:47-55` |
| MISS call order | `server/index.js:228-256` |
| Cache key = file + node | `server/figma-snapshot.js:18-19` |
| HIT skips REST | `server/index.js:217-227` |
| One frontend fetch | `client/src/App.jsx:26-34` |
| StrictMode wrapper only | `client/src/main.jsx:6-9` |
| Disk cache `2:2` only | `output/figma-cache/fYKUEGHAxVkJwn8CwvJCsp__2_2/metadata.json` |
| Failure `2:5` + MISS | User Network Preview JSON |

---

*Investigation only. No implementation performed.*
