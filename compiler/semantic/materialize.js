'use strict';

/**
 * materialize — collect → detect → project → publish
 */

const { executePlugin } = require('../plugin');
const { collectSemanticInputs } = require('./collect');
const { detectSemantics } = require('./detect');
const { projectSemanticIR } = require('./project');
const { publishSemanticIR } = require('./publish');
const { semanticPluginDeclaration } = require('./declaration');
const { PLUGIN_ID, BUILDER_VERSION } = require('./constants');
const { SemanticError, SemanticErrorKind } = require('./errors');

async function materializeSemanticIR(env = {}) {
  if (!env.workspace) {
    throw new SemanticError(SemanticErrorKind.PUBLISH, 'workspace required');
  }

  const startedAt = (env.clock || Date.now)();
  const collected = collectSemanticInputs(env.workspace, {
    decisions: env.decisions,
    layoutIr: env.layoutIr,
    layoutSliceId: env.layoutSliceId,
    skipLayout: env.skipLayout,
  });

  const detected = detectSemantics(collected.graph, {
    decisions: collected.decisions,
    policy: env.policy || {},
    layoutIr: collected.layoutIr,
    layoutDegraded: collected.layoutDegraded,
  });

  const projected = projectSemanticIR(collected.graph, {
    detected,
    decisions: collected.decisions,
    policy: env.policy || {},
    layoutIr: collected.layoutIr,
    layoutDegraded: collected.layoutDegraded,
    suiteVersion: env.suiteVersion || '1.0.0',
    sliceId: env.sliceId,
  });

  const declaration = semanticPluginDeclaration();
  const result = await executePlugin({
    declaration,
    workspace: env.workspace,
    policy: env.policy || { profileId: 'default' },
    knowledge: env.knowledge || null,
    handler: async (ctx) => {
      const published = publishSemanticIR(ctx, projected, {
        fingerprint: env.fingerprint || null,
        timing: { startedAt, buildMs: (env.clock || Date.now)() - startedAt },
      });
      ctx.log('semantic.ir.projected', {
        graphId: collected.graph.graphId,
        checksum: projected.checksum,
      });
      return published;
    },
  });

  const endedAt = (env.clock || Date.now)();
  const published = result.result || {};

  return {
    pluginId: PLUGIN_ID,
    builderVersion: BUILDER_VERSION,
    graphId: collected.graph.graphId,
    slice: projected.slice,
    checksum: projected.checksum,
    detected,
    report: published.report,
    sliceId: published.sliceId || projected.slice.sliceId,
    timing: { startedAt, endedAt, ms: endedAt - startedAt },
    execute: result,
  };
}

module.exports = { materializeSemanticIR };
