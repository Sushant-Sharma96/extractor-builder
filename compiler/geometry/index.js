'use strict';

/**
 * Geometry Recognition Engine — Phase 0 of the compiler migration blueprint.
 * Lifecycle: collect → detect → project → publish → materialize
 * @see docs/COMPILER_MIGRATION_BLUEPRINT.md
 */

const { GeometryError, GeometryErrorKind } = require('./errors');
const constants = require('./constants');
const { canonicalStringify, geometryIrChecksum } = require('./checksum');
const { collectGeometryInputs, collectDecisions, loadNdgFromWorkspace } = require('./collect');
const { detectGeometry, evaluateRowOrColumn, ALIGN_TOL, GAP_TOL } = require('./detect');
const {
  evaluateGrid,
  evaluateSideBySideRow,
  evaluateSideBySideColumn,
  evaluateColumnFlex,
  yOverlapRatio,
  xOverlapRatio,
  groupByRowOverlap,
  DEFAULT_COLUMN_FLEX_MIN_SCORE,
} = require('./rules/vocabulary');
const { projectGeometryIR } = require('./project');
const { publishGeometryIR } = require('./publish');
const { materializeGeometryIR } = require('./materialize');
const { geometryPluginDeclaration } = require('./declaration');
const { buildGeometryReport } = require('./report');

module.exports = {
  GeometryError,
  GeometryErrorKind,
  ...constants,
  canonicalStringify,
  geometryIrChecksum,
  collectGeometryInputs,
  collectDecisions,
  loadNdgFromWorkspace,
  detectGeometry,
  evaluateRowOrColumn,
  ALIGN_TOL,
  GAP_TOL,
  evaluateGrid,
  evaluateSideBySideRow,
  evaluateSideBySideColumn,
  evaluateColumnFlex,
  yOverlapRatio,
  xOverlapRatio,
  groupByRowOverlap,
  DEFAULT_COLUMN_FLEX_MIN_SCORE,
  projectGeometryIR,
  publishGeometryIR,
  materializeGeometryIR,
  geometryPluginDeclaration,
  buildGeometryReport,
};
