'use strict';

const ResolvedErrorKind = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  MISSING_NDG: 'missing_ndg',
  NO_SLICES: 'no_slices',
  PUBLISH: 'publish',
});

class ResolvedError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'ResolvedError';
    this.kind = kind;
    this.detail = detail || null;
  }
}

module.exports = { ResolvedError, ResolvedErrorKind };
