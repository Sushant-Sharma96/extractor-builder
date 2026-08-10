'use strict';

const LayoutErrorKind = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  MISSING_NDG: 'missing_ndg',
  VALIDATION: 'validation',
  PUBLISH: 'publish',
  FORBIDDEN: 'forbidden',
});

class LayoutError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'LayoutError';
    this.kind = kind;
    this.detail = detail || null;
  }
}

module.exports = { LayoutError, LayoutErrorKind };
