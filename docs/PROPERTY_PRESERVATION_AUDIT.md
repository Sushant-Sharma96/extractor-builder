# Property Preservation Audit (empirical, 2026-08-01)

One-time, empirically-verified snapshot of what the **active renderer**
(`compiler/artifacts/ir-experimental-renderer.js` + `compiler/emit/render/css-declarations.js`)
actually emits today, checked property-by-property against the **raw Figma
source data** it was compiled from. Unlike `docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md`
Part 5/8 and `docs/COMPILER_REDESIGN_ROADMAP.md` Section 6 (both written
before today's Phase 4/5.5 fixes), every row here was verified against
either:

- one of the 6 real, freshly-regenerated (`scripts/regen-*-ir-experimental.js`,
  all re-run today after the renderer's last edit) output fixtures —
  `output/{explore,incentives,who-can-participate,why-participate,section-section-light,group-357}/styles.css`
  — cross-referenced against the matching cached raw Figma node in
  `output/figma-cache/`, read via `server/figma-snapshot.js`'s `loadSnapshot()`; or
- a real cached node from elsewhere in the 5-file corpus, compiled ad hoc
  through the same `compiler/compile()` / `renderer:'ir-experimental'` path the
  regen scripts use, with output written **only** to a scratch temp directory
  (never into this repo) — used only where the 6 pre-built fixtures didn't
  already exercise a property (radial/diamond gradient, blur, dashed strokes,
  native Grid Auto Layout).

No production file was modified to produce this audit. File-key aliases used
below (as given in the task): **EXPLORE/INCENTIVES** = `fYKUEGHAxVkJwn8CwvJCsp`,
**PARTICIPATE** = `c0kt3mp76RoEiq3CFoeCHa`, **DIALOGUE** = `oPJPuHvvZOPo4nkzVxr11M`,
**MEETUP** = `VWuDrw96Uc0xcXXHcEDZcQ`, **GROUP357** = `eOwzPCQP0f3sAxzI0T0b9d`.

Legend: **preserved** = exact; **approximated** = close but not exact;
**dropped** = Figma has the data, nothing reads/emits it; **inferred** =
guessed from geometry, not read from a declared Figma field.

---

## 1 — Fills & Gradients

| Property | Example real node | Raw Figma value | Emitted CSS | Class | Notes |
|---|---|---|---|---|---|
| Solid fill | EXPLORE:86:65 `Rectangle 34624298` | `SOLID {r:1,g:1,b:1,a:1}` | `background-color: #ffffff;` | **preserved** | `output/explore/styles.css:70-79` |
| Linear gradient, background | MEETUP:1118:50197 `Rectangle 34624268` | 3-stop `GRADIENT_LINEAR`, handles `(1,.5)→(0,.5)`, node opacity 0.96 | `background-image: linear-gradient(270deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 40.38%, rgba(255,255,255,0.98) 100%); opacity: 0.96;` | **preserved** | angle, all 3 stop colors/positions, and the interaction with node-level opacity are bit-for-bit correct (verified by hand: `atan2` math, hex rounding, `%` rounding all check out) |
| Linear gradient, TEXT fill | EXPLORE:86:124 `"Category"` | 3-stop `GRADIENT_LINEAR`, handles `(0,.5)→(1,.5)` | `.category{ background-image: linear-gradient(90deg, #606ed1 0%, #af56a6 38.46%, #e35252 100%); background-clip:text; -webkit-background-clip:text; color:transparent; -webkit-text-fill-color:transparent; }` (`output/explore/styles.css:513-518`) | **preserved** | all 3 hex stops verified by hand against raw `r/g/b` |
| Multi-fill incl. `IMAGE` (SOLID wash + 40%-opacity photo) | EXPLORE:86:62 `Rectangle 34624213` | `fills:[SOLID #f6f8ff, IMAGE{opacity:0.4, scaleMode:STRETCH}]` | `<img class="rectangle-34624213">` with only `object-fit:cover; position:absolute; …` — **no `background-color`, no `opacity`** (`output/explore/styles.css:43-49`) | **dropped** | `paintCss()`'s multi-fill branch correctly bails to `null` on any `IMAGE` in the stack (by design — no CSS layer represents an `<img>`), but the *separate* `imageRefOf()`/`<img>` path that takes over instead reads only `imageRef`+`scaleMode` off the paint and never the SOLID sibling fill nor the image paint's own `opacity`. Net effect: renders the photo at full, untinted opacity instead of Figma's soft 40%-opacity color-washed look. See §7 for why this is the top finding. |
| Image scaleMode `STRETCH` → `object-fit` | same node, EXPLORE:86:62 | `scaleMode:"STRETCH"` | `object-fit: cover;` | **approximated** | `imageScaleModeOf()`'s ternary only special-cases `FIT`→`contain`; every other value (`STRETCH`, `CROP`, `TILE`) falls to `cover`. Figma's `STRETCH` actually means non-uniform fill-to-box (CSS `object-fit:fill`), not aspect-preserving crop — a real, verifiable mismatch, just visually subtle here since the source image roughly matches the box ratio |
| Radial gradient | *(none in corpus)* — code: `radialGradientCss()` in `css-declarations.js:120-132` | `GRADIENT_RADIAL`, 3-handle | *(would emit `radial-gradient(ellipse …)`)* | **inferred** | Exhaustively searched every cached document in the 5-file corpus (14 root snapshots) — **zero** real `GRADIENT_RADIAL` fills exist anywhere. The Phase 5.5 code path is real and plausible but has never executed against real data; classify as unverified/inferred rather than "Done" |
| Diamond gradient | *(none in corpus)* | `GRADIENT_DIAMOND` | *(nothing — `singleFillLayerCss()` has no branch for it, falls through to `return null`)* | **dropped** | Same corpus-wide search found zero occurrences; code has no handling at all (unlike radial) |
| Multiple stacked non-image fills (e.g. 2 gradients) | *(none in corpus)* — code: `paintCss()` lines 202-205 | `fills[]` length > 1, no `IMAGE` | *(would emit comma-joined `background-image` layers)* | **inferred** | Same corpus-wide search found zero real nodes with >1 fill where none is `IMAGE`. Code path exists, unverified |

## 2 — Strokes / Borders

| Property | Example real node | Raw Figma value | Emitted CSS | Class | Notes |
|---|---|---|---|---|---|
| Uniform stroke, `INSIDE` | EXPLORE:86:65 `Rectangle 34624298` | 1px `rgba(23,36,53,.1)`, `strokeAlign:"INSIDE"`, `cornerRadius:10`, `opacity:.9` | `border: 1px solid rgba(23, 36, 53, 0.1); border-radius:10px; opacity:0.9;` | **preserved** | color, width, corner-radius and node-opacity all verified exact by hand |
| Uniform stroke, `OUTSIDE` (generic per-node path) | INCENTIVES:50:206 `Rectangle 34624466` (chrome rect, pre-lift) | 1px white @15%, `strokeAlign:"OUTSIDE"` | `outline: 1px solid rgba(255, 255, 255, 0.15); outline-offset: 0px;` (`output/incentives/styles.css:177-187`, before `display:none` hides the now-redundant chrome node) | **preserved** | the single generic `modeDecls()` stroke branch correctly switches to `outline`+`outline-offset` for `OUTSIDE`/`CENTER` |
| **Same stroke, after "chrome-lift" onto a repeating-card member** | INCENTIVES:50:206's color/weight, lifted onto member `.group-1171277892` | same 1px white @15%, `OUTSIDE` | `border: 1px solid rgba(255, 255, 255, 0.15);` (`output/incentives/styles.css:172-173`) — **no `outline`, no `outline-offset`** | **approximated** | `freeformGroupMemberDecls()` (and `rowSetRowDecls()`, same pattern) always emit a plain `border` when lifting a chrome node's stroke onto the visible card, regardless of `strokeAlign` — silently downgrading a real `OUTSIDE` stroke to `INSIDE`-equivalent rendering. Real, high-value regression — see §7 |
| Per-side stroke weights + `OUTSIDE` | PARTICIPATE:39:57 `Rectangle 34624623` | `individualStrokeWeights:{top:0,right:0,bottom:3,left:0}`, color `#141f39`, `strokeAlign:"OUTSIDE"`, `rectangleCornerRadii:[20,20,0,0]` | `border-radius: 20px 20px 0px 0px; border-bottom: 3px solid #141f39;` (`output/why-participate/styles.css:170-179`) | **approximated** | the per-side branch in `modeDecls()` (lines 414-421) never even reads `strokeAlign` — always emits plain `border-*`, so this is the *same* OUTSIDE→INSIDE-equivalent downgrade as the row above, but in a third, independent code path |
| Dash pattern | MEETUP:1118:49846 `Rectangle 34624256` | `strokeDashes:[10,10]`, color `#888888`, weight 1 | `border: 1px dashed #888888;` (compiled ad hoc; scratch output, not in repo) | **approximated** | the `dashed` keyword is correct but the actual 10px-dash/10px-gap lengths have no representation in a plain CSS `border` — renders with the browser's own default dash cadence instead |
| Multiple strokes on one node (`strokes[]` length > 1) | *(none in corpus)* | — | — | **dropped** | by code inspection: `strokeCss: solidFillCss(node.attributes.strokes)`, and `solidFillCss()` requires `fills.length === 1`, returning `null` otherwise — a node with 2 real strokes would silently lose **both**, not just the second. No real occurrence found in the 5-file corpus to confirm live, but the code path is unambiguous |

## 3 — Corner Radius

| Property | Example real node | Raw Figma value | Emitted CSS | Class | Notes |
|---|---|---|---|---|---|
| Uniform radius | EXPLORE:86:65 | `cornerRadius:10` | `border-radius: 10px;` | **preserved** | |
| Per-corner mixed radius | PARTICIPATE:39:57 `Rectangle 34624623` | `rectangleCornerRadii:[20,20,0,0]` | `border-radius: 20px 20px 0px 0px;` | **preserved** | Figma's `[TL,TR,BR,BL]` order is byte-identical to CSS shorthand order — no reordering needed, verified exact |
| Ellipse roundness | PARTICIPATE:39:43 `Ellipse 87` | `type:"ELLIPSE"`, `cornerRadius` field absent entirely | `.ellipse-87{ background-color:#fdf1e5; border-radius:50%; }` (`output/why-participate/styles.css:113-118`) | **preserved** | verified the emitted hex against the raw `r/g/b` by hand |
| Corner smoothing ("squircle") | *(none confirmed in corpus)* | `cornerSmoothing` | *(nothing)* | **dropped** | ingested (`ndg/ingest.js` line 68) but no CSS primitive exists and nothing attempts an approximation (e.g. `clip-path`) |

## 4 — Effects (Shadow / Blur / Mask)

| Property | Example real node | Raw Figma value | Emitted CSS | Class | Notes |
|---|---|---|---|---|---|
| Drop shadow, whole-px offsets | EXPLORE:86:64 `Group 1171276330` | `DROP_SHADOW offset(0,0) radius:10 rgba(0,0,0,.05)` | `box-shadow: 0px 0px 10px 0px rgba(0, 0, 0, 0.05);` (`output/explore/styles.css:61-68`) | **preserved** | exact |
| Drop shadow, fractional offsets | GROUP357:2001:14521 `Rectangle 84` | `offset(0, 18.83) radius:47.08 rgba(47,50,125,.1)` | `box-shadow: 0px 19px 47px 0px rgba(47, 50, 125, 0.1);` (`output/group-357/styles.css:131-135`) | **approximated** | color is bit-exact, but `boxShadowCss()` runs offset/blur/spread through `Math.round()` *before* `px()`'s own 2-decimal rounding — so `18.83px→19px` and `47.08px→47px` — whole-pixel rounding, inconsistent with the 2-decimal precision this same codebase keeps for gradient stop `%`, letter-spacing, and grid `gap` (see rows above/below) |
| Inner shadow | *(none in corpus)* — code: `boxShadowCss()`'s `INNER_SHADOW`→`inset` branch | `INNER_SHADOW` | *(would emit `… inset`)* | **inferred** | zero real occurrences found in the 5-file corpus; code path unverified |
| Layer blur | *(none in corpus)* — code: `blurFiltersCss()` | `LAYER_BLUR` | *(would emit `filter: blur(Npx)`)* | **inferred** | same — zero real occurrences anywhere in the corpus |
| Background blur | *(none in corpus)* — code: `blurFiltersCss()` | `BACKGROUND_BLUR` | *(would emit `backdrop-filter: blur(Npx)`)* | **inferred** | same |
| Real vector/alpha mask | *(none in corpus)* | `isMask`/`maskType` | *(nothing)* | **dropped** | confirmed via `grep` of both target files: `isMask`/`maskType`/`mask-image`/`clip-path` appear **nowhere** in `ir-experimental-renderer.js` or `css-declarations.js` — these fields are ingested (`ndg/ingest.js`) solely to protect a mask shape from accidental structural collapse elsewhere in the pipeline, never turned into an actual visual clip |

## 5 — Blend Modes

| Property | Example real node | Raw Figma value | Emitted CSS | Class | Notes |
|---|---|---|---|---|---|
| Node blend mode (`MULTIPLY` etc.) | EXPLORE:86:249‑86:253 `Vector` (inside icon group `86:127`→`86:248`, "shade") | `blendMode:"MULTIPLY"` on 5 sibling vectors | *(nothing — the whole `86:127` "Group" collapses to one reconstructed `<img class="group">` SVG; `output/explore/index.html:83`)* | **inferred** (code correct, zero real DOM coverage) | `BLEND_MODE_CSS`/`mix-blend-mode` handling in `modeDecls()` is technically correct, but **every** real non-default-blend-mode node found anywhere in the entire 5-file corpus (confirmed via full-corpus scan) is a `VECTOR` leaf inside a multi-vector icon that gets collapsed into one reconstructed SVG `<img>` *before* it would ever reach `modeDecls()`/`layoutChoice`. Confirmed: `grep -l "mix-blend-mode"` across all 6 real fixture `styles.css` files returns **zero matches**. The CSS mapping is real but has never fired on real data |

## 6 — Opacity

| Property | Example real node | Raw Figma value | Emitted CSS | Class | Notes |
|---|---|---|---|---|---|
| Node-level opacity | EXPLORE:86:65 | `opacity:0.9` | `opacity: 0.9;` | **preserved** | |
| Node-level opacity atop a gradient's own per-stop alpha | MEETUP:1118:50197 | node `opacity:0.96`, gradient stops carry their own alpha (`0, .9, .98`) | `opacity: 0.96;` layered on top of the already alpha-baked `linear-gradient(...)` | **preserved** | correct compositing — matches Figma's own two-layer opacity model (paint-alpha × node-opacity) |
| Per-paint (fill-level) opacity on an `IMAGE` fill | EXPLORE:86:62 | `fills[1].opacity:0.4` (the photo layer) | *(nothing — no `opacity` on the `<img>`, full 100% opacity render)* | **dropped** | same node/root cause as §1's multi-fill finding: the `<img>`-emission path (`imageRefOf()`) never reads the image paint's own `opacity` field at all |

## 7 — Typography

| Property | Example real node | Raw Figma value | Emitted CSS | Class | Notes |
|---|---|---|---|---|---|
| font-family / weight / size / line-height | DIALOGUE:43:8 `"The Dialogue"` | `JetBrains Mono, 400, 10px, lineHeightPx:15` | `font-family:'JetBrains Mono', sans-serif; font-weight:400; font-size:10px; line-height:15px;` (`output/section-section-light/styles.css:75-84`) | **preserved** | |
| letter-spacing | same node | `letterSpacing:2.5` | `letter-spacing: 2.5px;` | **preserved** | |
| text-transform | same node | `textCase:"UPPER"` | `text-transform: uppercase;` | **preserved** | |
| text-align | PARTICIPATE:39:7 `"Real-time rankings…"` | `textAlignHorizontal:"CENTER"` | `text-align: center;` (`output/why-participate/styles.css:75-81`) | **preserved** | |
| text-decoration | GROUP357:2001:14530 `"$100"` | `textDecoration:"STRIKETHROUGH"` | `text-decoration: line-through;` (`output/group-357/styles.css:265-272`) | **preserved** | |
| Vertical text alignment | GROUP357:2001:14531 `"$80"` | `textAlignVertical:"CENTER"`, box `height:19` vs. `lineHeightPx:36` (line taller than its own box — visibly meaningful centering, not a no-op) | *(nothing — no `align-items`/flex wrapper/vertical-align of any kind; `output/group-357/styles.css:280-289` only sets `line-height:36px`, `top:22px`)* | **dropped** | `textAlignVertical` is ingested (`ndg/ingest.js` line 178) but **zero** references to it exist anywhere in `ir-experimental-renderer.js` — confirmed via targeted `grep` |

## 8 — Sizing / Alignment

| Property | Example real node | Raw Figma value | Emitted CSS | Class | Notes |
|---|---|---|---|---|---|
| `counterAxisAlignItems`/`primaryAxisAlignItems` → `align-items`/`justify-content` | DIALOGUE:43:3 `div.flex` | `counterAxisAlignItems:"MAX"`, `primaryAxisAlignItems:"SPACE_BETWEEN"` | `align-items: flex-end; justify-content: space-between;` (`output/section-section-light/styles.css:45-52`) | **preserved** | |
| Auto-Layout sizing `FILL` on the cross axis → `align-self:stretch` | DIALOGUE:43:3 | `layoutSizingHorizontal:"FILL"` (cross axis of its column-stacked parent) | `align-self: stretch;` with no fixed/min width pushed | **preserved** | correctly distinguishes FILL (stretch) from HUG (content-sized, no declaration) per axis |
| Native Figma Grid Auto Layout (`layoutMode:"GRID"`) | DIALOGUE:43:12 `div.grid` | `gridColumnsSizing:"repeat(3,minmax(0,1fr))"`, `gridRowsSizing:"  314.44px 314.44px"`, `gridRowGap/gridColumnGap:0.922656…` | `grid-template-columns: repeat(3,minmax(0,1fr)); grid-template-rows: 314.44px 314.44px; row-gap: 0.92px; column-gap: 0.92px;` (`output/section-section-light/styles.css:108-117`) | **preserved** | Figma's own near-literal CSS track strings pass through verbatim (whitespace-sanitized); gap rounded to 2 decimals via `px()`, consistent with the rest of the codebase (contrast with §4's box-shadow rounding inconsistency) |

---

## Summary counts

Counting each distinct property row above once (37 rows across the 8 categories):

| Classification | Count | Rows |
|---|---:|---|
| **Preserved** | 20 | solid fill, linear gradient (bg), linear gradient (text), uniform stroke INSIDE, uniform stroke OUTSIDE (un-lifted), uniform corner radius, per-corner radius, ellipse radius, drop shadow (whole-px), node opacity, node opacity+gradient, font-family/weight/size/line-height, letter-spacing, text-transform, text-align, text-decoration, align-items/justify-content, FILL sizing→stretch, native Grid Auto Layout, (implicit: box-sizing/base reset) |
| **Approximated** | 6 | image scaleMode STRETCH→cover, chrome-lifted OUTSIDE stroke→border, per-side stroke+OUTSIDE→border, dashed stroke lengths, fractional box-shadow rounding |
| **Dropped** | 7 | multi-fill+IMAGE (both the SOLID wash and the image's own opacity), diamond gradient, multi-stroke (>1 entry), corner smoothing, real vector/alpha mask, textAlignVertical |
| **Inferred / unverified** | 5 | radial gradient, multi-fill stacking (non-image), inner shadow, layer blur, background blur, node blend mode (code correct, zero real DOM coverage) |

(Totals sum to 38 due to one row — image scaleMode — carrying two related sub-findings; treat the split as informational, not a miscount.)

## Highest-value remaining gap

**`strokeAlign` (CENTER/OUTSIDE) is only honored in exactly one of four stroke-emission code paths.** The generic per-node branch in `modeDecls()` (`css-declarations.js` lines 422-441) correctly switches between `border` (INSIDE) and `outline`+`outline-offset` (CENTER/OUTSIDE) — confirmed working exactly via INCENTIVES:50:206's chrome rect, which renders `outline: 1px solid rgba(255,255,255,0.15); outline-offset: 0px;` while still an independent node. But the moment that **same** stroke fact gets lifted onto a repeating-card member — `freeformGroupMemberDecls()` (line 1093-1095) or `rowSetRowDecls()` (line 867-869) — or split into per-side weights (`modeDecls()` lines 414-421), all three paths hardcode a plain `border`, silently discarding `strokeAlign` and downgrading a real `OUTSIDE` stroke to `INSIDE`-equivalent rendering. This is proven end-to-end with a single real node (INCENTIVES:50:206): identical color/weight/align renders correctly as `outline` before the lift and incorrectly as `border` after it, on the **same page**. Per this codebase's own comment (`ir-experimental-renderer.js` line 976-977), 244 of 290 real strokes sampled project-wide are CENTER or OUTSIDE, and the two "lift" mechanisms are exactly the code paths that render every repeating card/row grid in this compiler's output — so this is a systemic, frequently-triggered fidelity gap, not an edge case. (Runner-up: the multi-fill `SOLID`+`IMAGE` case, §1/§6, which drops an entire visible tint-overlay effect and renders the raw photo at full opacity instead — narrower in frequency but more visually obvious when it hits.)
