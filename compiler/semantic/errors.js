'use strict';

const SemanticErrorKind = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  MISSING_NDG: 'missing_ndg',
  PUBLISH: 'publish',
  FORBIDDEN: 'forbidden',
});

class SemanticError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'SemanticError';
    this.kind = kind;
    this.detail = detail || null;
  }
}

module.exports = { SemanticError, SemanticErrorKind };
