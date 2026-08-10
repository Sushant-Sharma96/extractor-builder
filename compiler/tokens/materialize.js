'use strict';

/**
 * materialize — collect → detect → project → publish
 */

const { executePlugin } = require('../plugin');
const { collectTokenInputs } = require('./collect');
const { detectTokens } = require('./detect');
const { projectTokenIR } = require('./project');
const { publishTokenIR } = require('./publish');
const { tokenPluginDeclaration } = require('./declaration');
const { PLUGIN_ID, BUILDER_VERSION } = require('./constants');
const { TokenError, TokenErrorKind } = require('./errors');

async function materializeTokenIR(env = {}) {
  if (!env.workspace) {
    throw new TokenError(TokenErrorKind.PUBLISH, 'workspace required');
  }

  const startedAt = (env.clock || Date.now)();
  const collected = collectTokenInputs(env.workspace, {
    decisions: env.decisions,
  });

  const detected = detectTokens(collected.graph, {
    decisions: collected.decisions,
    policy: env.policy || {},
  });

  const projected = projectTokenIR(collected.graph, {
    detected,
    decisions: collected.decisions,
    suiteVersion: env.suiteVersion || '1.0.0',
    sliceId: env.sliceId,
  });

  const declaration = tokenPluginDeclaration();
  const result = await executePlugin({
    declaration,
    workspace: env.workspace,
    policy: env.policy || { profileId: 'default' },
    knowledge: env.knowledge || null,
    handler: async (ctx) => {
      const published = publishTokenIR(ctx, projected, {
        fingerprint: env.fingerprint || null,
        timing: { startedAt, buildMs: (env.clock || Date.now)() - startedAt },
      });
      ctx.log('token.ir.projected', {
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

module.exports = { materializeTokenIR };
