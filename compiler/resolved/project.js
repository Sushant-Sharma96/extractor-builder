'use strict';

/**
 * project — compose ResolvedIR contract payload. Never recomputes domain engines.
 */

const { BUILDER_VERSION, STAGE_ID } = require('./constants');
const { resolvedIrChecksum } = require('./checksum');
const { deepFreeze } = require('./collect');
const { ResolvedError, ResolvedErrorKind } = require('./errors');

function projectResolvedIR(collected, opts = {}) {
  if (!collected || !collected.graph) {
    throw new ResolvedError(ResolvedErrorKind.INVALID_INPUT, 'collected inputs required');
  }
  const slices = (collected.selectedSlices || []).map((s) => ({
    stageId: s.stageId,
    sliceId: s.sliceId,
    committed: true,
    nodeIds: Array.isArray(s.nodeIds) ? [...s.nodeIds].sort() : [],
  }));
  slices.sort((a, b) => {
    const ka = `${a.stageId}:${a.sliceId}`;
    const kb = `${b.stageId}:${b.sliceId}`;
    return ka < kb ? -1 : 1;
  });

  if (slices.length === 0) {
    throw new ResolvedError(ResolvedErrorKind.NO_SLICES, 'no slices to resolve');
  }

  const decisionIds = (collected.decisions || [])
    .map((d) => d.decisionId || d.id)
    .filter(Boolean)
    .sort();

  const resolvedId = opts.resolvedId || `resolved:${collected.graph.graphId}`;

  // Strict ResolvedIR contract shape (additionalProperties: false)
  const payload = {
    contractId: 'ResolvedIR',
    suiteVersion: opts.suiteVersion || '1.0.0',
    resolvedId,
    decisionIds,
    slices,
  };

  const checksum = resolvedIrChecksum(payload);
  const sliceId = opts.sliceId || `slice:resolved:${collected.graph.graphId}`;
  const nodeIds = [...new Set(slices.flatMap((s) => s.nodeIds || []))].sort();

  const frozen = deepFreeze({
    stageId: STAGE_ID,
    sliceId,
    nodeIds,
    graphId: collected.graph.graphId,
    checksum,
    builderVersion: BUILDER_VERSION,
    suiteVersion: payload.suiteVersion,
    payload,
  });

  return {
    slice: frozen,
    checksum,
    builderVersion: BUILDER_VERSION,
    conflicts: collected.conflicts || [],
    missingStages: collected.missingStages || [],
    resolvedId,
  };
}

module.exports = { projectResolvedIR };
