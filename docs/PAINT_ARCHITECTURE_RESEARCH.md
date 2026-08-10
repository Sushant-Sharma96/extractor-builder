# Paint Architecture Research

Research + architecture proposal only. No production code was changed to
produce this document — per the explicit instruction that triggered it:
the EXPLORE `86:62` multi-fill (SOLID+IMAGE) opacity/wash gap is not an
EXPLORE-specific bug, it is evidence of a missing architectural layer.
This document studies Figma's full Paint model, audits exactly what this
compiler currently preserves/loses/duplicates/guesses/hardcodes for paint
at every pipeline stage, and proposes a generic Paint Resolver architecture.
No implementation decision (wrapper elements, CSS-only, or another
rendering strategy) should be made until this document is reviewed.

---

## 1. Figma's Paint Model — the complete picture

A **Paint** in Figma is not "a color." It's a typed, orderable, independently-
resolved rendering instruction. Every node that can be painted (`fills`,
`strokes`, effects operate on similar but distinct structures) carries an
**array** of these, and the array's ORDER carries semantic meaning — later
entries paint on top of earlier ones, and each entry is independently
visible, independently blended, and independently opaque.

### 1.1 Paint stack ordering

`node.fills` is an array; Figma paints **index 0 first (bottom), last index
on top**. This is the single most load-bearing convention in the whole
model — every other paint field (opacity, blend mode) is defined *relative
to what's already been painted below it*, not relative to the node as a
whole. Reversing or ignoring this order silently inverts the visual stack
(this compiler already got this right for `paintCss()`'s multi-layer case —
`[...fills].reverse()` — but the fix's correctness depends on every
downstream consumer honoring the same convention, which, as this document
shows, not all of them do).

### 1.2 Multiple fills

A node can have any number of fills, each independently typed. There is
NO rule that fills must be homogeneous (all-solid, all-gradient) — a
`[SOLID, IMAGE]`, `[GRADIENT_LINEAR, SOLID, IMAGE]`, or `[IMAGE, IMAGE]`
(two differently-cropped copies of the same or different assets) stack are
all valid, common real-world Figma documents (a photo with a color-wash
overlay for text-legibility is one of the most common patterns in modern
UI design — exactly EXPLORE `86:62`'s case). Each fill also has its own
`visible` boolean — an invisible fill is skipped entirely, not "present but
transparent."

### 1.3 SOLID paints

`{ type: "SOLID", color: {r,g,b,a}, opacity, blendMode, visible,
boundVariables }`. The color's own `a` (alpha) is a separate concept from
the paint's `opacity` — Figma multiplies them together for final coverage
(`color.a * paint.opacity`). This compiler's `figmaColor()` already gets
this composition right.

### 1.4 IMAGE paints

`{ type: "IMAGE", imageRef, scaleMode, opacity, blendMode, visible,
imageTransform, scalingFactor, filters, boundVariables, rotation }`.
`scaleMode` is one of `FILL` (cover), `FIT` (contain), `CROP` (a custom
2×3 affine `imageTransform` positions/scales the image inside the box),
`TILE` (repeats at `scalingFactor`) — **and, confirmed by the real-data
census (Section 3), `STRETCH` is also a genuinely real, current REST value
in this corpus (58 occurrences) — not a legacy/plugin-API-only naming
artifact as originally assumed here.** The census additionally found that
`imageTransform` (41 occurrences, always non-identity) can co-occur with a
`scaleMode` of `FILL`/`STRETCH` — i.e., real crop/scale data is NOT gated
behind a literal `"CROP"`/`"TILE"` scaleMode string the way Section 1.12
originally assumed; any resolver logic must check for `imageTransform`'s
presence independently of `scaleMode`'s literal value. Unlike a SOLID
paint, an IMAGE paint's `opacity` does not affect a "color" — it affects
how much of what's painted BELOW it (in the SAME node's paint stack) shows
through the photo. This is the exact field EXPLORE `86:62` needs and
neither renderer currently reads at all.

### 1.5 Gradient paints (Linear, Radial, Angular, Diamond)

All four share `gradientStops` (an array of `{color, position}`, `position`
0-1 along the gradient's own axis) and `gradientHandlePositions` (an array
of `{x,y}` points in the node's own 0-1 normalized box space — NOT pixels).
The handle count and meaning differs per type:
- `GRADIENT_LINEAR` / `GRADIENT_ANGULAR`: 2 handles (start, end) define an
  axis. Angular additionally treats the stops as sweeping a full circle
  around handle 0 (a conic gradient), not a straight ramp.
- `GRADIENT_RADIAL`: 3 handles — center, and the ends of the two
  (potentially unequal, potentially non-axis-aligned) radii. A radial
  gradient whose two radius handles are NOT perpendicular is an ELLIPSE
  rotated off-axis — CSS `radial-gradient()` cannot express rotation at
  all, only an axis-aligned ellipse/circle. This is a genuine, permanent
  CSS-capability ceiling, not a bug — already correctly documented as such
  in this compiler's `radialGradientCss()`.
- `GRADIENT_DIAMOND`: also 3 handles, but the falloff is a diamond
  (Chebyshev/L∞ distance) shape, not an ellipse. **No CSS primitive
  produces a diamond gradient at all** — `conic-gradient`/`radial-gradient`
  are the closest approximations, and Figma's own web app + `figma-generate.js`
  (this project's LEGACY renderer, `gradientCss()` line 26) already
  approximates it as the same `radial-gradient()` used for RADIAL. This
  compiler's newer `ir-experimental` renderer does NOT do even this
  approximation — `singleFillLayerCss()` has no `GRADIENT_DIAMOND` branch
  at all, so it silently returns `null` (drops the whole fill) — a real
  regression versus the legacy path, not merely an unimplemented feature.

### 1.6 Image opacity vs. node opacity

Two entirely separate mechanisms, both real, both need independent CSS
expression:
- **Paint-level opacity** (`fills[i].opacity`) — "this one paint layer, at
  N%, blended with whatever's below it in THIS node's own stack."
- **Node-level opacity** (`node.opacity`) — "this entire node and
  everything painted inside/under it, as a group, at N% against whatever
  is behind the node in the page." Maps to CSS `opacity` on the node's own
  box.
This compiler's `layoutChoice.nodeOpacity` (node-level) is correctly wired
to CSS `opacity` in `modeDecls()`. Paint-level opacity is correctly wired
for SOLID (folded into `figmaColor()`'s alpha math) and for gradient stops
(`gradientStopsCss()` always passes `1` for a stop's own opacity — stops
don't have per-stop opacity in Figma's model, only per-color alpha, which
IS correctly read). It is **not** wired for IMAGE paints anywhere.

### 1.7 Blend modes

Also two separate mechanisms:
- **Node-level `blendMode`** — "this whole node/layer, composited against
  what's stacked behind it in the page" → CSS `mix-blend-mode`. Correctly
  wired in this compiler (`BLEND_MODE_CSS` table in `css-declarations.js`).
- **Paint-level `blendMode`** (`fills[i].blendMode`) — "this ONE fill
  layer, composited against the fill(s) already painted below it, within
  the SAME node's own paint stack" → CSS `background-blend-mode` is the
  matching primitive (applies per background-image layer, in the same
  bottom-to-top order as `background-image`'s own layer list). **Neither
  renderer reads paint-level `blendMode` anywhere** — every multi-fill
  stack is composited as if every paint were `NORMAL`, even when Figma
  declares e.g. `MULTIPLY` for one layer. **Confirmed zero real occurrences
  anywhere in the corpus** (Section 3's census: 0 of 2,904 paints) — safe
  not to build against speculatively.

### 1.8 Background color compositing

For a single SOLID fill, `background-color` is sufficient. For ANY multi-fill
stack, CSS has no way to make a gradient or image "the background color" —
only `background-image` (a list) can hold more than one visual layer, and
`background-color` can only ever be the single, bottom-most, non-repeating,
non-positioned layer underneath all `background-image` layers. This
compiler's `paintCss()` already understands this (single-SOLID case emits
`background-color`; everything else emits `background-image` layers) — the
gap is specifically that an IMAGE paint anywhere in the stack makes the
WHOLE multi-fill layering bail to `null` rather than degrading gracefully
(dropping just the image layer, or finding another way to express it).

### 1.9 Stroke + fill interaction

Fills and strokes are architecturally separate paint stacks on the same
node (`node.fills` vs `node.strokes`), each with their own type/opacity/
blend-mode/visibility rules — Figma does not "merge" them. A node can have
a gradient fill AND a gradient stroke, entirely independently. This
compiler's stroke path (`solidFillCss(node.attributes.strokes)`) only ever
reads the FIRST stroke and requires it to be `type:'SOLID'` — a gradient or
multi-entry stroke silently returns `null` (dropped) today, in both the
single-node path and the newly-consolidated `strokeDecls()` (Section 5.8's
first increment fixed `strokeAlign`, not stroke PAINT TYPE — a gradient
stroke was never in scope for that fix and remains unhandled).

### 1.10 Mask interaction

Already fully researched in a prior document
(`docs/MASK_RELATIONSHIP_DESIGN.md`) — masking is a SIBLING-relationship
concept (a node with `isMask:true` clips the run of siblings painted before
it), architecturally distinct from an individual node's own paint stack.
That document found zero real occurrences in the canonical 5-fixture corpus
and recommended deferring implementation until real, non-degenerate data
appears. Nothing in this document changes that conclusion — mask facts
still belong in Skeleton (per that document's proposal), not in a Paint
Resolver, since a mask is fundamentally about which SIBLINGS get clipped,
not about how one node's own paint stack resolves to CSS.

### 1.11 Image transforms

`imageTransform` — present specifically on `CROP` (a.k.a. `STRETCH` in some
API versions)-mode image paints, a 2×3 affine matrix
`[[a,b,c],[d,e,f]]` mapping normalized image space into the node's box.
`figma-generate.js` (legacy) already derives CSS `background-size`/
`background-position` from this matrix (Section above, `imageFillCss()`);
`ir-experimental` never reads it at all (the `<img>` tag it emits has no
mechanism to apply a matrix crop other than `object-fit`/`object-position`,
which cannot express skew/rotation, only uniform scale + 2D offset — a
CSS `<img>` element is fundamentally less expressive here than a
`background-image` layer with a transform-derived size/position, which is
part of why legacy's approach handles this case at all).

Separately, an image paint can ALSO carry its own `rotation` (radians) —
distinct from `imageTransform`'s affine (rotation is a simple case;
`imageTransform` is the general case, and Figma's docs are not fully
consistent about which takes precedence when both are present in different
API surfaces). Neither renderer reads it.

### 1.12 Scale modes (Fill, Fit, Crop, Tile)

Already covered above (1.4/1.11). Summary table:

| Figma `scaleMode` | Meaning | Legacy (`figma-generate.js`) | ir-experimental |
|---|---|---|---|
| `FILL` | cover, crop to fill box | `cover` | `object-fit:cover` (also the fallback default for everything else) |
| `FIT` | contain, letterbox | `contain` | `object-fit:contain` |
| `CROP`/`STRETCH` | custom affine crop | derives `background-size`/`position` from `imageTransform` | **ignored — falls to `cover`, wrong** |
| `TILE` | repeat at `scalingFactor` | `background-repeat:repeat` sized by `scalingFactor` | **ignored — falls to `cover`, wrong** |

### 1.13 Filters

An IMAGE paint can carry a `filters` object: `exposure`, `contrast`,
`saturation`, `temperature`, `tint`, `highlights`, `shadows` — Figma's own
non-destructive image adjustment sliders, each a signed float. CSS's
`filter` property (`brightness()`, `contrast()`, `saturate()`,
`sepia()`+`hue-rotate()` for temperature/tint, no direct highlights/shadows
equivalent) could express SOME of these approximately, but **neither
renderer reads this field at all** — confirmed absent from every grep
across both `server/figma-*.js` and `compiler/`. **Correction from the
real-data census (Section 3): this is NOT a zero-occurrence, low-priority
field as originally assumed — 19 real paints in the canonical corpus carry
a non-empty `filters` object**, using `saturation`/`contrast`/`highlights`/
`tint`/`exposure`/`temperature` (never `shadows`). This should be
re-ranked as a real, moderate-priority gap, not a speculative one.

### 1.14 Blur / Noise / Texture

`LAYER_BLUR`/`BACKGROUND_BLUR` are node-level `effects[]` entries (not
paint-stack members) — already correctly wired via `filter:blur()`/
`backdrop-filter:blur()` (`blurFiltersCss()`, Phase 5.5). Figma also has
`NOISE` and `TEXTURE` effect types (newer additions to the effects model,
used for grain/dithering overlays) — not currently read by
`boxShadowCss()`/`blurFiltersCss()`, and CSS has no direct primitive for
either (an SVG `feTurbulence` filter or a tiled noise PNG background would
be needed) — a genuine, likely LOW-priority gap given no real corpus
evidence either exists.

### 1.15 Variable bindings (paint tokens)

Figma's Variables feature lets any paint's `color` (or other numeric
fields) be bound to a variable instead of a literal value —
`boundVariables: { color: { type: "VARIABLE_ALIAS", id: "..." } }`, present
per-paint, alongside the node-level `boundVariables` NDG already ingests
(Section 3.2). When bound, the REST API's own literal `color` field still
reflects the variable's CURRENTLY-resolved value (so today's literal-value
reading never breaks), but the variable's identity/name is lost — a future
"generate CSS custom properties/design tokens instead of literal colors"
feature would need this, but nothing in the current pipeline needs it for
correct rendering today.

### 1.16 Paint inheritance

Figma has no "inherited paint" concept for ordinary nodes — every node's
`fills`/`strokes` are its own, explicit, complete array (never "inherit
parent's fill unless overridden"). The one place inheritance-like behavior
exists is **Component instance overrides** (Section 1.5.3/Phase 4 of the
existing roadmap) — an instance can override a specific fill's color, an
entirely separate mechanism (Component Recognition's `overrideEntries`,
already researched and partially wired in Phase 2.5/4) from the paint
STACK resolution this document is about. Out of scope here.

### 1.17 Future compatibility

Figma has shipped new paint-adjacent features over time (Variables/2023,
NOISE & TEXTURE effects/2024, and will likely continue). A resilient Paint
IR should preserve the RAW paint array structure through ingest (already
true — Section 3.1 confirms NDG does this) and let the Paint Resolver be
the ONE place that has to be updated when a new paint field/type ships —
not four different emission functions across two renderers, which is
exactly today's problem.

---

## 2. Current Implementation Audit — stage by stage

### 2.1 Capture (`server/figma-generate.js` / `server/figma-build.js` — the LEGACY renderer, kept as reference/fallback, not touched by this session's `ir-experimental` work)

This is not a distinct "Capture" transformation layer in this codebase —
raw Figma REST JSON reaches BOTH renderers essentially verbatim (no
intermediate paint normalization exists before either NDG or legacy's own
direct-on-raw-JSON code touches it). Legacy's `paintLayers()` (Section 1
above) is architecturally the most complete PAINT-SPECIFIC logic in the
whole codebase: it treats every fill type (SOLID/GRADIENT_*/IMAGE)
uniformly as a `background-image` layer (using a `background-color`
optimization only for a bottom-most solid with no image above it), which
is why it naturally supports arbitrary SOLID+IMAGE+GRADIENT stacking
without ever needing a wrapper element — IMAGE becomes a `__IMG__`
sentinel inside the SAME layer list, swapped for a resolved `url(...)`
later, not a separate DOM element at all. Legacy does NOT read paint-level
`opacity` for the IMAGE case, nor per-paint `blendMode`, nor `filters` —
so even this most-complete implementation has real, shared gaps with
ir-experimental (Section 1.6/1.7/1.13), just not the "opaque photo instead
of a tinted wash" bug, since that specific visual defect is caused by
having NO wash-color mechanism at all (ir-experimental's separate `<img>`
tag), not by ignoring opacity.

### 2.2 NDG (`compiler/ndg/ingest.js`)

**Fully preserving at this stage.** `paints: raw.fills` and
`strokes: raw.strokes` are verbatim array pass-throughs (line 62-63) — NOT
a filtered/mapped subset. Every field on every raw paint object survives
into `node.paints`/`node.attributes.strokes` unchanged: `type`, `color`,
`opacity`, `blendMode`, `visible`, `imageRef`, `scaleMode`, `imageTransform`,
`scalingFactor`, `filters`, `gradientStops`, `gradientHandlePositions`,
`boundVariables` — whatever Figma's REST API included is all there. **NDG
is not where paint information is lost.** The loss is entirely downstream,
in RENDER, which reads only specific named fields off each paint object and
ignores the rest.

Two related but distinct fields ARE captured at the node level (not
per-paint): `geometry.opacity` (node opacity), `geometry.blendMode` (node
blend mode) — both real, both correctly threaded to CSS today (Section 2.5).

### 2.3 Skeleton (`compiler/skeleton/build.js`)

**Zero paint semantics of its own.** Skeleton's only touch-point with
paint is `hasOwnVisualSignal()` (a BOOLEAN presence check:
`paints.length > 0 || strokes.length > 0 || effects.length > 0 || ...`),
used purely to decide "does this node have ANY visual meaning, for
structural-collapse-protection purposes" — it never inspects a paint's
TYPE, color, opacity, or resolves anything paint carries. This is correct
scoping for what Skeleton is for (structural role classification), but it
also means there is currently NO layer between raw paint data and CSS
generation that makes any paint DECISION — every paint interpretation
choice happens for the first and only time inside the render-emission
functions themselves.

### 2.4 Style Resolver (`compiler/emit/render/css-declarations.js`'s new `strokeDecls()`, Phase 8 increment 1 — the ONLY piece of a "Style Resolver" that exists today)

Scoped exclusively to `strokeAlign` consolidation (Section 5.8's tracked
bug, fixed this session) — it does not touch fill/gradient/blend-mode/
image resolution at all. This is the seed of the right architectural
pattern (one shared, pure decision function multiple emission sites call
instead of independently re-deciding) but covers only the narrowest
possible slice of "paint" as a whole.

### 2.5 Render (`compiler/artifacts/ir-experimental-renderer.js` + `compiler/emit/render/css-declarations.js`)

This is where every paint DECISION actually happens today, scattered
across ~8 independent functions/call-sites, each with its own partial view
of the paint stack:

| Function | Reads | Ignores | Emits |
|---|---|---|---|
| `solidFillCss(paints)` | first-and-only visible fill IF exactly 1 AND `type==='SOLID'` | any 2nd+ fill, any non-SOLID single fill, paint blendMode | `background-color`/text `color` string |
| `paintCss(paints, box)` | all visible fills, EVERY type EXCEPT bailing whole-stack on any IMAGE | paint-level `blendMode`, `GRADIENT_DIAMOND`, IMAGE `opacity`/`imageTransform`/`filters` | `background-image` layer list, or `background-color` for the single-SOLID case |
| `imageRefOf(node)` / `imageScaleModeOf(node)` (renderer, not css-declarations) | first visible IMAGE paint's `imageRef`/`scaleMode` ONLY | every sibling fill (SOLID/GRADIENT wash beneath it), the IMAGE paint's own `opacity`/`blendMode`/`imageTransform`/`filters`/`rotation` | sets `isImageFill`/`imageSrc` → a bare `<img src=...>`, no wrapper, no siblings rendered at all (`materialize-html.js` line 187-196 returns immediately, never rendering `node.children`) |
| `radialGradientCss()`/`singleFillLayerCss()` | LINEAR/ANGULAR/RADIAL Figma gradient handle+stop data | GRADIENT_DIAMOND (no branch at all — different from legacy, which approximates it), gradient rotation-off-axis for RADIAL (documented, accepted limitation) | `linear-gradient()`/`radial-gradient()` string |
| `modeDecls()`'s `mix-blend-mode` block | node-level `layoutChoice.blendMode` | paint-level blend mode entirely (no CSS `background-blend-mode` anywhere in the codebase) | `mix-blend-mode` |
| `modeDecls()`'s `opacity` block | node-level `layoutChoice.nodeOpacity` | — (this one is complete for its scope) | `opacity` |
| `strokeDecls()` (Phase 8 inc. 1) | first stroke's color/weight/strokeAlign, requires `type==='SOLID'` | any 2nd+ stroke, gradient-type stroke | `border`/`outline`+`outline-offset` |
| `imageScaleMode` → `object-fit` (`modeDecls()`) | `FIT` only | `CROP`/`TILE` (both fall to `cover`), `imageTransform`, `scalingFactor` | `object-fit` |

**What's duplicated**: paint-stack single-fill detection logic is
essentially re-implemented THREE times with slightly different rules —
`solidFillCss()` (requires exactly 1 fill, SOLID only), `paintCss()`
(handles 1-or-more, more permissive), and the image path (finds first
IMAGE regardless of stack position/count) — three functions independently
answering "what does this node's fill actually look like," each blind to
the other two's view of the SAME paint array.

**What's guessed**: nothing paint-specific is geometrically inferred (paint
is the one part of this pipeline that's ALL declared data, never
recognition/heuristics) — this is actually good news for a Paint Resolver:
unlike layout mode or component recognition, paint resolution needs zero
"confidence scoring" or competing-hypothesis logic. It is a pure, total
function of already-fully-preserved data.

**What's hardcoded**: the `object-fit` default (`cover` for anything not
explicitly `FIT`) is a hardcoded fallback masquerading as a decision for 2
real Figma scale modes (`CROP`, `TILE`) it doesn't actually implement.

---

## 3. Real-Data Grounding

A dedicated background audit scanned every cached Figma document available
to this compiler for actual real occurrences of every feature in Section 1
(full detail: `docs/PAINT_FEATURE_CENSUS.md`). Corpus: 14 valid, loadable
snapshots (`server/figma-snapshot.js`'s own `complete:true` filter), the
same 5 fileKeys as `docs/MASK_RELATIONSHIP_DESIGN.md`, 3,490 unique nodes.
An orphaned root-level `.figma-cache/` (1,975 nodes, confirmed never read
by the running compiler) and a 6th, un-loadable fileKey
(`gqBQqngQnWdcl0LGTx8MzW`, missing `metadata.json`) were checked separately
and are called out below only where they contain genuinely new signal.

**Common / real — the Paint Resolver must handle these well:**
- Single fill per node (2,290/3,490 nodes) is overwhelmingly the norm.
  0-fill is also common (1,197). **2+ fills is a true edge case: 3 nodes
  total** — 2× `SOLID+IMAGE` (node `86:62`, the case that triggered this
  whole research, and node `1118:50063`) and 1× `IMAGE+IMAGE`
  (`1:374`). No `SOLID+SOLID`, `GRADIENT+GRADIENT`, or 3-way stack exists
  anywhere. So the SOLID+IMAGE gap is real and recurring (not a one-off),
  but genuinely rare relative to the whole corpus (0.09% of nodes) —
  worth fixing properly (per the instruction: "our goal is not to fix one
  node"), but not the single highest-frequency gap found.
- `GRADIENT_LINEAR` (45 paints) and `GRADIENT_ANGULAR` (6) are real,
  expressed via `gradientHandlePositions` (3 `{x,y}` points) — **not** a
  `gradientTransform` matrix (0 occurrences of that field anywhere; a
  correction to how Section 1.5 should be read). 52 of 53 gradients are
  axis-aligned; exactly 1 is a genuine ~45° diagonal (node `1118:50900`,
  "Meetups"). **Positive finding, not a gap**: this codebase's own
  `gradientAngleDeg()` (`css-declarations.js`) already computes the angle
  via `atan2(dy,dx)` on the real handle vector — it was never hardcoded to
  axis-aligned cases, so the one real diagonal gradient in the corpus is
  almost certainly ALREADY rendered correctly today. Worth a direct
  regenerate-and-check rather than assuming a gap here.
- Per-paint opacity on `SOLID` (304 paints, fills+strokes, including a
  real `opacity:0` fully-transparent case) is common; node-level
  `opacity !== 1` (78 nodes) is common and independent of it. Both already
  correctly handled by existing code (Section 2.5).
- Stroke+fill co-occurrence (311 nodes) is common; non-`INSIDE`
  `strokeAlign` is ~31-46% of real strokes (already fixed, Phase 8
  increment 1) — this census independently re-confirms that fix's
  priority was correctly assessed.
- `imageTransform` (41 paints, **always non-identity** — every real
  occurrence is a genuine crop/scale, never a leftover default) and
  `scaleMode: FILL` (124)/`STRETCH` (58) are both real and common. `FIT`/
  `CROP`/`TILE` never occur as literal `scaleMode` strings — but
  `imageTransform` itself is present regardless (see Section 1.4's
  correction). **This is a bigger, more common real gap than the
  SOLID+IMAGE wash case** — 41+ nodes render with a wrong crop/position
  today, vs. 2 nodes for the wash case.
- Image `filters` (19 paints — `saturation`/`contrast`/`highlights`/
  `tint`/`exposure`/`temperature`, never `shadows`) — real, not zero as
  originally assumed in Section 1.13.
- `DROP_SHADOW` (34) is the only effect type present in the loadable
  corpus — already fully handled.

**Zero anywhere (canonical + orphaned) — confirmed safe not to build:**
`GRADIENT_DIAMOND`; non-`NORMAL` blend mode at the **paint** level (0 of
2,904 paints — blend-mode variation in this corpus is exclusively
node-level, e.g. 115 `MULTIPLY` nodes confined to one icon fixture); any
3-fill+ stacking; image `rotation`; `filters.shadows`; `NOISE`/`TEXTURE`
effects; and **any** `boundVariables` bound to a paint/color field (node-
level variable bindings are real — 50 nodes — but exclusively on
layout/typography properties, never `fills`/`strokes`).

**Zero in the loadable canonical corpus, but real in excluded/orphan data
— flag for awareness, do not build against yet:** `INNER_SHADOW` and
`BACKGROUND_BLUR` (both already have working code paths, per Section
2.5/1.14 — just unexercised by the current loadable corpus) and a novel
`GLASS` effect type (not currently handled by anything) — all three found
only in the un-loadable `gqBQqngQnWdcl0LGTx8MzW` snapshot.

This materially changes the phased-rollout priority in Section 5.4 below
— see the updated ordering there.

---

## 4. Root Cause Synthesis

The multi-fill SOLID+IMAGE gap that triggered this research is not a bug
in one function — it's the predictable consequence of THREE independent,
partial paint-stack readers (Section 2.5's table) each answering a
narrower question than "what is this node's fully-resolved paint stack,"
with no single place that has ever seen the WHOLE stack and decided how it
should render, once. Every one of this project's already-shipped Phase
5.5 fixes (radial gradient, multi-fill non-image, per-corner radius, blur)
independently proved the pattern "ingest already preserves this, render
just never read it" — paint is the clearest, most complete instance of
that pattern in the whole codebase, because NDG's ingest (Section 2.2) is
already 100% lossless for it. This is a resolution-architecture problem,
not a data-availability problem — exactly the shape of problem a Style/
Paint Resolver stage exists to close, per this document's Section 1.5.4
origin story.

The `strokeAlign` fix (Phase 8 increment 1) already validated the general
pattern at small scale: extract one shared decision function, have every
call site consume it instead of re-deciding. A Paint Resolver is the same
pattern, generalized to the full paint stack instead of one property.

---

## 5. Proposed Paint Resolver Architecture

```
Raw Paints (NDG's node.paints / node.attributes.strokes — already
verbatim, already lossless — Section 2.2)
  ↓
Paint IR (a normalized, typed, ordered representation of every paint —
  see 5.1 — built ONCE per node, mechanically, no interpretation)
  ↓
Paint Resolver (the ONE place every paint DECISION is made — see 5.2 —
  consumes Paint IR, resolves overlapping concerns like "single-SOLID
  optimization" or "IMAGE needs a real element," and produces:)
  ↓
Resolved Paint Facts (a final, CSS-property-shaped object per node — see
  5.3 — Render has NOTHING left to decide, only to print)
  ↓
Renderer (mechanical only — reads Resolved Paint Facts, emits `<img>`/
  `background-color`/`background-image`/`border`/`outline`/`filter`/
  `mix-blend-mode`/`opacity` declarations verbatim; NEVER inspects
  node.paints or node.attributes.strokes directly again)
```

### 5.1 Paint IR — normalized, typed, ordered

A single function, `buildPaintIr(node)`, replacing the ad hoc
`solidFillCss()`/`paintCss()`/`imageRefOf()`/`imageScaleModeOf()` readers,
producing one array per paint stack (`fills`, `strokes` — same shape for
both, since Section 1.9 established they're structurally identical
concerns):

```
PaintLayer {
  kind: 'solid' | 'gradient-linear' | 'gradient-radial' | 'gradient-angular'
      | 'gradient-diamond' | 'image',
  visible: boolean,           // already-resolved: raw visible !== false
  opacity: number,            // paint-level opacity, always resolved (default 1)
  blendMode: string | null,   // paint-level blendMode, CSS-mapped name or null for NORMAL
  // kind-specific payload, verbatim-preserved raw fields — never partially read:
  color?: {r,g,b,a},                          // solid
  stops?: Array<{color, position}>,             // any gradient kind
  handles?: Array<{x,y}>,                       // any gradient kind
  imageRef?: string,                            // image
  scaleMode?: 'FILL'|'FIT'|'CROP'|'TILE',       // image
  imageTransform?: number[][],                  // image, CROP mode
  scalingFactor?: number,                       // image, TILE mode
  rotation?: number,                            // image
  filters?: {exposure,contrast,saturation,...}, // image
  boundVariables?: object,                      // any kind (future tokens use)
}
```

This is a MECHANICAL, total, non-lossy re-shaping of what NDG already
hands render — no new information, no interpretation, just a normalized
common shape so the Resolver (5.2) doesn't have to re-detect "which kind
of paint is this" itself.

### 5.2 Paint Resolver — the one place every decision is made

`resolvePaint(paintIr, box, nodeOpacity, nodeBlendMode)` — pure function,
unit-testable in total isolation from string generation (matching this
project's own stated Phase 8 verification approach). Responsibilities,
each currently scattered across the table in Section 2.5:

1. **Fill-stack strategy decision**: single-SOLID → `background-color`;
   any gradient-only stack (no IMAGE) → layered `background-image`
   (existing, already-correct logic, just relocated here unchanged);
   **any stack containing an IMAGE paint → a distinct `image` strategy**
   that carries EVERYTHING the renderer needs to build the correct DOM/CSS
   combination (Section 5.3's `imageStrategy` field) — this is the
   specific decision that closes the SOLID+IMAGE gap, made ONCE, here,
   instead of never being made anywhere.
2. **Stroke-stack strategy decision**: reuses the identical logic as fill
   (a stroke IS a paint stack, Section 1.9) — this also, for free, extends
   `strokeDecls()`'s existing strokeAlign fix to gradient/multi-entry
   strokes, closing 2 more small gaps from Section 6.2's property matrix
   without new code, just relocation.
3. **Blend-mode resolution**: paint-level blend modes become
   `background-blend-mode` (a comma-separated list, same order as
   `background-image`'s own layers) — net-new capability, not currently
   emitted anywhere.
4. **Opacity composition**: node-level opacity stays `opacity` (unchanged,
   already correct); paint-level opacity for SOLID/gradient stays folded
   into color alpha (unchanged, already correct); paint-level opacity for
   IMAGE becomes a real, resolved fact for the first time (Section 5.3).
5. **Scale-mode resolution**: `CROP`/`TILE` finally get real handling
   (deriving size/position/repeat the way legacy's `imageFillCss()`
   already proves is possible), not a silent `cover` fallback.

### 5.3 Resolved Paint Facts — what Render actually consumes

```
ResolvedPaintFacts {
  background: { prop: 'background-color'|'background-image', value: string } | null,
  backgroundBlendMode: string | null,        // background-blend-mode, when 2+ non-image layers blend non-normally
  border: {...} | null, outline: {...} | null,  // from the stroke-stack resolution (5.2.2)
  imageStrategy: null | {
    // Populated ONLY when the paint stack contains an IMAGE — this is the
    // fact that was missing entirely before this document.
    src: string,               // resolved URL/data-uri (unchanged from today)
    opacity: number,           // the IMAGE paint's own opacity — NEW
    objectFit: string,         // now correctly covers CROP/TILE, not just FILL/FIT
    objectPosition: string | null,  // NEW — derived from imageTransform for CROP
    washBehind: { prop, value } | null,  // the SOLID/gradient fill(s) BELOW the
                                          // image in the same stack, resolved
                                          // exactly like `background` above —
                                          // THIS is what was silently dropped
                                          // for EXPLORE 86:62. Render decides
                                          // (only mechanically, per 5.3's own
                                          // "never interpret" rule) whether to
                                          // express it as a wrapper background
                                          // or something else — see Section 6.
  },
  filter: string | null, backdropFilter: string | null,  // unchanged (already correct)
}
```

The critical architectural rule the user's own framing states explicitly:
**the renderer must never interpret paint stacks — it should only consume
resolved paint facts.** Concretely: after this Resolver exists, no future
`ir-experimental-renderer.js` or `css-declarations.js` code should ever
call `node.paints.find(...)`/`.filter(...)` again. Every one of today's 8
scattered read-sites (Section 2.5's table) collapses into ONE call to
`resolvePaint()` per node, whose OUTPUT every emission function reads by
plain field access, never re-deriving.

### 5.4 Where this fits the existing roadmap

This slots into `docs/COMPILER_REDESIGN_ROADMAP.md` Section 5.8 (Style
Resolver) as a NAMED SUB-SYSTEM of that phase — Style Resolver's stated
scope was always "consolidate every upstream-resolved fact... into ONE
final, fully-decided style-fact object per node," and Paint is one of
those facts (alongside Skeleton role, Sizing, Responsive strategy, etc.).
`strokeDecls()` (Phase 8 increment 1) was the first, narrowest piece of
this same consolidation; a full `resolvePaint()` is the natural, larger
next piece — not a competing or parallel architecture.

Proposed phased rollout, **re-ordered by the real-data census (Section 3)
rather than assumed priority**:
1. `buildPaintIr()` — mechanical, zero behavior change, unit-testable
   against every real fixture's actual paint data.
2. `resolvePaint()`'s fill-stack + stroke-stack decisions, WITHOUT the new
   `imageStrategy.washBehind`/`opacity` fields yet — a pure relocation of
   already-correct logic (`solidFillCss`/`paintCss`/`strokeDecls`), verified
   byte-identical against all 6 fixtures before anything new is added
   (same discipline as every Kernel Integration slice this session).
3. **`imageTransform`-aware crop/scale resolution** (Section 1.4/1.12,
   1.11) — re-ranked ABOVE the SOLID+IMAGE wash fix: 41 real paints (all
   non-identity) render with a wrong crop/position today, an order of
   magnitude more nodes than the wash case affects (2). Legacy's
   `imageFillCss()` already proves the derivation is straightforward
   (Section 2.1) — this is closer to a "relocate already-proven logic"
   increment than new invention.
4. Image `filters` (19 real paints, `saturation`/`contrast`/`highlights`/
   `tint`/`exposure`/`temperature` → CSS `filter:saturate()/contrast()/...`
   approximations) — real, moderate-frequency, previously mis-assessed as
   zero-occurrence in the pre-census draft of this document.
5. THEN the SOLID+IMAGE wash + IMAGE-paint-opacity fix (`imageStrategy`'s
   `opacity`/`washBehind` fields) — real (3 recurring nodes across the
   corpus, not a one-off), but the rarest of the four real gaps above by
   node count. Rendering strategy (Section 6) still deferred until this
   document is reviewed.
6. Diagonal-gradient handling: **likely already correct** (verify via
   direct regen of the one real node, `1118:50900`, before assuming any
   work is needed at all — `gradientAngleDeg()` was never hardcoded to
   axis-aligned cases).
7. Blend-mode (`background-blend-mode` at the paint level) and
   `GRADIENT_DIAMOND`: **zero real justification found** — do not build;
   keep documented here for the next time a real occurrence appears
   (matching this project's LUMINANCE-mask precedent exactly).

---

## 6. Open Question Deliberately Left Unresolved

Per the instruction that produced this document, the actual DOM/CSS
mechanism for expressing `imageStrategy.washBehind` (wrapper `<div>` +
`opacity` on a child `<img>`, vs. legacy's `background-image`-layer-with-
`__IMG__`-sentinel technique reused for ir-experimental, vs. some other
approach) is explicitly NOT decided here. Both real, viable options exist
in this very codebase already (Section 2.1 documents legacy's working
technique) — the tradeoff is DOM semantics/accessibility (ir-experimental's
real `<img>`+`alt` text, which legacy's background-image approach doesn't
have at all) versus implementation simplicity (legacy's approach needs no
wrapper element). This is exactly the decision to make AFTER this
architecture is reviewed, not before.
