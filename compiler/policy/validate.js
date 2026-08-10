'use strict';

/**
 * Phase 5 — Policy Profile validation.
 * Configuration checks only. No reasoning, ranking, or emit.
 */

const { PolicyError, PolicyErrorKind } = require('./errors');

const REQUIRED_THRESHOLD_KEYS = Object.freeze([
  'accept_min',
  'margin_min',
  'fallback_below',
]);

const OPTIONAL_THRESHOLD_KEYS = Object.freeze([
  'fail_closed_below',
  'pattern_name_cap',
]);

const GATE_MODES = Object.freeze(['fail_closed', 'best_effort']);

const FORBIDDEN_ONTOLOGY = Object.freeze([
  'navbar', 'hero', 'pricing', 'carousel', 'accordion', 'sidebar', 'megamenu',
]);

function assertNoOntology(label, value) {
  if (value == null) return;
  const s = String(value).toLowerCase();
  for (const bad of FORBIDDEN_ONTOLOGY) {
    if (s.includes(bad)) {
      throw new PolicyError(
        PolicyErrorKind.INVALID_PROFILE,
        `forbidden UI ontology in ${label}`,
        { token: bad, value }
      );
    }
  }
}

function isNumberOrNull(v) {
  return v === null || typeof v === 'number';
}

/**
 * Validate a PolicyProfile-shaped object.
 * @param {object} profile
 * @param {{ requireAuthoritative?: boolean, expectedSuiteVersion?: string|null }} [opts]
 */
function validateProfile(profile, opts = {}) {
  if (!profile || typeof profile !== 'object') {
    throw new PolicyError(PolicyErrorKind.INVALID_PROFILE, 'profile object required');
  }
  if (profile.contractId != null && profile.contractId !== 'PolicyProfile') {
    throw new PolicyError(PolicyErrorKind.INVALID_PROFILE, 'contractId must be PolicyProfile');
  }
  if (!profile.profileId || typeof profile.profileId !== 'string') {
    throw new PolicyError(PolicyErrorKind.INVALID_PROFILE, 'profileId required');
  }
  assertNoOntology('profileId', profile.profileId);
  assertNoOntology('description', profile.description);

  if (profile.extends != null && typeof profile.extends !== 'string') {
    throw new PolicyError(PolicyErrorKind.INVALID_PROFILE, 'extends must be a string profileId');
  }

  if (profile.gateMode != null && !GATE_MODES.includes(profile.gateMode)) {
    throw new PolicyError(
      PolicyErrorKind.INVALID_PROFILE,
      `gateMode must be one of ${GATE_MODES.join('|')}`,
      { gateMode: profile.gateMode }
    );
  }

  if (opts.expectedSuiteVersion != null && profile.suiteVersion != null
      && profile.suiteVersion !== opts.expectedSuiteVersion) {
    throw new PolicyError(
      PolicyErrorKind.VERSION_MISMATCH,
      `suiteVersion mismatch: profile=${profile.suiteVersion} expected=${opts.expectedSuiteVersion}`,
      { profileSuiteVersion: profile.suiteVersion, expectedSuiteVersion: opts.expectedSuiteVersion }
    );
  }

  const thresholds = profile.thresholds || {};
  const authoritative = profile.valuesAuthoritative === true;
  // Pre-resolution: child with extends may omit thresholds (filled by parent merge).
  const deferThresholdCheck = Boolean(profile.extends) && opts.afterResolve !== true;

  if (opts.requireAuthoritative === true && !authoritative) {
    throw new PolicyError(
      PolicyErrorKind.INVALID_PROFILE,
      'valuesAuthoritative must be true for shipping profiles',
      { profileId: profile.profileId }
    );
  }

  if (authoritative && !deferThresholdCheck) {
    const missing = [];
    for (const key of REQUIRED_THRESHOLD_KEYS) {
      if (thresholds[key] == null || typeof thresholds[key] !== 'number') {
        missing.push(key);
      }
    }
    if (missing.length) {
      throw new PolicyError(
        PolicyErrorKind.MISSING_THRESHOLDS,
        `authoritative profile missing thresholds: ${missing.join(', ')}`,
        { missing, profileId: profile.profileId }
      );
    }
  }

  for (const key of [...REQUIRED_THRESHOLD_KEYS, ...OPTIONAL_THRESHOLD_KEYS]) {
    if (thresholds[key] !== undefined && !isNumberOrNull(thresholds[key])) {
      throw new PolicyError(
        PolicyErrorKind.INVALID_PROFILE,
        `threshold ${key} must be number or null`,
        { key, value: thresholds[key] }
      );
    }
  }

  if (profile.budgets && typeof profile.budgets !== 'object') {
    throw new PolicyError(PolicyErrorKind.INVALID_PROFILE, 'budgets must be object');
  }

  if (profile.allowedEngineIds != null && !Array.isArray(profile.allowedEngineIds)) {
    throw new PolicyError(PolicyErrorKind.INVALID_PROFILE, 'allowedEngineIds must be array');
  }
  if (profile.allowedPackIds != null && !Array.isArray(profile.allowedPackIds)) {
    throw new PolicyError(PolicyErrorKind.INVALID_PROFILE, 'allowedPackIds must be array');
  }

  return true;
}

module.exports = {
  validateProfile,
  REQUIRED_THRESHOLD_KEYS,
  OPTIONAL_THRESHOLD_KEYS,
  GATE_MODES,
  FORBIDDEN_ONTOLOGY,
};
