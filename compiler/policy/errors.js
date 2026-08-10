'use strict';

const PolicyErrorKind = Object.freeze({
  INVALID_PROFILE: 'invalid_profile',
  UNKNOWN_PROFILE: 'unknown_profile',
  VERSION_MISMATCH: 'version_mismatch',
  INCOMPATIBLE: 'incompatible',
  INHERITANCE: 'inheritance',
  MISSING_THRESHOLDS: 'missing_thresholds',
  LOAD_FAILED: 'load_failed',
});

class PolicyError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'PolicyError';
    this.kind = kind || PolicyErrorKind.INVALID_PROFILE;
    this.detail = detail || null;
  }
}

module.exports = { PolicyError, PolicyErrorKind };
