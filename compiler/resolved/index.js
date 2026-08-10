'use strict';

/**
 * Phase 17 — ResolvedIR composition layer.
 * Composes IrSlices + Decisions. Never recomputes domain engines.
 */

const { ResolvedError, ResolvedErrorKind } = require('./errors');
const constants = require('./constants');
const { canonicalStringify, resolvedIrChecksum } = require('./checksum');
const { collectResolvedInputs, collectDecisions, deepFreeze } = require('./collect');
const { projectResolvedIR } = require('./project');
const { publishResolvedIR } = require('./publish');
const { materializeResolvedIR } = require('./materialize');
const { resolvedPluginDeclaration } = require('./declaration');
const { buildResolvedReport } = require('./report');

module.exports = {
  ResolvedError,
  ResolvedErrorKind,
  ...constants,
  canonicalStringify,
  resolvedIrChecksum,
  collectResolvedInputs,
  collectDecisions,
  deepFreeze,
  projectResolvedIR,
  publishResolvedIR,
  materializeResolvedIR,
  resolvedPluginDeclaration,
  buildResolvedReport,
};
