'use strict';

const { FACT_KIND_COMPONENT_SLICE, BUILDER_VERSION, PLUGIN_ID } = require('./constants');
const { buildComponentReport } = require('./report');
const { ComponentError, ComponentErrorKind } = require('./errors');

function publishComponentIR(ctx, projected, opts = {}) {
  if (!ctx || typeof ctx.putIrSlice !== 'function') {
    throw new ComponentError(ComponentErrorKind.PUBLISH, 'plugin context required');
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

  const report = buildComponentReport({
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
    factId: `fact:component.ir:${slice.graphId}`,
    kind: FACT_KIND_COMPONENT_SLICE,
    subject: slice.graphId,
    assertion: {
      graphId: slice.graphId,
      sliceId: slice.sliceId,
      checksum,
      builderVersion: BUILDER_VERSION,
      definitionCount: slice.payload.definitions.length,
      instanceCount: slice.payload.instances.length,
      orphanCount: slice.payload.orphans.length,
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

module.exports = { publishComponentIR };
