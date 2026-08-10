'use strict';

const { BUILDER_VERSION } = require('./constants');

function buildLayoutReport({
  graphId,
  checksum,
  interpretations = [],
  slice = null,
  timing = null,
  fingerprint = null,
  validationStatus = 'ok',
  warnings = [],
} = {}) {
  const modes = {};
  for (const i of interpretations) {
    const m = (i.modeCandidates && i.modeCandidates[0] && i.modeCandidates[0].mode) || 'unknown';
    modes[m] = (modes[m] || 0) + 1;
  }
  return Object.freeze({
    reportId: `layout-report:${graphId}`,
    graphId,
    builderVersion: BUILDER_VERSION,
    checksum,
    fingerprint: fingerprint || null,
    timing: timing || null,
    validationStatus,
    nodeCount: interpretations.length,
    modeHistogram: modes,
    mixedCount: interpretations.filter((i) => i.modeCandidates.some((c) => c.mode === 'mixed')).length,
    sliceId: slice && slice.sliceId,
    warnings,
  });
}

module.exports = { buildLayoutReport };
