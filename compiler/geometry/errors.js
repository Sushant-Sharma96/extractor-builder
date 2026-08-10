'use strict';

const GeometryErrorKind = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  MISSING_NDG: 'missing_ndg',
  PUBLISH: 'publish',
  FORBIDDEN: 'forbidden',
});

class GeometryError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'GeometryError';
    this.kind = kind;
    this.detail = detail || null;
  }
}

module.exports = { GeometryError, GeometryErrorKind };
