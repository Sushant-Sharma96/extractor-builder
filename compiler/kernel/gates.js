'use strict';

const { FailureKind, KernelError } = require('./failures');

/**
 * Gate hook — evaluates a QualityReport-shaped object.
 * No scoring; only violation severities + optional fail-closed policy flag.
 */
function evaluateGate(qualityReport, { failClosed = true } = {}) {
  if (!qualityReport || typeof qualityReport !== 'object') {
    return { ok: true, reason: 'no_report' };
  }
  if (qualityReport.contractId && qualityReport.contractId !== 'QualityReport') {
    throw new KernelError(FailureKind.GATE_FAIL, 'gate expects QualityReport-shaped input');
  }

  const violations = Array.isArray(qualityReport.violations) ? qualityReport.violations : [];
  const errors = violations.filter((v) => v && v.severity === 'error');

  if (errors.length && failClosed) {
    return {
      ok: false,
      reason: 'fail_closed',
      kind: FailureKind.GATE_FAIL,
      errors,
    };
  }

  return {
    ok: true,
    reason: errors.length ? 'errors_present_but_best_effort' : 'pass',
    warnings: violations.filter((v) => v && v.severity === 'warn'),
    errors,
  };
}

module.exports = { evaluateGate };
