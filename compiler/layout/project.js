'use strict';

/**
 * Project exporter-neutral LayoutIR from NDG + interpretations + optional Decisions.
 */

const { BUILDER_VERSION } = require('./constants');
const { layoutIrChecksum } = require('./checksum');
const { interpretGraph } = require('./interpret');
const { indexGraph, deepFreeze } = require('./collect');
const { LayoutError, LayoutErrorKind } = require('./errors');

function decisionModeFor(subject, decisions) {
  if (!Array.isArray(decisions)) return null;
  for (const d of decisions) {
    if (!d || d.question !== 'layout.mode') continue;
    const sub = d.subject;
    const match = sub === subject
      || (Array.isArray(sub) && sub.includes(subject));
    if (!match) continue;
    const st = d.status;
    if (st !== 'arbitrated' && st !== 'fallen-back' && st !== 'overridden' && st !== 'winner') {
      continue;
    }
    const decisionId = d.decisionId || d.id || null;
    const w = d.winner;
    if (w && w.kind === 'candidate' && w.candidateId && Array.isArray(d.candidates)) {
      const cand = d.candidates.find((c) => c.candidateId === w.candidateId);
      if (cand && cand.answer && cand.answer.mode) {
        return { mode: cand.answer.mode, decisionId };
      }
    }
    if (w && w.answer && w.answer.mode) {
      return { mode: w.answer.mode, decisionId };
    }
  }
  return null;
}

/**
 * Pick mode for LayoutIR: Decision winner if present, else top candidate (fact-baseline projection).
 * modeSource: decision | fact-baseline
 */
function resolveMode(interp, decisions) {
  const decided = decisionModeFor(interp.nodeId, decisions);
  if (decided) {
    return {
      mode: decided.mode,
      modeSource: 'decision',
      decisionIds: decided.decisionId ? [decided.decisionId] : [],
    };
  }
  const top = interp.modeCandidates[0];
  return {
    mode: top ? top.mode : 'unknown',
    modeSource: 'fact-baseline',
    decisionIds: [],
  };
}

function buildLayoutIrPayload(graph, interpretations, opts = {}) {
  if (!graph || !graph.graphId) {
    throw new LayoutError(LayoutErrorKind.INVALID_INPUT, 'graph required');
  }
  const decisions = opts.decisions || [];
  const evidenceIdMap = opts.evidenceIdMap || {};

  const nodes = interpretations.map((interp) => {
    const resolved = resolveMode(interp, decisions);
    const evidenceIds = evidenceIdMap[interp.nodeId] || [];
    return {
      nodeId: interp.nodeId,
      sourceNodeId: interp.sourceNodeId,
      mode: resolved.mode,
      modeSource: resolved.modeSource,
      axis: interp.axis,
      wrap: null,
      alignMain: null,
      alignCross: null,
      gap: interp.gap,
      padding: interp.padding,
      sizing: interp.sizing,
      positioning: resolved.mode === 'absolute' ? 'absolute' : 'relative',
      overflow: interp.overflow,
      stackingKey: null,
      childOrder: interp.childOrder,
      outOfFlow: interp.outOfFlow,
      decisionIds: resolved.decisionIds,
      evidenceIds,
      candidates: interp.modeCandidates.map((c) => ({
        mode: c.mode,
        localScore: c.localScore,
        cues: c.cues,
      })),
    };
  });

  nodes.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));

  const mixedRegions = nodes
    .filter((n) => n.mode === 'mixed')
    .map((n) => ({ parentId: n.nodeId, modes: ['mixed'] }));

  const payload = {
    graphId: graph.graphId,
    builderVersion: BUILDER_VERSION,
    nodes,
    mixedRegions,
    unsat: [], // 11b
  };

  const checksum = layoutIrChecksum(payload);
  return { payload, checksum };
}

function projectLayoutIR(graph, opts = {}) {
  const index = indexGraph(graph);
  const interpretations = opts.interpretations || interpretGraph(graph, index, opts);
  const { payload, checksum } = buildLayoutIrPayload(graph, interpretations, opts);
  const frozen = deepFreeze({
    contractId: 'SpecializedIrEnvelope',
    suiteVersion: opts.suiteVersion || graph.suiteVersion || '1.0.0',
    stageId: 'layout-ir',
    sliceId: opts.sliceId || `slice:layout:${graph.graphId}`,
    nodeIds: payload.nodes.map((n) => n.nodeId),
    graphId: graph.graphId,
    checksum,
    builderVersion: BUILDER_VERSION,
    payload,
  });
  return {
    slice: frozen,
    checksum,
    interpretations,
    builderVersion: BUILDER_VERSION,
  };
}

module.exports = {
  projectLayoutIR,
  buildLayoutIrPayload,
  resolveMode,
  decisionModeFor,
};
