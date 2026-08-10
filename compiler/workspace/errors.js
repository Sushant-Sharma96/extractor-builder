'use strict';

const WorkspaceErrorKind = Object.freeze({
  INVALID_STATE: 'invalid_state',
  INVALID_WRITE: 'invalid_write',
  IMMUTABLE_FACT: 'immutable_fact',
  DUPLICATE_IDENTITY: 'duplicate_identity',
  CAPABILITY_DENIED: 'capability_denied',
  NOT_FOUND: 'not_found',
  CROSS_REF: 'cross_ref',
  VERSION: 'version',
  UNKNOWN_IR_STAGE: 'unknown_ir_stage',
});

class WorkspaceError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'WorkspaceError';
    this.kind = kind || WorkspaceErrorKind.INVALID_WRITE;
    this.detail = detail || null;
  }
}

module.exports = { WorkspaceError, WorkspaceErrorKind };
