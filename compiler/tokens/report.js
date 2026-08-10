'use strict';

const { BUILDER_VERSION } = require('./constants');

function buildTokenReport({
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
    reportId: `token-report:${graphId}`,
    graphId,
    builderVersion: BUILDER_VERSION,
    checksum,
    fingerprint: fingerprint || null,
    timing: timing || null,
    validationStatus,
    tokenCount: m.tokenCount || 0,
    bindingCount: m.bindingCount || 0,
    unboundCount: m.unboundCount || 0,
    tokenRate: m.tokenRate != null ? m.tokenRate : null,
    sliceId: slice && slice.sliceId,
  });
}

module.exports = { buildTokenReport };
