'use strict';

const ComponentErrorKind = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  MISSING_NDG: 'missing_ndg',
  PUBLISH: 'publish',
  FORBIDDEN: 'forbidden',
});

class ComponentError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'ComponentError';
    this.kind = kind;
    this.detail = detail || null;
  }
}

module.exports = { ComponentError, ComponentErrorKind };
