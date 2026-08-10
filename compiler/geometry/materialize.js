'use strict';

/**
 * materialize — collect → detect → project → publish
 */

const { executePlugin } = require('../plugin');
const { collectGeometryInputs } = require('./collect');
const { detectGeometry } = require('./detect');
const { projectGeometryIR } = require('./project');
const { publishGeometryIR } = require('./publish');
const { geometryPluginDeclaration } = require('./declaration');
const { PLUGIN_ID, BUILDER_VERSION } = require('./constants');
const { GeometryError, GeometryErrorKind } = require('./errors');

async function materializeGeometryIR(env = {}) {
  if (!env.workspace) {
    throw new GeometryError(GeometryErrorKind.PUBLISH, 'workspace required');
  }

  const startedAt = (env.clock || Date.now)();
  const collected = collectGeometryInputs(env.workspace, {
    decisions: env.decisions,
  });

  const detected = detectGeometry(collected.graph, {
    decisions: collected.decisions,
    policy: env.policy || {},
  });

  const projected = projectGeometryIR(collected.graph, {
    detected,
    decisions: collected.decisions,
    suiteVersion: env.suiteVersion || '1.0.0',
    sliceId: env.sliceId,
  });

  const declaration = geometryPluginDeclaration();
  const result = await executePlugin({
    declaration,
    workspace: env.workspace,
    policy: env.policy || { profileId: 'default' },
    knowledge: env.knowledge || null,
    handler: async (ctx) => {
      const published = publishGeometryIR(ctx, projected, {
        fingerprint: env.fingerprint || null,
        timing: { startedAt, buildMs: (env.clock || Date.now)() - startedAt },
      });
      ctx.log('geometry.ir.projected', {
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

module.exports = { materializeGeometryIR };
