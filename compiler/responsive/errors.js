'use strict';

const ResponsiveErrorKind = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  MISSING_NDG: 'missing_ndg',
  PUBLISH: 'publish',
  FORBIDDEN: 'forbidden',
});

class ResponsiveError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'ResponsiveError';
    this.kind = kind;
    this.detail = detail || null;
  }
}

module.exports = { ResponsiveError, ResponsiveErrorKind };
