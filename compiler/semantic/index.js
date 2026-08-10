'use strict';

/**
 * Phase 14 — Semantic Engine.
 * Lifecycle: collect → detect → project → publish → materialize
 * Exporter-neutral: roles / landmarks / hierarchy — never HTML/React/CSS emit.
 */

const { SemanticError, SemanticErrorKind } = require('./errors');
const constants = require('./constants');
const { canonicalStringify, semanticIrChecksum } = require('./checksum');
const { collectSemanticInputs, collectDecisions, loadNdgFromWorkspace } = require('./collect');
const { detectSemantics } = require('./detect');
const { projectSemanticIR } = require('./project');
const { publishSemanticIR } = require('./publish');
const { materializeSemanticIR } = require('./materialize');
const { semanticPluginDeclaration } = require('./declaration');
const { buildSemanticReport } = require('./report');

module.exports = {
  SemanticError,
  SemanticErrorKind,
  ...constants,
  canonicalStringify,
  semanticIrChecksum,
  collectSemanticInputs,
  collectDecisions,
  loadNdgFromWorkspace,
  detectSemantics,
  projectSemanticIR,
  publishSemanticIR,
  materializeSemanticIR,
  semanticPluginDeclaration,
  buildSemanticReport,
};
