'use strict';

/**
 * Phase 11a — deterministic layout interpretation candidates from an NDG node.
 * Exporter-neutral vocabulary only. No CSS / HTML / framework terms.
 */

const { LAYOUT_MODES } = require('./constants');

function attrsOf(node) {
  return (node && node.attributes) || {};
}

function isAbsolutePositioning(node) {
  const a = attrsOf(node);
  const p = String(a.layoutPositioning || a.positioning || '').toUpperCase();
  return p === 'ABSOLUTE';
}

function sourceFlowMode(node) {
  const mode = String(attrsOf(node).layoutMode || '').toUpperCase();
  if (mode === 'HORIZONTAL') return 'flow-row';
  if (mode === 'VERTICAL') return 'flow-column';
  return null;
}

function paddingOf(node) {
  const a = attrsOf(node);
  return {
    top: a.paddingTop != null ? a.paddingTop : null,
    right: a.paddingRight != null ? a.paddingRight : null,
    bottom: a.paddingBottom != null ? a.paddingBottom : null,
    left: a.paddingLeft != null ? a.paddingLeft : null,
  };
}

function gapOf(node) {
  const a = attrsOf(node);
  return a.itemSpacing != null ? a.itemSpacing : null;
}

function overflowHint(node) {
  const a = attrsOf(node);
  // `clipsContent` is the real per-node clip flag; check it first — see
  // sizingAxis()'s comment below for the identical wrong-field pattern this
  // mirrors. `overflow` (sourced from `overflowDirection`, a real but
  // DIFFERENT Figma concept — scroll direction, not clipping) is kept as a
  // fallback for the 'scroll' case, which clipsContent can't express.
  if (a.clipsContent === true) return 'clip';
  const o = a.overflow;
  if (o == null) return null;
  const s = String(o).toUpperCase();
  if (s.includes('SCROLL') || s === 'VERTICAL' || s === 'HORIZONTAL') return 'scroll';
  if (s.includes('CLIP') || s === 'TRUE' || s === '1') return 'clip';
  return 'visible';
}

/**
 * Confirmed smoking-gun fix (docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md
 * Part 4.2.1): this function used to check ONLY `attributes.constraints.
 * horizontal/vertical` for 'FILL'/'HUG'/'STRETCH'/'MIN' substrings — but
 * `constraints` is Figma's legacy RESIZE-constraint vocabulary
 * (LEFT/RIGHT/CENTER/LEFT_RIGHT/SCALE/TOP/BOTTOM only), which structurally
 * can never contain those substrings. Confirmed across 1,160 real nodes in
 * this codebase's own cached fixtures. `layoutSizingHorizontal`/
 * `layoutSizingVertical` is the correct field — its real values are exactly
 * FIXED/HUG/FILL — so it's checked FIRST, with the original constraints-based
 * guess kept unchanged as a fallback for nodes that predate/lack it.
 */
function sizingAxis(node, axis) {
  const a = attrsOf(node);
  const directKey = axis === 'horizontal' ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
  const direct = String(a[directKey] || '').toUpperCase();
  if (direct === 'FILL') return 'fill';
  if (direct === 'HUG') return 'hug';
  if (direct === 'FIXED') return 'fixed';

  const c = a.constraints;
  if (c && typeof c === 'object') {
    const key = axis === 'horizontal' ? 'horizontal' : 'vertical';
    const v = String(c[key] || '').toUpperCase();
    if (v.includes('FILL') || v === 'STRETCH') return 'fill';
    if (v.includes('HUG') || v.includes('MIN')) return 'hug';
    if (v.includes('FIXED') || v.includes('SCALE') || v.includes('LEFT') || v.includes('TOP')) return 'fixed';
  }
  const box = node.box;
  if (box && (axis === 'horizontal' ? box.width : box.height) != null) return 'fixed';
  return 'unknown';
}

/**
 * @param {object} node — NDG node (+ optional parentId/childIds)
 * @param {{ childNodes?: object[], recognitionHints?: string[] }} [ctx]
 */
function interpretNode(node, ctx = {}) {
  const children = ctx.childNodes || [];
  const childIds = Array.isArray(node.childIds)
    ? node.childIds
    : children.map((c) => c.id);

  const absSelf = isAbsolutePositioning(node);
  const flow = sourceFlowMode(node);
  const absChildren = children.filter((c) => isAbsolutePositioning(c));
  const flowChildren = children.filter((c) => !isAbsolutePositioning(c));
  const mixedKids = absChildren.length > 0 && flowChildren.length > 0;

  /** @type {Array<{ mode: string, localScore: number, cues: string[], safeGeneric?: boolean }>} */
  const modeCandidates = [];

  function bump(mode, score, cue) {
    if (!LAYOUT_MODES.includes(mode)) return;
    const prev = modeCandidates.find((c) => c.mode === mode);
    if (prev) {
      prev.localScore = Math.max(prev.localScore, score);
      if (!prev.cues.includes(cue)) prev.cues.push(cue);
    } else {
      modeCandidates.push({ mode, localScore: score, cues: [cue] });
    }
  }

  if (flow === 'flow-row') bump('flow-row', 0.85, 'source:layoutMode:HORIZONTAL');
  if (flow === 'flow-column') bump('flow-column', 0.85, 'source:layoutMode:VERTICAL');
  if (absSelf) bump('absolute', 0.8, 'source:layoutPositioning:ABSOLUTE');

  if (mixedKids) {
    bump('mixed', 0.75, 'children:mixed-absolute-flow');
  }

  // Grid-track candidate: many in-flow children + gap (ambiguous — keep multi-candidate)
  if (flow && flowChildren.length >= 4 && gapOf(node) != null) {
    bump('grid-track', 0.45, 'many-children+gap');
  }

  // Recognition hints as soft evidence only
  for (const h of ctx.recognitionHints || []) {
    if (h === 'stack' && flow === 'flow-row') bump('flow-row', 0.5, 'recognition:stack');
    if (h === 'stack' && flow === 'flow-column') bump('flow-column', 0.5, 'recognition:stack');
    if (h === 'grid') bump('grid-track', 0.4, 'recognition:grid');
    // geometry-row/geometry-column (compiler/geometry — Phase 0 of the migration
    // blueprint) establish an axis from SIBLING BOX GEOMETRY alone, independent of
    // `flow`. Unlike 'stack' above (which only reinforces an ALREADY-declared
    // layoutMode), these are the only signal available for freeform Groups with
    // no Auto Layout at all — see docs/COMPILER_MIGRATION_BLUEPRINT.md §2.
    // Scored below declared Auto Layout (0.85) but above the leaf/no-signal
    // fallbacks (0.3/0.35), so it wins exactly the freeform case it targets.
    if (h === 'geometry-row') bump('flow-row', 0.6, 'recognition:geometry-row');
    if (h === 'geometry-column') bump('flow-column', 0.6, 'recognition:geometry-column');
    if (h === 'geometry-grid') bump('grid-track', 0.55, 'recognition:geometry-grid');
    // Phase 1 — looser/probabilistic patterns (docs/COMPILER_MIGRATION_BLUEPRINT.md
    // Phase 1). Scored below the Phase 0 binary uniform-gap row/column hints (0.6)
    // since these fire only when that stricter check found nothing for the node.
    if (h === 'geometry-side-by-side') bump('flow-row', 0.55, 'recognition:geometry-side-by-side');
    if (h === 'geometry-column-flex') bump('flow-row', 0.5, 'recognition:geometry-column-flex');
  }

  if (!modeCandidates.length) {
    if (childIds.length === 0 && absSelf) bump('absolute', 0.55, 'leaf-absolute');
    else if (childIds.length === 0) bump('unknown', 0.35, 'leaf-no-signal');
    else bump('unknown', 0.3, 'no-layout-signal');
  }

  // Always retain unknown as low fallback when not sole
  if (!modeCandidates.some((c) => c.mode === 'unknown') && modeCandidates.length >= 1) {
    bump('unknown', 0.15, 'fallback');
  }

  modeCandidates.sort((a, b) => {
    if (b.localScore !== a.localScore) return b.localScore - a.localScore;
    return a.mode.localeCompare(b.mode);
  });

  const inFlow = flowChildren.map((c) => c.id);
  const outOfFlow = absChildren.map((c) => c.id);
  // If no absolute markers, all children in-flow in declared order
  const childOrder = mixedKids || absChildren.length
    ? (inFlow.length ? inFlow : childIds.filter((id) => !outOfFlow.includes(id)))
    : childIds.slice();

  const evidence = [
    {
      kind: 'feature',
      ref: 'layout.signal',
      detail: {
        nodeId: node.id,
        sourceLayoutMode: attrsOf(node).layoutMode || null,
        layoutPositioning: attrsOf(node).layoutPositioning || null,
        childCount: childIds.length,
        absoluteChildCount: absChildren.length,
        mixedKids,
        recognitionHints: ctx.recognitionHints || [],
      },
    },
  ];

  return {
    nodeId: node.id,
    sourceNodeId: node.sourceNodeId || null,
    modeCandidates: modeCandidates.map((c) => ({
      ...c,
      cues: [...c.cues].sort(),
    })),
    sizing: {
      horizontal: sizingAxis(node, 'horizontal'),
      vertical: sizingAxis(node, 'vertical'),
    },
    gap: gapOf(node),
    padding: paddingOf(node),
    overflow: overflowHint(node),
    childOrder,
    outOfFlow,
    axis: flow === 'flow-row' ? 'horizontal' : flow === 'flow-column' ? 'vertical' : null,
    evidence,
  };
}

/**
 * Interpret entire graph.
 */
function interpretGraph(graph, index, opts = {}) {
  const { byId, childrenOf } = index;
  const results = [];
  const hintsByNode = opts.recognitionHintsByNode || {};

  for (const node of [...(graph.nodes || [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const kids = (childrenOf.get(node.id) || []).map((k) => byId.get(k.id)).filter(Boolean);
    const enriched = {
      ...node,
      childIds: (childrenOf.get(node.id) || []).map((k) => k.id),
      parentId: index.parentOf.get(node.id) || null,
    };
    results.push(interpretNode(enriched, {
      childNodes: kids,
      recognitionHints: hintsByNode[node.id] || [],
    }));
  }
  return results;
}

module.exports = {
  interpretNode,
  interpretGraph,
  isAbsolutePositioning,
  sourceFlowMode,
  sizingAxis,
};
