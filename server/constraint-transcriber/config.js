'use strict';
/**
 * Named thresholds — corpus-calibrated. No inline literals in algorithms.
 * @see docs/CONSTRAINT_TRANSCRIBER_SPEC.md §C
 */
module.exports = {
  OVERLAP_TOL: 0.10, // fraction of smaller child's area
  ALIGN_TOL: 2, // px
  GAP_TOL: 2, // px
  SIZE_TOL_PX: 2, // px
  SIZE_TOL_PCT: 0.015, // 1.5%
  POS_TOL: 2, // px
  TEXT_H_TOL: 8, // px — text height only
};
