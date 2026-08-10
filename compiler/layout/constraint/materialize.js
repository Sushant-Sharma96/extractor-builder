'use strict';

/**
 * Phase 11b — publish solved LayoutIR₁ + Evidence/Hypotheses.
 * Never mutates NDG or LayoutIR₀. Never commits Decisions.
 */

const { executePlugin } = require('../../plugin');
const { StoreKind } = require('../../plugin/constants');
const { loadNdgFromWorkspace } = require('../collect');
const { collectDecisions } = require('../materialize');
const { PLUGIN_ID: LAYOUT_PLUGIN_ID, FACT_KIND_LAYOUT_SLICE, BUILDER_VERSION } = require('../constants');
const { SOLVER_VERSION, CONSTRAINT_PLUGIN_ID } = require('./constants');
const { buildConstraintNetwork } = require('./network');
const { solveConstraints } = require('./solver');
const { projectSolvedLayoutIR } = require('./projector');
const { buildSolverReport } = require('./diagnostics');
const { loadLayoutIrFromWorkspace } = require('./load');
const { LayoutError, LayoutErrorKind } = require('../errors');

function constraintPluginDeclaration(over = {}) {
  return {
    id: CONSTRAINT_PLUGIN_ID,
    version: SOLVER_VERSION,
    engineType: 'facts',
    phaseAffinity: 'mid',
    determinism: 'pure',
    reads: [StoreKind.FACT, StoreKind.IR_SLICE, StoreKind.DECISION, StoreKind.EVIDENCE],
    writes: [StoreKind.FACT, StoreKind.IR_SLICE, StoreKind.EVIDENCE, StoreKind.HYPOTHESIS],
    creates: [StoreKind.FACT, StoreKind.IR_SLICE, StoreKind.EVIDENCE, StoreKind.HYPOTHESIS],
    destroys: [],
    consumes: ['Fact', 'IrSlice', 'DecisionRecord', 'Evidence'],
    produces: ['Fact', 'IrSlice', 'Evidence', 'Hypothesis', 'LayoutIR'],
    requiredFacts: ['ndg.graph'],
    optionalFacts: ['ndg.node', 'layout.ir'],
    emittedIR: ['layout-ir'],
    acceptedQuestions: ['layout.constraint.relax'],
    allowedPolicies: ['*'],
    requiredCapabilities: [],
    incompatiblePlugins: [],
    estimatedCost: 6,
    estimatedMemory: 4096,
    timeout: 30000,
    retries: 0,
    crashIsolation: 'try_catch',
    rollbackSupport: 'workspace_tx',
    contractSuiteVersion: '1.0.0',
    ...over,
  };
}

function publishConstraintArtifacts(ctx, projected, solveResult, opts = {}) {
  const { slice, checksum } = projected;
  const suiteVersion = slice.suiteVersion || '1.0.0';
  const evidenceIds = [];
  const hypothesisIds = [];
  const sliceTag = slice.sliceId || 'slice:unknown';

  for (const ev of solveResult.evidence || []) {
    const detail = ev.detail || {};
    const constraintId = detail.constraintId || 'unknown';
    const evidenceId = `ev:layout.constraint:${sliceTag}:${constraintId}:${ev.ref}`;
    ctx.putEvidence({
      contractId: 'Evidence',
      suiteVersion,
      evidenceId,
      kind: ev.kind || 'other',
      ref: ev.ref,
      detail: { ...detail, layout: true, constraint: true },
      producer: {
        engineId: CONSTRAINT_PLUGIN_ID,
        packId: null,
        ruleId: null,
      },
    });
    evidenceIds.push(evidenceId);
  }

  if (opts.emitHypotheses !== false) {
    for (const hyp of solveResult.hypotheses || []) {
      const hypothesisId = `hyp:layout.constraint.relax:${sliceTag}:${hyp.constraintId}`;
      const evRefs = evidenceIds
        .filter((id) => id.includes(hyp.constraintId))
        .map((evidenceId) => ({ evidenceId, kind: 'other', ref: 'layout.constraint.conflict' }));
      ctx.putHypothesis({
        contractId: 'Hypothesis',
        suiteVersion,
        hypothesisId,
        question: hyp.question,
        subject: hyp.subject,
        candidates: hyp.candidates,
        evidence: evRefs.length ? evRefs : [{ evidenceId: evidenceIds[0] || `ev:layout.constraint:${sliceTag}:none`, kind: 'other', ref: 'layout.constraint.conflict' }],
        localScores: (hyp.candidates || []).map((c) => ({
          candidateId: c.candidateId,
          value: c.localScore,
        })),
        producer: {
          engineId: CONSTRAINT_PLUGIN_ID,
          packId: null,
          ruleId: null,
        },
      });
      hypothesisIds.push(hypothesisId);
    }
  }

  ctx.putIrSlice({
    suiteVersion,
    stageId: slice.stageId,
    sliceId: slice.sliceId,
    nodeIds: slice.nodeIds,
    graphId: slice.graphId,
    checksum,
    builderVersion: BUILDER_VERSION,
    solverVersion: SOLVER_VERSION,
    payload: slice.payload,
  });

  const report = buildSolverReport({
    graphId: slice.graphId,
    baselineSliceId: projected.baselineSliceId,
    solvedSliceId: slice.sliceId,
    baselineChecksum: slice.payload.constraintSolve
      && slice.payload.constraintSolve.fromLayoutIrChecksum,
    solvedChecksum: checksum,
    solveResult,
    timing: opts.timing || null,
    fingerprint: opts.fingerprint || null,
  });

  ctx.putFact({
    contractId: 'Fact',
    suiteVersion,
    factId: `fact:layout.ir.solved:${slice.graphId}`,
    kind: FACT_KIND_LAYOUT_SLICE,
    subject: slice.graphId,
    assertion: {
      graphId: slice.graphId,
      sliceId: slice.sliceId,
      checksum,
      builderVersion: BUILDER_VERSION,
      solverVersion: SOLVER_VERSION,
      solved: true,
      baselineSliceId: projected.baselineSliceId,
      nodeCount: slice.payload.nodes.length,
      status: solveResult.status,
      report,
      structuralTruth: false,
      interpretiveProjection: true,
    },
    producer: {
      engineId: CONSTRAINT_PLUGIN_ID,
      packId: null,
      ruleId: null,
    },
  });

  return { evidenceIds, hypothesisIds, report };
}

/**
 * Build network → solve → publish LayoutIR₁ + Evidence/Hypotheses.
 */
async function materializeSolvedLayoutIR(env = {}) {
  if (!env.workspace) {
    throw new LayoutError(LayoutErrorKind.PUBLISH, 'workspace required');
  }

  const startedAt = (env.clock || Date.now)();
  const { graph } = loadNdgFromWorkspace(env.workspace);
  const layoutIr0 = env.layoutIr0 || loadLayoutIrFromWorkspace(env.workspace, {
    sliceId: env.baselineSliceId,
    prefer: 'baseline',
    graphId: graph.graphId,
  });

  if (layoutIr0.payload && layoutIr0.payload.constraintSolve && !env.allowSolvedAsBaseline) {
    throw new LayoutError(
      LayoutErrorKind.INVALID_INPUT,
      'LayoutIR₀ baseline required (got solved LayoutIR₁); pass baselineSliceId'
    );
  }

  const decisions = env.decisions || collectDecisions(env.workspace);
  const policy = env.policy || { profileId: 'default' };

  const network = buildConstraintNetwork(graph, layoutIr0, { decisions });
  const solveResult = solveConstraints(network, graph, layoutIr0, {
    policy,
    decisions,
    maxRelaxations: env.maxRelaxations,
  });

  const decisionIds = decisions
    .filter((d) => d && (d.question || '').startsWith('layout.'))
    .map((d) => d.decisionId || d.id)
    .filter(Boolean)
    .sort();

  // Provisional evidence ids for provenance on projection (stable per solved slice)
  const sliceTag = (env.sliceId || `slice:layout-solved:${graph.graphId}`);
  const provisionalEvidenceIds = (solveResult.evidence || []).map((ev) => {
    const detail = ev.detail || {};
    const constraintId = detail.constraintId || 'unknown';
    return `ev:layout.constraint:${sliceTag}:${constraintId}:${ev.ref}`;
  });

  const projected = projectSolvedLayoutIR(graph, layoutIr0, solveResult, {
    suiteVersion: env.suiteVersion || '1.0.0',
    sliceId: env.sliceId || sliceTag,
    decisionIds,
    evidenceIds: provisionalEvidenceIds,
    traceIds: env.traceIds || [],
  });

  const declaration = constraintPluginDeclaration();
  const result = await executePlugin({
    declaration,
    workspace: env.workspace,
    policy,
    knowledge: env.knowledge || null,
    handler: async (ctx) => {
      const published = publishConstraintArtifacts(ctx, projected, solveResult, {
        fingerprint: env.fingerprint || null,
        timing: { startedAt, buildMs: (env.clock || Date.now)() - startedAt },
        emitHypotheses: env.emitHypotheses,
      });
      ctx.log('layout.constraint.solved', {
        graphId: graph.graphId,
        checksum: projected.checksum,
        status: solveResult.status,
      });
      return published;
    },
  });

  const endedAt = (env.clock || Date.now)();
  const published = result.result || {};
  const solvedSliceId = projected.slice.sliceId;
  const baselineSliceId = projected.baselineSliceId || layoutIr0.sliceId;

  // Phase 11b.1 — keep baseline pin; set active to LayoutIR₁ (only if slice present)
  if (typeof env.workspace.setLayoutIrPin === 'function') {
    const solvedOk = env.workspace.getIrSlice(solvedSliceId);
    if (solvedOk) {
      env.workspace.setLayoutIrPin(graph.graphId, {
        baselineLayoutIrSliceId: baselineSliceId,
        activeLayoutIrSliceId: solvedSliceId,
      }, { id: CONSTRAINT_PLUGIN_ID });
    }
  }

  return {
    pluginId: CONSTRAINT_PLUGIN_ID,
    layoutPluginId: LAYOUT_PLUGIN_ID,
    builderVersion: BUILDER_VERSION,
    solverVersion: SOLVER_VERSION,
    graphId: graph.graphId,
    network,
    solveResult,
    slice: projected.slice,
    checksum: projected.checksum,
    baselineSliceId,
    baselineChecksum: layoutIr0.checksum || null,
    baselineLayoutIrSliceId: baselineSliceId,
    activeLayoutIrSliceId: solvedSliceId,
    report: published.report,
    evidenceIds: published.evidenceIds || [],
    hypothesisIds: published.hypothesisIds || [],
    sliceId: solvedSliceId,
    timing: { startedAt, endedAt, ms: endedAt - startedAt },
    execute: result,
  };
}

module.exports = {
  constraintPluginDeclaration,
  materializeSolvedLayoutIR,
  publishConstraintArtifacts,
};
