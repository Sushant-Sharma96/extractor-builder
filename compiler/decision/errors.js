'use strict';

const DecisionErrorKind = Object.freeze({
  INVALID_STATE: 'invalid_state',
  INVALID_INPUT: 'invalid_input',
  NO_CANDIDATES: 'no_candidates',
  COMMIT_FAILED: 'commit_failed',
  POLICY: 'policy',
});

class DecisionError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'DecisionError';
    this.kind = kind || DecisionErrorKind.INVALID_INPUT;
    this.detail = detail || null;
  }
}

module.exports = { DecisionError, DecisionErrorKind };
