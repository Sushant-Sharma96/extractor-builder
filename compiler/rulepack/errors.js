'use strict';

const RulePackErrorKind = Object.freeze({
  INVALID_PACK: 'invalid_pack',
  DUPLICATE_PACK: 'duplicate_pack',
  BAD_SEMVER: 'bad_semver',
  INCOMPATIBLE: 'incompatible',
  DEPENDENCY: 'dependency',
  NOT_REGISTERED: 'not_registered',
  EXECUTION: 'execution',
  FORBIDDEN: 'forbidden',
  LOAD_FAILED: 'load_failed',
});

class RulePackError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'RulePackError';
    this.kind = kind || RulePackErrorKind.INVALID_PACK;
    this.detail = detail || null;
  }
}

module.exports = { RulePackError, RulePackErrorKind };
