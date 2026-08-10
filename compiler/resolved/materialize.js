'use strict';

/**
 * materialize — collect → project → publish (no detect recomputation)
 */

const { executePlugin } = require('../plugin');
const { collectResolvedInputs } = require('./collect');
const { projectResolvedIR } = require('./project');
const { publishResolvedIR } = require('./publish');
const { resolvedPluginDeclaration } = require('./declaration');
const { PLUGIN_ID, BUILDER_VERSION } = require('./constants');
const { ResolvedError, ResolvedErrorKind } = require('./errors');

async function materializeResolvedIR(env = {}) {
  if (!env.workspace) {
    throw new ResolvedError(ResolvedErrorKind.PUBLISH, 'workspace required');
  }

  const startedAt = (env.clock || Date.now)();
  const collected = collectResolvedInputs(env.workspace, {
    decisions: env.decisions,
    graphId: env.graphId,
  });

  const projected = projectResolvedIR(collected, {
    suiteVersion: env.suiteVersion || '1.0.0',
    sliceId: env.sliceId,
    resolvedId: env.resolvedId,
  });

  const declaration = resolvedPluginDeclaration();
  const result = await executePlugin({
    declaration,
    workspace: env.workspace,
    policy: env.policy || { profileId: 'default' },
    knowledge: env.knowledge || null,
    handler: async (ctx) => {
      const published = publishResolvedIR(ctx, projected, {
        fingerprint: env.fingerprint || null,
        timing: { startedAt, buildMs: (env.clock || Date.now)() - startedAt },
      });
      ctx.log('resolved.ir.composed', {
        graphId: collected.graph.graphId,
        checksum: projected.checksum,
        slices: projected.slice.payload.slices.length,
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
    resolvedId: projected.resolvedId,
    conflicts: projected.conflicts,
    missingStages: projected.missingStages,
    report: published.report,
    sliceId: published.sliceId || projected.slice.sliceId,
    timing: { startedAt, endedAt, ms: endedAt - startedAt },
    execute: result,
  };
}

module.exports = { materializeResolvedIR };
