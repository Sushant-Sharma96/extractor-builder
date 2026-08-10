'use strict';

const { FACT_KIND_EMIT, BUILDER_VERSION, PLUGIN_ID } = require('./constants');
const { buildEmitReport } = require('./report');
const { EmitError, EmitErrorKind } = require('./errors');

function publishEmitPlan(ctx, projected, opts = {}) {
  if (!ctx || typeof ctx.putIrSlice !== 'function') {
    throw new EmitError(EmitErrorKind.PUBLISH, 'plugin context required');
  }
  const { slice, checksum, planId, neutral } = projected;
  const suiteVersion = slice.suiteVersion || '1.0.0';

  ctx.putIrSlice({
    suiteVersion,
    stageId: slice.stageId,
    sliceId: slice.sliceId,
    nodeIds: slice.nodeIds,
    graphId: slice.graphId,
    checksum,
    builderVersion: BUILDER_VERSION,
    payload: slice.payload,
  });

  const report = buildEmitReport({
    planId,
    resolvedId: slice.payload.resolvedId,
    checksum,
    timing: opts.timing || null,
    fingerprint: opts.fingerprint || null,
    renderCount: (neutral && neutral.renderOrder && neutral.renderOrder.length) || 0,
    chunkCount: (neutral && neutral.chunkPlan && neutral.chunkPlan.chunks && neutral.chunkPlan.chunks.length) || 0,
  });

  ctx.putFact({
    contractId: 'Fact',
    suiteVersion,
    factId: `fact:emit.plan:${planId}`,
    kind: FACT_KIND_EMIT,
    subject: slice.payload.resolvedId,
    assertion: {
      planId,
      resolvedId: slice.payload.resolvedId,
      sliceId: slice.sliceId,
      checksum,
      builderVersion: BUILDER_VERSION,
      report,
      payload: slice.payload,
      exporterNeutral: true,
      emitsCode: false,
    },
    producer: {
      engineId: PLUGIN_ID,
      packId: null,
      ruleId: null,
    },
  });

  return { sliceId: slice.sliceId, report, checksum, planId };
}

module.exports = { publishEmitPlan };
