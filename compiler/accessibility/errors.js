'use strict';

const AccessibilityErrorKind = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  MISSING_NDG: 'missing_ndg',
  PUBLISH: 'publish',
  FORBIDDEN: 'forbidden',
});

class AccessibilityError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'AccessibilityError';
    this.kind = kind;
    this.detail = detail || null;
  }
}

module.exports = { AccessibilityError, AccessibilityErrorKind };
