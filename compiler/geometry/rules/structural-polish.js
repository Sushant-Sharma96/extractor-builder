'use strict';

/**
 * Phase 4 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — structural polish
 * heuristics that detect a NEW structural fact (as opposed to the phase's
 * other heuristics, which only apply an already-known fact as a rendering
 * decision — see compiler/emit/render/polish.js for those).
 *
 * Each function here is a faithful, read-only port of the geometric
 * *condition* computed by one of server/figma-build.js's late-pipeline
 * polish heuristics — never the mutation itself. Pure functions over plain
 * box/child data; never read a live figma-build element tree, never mutate
 * anything, never commit a Decision. Same discipline as
 * compiler/geometry/rules/vocabulary.js (Phase 1) and
 * compiler/rulepack/packs/component-detect/geometry-rules.js (Phase 2).
 *
 * Ported detectors:
 *   - isFullBleedLayer      — server/figma-build.js's fluidBackgroundLayers()
 *                             "covers" test: does this child's box cover
 *                             ~all of an ancestor's box (full-bleed bg/image)?
 *                             NOT already computed anywhere in compiler/ —
 *                             Phase 2's isChromeBg/isChromeBgRefined answers a
 *                             narrower, card-scoped question (is this rect the
 *                             ONE chrome fill behind a card's own content),
 *                             not "does this arbitrary descendant cover an
 *                             arbitrary ancestor's box" at any nesting depth.
 *   - detectArtboardLift    — server/figma-build.js's liftArtboardContent()
 *                             padding computation: given a root box and its
 *                             single flex/grid content child's box (already
 *                             selected by the caller), compute the four
 *                             padding values that convert artboard-absolute
 *                             placement into in-flow padding. Not published
 *                             by LayoutIR today (LayoutIR's `padding` is raw
 *                             Figma padding, not this content-vs-root offset
 *                             computation) — genuinely new.
 *   - detectSectionHeaderCluster — server/figma-build.js's
 *                             recoverSectionHeaders() cluster test: is this
 *                             set of absolute-placed children a centered
 *                             "eyebrow + title + subtitle" header cluster?
 *                             Not covered by Phase 2's card/banner/divider
 *                             facts.
 *   - orderChildrenVisualY  — server/figma-build.js's
 *                             orderSectionChildrenByVisualY(): headers first,
 *                             then remaining children sorted by (y, x).
 *                             LayoutIR's own `childOrder` only separates
 *                             in-flow vs. out-of-flow children in declared
 *                             order — it does not know which sibling is "the
 *                             header" nor sort the remainder by visual
 *                             position, so this ordering fact is new,
 *                             though it *consumes* the header flag from
 *                             detectSectionHeaderCluster rather than
 *                             re-deriving it.
 */

const { groupByRowOverlap } = require('./vocabulary');

/** @param {{x:number,y:number,width:number,height:number}} box */
function isBox(box) {
  return !!box && Number.isFinite(box.x) && Number.isFinite(box.y)
    && Number.isFinite(box.width) && Number.isFinite(box.height);
}

/**
 * Port of fluidBackgroundLayers()'s `covers` test.
 * @param {object} box — candidate child box
 * @param {object} parentBox — ancestor box it might be full-bleed against
 * @returns {boolean}
 */
function isFullBleedLayer(box, parentBox) {
  if (!isBox(box) || !isBox(parentBox)) return false;
  return box.width >= parentBox.width * 0.92
    && box.height >= parentBox.height * 0.85
    && Math.abs(box.x - parentBox.x) <= 6
    && Math.abs(box.y - parentBox.y) <= 6;
}

/**
 * Port of liftArtboardContent()'s padding math. Caller has already selected
 * the single flex/grid content child (`mainBox`) and verified it is still
 * artboard-placed and `rootBox` is section-sized (this function only does
 * the geometric computation, the eligibility gates are the caller's job,
 * mirroring how compiler/geometry/detect.js separates precedence checks
 * from the pure evaluate* functions).
 *
 * @param {object} rootBox
 * @param {object} mainBox
 * @returns {{top:number,right:number,bottom:number,left:number}|null}
 */
function detectArtboardLift(rootBox, mainBox) {
  if (!isBox(rootBox) || !isBox(mainBox)) return null;
  const top = Math.max(0, mainBox.y - rootBox.y);
  const left = Math.max(0, mainBox.x - rootBox.x);
  const right = Math.max(0, (rootBox.x + rootBox.width) - (mainBox.x + mainBox.width));
  const bottom = Math.max(40, (rootBox.y + rootBox.height) - (mainBox.y + mainBox.height));
  return { top, right, bottom, left };
}

/**
 * Port of recoverSectionHeaders()'s cluster-recognition test.
 *
 * @param {object} parentBox
 * @param {Array<{box:object, hasText:boolean, isAbsolute:boolean}>} kids
 * @returns {boolean}
 */
function detectSectionHeaderCluster(parentBox, kids) {
  if (!isBox(parentBox) || !Array.isArray(kids) || kids.length < 2) return false;
  const withBox = kids.filter((c) => c && isBox(c.box));
  if (withBox.length < 2) return false;

  const texts = withBox.filter((c) => c.hasText);
  if (texts.length < 2) return false;

  const maxY = Math.max(...withBox.map((c) => c.box.y + c.box.height));
  const minY = Math.min(...withBox.map((c) => c.box.y));
  const clusterH = maxY - minY;
  if (clusterH > parentBox.height * 0.45 && parentBox.height > 280) return false;
  if (clusterH > 220) return false;

  const absish = withBox.filter((c) => c.isAbsolute);
  if (absish.length < 2) return false;

  const xs = texts.map((c) => c.box.x + c.box.width / 2);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  if (xSpan > parentBox.width * 0.35 && texts.length >= 3) return false;

  return true;
}

/**
 * Port of orderSectionChildrenByVisualY()'s reordering: header-flagged
 * children promoted to the front (in their existing relative order), then
 * the remainder grouped into visual rows (Y-range overlap ratio, not a
 * strict shared top edge — see groupByRowOverlap's own comment for the real
 * fixture that motivated this: two cards 40px apart at the top edge that are
 * still the same visual row) and each row sorted by X. Pure — returns a new
 * ordered array of ids, never mutates the input.
 *
 * Kept in lockstep with compiler/skeleton/build.js's resolveReadingOrder,
 * updated identically in the same change — see the dedicated equivalence
 * test in compiler/test/skeleton.test.js, which is what makes it safe to
 * swap one for the other in the renderer.
 *
 * @param {Array<{id:string, box:object, isHeader?:boolean}>} children
 * @returns {string[]} ordered node ids
 */
function orderChildrenVisualY(children) {
  const list = Array.isArray(children) ? children : [];
  const withBox = list.filter((c) => c && isBox(c.box));
  if (withBox.length < 2) return list.map((c) => c && c.id).filter(Boolean);

  const heads = withBox.filter((c) => c.isHeader);
  // groupByRowOverlap's canonical box shape is {x,y,w,h} (matching
  // yOverlapRatio and the rest of this module) — this file's own boxes are
  // {x,y,width,height}, so they're converted here rather than inside the
  // shared helper (a real, caught bug: an earlier draft converted inside
  // groupByRowOverlap itself, which broke the OTHER caller that already
  // passes {w,h} natively — see that function's own comment).
  const body = withBox
    .filter((c) => !c.isHeader)
    .map((c) => ({ id: c.id, box: { x: c.box.x, y: c.box.y, w: c.box.width, h: c.box.height } }));
  body.sort((a, b) => a.box.y - b.box.y);
  const rows = groupByRowOverlap(body);
  const orderedBody = rows.flatMap((row) => [...row].sort((a, b) => a.box.x - b.box.x));
  const rest = list.filter((c) => !c || !isBox(c.box));
  return [...heads, ...orderedBody, ...rest].map((c) => c && c.id).filter(Boolean);
}

/**
 * Port of normalizeInFlowHeaderPadding()'s clamp formula: when a section's
 * first child is a recognized header and the section's own top padding is
 * large (artifact of an artboard-lift padding computation that assumed an
 * absolute header), shrink it. Returns `null` when no clamp is warranted
 * (caller keeps the existing padding value).
 *
 * @param {number} topPaddingPx
 * @returns {number|null}
 */
function clampHeaderPadding(topPaddingPx) {
  if (!Number.isFinite(topPaddingPx) || topPaddingPx < 80) return null;
  return Math.min(48, Math.round(topPaddingPx * 0.15));
}

module.exports = {
  isFullBleedLayer,
  detectArtboardLift,
  detectSectionHeaderCluster,
  orderChildrenVisualY,
  clampHeaderPadding,
};
