'use strict';

const { executePlugin } = require('../plugin');
const { collectEmitInputs } = require('./collect');
const { projectEmitPlan } = require('./project');
const { publishEmitPlan } = require('./publish');
const { emitPluginDeclaration } = require('./declaration');
const { PLUGIN_ID, BUILDER_VERSION } = require('./constants');
const { EmitError, EmitErrorKind } = require('./errors');

async function materializeEmitPlan(env = {}) {
  if (!env.workspace) {
    throw new EmitError(EmitErrorKind.PUBLISH, 'workspace required');
  }

  const startedAt = (env.clock || Date.now)();
  const collected = collectEmitInputs(env.workspace, {
    resolvedSliceId: env.resolvedSliceId,
    resolvedSlice: env.resolvedSlice,
    graphId: env.graphId,
    decisions: env.decisions,
    policy: env.policy,
    policyProfileId: env.policyProfileId,
  });

  const projected = projectEmitPlan(collected, {
    suiteVersion: env.suiteVersion || '1.0.0',
    sliceId: env.sliceId,
    planId: env.planId,
  });

  const declaration = emitPluginDeclaration();
  const result = await executePlugin({
    declaration,
    workspace: env.workspace,
    policy: env.policy || { profileId: collected.policyProfileId },
    knowledge: env.knowledge || null,
    handler: async (ctx) => {
      const published = publishEmitPlan(ctx, projected, {
        fingerprint: env.fingerprint || null,
        timing: { startedAt, buildMs: (env.clock || Date.now)() - startedAt },
      });
      ctx.log('emit.plan.projected', {
        planId: projected.planId,
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
    slice: projected.slice,
    checksum: projected.checksum,
    planId: projected.planId,
    resolvedId: collected.resolved.resolvedId,
    report: published.report,
    sliceId: published.sliceId || projected.slice.sliceId,
    timing: { startedAt, endedAt, ms: endedAt - startedAt },
    execute: result,
  };
}

module.exports = { materializeEmitPlan };
