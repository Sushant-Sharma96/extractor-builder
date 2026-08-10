'use strict';

const { BUILDER_VERSION, STAGE_ID } = require('./constants');
const { semanticIrChecksum } = require('./checksum');
const { deepFreeze } = require('./collect');
const { detectSemantics } = require('./detect');
const { SemanticError, SemanticErrorKind } = require('./errors');

function projectSemanticIR(graph, opts = {}) {
  if (!graph || !graph.graphId) {
    throw new SemanticError(SemanticErrorKind.INVALID_INPUT, 'graph required');
  }

  const detected = opts.detected || detectSemantics(graph, {
    decisions: opts.decisions || [],
    policy: opts.policy || {},
    layoutIr: opts.layoutIr || null,
    layoutDegraded: opts.layoutDegraded === true,
  });

  const payload = {
    graphId: graph.graphId,
    builderVersion: BUILDER_VERSION,
    annotations: detected.annotations.map((a) => {
      const copy = {
        nodeId: a.nodeId,
        role: a.role,
        level: a.level != null ? a.level : null,
        confidence: a.confidence,
        source: a.source,
      };
      if (a.decisionIds) copy.decisionIds = [...a.decisionIds];
      if (a.candidateRoles) copy.candidateRoles = [...a.candidateRoles];
      return copy;
    }),
    landmarks: detected.landmarks.map((l) => ({ ...l })),
    headings: detected.headings.map((h) => ({ ...h })),
    groups: detected.groups.map((g) => ({
      ...g,
      memberNodeIds: [...g.memberNodeIds],
    })),
    ambiguous: detected.ambiguous.map((a) => ({
      nodeId: a.nodeId,
      roles: a.roles.map((r) => ({ ...r })),
    })),
    metrics: { ...detected.metrics },
  };

  const checksum = semanticIrChecksum(payload);
  const sliceId = opts.sliceId || `slice:semantic:${graph.graphId}`;
  const nodeIds = payload.annotations.map((a) => a.nodeId).sort();

  const frozen = deepFreeze({
    contractId: 'SpecializedIrEnvelope',
    suiteVersion: opts.suiteVersion || graph.suiteVersion || '1.0.0',
    stageId: STAGE_ID,
    sliceId,
    nodeIds: [...new Set(nodeIds)],
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

module.exports = { projectSemanticIR };
