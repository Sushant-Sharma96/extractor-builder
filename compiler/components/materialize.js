'use strict';

/**
 * materialize — collect → detect → project → publish
 */

const { executePlugin } = require('../plugin');
const { collectComponentInputs } = require('./collect');
const { detectComponents } = require('./detect');
const { projectComponentIR } = require('./project');
const { publishComponentIR } = require('./publish');
const { componentPluginDeclaration } = require('./declaration');
const { PLUGIN_ID, BUILDER_VERSION } = require('./constants');
const { ComponentError, ComponentErrorKind } = require('./errors');

async function materializeComponentIR(env = {}) {
  if (!env.workspace) {
    throw new ComponentError(ComponentErrorKind.PUBLISH, 'workspace required');
  }

  const startedAt = (env.clock || Date.now)();
  const collected = collectComponentInputs(env.workspace, {
    layoutIr: env.layoutIr,
    layoutSliceId: env.layoutSliceId,
    skipLayout: env.skipLayout === true,
    decisions: env.decisions,
  });

  const detected = detectComponents(collected.graph, {
    layoutIr: collected.layoutIr,
    layoutDegraded: collected.layoutDegraded,
    decisions: collected.decisions,
    policy: env.policy || {},
  });

  const projected = projectComponentIR(collected.graph, {
    detected,
    layoutIr: collected.layoutIr,
    layoutDegraded: collected.layoutDegraded,
    decisions: collected.decisions,
    suiteVersion: env.suiteVersion || '1.0.0',
    sliceId: env.sliceId,
  });

  const declaration = componentPluginDeclaration();
  const result = await executePlugin({
    declaration,
    workspace: env.workspace,
    policy: env.policy || { profileId: 'default' },
    knowledge: env.knowledge || null,
    handler: async (ctx) => {
      const published = publishComponentIR(ctx, projected, {
        fingerprint: env.fingerprint || null,
        timing: { startedAt, buildMs: (env.clock || Date.now)() - startedAt },
      });
      ctx.log('component.ir.projected', {
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
    layoutDegraded: collected.layoutDegraded,
    report: published.report,
    sliceId: published.sliceId || projected.slice.sliceId,
    timing: { startedAt, endedAt, ms: endedAt - startedAt },
    execute: result,
  };
}

module.exports = { materializeComponentIR };
