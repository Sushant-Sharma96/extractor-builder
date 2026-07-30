'use strict';

/**
 * Design Skeleton v0 — docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md
 * Part 3 / Part 7.6.
 *
 * Classifies every NDG node's structural ROLE — independent of where it sits
 * in Figma's raw tree — before any layout decision is made. This is the
 * direct architectural answer to "why are we missing nodes we have real data
 * for": today, a node's fate (rendered standalone / lifted as chrome /
 * flattened / accidentally dropped) is an emergent side effect of which of
 * three independent detectors' internal bookkeeping happens to claim it
 * first. Under this Skeleton, a node's fate is the legible consequence of a
 * role assigned once, for a stated reason, with a stated source.
 *
 * Explicitly scoped as v0 — see the research doc's Part 7.7 roadmap:
 *   - Base role classification (this file, new) reuses the same shared
 *     geometry/paint primitives compiler/rulepack/packs/component-detect/
 *     geometry-rules.js already exports (isChromeBgRefined, hasImageFill,
 *     isTextNode, boxOf, upperType) rather than re-deriving them a fourth
 *     time — the exact duplication the research document's Part 4.2.3
 *     documented as a root cause of "fix one thing, another appears
 *     elsewhere."
 *   - Repeating-group membership WRAPS compiler/freeform-layout's already-
 *     proven detectFreeformLayout() verbatim. Merging the three existing
 *     clustering engines' own internals into one is real, separate,
 *     later work (Part 7.7's Phase C continuation) — this phase reuses
 *     hard-won logic rather than re-deriving it a fourth time.
 *   - This module does not mutate the NDG tree (no flattening, no chrome
 *     lifting) and is not yet consumed by LayoutIR/ComponentIR/the
 *     renderer — it is a new, additive, independently-testable stage,
 *     proven against real fixtures before anything downstream depends on
 *     it, exactly to avoid the "unverified big rewrite" pattern the
 *     research document's Precedent section documented six times over.
 *
 * Pure functions only. Never touches a live render tree.
 */

const { indexGraph } = require('../layout/collect');
const {
  boxOf, upperType, isTextNode, hasImageFill, isChromeBgRefined,
} = require('../rulepack/packs/component-detect/geometry-rules');
const { detectFreeformLayout } = require('../freeform-layout/detect');
const {
  BUILDER_VERSION,
  ROLE_ROOT,
  ROLE_CONTENT,
  ROLE_DECORATIVE_CHROME,
  ROLE_STRUCTURAL_WRAPPER,
  ROLE_LAYOUT_CONTAINER_REAL,
  ROLE_LAYOUT_CONTAINER_INFERRED,
  ROLE_LEAF_SHAPE,
  GROUP_KIND_REPEATING,
} = require('./constants');

// Leaf vector-family shapes that can be meaningful content (icons/glyphs)
// rather than pure decoration — matches the real Figma node types found in
// this codebase's own corpus audit (Part 1.2 of the research doc).
const ICON_SHAPE_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON']);

function isRealAutoLayout(node) {
  const mode = String((node.attributes && node.attributes.layoutMode) || '').toUpperCase();
  return mode === 'HORIZONTAL' || mode === 'VERTICAL' || mode === 'GRID';
}

/**
 * Whether a container has any visual meaning of its own beyond arranging its
 * children — mirrors compiler/ndg/build.js's (Phase-A-fixed) hasPaintSignal,
 * kept as its own copy rather than a cross-module import of an ndg-internal
 * helper because the two operate on DIFFERENT node shapes: ndg's version
 * reads its own pre-relocation *working*-node shape (`wn.strokes` top-level),
 * this one reads the FINAL graph-node shape (`node.attributes.strokes`) —
 * see docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md Part 4.1.7 on that
 * exact asymmetry. Same underlying question, two different input shapes.
 */
function hasOwnVisualSignal(node) {
  const g = node.geometry || {};
  const paints = node.paints || [];
  const strokes = (node.attributes && node.attributes.strokes) || [];
  const effects = (node.attributes && node.attributes.effects) || [];
  return paints.length > 0
    || strokes.length > 0
    || effects.length > 0
    || g.cornerRadius != null
    || (Array.isArray(g.rectangleCornerRadii) && g.rectangleCornerRadii.some((r) => r))
    || (g.opacity != null && g.opacity !== 1)
    || (g.rotation != null && g.rotation !== 0)
    || g.isMask === true;
}

/**
 * Base role for one node, given its parent (null for the graph root) and
 * its own direct children (already-resolved NDG nodes, not just ids).
 * Exhaustive and mutually exclusive — every node gets exactly one role.
 */
function classifyBaseRole(node, parentNode, kids) {
  if (!parentNode) return ROLE_ROOT;

  if (!kids.length) {
    if (isTextNode(node) && node.attributes && node.attributes.characters) return ROLE_CONTENT;
    if (hasImageFill(node)) return ROLE_CONTENT;
    const parentBox = boxOf(parentNode);
    const chrome = isChromeBgRefined(node, parentBox);
    if (chrome.isChrome) return ROLE_DECORATIVE_CHROME;
    if (ICON_SHAPE_TYPES.has(upperType(node))) return ROLE_CONTENT;
    return ROLE_LEAF_SHAPE;
  }

  if (isRealAutoLayout(node)) return ROLE_LAYOUT_CONTAINER_REAL;
  // See constants.js's own comment on ROLE_STRUCTURAL_WRAPPER: this branch's
  // condition is deliberately identical to ndg/build.js's Pass 3 collapse
  // criteria, and is therefore currently unreachable for any graph that came
  // from buildNormalizedDesignGraph() — kept for the future phase where this
  // Skeleton, not NDG, owns the flattening decision.
  if (!hasOwnVisualSignal(node) && kids.length === 1) return ROLE_STRUCTURAL_WRAPPER;
  return ROLE_LAYOUT_CONTAINER_INFERRED;
}

/**
 * Reading order for one set of siblings, as a permutation of their node ids
 * (index 0 = first in reading order). A real-Auto-Layout parent's declared
 * child order already IS the rendered flow order — that's what Auto Layout
 * renders — so re-sorting by geometry would only add risk (near-equal
 * positions, measurement noise) for no benefit. A parent with no declared
 * layout has no such guarantee: Figma's raw child array is paint/z-order,
 * not necessarily visual order (confirmed in the research doc: a real
 * fixture's table rows are stored 001/003/004/002) — so those siblings are
 * resolved by real visual position instead: a strict (y, x) sort.
 *
 * Deliberately NOT a "same visual row" tolerance band around y — an earlier
 * version of this function added one without real-fixture evidence it was
 * needed, which would have made this silently diverge from
 * compiler/geometry/rules/structural-polish.js's orderChildrenVisualY (the
 * already-shipped, already-fixture-proven mechanism this generalizes: a
 * strict (y, x) sort, no banding) for no demonstrated benefit — exactly the
 * kind of unverified, self-introduced guess this whole research effort
 * exists to stop making. Keeping the two provably identical (for the
 * isHeader:false case orderChildrenVisualY's only real caller uses) is what
 * makes it safe to swap one for the other in the renderer.
 */
function resolveReadingOrder(parentNode, kids) {
  if (isRealAutoLayout(parentNode)) return kids.map((k) => k.id);

  return kids
    .map((k) => ({ id: k.id, box: boxOf(k) }))
    .sort((a, b) => {
      const ay = a.box ? a.box.y : 0;
      const by = b.box ? b.box.y : 0;
      if (ay !== by) return ay - by;
      const ax = a.box ? a.box.x : 0;
      const bx = b.box ? b.box.x : 0;
      return ax - bx;
    })
    .map((k) => k.id);
}

/**
 * @param {object} graph — an NDG graph ({ nodes, edges, graphId }).
 * @param {{ componentDetected?: object }} [opts] — forwarded to
 *   detectFreeformLayout as its optional (non-gating) seed-hint input.
 * @returns {object} DesignSkeleton
 */
function buildDesignSkeleton(graph, opts = {}) {
  const { byId, childrenOf, parentOf } = indexGraph(graph);
  const childrenOfFn = (id) => (childrenOf.get(id) || [])
    .map((ref) => byId.get(ref.id))
    .filter(Boolean);

  const entryByNodeId = new Map();
  for (const node of graph.nodes || []) {
    const parentId = parentOf.get(node.id) || null;
    const parentNode = parentId ? byId.get(parentId) : null;
    const kids = childrenOfFn(node.id);
    const role = classifyBaseRole(node, parentNode, kids);
    entryByNodeId.set(node.id, {
      nodeId: node.id,
      sourceNodeId: node.sourceNodeId || null,
      role,
      // v0: always a direct 1:1 pointer back to the source node this entry
      // was classified from. `kind` is left room to grow ('flattened' for a
      // discarded wrapper's children, 'composited' for a resolved overlay
      // set) once a later phase acts on these classifications instead of
      // only reporting them.
      provenance: { kind: 'direct', sourceNodeIds: [node.sourceNodeId || node.id] },
      readingOrder: null, // resolved below, per sibling set
      group: null,
    });
  }

  // Reading order is a property of a SIBLING SET (the parent decides the
  // rule), not of an individual node in isolation.
  for (const parentId of childrenOf.keys()) {
    const parentNode = byId.get(parentId);
    if (!parentNode) continue;
    const kids = childrenOfFn(parentId);
    if (!kids.length) continue;
    resolveReadingOrder(parentNode, kids).forEach((nodeId, idx) => {
      const entry = entryByNodeId.get(nodeId);
      if (entry) entry.readingOrder = idx;
    });
  }

  // Repeating-group membership — wraps compiler/freeform-layout's already-
  // proven clustering (reused verbatim, not re-derived). See this file's own
  // header comment for why the underlying engines' own internals stay
  // separate for this phase.
  const freeform = detectFreeformLayout(graph, { componentDetected: opts.componentDetected || {} });
  for (const g of freeform.groups) {
    g.members.forEach((m, slotIndex) => {
      const entry = entryByNodeId.get(m.nodeId);
      if (!entry) return;
      entry.group = {
        groupId: g.groupId,
        kind: GROUP_KIND_REPEATING,
        groupRole: 'member',
        axis: g.axis,
        slotIndex,
      };
    });
  }

  const nodes = (graph.nodes || [])
    .map((n) => entryByNodeId.get(n.id))
    .filter(Boolean);

  return {
    contractId: 'DesignSkeleton',
    builderVersion: BUILDER_VERSION,
    graphId: graph.graphId || null,
    nodes,
    freeformGroups: freeform.groups,
  };
}

module.exports = {
  buildDesignSkeleton,
  classifyBaseRole,
  resolveReadingOrder,
  hasOwnVisualSignal,
  isRealAutoLayout,
};
