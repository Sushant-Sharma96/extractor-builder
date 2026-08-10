# Mask Relationship Design — isMask/maskType → CSS

Research + architecture only (docs/COMPILER_REDESIGN_ROADMAP.md's parallel-execution
request, "Agent 2"). No production code was changed to produce this document.

## 1. Current state (verified)

- `compiler/ndg/ingest.js:90-95` — captures `geometry.isMask` (bool) and
  `geometry.maskType` (string) from `raw.isMask`/`raw.maskType`. This is the
  ONLY ingest-side work; it already exists.
- `compiler/ndg/parser-ast.js:39-49` (`hasPaintSignal`) and
  `compiler/skeleton/build.js:79-92` (`hasOwnVisualSignal`) both check
  `g.isMask === true` — but ONLY to stop a mask shape being judged "no paint
  signal" and silently deleted/collapsed as a passthrough wrapper.
- Grep for "mask" (case-insensitive) across `compiler/` confirms: zero code
  path anywhere in `compiler/artifacts/ir-experimental-renderer.js` or
  `compiler/emit/render/css-declarations.js` reads `isMask`/`maskType` for
  its own visual meaning. A masked node renders as an ordinary, fully opaque
  sibling — the clip relationship is entirely discarded.
- `scripts/verify-ingest-consumption.js:54-56` already documents this exact
  gap as `STRUCTURAL_ONLY.isMask`/`.maskType`, citing "Roadmap Section 6.5,
  HIGH priority gap."
- `docs/COMPILER_REDESIGN_ROADMAP.md` Section 6.5 and
  `docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md` (Part 1.10, matrix row
  "Masks (isMask/maskType)", Part 8's Masks/Clipping row) all classify this
  as HIGH priority and claim it is "confirmed real and populated" in the
  corpus — a claim this document's own fixture audit (Section 2 below)
  found NOT to hold for the actual 5 named fixtures.

## 2. Real-fixture evidence (grounding, not speculation)

Direct grep of every `document.json` under `output/figma-cache` (17 files,
including all 5 canonical fixtures — fYKUEGHAxVkJwn8CwvJCsp,
c0kt3mp76RoEiq3CFoeCHa, oPJPuHvvZOPo4nkzVxr11M, VWuDrw96Uc0xcXXHcEDZcQ,
eOwzPCQP0f3sAxzI0T0b9d — plus their subtree-extract variants) for
`"isMask"` and `"maskType"`: **zero matches**, cross-checked against a
control field (`"blendMode"`, confirmed present 7,986 times across the same
17 files) to rule out a tooling/grep problem. **None of the 5 fixtures this
compiler actually loads via `server/figma-snapshot.js`'s `loadSnapshot()`
contain a real mask relationship.**

A broader repo-wide search did find one genuine real occurrence, outside
the canonical 5: `.figma-cache/M9C6BKy9RspwtBSSG1UQEO__0_2.json` — a
different fileKey, living in a root-level `.figma-cache/` directory that
`server/figma-snapshot.js` never reads (it only reads `output/figma-cache`,
per `CACHE_DIR_DEFAULT`), so this data is currently orphaned/unused by the
running compiler, but its shape is unmistakably a real Figma REST payload
(`{document, name, fileName}`, real gradient/solid fills, real ids).

7 real `isMask:true` nodes found there, ALL of them sharing the identical
shape:
- `maskType: "VECTOR"` in all 7 cases — no ALPHA, no LUMINANCE observed.
- Every mask is the LAST child (highest index) of a 2-or-more-child GROUP,
  and in every case exactly ONE preceding sibling is the thing being
  masked (never a multi-sibling masked run, despite some parent groups
  having 6-7 total children — the extra children are unrelated siblings
  after the mask, not part of the masked relationship).
- Mask shape types: RECTANGLE (5/7, with `cornerRadius` 0, 13, or 208 — the
  208-on-a-31px-box case is a de-facto circle since CSS `border-radius`
  clamps at 50%) and VECTOR (2/7, named "Rectangle" but type VECTOR —
  simple axis-aligned quads, not arbitrary curves).
- In every single one of the 7 cases, the mask node's own
  `absoluteBoundingBox` AND `cornerRadius` AND fill color are byte-identical
  to the sibling it masks (e.g. mask `0:9` and masked `0:10`: both
  `cornerRadius:208`, both box `{x:3843.06,y:-133,w:31.14,h:31.2}`, both
  solid fill `{r:0.847,g:0.847,b:0.847,a:1}`). This makes the observed
  real-world usage a **geometric/chromatic no-op**: clipping a shape to an
  identical copy of itself changes nothing. Today's "ignore the mask,
  render as ordinary sibling" behavior therefore produces the same visible
  pixels as a correct implementation would, for every real occurrence found
  in this repo. This looks like an artifact of how Figma's REST API
  decomposes an authored boolean/vector-network shape into two nodes, not
  a deliberate "clip photo into circle" design pattern.
- No IMAGE fills were involved in any observed mask relationship (contrary
  to the common "avatar clipped into circle" assumption) — all masked
  layers here are solid or gradient fills.

## 3. Proposed relationship model

A mask relationship is a property of a **contiguous run of siblings**, not
of an isolated node:

```
MaskRelationship {
  maskNodeId: string,        // the isMask:true node itself
  maskType: 'ALPHA'|'VECTOR'|'LUMINANCE',
  parentNodeId: string,
  maskedNodeIds: string[],   // the contiguous run of siblings immediately
                             // preceding maskNodeId in z-order, back to the
                             // start of the parent's children or the
                             // previous mask boundary — whichever is closer
  maskShape: {
    kind: 'rect' | 'rounded-rect' | 'ellipse' | 'vector',
    box: {x,y,width,height},        // mask's own absoluteBoundingBox
    cornerRadius: number | null,
    rectangleCornerRadii: [tl,tr,br,bl] | null,
    svgPathData: string | null,     // only for kind:'vector' — reuse
                                     // server/figma-generate.js's existing
                                     // reconstructSvg()/geometryArrays()
  },
}
```

The run boundary rule matches Figma's real semantics: walking a parent's
children array from the mask node backwards, every sibling is part of
`maskedNodeIds` until either the start of the array or another
`isMask:true` node is hit.

## 4. Representation as a Skeleton fact

Skeleton (`compiler/skeleton/build.js`) already attaches per-node facts of
exactly this kind — `cardFact`, `cardGridFact`, `bannerFact`, `dividerFact`,
`rowSetFact`, `componentClaim`, `group` — each optional, each computed in
`buildDesignSkeleton()` and stored on the per-node entry
(`compiler/skeleton/build.js:243-271`). Propose a new `maskFact` following
the identical pattern:

- On the **mask node's own** Skeleton entry: `maskFact: { role: 'mask-shape', maskedNodeIds, maskType, maskShape }`.
- On **each masked node's** Skeleton entry: `maskFact: { role: 'masked', maskNodeId, maskType, maskShape }` (the shape data duplicated for convenient lookup at render time without a second pass).
- Computed in a new small helper (`buildMaskFacts(graph, byId, childrenOf)`), called once per parent's children array in the same loop that already resolves `readingOrder` (`build.js:276-285`) — z-order run-detection is a linear backward scan, no new traversal infrastructure needed.
- Skeleton is the right layer because (a) it already owns exactly this "per-node fact derived from sibling context" pattern, (b) it runs after NDG's structural collapse, so the existing `isMask`-aware `hasOwnVisualSignal` collapse-protection guarantees the mask node and its run of siblings survive intact into Skeleton, and (c) it keeps NDG itself pure/structural per its own stated scope (`compiler/ndg/parser-ast.js:1-22`).

## 5. Decision table — CSS mechanism per maskType/shape

| maskType | Mask shape | CSS mechanism | Notes |
|---|---|---|---|
| ALPHA / VECTOR | RECTANGLE, no radius | `clip-path: inset(...)` or plain `overflow:hidden` on a 1:1 box | Degenerate case (mask box == masked box, as observed in 100% of real data) — a no-op, can be skipped entirely as an optimization |
| ALPHA / VECTOR | RECTANGLE, uniform `cornerRadius` | `clip-path: inset(top right bottom left round Rpx)` (or `border-radius` if mask box == node box, cheaper) | Circle-from-square masks (radius ≥ half box) fall out naturally — `inset(...round 50%)` |
| ALPHA / VECTOR | RECTANGLE, `rectangleCornerRadii` (per-corner) | `clip-path: inset(0 round tl tr br bl)` | Same CSS shorthand order as `border-radius` (already proven in `css-declarations.js`) |
| ALPHA / VECTOR | ELLIPSE | `clip-path: ellipse(rx ry at cx cy)` | Mirror the existing `layoutChoice.isEllipse` branch |
| ALPHA / VECTOR | Arbitrary VECTOR/BOOLEAN_OPERATION path | `mask-image: url("data:image/svg+xml;utf8,<svg>...</svg>"); mask-mode: alpha; mask-size: ...; mask-position: ...;` (with `-webkit-mask-image` fallback) | Reuse `server/figma-generate.js`'s `reconstructSvg()`/`geometryArrays()` verbatim — same fill-rule/path-data extraction already proven for icon rendering — just render the mask shape with an opaque/white fill instead of its own paint color |
| LUMINANCE | Any shape | `mask-image: url(...); mask-mode: luminance;` | Requires rasterizing the mask shape's actual gradient/fill as brightness, not just its silhouette — clip-path can NEVER express this. Zero real occurrences found anywhere in this repo's corpus — do not build speculatively |

Fallback rule: if `maskShape.kind` can't be classified confidently (missing
geometry, disallowed node type), fall back to today's behavior (render as
ordinary sibling) rather than guessing — matching this codebase's existing
conservative-fallback convention (e.g. `layoutChoice`'s "declared beats
inferred" precedence rule).

## 6. Concrete CSS syntax examples

```css
/* rounded-rect / circle mask, box-aligned */
.masked-node {
  clip-path: inset(0 round 208px); /* clamps to 50% → circle */
}

/* per-corner mask */
.masked-node {
  clip-path: inset(0 round 12px 4px 12px 4px);
}

/* ellipse mask */
.masked-node {
  clip-path: ellipse(50% 50% at 50% 50%);
}

/* arbitrary vector mask (ALPHA/VECTOR maskType) */
.masked-node {
  -webkit-mask-image: url("data:image/svg+xml;utf8,%3Csvg...%3E");
  mask-image: url("data:image/svg+xml;utf8,%3Csvg...%3E");
  -webkit-mask-mode: alpha;
  mask-mode: alpha;
  mask-repeat: no-repeat;
  mask-size: 100% 100%;
}

/* LUMINANCE maskType — same but mode swapped, out of scope per Section 5 */
.masked-node {
  mask-image: url("data:image/svg+xml;utf8,%3Csvg...%3E");
  mask-mode: luminance;
}
```

The mask node itself must be suppressed from separate DOM emission (Figma
masks never paint their own pixels) — this is new structural work in
`ir-experimental-renderer.js`, analogous in kind to the existing
`svgForNode` suppression of generic corner/stroke decls, not a brand-new
pattern.

## 7. Risk / complexity / priority assessment

**Should this be built at all, given the real-data evidence? Not now.**
The only real occurrences found anywhere in this repository — 7 nodes, one
non-canonical fixture, not even reachable through the compiler's own
snapshot loader — are all confirmed geometric-and-chromatic no-ops under
today's naive rendering. There is currently zero demonstrated visible
defect to fix. This directly contradicts the roadmap/verify-ingest docs'
"HIGH priority, real visual-fidelity gap" framing, which appears to have
been written without checking actual occurrence data — worth correcting in
those docs.

**Relative lift vs. shipped Phase 5.5 items** (radial gradient, multi-fill,
per-corner radius, blur — all pure additive `css-declarations.js` branches
reading already-ingested fields): mask support is a **larger, structurally
different lift**, because unlike those four:
1. Ingest is already done (zero work — this axis is actually even with the
   other four, which also needed no new ingest).
2. It requires a NEW Skeleton-level fact (cross-sibling relationship, not
   a single-node property) — the other four are single-node lookups.
3. It requires SUPPRESSING an existing sibling node from the render tree
   (the mask itself), a first for this codebase's CSS-declaration-only
   Phase 5.5 pattern — closer in kind to the SVG-collapse work than to a
   simple decl addition.
4. The VECTOR/arbitrary-shape case needs an inlined SVG data URI, but this
   is de-risked by already-proven, already-shipped code
   (`server/figma-generate.js`'s `reconstructSvg`/`geometryArrays`) — reuse,
   not new invention.
5. LUMINANCE mode has zero real grounding anywhere and should not be built
   speculatively.

Net estimate: roughly 1.5-2x the size of the per-corner-radius or blur
items individually, comparable to building multi-fill support (which also
touched a structural assumption, per the roadmap's own "concentrated
regression risk" note on multi-fill). **Recommendation: document the design
(this file), do not schedule implementation until a real customer fixture
surfaces a non-degenerate mask usage** (different fill/geometry between
mask and masked layer, or an image-fill-based mask, which would be the
first real mask-is-load-bearing case seen in this project).

### Critical files for eventual implementation
- `compiler/ndg/ingest.js`
- `compiler/skeleton/build.js`
- `compiler/artifacts/ir-experimental-renderer.js`
- `compiler/emit/render/css-declarations.js`
- `server/figma-generate.js` (reusable `reconstructSvg`/`geometryArrays`)
