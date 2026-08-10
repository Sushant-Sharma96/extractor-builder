'use strict';

const { BUILDER_VERSION, STAGE_ID } = require('./constants');
const { responsiveIrChecksum } = require('./checksum');
const { deepFreeze } = require('./collect');
const { detectResponsive } = require('./detect');
const { ResponsiveError, ResponsiveErrorKind } = require('./errors');

function projectResponsiveIR(graph, opts = {}) {
  if (!graph || !graph.graphId) {
    throw new ResponsiveError(ResponsiveErrorKind.INVALID_INPUT, 'graph required');
  }

  const detected = opts.detected || detectResponsive(graph, {
    decisions: opts.decisions || [],
    policy: opts.policy || {},
    layoutIr: opts.layoutIr || null,
    layoutDegraded: opts.layoutDegraded === true,
  });

  const payload = {
    graphId: graph.graphId,
    builderVersion: BUILDER_VERSION,
    breakpoints: detected.breakpoints.map((bp) => {
      const copy = {
        breakpointId: bp.breakpointId,
        kind: bp.kind,
        widthHint: bp.widthHint,
        source: bp.source,
        confidence: bp.confidence,
      };
      if (bp.honored != null) copy.honored = bp.honored;
      if (bp.decisionIds) copy.decisionIds = [...bp.decisionIds];
      return copy;
    }),
    adaptations: detected.adaptations.map((a) => {
      const copy = {
        nodeId: a.nodeId,
        strategy: a.strategy,
        atBreakpointIds: [...(a.atBreakpointIds || [])],
        confidence: a.confidence,
        source: a.source,
      };
      if (a.layoutMode) copy.layoutMode = a.layoutMode;
      if (a.decisionIds) copy.decisionIds = [...a.decisionIds];
      if (a.candidateStrategies) copy.candidateStrategies = [...a.candidateStrategies];
      return copy;
    }),
    groups: detected.groups.map((g) => ({
      ...g,
      memberNodeIds: [...g.memberNodeIds],
    })),
    ambiguous: detected.ambiguous.map((a) => ({
      nodeId: a.nodeId,
      strategies: a.strategies.map((s) => ({
        strategy: s.strategy,
        score: s.score,
        atBreakpointIds: [...(s.atBreakpointIds || [])],
      })),
    })),
    metrics: { ...detected.metrics },
  };

  const checksum = responsiveIrChecksum(payload);
  const sliceId = opts.sliceId || `slice:responsive:${graph.graphId}`;
  const nodeIds = payload.adaptations.map((a) => a.nodeId).sort();

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

module.exports = { projectResponsiveIR };
