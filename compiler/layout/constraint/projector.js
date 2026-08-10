'use strict';

/**
 * Project immutable LayoutIR₁ (solved) from LayoutIR₀ + solve result.
 * Never mutates LayoutIR₀.
 */

const { BUILDER_VERSION, STAGE_ID } = require('../constants');
const { SOLVER_VERSION } = require('./constants');
const { layoutIrChecksum } = require('../checksum');
const { deepFreeze } = require('../collect');
const { LayoutError, LayoutErrorKind } = require('../errors');

function cloneNode(n, opts = {}) {
  const fallback = opts.fallbackSet && opts.fallbackSet.has(n.nodeId);
  const evidenceIds = [...(n.evidenceIds || [])];
  if (opts.extraEvidenceByNode && opts.extraEvidenceByNode[n.nodeId]) {
    for (const id of opts.extraEvidenceByNode[n.nodeId]) {
      if (!evidenceIds.includes(id)) evidenceIds.push(id);
    }
  }
  const decisionIds = [...(n.decisionIds || [])];
  if (opts.extraDecisionIds) {
    for (const id of opts.extraDecisionIds) {
      if (!decisionIds.includes(id)) decisionIds.push(id);
    }
  }
  return {
    nodeId: n.nodeId,
    sourceNodeId: n.sourceNodeId,
    mode: n.mode,
    modeSource: n.modeSource,
    axis: n.axis,
    wrap: n.wrap,
    alignMain: n.alignMain,
    alignCross: n.alignCross,
    gap: n.gap,
    padding: n.padding ? { ...n.padding } : n.padding,
    sizing: n.sizing ? { ...n.sizing } : n.sizing,
    positioning: n.positioning,
    overflow: n.overflow,
    stackingKey: n.stackingKey,
    childOrder: Array.isArray(n.childOrder) ? [...n.childOrder] : n.childOrder,
    outOfFlow: Array.isArray(n.outOfFlow) ? [...n.outOfFlow] : n.outOfFlow,
    decisionIds,
    evidenceIds,
    candidates: Array.isArray(n.candidates)
      ? n.candidates.map((c) => ({ ...c, cues: c.cues ? [...c.cues] : c.cues }))
      : n.candidates,
    solveStatus: fallback ? 'absolute-box-fallback' : (n.solveStatus || null),
  };
}

/**
 * @param {object} graph
 * @param {object} layoutIr0 — baseline LayoutIR slice
 * @param {object} solveResult — from solveConstraints
 * @param {object} [opts]
 */
function projectSolvedLayoutIR(graph, layoutIr0, solveResult, opts = {}) {
  if (!graph || !graph.graphId) {
    throw new LayoutError(LayoutErrorKind.INVALID_INPUT, 'graph required');
  }
  if (!layoutIr0 || !layoutIr0.payload || !layoutIr0.sliceId) {
    throw new LayoutError(LayoutErrorKind.INVALID_INPUT, 'LayoutIR₀ required');
  }
  if (!solveResult) {
    throw new LayoutError(LayoutErrorKind.INVALID_INPUT, 'solveResult required');
  }

  const fallbackSet = new Set(solveResult.fallbackNodes || []);
  const baseNodes = (layoutIr0.payload.nodes || []).map((n) => cloneNode(n, {
    fallbackSet,
    extraEvidenceByNode: opts.extraEvidenceByNode || {},
    extraDecisionIds: opts.decisionIds || [],
  }));
  baseNodes.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));

  const payload = {
    graphId: graph.graphId,
    builderVersion: BUILDER_VERSION,
    solverVersion: SOLVER_VERSION,
    nodes: baseNodes,
    mixedRegions: Array.isArray(layoutIr0.payload.mixedRegions)
      ? layoutIr0.payload.mixedRegions.map((r) => ({ ...r, modes: [...(r.modes || [])] }))
      : [],
    unsat: (solveResult.unsat || []).map((u) => ({
      nodeId: u.nodeId,
      constraintId: u.constraintId,
      reason: u.reason,
      severity: u.severity,
      kind: u.kind || null,
      nodes: u.nodes ? [...u.nodes] : [u.nodeId],
    })),
    constraintSolve: {
      fromLayoutIrSliceId: layoutIr0.sliceId,
      fromLayoutIrChecksum: layoutIr0.checksum || layoutIr0.payload && null,
      status: solveResult.status,
      iterations: 1,
      relaxations: (solveResult.relaxations || []).map((r) => ({ ...r })),
      networkSummary: solveResult.networkSummary || null,
      solverVersion: SOLVER_VERSION,
      policyProfileId: solveResult.policyProfileId || null,
      decisionIds: [...(opts.decisionIds || [])],
      evidenceIds: [...(opts.evidenceIds || [])],
      traceIds: [...(opts.traceIds || [])],
      ndgGraphId: graph.graphId,
    },
  };

  // Prefer explicit checksum from baseline slice
  if (layoutIr0.checksum && payload.constraintSolve.fromLayoutIrChecksum == null) {
    payload.constraintSolve.fromLayoutIrChecksum = layoutIr0.checksum;
  }

  const checksum = layoutIrChecksum(payload);
  const sliceId = opts.sliceId || `slice:layout-solved:${graph.graphId}`;

  const frozen = deepFreeze({
    contractId: 'SpecializedIrEnvelope',
    suiteVersion: opts.suiteVersion || layoutIr0.suiteVersion || graph.suiteVersion || '1.0.0',
    stageId: STAGE_ID,
    sliceId,
    nodeIds: payload.nodes.map((n) => n.nodeId),
    graphId: graph.graphId,
    checksum,
    builderVersion: BUILDER_VERSION,
    solverVersion: SOLVER_VERSION,
    payload,
  });

  return {
    slice: frozen,
    checksum,
    solverVersion: SOLVER_VERSION,
    builderVersion: BUILDER_VERSION,
    baselineSliceId: layoutIr0.sliceId,
    solveResult,
  };
}

module.exports = { projectSolvedLayoutIR, cloneNode };
