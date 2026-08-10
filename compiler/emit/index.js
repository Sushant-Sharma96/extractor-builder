'use strict';

/**
 * Phase 18 — EmitPlan (exporter-neutral lowering plan).
 * Consumes ResolvedIR only. Does not emit HTML/CSS/React.
 */

const { EmitError, EmitErrorKind } = require('./errors');
const constants = require('./constants');
const { canonicalStringify, emitPlanChecksum } = require('./checksum');
const { collectEmitInputs, loadResolvedFromWorkspace, deepFreeze } = require('./collect');
const { projectEmitPlan } = require('./project');
const { publishEmitPlan } = require('./publish');
const { materializeEmitPlan } = require('./materialize');
const { emitPluginDeclaration } = require('./declaration');
const { buildEmitReport } = require('./report');

module.exports = {
  EmitError,
  EmitErrorKind,
  ...constants,
  canonicalStringify,
  emitPlanChecksum,
  collectEmitInputs,
  loadResolvedFromWorkspace,
  deepFreeze,
  projectEmitPlan,
  publishEmitPlan,
  materializeEmitPlan,
  emitPluginDeclaration,
  buildEmitReport,
};
