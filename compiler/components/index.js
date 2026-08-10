'use strict';

/**
 * Phase 12 — Component Engine (sibling module; Foundation Freeze intact).
 * Lifecycle: collect → detect → project → publish → materialize
 */

const { ComponentError, ComponentErrorKind } = require('./errors');
const constants = require('./constants');
const { canonicalStringify, componentIrChecksum } = require('./checksum');
const { collectComponentInputs, collectDecisions, loadNdgFromWorkspace } = require('./collect');
const { detectComponents } = require('./detect');
const { projectComponentIR } = require('./project');
const { publishComponentIR } = require('./publish');
const { materializeComponentIR } = require('./materialize');
const { componentPluginDeclaration } = require('./declaration');
const { buildComponentReport } = require('./report');

module.exports = {
  ComponentError,
  ComponentErrorKind,
  ...constants,
  canonicalStringify,
  componentIrChecksum,
  collectComponentInputs,
  collectDecisions,
  loadNdgFromWorkspace,
  detectComponents,
  projectComponentIR,
  publishComponentIR,
  materializeComponentIR,
  componentPluginDeclaration,
  buildComponentReport,
};
