'use strict';

/**
 * Phase 10 — materialize NormalizedDesignGraph into Workspace.
 * Uses Phase 6 facts plugin (not Rule Packs) for Fact writes.
 */

const { executePlugin } = require('../plugin');
const { buildNormalizedDesignGraph } = require('./build');
const { ndgPluginDeclaration } = require('./declaration');
const { publishBuiltGraph } = require('./publish');
const { PLUGIN_ID, BUILDER_VERSION, FACT_KIND_SOURCE_NODE, FACT_KIND_RAW } = require('./constants');
const { NdgError, NdgErrorKind } = require('./errors');

function collectFactsFromWorkspace(workspace) {
  if (!workspace || typeof workspace.listIds !== 'function') return [];
  return workspace.listIds('Fact').map((id) => workspace.getFact(id)).filter(Boolean);
}

/**
 * @param {object} env
 * @param {object} env.workspace
 * @param {object} [env.policy]
 * @param {object} [env.rawDocument]
 * @param {object} [env.document]
 * @param {string} [env.graphId]
 * @param {object} [env.fingerprint]
 * @param {function} [env.clock]
 */
async function materializeNormalizedDesignGraph(env = {}) {
  if (!env.workspace) {
    throw new NdgError(NdgErrorKind.PUBLISH, 'workspace required');
  }

  const startedAt = (env.clock || Date.now)();
  const facts = env.facts || collectFactsFromWorkspace(env.workspace);

  const built = buildNormalizedDesignGraph({
    rawDocument: env.rawDocument,
    document: env.document,
    rawDocumentId: env.rawDocumentId,
    graphId: env.graphId,
    facts,
    suiteVersion: env.suiteVersion || '1.0.0',
    workingNodes: env.workingNodes,
  });

  const declaration = ndgPluginDeclaration();
  const endedBuild = (env.clock || Date.now)();

  const result = await executePlugin({
    declaration,
    workspace: env.workspace,
    policy: env.policy || { profileId: 'default' },
    knowledge: env.knowledge || null,
    handler: async (ctx) => {
      const published = publishBuiltGraph(ctx, built, {
        fingerprint: env.fingerprint || null,
        timing: {
          startedAt,
          buildMs: endedBuild - startedAt,
        },
      });
      ctx.log('ndg.materialized', {
        graphId: built.graph.graphId,
        checksum: built.checksum,
        nodeCount: built.graph.nodes.length,
      });
      return published;
    },
  });

  const endedAt = (env.clock || Date.now)();
  const published = result.result || {};

  return {
    pluginId: PLUGIN_ID,
    builderVersion: BUILDER_VERSION,
    graph: built.graph,
    checksum: built.checksum,
    edgeIds: built.edgeIds,
    events: built.events,
    validation: built.validation,
    report: published.report,
    sliceId: published.sliceId,
    timing: {
      startedAt,
      endedAt,
      ms: endedAt - startedAt,
    },
    execute: result,
  };
}

module.exports = {
  materializeNormalizedDesignGraph,
  collectFactsFromWorkspace,
  FACT_KIND_SOURCE_NODE,
  FACT_KIND_RAW,
};
