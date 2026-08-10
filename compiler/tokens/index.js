'use strict';

/**
 * Phase 13 — Design Token Engine.
 * Lifecycle: collect → detect → project → publish → materialize
 */

const { TokenError, TokenErrorKind } = require('./errors');
const constants = require('./constants');
const { canonicalStringify, tokenIrChecksum } = require('./checksum');
const { collectTokenInputs, collectDecisions, loadNdgFromWorkspace } = require('./collect');
const { detectTokens } = require('./detect');
const { projectTokenIR } = require('./project');
const { publishTokenIR } = require('./publish');
const { materializeTokenIR } = require('./materialize');
const { tokenPluginDeclaration } = require('./declaration');
const { buildTokenReport } = require('./report');

module.exports = {
  TokenError,
  TokenErrorKind,
  ...constants,
  canonicalStringify,
  tokenIrChecksum,
  collectTokenInputs,
  collectDecisions,
  loadNdgFromWorkspace,
  detectTokens,
  projectTokenIR,
  publishTokenIR,
  materializeTokenIR,
  tokenPluginDeclaration,
  buildTokenReport,
};
