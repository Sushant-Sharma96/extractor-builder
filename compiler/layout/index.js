'use strict';

/**
 * Phase 11a — Layout Interpretation Core.
 * Phase 11b — Constraint Solver (subsystem under ./constraint).
 */

const { LayoutError, LayoutErrorKind } = require('./errors');
const constants = require('./constants');
const { canonicalStringify, layoutIrChecksum } = require('./checksum');
const { loadNdgFromWorkspace, indexGraph, deepFreeze } = require('./collect');
const { interpretNode, interpretGraph, isAbsolutePositioning, sourceFlowMode } = require('./interpret');
const { projectLayoutIR, buildLayoutIrPayload, resolveMode } = require('./project');
const { buildLayoutReport } = require('./report');
const { layoutPluginDeclaration } = require('./declaration');
const { publishLayoutIR } = require('./publish');
const { materializeLayoutIR, collectDecisions } = require('./materialize');
const constraint = require('./constraint');

module.exports = {
  LayoutError,
  LayoutErrorKind,
  ...constants,
  canonicalStringify,
  layoutIrChecksum,
  loadNdgFromWorkspace,
  indexGraph,
  deepFreeze,
  interpretNode,
  interpretGraph,
  isAbsolutePositioning,
  sourceFlowMode,
  projectLayoutIR,
  buildLayoutIrPayload,
  resolveMode,
  buildLayoutReport,
  layoutPluginDeclaration,
  publishLayoutIR,
  materializeLayoutIR,
  collectDecisions,
  constraint,
  ...constraint,
};
