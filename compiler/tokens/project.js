'use strict';

const { BUILDER_VERSION, STAGE_ID } = require('./constants');
const { tokenIrChecksum } = require('./checksum');
const { deepFreeze } = require('./collect');
const { detectTokens } = require('./detect');
const { TokenError, TokenErrorKind } = require('./errors');

function projectTokenIR(graph, opts = {}) {
  if (!graph || !graph.graphId) {
    throw new TokenError(TokenErrorKind.INVALID_INPUT, 'graph required');
  }

  const detected = opts.detected || detectTokens(graph, {
    decisions: opts.decisions || [],
    policy: opts.policy || {},
  });

  const payload = {
    graphId: graph.graphId,
    builderVersion: BUILDER_VERSION,
    tokens: detected.tokens.map((t) => ({ ...t })),
    bindings: detected.bindings.map((b) => ({
      ...b,
      decisionIds: b.decisionIds ? [...b.decisionIds] : [],
    })),
    unboundLiterals: detected.unboundLiterals.map((u) => ({ ...u })),
    ambiguous: detected.ambiguous.map((a) => ({
      ...a,
      tokenIds: [...(a.tokenIds || [])],
    })),
    metrics: { ...detected.metrics },
  };

  const checksum = tokenIrChecksum(payload);
  const sliceId = opts.sliceId || `slice:token:${graph.graphId}`;
  const nodeIds = [
    ...payload.bindings.map((b) => b.nodeId),
    ...payload.unboundLiterals.map((u) => u.nodeId),
  ].filter(Boolean);
  nodeIds.sort();

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

module.exports = { projectTokenIR };
