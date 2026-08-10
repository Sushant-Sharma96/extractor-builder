'use strict';

const { BUILDER_VERSION } = require('./constants');

function buildGeometryReport({
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
    reportId: `geometry-report:${graphId}`,
    graphId,
    builderVersion: BUILDER_VERSION,
    checksum,
    fingerprint: fingerprint || null,
    timing: timing || null,
    validationStatus,
    parentsEvaluated: m.parentsEvaluated || 0,
    candidateCount: m.candidateCount || 0,
    sliceId: slice && slice.sliceId,
  });
}

module.exports = { buildGeometryReport };
