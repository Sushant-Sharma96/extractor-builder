'use strict';

const SOLVER_VERSION = '1.0.0';
const CONSTRAINT_PLUGIN_ID = 'facts.layout.constraint';
const CONSTRAINT_PACK_ID = 'layout.constraint';

const STRENGTH = Object.freeze({
  REQUIRED: 'required',
  STRONG: 'strong',
  MEDIUM: 'medium',
  WEAK: 'weak',
});

/** Deterministic default relax order (weak first). Policy may override. */
const DEFAULT_RELAX_ORDER = Object.freeze([
  STRENGTH.WEAK,
  STRENGTH.MEDIUM,
  STRENGTH.STRONG,
  // required never auto-relaxed without Decision — marked unsat / fallback
]);

const CONSTRAINT_KINDS = Object.freeze([
  'gap_nonneg',
  'padding_nonneg',
  'parent_fit',
  'overflow',
  'sizing_axis',
  'absolute_bounds',
]);

module.exports = {
  SOLVER_VERSION,
  CONSTRAINT_PLUGIN_ID,
  CONSTRAINT_PACK_ID,
  STRENGTH,
  DEFAULT_RELAX_ORDER,
  CONSTRAINT_KINDS,
};
