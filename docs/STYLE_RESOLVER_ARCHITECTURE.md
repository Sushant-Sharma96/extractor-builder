# Style Resolver Architecture — the complete Visual Style layer

Research + architecture only. No production code changes here. This
document generalizes `docs/PAINT_ARCHITECTURE_RESEARCH.md` — Paint is one
subset of a larger problem: **every** visual property this compiler emits
is decided by scattered, partial, sometimes-duplicated logic spread across
`ir-experimental-renderer.js`, `css-declarations.js`, and
`materialize-html.js`, with no single place that has ever seen a node's
COMPLETE resolved visual identity before Render prints it. This document
is the complete specification of `docs/COMPILER_REDESIGN_ROADMAP.md`
Section 5.8 (Style Resolver) — Paint Architecture Research's Paint Resolver
is one subsystem of it, not a competing design. No implementation should
begin until this is reviewed.

**Explicit rule this document is designed to satisfy**: the renderer must
never interpret raw Figma visual properties directly. It consumes only
resolved Style Facts. One source of truth per property, no matter how many
places in the DOM tree that property ends up applied.

---

## 1. Relationship to prior research (do not re-derive, reference)

- `docs/PAINT_ARCHITECTURE_RESEARCH.md` — the complete treatment of paints
  (all types), multiple fills, multiple strokes' PAINT aspect, gradient
  types, node vs. paint opacity, node vs. paint blend mode, image
  transforms/scale-modes/filters, per-paint variable bindings. Its
  `resolvePaint()` proposal is **Section 3.2 below**, verbatim, not
  repeated.
- `docs/PAINT_FEATURE_CENSUS.md` — real-occurrence counts backing every
  paint-adjacent claim in this document; also already covers node-level
  `boundVariables` (Section 6 below) and `strokeAlign` distribution
  (Section 3.3 below).
- `docs/MASK_RELATIONSHIP_DESIGN.md` — the complete mask-relationship
  design (Section 4 below is a two-paragraph integration summary, not a
  re-derivation). Recommendation stands: document only, zero real
  non-degenerate occurrences.
- `docs/PROPERTY_PRESERVATION_AUDIT.md` — the original preserved/
  approximated/dropped/inferred property census this whole effort started
  from; typography's "Done" verdict there is re-verified and narrowed in
  Section 5 below (whole-node typography is genuinely complete; per-run
  typography is not, a new finding).
- `docs/COMPILER_REDESIGN_ROADMAP.md` Section 6 (CSS Property Preservation
  Matrix) and Section 5.8 (Style Resolver's original, abstract definition)
  — this document supersedes Section 5.8's abstract description with a
  concrete contract and pipeline.

---

## 2. The complete StyleFacts contract

One object per node, produced by ONE resolver call, consumed by Render and
NOTHING else touches `node.paints`/`node.attributes.*` visual fields ever
again:

```
StyleFacts {
  // === 2.1 Fill / Stroke (docs/PAINT_ARCHITECTURE_RESEARCH.md Section 5.3, unchanged) ===
  background: {prop, value} | null,
  backgroundBlendMode: string | null,
  border: {...} | null,
  outline: {...} | null,
  imageStrategy: {...} | null,   // src, opacity, objectFit, objectPosition, washBehind

  // === 2.2 Shape (NEW — Section 3 below) ===
  borderRadius: string | null,        // uniform OR per-corner "tl tr br bl", already-correct mapping relocated
  cornerSmoothing: number | null,     // 0-1, RESOLVED but Render may still choose not to emit (no CSS primitive — Section 3.4)
  clipContent: boolean,               // clipsContent -> overflow:hidden, relocated (Section 3.5)

  // === 2.3 Effects (NEW — Section 3 below) ===
  boxShadow: string | null,           // DROP_SHADOW + INNER_SHADOW, relocated unchanged
  filter: string | null,              // LAYER_BLUR (+ future: image filters, Paint doc Section 1.13)
  backdropFilter: string | null,      // BACKGROUND_BLUR, relocated unchanged

  // === 2.4 Compositing (docs/PAINT_ARCHITECTURE_RESEARCH.md, cross-referenced) ===
  opacity: number | null,             // node-level, relocated unchanged
  mixBlendMode: string | null,        // node-level, relocated unchanged

  // === 2.5 Typography (NEW — Section 5 below) ===
  typography: {
    fontFamily, fontWeight, fontSize, lineHeight, letterSpacing,
    textAlign, textTransform, textDecoration, fontStyle,
  } | null,                           // whole-node — relocated unchanged, already complete
  textRuns: Array<{                   // NEW — per-character-run, closes 2 real gaps (Section 5.2)
    text: string,
    style: (same shape as `typography` above, all fields optional) | null,
  }>,

  // === 2.6 Mask (docs/MASK_RELATIONSHIP_DESIGN.md's proposed maskFact, unchanged — Section 4) ===
  mask: { role: 'mask-shape'|'masked', maskedNodeIds?, maskType, maskShape } | null,

  // === 2.7 Provenance (NEW — Section 7, "no duplicated logic" enforcement) ===
  sources: { [fieldName]: 'declared'|'component-override'|'responsive-override'|'default' },
}
```

Every field above already has an EXISTING, already-correct computation
somewhere in the codebase (Section 3/5's tables cite exactly where) — this
contract's job is consolidation, not invention. The one genuinely new
CAPABILITY (not just relocation) is `imageStrategy`'s `washBehind`/
`opacity` (Paint doc) and `textRuns`' per-run `textTransform`/
`STRIKETHROUGH` (Section 5.2, closes a real, previously-uncatalogued gap).

---

## 3. Shape & Effects — audit (the categories Paint Architecture Research didn't cover)

### 3.1 Border radius (uniform + per-corner)

Already fully resolved logic, already correct, currently living inline in
`modeDecls()` (`css-declarations.js` ~line 393-403): uniform `cornerRadius`
→ `border-radius:Npx`; per-corner `rectangleCornerRadii` (Figma's own
`[TL,TR,BR,BL]` order, already matching CSS's shorthand order, no
reordering needed) → `border-radius: tl tr br bl`. Relocation-only, zero
behavior change expected.

### 3.2 Paints — see `docs/PAINT_ARCHITECTURE_RESEARCH.md` in full. Not repeated here.

### 3.3 Stroke alignment, dashes, caps, joins

- **strokeAlign** — already fixed and consolidated (Phase 8 increment 1,
  `strokeDecls()`) into exactly the shared-function pattern this whole
  document generalizes. Real-data confirmed common (Paint census: 862
  OUTSIDE + 409 CENTER of 4,132 total `strokeAlign` occurrences, ~31%).
  `strokeDecls()` becomes `resolveStroke()`'s output under this
  architecture — same logic, folded into the bigger contract, not redone.
- **strokeDashes** — already correctly mapped to `border-style:dashed`
  (an intentional, documented approximation — CSS borders cannot express
  exact dash/gap lengths). Relocation-only.
- **strokeCap / strokeJoin** — ingested (`ndg/ingest.js`, confirmed
  "real, confirmed-populated fields") but **never emitted anywhere** —
  already correctly scoped in the existing roadmap (Section 6.2) as
  meaningless for a plain CSS `border`/`outline` (round/square/arrow
  cap-and-join styling only has meaning for an SVG `<path>` stroke, i.e.
  the `reconstructSvgMarkup()` path, not `css-declarations.js`). This
  remains true under the new architecture: `StyleFacts` should carry these
  two fields through (so the SVG-reconstruction path, which sits OUTSIDE
  `css-declarations.js`, has one place to read them from too) but Render's
  plain-CSS emission path has legitimately nothing to do with them — not a
  gap, a scope boundary, cited explicitly so it isn't mistaken for an
  oversight later.

### 3.4 Corner smoothing ("squircle")

`cornerSmoothing` (0-1 float) is ingested, never emitted — **no CSS
primitive exists** for Figma's iOS-style continuous-corner-radius curve;
the only way to express it is a computed superellipse SVG path fed to
`clip-path:path(...)`, a nontrivial per-node computation with no existing
precedent anywhere in this codebase. Already correctly scored
**OPTIONAL/LOW** in the existing roadmap (Section 6.3) on architecture-cost
grounds alone, independent of frequency. Under the new architecture, this
becomes a field the Resolver ALWAYS resolves (mechanically reading the raw
value — free, since ingest already preserves it) but Render is explicitly
permitted to leave un-rendered — the ONE field in the whole `StyleFacts`
contract with a documented "resolved but intentionally not consumed"
status, until/unless a real fixture justifies the SVG-path investment.

### 3.5 Clip content

`clipsContent` → `overflow:hidden`, a plain boolean-to-single-value map,
already correct, but genuinely present at **two independent call sites**
today: `canvasDecls()` (root/page canvas) and `modeDecls()` (every other
node) — both hardcode the identical `['overflow','hidden']` pair. Low risk
today (nothing about the mapping could diverge, since it's a boolean, not
a multi-way choice) but still two places that would need to change in
lockstep if this mapping ever became conditional (e.g. a future
`overflow:clip` vs `overflow:hidden` distinction) — a small, low-priority
instance of the exact duplication pattern this whole document exists to
close. Consolidates trivially: `StyleFacts.clipContent` (boolean), Render
reads it from ONE place in both the canvas and per-node emission paths.

### 3.6 Shadows (drop, inner) and blur (layer, background)

Already fully resolved, already correct, already unit-tested
(`boxShadowCss()`/`blurFiltersCss()`, Phase 5.5). Real-data confirmed:
`DROP_SHADOW` is common (34 occurrences, Paint census); `INNER_SHADOW`/
`BACKGROUND_BLUR` have working code but zero occurrences in the loadable
corpus (real in excluded orphan data only — Paint census Section 9).
Relocation-only.

---

## 4. Mask — integration summary (full design: `docs/MASK_RELATIONSHIP_DESIGN.md`)

Masking is a cross-SIBLING relationship, not a single-node paint decision
— architecturally distinct from every other category in this document,
which is why it was researched as its own document rather than folded
into Paint Architecture Research. Under the unified `StyleFacts` contract,
a resolved `maskFact` (same shape that document proposed, attached via
Skeleton) becomes just ANOTHER field on the same per-node object Render
reads — no special-casing needed at the Render layer, it's simply present
or `null` like every other field. Recommendation unchanged: zero real
non-degenerate occurrences in the canonical corpus — document the contract
slot, do not implement resolution logic until real data justifies it.

---

## 5. Typography — full audit (NEW, not covered by prior research)

### 5.1 Whole-node typography — complete, correct, currently scattered across 2 files

`css-declarations.js`'s `modeDecls()` (~line 508-535) already correctly
emits: `font-family` (with `sans-serif` fallback), `font-weight`,
`font-size`, `line-height`, `letter-spacing`, `text-align` (CENTER/RIGHT/
JUSTIFIED — LEFT is CSS's own initial value, correctly left unset rather
than emitting a redundant declaration), `text-transform` (Figma's
`textCase` UPPER/LOWER/TITLE → uppercase/lowercase/capitalize),
`text-decoration` (UNDERLINE/STRIKETHROUGH → underline/line-through). This
is a genuinely complete, correct implementation — the Property
Preservation Audit's "Done" verdict for whole-node typography holds. Pure
relocation into `StyleFacts.typography`, zero behavior change expected.

### 5.2 Per-character-run typography — real, previously-uncatalogued gaps found during this audit

`materialize-html.js`'s `textRuns()`/`runStyleCss()` (a SEPARATE, smaller
re-implementation of "turn a style object into CSS," for the
`characterStyleOverrides`/`styleOverrideTable` per-run-override case) is
NOT the same code as `modeDecls()`'s whole-node path, and does not cover
the same ground:

| Field | Whole-node (`modeDecls`) | Per-run (`runStyleCss`) |
|---|---|---|
| `color` | via `fillCss`/paint resolution | ✅ (reads the run's own `fills`) |
| `fontWeight` | ✅ | ✅ |
| `fontStyle`/italic | *(not modeled — no real occurrence flagged previously)* | ✅ |
| `fontSize` | ✅ | ✅ |
| `letterSpacing` | ✅ | ✅ |
| `fontFamily` | ✅ | ✅ |
| `textDecoration` | ✅ UNDERLINE **and** STRIKETHROUGH | ⚠️ **UNDERLINE only — STRIKETHROUGH silently dropped per-run** |
| `textCase`/`text-transform` | ✅ UPPER/LOWER/TITLE | ❌ **not read at all, per-run** |
| `lineHeight` | ✅ | ❌ *(arguably correct to omit — line-height is rarely meaningful per-run within a single line-box, but this is a scope decision that was never made explicitly; worth confirming, not assuming)* |
| `textAlign` | ✅ | *(not applicable per-run — paragraph-level, correctly out of scope)* |

**This is a real, concrete instance of the exact problem this whole
document exists to close**: two independent, partial implementations of
"Figma text style → CSS," neither one a superset of the other, that
happened to diverge silently because nothing ever compared them side by
side until this audit. Under the unified architecture, both collapse into
ONE shared style-object-to-CSS-declarations function (call it
`typographyDeclsFrom(styleFacts)`), used identically for the whole-node
case AND to build each run's own inline `<span style="...">` — closing the
STRIKETHROUGH and textCase per-run gaps as a natural, zero-extra-design-
cost consequence of unification, not a separately-scoped fix.

**Real-data check (closing this section's own open question):** scanned
every `styleOverrideTable` across the full `output/figma-cache` corpus —
38 real override tables exist, but **zero** contain a per-run
`textDecoration:"STRIKETHROUGH"` or a non-`"ORIGINAL"` `textCase`. The code
divergence is real and confirmed (a future per-run override with either
field WOULD render wrong today), but nothing in the current corpus
actually exercises it. Per this project's established practice, this
narrows the fix from "urgent, systemic" to "correct to unify (since it's
free once `resolveTypography()` exists anyway), but not itself a
frequency-driven priority" — cited accurately in Section 8.2's migration
order below rather than overstated.

### 5.3 `textAlignVertical` — genuinely dropped, different mechanism needed

Ingested (`ndg/ingest.js`), confirmed dropped (Property Preservation
Audit). Figma's vertical text alignment (TOP/CENTER/BOTTOM within the
text box) has no single matching CSS text property — it requires either
`display:flex; align-items:...` on the text node's own box (if it can
become a flex container, which changes its box model) or (for a
single-line case) `line-height` tricks. This is a real gap, but the fix
mechanism is architecturally different from every other typography field
(a box-model/layout decision, not a text-run decoration), so `StyleFacts`
should carry `textAlignVertical` as a resolved fact, but its consumption
belongs in the SIZING/layout resolution path, not the typography-decls
function above — flagged for cross-domain awareness, not assigned to this
document's typography section to "solve."

---

## 6. Variable bindings (general, not just paint)

Already censused (`docs/PAINT_FEATURE_CENSUS.md` Section 10): 50 nodes
have node-level `boundVariables`, exclusively on `itemSpacing`, `maxWidth`,
`lineHeight`, `letterSpacing`, `fontSize`, `strokeWeight`, `opacity` — real
layout/typography tokens, never a paint/color binding. Today, NDG ingests
`boundVariables` verbatim (lossless) but nothing anywhere reads it — every
consumer reads only the raw literal value the REST API also provides
alongside the binding (Figma always includes both). This means **current
rendering is already visually correct** even for variable-bound nodes
(the literal value IS the resolved value at export time) — the gap is
only in NOT knowing a value came from a token, which matters for a future
"emit CSS custom properties instead of literal values" feature, not for
today's pixel fidelity. Correctly out of scope for `StyleFacts` v1 (per
this document's own "resolved facts, not speculative future features"
discipline) — noted here so it isn't rediscovered as a surprise later.

---

## 7. Component overrides — interaction with StyleFacts

Component Recognition (Phase 2.5/4, already implemented) resolves
`overrideEntries` — `{key, value}` pairs an instance declares against its
definition, currently scoped to text `characters` overrides only
(confirmed via the existing `component.test.js` fixture). Under the
unified architecture, an override is conceptually just an alternate SOURCE
for any `StyleFacts` field, not a separate mechanism — this is exactly why
`StyleFacts.sources` (Section 2.7) exists: for any given node/field pair,
the Resolver records whether the final value came from the node's own
declared data, a component-instance override, a responsive-breakpoint
override, or an unresolved default. This is the SAME "declared beats
inferred, but now also: override beats declared" precedence rule already
established elsewhere in this project (Research Part 7.5.4), generalized
to cover every field a Style Resolver can produce, not just component
`characters` overrides. No new merge logic is invented here — this section
states the RULE (override provenance must be tracked per-field, not just
per-node) that Section 8's pipeline design must satisfy.

---

## 8. The unified pipeline

```
NDG (per-node raw facts — already 100% lossless for every category above,
     confirmed per-category in Sections 3/5/6 and the Paint doc)
  ↓
Per-domain IR builders (mechanical, total, no interpretation — one per
  category, callable/testable independently):
    buildPaintIr(node)        — fills + strokes, Paint doc Section 5.1
    buildShapeIr(node)        — cornerRadius/rectangleCornerRadii/cornerSmoothing/clipsContent
    buildEffectsIr(node)      — effects[] (shadow/blur), unchanged shape
    buildTypographyIr(node)   — whole-node style + characterStyleOverrides/styleOverrideTable
    buildMaskIr(graph)        — cross-sibling, docs/MASK_RELATIONSHIP_DESIGN.md (only one that isn't per-node)
  ↓
Style Resolver — ONE function, `resolveStyle(node, {paintIr, shapeIr,
  effectsIr, typographyIr, maskFact, componentClaim, responsiveAdaptation,
  nodeOpacity, nodeBlendMode})` — pure, total, unit-testable against
  StyleFacts objects alone (no CSS strings), per Phase 8's own
  already-stated verification approach. This is where EVERY decision in
  Sections 2-7's tables happens, exactly once:
    - resolvePaint()      (Paint doc Section 5.2, unchanged)
    - resolveStroke()     (subsumes strokeDecls(), extended to caps/joins passthrough)
    - resolveShape()      (border-radius + corner smoothing + clip)
    - resolveEffects()    (box-shadow + filter/backdrop-filter)
    - resolveTypography() (whole-node AND per-run, same function — Section 5.2's fix)
    - resolveMask()       (thin pass-through of Skeleton's maskFact, if present)
    - precedence merge    (Section 7: override > responsive > declared > default,
                            recorded per-field into `.sources`)
  ↓
StyleFacts (Section 2's contract — the ENTIRE visual identity of one node,
  fully decided, nothing left ambiguous)
  ↓
Renderer (mechanical only): `buildDecls()`/`modeDecls()`/`materialize-html.js`
  read StyleFacts fields by plain property access. They NEVER call
  `node.paints.find(...)`, `node.attributes.strokes`, `node.geometry.*`,
  or `node.characterStyleOverrides` again — every one of those reads
  relocates into the per-domain IR builders above, exactly once each.
```

### 8.1 Why per-domain IR builders, not one monolithic reader

Mirrors the same reasoning `docs/PAINT_ARCHITECTURE_RESEARCH.md` Section
5.1 already gave for Paint specifically, generalized: each IR builder is
independently testable against real fixture data, independently owns one
category's raw-field-reading concerns, and composability means adding a
category Figma ships in the future (Section 1.17's future-compatibility
point, generalized) means writing ONE new `buildXIr()` + one new
`resolveX()` branch, not touching every existing one.

### 8.2 Migration order (mirrors Kernel Integration's proven discipline: relocate before extending)

1. `buildShapeIr`/`buildEffectsIr`/`buildTypographyIr` — pure relocations
   of already-correct logic (Sections 3.1/3.6/5.1), each independently
   byte-diff-verified against all 6 fixtures before moving to the next.
2. `buildPaintIr`/`resolvePaint()` — per Paint doc Section 5.4's own
   (census-corrected) phased order.
3. `resolveTypography()`'s per-run unification (Section 5.2) — the one
   place in this whole document where relocation and a real code-level fix
   happen together, similar in KIND to Kernel Integration Slice 2's
   `recognitionHintsByNode` fix (two source functions genuinely disagree
   today, so unifying them IS a fix) but **not the same in urgency** — the
   real-data check (Section 5.2) confirmed zero current occurrences of the
   specific divergence (per-run STRIKETHROUGH/textCase). Verify old
   whole-node behavior stays byte-identical; the STRIKETHROUGH/textCase
   correctness can be verified with a synthetic test (matching this
   project's practice for zero-real-occurrence-but-real-code-path cases
   elsewhere, e.g. the strokeAlign `strokeDecls()` unit tests), not gated
   on finding a real fixture.
4. `resolveMask()` — thin pass-through only, deferred entirely until
   Mask's own real-data trigger (per that document's own recommendation).
5. `sources` provenance tracking (Section 2.7/7) — additive, can land
   incrementally per-field, doesn't block any of the above.

---

## 9. What this document does NOT decide

- The `imageStrategy` DOM/CSS rendering mechanism (wrapper vs.
  background-image-layer) — still Paint Architecture Research's Section 6,
  unchanged, still open.
- Whether `cornerSmoothing`/`strokeCap`/`strokeJoin`/mask ever get a real
  rendering implementation — all three remain "resolved but not consumed"
  until real data justifies the investment (Sections 3.3/3.4/4).
- (Resolved during this document's own drafting, not left open: per-run
  STRIKETHROUGH/textCase real-data frequency — confirmed zero across all
  38 real override tables in the corpus, Section 5.2.)
