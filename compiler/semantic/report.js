'use strict';

const { BUILDER_VERSION } = require('./constants');

function buildSemanticReport({
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
    reportId: `semantic-report:${graphId}`,
    graphId,
    builderVersion: BUILDER_VERSION,
    checksum,
    fingerprint: fingerprint || null,
    timing: timing || null,
    validationStatus,
    annotatedCount: m.annotatedCount || 0,
    landmarkCount: m.landmarkCount || 0,
    headingCount: m.headingCount || 0,
    ambiguousCount: m.ambiguousCount || 0,
    coverageRate: m.coverageRate != null ? m.coverageRate : null,
    sliceId: slice && slice.sliceId,
  });
}

module.exports = { buildSemanticReport };
