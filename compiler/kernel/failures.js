'use strict';

/** RFC-002 / Master Plan Phase 2 — failure taxonomy (surface only; recovery orchestration expands in Phase 4). */
const FailureKind = Object.freeze({
  ENGINE_TIMEOUT: 'engine_timeout',
  ENGINE_CRASH: 'engine_crash',
  UNSAT: 'unsat',
  LOW_CONFIDENCE: 'low_confidence',
  AMBIGUITY: 'ambiguity',
  MISSING_INPUT: 'missing_input',
  GATE_FAIL: 'gate_fail',
  BUDGET_EXCEEDED: 'budget_exceeded',
  POLICY_VIOLATION: 'policy_violation',
  INVARIANT_VIOLATION: 'invariant_violation',
  WORKSPACE_CORRUPT: 'workspace_corrupt',
  ABORTED: 'aborted',
  UNKNOWN: 'unknown',
});

class KernelError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'KernelError';
    this.kind = kind || FailureKind.UNKNOWN;
    this.detail = detail || null;
  }
}

module.exports = { FailureKind, KernelError };
