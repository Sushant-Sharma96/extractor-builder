'use strict';

const { BUILDER_VERSION } = require('./constants');

function buildResolvedReport({
  graphId,
  checksum,
  resolvedId,
  sliceCount = 0,
  decisionCount = 0,
  conflicts = [],
  missingStages = [],
  timing = null,
  fingerprint = null,
} = {}) {
  return Object.freeze({
    reportId: `resolved-report:${graphId}`,
    graphId,
    resolvedId,
    builderVersion: BUILDER_VERSION,
    checksum,
    fingerprint: fingerprint || null,
    timing: timing || null,
    sliceCount,
    decisionCount,
    conflictCount: conflicts.length,
    missingStageCount: missingStages.length,
    conflicts: conflicts.map((c) => ({ ...c, discardedSliceIds: [...(c.discardedSliceIds || [])] })),
    missingStages: missingStages.map((m) => ({ ...m })),
  });
}

module.exports = { buildResolvedReport };
