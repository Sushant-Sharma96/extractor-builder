'use strict';

const EmitErrorKind = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  MISSING_RESOLVED: 'missing_resolved',
  PUBLISH: 'publish',
});

class EmitError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'EmitError';
    this.kind = kind;
    this.detail = detail || null;
  }
}

module.exports = { EmitError, EmitErrorKind };
