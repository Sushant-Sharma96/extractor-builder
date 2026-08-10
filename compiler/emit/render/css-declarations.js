'use strict';

/**
 * Phase 3 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — Renderer, minimal vocabulary.
 *
 * Pure CSS-declaration builder: given a `layoutChoice` (mode + gap/padding
 * from LayoutIR, plus an optional card/banner chrome fact from Component IR),
 * produce a literal, ordered list of `[property, value]` CSS declarations.
 *
 * Ported (faithfully) from server/figma-build.js:
 *   - `px()` — round-to-2-decimals + 'px' suffix (unchanged formula).
 *   - `figmaColor()` — Figma {r,g,b,a} paint -> #hex / rgba() (unchanged
 *     formula; ported here instead of required from server/figma-generate.js
 *     so compiler/ has no runtime dependency on server/).
 *   - `solidFillCss()` — single-SOLID-paint -> css color, else null.
 *   - the four minimal-vocabulary modes' declarations (`display:flex` +
 *     `flex-direction`, `display:grid` + `grid-template-columns`,
 *     `position:absolute`) and `collapseCardShells`' lifted chrome
 *     properties (background-color, border-radius, padding, flex column).
 *
 * Pure functions only — never touches a live figma-build element tree
 * (that mutation, if ever wired live, is `compiler/artifacts/apply-plan.js`'s
 * job via `applyLayoutBindings`).
 */

const { round, px, hex2, figmaColor } = require('./units');
const {
  resolveShape, boxShadowCss, blurFiltersCss, resolveTypography,
  BLEND_MODE_CSS, solidFillCss, gradientAngleDeg, gradientStopsCss,
  radialGradientCss, singleFillLayerCss, paintCss, strokeDecls,
} = require('../../style');

/**
 * Canvas/page-level declarations — port of `emit()`'s canvasDecls assembly
 * (the non-nested-emit branch): root's own decls (minus left/top) plus
 * fluid-width box sizing from the root's box.
 *
 * @param {{ fillCss?: string|null, box?: {width:number,height:number}, clips?: boolean, padding?: {top?:number,right?:number,bottom?:number,left?:number} }} canvas
 */
function canvasDecls(canvas) {
  const decls = [];
  if (canvas && canvas.fillCss) decls.push(['background-color', canvas.fillCss]);
  decls.push(['position', 'relative']);
  if (canvas && canvas.box && Number.isFinite(canvas.box.width)) {
    decls.push(['width', '100%']);
    decls.push(['max-width', px(Math.round(canvas.box.width))]);
    decls.push(['--page-max', px(Math.round(canvas.box.width))]);
  }
  // `.et-page` holds only absolutely-positioned children (real Figma output
  // is almost never a single in-flow child) — out-of-flow content
  // contributes NOTHING to a block's own auto height, so without this the
  // page's own box is genuinely 0px tall. That was harmless while
  // `overflow` stayed `visible` (the CSS default): children still paint
  // outside a 0-height box just fine when nothing clips. But setting
  // `overflow-x` to anything other than `visible` (below) forces the
  // OTHER axis to compute as `auto` too per the CSS overflow spec, turning
  // `.et-page` into a real clipping container — at 0px tall, that clips
  // its ENTIRE content, hiding the whole page (real, severe regression:
  // confirmed via the user's own DevTools screenshot, `div.et-page 1440 x
  // 0`, page rendering completely blank). `min-height` (not `height`) so a
  // browser-rendered child taller than Figma's own measured box can still
  // grow the page rather than being clipped — same "measured box vs.
  // rendered size" floor this file already uses everywhere else.
  if (canvas && canvas.box && Number.isFinite(canvas.box.height)) {
    decls.push(['min-height', px(Math.round(canvas.box.height))]);
  }
  decls.push(['margin', '0 auto']);
  decls.push(['box-sizing', 'border-box']);
  // Real bug (Figma file eOwzPCQP0f3sAxzI0T0b9d, "Group 357"): on any real
  // viewport narrower than the design's own canvas width — which is nearly
  // every real desktop viewport, since a maximized browser window's usable
  // width is a few px less than its monitor's physical resolution once its
  // own vertical scrollbar/chrome is subtracted — this page shrinks below
  // its design width (the `width:100%` above) while children positioned
  // with raw Figma pixel offsets stay sized to the FULL design width,
  // visibly bleeding past the page's own (now-narrower) right edge. An
  // earlier attempt fixed this by forcing `.et-page` to a hard, fixed
  // design-width (see responsive-media.js's now-unused `pageWidthMediaCss`)
  // — but that traded the occasional visible-bleed bug for a page-level
  // horizontal scrollbar on nearly every real viewport (confirmed live: a
  // ~1920px-class maximized window still doesn't hit exactly 1920px usable
  // width), which reads as broken/unresponsive far more often than the bug
  // it replaced. `overflow-x:hidden` clips the same excess invisibly
  // instead of either bleeding it or forcing the whole page wider — the
  // right default for content that has no real reflow behavior of its own
  // (most of this compiler's absolutely-positioned output, today). Only
  // the horizontal axis: a page taller than the viewport must still scroll
  // vertically like normal.
  decls.push(['overflow-x', 'hidden']);
  // docs/STYLE_RESOLVER_ARCHITECTURE.md Section 3.5 — shares the same
  // clip-content resolution modeDecls() below uses, instead of an
  // independent, second hardcoded ['overflow','hidden'] mapping.
  if (resolveShape({ clips: canvas && canvas.clips }).clipContent) decls.push(['overflow', 'hidden']);
  // The root node's own Auto Layout padding (e.g. a symmetric side-margin
  // that makes the whole design read as centered) — see ir-experimental-
  // renderer.js's canvas construction for the full root-cause writeup of
  // why this was previously always dropped for the outermost node.
  const padding = canvas && canvas.padding;
  if (padding) {
    if (Number.isFinite(padding.top)) decls.push(['padding-top', px(padding.top)]);
    if (Number.isFinite(padding.right)) decls.push(['padding-right', px(padding.right)]);
    if (Number.isFinite(padding.bottom)) decls.push(['padding-bottom', px(padding.bottom)]);
    if (Number.isFinite(padding.left)) decls.push(['padding-left', px(padding.left)]);
  }
  return decls;
}

/**
 * A node renders as a positioned box (`position:absolute` + left/top)
 * whenever `buildRenderNode()` actually assigned it a parent-relative
 * offset — see that function's own comment for the full rule (in short:
 * a node whose PARENT has no declared Figma Auto Layout was placed by raw
 * x/y, regardless of the `mode` this node resolved for arranging its OWN
 * children). Deliberately does NOT re-check `layoutChoice.mode` here: a
 * node can simultaneously be `display:flex`/`display:grid` for its own
 * children (via `mode` in `modeDecls()` below) and `position:absolute` for
 * its own placement — these are orthogonal facts, not mutually exclusive
 * ones (see `modeDecls()`, which emits both non-exclusively for exactly
 * this reason). Without this fallback, unpositioned nodes emit no
 * positioning data at all and collapse into plain document flow (the
 * "everything overlaps at the top-left" bug class).
 */
function isPositionedAbsolute(layoutChoice) {
  return !!layoutChoice
    && Number.isFinite(layoutChoice.left)
    && Number.isFinite(layoutChoice.top);
}

/** Per-mode base declarations (order matches legacy's `display` + axis emission). */
function modeDecls(layoutChoice) {
  const decls = [];
  const mode = layoutChoice && layoutChoice.mode;

  // A TEXT node's own fill paint is its font color, not a box background —
  // `layoutChoice.isText` is set by ir-experimental-renderer.js's
  // `buildRenderNode` (the only place `node.type` is known at layoutChoice
  // construction time). A solid fill stays on the plain-string `fillCss`
  // (`color`). Every other node kind uses `fillPaint`, which additionally
  // covers gradients (css-declarations.js's paintCss()) — pushed under
  // whichever CSS property it belongs to (background-color for solid,
  // background-image for a gradient; the two are not interchangeable, so
  // this can't just always be background-color).
  if (layoutChoice && layoutChoice.isText) {
    if (layoutChoice.fillCss) {
      decls.push(['color', layoutChoice.fillCss]);
    } else if (layoutChoice.fillPaint && layoutChoice.fillPaint.prop === 'background-image') {
      // A gradient TEXT fill (real bug: Figma file fYKUEGHAxVkJwn8CwvJCsp
      // node 86:124, the "Explore Hackathons by Category" heading's
      // "Category" — a 3-stop linear gradient, not a solid color).
      // solidFillCss() only ever recognizes SOLID paints, so `fillCss` is
      // null for this node and NOTHING was emitted at all — the text fell
      // back to an inherited color (confirmed white-on-white, invisible).
      // CSS has no direct "gradient text color" — the standard technique
      // paints the gradient as a background, clips it to the text's own
      // glyph shapes, and makes the actual text color transparent so the
      // clipped background shows through instead.
      decls.push(['background-image', layoutChoice.fillPaint.value]);
      decls.push(['background-clip', 'text']);
      decls.push(['-webkit-background-clip', 'text']);
      decls.push(['color', 'transparent']);
      decls.push(['-webkit-text-fill-color', 'transparent']);
    }
  } else if (layoutChoice && layoutChoice.fillPaint) {
    decls.push([layoutChoice.fillPaint.prop, layoutChoice.fillPaint.value]);
  }

  // Figma's own image-fill scale mode, mapped to CSS `object-fit` — nothing
  // ever set this before, so every image fill defaulted to the browser's
  // own initial value (`fill`, which stretches to the box ignoring aspect
  // ratio) regardless of what Figma actually specified (confirmed real bug:
  // Figma file fYKUEGHAxVkJwn8CwvJCsp node 86:779, scaleMode:"FILL" — a
  // 320x80 source image forced into a 90x70 box, visibly distorted).
  // Figma's "Fill" is CSS `cover` and its "Fit" is CSS `contain` — the two
  // vocabularies use "fill" for opposite behaviors, not a naming accident to
  // paper over. "Crop"/"Tile" have no direct object-fit equivalent (crop
  // needs a per-image transform this stage doesn't have; tile needs a
  // background-image approach, not <img>) — `cover` is the closest safe
  // approximation for both rather than leaving the browser default stretch.
  const scaleMode = layoutChoice && layoutChoice.imageScaleMode;
  if (scaleMode) {
    decls.push(['object-fit', scaleMode === 'FIT' ? 'contain' : 'cover']);
  }
  // docs/PAINT_ARCHITECTURE_RESEARCH.md Section 1.11 — real imageTransform
  // crop/offset data (41 real occurrences, always non-identity), resolved
  // by compiler/style's imageObjectPosition(). A real improvement over the
  // previous always-centered default; does not attempt the matrix's own
  // scale factor (no <img> object-fit equivalent exists — see that
  // function's own doc comment).
  if (layoutChoice && layoutChoice.imageObjectPositionCss) {
    decls.push(['object-position', layoutChoice.imageObjectPositionCss]);
  }

  // A node's own real corner-radius/stroke — generic, unconditional, for
  // EVERY node (real bug found via a repeating-card design: a card frame
  // not recognized as a Component IR card or a freeform-layout-ir grid-item
  // leaf got neither cardChromeDecls' nor freeformLeafChromeDecls' border-
  // radius handling, despite carrying real fills+strokes+cornerRadius of its
  // own — those two mechanisms are each gated on a specific recognition that
  // simply doesn't cover every real shape). buildDecls()'s overlay() replaces
  // by property key rather than duplicating, so a more specific cardFact/
  // freeformLeafCornerRadius value layered in later still correctly wins for
  // nodes that DO match one of those narrower mechanisms.
  // ELLIPSE nodes carry no `cornerRadius` field at all — Figma expresses
  // full roundness via the node TYPE itself, not a number (verified: a real
  // ellipse's cornerRadius is `undefined`) — so this branch wins outright
  // over the numeric one below for any ellipse, regardless of that field.
  // docs/STYLE_RESOLVER_ARCHITECTURE.md Section 3.1/3.5 — border-radius
  // (uniform/per-corner/ellipse) and clip-content, relocated verbatim into
  // the shared Shape resolver (compiler/style) instead of two independent
  // inline computations (this function and canvasDecls()).
  const shapeFacts = resolveShape(layoutChoice || {});
  if (shapeFacts.borderRadius) {
    decls.push(['border-radius', shapeFacts.borderRadius]);
  }
  {
    const hasStroke = layoutChoice && layoutChoice.strokeCss;
    const isw = layoutChoice && layoutChoice.individualStrokeWeights;
    // Figma's strokeDashes is an array of dash/gap lengths (e.g. [10,10]);
    // plain CSS borders/outlines can't express arbitrary dash patterns, only
    // the style keyword — mirrors the exact, already-correct legacy mapping
    // (server/figma-build.js's strokeCss()) rather than a new, unverified one.
    const style = (layoutChoice && Array.isArray(layoutChoice.strokeDashes) && layoutChoice.strokeDashes.length)
      ? 'dashed'
      : 'solid';
    if (hasStroke && isw && (isw.top || isw.right || isw.bottom || isw.left)) {
      // Real, per-side stroke widths (e.g. a border-bottom-only divider) —
      // a uniform `border` shorthand can't express this; emit only the
      // sides that actually have weight, each independently.
      if (isw.top > 0) decls.push(['border-top', `${px(isw.top)} ${style} ${layoutChoice.strokeCss}`]);
      if (isw.right > 0) decls.push(['border-right', `${px(isw.right)} ${style} ${layoutChoice.strokeCss}`]);
      if (isw.bottom > 0) decls.push(['border-bottom', `${px(isw.bottom)} ${style} ${layoutChoice.strokeCss}`]);
      if (isw.left > 0) decls.push(['border-left', `${px(isw.left)} ${style} ${layoutChoice.strokeCss}`]);
    } else if (hasStroke) {
      decls.push(...strokeDecls(layoutChoice.strokeCss, layoutChoice.strokeWeight, layoutChoice.strokeAlign, style));
    }
  }

  // Per-node overflow clip — Figma's own `clipsContent`, resolved by the
  // same shared Shape resolver canvasDecls() now also uses (see this
  // function's own `shapeFacts` above).
  if (shapeFacts.clipContent) {
    decls.push(['overflow', 'hidden']);
  }

  // Figma DROP_SHADOW/INNER_SHADOW effects -> CSS box-shadow.
  if (layoutChoice && layoutChoice.boxShadowCss) {
    decls.push(['box-shadow', layoutChoice.boxShadowCss]);
  }
  // Figma LAYER_BLUR/BACKGROUND_BLUR effects -> CSS filter/backdrop-filter
  // — see blurFiltersCss()'s own comment; docs/COMPILER_REDESIGN_ROADMAP.md
  // Phase 5.5. Combined with imageFilterCss (docs/PAINT_ARCHITECTURE_
  // RESEARCH.md Section 1.13, an IMAGE paint's own saturation/contrast/
  // exposure/temperature/tint adjustments) into a SINGLE `filter` value —
  // CSS allows only one `filter` declaration per element; two independent
  // pushes here would silently let the second one win instead of
  // combining, exactly the kind of duplicated-declaration bug this Style
  // Resolver consolidation exists to prevent.
  {
    const filterParts = [];
    if (layoutChoice && layoutChoice.imageFilterCss) filterParts.push(layoutChoice.imageFilterCss);
    if (layoutChoice && layoutChoice.filterCss) filterParts.push(layoutChoice.filterCss);
    if (filterParts.length) decls.push(['filter', filterParts.join(' ')]);
  }
  if (layoutChoice && layoutChoice.backdropFilterCss) {
    decls.push(['backdrop-filter', layoutChoice.backdropFilterCss]);
    decls.push(['-webkit-backdrop-filter', layoutChoice.backdropFilterCss]);
  }

  // Node-level compositing mode — distinct from opacity. Present on every
  // real Figma node; only NORMAL/PASS_THROUGH (absent from BLEND_MODE_CSS)
  // need no declaration at all.
  if (layoutChoice && BLEND_MODE_CSS[layoutChoice.blendMode]) {
    decls.push(['mix-blend-mode', BLEND_MODE_CSS[layoutChoice.blendMode]]);
  }

  // The node's OWN overall opacity (Figma: "this whole layer, all its
  // content, at N% opacity") — distinct from a fill's own paint-level
  // opacity (already folded into fillCss/fillPaint's color) — combined
  // with an IMAGE paint's own opacity (docs/PAINT_ARCHITECTURE_RESEARCH.md
  // — the SOLID+IMAGE wash case) into a SINGLE `opacity` value, same
  // "only one declaration per element" reasoning as `filter` above. Figma
  // composites node opacity and paint opacity as sequential alpha steps,
  // so multiplying is the correct combination, not a fallback guess.
  {
    const nodeOp = Number.isFinite(layoutChoice && layoutChoice.nodeOpacity) && layoutChoice.nodeOpacity < 1
      ? layoutChoice.nodeOpacity
      : null;
    const imgOp = Number.isFinite(layoutChoice && layoutChoice.imageOpacity) ? layoutChoice.imageOpacity : null;
    let combined = null;
    if (nodeOp != null && imgOp != null) combined = nodeOp * imgOp;
    else if (nodeOp != null) combined = nodeOp;
    else if (imgOp != null) combined = imgOp;
    if (combined != null) decls.push(['opacity', String(round(combined))]);
  }

  // Rotation — see ir-experimental-renderer.js's comment on `rotationDeg`
  // for why this is safe here (only ever set for a non-GROUP node, and
  // every real non-GROUP case is exactly 180deg, which never changes the
  // box's own width/height).
  if (Number.isFinite(layoutChoice && layoutChoice.rotationDeg)) {
    decls.push(['transform', `rotate(${round(layoutChoice.rotationDeg)}deg)`]);
  }

  // Typography — TEXT nodes only. Relocated into the shared Style Resolver
  // (docs/STYLE_RESOLVER_ARCHITECTURE.md Section 5) so the SAME function
  // also serves materialize-html.js's per-character-run override path
  // (that function's own header comment has the full rationale).
  if (layoutChoice && layoutChoice.isText) {
    decls.push(...resolveTypography(layoutChoice));
  }

  // How this node arranges its OWN children, and whether this node itself
  // is positioned by ITS parent, are orthogonal facts (see buildRenderNode()'s
  // comment in ir-experimental-renderer.js and isPositionedAbsolute()'s
  // comment above) — deliberately NOT an else-if chain. A node can be both
  // `display:flex` (for its own children) and `position:absolute` (for its
  // own placement) at the same time.
  if (mode === 'flow-row') {
    decls.push(['display', 'flex']);
    decls.push(['flex-direction', 'row']);
    // docs/COMPILER_REDESIGN_ROADMAP.md Phase 4 — Figma's own declared
    // counterAxisAlignItems/primaryAxisAlignItems (resolved in
    // ir-experimental-renderer.js), falling back to the exact hardcoded
    // default this line has always used whenever Figma's value is absent
    // or unrecognized — legacy/absent data renders byte-identical to
    // before this fix.
    decls.push(['align-items', (layoutChoice && layoutChoice.alignItems) || 'center']);
    if (layoutChoice && layoutChoice.justifyContent) decls.push(['justify-content', layoutChoice.justifyContent]);
  } else if (mode === 'flow-column') {
    decls.push(['display', 'flex']);
    decls.push(['flex-direction', 'column']);
    decls.push(['align-items', (layoutChoice && layoutChoice.alignItems) || 'flex-start']);
    if (layoutChoice && layoutChoice.justifyContent) decls.push(['justify-content', layoutChoice.justifyContent]);
  } else if (mode === 'grid-track') {
    decls.push(['display', 'grid']);
    const cols = layoutChoice && layoutChoice.columns;
    if (Number.isFinite(cols) && cols > 0) {
      decls.push(['grid-template-columns', `repeat(${cols}, 1fr)`]);
    }
  } else if (mode === 'grid-real') {
    // Native Figma Grid Auto Layout (see ir-experimental-renderer.js's
    // isRealGridContainer comment) — a real declared layout, not a guess:
    // prefer Figma's own near-literal CSS track strings, falling back to a
    // generic repeat(N, ...) built from the plain row/column counts only
    // when the sizing string is absent or failed sanitization (never
    // invents a track count Figma didn't also give us).
    decls.push(['display', 'grid']);
    const colsTemplate = layoutChoice && layoutChoice.gridColumnsTemplate;
    const rowsTemplate = layoutChoice && layoutChoice.gridRowsTemplate;
    const colCount = layoutChoice && layoutChoice.gridColumnCount;
    const rowCount = layoutChoice && layoutChoice.gridRowCount;
    if (colsTemplate) {
      decls.push(['grid-template-columns', colsTemplate]);
    } else if (Number.isFinite(colCount) && colCount > 0) {
      decls.push(['grid-template-columns', `repeat(${colCount}, 1fr)`]);
    }
    if (rowsTemplate) {
      decls.push(['grid-template-rows', rowsTemplate]);
    } else if (Number.isFinite(rowCount) && rowCount > 0) {
      decls.push(['grid-template-rows', `repeat(${rowCount}, auto)`]);
    }
    // Real grid supports independent row/column gaps (unlike flow-row/
    // flow-column/grid-track's single shared `gap` below), so these are
    // handled here directly rather than through the generic `gap` block.
    const gridRowGap = layoutChoice && layoutChoice.gridRowGap;
    const gridColumnGap = layoutChoice && layoutChoice.gridColumnGap;
    if (Number.isFinite(gridRowGap)) decls.push(['row-gap', px(gridRowGap)]);
    if (Number.isFinite(gridColumnGap)) decls.push(['column-gap', px(gridColumnGap)]);
  }
  // Explicit grid-row/grid-column placement for a child of a real Grid Auto
  // Layout container — orthogonal to `mode` (which still describes how
  // THIS node arranges its OWN children) and to isPositionedAbsolute (a
  // grid-placed child is never also absolutely positioned — see
  // ir-experimental-renderer.js's hasRealGridPlacement exclusion). Sourced
  // directly from Figma's own 0-based anchor + span, never inferred from
  // document order.
  if (layoutChoice && layoutChoice.gridPlacement) {
    const { rowStart, rowSpan, colStart, colSpan } = layoutChoice.gridPlacement;
    decls.push(['grid-row', `${rowStart} / span ${rowSpan}`]);
    decls.push(['grid-column', `${colStart} / span ${colSpan}`]);
  }
  // Tracks whether the absolute-positioning branch below already pinned
  // width/height, so the flow-container sizing branch further down (a node
  // can be BOTH position:absolute for its own placement AND flow-row/column
  // for its own children — see the "orthogonal facts" comment above) doesn't
  // push a second, redundant min-width/min-height for the identical value.
  let widthPushed = false;
  let heightPushed = false;
  if (isPositionedAbsolute(layoutChoice)) {
    decls.push(['position', 'absolute']);
    decls.push(['left', px(layoutChoice.left)]);
    decls.push(['top', px(layoutChoice.top)]);
    if (Number.isFinite(layoutChoice.width)) {
      // `fluidAbsoluteWidth` (ir-experimental-renderer.js) — a flowSafe
      // ROW-axis freeform group (or its own direct parent wrapper) whose
      // fixed-width members need to genuinely wrap on a narrow viewport:
      // `width:100%` (fluid, follows this node's own containing block)
      // capped at `max-width:<capturedPx>` (never grows past Figma's real
      // design width) instead of a hard `width` that could never shrink.
      if (layoutChoice.fluidAbsoluteWidth) {
        decls.push(['width', '100%']);
        decls.push(['max-width', px(layoutChoice.width)]);
      } else {
        decls.push(['width', px(layoutChoice.width)]);
      }
      widthPushed = true;
    }
    // min-height, not height: Figma's measured box can be a few px shorter
    // than the browser's own rendered line-height for the same text/font —
    // a fixed height would silently clip real content (this is the exact
    // leaf-node counterpart of the flow-container collapse fix below: same
    // "measured box vs. actual rendered size" mismatch, same remedy).
    if (Number.isFinite(layoutChoice.height)) {
      decls.push(['min-height', px(layoutChoice.height)]);
      heightPushed = true;
    }
  } else if (layoutChoice && layoutChoice.hardImageSize) {
    // Real image content (an actual <img>, isImageFill — see
    // ir-experimental-renderer.js's own comment on this flag) rendered as a
    // normal flex/grid item (no position:absolute) still needs BOTH
    // dimensions HARD, not min-: unlike text, an <img> has its own intrinsic
    // pixel size and never needs the "measured box vs. rendered size" escape
    // hatch min-height/min-width exist for — left unconstrained above a
    // floor, it renders at its raw downloaded size instead of Figma's box
    // (confirmed real bug: the "Blogs" avatar photo rendered at 223x149
    // instead of its real 40x40 box).
    if (Number.isFinite(layoutChoice.width)) {
      decls.push(['width', px(layoutChoice.width)]);
      widthPushed = true;
    }
    if (Number.isFinite(layoutChoice.height)) {
      decls.push(['height', px(layoutChoice.height)]);
      heightPushed = true;
    }
  }

  const gap = layoutChoice && layoutChoice.gap;
  if (Number.isFinite(gap) && (mode === 'flow-row' || mode === 'flow-column' || mode === 'grid-track')) {
    decls.push(['gap', px(gap)]);
  }

  // A flex/grid container whose children are ALL taken out of flow (e.g. an
  // 'unknown'-mode child rendered as position:absolute via the freeform
  // fallback above) has no in-flow content left to size itself against, and
  // collapses to zero height — the browser then reserves no vertical space
  // for it, so the NEXT sibling row renders directly on top of it.
  // `min-height` (not `height`) so the container never collapses (fixing
  // the overlap) while still growing to fit real content if the browser's
  // rendered text is taller than Figma's own measured box (avoiding the
  // clipping a fixed `height` would otherwise cause on exactly this class
  // of node — small labels/badges where the measured box is a couple
  // pixels shorter than the browser's natural line-height for that text).
  // A flow-safe freeform-layout-ir member (real flex/grid child of its
  // container, no position:absolute — see isFlowSafeFreeformMember in
  // ir-experimental-renderer.js) needs this SAME min-height floor for the
  // SAME reason, but its own `mode` describes how it arranges ITS OWN
  // children (often 'unknown' for a row whose direct children are a chrome
  // rect + one content wrapper, not itself flow-row/column/grid-track) — so
  // it's included here explicitly rather than folded into the mode check.
  const isFlowSafeMember = !!(layoutChoice && layoutChoice.freeformFlowSafeMember);
  // A normal flex/grid item of a REAL declared Auto Layout parent whose own
  // `mode` isn't flow-row/flow-column/grid-track (true of every leaf, and of
  // any container whose own children arrangement couldn't be classified) —
  // see ir-experimental-renderer.js's realAutoLayoutFlowChild comment for
  // the full real-bug writeup (Figma node 84:12, the "Blogs" avatar image).
  // Independent flag from isFlowSafeMember (different mechanism, same CSS
  // effect) — deliberately kept separate rather than merged, so the two
  // stay auditable on their own terms.
  const isRealAutoLayoutFlowChild = !!(layoutChoice && layoutChoice.realAutoLayoutFlowChild);
  // docs/COMPILER_REDESIGN_ROADMAP.md Phase 1.5 — Figma's own declared
  // sizing intent (FILL/HUG/FIXED per axis, resolved by layout/interpret.js's
  // sizingAxis(), threaded through by ir-experimental-renderer.js's
  // `realAutoLayoutFlowChild` branch — see that branch's own comment for the
  // real-bug writeup). Only ever set alongside `isRealAutoLayoutFlowChild`;
  // undefined for every other node, so this block is a no-op everywhere it
  // isn't the exact case it targets — the min-width/min-height fallback
  // below still fires unchanged for FIXED/unknown/legacy data with no
  // sizing intent at all.
  if (isRealAutoLayoutFlowChild && layoutChoice.parentAxis) {
    const mainSizing = layoutChoice.parentAxis === 'row' ? layoutChoice.sizingHorizontal : layoutChoice.sizingVertical;
    const crossSizing = layoutChoice.parentAxis === 'row' ? layoutChoice.sizingVertical : layoutChoice.sizingHorizontal;
    // FILL along the main axis needs `flex-grow` (shares leftover space with
    // FILL siblings in the same row/column) — a hard `width:100%`/`height:
    // 100%` here would make one FILL child consume the entire container,
    // ignoring siblings, which is wrong the moment more than one child in
    // the row/column is FILL-sized.
    if (mainSizing === 'fill') {
      decls.push(['flex', '1 1 0']);
      if (layoutChoice.parentAxis === 'row') widthPushed = true; else heightPushed = true;
    } else if (mainSizing === 'hug') {
      // No explicit size — CSS's own content-sized default already matches
      // Figma's "hug" intent; suppress the min-width/min-height fallback
      // below rather than pin it to the captured box.
      if (layoutChoice.parentAxis === 'row') widthPushed = true; else heightPushed = true;
    }
    // FILL along the CROSS axis is `align-self:stretch`, not a percentage
    // size — stretch fills whatever the flex line's actual cross size ends
    // up being (the container's own real rendered height/width, whatever
    // that is), which is exactly Figma's "stretch to fill parent" Auto
    // Layout semantics; a percentage size would resolve against the
    // container's own (often auto/content-driven) cross dimension and, per
    // the CSS spec, often compute to nothing at all.
    if (crossSizing === 'fill') {
      decls.push(['align-self', 'stretch']);
      if (layoutChoice.parentAxis === 'row') heightPushed = true; else widthPushed = true;
    } else if (crossSizing === 'hug') {
      if (layoutChoice.parentAxis === 'row') heightPushed = true; else widthPushed = true;
    }
  }
  // Which dimension is THIS member's flex main axis (row→width,
  // column→height — see ir-experimental-renderer.js's comment on
  // freeformFlowSafeMainAxis). Real, verified bug: a row-axis group whose
  // members don't sum to the container's full width (a shorter last row —
  // Incentives: row 1 has 3 cards filling it exactly, row 2 has 2 and
  // leftover space) lets a `min-width`-only member silently expand to fill
  // that leftover space (measured: 380px cards rendered at 600px/568px,
  // summing exactly to the container width). The fix is NOT a hard
  // width/height (that would reintroduce the exact clipping min-height/
  // min-width were added to prevent) — it's an explicit `flex: 0 0 <px>`,
  // which pins only the MAIN-axis size (flex-grow:0, flex-shrink:0) and
  // leaves the CROSS axis (the dimension that legitimately needs to grow
  // with real content) on min-height/min-width, completely untouched.
  const flowSafeMainAxis = layoutChoice && layoutChoice.freeformFlowSafeMainAxis;
  if (isFlowSafeMember && flowSafeMainAxis === 'height' && Number.isFinite(layoutChoice.height)) {
    decls.push(['flex', `0 0 ${px(layoutChoice.height)}`]);
  } else if (
    !heightPushed
    && (mode === 'flow-row' || mode === 'flow-column' || mode === 'grid-track' || isFlowSafeMember || isRealAutoLayoutFlowChild)
    && Number.isFinite(layoutChoice && layoutChoice.height)
  ) {
    decls.push(['min-height', px(layoutChoice.height)]);
  }

  // Same collapse, perpendicular axis — see the height case above for the
  // full reasoning. A flex-column container whose children are all/partly
  // out of flow contributes nothing to its own auto WIDTH either; without
  // this, such a container renders at width:0, forcing any absolutely-
  // positioned text child inside it to wrap into a near-zero-width column
  // and grow tall enough to visually overflow past its own row.
  if (isFlowSafeMember && flowSafeMainAxis === 'width' && Number.isFinite(layoutChoice.width)) {
    decls.push(['flex', `0 0 ${px(layoutChoice.width)}`]);
  } else if (
    !widthPushed
    && (mode === 'flow-row' || mode === 'flow-column' || mode === 'grid-track' || isFlowSafeMember || isRealAutoLayoutFlowChild)
    && Number.isFinite(layoutChoice && layoutChoice.width)
  ) {
    decls.push(['min-width', px(layoutChoice.width)]);
  }

  const padding = layoutChoice && layoutChoice.padding;
  if (padding) {
    if (Number.isFinite(padding.top)) decls.push(['padding-top', px(padding.top)]);
    if (Number.isFinite(padding.right)) decls.push(['padding-right', px(padding.right)]);
    if (Number.isFinite(padding.bottom)) decls.push(['padding-bottom', px(padding.bottom)]);
    if (Number.isFinite(padding.left)) decls.push(['padding-left', px(padding.left)]);
  }

  return decls;
}

/**
 * Card chrome declarations — port of `collapseCardShells`'s "lift chrome
 * paints onto the card" step: background-color/border-radius from the
 * chrome fill, plus the flex-column card shell itself.
 *
 * @param {{ paints?: object[], cornerRadius?: number, padding?: object }} cardFact
 */
function cardChromeDecls(cardFact) {
  const decls = [];
  decls.push(['display', 'flex']);
  decls.push(['flex-direction', 'column']);
  decls.push(['align-items', 'flex-start']);
  decls.push(['box-sizing', 'border-box']);
  const bg = cardFact && solidFillCss(cardFact.paints);
  if (bg) decls.push(['background-color', bg]);
  if (cardFact && Number.isFinite(cardFact.cornerRadius)) {
    decls.push(['border-radius', px(cardFact.cornerRadius)]);
  }
  const padding = cardFact && cardFact.padding;
  if (padding) {
    if (Number.isFinite(padding.top)) decls.push(['padding-top', px(padding.top)]);
    if (Number.isFinite(padding.right)) decls.push(['padding-right', px(padding.right)]);
    if (Number.isFinite(padding.bottom)) decls.push(['padding-bottom', px(padding.bottom)]);
    if (Number.isFinite(padding.left)) decls.push(['padding-left', px(padding.left)]);
  }
  return decls;
}

/**
 * Row-set container declarations — see ir-experimental-renderer.js's header
 * comment on `classifyRowSetRow`/`subtreeContainsMember` for the full design
 * rationale. The originally-sketched design put `display:grid` +
 * `grid-template-columns` on the CONTAINER (with rows flattened into it via
 * `display:contents`); real-fixture validation against Challenge Arena
 * (node 1:326) showed every row carries its own chrome background, which a
 * container-level flatten would destroy. Column alignment is instead
 * achieved per-row (`rowSetRowDecls`, below): every row gets the SAME
 * explicit track list, which guarantees cross-row alignment without a
 * shared container grid. This function is kept as a named seam — matching
 * `cardChromeDecls`'s convention of one decls-function per recognized
 * Component IR fact — for a future chromeless-row-set container that could
 * use the simpler shared-grid design; it currently emits no overrides.
 * @param {{ columns: Array<{width:number}> }} rowSetContainer
 * @returns {Array<[string,string]>}
 */
function rowSetContainerDecls(rowSetContainer) { // eslint-disable-line no-unused-vars
  return [];
}

/**
 * Row-set row declarations. Two cases, both real (see header comment):
 *  - `hasChrome`: the row has its own chrome background rect (the real
 *    Challenge Arena case, for all 4 rows) — lift that rect's color onto the
 *    row itself (same "lift chrome paint onto the shell" idiom
 *    `cardChromeDecls` already uses for cards) and make the row itself a
 *    CSS Grid with one explicit px track per fact column, so its column
 *    boundaries land at the exact same x-offsets as every sibling row's.
 *    The original chrome node is separately hidden via `rowSetChromeHiddenDecls`
 *    (its color already lives on the row; rendering it too would be a
 *    redundant, potentially misplaced box once the row becomes a grid).
 *  - no chrome: nothing to lose, so the textbook flatten-into-parent
 *    technique from the original design applies cleanly — `display:contents`
 *    lets the row's own children become direct grid items of whatever grid
 *    context surrounds it.
 * @param {{ columns: Array<{width:number}>, hasChrome: boolean, chromeBg: string|null }} rowSetRow
 * @returns {Array<[string,string]>}
 */
function rowSetRowDecls(rowSetRow) {
  const decls = [];
  const cols = (rowSetRow && rowSetRow.columns) || [];
  if (!cols.length) return decls;
  if (rowSetRow.hasChrome) {
    decls.push(['display', 'grid']);
    decls.push(['grid-template-columns', cols.map((c) => px(c.width)).join(' ')]);
    decls.push(['align-items', 'center']);
    decls.push(['box-sizing', 'border-box']);
    // Ignore this row's OWN (per-row) LayoutIR-guessed padding — real-fixture
    // validation found one row (Challenge Arena's row 1) picks up non-zero
    // padding from its own layout.interpret result that the other 3 rows
    // don't get, which would shift that one row's grid content inward and
    // break the very column alignment this feature exists to guarantee.
    // Instead derive the real, cross-row-consistent inset directly from the
    // already-computed column facts: `cols[0].x` is `computeRowSetColumns`'s
    // canonical (cross-row median) absolute x for the first column — the
    // SAME value for every row by construction — so subtracting this row's
    // own box.x recovers its real content inset without reintroducing the
    // per-row guess this replaced. Vertical inset needs no equivalent: the
    // grid's own `align-items:center` above already centers each row's
    // (uniform-height) content within the row's taller chrome box.
    const rowBox = rowSetRow.rowBox;
    const firstCol = cols[0];
    const leftInset = (rowBox && firstCol && Number.isFinite(firstCol.x) && Number.isFinite(rowBox.x))
      ? Math.max(0, firstCol.x - rowBox.x)
      : 0;
    decls.push(['padding-top', '0px']);
    decls.push(['padding-right', '0px']);
    decls.push(['padding-bottom', '0px']);
    decls.push(['padding-left', px(leftInset)]);
    if (rowSetRow.chromeBg) decls.push(['background-color', rowSetRow.chromeBg]);
    // Lift the chrome's own real corner-radius/stroke too — same "the hidden
    // chrome's look belongs on the row that replaces it" reasoning as
    // chromeBg above; previously only the fill made it across.
    if (Number.isFinite(rowSetRow.chromeCornerRadius) && rowSetRow.chromeCornerRadius > 0) {
      decls.push(['border-radius', px(rowSetRow.chromeCornerRadius)]);
    }
    // docs/COMPILER_REDESIGN_ROADMAP.md Phase 8 — was a hardcoded `border`
    // regardless of the chrome's real declared strokeAlign (the tracked
    // strokeAlign bug: Section 6.2). Now shares modeDecls()'s single
    // strokeAlign-aware decision instead of a second, divergent one.
    decls.push(...strokeDecls(rowSetRow.chromeStrokeCss, rowSetRow.chromeStrokeWeight, rowSetRow.chromeStrokeAlign, 'solid'));
  } else {
    decls.push(['display', 'contents']);
  }
  return decls;
}

/**
 * A pass-through wrapper found INSIDE a row-set row (e.g. Challenge Arena's
 * "Group 1171278044" content strip bundling id/title/reward/xp) — the row's
 * own grid tracks are only reachable by its DIRECT children, so any
 * intermediate wrapper structurally disappears via `display:contents`,
 * letting its own children become the row's direct grid items instead.
 * @returns {Array<[string,string]>}
 */
function rowSetPassthroughDecls() {
  return [['display', 'contents']];
}

/**
 * The chrome rect inside a row-set row whose color was already lifted onto
 * the row itself (see `rowSetRowDecls`'s `hasChrome` branch) — hidden rather
 * than left to render as a redundant/misplaced grid item.
 * @returns {Array<[string,string]>}
 */
function rowSetChromeHiddenDecls() {
  return [['display', 'none']];
}

/**
 * `freeform-layout-ir` renderer wiring — see docs/
 * FREEFORM_LAYOUT_IR_RENDERER_INTEGRATION_REPORT.md and
 * docs/COMPILER_MIGRATION_BLUEPRINT.md §10 for the fact schema
 * (`RepeatingGroupMembership { groupId, role, axis, columns, memberColumnMap }`).
 * These decls are a PURE, dumb translation of an already-resolved fact into
 * CSS Grid tracks/placement — no clustering, no re-derivation of structure.
 * The renderer (`compiler/artifacts/ir-experimental-renderer.js`) is
 * responsible for resolving which node is the group's container, which
 * nodes are members, which member children are chrome/pass-through/grid
 * items, and at which explicit grid line each grid item belongs — this file
 * only turns those already-resolved facts into declaration pairs, mirroring
 * exactly how `rowSetRowDecls`/`rowSetPassthroughDecls`/
 * `rowSetChromeHiddenDecls` (above) already do for the narrower Component IR
 * `rowSetFacts` case, which this generalizes and supersedes wherever a
 * `freeform-layout-ir` fact is available for a node (see the renderer's
 * `freeformContainerIds`/`freeformMemberIds` mutual-exclusion with
 * `rowSetFacts` for how the two mechanisms avoid double-firing on the same
 * node).
 *
 * `axis` tells us how members repeat relative to each other:
 *  - `axis: 'row'` — members sit side-by-side (spread along X); each
 *    member's own internal content is bucketed along the PERPENDICULAR
 *    dimension (Y) into `columns` (Articles' image/badge/title/footer
 *    stack) — so the per-member grid needs `grid-template-rows` (and each
 *    grid item is placed via `grid-row`).
 *  - `axis: 'column'` — members are stacked (spread along Y); each member's
 *    internal content is bucketed along X (Challenge Arena's literal
 *    left-to-right table columns) — so the per-member grid needs
 *    `grid-template-columns` (grid items placed via `grid-column`).
 * This mapping is data-driven from the fact's own `axis` field, never
 * hardcoded to one fixture's shape.
 */
function trackPropertyForAxis(axis) {
  return axis === 'row' ? 'grid-template-rows' : 'grid-template-columns';
}
function placementPropertyForAxis(axis) {
  return axis === 'row' ? 'grid-row' : 'grid-column';
}

/**
 * Builds the real track list from the fact's own columns, INCLUDING the gap
 * between each pair as its own explicit track — a plain `cols.map(width)`
 * concatenation implicitly assumes every column sits flush against the next
 * (zero gap), but real Figma column facts commonly have real, non-uniform
 * gaps between them (verified directly: Challenge Arena member 1:327's 5
 * columns have gaps of 49px/106px/66px/38px between consecutive pairs, not
 * one shared value a single CSS `gap` could express). Each real column's
 * width still lands at 1-indexed grid line `2*order + 1`, with the
 * interspersed gap tracks occupying the even lines — `freeformGridPlacementDecls`
 * (below) must use the SAME `2*order + 1` formula, not `order + 1`.
 * @param {Array<{x:number, width:number}>} cols — already sorted by `order`
 * @returns {string} the grid-template-columns/-rows track-list value
 */
function tracksWithGaps(cols) {
  const tracks = [];
  for (let i = 0; i < cols.length; i += 1) {
    tracks.push(px(cols[i].width));
    if (i < cols.length - 1) {
      const gap = Number.isFinite(cols[i].x) && Number.isFinite(cols[i].width) && Number.isFinite(cols[i + 1].x)
        ? Math.max(0, cols[i + 1].x - (cols[i].x + cols[i].width))
        : 0;
      tracks.push(px(gap));
    }
  }
  return tracks.join(' ');
}

/**
 * The GROUP CONTAINER's declarations.
 *
 * When `fact.flowSafe` is true (computeFreeformFlowSafety() in
 * ir-experimental-renderer.js verified: no pair of members overlaps, AND
 * the gap between consecutive members is consistent within 2px — real
 * fixture numbers: Challenge Arena's 4 rows tile at exactly 0px gap,
 * Articles' 3 cards at 26px/27px), the container becomes a REAL flex
 * container along the group's own axis — its members are real in-flow flex
 * children (no position:absolute at all; see isFlowSafeFreeformMember in
 * ir-experimental-renderer.js), and the renderer has already reordered them
 * to true visual (y, x) order so plain DOM/flex order matches Figma's
 * visual stacking regardless of raw layer order.
 *
 * When not flow-safe (a member pair genuinely overlaps, or gaps are
 * inconsistent by more than 2px), this falls back to the original
 * declarative grid-track note: members stay on the coordinate-absolute
 * fallback (this container-level declaration doesn't reposition them; it
 * only documents the same column-width facts each member's own grid
 * repeats), preserving the original, still-correct behavior for groups
 * that can't be safely expressed as flex/grid without losing fidelity.
 * @param {{ axis: 'row'|'column', columns: Array<{width:number}>, flowSafe?: boolean, gap?: number }} fact
 * @param {boolean} [fluidWidth] — `layoutChoice.fluidAbsoluteWidth` (see
 *   ir-experimental-renderer.js) — whether THIS specific container's own
 *   width is actually fluid (only true for the bottommost of any stack of
 *   sibling ROW groups; see that flag's own comment for the real-bug
 *   writeup). `flex-wrap` is a pure no-op on a container whose width stays
 *   hard-pinned (it can never become narrower than its content needs, so
 *   wrapping can never trigger) — emitting it anyway would be dead,
 *   confusing CSS with zero visual effect, not a functional bug, but
 *   worth avoiding on its own terms.
 * @returns {Array<[string,string]>}
 */
function freeformGroupContainerDecls(fact, fluidWidth) {
  const decls = [];
  if (fact && fact.flowSafe) {
    decls.push(['display', 'flex']);
    decls.push(['flex-direction', fact.axis === 'row' ? 'row' : 'column']);
    // Real, disclosed gap (Figma file eOwzPCQP0f3sAxzI0T0b9d, "Group 357",
    // the "Recommended for you" card row): a ROW-axis group's fixed-width
    // members never reflowed to fewer per line on a narrow viewport — this,
    // combined with `fluidAbsoluteWidth` (ir-experimental-renderer.js, lets
    // this container's own width actually shrink instead of staying
    // hard-pinned), is what makes real wrapping possible. `gap` (below)
    // applies to both axes once wrapped, matching Figma's own itemSpacing
    // intent for the row AND the vertical space between wrapped lines.
    // COLUMN axis is excluded: a column-axis group's members already stack
    // one per line — there is nothing to wrap. ROW axis without
    // `fluidWidth` (a sibling row stacked below this one depends on its
    // original height — see ir-experimental-renderer.js) is also excluded:
    // wrapping could never actually trigger on a hard-pinned width.
    if (fact.axis === 'row' && fluidWidth) decls.push(['flex-wrap', 'wrap']);
    // Explicit, not left to chance: this container's OWN `mode` (how it
    // arranges ITS children, an unrelated question — see isFlowSafeMember's
    // comment in ir-experimental-renderer.js) can ALSO resolve to flow-row
    // and push `align-items:center` via modeDecls(), which — since it's
    // layered before this overlay — would otherwise survive untouched.
    // `center` vertically/horizontally centers members within whatever
    // leftover cross-axis space the container has, scrambling their real
    // relative offsets (verified: Articles' 3 cards, real container height
    // 539px vs. their own 413px, rendered 63px too low — exactly
    // (539-413)/2 — before this line was added). `flex-start` anchors
    // members at the container's own edge, where `leadingOffset` (below)
    // is measured from.
    decls.push(['align-items', 'flex-start']);
    if (Number.isFinite(fact.gap) && fact.gap > 0) decls.push(['gap', px(fact.gap)]);
    // Two independent real offsets (computeFreeformFlowSafety() in
    // ir-experimental-renderer.js) — needed whenever the container has a
    // non-member sibling that stays absolutely positioned and so
    // contributes nothing to flex flow:
    //   - leadingOffset: along the group's OWN axis (row→x, column→y) — a
    //     sibling before the first member in the stacking direction (a
    //     table header row above Challenge Arena's column-stacked rows).
    //   - crossAxisOffset: along the PERPENDICULAR axis (row→y, column→x) —
    //     a sibling on the cross axis (Articles' headline sits above its
    //     row-arranged (side-by-side) cards — a vertical offset for a
    //     horizontal axis, the opposite pairing from leadingOffset).
    if (Number.isFinite(fact.leadingOffset) && fact.leadingOffset > 0) {
      decls.push([fact.axis === 'row' ? 'padding-left' : 'padding-top', px(fact.leadingOffset)]);
    }
    if (Number.isFinite(fact.crossAxisOffset) && fact.crossAxisOffset > 0) {
      decls.push([fact.axis === 'row' ? 'padding-top' : 'padding-left', px(fact.crossAxisOffset)]);
    }
    decls.push(['box-sizing', 'border-box']);
    return decls;
  }
  const cols = (fact && fact.columns) || [];
  if (!cols.length) return decls;
  decls.push(['display', 'grid']);
  decls.push([trackPropertyForAxis(fact.axis), tracksWithGaps(cols)]);
  decls.push(['box-sizing', 'border-box']);
  return decls;
}

/**
 * A single MEMBER's declarations — the member becomes its own CSS Grid with
 * the fact's columns as explicit px tracks (byte-identical across every
 * member of the group, guaranteeing cross-member alignment without a shared
 * container grid — same idiom `rowSetRowDecls` already validated against
 * Challenge Arena's real chrome-per-row shape). If the member has a chrome
 * background (resolved read-only by the renderer via the same
 * `isChromeBgRefined` helper `classifyRowSetRow` already uses), that color is
 * lifted onto the member itself and all 4 padding sides are zeroed (the
 * fact's column x-offsets are relative to the member's own flush content-box
 * edge, same reasoning `rowSetRowDecls` documents).
 * @param {{ axis:'row'|'column', columns:Array<{width:number}>, chromeBg?:string|null, crossInset?:number }} fact
 * @returns {Array<[string,string]>}
 */
function freeformGroupMemberDecls(fact) {
  const decls = [];
  const cols = (fact && fact.columns) || [];
  if (!cols.length) return decls;
  decls.push(['display', 'grid']);
  decls.push([trackPropertyForAxis(fact.axis), tracksWithGaps(cols)]);
  decls.push(['align-items', 'center']);
  decls.push(['box-sizing', 'border-box']);
  // Along-axis inset (row→x clustering axis is Y, so this is Y; column→X) —
  // derived from the already-computed column facts. Unlike rowSetRowDecls()'s
  // columns (absolute page coordinates, needing memberBox subtracted out),
  // detect.js's `clusterByPosition` already computes freeform-layout-ir's
  // `columns[].x` relative to the member's own box — verified directly
  // (Challenge Arena member 1:327: `columns[0].x === 21`, exactly its real
  // content inset) — so it's used as-is; `memberBox` is not needed here.
  const firstCol = cols[0];
  const inset = (firstCol && Number.isFinite(firstCol.x)) ? Math.max(0, firstCol.x) : 0;
  // Cross-axis inset (the OTHER dimension — row→x, column→y) USED to be a
  // single member-wide padding here, from a group-uniform value — but a
  // member whose content mixes a full-bleed item (e.g. a photo flush with
  // the card's edge) with genuinely inset items (e.g. a title/date row
  // indented below it) has no single inset correct for both: a card-wide
  // padding derived from the full-bleed item's own 0 offset silently zeroed
  // out every other item's real inset (confirmed real bug: Figma file
  // fYKUEGHAxVkJwn8CwvJCsp node 84:7, "Blogs" card 1). Now computed PER
  // COLUMN instead (compiler/freeform-layout/detect.js's own `columns[].
  // crossInset`) and applied per-leaf via freeformGridPlacementDecls' own
  // margin, not here — this member-level padding only ever needs the
  // ALONG-axis value now.
  decls.push(['padding-top', fact.axis === 'row' ? px(inset) : '0px']);
  decls.push(['padding-right', '0px']);
  decls.push(['padding-bottom', '0px']);
  decls.push(['padding-left', fact.axis === 'row' ? '0px' : px(inset)]);
  if (fact && fact.chromeBg) decls.push(['background-color', fact.chromeBg]);
  // Lift the chrome's own real corner-radius/stroke too — same "the hidden
  // chrome's look belongs on the member that replaces it" reasoning as
  // chromeBg above; previously only the fill made it across (real bug:
  // Incentives' card chrome rect carries a real 15%-white 1px stroke that
  // never reached the visible card).
  if (fact && Number.isFinite(fact.chromeCornerRadius) && fact.chromeCornerRadius > 0) {
    decls.push(['border-radius', px(fact.chromeCornerRadius)]);
  }
  // docs/COMPILER_REDESIGN_ROADMAP.md Phase 8 — was a hardcoded `border`
  // regardless of the chrome's real declared strokeAlign (the tracked
  // strokeAlign bug: Section 6.2). Now shares modeDecls()'s single
  // strokeAlign-aware decision instead of a second, divergent one.
  if (fact) {
    decls.push(...strokeDecls(fact.chromeStrokeCss, fact.chromeStrokeWeight, fact.chromeStrokeAlign, 'solid'));
  }
  return decls;
}

/**
 * A `freeform-layout-ir` member's chrome background node (hidden — its color
 * already lives on the member, same idiom as `rowSetChromeHiddenDecls`).
 * @returns {Array<[string,string]>}
 */
function freeformChromeHiddenDecls() {
  return [['display', 'none']];
}

/**
 * An intermediate pass-through wrapper on the path from a member down to one
 * of its resolved column leaves (the wrapper-unwrap step of `detect.js`,
 * re-derived read-only at render time, same idiom as `rowSetPassthroughDecls`).
 * @returns {Array<[string,string]>}
 */
function freeformPassthroughDecls() {
  return [['display', 'contents']];
}

/**
 * Explicit grid-line placement for one of a member's resolved column leaves
 * (`memberColumnMap[columnId]`) — placed explicitly (not left to auto-flow)
 * because a member can genuinely be missing a column (an explicit `null` in
 * `memberColumnMap`), which would otherwise silently shift every subsequent
 * column's auto-placed line for that member only.
 * @param {{ axis:'row'|'column', order:number }} placement — `order` is the
 *   fact column's 0-based `order`. CSS grid lines are 1-based, AND
 *   `tracksWithGaps()` (above) interspersed a real gap track between every
 *   pair of real column tracks, so real column `order` i now sits at track
 *   index `2*i` (0-based) — 1-based grid line `2*i + 1`, not `order + 1`.
 * @returns {Array<[string,string]>}
 */
function freeformGridPlacementDecls(placement) {
  if (!placement || !Number.isFinite(placement.order)) return [];
  const decls = [[placementPropertyForAxis(placement.axis), String((2 * placement.order) + 1)]];
  // This leaf's OWN column's cross-axis inset (row→x, column→y) — see
  // detectFreeformLayout's own comment on why this moved from a single
  // member-wide padding to a per-column value applied per-leaf here: a
  // full-bleed column (e.g. a photo) and a genuinely inset column (e.g. a
  // title/date row) in the SAME member can't share one inset.
  if (Number.isFinite(placement.crossInset) && placement.crossInset > 0) {
    decls.push([placement.axis === 'row' ? 'margin-left' : 'margin-top', px(placement.crossInset)]);
  }
  return decls;
}

/**
 * A `freeform-layout-ir` column leaf's own corner-radius chrome — e.g. a
 * plain button/chip resolved as a member's grid-placed leaf (via
 * `freeformGridPlacementDecls`, above) never went through `cardChromeDecls`
 * (no recognized card/banner Component IR fact matches it), so it previously
 * received NO border-radius at all even when NDG's own ingest of the raw
 * Figma node (`compiler/ndg/ingest.js`'s `geometry.cornerRadius`) carries a
 * real, non-zero corner radius for it. This reads that already-ingested
 * value straight off the leaf node — same "read a real fact, never invent a
 * default" contract `cardChromeDecls` follows for `cornerRadius` above — and
 * is deliberately its OWN seam (not folded into `freeformGridPlacementDecls`)
 * so it can be emitted for any freeform-layout-ir leaf regardless of whether
 * that leaf also happens to receive explicit grid-line placement.
 * @param {number|null|undefined} cornerRadius — the leaf node's own
 *   `geometry.cornerRadius` (or `rectangleCornerRadii`-derived uniform value)
 *   as ingested by NDG; `null`/non-finite means Figma reported none.
 * @returns {Array<[string,string]>}
 */
function freeformLeafChromeDecls(cornerRadius) {
  if (!Number.isFinite(cornerRadius)) return [];
  return [['border-radius', px(cornerRadius)]];
}

/**
 * A `freeform-layout-ir` grid-item TEXT leaf's own wrap width. Neither
 * width-assignment branch in ir-experimental-renderer.js (the absolute-
 * position branch or the real-Auto-Layout-flow-child branch) ever runs for
 * a freeform-grid item — both explicitly exclude `isFreeformGridItem` so a
 * real offset/sizing hint isn't double-applied on top of the grid's own
 * placement — and `freeformGridPlacementDecls` above only emits grid-row/
 * grid-column, never a width. A text leaf therefore wraps against its
 * single-column grid track's full width (the card's own content width)
 * instead of Figma's own measured text box, producing systematically wrong
 * (later) wrap points. Real, confirmed bug (Figma file
 * fYKUEGHAxVkJwn8CwvJCsp node 50:2, "Incentives"): every one of 5 card
 * description paragraphs and the "Build Real- World AI Applications"
 * heading wrap one word later than Figma, because their emitted CSS class
 * has no width/max-width at all. `max-width` (not a hard `width`) so a
 * shorter real string still shrinks below it rather than being padded out
 * to a fixed box — Figma's own box is this node's natural wrapped-content
 * width, not a container the text must fill.
 * @param {number|null|undefined} maxWidth — the leaf node's own captured
 *   box width (`node.box.width`), text nodes only; `null`/non-finite means
 *   nothing to constrain.
 * @returns {Array<[string,string]>}
 */
function freeformLeafTextWidthDecls(maxWidth) {
  if (!Number.isFinite(maxWidth)) return [];
  return [['max-width', px(maxWidth)]];
}

/**
 * Build the full ordered declaration list for one node's layoutChoice.
 * Card chrome (if present) is layered after the mode decls, matching
 * `collapseCardShells` running after `forceContentFlexStacks` in legacy.
 * Row-set decls (if present) layer on next, same override-by-property
 * precedence.
 *
 * @returns {Array<[string,string]>}
 */
function buildDecls(layoutChoice) {
  const decls = modeDecls(layoutChoice);
  const overlay = (pairs) => {
    for (const [k, v] of pairs) {
      const idx = decls.findIndex((d) => d[0] === k);
      if (idx >= 0) decls[idx] = [k, v];
      else decls.push([k, v]);
    }
  };
  if (layoutChoice && layoutChoice.cardFact) {
    // Card chrome takes precedence over the generic mode decls for the
    // same property (mirrors collapseCardShells overwriting the card's
    // own display/flex-direction).
    overlay(cardChromeDecls(layoutChoice.cardFact));
  }
  if (layoutChoice && layoutChoice.rowSetContainer) {
    overlay(rowSetContainerDecls(layoutChoice.rowSetContainer));
  }
  if (layoutChoice && layoutChoice.rowSetRow) {
    overlay(rowSetRowDecls(layoutChoice.rowSetRow));
  }
  if (layoutChoice && layoutChoice.rowSetPassthrough) {
    overlay(rowSetPassthroughDecls());
  }
  if (layoutChoice && layoutChoice.rowSetChromeHidden) {
    overlay(rowSetChromeHiddenDecls());
  }
  // `freeform-layout-ir` overlays layer LAST, so they take precedence over
  // both the generic mode decls AND the narrower Component IR row-set decls
  // for the same node/property — per the explicit "generalizes/supersedes"
  // design, this is the tier that should win whenever both a
  // `freeform-layout-ir` fact and a `rowSetFacts` fact exist for the same
  // node. In practice the renderer's mutual-exclusion (a table already
  // claimed by a `freeform-layout-ir` group has its `rowSetFacts` entry
  // skipped entirely) means both branches never actually fire together on
  // the same node today, but this ordering keeps the precedence explicit and
  // safe if that ever changes.
  //
  // MEMBER decls apply BEFORE container decls (real, confirmed bug: Figma
  // file eOwzPCQP0f3sAxzI0T0b9d, "Group 357" — a card is simultaneously the
  // CONTAINER of its own 2-item "Design"/"3 Month" badge row AND a MEMBER of
  // the outer 4-card row; both facts are independently correct, but the
  // member overlay running last silently overwrote the container's
  // `display:flex; flex-direction:row` (needed for the badges to sit side
  // by side) with the member's own `display:grid; grid-template-rows`
  // (describing this card's generic internal content bucketing as a member
  // of the OUTER group — an unrelated question). The container fact more
  // specifically describes how THIS node arranges its OWN real children
  // than the member fact's generic fallback does, so it must win for
  // `display`/`flex-direction`/`align-items`/`gap` whenever both exist for
  // the same node — reversing the order achieves that via the same
  // replace-by-key `overlay()` mechanism already used everywhere else,
  // with no new merge logic needed. A node that is only ONE of the two
  // (the overwhelmingly common case) is completely unaffected by this
  // reorder — only a node carrying BOTH facts simultaneously changes.
  if (layoutChoice && layoutChoice.freeformGroupMember) {
    overlay(freeformGroupMemberDecls(layoutChoice.freeformGroupMember));
  }
  if (layoutChoice && layoutChoice.freeformGroupContainer) {
    overlay(freeformGroupContainerDecls(layoutChoice.freeformGroupContainer, layoutChoice.fluidAbsoluteWidth));
  }
  if (layoutChoice && layoutChoice.freeformChromeHidden) {
    overlay(freeformChromeHiddenDecls());
  }
  if (layoutChoice && layoutChoice.freeformPassthrough) {
    overlay(freeformPassthroughDecls());
  }
  if (layoutChoice && layoutChoice.freeformGridPlacement) {
    overlay(freeformGridPlacementDecls(layoutChoice.freeformGridPlacement));
  }
  if (layoutChoice && Number.isFinite(layoutChoice.freeformLeafCornerRadius)) {
    overlay(freeformLeafChromeDecls(layoutChoice.freeformLeafCornerRadius));
  }
  if (layoutChoice && Number.isFinite(layoutChoice.freeformLeafTextMaxWidth)) {
    overlay(freeformLeafTextWidthDecls(layoutChoice.freeformLeafTextMaxWidth));
  }
  return decls;
}

/** Serialize an ordered decl list to a `key:value;key:value` string (for class-signature dedupe). */
function declString(decls) {
  return decls.map(([k, v]) => `${k}:${v}`).join(';');
}

/** Serialize an ordered decl list to a CSS rule body (`  key: value;\n...`). */
function declBody(decls) {
  return decls.map(([k, v]) => `  ${k}: ${v};`).join('\n');
}

module.exports = {
  px,
  round,
  figmaColor,
  solidFillCss,
  paintCss,
  boxShadowCss,
  blurFiltersCss,
  radialGradientCss,
  strokeDecls,
  modeDecls,
  cardChromeDecls,
  rowSetContainerDecls,
  rowSetRowDecls,
  rowSetPassthroughDecls,
  rowSetChromeHiddenDecls,
  freeformGroupContainerDecls,
  freeformGroupMemberDecls,
  freeformChromeHiddenDecls,
  freeformPassthroughDecls,
  freeformGridPlacementDecls,
  freeformLeafChromeDecls,
  freeformLeafTextWidthDecls,
  buildDecls,
  canvasDecls,
  declString,
  declBody,
  isPositionedAbsolute,
};
