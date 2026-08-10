# Paint Feature Real-Data Census

Research only — no production code changed. Ground-truths the Paint (fills,
strokes, gradients, blend modes, effects) architecture audit against actual
occurrence data, following this project's established practice (see
`docs/MASK_RELATIONSHIP_DESIGN.md`) of not building speculative handling for
a Figma feature combination with zero real occurrences in the corpus.

## 0. Corpus definition

`server/figma-snapshot.js`'s `CACHE_DIR_DEFAULT` resolves to
`output/figma-cache`, and `loadSnapshot()`/`validateSnapshot()` only treats a
directory as a loadable HIT when it has `metadata.json` with
`schemaVersion` match AND `complete === true`, plus a readable
`document.json`. Applying that filter to everything under
`output/figma-cache`:

- **17** directories contain a `document.json`.
- **14** of those are real, validated (`complete:true`), loadable snapshots
  — this is the **canonical corpus** used for every count below unless
  labeled otherwise. It spans the same **5 fileKeys** referenced in
  `docs/MASK_RELATIONSHIP_DESIGN.md` (`fYKUEGHAxVkJwn8CwvJCsp` ×4,
  `c0kt3mp76RoEiq3CFoeCHa` ×5, `oPJPuHvvZOPo4nkzVxr11M` ×3,
  `VWuDrw96Uc0xcXXHcEDZcQ` ×1, `eOwzPCQP0f3sAxzI0T0b9d` ×1 — 14 total
  subtree/root snapshots), **3,490 unique nodes** (deduped by
  `fileKey::nodeId`; no cross-snapshot overlap was found — each subtree
  snapshot covers disjoint nodes).
- **3** are excluded, structurally-invalid-for-serving tmp/orphan writes:
  - `fYKUEGHAxVkJwn8CwvJCsp__2_2.tmp-24244-*` and `...tmp-4816-*` — byte-identical
    stale duplicates of the already-canonical `fYKUEGHAxVkJwn8CwvJCsp__2_2`
    (no new data).
  - `gqBQqngQnWdcl0LGTx8MzW__1_133.tmp-13104-*` — **no `metadata.json`**, a
    different (6th) fileKey never reachable via `loadSnapshot()`. This one
    contains genuinely new real data not seen anywhere in the canonical
    corpus (see effects section below) — flagged throughout as
    **"orphan-tmp, NOT loadable."**

- A root-level `.figma-cache/` directory (flat `.json` files, `{document,
  name, fileName}` shape) also exists, confirmed in
  `docs/MASK_RELATIONSHIP_DESIGN.md` to be **never read** by
  `server/figma-snapshot.js` (`CACHE_DIR_DEFAULT` points at `output/figma-cache`
  only). Its 3 files (`M9C6BKy9RspwtBSSG1UQEO__0_2.json`,
  `VWuDrw96Uc0xcXXHcEDZcQ__1118_49781.json`,
  `VWuDrw96Uc0xcXXHcEDZcQ__2213_7429.json`, 1,975 unique nodes) are reported
  separately below and labeled **"ORPHANED — not part of the canonical
  loadable corpus"** per that doc's own convention. One of the three
  (`VWuDrw96Uc0xcXXHcEDZcQ__1118_49781.json`) is a byte-for-byte duplicate of
  the canonical `output/figma-cache/VWuDrw96Uc0xcXXHcEDZcQ__1118_49781/document.json`;
  the other two (`M9C6BKy9RspwtBSSG1UQEO__0_2`, `VWuDrw96Uc0xcXXHcEDZcQ__2213_7429`)
  are genuinely new fileKeys/subtrees not present in the canonical corpus at all.

All counts below are **CANONICAL** (14 valid loadable snapshots, 3,490 nodes)
unless a row explicitly says **ORPHANED** or **orphan-tmp**.

---

## 1. Fills per node — histogram

| Fill count | Nodes (canonical) | Nodes (orphaned .figma-cache) |
|---|---|---|
| 0 | 1,197 | 555 |
| 1 | 2,290 | 1,419 |
| 2 | 3 | 1 |
| 3+ | 0 | 0 |

**2+ fills is vanishingly rare** (3 of 3,490 nodes, 0.09%) and **3+ fills
never occurs at all** anywhere in either corpus.

### Distinct type combinations for 2+-fill nodes (canonical)

| Combo | Count | Example node |
|---|---|---|
| `IMAGE+IMAGE` | 1 | `1:374` "Rectangle 34624594" (RECTANGLE), snapshot `c0kt3mp76RoEiq3CFoeCHa__1_2` |
| `SOLID+IMAGE` | 2 | `86:62` "Rectangle 34624213" (RECTANGLE), snapshot `fYKUEGHAxVkJwn8CwvJCsp__86_60`; `1118:50063` "Rectangle 5529" (RECTANGLE), snapshot `VWuDrw96Uc0xcXXHcEDZcQ__1118_49781` |

No `SOLID+SOLID`, `SOLID+GRADIENT_*`, `GRADIENT+GRADIENT`, or any 3-way combo
was found anywhere. `SOLID+IMAGE` (tint-over-photo) is the only combo that
recurs more than once.

---

## 2. Gradient paint types

| Type | Count (paints, canonical) | Example node |
|---|---|---|
| `GRADIENT_LINEAR` | 45 | `1:319` "Rectangle 8", `c0kt3mp76RoEiq3CFoeCHa__1_2` |
| `GRADIENT_ANGULAR` | 6 | `1:607` "calendar" (VECTOR icon), `c0kt3mp76RoEiq3CFoeCHa__1_2` |
| `GRADIENT_RADIAL` | 2 | `1118:50061` "Vector" (stroke, not fill), `VWuDrw96Uc0xcXXHcEDZcQ__1118_49781` |
| `GRADIENT_DIAMOND` | **0** | — never observed |

Total 53 gradient paints across the canonical corpus (45+6+2). The 2
`GRADIENT_RADIAL` occurrences are both on **strokes**, not fills.

**Important correction to the audit's premise:** these REST-shaped payloads
express gradient orientation via **`gradientHandlePositions`** (3 `{x,y}`
points: start, end, width-handle, in the paint's own bounding-box-relative
coordinate space) — **not** a `gradientTransform` 2×3/3×3 matrix.
`gradientTransform` was searched for and **never found** in either corpus
(0 occurrences). Any design work should key off `gradientHandlePositions`,
not a transform-matrix field.

**Rotation/axis-alignment** (derived from `gradientHandlePositions`
start→end angle): of the 53 gradient paints, **52/53 are axis-aligned**
(horizontal or vertical, angle within 0.5° of a 90° boundary) and **exactly
1 is a genuine diagonal gradient** — node `1118:50900` "Meetups"
(`GRADIENT_LINEAR`, ~-45.4° angle), snapshot `VWuDrw96Uc0xcXXHcEDZcQ__1118_49781`.
So diagonal gradients are rare but **not zero** — worth a real (if low
priority) angle-computation path, unlike some of the other zero-occurrence
items below.

---

## 3. Per-paint `opacity` (paint-level, not node-level)

| Paint type | Count (paints with opacity ≠ 1 and ≠ undefined) | Example node |
|---|---|---|
| `SOLID` | 304 | `1:330` "001" (TEXT, fill, opacity 0.6), `c0kt3mp76RoEiq3CFoeCHa__1_2` |
| `IMAGE` | 4 | `86:62` "Rectangle 34624213" (fill, opacity 0.4), `fYKUEGHAxVkJwn8CwvJCsp__86_60` |
| `GRADIENT_LINEAR` | 5 | `1118:50205` "Rectangle 34624268" (fill, opacity 0.96), `VWuDrw96Uc0xcXXHcEDZcQ__1118_49781` |
| `GRADIENT_ANGULAR` / `GRADIENT_RADIAL` | 0 | — |

Per-paint opacity is common on `SOLID` paints (304 occurrences, both fills
and strokes — includes at least one `opacity: 0` fully-transparent solid
fill, node `1:346`), rare-but-real on `IMAGE` and `GRADIENT_LINEAR`.

---

## 4. Node-level `opacity`

**78** nodes (of 3,490) have `opacity !== 1` (canonical). Examples:
`1:9` "Group 1171278031" (GROUP, opacity 0.2), `1:34` "Group 1171278032"
(opacity 0.2), both in `c0kt3mp76RoEiq3CFoeCHa__1_2`. Node opacity is
distinct from, and co-exists with, per-paint opacity (item 3) — both are
real and independently populated.

---

## 5. `blendMode`

| Level | Distinct non-default values | Count | Example node |
|---|---|---|---|
| Paint (fills/strokes) | *(none)* | 0 | 2,904 paints checked, **100% `NORMAL`** |
| Node | `MULTIPLY` | 115 | `86:249`/`86:250`/`86:251` "Vector" (icon layers), **all** in one snapshot: `fYKUEGHAxVkJwn8CwvJCsp__86_60` |
| Node (default, not a real signal) | `PASS_THROUGH` | 3,369 | default for frames/groups |

**Clean finding:** blend mode variation is exclusively a **node-level**
phenomenon in this corpus (dual-tone icon layering, confined to a single
snapshot/fileKey), never a per-paint one. No `SCREEN`, `OVERLAY`, `DARKEN`,
`COLOR_DODGE`, etc. anywhere. No effect-level (`effects[].blendMode`)
non-`NORMAL` value either.

---

## 6. Stroke + fill co-occurrence

- **311** nodes (of 3,490) have both non-empty `strokes` and non-empty
  `fills` (canonical). Example: `1:11` "Ellipse 163" (ELLIPSE),
  `c0kt3mp76RoEiq3CFoeCHa__1_2`.
- Of those 311, **142** have `strokeAlign !== 'INSIDE'` (mostly `OUTSIDE`).
  Example: `1:11` "Ellipse 163", `strokeAlign: OUTSIDE`.
- Corpus-wide `strokeAlign` distribution (all nodes with the field, not just
  stroke+fill ones): `INSIDE` 2,861, `OUTSIDE` 862, `CENTER` 409. Non-`INSIDE`
  is common (~31% of all `strokeAlign` occurrences), confirming this is a
  real, load-bearing field, not a corner case.

---

## 7. `isMask` / `maskType` (re-confirmation)

**Re-confirmed: 0 occurrences** of `"isMask"` or `"maskType"` anywhere in
any of the 14 canonical `document.json` files — consistent with
`docs/MASK_RELATIONSHIP_DESIGN.md`'s prior finding. The 7 real `isMask:true`
nodes that document found live only in the **ORPHANED**
`.figma-cache/M9C6BKy9RspwtBSSG1UQEO__0_2.json` (confirmed again here:
`isMaskCount: 7`, all `maskType: "VECTOR"`, e.g. node `0:64` "Rectangle").
Still zero in the canonical, loadable corpus.

---

## 8. Image paint fields

| Field | Real values found (canonical) | Notes |
|---|---|---|
| `scaleMode` | `FILL` (124), `STRETCH` (58) | **Correction to task premise:** `STRETCH` genuinely appears in this REST-shaped data (58 times) — it is not purely a legacy/plugin-API-only name as sometimes assumed. `FIT`, `CROP`, `TILE` **never occur**. |
| `imageTransform` | Present on 41 paints, **all 41 non-identity** | 2×3 matrix, e.g. node `1:333` "Rectangle 34624593": `[[0.423,0,0.286],[0,0.847,0.079]]`. Every occurrence is a real crop/scale (asymmetric sx/sy + offset) — never an identity matrix left in place. Confirms `imageTransform` (as opposed to gradients' `gradientHandlePositions`) really is a transform matrix per Figma's IMAGE-paint shape. |
| `rotation` (image paint) | **0** occurrences of non-zero | Field never populated with a nonzero value in either corpus |
| `filters` | 19 paints (canonical) | Keys actually used: `saturation`, `contrast`, `highlights`, `tint`, `exposure`, `temperature`. `shadows` **never** appears. Example: node `1:826` "Subscribe", `{saturation: -1}`; node `50:194`/`1:5` "Rectangle 34624564" (same authored component reused across 2 fixtures), `{contrast: 0.3, highlights: -0.05}`. |

`scaleMode: FILL` is the dominant real usage (124 vs 58 STRETCH); `FIT` and
`CROP`/`TILE`'s `imageTransform`-driven cropping never occurs by that literal
scaleMode name, but `imageTransform` matrices are nonetheless present on 41
paints (likely authored under `CROP`/`TILE` semantics in the Figma editor
even where the cached REST payload's `scaleMode` reads `FILL`/`STRETCH` —
this is real but worth a closer look if precision matters, since it means
`imageTransform` can co-occur with `scaleMode: FILL`).

---

## 9. `effects[]` array — distinct types

| Type | Count (canonical) | Example node | Source |
|---|---|---|---|
| `DROP_SHADOW` | 34 | `39:29` "Rectangle 34624623", `c0kt3mp76RoEiq3CFoeCHa__39_3` | canonical |
| `INNER_SHADOW` | **0** | — | canonical |
| `LAYER_BLUR` | **0** | — | canonical |
| `BACKGROUND_BLUR` | **0** | — | canonical |
| `NOISE` | 0 | — | not found anywhere |
| `TEXTURE` | 0 | — | not found anywhere |
| `GLASS` | 0 | — | not found in canonical |

Only `DROP_SHADOW` occurs in the loadable canonical corpus — the other 3
"already known to be handled" types (`INNER_SHADOW`, `LAYER_BLUR`,
`BACKGROUND_BLUR`) have **zero real occurrences there**.

**High-signal finding, orphan-tmp only:** the excluded, non-loadable
`gqBQqngQnWdcl0LGTx8MzW__1_133.tmp-13104-*` directory (6th fileKey, no
`metadata.json`, never reachable via `loadSnapshot()`) contains real
occurrences of **`BACKGROUND_BLUR`** (3, e.g. node `1:1112` "Frame
1707482153", `radius: 24`), **`INNER_SHADOW`** (3, e.g. node `4:1233`
"Subtract", with `color`/`offset`/`radius`/`spread`), and — beyond the 4
effect types this project already considers "known" — **`GLASS`** (3
occurrences, e.g. node `4:1176` "Frame 2147224943": `{type: "GLASS",
visible: true}`, no other fields). `GLASS` is a genuinely novel Figma effect
type with real-world data behind it, but it is **not reachable through the
compiler's own snapshot loader today** (same "orphaned/not-in-loadable-
corpus" caveat as the mask doc's finding) — flag for awareness, not for
immediate implementation, matching this project's stated practice of not
building for data the running system can't currently load.

---

## 10. `boundVariables` (variables/tokens binding)

- **Zero** occurrences of `boundVariables` on any paint object itself
  (`fills[].boundVariables` / `strokes[].boundVariables`) anywhere in either
  corpus — no color/paint is ever bound to a variable in the real data.
- **50** nodes (canonical) have a node-level `boundVariables` object, but
  exclusively on **layout/typography** properties — the complete set of keys
  observed: `itemSpacing`, `maxWidth`, `lineHeight`, `letterSpacing`,
  `fontSize`, `strokeWeight`, `opacity`. Example: node `48:135` "Container",
  `boundVariables: {itemSpacing: {...}, maxWidth: {...}}`.
  Node **`opacity`** itself can be variable-bound (real, though not
  paint-color-related) — worth noting since it means opacity is sometimes
  a token, not a literal.
- **Confirmed: no `fills`/`strokes` key ever appears inside a node's
  `boundVariables` object** — i.e., Figma "variables" (tokens) bound to a
  paint color is a **zero-occurrence** feature in this entire corpus
  (canonical + orphaned). Per this project's established practice, this is
  a clean case for **not building** paint-variable-binding support
  speculatively.

---

## Summary of common vs. zero-occurrence features

**Common / real, worth designing for:**
- Single fill per node (2,290/3,490) is overwhelmingly the norm; 0-fill
  nodes are also common (1,197) — 2+ fills is a true edge case (3 nodes).
- `GRADIENT_LINEAR` (45) and to a lesser extent `GRADIENT_ANGULAR` (6) are
  real; gradients are expressed via `gradientHandlePositions`, not a
  transform matrix.
- Per-paint opacity on `SOLID` fills/strokes (304) is common; node-level
  opacity ≠ 1 (78) is common and independent of it.
- Stroke+fill co-occurrence (311 nodes) is common, and non-`INSIDE`
  `strokeAlign` (142 of those, ~46%) is common enough to require real
  handling, not a corner case.
- `imageTransform` (crop/scale matrices, 41 occurrences, always non-identity)
  and `scaleMode: FILL`/`STRETCH` are both real.
- `DROP_SHADOW` is the only real effect type in the loadable corpus.

**Zero real occurrences anywhere (canonical + orphaned), safe not to build
speculatively:**
- `GRADIENT_DIAMOND`, non-`NORMAL` blend mode at the **paint** level,
  `SOLID+SOLID`/`GRADIENT+GRADIENT`/any 3-way multi-fill combo, `isMask`/
  `maskType` (re-confirmed, canonical only — 7 real cases exist but only in
  non-loadable orphan data), image `rotation`, `filters.shadows`,
  `NOISE`/`TEXTURE` effects, and **any** `boundVariables` on a paint/color
  field.

**Zero in the loadable canonical corpus but real in excluded/orphan data
(flag, don't build yet):** `INNER_SHADOW`, `BACKGROUND_BLUR`, and the novel
`GLASS` effect type — all three only in the orphan-tmp
`gqBQqngQnWdcl0LGTx8MzW` directory, which `server/figma-snapshot.js` cannot
currently load (missing `metadata.json`).

**Rare but genuinely real (not zero, worth a lightweight path):** diagonal/
non-axis-aligned gradients (1 of 53, ~-45°), `SOLID+IMAGE` 2-fill stacking
(2 occurrences), `IMAGE+IMAGE` (1 occurrence).
