'use strict';

const { BUILDER_VERSION } = require('./constants');

function buildComponentReport({
  graphId,
  checksum,
  detected = null,
  slice = null,
  timing = null,
  fingerprint = null,
  validationStatus = 'ok',
} = {}) {
  const d = detected || {};
  return Object.freeze({
    reportId: `component-report:${graphId}`,
    graphId,
    builderVersion: BUILDER_VERSION,
    checksum,
    fingerprint: fingerprint || null,
    timing: timing || null,
    validationStatus,
    definitionCount: (d.definitions || []).length,
    instanceCount: (d.instances || []).length,
    orphanCount: (d.orphans || []).length,
    flattenCount: (d.flattenPlan || []).length,
    layoutDegraded: d.layoutDegraded === true,
    sliceId: slice && slice.sliceId,
  });
}

module.exports = { buildComponentReport };
