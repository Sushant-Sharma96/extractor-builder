'use strict';

/**
 * Phase 11b — Layout Constraint Solver (subsystem of Layout).
 * Not a peer engine. No ConstraintIR.
 */

const constants = require('./constants');
const { buildConstraintNetwork } = require('./network');
const { solveConstraints, evaluateConstraint, committedRelaxIds } = require('./solver');
const { projectSolvedLayoutIR } = require('./projector');
const { buildSolverReport } = require('./diagnostics');
const { loadLayoutIrFromWorkspace, isSolvedPayload } = require('./load');
const {
  constraintPluginDeclaration,
  materializeSolvedLayoutIR,
} = require('./materialize');

module.exports = {
  ...constants,
  buildConstraintNetwork,
  solveConstraints,
  evaluateConstraint,
  committedRelaxIds,
  projectSolvedLayoutIR,
  buildSolverReport,
  loadLayoutIrFromWorkspace,
  isSolvedPayload,
  constraintPluginDeclaration,
  materializeSolvedLayoutIR,
};
