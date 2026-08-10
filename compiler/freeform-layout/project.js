'use strict';

/**
 * project — immutable FreeformLayoutIR in memory.
 */

const { BUILDER_VERSION, STAGE_ID } = require('./constants');
const { freeformLayoutIrChecksum } = require('./checksum');
const { deepFreeze } = require('./collect');
const { detectFreeformLayout } = require('./detect');
const { FreeformLayoutError, FreeformLayoutErrorKind } = require('./errors');

function projectFreeformLayoutIR(graph, opts = {}) {
  if (!graph || !graph.graphId) {
    throw new FreeformLayoutError(FreeformLayoutErrorKind.INVALID_INPUT, 'graph required');
  }

  const detected = opts.detected || detectFreeformLayout(graph, {
    componentDetected: opts.componentDetected,
  });

  const payload = {
    graphId: graph.graphId,
    builderVersion: BUILDER_VERSION,
    groups: detected.groups.map((g) => ({
      groupId: g.groupId,
      containerNodeId: g.containerNodeId,
      role: g.role,
      axis: g.axis,
      memberCount: g.memberCount,
      columns: g.columns.map((c) => ({ ...c })),
      members: g.members.map((m) => ({
        nodeId: m.nodeId,
        role: m.role,
        slotIndex: m.slotIndex,
        memberCount: m.memberCount,
        axis: m.axis,
        columns: m.columns.map((c) => ({ ...c })),
        memberColumnMap: { ...m.memberColumnMap },
      })),
      seedHint: g.seedHint,
    })),
    metrics: { ...detected.metrics },
  };

  const checksum = freeformLayoutIrChecksum(payload);
  const sliceId = opts.sliceId || `slice:freeform-layout:${graph.graphId}`;
  const nodeIds = [];
  for (const g of payload.groups) {
    nodeIds.push(g.containerNodeId);
    for (const m of g.members) nodeIds.push(m.nodeId);
  }

  const frozen = deepFreeze({
    contractId: 'SpecializedIrEnvelope',
    suiteVersion: opts.suiteVersion || graph.suiteVersion || '1.0.0',
    stageId: STAGE_ID,
    sliceId,
    nodeIds: [...new Set(nodeIds)].sort(),
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

module.exports = { projectFreeformLayoutIR };
