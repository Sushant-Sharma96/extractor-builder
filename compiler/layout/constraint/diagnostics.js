'use strict';

/**
 * Solver diagnostics / report (not a Decision, not ConstraintIR).
 */

const { SOLVER_VERSION } = require('./constants');

function buildSolverReport({
  graphId,
  baselineSliceId,
  solvedSliceId,
  baselineChecksum,
  solvedChecksum,
  solveResult,
  timing = null,
  fingerprint = null,
} = {}) {
  const sr = solveResult || {};
  return Object.freeze({
    reportId: `layout-constraint-report:${graphId}`,
    graphId,
    solverVersion: SOLVER_VERSION,
    baselineSliceId: baselineSliceId || null,
    solvedSliceId: solvedSliceId || null,
    baselineChecksum: baselineChecksum || null,
    solvedChecksum: solvedChecksum || null,
    status: sr.status || null,
    policyProfileId: sr.policyProfileId || null,
    networkSummary: sr.networkSummary || null,
    violationCount: (sr.violations || []).length,
    relaxationCount: (sr.relaxations || []).length,
    unsatCount: (sr.unsat || []).length,
    hypothesisCount: (sr.hypotheses || []).length,
    evidenceCount: (sr.evidence || []).length,
    fallbackNodeCount: (sr.fallbackNodes || []).length,
    fingerprint: fingerprint || null,
    timing: timing || null,
  });
}

module.exports = { buildSolverReport };
