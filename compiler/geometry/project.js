'use strict';

const { BUILDER_VERSION, STAGE_ID } = require('./constants');
const { geometryIrChecksum } = require('./checksum');
const { deepFreeze } = require('./collect');
const { detectGeometry } = require('./detect');
const { GeometryError, GeometryErrorKind } = require('./errors');

function projectGeometryIR(graph, opts = {}) {
  if (!graph || !graph.graphId) {
    throw new GeometryError(GeometryErrorKind.INVALID_INPUT, 'graph required');
  }

  const detected = opts.detected || detectGeometry(graph, {
    decisions: opts.decisions || [],
    policy: opts.policy || {},
  });

  const payload = {
    graphId: graph.graphId,
    builderVersion: BUILDER_VERSION,
    candidates: detected.candidates.map((c) => ({
      ...c,
      orderedChildIds: Array.isArray(c.orderedChildIds) ? [...c.orderedChildIds] : [],
      ...(Array.isArray(c.columns) ? { columns: c.columns.map((col) => [...col]) } : {}),
    })),
    recognitionHintsByNode: { ...detected.recognitionHintsByNode },
    metrics: { ...detected.metrics },
  };

  const checksum = geometryIrChecksum(payload);
  const sliceId = opts.sliceId || `slice:geometry:${graph.graphId}`;
  const nodeIds = [...new Set(payload.candidates.map((c) => c.nodeId))].sort();

  const frozen = deepFreeze({
    contractId: 'SpecializedIrEnvelope',
    suiteVersion: opts.suiteVersion || graph.suiteVersion || '1.0.0',
    stageId: STAGE_ID,
    sliceId,
    nodeIds,
    graphId: graph.graphId,
    checksum,
    builderVersion: BUILDER_VERSION,
    payload,
  });

  return {
    slice: frozen,
    checksum,
    detected,
    builderVersion: BUILDER_VERSION,
  };
}

module.exports = { projectGeometryIR };
