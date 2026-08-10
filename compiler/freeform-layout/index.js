'use strict';

/**
 * Freeform Layout Engine — normalizes inconsistent Figma freeform hierarchies
 * into RepeatingGroupMembership / AnchoredPosition facts.
 * Lifecycle: collect → detect → project → publish → materialize
 * @see docs/COMPILER_MIGRATION_BLUEPRINT.md
 */

const { FreeformLayoutError, FreeformLayoutErrorKind } = require('./errors');
const constants = require('./constants');
const { canonicalStringify, freeformLayoutIrChecksum } = require('./checksum');
const { collectFreeformLayoutInputs, collectDecisions, loadNdgFromWorkspace } = require('./collect');
const {
  determineGroupAxis,
  resolveMemberContent,
  unwrapChild,
  clusterByPosition,
  detectFreeformLayout,
} = require('./detect');
const { projectFreeformLayoutIR } = require('./project');
const { publishFreeformLayoutIR } = require('./publish');
const { materializeFreeformLayoutIR } = require('./materialize');
const { freeformLayoutPluginDeclaration } = require('./declaration');
const { buildFreeformLayoutReport } = require('./report');

module.exports = {
  FreeformLayoutError,
  FreeformLayoutErrorKind,
  ...constants,
  canonicalStringify,
  freeformLayoutIrChecksum,
  collectFreeformLayoutInputs,
  collectDecisions,
  loadNdgFromWorkspace,
  determineGroupAxis,
  resolveMemberContent,
  unwrapChild,
  clusterByPosition,
  detectFreeformLayout,
  projectFreeformLayoutIR,
  publishFreeformLayoutIR,
  materializeFreeformLayoutIR,
  freeformLayoutPluginDeclaration,
  buildFreeformLayoutReport,
};
