'use strict';

const { FACT_KIND_SEMANTIC_SLICE, BUILDER_VERSION, PLUGIN_ID } = require('./constants');
const { buildSemanticReport } = require('./report');
const { SemanticError, SemanticErrorKind } = require('./errors');

function publishSemanticIR(ctx, projected, opts = {}) {
  if (!ctx || typeof ctx.putIrSlice !== 'function') {
    throw new SemanticError(SemanticErrorKind.PUBLISH, 'plugin context required');
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

  const report = buildSemanticReport({
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
    factId: `fact:semantic.ir:${slice.graphId}`,
    kind: FACT_KIND_SEMANTIC_SLICE,
    subject: slice.graphId,
    assertion: {
      graphId: slice.graphId,
      sliceId: slice.sliceId,
      checksum,
      builderVersion: BUILDER_VERSION,
      annotatedCount: slice.payload.annotations.length,
      landmarkCount: slice.payload.landmarks.length,
      headingCount: slice.payload.headings.length,
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

module.exports = { publishSemanticIR };
