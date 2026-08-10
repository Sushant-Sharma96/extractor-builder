'use strict';

const BUILDER_VERSION = '1.0.0';
const STAGE_ID = 'freeform-layout-ir';
const PLUGIN_ID = 'facts.freeform-layout.project';
const PACK_ID = 'freeform-layout.detect';

const FACT_KIND_FREEFORM_LAYOUT_SLICE = 'freeform-layout.ir';

// RepeatingGroupMembership axis — DATA-DRIVEN (see detect.js's
// determineGroupAxis), never hardcoded per source shape.
const AXIS_ROW = 'row'; // members side-by-side, spread along X (Articles' card-grid case)
const AXIS_COLUMN = 'column'; // members stacked, spread along Y (Challenge Arena's row-set case)

const ROLE_CONTAINER = 'container';
const ROLE_MEMBER = 'member';

const EVIDENCE_GROUP = 'freeform-layout.group';
const EVIDENCE_MEMBER = 'freeform-layout.member';
const EVIDENCE_UNWRAP = 'freeform-layout.unwrap';

// Tolerances — REUSED from compiler/rulepack/packs/component-detect/
// geometry-rules.js, never reinvented:
//   - COLUMN_CLUSTER_TOLERANCE mirrors computeRowSetColumns' default 24px
//     chain-clustering tolerance (position-based bucketing, step 4).
//   - WRAPPER_SPAN_FRACTION mirrors rowColumnCandidates' isWideWrapper test
//     (grandkids.length >= 2 && k.box.w >= rowBox.w * 0.5), generalized to
//     whichever dimension is perpendicular to the group's repeating axis
//     (step 3, wrapper unwrap).
const COLUMN_CLUSTER_TOLERANCE = 24;
const WRAPPER_SPAN_FRACTION = 0.5;
const MAX_UNWRAP_DEPTH = 3;

module.exports = {
  BUILDER_VERSION,
  STAGE_ID,
  PLUGIN_ID,
  PACK_ID,
  FACT_KIND_FREEFORM_LAYOUT_SLICE,
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
};
