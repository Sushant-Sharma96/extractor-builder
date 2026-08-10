'use strict';

const { BUILDER_VERSION } = require('./constants');

function buildAccessibilityReport({
  graphId,
  checksum,
  detected = null,
  slice = null,
  timing = null,
  fingerprint = null,
  validationStatus = 'ok',
} = {}) {
  const d = detected || {};
  const m = d.metrics || {};
  return Object.freeze({
    reportId: `accessibility-report:${graphId}`,
    graphId,
    builderVersion: BUILDER_VERSION,
    checksum,
    fingerprint: fingerprint || null,
    timing: timing || null,
    validationStatus,
    nameCount: m.nameCount || 0,
    focusableCount: m.focusableCount || 0,
    warningCount: m.warningCount || 0,
    ambiguousCount: m.ambiguousCount || 0,
    semanticConsumed: m.semanticConsumed === true,
    sliceId: slice && slice.sliceId,
  });
}

module.exports = { buildAccessibilityReport };
