'use strict';

const TokenErrorKind = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  MISSING_NDG: 'missing_ndg',
  PUBLISH: 'publish',
  FORBIDDEN: 'forbidden',
});

class TokenError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'TokenError';
    this.kind = kind;
    this.detail = detail || null;
  }
}

module.exports = { TokenError, TokenErrorKind };
