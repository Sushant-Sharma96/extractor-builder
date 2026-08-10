'use strict';

const FreeformLayoutErrorKind = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  MISSING_NDG: 'missing_ndg',
  PUBLISH: 'publish',
  FORBIDDEN: 'forbidden',
});

class FreeformLayoutError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'FreeformLayoutError';
    this.kind = kind;
    this.detail = detail || null;
  }
}

module.exports = { FreeformLayoutError, FreeformLayoutErrorKind };
