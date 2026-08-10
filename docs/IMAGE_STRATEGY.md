# Image Strategy

| Field | Value |
|-------|--------|
| **Status** | Research + architecture — not implemented |
| **Date** | 2026-07-18 |
| **Official** | [File endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/) — fills ≤14d; rendered images 30d |

---

## 1. Two different Figma image APIs

| API | What you get | Tier | Expiry | Best for |
|-----|--------------|------|--------|----------|
| `GET …/files/{key}/images` (fills) | Original user-uploaded assets by `imageRef` | **2** | ≤ **14 days** | Photos / placed images |
| `GET …/images/{key}` (export) | **Rendered** node bitmap/SVG | **1** | **30 days** | Effects, flattened groups, nodes without imageRef |

**Product rule:** Prefer **fills + imageRef** over **PNG export** whenever the node is a simple IMAGE fill. PNG export costs scarcer Tier‑1 budget.

---

## 2. Should we download PNG?

| Situation | Recommendation |
|-----------|----------------|
| Production / offline convert | **Always download** to owned storage |
| Dev preview only | Short-lived URL OK ≤ hours |
| Cache remote URL only | **Never** as sole source |

Our snapshot manager already downloads fills/PNGs into `assets/` — correct direction.

---

## 3. Dedup, hashing, versioning

| Technique | Purpose |
|-----------|---------|
| Key by `imageRef` + `fileKey` + figma file version | Stable logical identity |
| Key by `sha256(bytes)` | Cross-file dedup; CDN immutable objects |
| Avoid keying only by ephemeral URL | URL changes every re-export |
| Version compiled asset paths | `assets/{hash}.png` → cache forever at CDN |

Current code hashes **URL** (`hashName(url)`) — works for a single snapshot session but **re-export yields new URL → new filename** even if bytes identical. Upgrade to **content hash after download**.

---

## 4. CDN / object storage choices

| Option | When | Notes |
|--------|------|-------|
| **Local disk** | Solo / Starter Mode | Current; fine for one machine |
| **S3 / R2 / GCS** | Multi-user SaaS | Source of truth for blobs |
| **Cloudflare / BunnyCDN / Fastly** | Edge delivery of **owned** assets | Not a substitute for Figma API cache |
| **Figma CDN** | Transient only | Expires; no auth |

Builder.io-style lesson: put **your** CDN in front of **your** origin; use stale-while-revalidate for compiled pages — not for Figma REST.

---

## 5. How professional exporters behave (synthesis)

Common pattern across MCP caches / design-to-code tools:

1. Fetch node JSON once (cache aggressively).
2. Resolve `imageRef` via fills map.
3. Download bytes immediately to local/`/public`.
4. Reference local paths in generated code.
5. On refresh, re-fetch only if version changed.

They do **not** keep serving expired Figma URLs in production.

---

## 6. Recommendation cards

### I1 — Prefer fills; gate PNG export

| | |
|--|--|
| **Problem** | PNG export burns Tier 1 |
| **Evidence** | Cost model; official tiers |
| **Tradeoffs** | Some effects need render |
| **API savings** | Up to **1 Tier‑1 call** per convert |
| **Priority** | **P0** |

### I2 — Content-addressed storage

| | |
|--|--|
| **Problem** | URL-hash churn |
| **Evidence** | Expiry + re-export |
| **API savings** | Avoids re-download/re-export when bytes match |
| **Priority** | **P1** |

### I3 — Object storage + CDN for SaaS

| | |
|--|--|
| **Problem** | Local disk doesn’t scale to 1k–10k users |
| **Evidence** | Scalability plan |
| **Priority** | **P2** (with multi-tenant) |

---

## 7. SVG strategy (Part 6)

### When to reconstruct vs export

| Prefer **reconstruct** (`geometry=paths` → local SVG) | Prefer **export** (`GET image?format=svg`) |
|------------------------------------------------------|--------------------------------------------|
| Simple VECTOR / LINE / ELLIPSE / RECT boolean-ish trees we already support | Complex boolean ops, text-in-vector, unsupported effects |
| Icons composed of path nodes already in JSON | Pixel-perfect match required vs Figma rasterization |
| Starter / budget-critical modes | QA / “match Figma SVG export” mode |
| Zero Tier‑1 cost | Costs Tier 1 |

**Evidence:** Current pipeline already reconstructs first and only exports missing ids (`index.js` + `reconstructSvgMarkup`). This is the correct commercial default.

### Best practice

1. Always request `geometry=paths` on node fetch (we do).
2. Reconstruct aggressively.
3. Export only the residual id list, batched.
4. Persist SVG markup in snapshot (`svg-fallback.json`) so HIT never re-exports.
5. Do not pass `scale` for SVG (ignored by API; pitfall lists).

### Recommendation S1

| | |
|--|--|
| **Problem** | SVG export is Tier 1 |
| **Evidence** | Official table; our MISS path |
| **Tradeoffs** | Reconstruct fidelity gaps |
| **API savings** | Often **1 entire Tier‑1 call** |
| **Perf** | Faster (no render queue) |
| **Complexity** | Already mostly done; extend coverage |
| **Priority** | **P1** (expand reconstruct coverage), **P0** (never re-export on HIT) |
