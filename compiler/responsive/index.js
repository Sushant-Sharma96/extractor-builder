'use strict';

/**
 * Phase 15 — Responsive Engine.
 * Lifecycle: collect → detect → project → publish → materialize
 * Exporter-neutral: breakpoints / strategies — never CSS media queries / React / emit.
 */

const { ResponsiveError, ResponsiveErrorKind } = require('./errors');
const constants = require('./constants');
const { canonicalStringify, responsiveIrChecksum } = require('./checksum');
const { collectResponsiveInputs, collectDecisions, loadNdgFromWorkspace } = require('./collect');
const { detectResponsive } = require('./detect');
const { projectResponsiveIR } = require('./project');
const { publishResponsiveIR } = require('./publish');
const { materializeResponsiveIR } = require('./materialize');
const { responsivePluginDeclaration } = require('./declaration');
const { buildResponsiveReport } = require('./report');

module.exports = {
  ResponsiveError,
  ResponsiveErrorKind,
  ...constants,
  canonicalStringify,
  responsiveIrChecksum,
  collectResponsiveInputs,
  collectDecisions,
  loadNdgFromWorkspace,
  detectResponsive,
  projectResponsiveIR,
  publishResponsiveIR,
  materializeResponsiveIR,
  responsivePluginDeclaration,
  buildResponsiveReport,
};
