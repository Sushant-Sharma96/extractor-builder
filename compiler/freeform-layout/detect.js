'use strict';

/**
 * detect — freeform-layout-ir's four-step normalization algorithm.
 *
 * Walks every parent in the NDG graph directly (own axis-agnostic
 * uniform-clustering pass, step 1 below), consulting Component IR's already
 * published cardGridFacts/rowSetFacts only as optional cross-reference
 * metadata (`seedHint`) — NOT as a hard gate, because real-fixture
 * verification found Component IR's card-shape recognizer does not fire for
 * Articles' real cards (see detectFreeformLayout's own doc comment below for
 * the exact reason), which would make gating on it silently produce zero
 * groups for the very fixture this stage targets. Raw NDG box data drives
 * the structural work Component IR doesn't already capture (per-member
 * content resolution, wrapper unwrap, column bucketing with explicit
 * nulls). Pure functions. Never mutates the NDG tree. Never commits
 * Decisions.
 *
 * Step 1 — determineGroupAxis: ONE axis-agnostic function, reusing
 *   detectCardGridUniformity's/detectRowSetUniformity's existing tolerance
 *   math verbatim (imported, not reimplemented) to decide whether a parent's
 *   children repeat as axis="row" (uniform height, spread along X — Articles'
 *   card-grid) or axis="column" (uniform width, spread along Y, left-aligned
 *   — Challenge Arena's row-set). Never two hardcoded-axis functions.
 *
 * Step 2 — chrome/content separation: reuses isChromeBgRefined verbatim.
 *
 * Step 3 — wrapper unwrap: a member's non-chrome child is unwrapped one (or
 *   more, capped) level whenever IT ITSELF is a multi-child (>=2 kids)
 *   wrapper spanning >= WRAPPER_SPAN_FRACTION of the member's span in the
 *   dimension perpendicular to the repeating axis. This generalizes the
 *   design brief's "single remaining child" framing: real Challenge Arena
 *   data shows row 1 has exactly one non-chrome child (a wide wrapper
 *   bundling all 5 columns) while rows 2-4 have TWO non-chrome children (a
 *   wrapper bundling 4 columns, plus the action button as a separate direct
 *   child) — a strict "only unwrap when exactly one child remains" rule
 *   would unwrap row 1 but NOT rows 2-4, reproducing the very asymmetry this
 *   stage exists to close. Testing each child independently against the
 *   same wide-wrapper geometry test (mirroring geometry-rules.js's
 *   rowColumnCandidates' isWideWrapper, generalized to whichever dimension
 *   is perpendicular to the axis) closes both cases uniformly. This
 *   deviation from the literal "exactly one child" framing is intentional
 *   and is called out again in docs/COMPILER_MIGRATION_BLUEPRINT.md.
 *
 * Step 4 — position-based bucketing with union-of-columns: cluster each
 *   member's (now-flattened) real-content children by their position along
 *   the dimension PERPENDICULAR to the repeating axis (axis="row" members
 *   are already separated along X, so their own internal structure varies
 *   in Y — image/badge/title/footer stacked regions; axis="column" members
 *   are already separated along Y, so their internal structure varies in X
 *   — literal left-to-right columns). Same chain-clustering mechanism
 *   (24px tolerance, reused from computeRowSetColumns) for both axes. The
 *   canonical column list is the UNION across all members, not just the
 *   first — any member genuinely missing a column gets an explicit null in
 *   its memberColumnMap rather than being silently dropped.
 */

const { indexGraph } = require('../layout/collect');
const {
  boxOf,
  isChromeBgRefined,
  detectCardGridUniformity,
  detectRowSetUniformity,
  largestUniformSizeCluster,
  ROW_ALIGNMENT_TOLERANCE_FRACTION,
  chainClusterByPosition,
} = require('../rulepack/packs/component-detect/geometry-rules');
const {
  AXIS_ROW,
  AXIS_COLUMN,
  ROLE_CONTAINER,
  ROLE_MEMBER,
  EVIDENCE_GROUP,
  EVIDENCE_MEMBER,
  EVIDENCE_UNWRAP,
  COLUMN_CLUSTER_TOLERANCE,
  WRAPPER_SPAN_FRACTION,
  MAX_UNWRAP_DEPTH,
} = require('./constants');

// ─── Step 1 — axis-agnostic uniform-size clustering ────────────────────────

// Perpendicular-alignment discriminator tolerance — mirrors
// detectRowSetUniformity's own xSpan <= maxWidth*0.05 "left-aligned ⇒
// vertical stack" test verbatim; applied symmetrically here as a
// ySpan <= maxHeight*0.05 "top-aligned ⇒ horizontal row" test for the
// opposite axis. Imported from geometry-rules.js (not a private local copy)
// since detectCardGridUniformity now performs the identical check itself —
// this axis-priority decision and that correctness gate must stay the same
// number, not two independently-maintained ones.
const ALIGNMENT_TOLERANCE_FRACTION = ROW_ALIGNMENT_TOLERANCE_FRACTION;

/**
 * determineGroupAxis — ONE axis-agnostic function, data-driven (not two
 * hardcoded-axis functions). Real-fixture derivation (both Articles and
 * Challenge Arena parents mix repeating members with non-repeating
 * siblings — a page heading + "read all" link + tag chip sit alongside
 * Articles' 3 cards; a "TH" header row sits alongside Challenge Arena's 4
 * data rows): first isolates the dominant uniformly-SIZED cluster among a
 * parent's children (`largestUniformSizeCluster`, imported verbatim — same
 * function detectRowSetUniformity already uses internally to exclude the
 * table-header outlier), then decides axis from which alignment the
 * isolated cluster actually exhibits:
 *   - top edges aligned (ySpan small relative to height) ⇒ side-by-side ⇒
 *     axis="row", confirmed via detectCardGridUniformity (imported
 *     verbatim, not reimplemented) for its own w/h tolerance + gap calc.
 *   - left edges aligned (xSpan small relative to width) ⇒ stacked ⇒
 *     axis="column", confirmed via detectRowSetUniformity (imported
 *     verbatim) for its own tolerance + gap calc (it re-derives the same
 *     cluster internally, which is idempotent/harmless here).
 * A cluster satisfying neither (or, degenerately, both) falls back to
 * trying row then column in that order, same as before — but the
 * alignment check is what prevents a genuinely vertically-stacked,
 * identical-size cluster (Challenge Arena's rows, which ALSO satisfy
 * detectCardGridUniformity's w/h-variance-only test, since that detector
 * has no directional check of its own) from being misread as axis="row"
 * before axis="column" is ever tried.
 * @param {string} parentId
 * @param {{ nodeId:string, box:{x,y,w,h} }[]} items
 * @returns {null | { axis:'row'|'column', orderedIds:string[], gap:number }}
 */
function determineGroupAxis(parentId, items) {
  if (!items || items.length < 2) return null;
  const cluster = largestUniformSizeCluster(items);
  if (cluster.length < 2) return null;

  const heights = cluster.map((c) => c.box.h);
  const widths = cluster.map((c) => c.box.w);
  const ys = cluster.map((c) => c.box.y);
  const xs = cluster.map((c) => c.box.x);
  const maxH = Math.max(...heights);
  const maxW = Math.max(...widths);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const rowAligned = ySpan <= maxH * ALIGNMENT_TOLERANCE_FRACTION;
  const columnAligned = xSpan <= maxW * ALIGNMENT_TOLERANCE_FRACTION;

  function tryRow() {
    const rowCandidate = detectCardGridUniformity(parentId, cluster);
    if (!rowCandidate) return null;
    return { axis: AXIS_ROW, orderedIds: rowCandidate.orderedChildIds, gap: rowCandidate.gap };
  }
  function tryColumn() {
    if (cluster.length < 3) return null;
    const columnCandidate = detectRowSetUniformity(parentId, cluster);
    if (!columnCandidate) return null;
    return { axis: AXIS_COLUMN, orderedIds: columnCandidate.orderedChildIds, gap: columnCandidate.gap };
  }

  if (rowAligned && !columnAligned) return tryRow();
  if (columnAligned && !rowAligned) return tryColumn();
  // Ambiguous (both or neither aligned) — safe deterministic fallback order.
  return tryRow() || tryColumn();
}

// ─── Step 2 + 3 — chrome separation + wrapper unwrap ───────────────────────

function spanDim(box, axis) {
  return axis === AXIS_ROW ? box.h : box.w;
}

/**
 * unwrapChild — recursively (capped) replaces a wide multi-child wrapper
 * with its own children, in the dimension perpendicular to `axis`.
 * @returns {{node:object, box:object}[]}
 */
function unwrapChild(child, memberBox, axis, childrenOfFn, depth) {
  if (depth >= MAX_UNWRAP_DEPTH) return [child];
  const grandkids = (childrenOfFn(child.node.id) || [])
    .map((n) => ({ node: n, box: boxOf(n) }))
    .filter((k) => k.box);
  const memberSpan = spanDim(memberBox, axis);
  const childSpan = spanDim(child.box, axis);
  const spanFraction = memberSpan > 0 ? childSpan / memberSpan : 0;
  const isWideWrapper = grandkids.length >= 2 && spanFraction >= WRAPPER_SPAN_FRACTION;
  if (!isWideWrapper) return [child];
  return grandkids.flatMap((gc) => unwrapChild(gc, memberBox, axis, childrenOfFn, depth + 1));
}

/**
 * resolveMemberContent — a member's "real content" children: chrome
 * backgrounds excluded (isChromeBgRefined), then each remaining child
 * independently tested for wrapper-unwrap (step 3).
 * @returns {{node:object, box:object}[]}
 */
function resolveMemberContent(memberNode, memberBox, axis, childrenOfFn) {
  const kids = childrenOfFn(memberNode.id) || [];
  const withBoxes = kids.map((n) => ({ node: n, box: boxOf(n) })).filter((k) => k.box);
  const nonChrome = withBoxes.filter((k) => !isChromeBgRefined(k.node, memberBox).isChrome);
  return nonChrome.flatMap((child) => unwrapChild(child, memberBox, axis, childrenOfFn, 0));
}

/** IoU (intersection over union) of two `{x,y,w,h}` boxes — same formula as ir-experimental-renderer.js's own `iou()` (kept local; not worth a cross-file import for a 6-line geometry helper). */
function iou(a, b) {
  const ax2 = a.x + a.w; const ay2 = a.y + a.h;
  const bx2 = b.x + b.w; const by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Does this member's own direct, non-chrome content genuinely overlap
 * ITSELF — e.g. an icon glyph sitting on top of a separate, colored-circle
 * backdrop shape (two sibling nodes, not one shape with a fill)? Real,
 * verified case (Figma "Why Participate?" cards): an Ellipse (colored
 * circle) and an icon FRAME are both direct children, IoU ~0.7 — genuinely
 * composited, not sequential content a flat grid-row/column stack can
 * represent. Same IoU>0.1 "genuine overlap" threshold already proven at
 * the outer container level (ir-experimental-renderer.js's
 * computeFreeformFlowSafety) — one level up from what this checks, but the
 * same underlying question: can this content be safely flattened into a
 * sequence, or does it have real, meaningful spatial overlap that a grid
 * would destroy? Verified real bug this closes: two structurally-identical
 * sibling cards, only one of which happened to ALSO trip an unrelated gate
 * that kept it absolute — the other rendered its icon at grid-row
 * placement with no offset, losing alignment with its own backdrop circle.
 * @returns {boolean}
 */
function hasGenuineInternalOverlap(memberNode, memberBox, childrenOfFn) {
  const kids = childrenOfFn(memberNode.id) || [];
  const withBoxes = kids.map((n) => ({ node: n, box: boxOf(n) })).filter((k) => k.box);
  const nonChrome = withBoxes.filter((k) => !isChromeBgRefined(k.node, memberBox).isChrome);
  for (let i = 0; i < nonChrome.length; i += 1) {
    for (let j = i + 1; j < nonChrome.length; j += 1) {
      if (iou(nonChrome[i].box, nonChrome[j].box) > 0.1) return true;
    }
  }
  return false;
}

// ─── Step 4 — position-based bucketing, union-of-columns ──────────────────

function positionOf(item, memberBox, axis) {
  return axis === AXIS_ROW ? (item.box.y - memberBox.y) : (item.box.x - memberBox.x);
}
function sizeOf(item, axis) {
  return axis === AXIS_ROW ? item.box.h : item.box.w;
}
// The dimension positionOf() does NOT compute: for axis="row" (members
// spread along X, e.g. Articles'/Incentives' side-by-side cards), each
// member's own internal content is clustered along Y (positionOf) to build
// shared row-tracks — but every member is ALSO real-Figma-inset some px
// along X from its own left edge (Incentives: 40px, every card, verified
// directly against the cached Figma JSON), and nothing captured that until
// now (css-declarations.js's freeformGroupMemberDecls hardcoded it to 0 —
// see its own comment). Symmetric with positionOf: the opposite coordinate.
function crossPositionOf(item, memberBox, axis) {
  return axis === AXIS_ROW ? (item.box.x - memberBox.x) : (item.box.y - memberBox.y);
}

/**
 * clusterByPosition — now a thin wrapper around geometry-rules.js's shared
 * chainClusterByPosition (previously a full, independent reimplementation of
 * the identical chain-clustering + median-collapse algorithm computeRowSetColumns
 * already had — see that function's own comment, and docs/
 * FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md Part 4.2.3). Only this
 * function's own caller-specific shape (memberIndex-tagged input,
 * membersByIndex-keyed output) lives here now.
 * @param {{memberIndex:number, nodeId:string, pos:number, size:number}[]} taggedItems
 * @returns {{pos:number, size:number, membersByIndex:Map<number,string>}[]} sorted by pos
 */
function clusterByPosition(taggedItems, tolerance = COLUMN_CLUSTER_TOLERANCE) {
  return chainClusterByPosition(taggedItems, tolerance).map((cl) => ({
    pos: cl.pos,
    size: cl.size,
    membersByIndex: new Map(cl.items.map((i) => [i.memberIndex, i.nodeId])),
  }));
}

// ─── Top-level sweep ────────────────────────────────────────────────────────

/**
 * detectFreeformLayout — walks EVERY parent in the graph with >=2 children
 * (same sorted, deterministic traversal shape as detectComponentGeometry)
 * and applies determineGroupAxis directly against each parent's raw NDG
 * children. This is deliberately NOT gated behind Component IR's
 * cardGridFacts/rowSetFacts already having recognized the parent as a card
 * or table row: real-fixture verification (Articles' 3-card group, see
 * docs/COMPILER_MIGRATION_BLUEPRINT.md) found detectCardShape does not
 * classify these cards at all (their thumbnail rectangle covers the full
 * width but only ~56% of the card's height, failing isChromeBgRefined's
 * >=85%-height chrome test — the rectangle is real content, an image, not a
 * chrome background), so cardGridFacts never fires for them; gating this
 * stage's grouping on that upstream recognition would silently produce ZERO
 * groups for the very fixture this stage was designed against. Component
 * IR's cardGridPatterns/rowSetPatterns are still consulted (seedHint below)
 * as cross-reference metadata where they DO agree, but are not required.
 * @param {object} graph — NDG graph
 * @param {{ componentDetected?: object }} [opts]
 */
function detectFreeformLayout(graph, opts = {}) {
  const { byId, childrenOf: childRefsOf } = indexGraph(graph);
  const childrenOf = new Map();
  for (const [parentId, refs] of childRefsOf) {
    childrenOf.set(parentId, refs.map((r) => byId.get(r.id)).filter(Boolean));
  }
  const childrenOfFn = (id) => childrenOf.get(id) || [];

  const componentDetected = opts.componentDetected || {};
  const seedHintByParent = new Map();
  for (const g of componentDetected.cardGridPatterns || []) seedHintByParent.set(g.nodeId, 'card-grid');
  for (const g of componentDetected.rowSetPatterns || []) seedHintByParent.set(g.nodeId, 'row-set');

  const nodes = [...(graph.nodes || [])].sort((a, b) => (a.id < b.id ? -1 : 1));

  const groups = [];
  const evidence = [];

  for (const node of nodes) {
    const kids = childrenOfFn(node.id);
    if (kids.length < 2) continue;
    const items = kids.map((n) => ({ nodeId: n.id, box: boxOf(n) })).filter((i) => i.box);
    if (items.length < 2) continue;

    const axisResult = determineGroupAxis(node.id, items);
    if (!axisResult) continue;
    const { axis, orderedIds } = axisResult;
    const seedHint = seedHintByParent.get(node.id) || null;

    const memberContents = orderedIds.map((mid) => {
      const memberNode = byId.get(mid);
      const memberBox = boxOf(memberNode);
      const content = resolveMemberContent(memberNode, memberBox, axis, childrenOfFn);
      return { memberNode, memberBox, content };
    });

    // Internal-overlap gate: if ANY member's own content genuinely overlaps
    // itself (see hasGenuineInternalOverlap's comment), this whole group is
    // not safe to reduce to a flat clustered sequence — reject it outright
    // rather than only fixing the one member that happens to trip it,
    // since real fixtures show every member of a group shares the same
    // composited shape (all 5 "Why Participate?" cards have an icon-on-
    // circle badge, not just one).
    if (memberContents.some((m) => hasGenuineInternalOverlap(m.memberNode, m.memberBox, childrenOfFn))) continue;

    const taggedItems = [];
    memberContents.forEach((m, idx) => {
      for (const c of m.content) {
        taggedItems.push({
          memberIndex: idx,
          nodeId: c.node.id,
          pos: positionOf(c, m.memberBox, axis),
          size: sizeOf(c, axis),
          crossPos: crossPositionOf(c, m.memberBox, axis),
        });
      }
    });
    // Single group-level inset (not per-member): Figma's real design keeps
    // this uniform across every member (verified: Incentives' 5 cards all
    // inset their content exactly 40px) — min() rather than e.g. the first
    // item read (`cols[0]`, freeformGroupMemberDecls' old approach) so one
    // stray outlier can't pull every member's padding inward; floored at 0
    // like the pre-existing `Math.max(0, firstCol.x)` guard it replaces.
    const crossInset = taggedItems.length
      ? Math.max(0, Math.min(...taggedItems.map((t) => t.crossPos)))
      : 0;

    const clusters = clusterByPosition(taggedItems);
    const columns = clusters.map((cl, i) => ({
      columnId: `col:${i}`,
      order: i,
      x: cl.pos,
      width: cl.size,
    }));

    const members = orderedIds.map((mid, idx) => {
      const memberColumnMap = {};
      clusters.forEach((cl, i) => {
        memberColumnMap[`col:${i}`] = cl.membersByIndex.has(idx) ? cl.membersByIndex.get(idx) : null;
      });
      return {
        nodeId: mid,
        role: ROLE_MEMBER,
        slotIndex: idx,
        memberCount: orderedIds.length,
        axis,
        columns,
        memberColumnMap,
      };
    });

    // Structural-correspondence gate: with only 2 members, size/alignment
    // similarity alone is thin evidence of genuine repetition (this is why
    // detectRowSetUniformity already hard-requires >=3 members for the
    // column axis — the row axis had no equivalent floor). Rather than bump
    // the count floor (which would also reject legitimate clean 2-item row
    // pairs), gate on a signal this stage already computes: whether the two
    // members' own content actually corresponds. A null in ANY column means
    // the members' internal content did not line up there — for a 2-member
    // group that is direct structural evidence the "repeating group"
    // hypothesis is not well-supported (real fixture case: a decorative
    // 2-child sibling and an unrelated 2-child content sibling passed every
    // size/alignment tolerance yet only agreed on 4 of 9 computed columns).
    // Groups with 3+ members are unaffected — more members make partial
    // per-member variation ordinary and already-intended (Articles'/Challenge
    // Arena's validated groups both already sit at 0 nulls regardless).
    // Zero-column gate: a group with NO resolved columns at all is
    // trivially spurious (there is nothing to cluster, nothing to align)
    // — but it silently slipped past BOTH of the checks below, for the same
    // reason in each: an empty memberColumnMap (`{}`) has no values to
    // examine, so `.some(...)` (the 2-member check) and `.every(...)` (the
    // vacuous-member check, which was deliberately gated on
    // `columns.length > 0` for exactly this reason) both default to
    // "nothing wrong here" on an empty array, for opposite structural
    // reasons. Real, verified false positive this closes: a card frame
    // (Figma "Why Participate?", node 39:41) that ALSO, independently,
    // matched as its own 2-member container with 0 columns — registering
    // it as a freeform-layout-ir CONTAINER at all (even a functionally
    // inert one) collided with that same node's own membership in the
    // real, legitimate 5-card group, corrupting which rendering path it
    // took relative to its 4 sibling cards.
    if (columns.length === 0) continue;

    if (orderedIds.length === 2) {
      const anyNull = members.some(
        (m) => Object.values(m.memberColumnMap).some((v) => v === null)
      );
      if (anyNull) continue;
    }

    // Vacuous-member gate (any group size — the 2-member gate above is
    // narrower and stays as-is): a member whose ENTIRE memberColumnMap is
    // null contributed literally zero content to any of the group's
    // clustered columns. That's a fundamentally different situation from
    // ordinary partial variation (a real member legitimately missing SOME
    // columns, which 3+-member groups tolerate by design) — it means this
    // "member" isn't functioning as a repeating item at all. Real, verified
    // false positive this closes: Incentives' outer section container
    // (determineGroupAxis's own uniform-size clustering only compares
    // height, at 35% tolerance, so it happily merged two pixel-identical
    // full-bleed background rectangles — genuinely 0 children each, hence
    // automatically 100%-null — into the same cluster as the section's
    // entire, unrelated content wrapper). Verified this signal is absent
    // from every validated group across Challenge Arena, Articles, and the
    // full IBM page (each member sits at 0 nulls there) — this only fires
    // on genuinely vacuous members, never on legitimate sparse ones.
    // (columns.length is guaranteed > 0 here — the zero-column gate above
    // already `continue`d otherwise.)
    const hasVacuousMember = members.some(
      (m) => Object.values(m.memberColumnMap).every((v) => v === null)
    );
    if (hasVacuousMember) continue;

    const groupId = `group:${node.id}`;
    groups.push({
      groupId,
      containerNodeId: node.id,
      role: ROLE_CONTAINER,
      axis,
      memberCount: orderedIds.length,
      columns,
      members,
      crossInset,
      seedHint,
    });

    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_GROUP,
      detail: { groupId, containerNodeId: node.id, axis, memberCount: orderedIds.length, columnCount: columns.length },
    });
    for (const m of members) {
      const nullCount = Object.values(m.memberColumnMap).filter((v) => v === null).length;
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_MEMBER,
        detail: { groupId, nodeId: m.nodeId, slotIndex: m.slotIndex, nullColumns: nullCount },
      });
      if (nullCount > 0) {
        evidence.push({
          kind: 'other',
          ref: EVIDENCE_UNWRAP,
          detail: { groupId, nodeId: m.nodeId, nullColumns: nullCount, reason: 'member_missing_columns_after_unwrap' },
        });
      }
    }
  }

  groups.sort((a, b) => (a.groupId < b.groupId ? -1 : 1));
  evidence.sort((a, b) => {
    const ka = `${a.ref}:${JSON.stringify(a.detail)}`;
    const kb = `${b.ref}:${JSON.stringify(b.detail)}`;
    return ka < kb ? -1 : 1;
  });

  return {
    groups,
    evidence,
    metrics: {
      groupCount: groups.length,
      memberCount: groups.reduce((n, g) => n + g.members.length, 0),
    },
  };
}

module.exports = {
  determineGroupAxis,
  resolveMemberContent,
  unwrapChild,
  clusterByPosition,
  detectFreeformLayout,
};
