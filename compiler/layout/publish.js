'use strict';

const { FACT_KIND_LAYOUT_SLICE, BUILDER_VERSION } = require('./constants');
const { buildLayoutReport } = require('./report');
const { LayoutError, LayoutErrorKind } = require('./errors');

function publishLayoutIR(ctx, projected, opts = {}) {
  if (!ctx || typeof ctx.putIrSlice !== 'function') {
    throw new LayoutError(LayoutErrorKind.PUBLISH, 'plugin context required');
  }
  const { slice, checksum, interpretations } = projected;
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

  const report = buildLayoutReport({
    graphId: slice.graphId,
    checksum,
    interpretations,
    slice,
    timing: opts.timing || null,
    fingerprint: opts.fingerprint || null,
  });

  ctx.putFact({
    contractId: 'Fact',
    suiteVersion,
    factId: `fact:layout.ir:${slice.graphId}`,
    kind: FACT_KIND_LAYOUT_SLICE,
    subject: slice.graphId,
    assertion: {
      graphId: slice.graphId,
      sliceId: slice.sliceId,
      checksum,
      builderVersion: BUILDER_VERSION,
      nodeCount: slice.payload.nodes.length,
      report,
      payload: slice.payload,
      solved: false,
      structuralTruth: false,
      interpretiveProjection: true,
    },
    producer: {
      engineId: 'facts.layout.project',
      packId: null,
      ruleId: null,
    },
  });

  return { sliceId: slice.sliceId, report, checksum };
}

module.exports = { publishLayoutIR };
