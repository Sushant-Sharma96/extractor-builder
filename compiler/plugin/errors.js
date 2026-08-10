'use strict';

const PluginErrorKind = Object.freeze({
  INVALID_DECLARATION: 'invalid_declaration',
  DUPLICATE_ID: 'duplicate_id',
  DUPLICATE_VERSION: 'duplicate_version',
  BAD_SEMVER: 'bad_semver',
  FORBIDDEN_WRITE: 'forbidden_write',
  UNKNOWN_STORE_KIND: 'unknown_store_kind',
  UNKNOWN_IR_STAGE: 'unknown_ir_stage',
  UNKNOWN_QUESTION: 'unknown_question',
  CREATES_NOT_SUBSET: 'creates_not_subset',
  INCOMPATIBLE: 'incompatible',
  CAPABILITY_DENIED: 'capability_denied',
  TIMEOUT: 'timeout',
  CRASH: 'crash',
  NOT_REGISTERED: 'not_registered',
  INVALID_STATE: 'invalid_state',
});

class PluginError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'PluginError';
    this.kind = kind || PluginErrorKind.INVALID_DECLARATION;
    this.detail = detail || null;
  }
}

module.exports = { PluginError, PluginErrorKind };
