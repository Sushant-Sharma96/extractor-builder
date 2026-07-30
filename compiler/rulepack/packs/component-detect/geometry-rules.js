'use strict';

/**
 * Phase 2 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — Component IR / Semantic IR
 * geometric+structural recognition: card shape, card-grid uniformity, banner
 * shape, and divider recognition. Consumed by compiler/components/detect.js
 * (Component IR) and compiler/semantic/detect.js (Semantic IR banner/divider
 * role hints).
 *
 * Heuristics migrated (all in server/figma-build.js), read-only, geometry/
 * structure facts ONLY — no HTML/CSS emission (that is Phase 3/4 scope):
 *   collapseCardShells, stampFeatureCards, inferCardGrids,
 *   normalizeSiblingCardChrome, collapseBannerShells, polishBannerContent,
 *   convertDividersToBorders, isVerticalDivider, isThinOverlay, isChromeBg.
 *
 * Discipline, identical to compiler/geometry/{detect,rules/vocabulary}.js:
 *   - Pure functions. Never mutate the NDG tree. Never commit Decisions.
 *   - Never talks to the solver or the renderer — only ever produces
 *     Evidence/Hypothesis-shaped Facts for Component IR / Semantic IR to
 *     consume, same as every other domain's detect.js.
 *   - Consumes Phase 1's geometric evidence (compiler/geometry) as INPUT
 *     (column-flex candidates for divider assignment) rather than
 *     re-deriving alignment/gap/grid facts Phase 1 already computed.
 *
 * Paint reads: Phase 1's compiler/geometry/rules/vocabulary.js deliberately
 * never reads paints ("this stage never reads paints, by design"). Phase 2
 * is explicitly allowed to (see the blueprint's Phase 2 plan) — this file's
 * isChromeBgRefined/isDarkFill extend the box-only tests with paint data,
 * without changing the box-only result when no paint data is present (never
 * a regression against what Phase 1 already proved).
 *
 * EventCard scope decision (server/figma-build.js's applyEventCardSemantics):
 * OUT OF SCOPE for this file. That function's classification runs on TEXT
 * CONTENT (emoji/regex matches on strings like "trophy", "registration ends
 * on", "hackspace") layered on top of already-built card columns — genuine
 * business/domain semantic knowledge, not generic geometric or structural
 * recognition. Folding it in here would reintroduce exactly the kind of
 * special-casing the blueprint's Phase 2 risk note warns against. Card shape
 * recognition (this file) is a prerequisite EventCard could eventually build
 * on, but the text-content classification itself is deferred, not built.
 */

const {
  isChromeBg: isChromeBgBoxOnly,
  isThinOverlay,
  isVerticalDivider,
} = require('../../../geometry/rules/vocabulary');
const { indexGraph } = require('../../../layout/collect');

// ─── Box / node primitives ─────────────────────────────────────────────────

function boxOf(node) {
  const b = node && node.box;
  if (!b || b.x == null || b.y == null || b.width == null || b.height == null) return null;
  return { x: Number(b.x), y: Number(b.y), w: Number(b.width), h: Number(b.height) };
}

function upperType(node) {
  return String((node && node.type) || '').toUpperCase();
}

function isTextNode(node) {
  return upperType(node) === 'TEXT';
}

function paintsOf(node) {
  return (node && node.paints) || [];
}

function hasImageFill(node) {
  return paintsOf(node).some((p) => p && p.type === 'IMAGE');
}

function hasSolidFill(node) {
  return paintsOf(node).some((p) => p && p.type === 'SOLID');
}

function solidFillColor(node) {
  const solid = paintsOf(node).find((p) => p && p.type === 'SOLID');
  if (!solid) return null;
  // Figma SOLID paints always carry a color in practice; missing/partial
  // channels (e.g. a synthetic fixture's bare `{ type: 'SOLID' }`) default to
  // 0 — same "treat as black" behavior as an unset RGB channel upstream.
  const { r, g, b } = solid.color || {};
  return {
    r: Math.round(Number(r || 0) * 255),
    g: Math.round(Number(g || 0) * 255),
    b: Math.round(Number(b || 0) * 255),
  };
}

/** Relative luminance gate — faithful port of figma-build.js's isDarkCssColor,
 *  reading the raw Figma paint color (0..1 float channels) instead of a
 *  serialized CSS string, which doesn't exist yet at this IR stage. */
function isDarkFill(node) {
  const c = solidFillColor(node);
  if (!c) return false;
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) < 110;
}

/**
 * isChromeBgRefined — Phase 1's isChromeBg (box-geometry-only: near-origin,
 * covers ≥90% width / ≥85% height of the container) refined with paint data.
 * Legacy (server/figma-build.js's isChromeBg) already excludes img/svg kind
 * nodes from ever counting as chrome, even when their box covers the whole
 * container — only vector/solid "shell" backgrounds count as chrome. Phase
 * 1's box-only version cannot make that distinction (no paint reads); Phase
 * 2 can, so this is a genuine refinement, not a duplicate.
 * @returns {{ isChrome: boolean, reason: string }}
 */
function isChromeBgRefined(node, containerBox) {
  const box = boxOf(node);
  if (!box || !containerBox) return { isChrome: false, reason: 'no-box' };
  if (isTextNode(node)) return { isChrome: false, reason: 'text' };
  if (hasImageFill(node)) return { isChrome: false, reason: 'image-fill' };
  if (!isChromeBgBoxOnly(box, containerBox)) return { isChrome: false, reason: 'geometry' };
  return { isChrome: true, reason: hasSolidFill(node) ? 'geometry+paint' : 'geometry-only' };
}

// ─── Card shape recognition ─────────────────────────────────────────────────
// collapseCardShells (shape 'shell') + stampFeatureCards (shape 'frame')

const CARD_MIN_W = 160;
const CARD_MAX_W = 440;
const CARD_MIN_H = 180;
const CARD_MAX_H = 640;

// Shared with compiler/freeform-layout/detect.js (imported from here, not
// redefined) — moved to this module because this is where the gap it closes
// actually lives. Was previously a private constant inside freeform-layout's
// own determineGroupAxis(), used to gate ITS OWN call into
// detectCardGridUniformity below with an alignment check the function itself
// never performed. That left compiler/components/detect.js's own direct call
// into detectCardGridUniformity (via detectComponentGeometry, with no such
// gate) exposed to a confirmed, real misclassification: 3+ individually
// card-shaped elements stacked VERTICALLY also satisfy this function's
// w/h-variance-only test (see docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md
// Part 4.2.3), so Component IR would report a horizontal card-grid for
// content that is actually a vertical stack. Making the check intrinsic to
// detectCardGridUniformity itself closes the gap for every caller, not just
// the one that happened to already know to guard against it.
const ROW_ALIGNMENT_TOLERANCE_FRACTION = 0.05;

/**
 * detectCardShape — recognizes one of the two legacy card shapes for a
 * single parent + its direct children, from box geometry (+ paint for chrome
 * classification) alone.
 * @returns {null | { pattern:'card', shape:'shell'|'frame', nodeId, chromeId,
 *   contentIds, overlayIds, badgeIds, padding }}
 */
function detectCardShape(parentNode, children, opts = {}) {
  const box = boxOf(parentNode);
  if (!box) return null;
  const kids = (children || []).map((c) => ({ node: c, box: boxOf(c) })).filter((c) => c.box);
  if (kids.length < 2) return null;

  const chrome = kids.filter((c) => isChromeBgRefined(c.node, box).isChrome);
  const overlays = kids.filter((c) => !chrome.includes(c) && isThinOverlay(c.box));
  const content = kids.filter((c) => !chrome.includes(c) && !overlays.includes(c));

  // Shape A — chrome rectangle + single content wrap (collapseCardShells).
  // Legacy also required the wrap already be a flex stack OR have ≥2
  // children ("innerKids.length >= 2") to avoid collapsing a meaningless
  // single-leaf wrap; decls don't exist yet at this IR stage, so the
  // structural equivalent is checking the wrap's own child COUNT via
  // opts.childCountOf, when the caller supplies graph access (optional —
  // pure unit tests of this function in isolation may omit it).
  if (chrome.length >= 1 && content.length === 1) {
    const wrap = content[0];
    if (opts.childCountOf && opts.childCountOf(wrap.node.id) < 2) return null;
    const padTop = Math.max(0, wrap.box.y - box.y);
    const padLeft = Math.max(0, wrap.box.x - box.x);
    const padRight = Math.max(0, (box.x + box.w) - (wrap.box.x + wrap.box.w));
    const padBottom = Math.max(padTop, 24);
    return {
      pattern: 'card',
      shape: 'shell',
      nodeId: parentNode.id,
      chromeId: chrome[0].node.id,
      contentIds: [wrap.node.id],
      overlayIds: overlays.map((o) => o.node.id),
      badgeIds: [],
      padding: {
        top: Math.round(padTop),
        left: Math.round(padLeft),
        right: Math.round(padRight),
        bottom: Math.round(padBottom),
      },
    };
  }

  // Shape B — the frame itself owns the fill; ≥2 content children
  // (stampFeatureCards). Geometric badge test only: a small chip in the
  // right ~45% of the card near the top. Legacy's isStepBadge ALSO matched a
  // text-content regex (`/^STEP[_\s-]?\d+/i`) — that text-content branch is
  // out of scope for this geometry/structure-only stage (see file header);
  // only the size+position branch is ported.
  if (
    hasSolidFill(parentNode)
    && box.w >= CARD_MIN_W && box.w <= CARD_MAX_W
    && box.h >= CARD_MIN_H && box.h <= CARD_MAX_H
    && content.length >= 2
  ) {
    const badges = content.filter((c) => c.box.w <= 72 && c.box.h <= 24 && (c.box.x - box.x) > box.w * 0.45);
    const stack = content.filter((c) => !badges.includes(c));
    if (stack.length >= 2) {
      const minX = Math.min(...stack.map((c) => c.box.x));
      const minY = Math.min(...stack.map((c) => c.box.y));
      const maxX = Math.max(...stack.map((c) => c.box.x + c.box.w));
      return {
        pattern: 'card',
        shape: 'frame',
        nodeId: parentNode.id,
        chromeId: null,
        contentIds: stack.map((c) => c.node.id),
        overlayIds: overlays.map((o) => o.node.id),
        badgeIds: badges.map((c) => c.node.id),
        padding: {
          top: Math.round(Math.max(0, minY - box.y)),
          left: Math.round(Math.max(0, minX - box.x)),
          right: Math.round(Math.max(0, (box.x + box.w) - maxX)),
          bottom: 0,
        },
      };
    }
  }

  return null;
}

// ─── Card-grid uniformity + sibling chrome normalization ───────────────────
// inferCardGrids (uniform size → grid gap) + normalizeSiblingCardChrome
// (shared padding descriptor) — THE anti-drift mechanism for the "row 002
// got a different DOM shape than 003/004" bug class named in the blueprint.

/**
 * detectCardGridUniformity — server/figma-build.js's inferCardGrids: sibling
 * cards are recognized as one uniform grid only when their size variance is
 * within tolerance (width span ≤20% of max, height span ≤35% of max).
 * @param {string} parentId
 * @param {{ nodeId:string, box:{x,y,w,h} }[]} cards
 * @returns {null | { pattern:'card-grid', nodeId, orderedChildIds, gap }}
 */
function detectCardGridUniformity(parentId, cards) {
  if (!cards || cards.length < 2) return null;
  const widths = cards.map((c) => c.box.w);
  const heights = cards.map((c) => c.box.h);
  const wSpan = Math.max(...widths) - Math.min(...widths);
  const hSpan = Math.max(...heights) - Math.min(...heights);
  if (wSpan > Math.max(...widths) * 0.2) return null;
  if (hSpan > Math.max(...heights) * 0.35) return null;
  // Real, confirmed gap (see ROW_ALIGNMENT_TOLERANCE_FRACTION's comment
  // above): uniform width/height alone does not mean "arranged side by
  // side" — a vertically-stacked set of identically-sized cards satisfies
  // both checks above just as well as a genuine horizontal row does. A
  // horizontal row's cards share (approximately) the same top edge; this
  // is the one additional fact that actually distinguishes the two.
  const ys = cards.map((c) => c.box.y);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  if (ySpan > Math.max(...heights) * ROW_ALIGNMENT_TOLERANCE_FRACTION) return null;

  const byX = [...cards].sort((a, b) => a.box.x - b.box.x);
  const gaps = [];
  for (let i = 1; i < byX.length; i++) {
    gaps.push(Math.max(0, byX[i].box.x - (byX[i - 1].box.x + byX[i - 1].box.w)));
  }
  const gap = gaps.length
    ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
    : 28;

  return {
    pattern: 'card-grid',
    nodeId: parentId,
    orderedChildIds: byX.map((c) => c.nodeId),
    gap,
  };
}

function paddingKey(p) {
  return `${p.top}|${p.right}|${p.bottom}|${p.left}`;
}

/**
 * normalizeUniformCardChrome — server/figma-build.js's
 * normalizeSiblingCardChrome: a group of sibling cards shares ONE canonical
 * padding descriptor (the statistical mode across the group — same
 * mechanism as legacy's `mode()` helper), not each card's independently
 * rounded value. This is the structural fix for drift: two structurally
 * identical cards that happen to round to {top:24} and {top:25} due to
 * float noise are collapsed onto the SAME canonical descriptor, and the
 * whole group — including any exact duplicates — gets byte-identical
 * `padding` objects (verified by compiler/test/component-geometry.test.js).
 * @param {object[]} cardFacts — detectCardShape() results, same parent
 * @returns {object[]} same facts, `padding` replaced by the group's
 *   canonical descriptor, plus `paddingNormalized: boolean`
 */
function normalizeUniformCardChrome(cardFacts) {
  if (!cardFacts || cardFacts.length < 2) {
    return (cardFacts || []).map((c) => ({ ...c, paddingNormalized: false }));
  }
  const counts = new Map();
  for (const c of cardFacts) {
    const k = paddingKey(c.padding);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let canonicalKey = null;
  let bestCount = -1;
  // Deterministic tie-break: first-seen key wins ties (cardFacts is already
  // nodeId-sorted by the caller), matching legacy's array-order mode() tie
  // behavior exactly rather than leaving it to Map iteration order.
  for (const c of cardFacts) {
    const k = paddingKey(c.padding);
    const n = counts.get(k);
    if (n > bestCount) {
      bestCount = n;
      canonicalKey = k;
    }
  }
  const canonical = cardFacts.find((c) => paddingKey(c.padding) === canonicalKey).padding;
  return cardFacts.map((c) => ({
    ...c,
    padding: { ...canonical },
    paddingNormalized: paddingKey(c.padding) !== canonicalKey,
  }));
}

// ─── Row-set (repeating-pattern / table) recognition ───────────────────────
// NEW capability (not in server/figma-build.js — no legacy heuristic to port
// from): recognizes N sibling containers stacked VERTICALLY as uniform
// full-width "rows" (Challenge Arena's table shape), the counterpart to
// detectCardGridUniformity's HORIZONTAL side-by-side case above. Same
// discipline as every other detector in this file: pure, box/paint-geometry
// only, no text-content reads.

/**
 * largestUniformSizeCluster — greedy height-based clustering that isolates
 * the dominant uniform-size group among a parent's children when a small
 * number of them are structurally different (e.g. a "TH" header row sitting
 * alongside 4 uniform data rows — the exact real shape found in the
 * Challenge Arena fixture's `table` node, output/figma-cache/
 * c0kt3mp76RoEiq3CFoeCHa__1_2/document.json). Reuses
 * detectCardGridUniformity's 35%-of-max height-tolerance band as the
 * clustering threshold — same tolerance number, applied as a grouping cut
 * rather than a single accept/reject gate, so a minority outlier (the
 * header) doesn't poison the whole parent's row-set recognition.
 * @param {{ nodeId:string, box:{x,y,w,h} }[]} items
 * @returns {{ nodeId:string, box:{x,y,w,h} }[]} the largest cluster (ties
 *   broken by first-seen-in-sorted-order, deterministic)
 */
function largestUniformSizeCluster(items) {
  const sorted = [...items].sort((a, b) => a.box.h - b.box.h);
  const clusters = [];
  let current = [];
  for (const item of sorted) {
    if (!current.length) {
      current = [item];
      continue;
    }
    const heights = [...current.map((c) => c.box.h), item.box.h];
    const maxH = Math.max(...heights);
    const minH = Math.min(...heights);
    if ((maxH - minH) <= maxH * 0.35) {
      current.push(item);
    } else {
      clusters.push(current);
      current = [item];
    }
  }
  if (current.length) clusters.push(current);
  clusters.sort((a, b) => b.length - a.length);
  return clusters[0] || [];
}

/**
 * detectRowSetUniformity — the Y-axis counterpart to
 * detectCardGridUniformity: N (≥3) sibling containers recognized as one
 * uniform vertically-stacked "row-set" when, after isolating the dominant
 * size cluster (largestUniformSizeCluster, above), their width/height
 * variance is within the SAME tolerance bands detectCardGridUniformity uses
 * (width span ≤20% of max, height span ≤35% of max) AND their left edges
 * are aligned (x span ≤5% of max width — this is what distinguishes a
 * vertical stack of full-width rows from a horizontal row of cards, which
 * detectCardGridUniformity already owns).
 * @param {string} parentId
 * @param {{ nodeId:string, box:{x,y,w,h} }[]} rows
 * @returns {null | { pattern:'row-set', nodeId, orderedChildIds, gap }}
 */
function detectRowSetUniformity(parentId, rows) {
  if (!rows || rows.length < 3) return null;
  const cluster = largestUniformSizeCluster(rows);
  if (cluster.length < 3) return null;

  const widths = cluster.map((c) => c.box.w);
  const heights = cluster.map((c) => c.box.h);
  const xs = cluster.map((c) => c.box.x);
  const wSpan = Math.max(...widths) - Math.min(...widths);
  const hSpan = Math.max(...heights) - Math.min(...heights);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  if (wSpan > Math.max(...widths) * 0.2) return null;
  if (hSpan > Math.max(...heights) * 0.35) return null;
  if (xSpan > Math.max(...widths) * 0.05) return null; // left-aligned ⇒ vertical stack, not a row of cards

  const byY = [...cluster].sort((a, b) => a.box.y - b.box.y);
  const gaps = [];
  for (let i = 1; i < byY.length; i++) {
    gaps.push(Math.max(0, byY[i].box.y - (byY[i - 1].box.y + byY[i - 1].box.h)));
  }
  const gap = gaps.length
    ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
    : 0;

  return {
    pattern: 'row-set',
    nodeId: parentId,
    orderedChildIds: byY.map((c) => c.nodeId),
    gap,
  };
}

/**
 * rowColumnCandidates — one row's own children, recursively unwrapped ONE
 * level for any child that is itself a pass-through wrapper (≥2 children of
 * its own, spanning ≥50% of the row's width, e.g. Challenge Arena's
 * "Group 1171278044" content strip that bundles id/title/reward/xp — see
 * the file header's real-fixture notes). Chrome backgrounds (full-bleed
 * solid rects) are excluded, same isChromeBgRefined test every other
 * detector in this file already uses. Purely geometric — no text/name
 * reads, per the file's discipline.
 * @param {{x,y,w,h}} rowBox
 * @param {object[]} rowKidNodes — the row's direct children (graph nodes)
 * @param {(nodeId:string) => object[]} childrenOfFn
 * @returns {{ nodeId:string, box:{x,y,w,h} }[]}
 */
function rowColumnCandidates(rowBox, rowKidNodes, childrenOfFn) {
  const kids = (rowKidNodes || []).map((n) => ({ node: n, box: boxOf(n) })).filter((k) => k.box);
  const nonChrome = kids.filter((k) => !isChromeBgRefined(k.node, rowBox).isChrome);
  const out = [];
  for (const k of nonChrome) {
    const grandkids = (childrenOfFn ? childrenOfFn(k.node.id) : []) || [];
    const isWideWrapper = grandkids.length >= 2 && k.box.w >= rowBox.w * 0.5;
    if (isWideWrapper) {
      for (const gc of grandkids) {
        const gcBox = boxOf(gc);
        if (gcBox) out.push({ nodeId: gc.id, box: gcBox });
      }
    } else {
      out.push({ nodeId: k.node.id, box: k.box });
    }
  }
  return out;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * chainClusterByPosition — the shared chain-clustering core: sort items by
 * `pos`, greedily group each into the first existing cluster whose
 * LAST-added item is within `tolerance`, otherwise start a new cluster; then
 * collapse each cluster onto its median `pos`/`size` (the same "many
 * measurements, one canonical value" principle normalizeUniformCardChrome
 * above uses for padding). Returns each cluster's raw member items alongside
 * the summary so a caller can derive its own cluster-level metadata (e.g.
 * computeRowSetColumns' `rowCount`, clusterByPosition's `membersByIndex`)
 * without this core needing to know what that metadata is.
 *
 * Previously reimplemented twice — verbatim here, and (with a deliberately
 * matching tolerance, per that copy's own comment) as compiler/freeform-
 * layout/detect.js's clusterByPosition, which now wraps this instead. See
 * docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md Part 4.2.3.
 * @param {{ pos:number, size:number }[]} items
 * @param {number} tolerance
 * @returns {{ pos:number, size:number, items:object[] }[]} sorted by pos ascending
 */
function chainClusterByPosition(items, tolerance) {
  const sorted = [...items].sort((a, b) => a.pos - b.pos);
  const clusters = [];
  for (const item of sorted) {
    let target = null;
    for (const cl of clusters) {
      const lastPos = cl.items[cl.items.length - 1].pos;
      if (Math.abs(lastPos - item.pos) <= tolerance) {
        target = cl;
        break;
      }
    }
    if (target) target.items.push(item);
    else clusters.push({ items: [item] });
  }
  return clusters
    .map((cl) => ({
      pos: Math.round(median(cl.items.map((i) => i.pos))),
      size: Math.round(median(cl.items.map((i) => i.size))),
      items: cl.items,
    }))
    .sort((a, b) => a.pos - b.pos);
}

/**
 * computeRowSetColumns — cross-row column alignment: cluster each row's
 * column candidates by x-position (chain clustering, 24px tolerance) into
 * "same column across all rows" buckets, then collapse each bucket onto ONE
 * canonical x/width descriptor. Purely positional — deliberately does NOT
 * attempt to label columns semantically (no "this is the reward column"
 * text matching), per the task's explicit scope limit.
 * @param {{ nodeId:string, box:{x,y,w,h} }[][]} perRowColumns
 * @returns {{ x:number, width:number, rowCount:number, memberIds:string[] }[]}
 *   sorted by canonical x ascending
 */
function computeRowSetColumns(perRowColumns, tolerance = 24) {
  const all = [];
  perRowColumns.forEach((cols, rowIdx) => {
    for (const c of cols) all.push({ ...c, rowIdx, pos: c.box.x, size: c.box.w });
  });

  return chainClusterByPosition(all, tolerance).map((cl) => ({
    x: cl.pos,
    width: cl.size,
    rowCount: new Set(cl.items.map((i) => i.rowIdx)).size,
    memberIds: cl.items.map((i) => i.nodeId).sort(),
  }));
}

// ─── Banner shape recognition ───────────────────────────────────────────────
// collapseBannerShells + polishBannerContent (geometry/structure facts only)

/**
 * detectBannerShape — server/figma-build.js's collapseBannerShells: a wide,
 * short shell (aspect ratio ≥2.2) with a dark, full-bleed chrome fill and at
 * least one text-bearing content child.
 * @param {object} opts.hasTextDescendant — (nodeId) => boolean, supplied by
 *   the caller (compiler/components/detect.js has graph traversal already;
 *   this module stays graph-traversal-agnostic for its per-node API).
 * @returns {null | { pattern:'banner', nodeId, chromeId, contentIds, padding }}
 */
function detectBannerShape(parentNode, children, opts = {}) {
  const box = boxOf(parentNode);
  if (!box) return null;
  const { w, h } = box;
  if (!(w >= 480 && h >= 80 && h <= 360 && w / Math.max(h, 1) >= 2.2)) return null;

  const kids = (children || []).map((c) => ({ node: c, box: boxOf(c) })).filter((c) => c.box);
  if (kids.length < 2) return null;

  const chrome = kids.filter((c) => isChromeBgRefined(c.node, box).isChrome);
  const content = kids.filter((c) => !chrome.includes(c) && !isThinOverlay(c.box));
  if (chrome.length < 1 || content.length < 1) return null;

  const hasText = opts.hasTextDescendant
    ? content.some((c) => opts.hasTextDescendant(c.node.id))
    : content.some((c) => isTextNode(c.node));
  if (!hasText) return null;

  const paintChrome = chrome.find((c) => hasSolidFill(c.node)) || chrome[0];
  if (!isDarkFill(paintChrome.node)) return null; // quote/CTA banners are dark strips

  const sorted = [...content].sort((a, b) => a.box.x - b.box.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const padding = {
    top: Math.round(Math.min(...sorted.map((c) => Math.max(0, c.box.y - box.y)))),
    bottom: Math.round(Math.min(...sorted.map((c) => Math.max(0, (box.y + box.h) - (c.box.y + c.box.h))))),
    left: Math.round(Math.max(0, first.box.x - box.x)),
    right: Math.round(Math.max(0, (box.x + box.w) - (last.box.x + last.box.w))),
  };

  return {
    pattern: 'banner',
    nodeId: parentNode.id,
    chromeId: paintChrome.node.id,
    contentIds: sorted.map((c) => c.node.id),
    padding,
  };
}

// ─── Divider recognition ────────────────────────────────────────────────────
// convertDividersToBorders (isVerticalDivider re-exported from Phase 1)

/**
 * assignDividerToColumns — server/figma-build.js's convertDividersToBorders:
 * a thin vertical hairline sitting between two Phase-1 column-flex clusters
 * becomes a boundary assignment (which column it trails), not a floating
 * absolute overlay.
 * @param {{x,y,w,h}} overlayBox
 * @param {{box:{x,y,w,h}}[][]} columns — Phase 1's evaluateColumnFlex
 *   candidate.columns, resolved to boxes by the caller
 * @returns {null | { pattern:'divider', axis:'vertical', afterColumnIndex:number }}
 */
function assignDividerToColumns(overlayBox, columns, parentBox) {
  if (!isVerticalDivider(overlayBox) || !parentBox || !Array.isArray(columns) || columns.length < 2) {
    return null;
  }
  const midX = overlayBox.x + overlayBox.w / 2;
  for (let i = 0; i < columns.length - 1; i++) {
    if (!columns[i].length || !columns[i + 1].length) continue;
    const right = Math.max(...columns[i].map((k) => k.box.x + k.box.w));
    const nextLeft = Math.min(...columns[i + 1].map((k) => k.box.x));
    if (midX >= right - 4 && midX <= nextLeft + 4) {
      return { pattern: 'divider', axis: 'vertical', afterColumnIndex: i };
    }
  }
  return null;
}

// ─── Top-level detector — walks the graph, mirrors compiler/geometry/detect.js ──

/**
 * detectComponentGeometry — full Phase 2 sweep over an NDG graph, producing
 * card / card-grid / banner / divider Facts. Pure, read-only, deterministic
 * (nodes visited in sorted id order; every output array is sorted).
 * @param {object} graph — NDG graph ({ nodes, edges, graphId })
 * @param {{ geometryCandidatesByNode?: object, hasTextDescendantFn?: Function }} [opts]
 *   geometryCandidatesByNode — Phase 1's compiler/geometry candidates,
 *   keyed by nodeId (only 'column-flex' pattern entries matter here, for
 *   divider assignment).
 */
function detectComponentGeometry(graph, opts = {}) {
  const nodes = [...(graph.nodes || [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  const { byId, childrenOf: childRefsOf, parentOf } = indexGraph(graph);
  const childrenOf = new Map();
  for (const [parentId, refs] of childRefsOf) {
    childrenOf.set(parentId, refs.map((r) => byId.get(r.id)).filter(Boolean));
  }

  function defaultHasTextDescendant(nodeId, depth = 0) {
    const node = byId.get(nodeId);
    if (!node) return false;
    if (isTextNode(node)) return true;
    if (depth >= 6) return false;
    const kids = childrenOf.get(nodeId) || [];
    return kids.some((k) => defaultHasTextDescendant(k.id, depth + 1));
  }
  const hasTextDescendant = opts.hasTextDescendantFn || defaultHasTextDescendant;
  const geometryCandidatesByNode = opts.geometryCandidatesByNode || {};
  const childCountOf = (nodeId) => (childrenOf.get(nodeId) || []).length;

  const cardFactsRaw = [];
  const bannerFacts = [];
  const rowSetFacts = [];
  const evidence = [];

  for (const node of nodes) {
    const kids = childrenOf.get(node.id) || [];
    if (kids.length >= 2) {
      const card = detectCardShape(node, kids, { childCountOf });
      if (card) {
        cardFactsRaw.push(card);
        evidence.push({
          kind: 'feature',
          ref: 'component.card-shape',
          detail: { nodeId: node.id, shape: card.shape },
        });
      } else {
        const banner = detectBannerShape(node, kids, { hasTextDescendant });
        if (banner) {
          bannerFacts.push(banner);
          evidence.push({
            kind: 'feature',
            ref: 'component.banner-shape',
            detail: { nodeId: node.id },
          });
        }
      }
    }
  }

  // Card-grid uniformity + shared chrome normalization: group sibling cards
  // by their common parent (precedence: this is purely additive metadata on
  // top of cardFactsRaw — never overrides a card's own shape/content facts).
  cardFactsRaw.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  const cardsByParent = new Map();
  for (const card of cardFactsRaw) {
    const parentId = parentOf.get(card.nodeId);
    if (!parentId) continue;
    if (!cardsByParent.has(parentId)) cardsByParent.set(parentId, []);
    cardsByParent.get(parentId).push(card);
  }

  const cardGridFacts = [];
  const cardFacts = [];
  const singletons = new Set(cardFactsRaw.map((c) => c.nodeId));
  for (const [parentId, cards] of cardsByParent) {
    for (const c of cards) singletons.delete(c.nodeId);
    if (cards.length < 2) {
      cardFacts.push(...cards.map((c) => ({ ...c, paddingNormalized: false })));
      continue;
    }
    const withBoxes = cards
      .map((c) => ({ ...c, box: boxOf(byId.get(c.nodeId)) }))
      .filter((c) => c.box);
    if (withBoxes.length >= 2) {
      const grid = detectCardGridUniformity(parentId, withBoxes);
      if (grid) {
        cardGridFacts.push(grid);
        evidence.push({
          kind: 'feature',
          ref: 'component.card-grid',
          detail: { nodeId: parentId, count: cards.length, gap: grid.gap },
        });
      }
    }
    cardFacts.push(...normalizeUniformCardChrome(cards));
  }
  // Cards with no recognized parent edge still publish their own Fact.
  for (const c of cardFactsRaw) {
    if (singletons.has(c.nodeId)) cardFacts.push({ ...c, paddingNormalized: false });
  }

  // Row-set (repeating-pattern / table) recognition: independent of the
  // card-shape pass above — operates directly on each parent's raw children
  // (a "row" is not necessarily a recognized card shape; Challenge Arena's
  // rows are chrome-rect + content-group + button, which detectCardShape
  // does not classify as either card shape — see this fact's own header
  // comment). Only attempted where card-grid didn't already claim the
  // parent, so a horizontal row of cards is never double-counted as a
  // vertical row-set for the same parent.
  const cardGridParentIds = new Set(cardGridFacts.map((g) => g.nodeId));
  for (const node of nodes) {
    if (cardGridParentIds.has(node.id)) continue;
    const kids = childrenOf.get(node.id) || [];
    if (kids.length < 3) continue;
    const rows = kids.map((k) => ({ nodeId: k.id, box: boxOf(k) })).filter((r) => r.box);
    const rowSet = detectRowSetUniformity(node.id, rows);
    if (!rowSet) continue;

    const perRowColumns = rowSet.orderedChildIds.map((rowId) => rowColumnCandidates(
      boxOf(byId.get(rowId)),
      childrenOf.get(rowId) || [],
      (id) => childrenOf.get(id) || [],
    ));
    const columns = computeRowSetColumns(perRowColumns);

    rowSetFacts.push({ ...rowSet, columns });
    evidence.push({
      kind: 'feature',
      ref: 'component.row-set',
      detail: { nodeId: node.id, rowCount: rowSet.orderedChildIds.length, columnCount: columns.length, gap: rowSet.gap },
    });
  }

  // Divider assignment: only meaningful when Phase 1 already recognized a
  // column-flex cluster for this node's parent.
  const dividerFacts = [];
  for (const node of nodes) {
    const box = boxOf(node);
    if (!box || !isThinOverlay(box) || !isVerticalDivider(box)) continue;
    const parentId = parentOf.get(node.id);
    if (!parentId) continue;
    const candidate = geometryCandidatesByNode[parentId];
    if (!candidate || candidate.pattern !== 'column-flex' || !Array.isArray(candidate.columns)) continue;
    const parentBox = boxOf(byId.get(parentId));
    const columns = candidate.columns.map((col) => col
      .map((id) => ({ nodeId: id, box: boxOf(byId.get(id)) }))
      .filter((c) => c.box));
    const assignment = assignDividerToColumns(box, columns, parentBox);
    if (assignment) {
      dividerFacts.push({ ...assignment, nodeId: node.id, parentId });
      evidence.push({
        kind: 'feature',
        ref: 'component.divider-shape',
        detail: { nodeId: node.id, afterColumnIndex: assignment.afterColumnIndex },
      });
    }
  }

  cardFacts.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  cardGridFacts.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  bannerFacts.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  rowSetFacts.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  dividerFacts.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  evidence.sort((a, b) => {
    const ka = `${a.ref}:${JSON.stringify(a.detail)}`;
    const kb = `${b.ref}:${JSON.stringify(b.detail)}`;
    return ka < kb ? -1 : 1;
  });

  return {
    cardFacts,
    cardGridFacts,
    bannerFacts,
    rowSetFacts,
    dividerFacts,
    evidence,
    metrics: {
      cardCount: cardFacts.length,
      cardGridCount: cardGridFacts.length,
      bannerCount: bannerFacts.length,
      rowSetCount: rowSetFacts.length,
      dividerCount: dividerFacts.length,
    },
  };
}

module.exports = {
  // primitives
  boxOf,
  upperType,
  isTextNode,
  hasImageFill,
  hasSolidFill,
  solidFillColor,
  isDarkFill,
  isChromeBgRefined,
  isThinOverlay,
  isVerticalDivider,
  ROW_ALIGNMENT_TOLERANCE_FRACTION,
  // card
  detectCardShape,
  detectCardGridUniformity,
  normalizeUniformCardChrome,
  // banner
  detectBannerShape,
  // row-set
  largestUniformSizeCluster,
  detectRowSetUniformity,
  rowColumnCandidates,
  computeRowSetColumns,
  chainClusterByPosition,
  // divider
  assignDividerToColumns,
  // top-level sweep
  detectComponentGeometry,
};
