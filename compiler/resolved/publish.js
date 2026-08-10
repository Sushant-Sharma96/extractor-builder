'use strict';

const { FACT_KIND_RESOLVED, BUILDER_VERSION, PLUGIN_ID } = require('./constants');
const { buildResolvedReport } = require('./report');
const { ResolvedError, ResolvedErrorKind } = require('./errors');

function publishResolvedIR(ctx, projected, opts = {}) {
  if (!ctx || typeof ctx.putIrSlice !== 'function') {
    throw new ResolvedError(ResolvedErrorKind.PUBLISH, 'plugin context required');
  }
  const { slice, checksum, conflicts, missingStages, resolvedId } = projected;
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

  const report = buildResolvedReport({
    graphId: slice.graphId,
    checksum,
    resolvedId,
    sliceCount: slice.payload.slices.length,
    decisionCount: (slice.payload.decisionIds || []).length,
    conflicts,
    missingStages,
    timing: opts.timing || null,
    fingerprint: opts.fingerprint || null,
  });

  ctx.putFact({
    contractId: 'Fact',
    suiteVersion,
    factId: `fact:resolved.ir:${slice.graphId}`,
    kind: FACT_KIND_RESOLVED,
    subject: slice.graphId,
    assertion: {
      graphId: slice.graphId,
      sliceId: slice.sliceId,
      resolvedId,
      checksum,
      builderVersion: BUILDER_VERSION,
      sliceCount: slice.payload.slices.length,
      decisionIds: slice.payload.decisionIds,
      conflicts,
      missingStages,
      report,
      payload: slice.payload,
      structuralTruth: false,
      interpretiveProjection: false,
      compositionOnly: true,
    },
    producer: {
      engineId: PLUGIN_ID,
      packId: null,
      ruleId: null,
    },
  });

  return { sliceId: slice.sliceId, report, checksum, resolvedId };
}

module.exports = { publishResolvedIR };
