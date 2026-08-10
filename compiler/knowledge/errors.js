'use strict';

const KnowledgeErrorKind = Object.freeze({
  INVALID_BUNDLE: 'invalid_bundle',
  CHECKSUM_MISMATCH: 'checksum_mismatch',
  VERSION_MISMATCH: 'version_mismatch',
  DEPENDENCY_CYCLE: 'dependency_cycle',
  DEPENDENCY_MISSING: 'dependency_missing',
  DEPENDENCY_CONFLICT: 'dependency_conflict',
  UNKNOWN_ENTRY: 'unknown_entry',
  DUPLICATE_ENTRY: 'duplicate_entry',
  RELATION_BROKEN: 'relation_broken',
  NOT_REGISTERED: 'not_registered',
  IMMUTABLE: 'immutable',
  CAPABILITY_DENIED: 'capability_denied',
  LOAD_FAILED: 'load_failed',
});

class KnowledgeError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'KnowledgeError';
    this.kind = kind || KnowledgeErrorKind.INVALID_BUNDLE;
    this.detail = detail || null;
  }
}

module.exports = { KnowledgeError, KnowledgeErrorKind };
