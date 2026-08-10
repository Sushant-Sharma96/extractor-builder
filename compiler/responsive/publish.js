'use strict';

const { FACT_KIND_RESPONSIVE_SLICE, BUILDER_VERSION, PLUGIN_ID } = require('./constants');
const { buildResponsiveReport } = require('./report');
const { ResponsiveError, ResponsiveErrorKind } = require('./errors');

function publishResponsiveIR(ctx, projected, opts = {}) {
  if (!ctx || typeof ctx.putIrSlice !== 'function') {
    throw new ResponsiveError(ResponsiveErrorKind.PUBLISH, 'plugin context required');
  }
  const { slice, checksum, detected } = projected;
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

  const report = buildResponsiveReport({
    graphId: slice.graphId,
    checksum,
    detected,
    slice,
    timing: opts.timing || null,
    fingerprint: opts.fingerprint || null,
  });

  ctx.putFact({
    contractId: 'Fact',
    suiteVersion,
    factId: `fact:responsive.ir:${slice.graphId}`,
    kind: FACT_KIND_RESPONSIVE_SLICE,
    subject: slice.graphId,
    assertion: {
      graphId: slice.graphId,
      sliceId: slice.sliceId,
      checksum,
      builderVersion: BUILDER_VERSION,
      breakpointCount: slice.payload.breakpoints.length,
      adaptationCount: slice.payload.adaptations.length,
      metrics: slice.payload.metrics,
      report,
      payload: slice.payload,
      structuralTruth: false,
      interpretiveProjection: true,
    },
    producer: {
      engineId: PLUGIN_ID,
      packId: null,
      ruleId: null,
    },
  });

  return { sliceId: slice.sliceId, report, checksum };
}

module.exports = { publishResponsiveIR };
