'use strict';

const BUILDER_VERSION = '1.0.0';
const STAGE_ID = 'geometry-ir';
const PLUGIN_ID = 'facts.geometry.project';
const PACK_ID = 'geometry.recognize';

const FACT_KIND_GEOMETRY_SLICE = 'geometry.ir';

const EVIDENCE_ALIGNMENT = 'geometry.alignment';
const EVIDENCE_GAP = 'geometry.gap';
const EVIDENCE_OVERLAP = 'geometry.overlap';
const EVIDENCE_CANDIDATE = 'geometry.candidate';
// Phase 1 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — full vocabulary evidence refs.
const EVIDENCE_GRID = 'geometry.grid';
const EVIDENCE_SIDE_BY_SIDE = 'geometry.side-by-side';
const EVIDENCE_COLUMN_FLEX = 'geometry.column-flex';
// The direct symmetric counterpart of EVIDENCE_SIDE_BY_SIDE: siblings simply
// stacked top-to-bottom (X-overlap ratio, not a shared left edge) — the
// missing case confirmed via cross-corpus validation (162 real containers
// across 5 independent Figma files) as the root cause of a real, recurring
// bug class: any 2+ differently-sized, non-overlapping children stacked
// vertically (e.g. a full-width row below a narrower, centered heading
// block) fell all the way through to mode:'unknown' -> absolute positioning
// with no DOM-order correction, because only the ROW side of this looser
// tier existed.
const EVIDENCE_SIDE_BY_SIDE_COLUMN = 'geometry.side-by-side-column';

/** Sibling-geometry hint tokens fed into layout.interpret's recognitionHints.
 *  Distinct from the existing generic 'stack'/'grid' tokens (which only
 *  reinforce an ALREADY-declared layoutMode) — these establish an axis for
 *  nodes with NO declared Auto Layout at all (see docs/COMPILER_MIGRATION_BLUEPRINT.md §2). */
const HINT_GEOMETRY_ROW = 'geometry-row';
const HINT_GEOMETRY_COLUMN = 'geometry-column';
const HINT_GEOMETRY_GRID = 'geometry-grid';
// Phase 1 additions — looser/probabilistic patterns, scored below the Phase 0
// binary uniform-gap row/column test and never allowed to override it for the
// same node (see detect.js's precedence discipline).
const HINT_GEOMETRY_SIDE_BY_SIDE = 'geometry-side-by-side';
const HINT_GEOMETRY_COLUMN_FLEX = 'geometry-column-flex';
const HINT_GEOMETRY_SIDE_BY_SIDE_COLUMN = 'geometry-side-by-side-column';

module.exports = {
  BUILDER_VERSION,
  STAGE_ID,
  PLUGIN_ID,
  PACK_ID,
  FACT_KIND_GEOMETRY_SLICE,
  EVIDENCE_ALIGNMENT,
  EVIDENCE_GAP,
  EVIDENCE_OVERLAP,
  EVIDENCE_CANDIDATE,
  EVIDENCE_GRID,
  EVIDENCE_SIDE_BY_SIDE,
  EVIDENCE_COLUMN_FLEX,
  EVIDENCE_SIDE_BY_SIDE_COLUMN,
  HINT_GEOMETRY_ROW,
  HINT_GEOMETRY_COLUMN,
  HINT_GEOMETRY_GRID,
  HINT_GEOMETRY_SIDE_BY_SIDE,
  HINT_GEOMETRY_COLUMN_FLEX,
  HINT_GEOMETRY_SIDE_BY_SIDE_COLUMN,
};
