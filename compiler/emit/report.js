'use strict';

const { BUILDER_VERSION } = require('./constants');

function buildEmitReport({
  planId,
  resolvedId,
  checksum,
  timing = null,
  fingerprint = null,
  renderCount = 0,
  chunkCount = 0,
} = {}) {
  return Object.freeze({
    reportId: `emit-report:${planId}`,
    planId,
    resolvedId,
    builderVersion: BUILDER_VERSION,
    checksum,
    fingerprint: fingerprint || null,
    timing: timing || null,
    renderCount,
    chunkCount,
  });
}

module.exports = { buildEmitReport };
