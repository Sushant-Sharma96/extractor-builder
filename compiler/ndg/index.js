'use strict';

/**
 * Phase 10 — Canonical Design Graph (NormalizedDesignGraph) materialization.
 */

const { NdgError, NdgErrorKind } = require('./errors');
const constants = require('./constants');
const { canonicalStringify, sha256, stableCompileId, edgeKey, graphChecksum } = require('./ids');
const {
  workingNodeFromRaw,
  ingestTreeDocument,
  ingestSourceNodeFacts,
  collectIngestInput,
} = require('./ingest');
const { buildNormalizedDesignGraph, applyStructuralPolicies } = require('./build');
const { validateGraph } = require('./validate');
const { buildGraphReport } = require('./report');
const { ndgPluginDeclaration } = require('./declaration');
const { publishBuiltGraph } = require('./publish');
const { materializeNormalizedDesignGraph, collectFactsFromWorkspace } = require('./materialize');

module.exports = {
  NdgError,
  NdgErrorKind,
  ...constants,
  canonicalStringify,
  sha256,
  stableCompileId,
  edgeKey,
  graphChecksum,
  workingNodeFromRaw,
  ingestTreeDocument,
  ingestSourceNodeFacts,
  collectIngestInput,
  buildNormalizedDesignGraph,
  applyStructuralPolicies,
  validateGraph,
  buildGraphReport,
  ndgPluginDeclaration,
  publishBuiltGraph,
  materializeNormalizedDesignGraph,
  collectFactsFromWorkspace,
};
