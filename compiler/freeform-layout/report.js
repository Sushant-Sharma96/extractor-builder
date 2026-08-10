'use strict';

const { BUILDER_VERSION } = require('./constants');

function buildFreeformLayoutReport({
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
    reportId: `freeform-layout-report:${graphId}`,
    graphId,
    builderVersion: BUILDER_VERSION,
    checksum,
    fingerprint: fingerprint || null,
    timing: timing || null,
    validationStatus,
    groupCount: m.groupCount || 0,
    memberCount: m.memberCount || 0,
    sliceId: slice && slice.sliceId,
  });
}

module.exports = { buildFreeformLayoutReport };
