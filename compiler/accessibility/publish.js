'use strict';

const { FACT_KIND_A11Y_SLICE, BUILDER_VERSION, PLUGIN_ID } = require('./constants');
const { buildAccessibilityReport } = require('./report');
const { AccessibilityError, AccessibilityErrorKind } = require('./errors');

function publishAccessibilityIR(ctx, projected, opts = {}) {
  if (!ctx || typeof ctx.putIrSlice !== 'function') {
    throw new AccessibilityError(AccessibilityErrorKind.PUBLISH, 'plugin context required');
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

  const report = buildAccessibilityReport({
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
    factId: `fact:accessibility.ir:${slice.graphId}`,
    kind: FACT_KIND_A11Y_SLICE,
    subject: slice.graphId,
    assertion: {
      graphId: slice.graphId,
      sliceId: slice.sliceId,
      checksum,
      builderVersion: BUILDER_VERSION,
      nameCount: slice.payload.names.length,
      focusableCount: slice.payload.focusOrder.length,
      warningCount: slice.payload.warnings.length,
      metrics: slice.payload.metrics,
      semanticEvidence: slice.payload.semanticEvidence,
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

module.exports = { publishAccessibilityIR };
