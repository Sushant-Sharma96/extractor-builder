'use strict';

/**
 * Threshold slot resolution for Decision Runtime.
 *
 * Ownership: Policy (Phase 5+) owns authoritative values.
 * Runtime only consumes slots — it never owns product policy.
 *
 * - valuesAuthoritative !== true: fill missing numeric slots from
 *   NON_AUTHORITATIVE_DEFAULTS (synthetic/dev only; not production policy).
 * - valuesAuthoritative === true: every REQUIRED_THRESHOLD_SLOT must be a number;
 *   missing/null → reject. No defaults applied.
 */

const REQUIRED_THRESHOLD_SLOTS = Object.freeze([
  'accept_min',
  'margin_min',
  'fallback_below',
]);

/** Optional slots when authoritative — if present must be numbers; if absent omitted. */
const OPTIONAL_THRESHOLD_SLOTS = Object.freeze([
  'fail_closed_below',
  'pattern_name_cap',
  // Phase 1 of docs/COMPILER_MIGRATION_BLUEPRINT.md — compiler/geometry's
  // column-flex scorer (evaluateColumnFlex) is probabilistic, unlike Phase 0's
  // binary uniform-gap test, so it needs its own accept threshold rather than
  // reusing the generic accept_min (which governs the Decision runtime's own
  // pattern acceptance, not this upstream diagnostic stage).
  'geometry_column_flex_min',
]);

/**
 * Non-authoritative defaults for non-authoritative policies only.
 * NOT production policy values.
 */
const NON_AUTHORITATIVE_DEFAULTS = Object.freeze({
  accept_min: 0.5,
  margin_min: 0.05,
  fallback_below: 0.4,
  fail_closed_below: 0.2,
  pattern_name_cap: 0.4,
  // Mirrors legacy server/figma-build.js's COLUMN_FLEX_MIN_SCORE (0.75) —
  // same accept bar, ported as a non-authoritative default, not new policy.
  geometry_column_flex_min: 0.75,
});

function resolveThresholds(policy) {
  const slots = (policy && policy.thresholds) || {};
  const authoritative = policy && policy.valuesAuthoritative === true;

  if (authoritative) {
    const missing = [];
    for (const key of REQUIRED_THRESHOLD_SLOTS) {
      if (slots[key] == null || typeof slots[key] !== 'number') {
        missing.push(key);
      }
    }
    if (missing.length) {
      const err = new Error(
        `authoritative policy missing required threshold slots: ${missing.join(', ')}`
      );
      err.code = 'AUTHORITATIVE_THRESHOLDS_MISSING';
      err.missing = missing;
      throw err;
    }
    const out = {
      authoritative: true,
      accept_min: slots.accept_min,
      margin_min: slots.margin_min,
      fallback_below: slots.fallback_below,
    };
    for (const key of OPTIONAL_THRESHOLD_SLOTS) {
      if (slots[key] != null && typeof slots[key] === 'number') {
        out[key] = slots[key];
      } else {
        out[key] = null;
      }
    }
    return out;
  }

  const pick = (key) => {
    if (slots[key] != null && typeof slots[key] === 'number') return slots[key];
    return NON_AUTHORITATIVE_DEFAULTS[key];
  };
  return {
    authoritative: false,
    accept_min: pick('accept_min'),
    margin_min: pick('margin_min'),
    fallback_below: pick('fallback_below'),
    fail_closed_below: pick('fail_closed_below'),
    pattern_name_cap: pick('pattern_name_cap'),
    geometry_column_flex_min: pick('geometry_column_flex_min'),
  };
}

module.exports = {
  NON_AUTHORITATIVE_DEFAULTS,
  REQUIRED_THRESHOLD_SLOTS,
  OPTIONAL_THRESHOLD_SLOTS,
  resolveThresholds,
};
