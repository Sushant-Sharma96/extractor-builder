'use strict';

/**
 * detect — sibling-geometry recognition from NDG box data alone.
 * Never mutates. Never commits Decisions. Never reads layoutMode/constraints —
 * that is layout.interpret's job; this stage exists precisely for nodes where
 * those are absent (freeform Groups).
 *
 * Phase 0 scope (docs/COMPILER_MIGRATION_BLUEPRINT.md): the single safest,
 * already-proven-in-production pattern — a clean, non-overlapping row or
 * column of children with a UNIFORM gap. This is a faithful, read-only port
 * of server/figma-build.js's inferFlow() geometric test (overlap → alignment
 * → gap-uniformity), stripped of every DOM-mutating side effect.
 *
 * Phase 1 scope adds the remaining vocabulary from
 * compiler/geometry/rules/vocabulary.js — N×M grid, side-by-side rows (Y-
 * overlap ratio), and scored column-flex recovery. Precedence discipline: for
 * any given parent, the Phase 1 detectors only run if Phase 0's strict
 * evaluateRowOrColumn found nothing — a looser heuristic must never override
 * an already-unambiguous signal for the same node.
 */

const {
  EVIDENCE_ALIGNMENT,
  EVIDENCE_GAP,
  EVIDENCE_OVERLAP,
  EVIDENCE_CANDIDATE,
  HINT_GEOMETRY_ROW,
  HINT_GEOMETRY_COLUMN,
  HINT_GEOMETRY_GRID,
  HINT_GEOMETRY_SIDE_BY_SIDE,
  HINT_GEOMETRY_COLUMN_FLEX,
  HINT_GEOMETRY_SIDE_BY_SIDE_COLUMN,
} = require('./constants');
// Parent/child relationships live in graph.edges (kind:'parent'), not on the
// node itself — reuse the same derivation layout.interpret already relies on,
// rather than re-deriving it (and risking divergence).
const { indexGraph } = require('../layout/collect');
const { resolveThresholds } = require('../decision/thresholds');
const {
  evaluateGrid,
  evaluateSideBySideRow,
  evaluateSideBySideColumn,
  evaluateColumnFlex,
  // ALIGN_TOL/GAP_TOL and isRealOverlap used to be re-declared locally in
  // this file — verbatim-identical to vocabulary.js's own copies (the exact
  // duplication docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md Part 4.2.3
  // named). This file already imports three other things from vocabulary.js
  // with no cycle, so there was never a real reason for these three not to
  // come from here too — now there's one canonical copy of each.
  ALIGN_TOL,
  GAP_TOL,
  isRealOverlap,
} = require('./rules/vocabulary');

function boxOf(node) {
  const b = node && node.box;
  if (!b || b.x == null || b.y == null || b.width == null || b.height == null) return null;
  return { x: Number(b.x), y: Number(b.y), w: Number(b.width), h: Number(b.height) };
}

function gapsAlong(arr, axis) {
  return arr.slice(1).map((c, i) => {
    const p = arr[i].box, q = c.box;
    return axis === 'y' ? q.y - (p.y + p.h) : q.x - (p.x + p.w);
  });
}

function isUniform(gaps) {
  return gaps.length > 0
    && gaps.every((g) => g >= -ALIGN_TOL)
    && (Math.max(...gaps) - Math.min(...gaps) <= GAP_TOL);
}

function edgesAligned(arr, edge) {
  const v = arr.map((k) => (edge === 'x' ? k.box.x : k.box.y));
  return Math.max(...v) - Math.min(...v) <= ALIGN_TOL;
}

/**
 * Evaluate one parent's direct children for a clean row/column candidate.
 * Pure function — no NDG/graph coupling — so it is independently unit-testable.
 * @param {{ nodeId: string, box: {x,y,width,height} }[]} children — already
 *   filtered to visible, box-bearing, non-absolute-chrome children by the caller.
 * @returns {{ axis: 'row'|'column'|null, orderedIds: string[], gap: number|null,
 *   padding: {top:number,left:number}|null, evidence: object[] }}
 */
function evaluateRowOrColumn(parentId, children) {
  const evidence = [];
  const withBox = children
    .map((c) => ({ nodeId: c.nodeId || c.id, box: boxOf(c) }))
    .filter((c) => c.nodeId && c.box);

  if (withBox.length < 2) {
    return { axis: null, orderedIds: [], gap: null, padding: null, evidence };
  }

  for (let i = 0; i < withBox.length; i++) {
    for (let j = i + 1; j < withBox.length; j++) {
      if (isRealOverlap(withBox[i].box, withBox[j].box)) {
        evidence.push({
          kind: 'feature',
          ref: EVIDENCE_OVERLAP,
          detail: { parentId, a: withBox[i].nodeId, b: withBox[j].nodeId },
        });
        return { axis: null, orderedIds: [], gap: null, padding: null, evidence };
      }
    }
  }

  const byY = [...withBox].sort((a, b) => a.box.y - b.box.y);
  const byX = [...withBox].sort((a, b) => a.box.x - b.box.x);

  let axis = null;
  let ordered = null;
  let gaps = null;

  if (edgesAligned(byY, 'x') && isUniform(gapsAlong(byY, 'y'))) {
    axis = 'column'; ordered = byY; gaps = gapsAlong(byY, 'y');
    evidence.push({ kind: 'feature', ref: EVIDENCE_ALIGNMENT, detail: { parentId, axis, edge: 'x' } });
  } else if (edgesAligned(byX, 'y') && isUniform(gapsAlong(byX, 'x'))) {
    axis = 'row'; ordered = byX; gaps = gapsAlong(byX, 'x');
    evidence.push({ kind: 'feature', ref: EVIDENCE_ALIGNMENT, detail: { parentId, axis, edge: 'y' } });
  } else {
    return { axis: null, orderedIds: [], gap: null, padding: null, evidence };
  }

  const gap = Math.max(0, gaps.reduce((a, b) => a + b, 0) / gaps.length);
  evidence.push({ kind: 'feature', ref: EVIDENCE_GAP, detail: { parentId, axis, gap: Number(gap.toFixed(2)) } });

  return {
    axis,
    orderedIds: ordered.map((c) => c.nodeId),
    gap,
    padding: null, // padding is layout.interpret's concern once the parent's own box is known there
    evidence,
  };
}

/**
 * @param {object} graph — NDG graph ({ nodes, graphId })
 * @param {{ decisions?: object[], policy?: object }} [opts]
 */
function detectGeometry(graph, opts = {}) {
  const nodes = [...(graph.nodes || [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  const { byId, childrenOf: childRefsOf } = indexGraph(graph);
  const childrenOf = new Map();
  for (const [parentId, refs] of childRefsOf) {
    childrenOf.set(parentId, refs.map((r) => byId.get(r.id)).filter(Boolean));
  }

  const thresholds = resolveThresholds(opts.policy);
  const columnFlexMinScore = thresholds.geometry_column_flex_min;

  const candidates = [];
  const evidence = [];
  const recognitionHintsByNode = {};
  let gridCandidateCount = 0;
  let sideBySideCandidateCount = 0;
  let sideBySideColumnCandidateCount = 0;
  let columnFlexCandidateCount = 0;

  function addHint(nodeId, hint) {
    recognitionHintsByNode[nodeId] = [...(recognitionHintsByNode[nodeId] || []), hint];
  }

  for (const node of nodes) {
    const kids = childrenOf.get(node.id) || [];
    if (kids.length < 2) continue;

    // Phase 0 — the strict, binary uniform-gap row/column test. Always runs
    // first: a looser Phase 1 heuristic must never override this already-
    // unambiguous signal for the same node (precedence discipline, see
    // docs/COMPILER_MIGRATION_BLUEPRINT.md Phase 1).
    const result = evaluateRowOrColumn(node.id, kids);
    evidence.push(...result.evidence);
    if (result.axis) {
      const hint = result.axis === 'row' ? HINT_GEOMETRY_ROW : HINT_GEOMETRY_COLUMN;
      addHint(node.id, hint);
      candidates.push({
        nodeId: node.id,
        pattern: 'row-or-column',
        axis: result.axis,
        orderedChildIds: result.orderedIds,
        gap: Number(result.gap.toFixed(2)),
      });
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_CANDIDATE,
        detail: { nodeId: node.id, axis: result.axis, gap: Number(result.gap.toFixed(2)) },
      });
      continue; // Phase 0 already resolved this node — skip Phase 1 for it.
    }

    // Phase 1 — grid (strongest of the remaining, most specific 2D pattern).
    const grid = evaluateGrid(node.id, kids);
    evidence.push(...grid.evidence);
    if (grid.isGrid) {
      gridCandidateCount += 1;
      addHint(node.id, HINT_GEOMETRY_GRID);
      candidates.push({
        nodeId: node.id,
        pattern: 'grid',
        axis: 'grid',
        orderedChildIds: grid.orderedIds,
        rows: grid.rows,
        cols: grid.cols,
        rowGap: Number(grid.rowGap.toFixed(2)),
        colGap: Number(grid.colGap.toFixed(2)),
      });
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_CANDIDATE,
        detail: { nodeId: node.id, pattern: 'grid', rows: grid.rows, cols: grid.cols },
      });
      continue;
    }

    // Phase 1 — side-by-side row (Y-overlap ratio, not pixel-perfect alignment).
    const sideBySide = evaluateSideBySideRow(node.id, kids);
    evidence.push(...sideBySide.evidence);
    if (sideBySide.axis) {
      sideBySideCandidateCount += 1;
      addHint(node.id, HINT_GEOMETRY_SIDE_BY_SIDE);
      candidates.push({
        nodeId: node.id,
        pattern: 'side-by-side',
        axis: sideBySide.axis,
        orderedChildIds: sideBySide.orderedIds,
        gap: Number(sideBySide.gap.toFixed(2)),
      });
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_CANDIDATE,
        detail: { nodeId: node.id, pattern: 'side-by-side', gap: Number(sideBySide.gap.toFixed(2)) },
      });
      continue;
    }

    // Phase 1 — side-by-side column (X-overlap ratio, not a shared left
    // edge) — the direct symmetric counterpart of side-by-side row above.
    // Only the row half of this looser tier existed before; a plain
    // vertical stack of differently-sized blocks (e.g. a full-width card
    // row below a narrower, centered heading) is at least as common a real
    // shape, and previously fell all the way through to mode:'unknown'.
    const sideBySideColumn = evaluateSideBySideColumn(node.id, kids);
    evidence.push(...sideBySideColumn.evidence);
    if (sideBySideColumn.axis) {
      sideBySideColumnCandidateCount += 1;
      addHint(node.id, HINT_GEOMETRY_SIDE_BY_SIDE_COLUMN);
      candidates.push({
        nodeId: node.id,
        pattern: 'side-by-side-column',
        axis: sideBySideColumn.axis,
        orderedChildIds: sideBySideColumn.orderedIds,
        gap: Number(sideBySideColumn.gap.toFixed(2)),
      });
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_CANDIDATE,
        detail: { nodeId: node.id, pattern: 'side-by-side-column', gap: Number(sideBySideColumn.gap.toFixed(2)) },
      });
      continue;
    }

    // Phase 1 — scored column-flex recovery (loosest/most probabilistic;
    // tried last, and only accepted at/above the resolved confidence bar).
    const columnFlex = evaluateColumnFlex(node.id, kids, columnFlexMinScore);
    evidence.push(...columnFlex.evidence);
    if (columnFlex.ok) {
      columnFlexCandidateCount += 1;
      addHint(node.id, HINT_GEOMETRY_COLUMN_FLEX);
      candidates.push({
        nodeId: node.id,
        pattern: 'column-flex',
        axis: columnFlex.axis,
        orderedChildIds: columnFlex.columns.flat(),
        columns: columnFlex.columns,
        gap: Number(columnFlex.gap.toFixed(2)),
        confidence: columnFlex.score,
      });
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_CANDIDATE,
        detail: { nodeId: node.id, pattern: 'column-flex', confidence: columnFlex.score },
      });
    }
  }

  candidates.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  evidence.sort((a, b) => {
    const ka = `${a.ref}:${JSON.stringify(a.detail)}`;
    const kb = `${b.ref}:${JSON.stringify(b.detail)}`;
    return ka < kb ? -1 : 1;
  });

  const metrics = {
    parentsEvaluated: nodes.filter((n) => (childrenOf.get(n.id) || []).length >= 2).length,
    candidateCount: candidates.length,
    gridCandidateCount,
    sideBySideCandidateCount,
    sideBySideColumnCandidateCount,
    columnFlexCandidateCount,
  };

  return {
    candidates,
    recognitionHintsByNode,
    metrics,
    evidence,
  };
}

module.exports = {
  detectGeometry,
  evaluateRowOrColumn,
  ALIGN_TOL,
  GAP_TOL,
};
