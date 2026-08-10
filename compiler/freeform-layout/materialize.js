'use strict';

/**
 * materialize — collect → detect → project → publish
 */

const { executePlugin } = require('../plugin');
const { collectFreeformLayoutInputs } = require('./collect');
const { detectFreeformLayout } = require('./detect');
const { projectFreeformLayoutIR } = require('./project');
const { publishFreeformLayoutIR } = require('./publish');
const { freeformLayoutPluginDeclaration } = require('./declaration');
const { PLUGIN_ID, BUILDER_VERSION } = require('./constants');
const { FreeformLayoutError, FreeformLayoutErrorKind } = require('./errors');

async function materializeFreeformLayoutIR(env = {}) {
  if (!env.workspace) {
    throw new FreeformLayoutError(FreeformLayoutErrorKind.PUBLISH, 'workspace required');
  }

  const startedAt = (env.clock || Date.now)();
  const collected = collectFreeformLayoutInputs(env.workspace, {
    componentDetected: env.componentDetected,
    geometryDetected: env.geometryDetected,
    decisions: env.decisions,
    policy: env.policy || {},
    geometryCandidatesByNode: env.geometryCandidatesByNode || {},
  });

  const detected = detectFreeformLayout(collected.graph, {
    componentDetected: collected.componentDetected,
  });

  const projected = projectFreeformLayoutIR(collected.graph, {
    detected,
    componentDetected: collected.componentDetected,
    suiteVersion: env.suiteVersion || '1.0.0',
    sliceId: env.sliceId,
  });

  const declaration = freeformLayoutPluginDeclaration();
  const result = await executePlugin({
    declaration,
    workspace: env.workspace,
    policy: env.policy || { profileId: 'default' },
    knowledge: env.knowledge || null,
    handler: async (ctx) => {
      const published = publishFreeformLayoutIR(ctx, projected, {
        fingerprint: env.fingerprint || null,
        timing: { startedAt, buildMs: (env.clock || Date.now)() - startedAt },
      });
      ctx.log('freeform-layout.ir.projected', {
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

module.exports = { materializeFreeformLayoutIR };
