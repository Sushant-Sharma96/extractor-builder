'use strict';

const { BUILDER_VERSION } = require('./constants');

function buildResponsiveReport({
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
    reportId: `responsive-report:${graphId}`,
    graphId,
    builderVersion: BUILDER_VERSION,
    checksum,
    fingerprint: fingerprint || null,
    timing: timing || null,
    validationStatus,
    breakpointCount: m.breakpointCount || 0,
    adaptationCount: m.adaptationCount || 0,
    ambiguousCount: m.ambiguousCount || 0,
    coverageRate: m.coverageRate != null ? m.coverageRate : null,
    sliceId: slice && slice.sliceId,
  });
}

module.exports = { buildResponsiveReport };
