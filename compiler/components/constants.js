'use strict';

const BUILDER_VERSION = '1.0.0';
const STAGE_ID = 'component-ir';
const PLUGIN_ID = 'facts.component.project';
const PACK_ID = 'component.detect';

const FACT_KIND_COMPONENT_SLICE = 'component.ir';

const EVIDENCE_SIGNAL = 'component.signal';
const EVIDENCE_INSTANCE = 'component.instance';
const EVIDENCE_OVERRIDE = 'component.override';
const EVIDENCE_ORPHAN = 'component.orphan';
const EVIDENCE_DEGRADED = 'component.degraded';
// Phase 2 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — card/banner/divider shape
// recognition evidence refs, produced by
// compiler/rulepack/packs/component-detect/geometry-rules.js.
const EVIDENCE_CARD_SHAPE = 'component.card-shape';
const EVIDENCE_CARD_GRID = 'component.card-grid';
const EVIDENCE_BANNER_SHAPE = 'component.banner-shape';
const EVIDENCE_DIVIDER_SHAPE = 'component.divider-shape';
// Row-set (repeating-pattern / table) recognition — Y-axis counterpart to
// EVIDENCE_CARD_GRID, produced by geometry-rules.js's detectRowSetUniformity.
const EVIDENCE_ROW_SET = 'component.row-set';

module.exports = {
  BUILDER_VERSION,
  STAGE_ID,
  PLUGIN_ID,
  PACK_ID,
  FACT_KIND_COMPONENT_SLICE,
  EVIDENCE_SIGNAL,
  EVIDENCE_INSTANCE,
  EVIDENCE_OVERRIDE,
  EVIDENCE_ORPHAN,
  EVIDENCE_DEGRADED,
  EVIDENCE_CARD_SHAPE,
  EVIDENCE_CARD_GRID,
  EVIDENCE_BANNER_SHAPE,
  EVIDENCE_DIVIDER_SHAPE,
  EVIDENCE_ROW_SET,
};
