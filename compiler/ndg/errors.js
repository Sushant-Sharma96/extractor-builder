'use strict';

const NdgErrorKind = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  VALIDATION: 'validation',
  CYCLE: 'cycle',
  DUPLICATE_ID: 'duplicate_id',
  ORPHAN: 'orphan',
  PUBLISH: 'publish',
});

class NdgError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'NdgError';
    this.kind = kind;
    this.detail = detail || null;
  }
}

module.exports = { NdgError, NdgErrorKind };
