'use strict';

/**
 * Phase 11b — Constraint Rule Pack handlers.
 * Propose only. Never commit Decisions. Never mutate NDG / LayoutIR.
 *
 * Prefer Facts path for NDG. LayoutIR₀ may be absent; then pack no-ops.
 */

const {
  loadNdgFromWorkspace,
  buildConstraintNetwork,
  solveConstraints,
} = require('../../../layout');

function workspaceProxy(ctx) {
  return {
    listIds: (kind) => {
      if (kind === 'Fact') return ctx.listFactIds();
      if (kind === 'IrSlice') return [];
      if (kind === 'DecisionRecord') return [];
      return [];
    },
    getFact: (id) => ctx.getFact(id),
    getIrSlice: () => null,
    getDecision: () => null,
  };
}

function loadBaselineLayoutFromFacts(ctx) {
  const facts = ctx.listFactIds().map((id) => ctx.getFact(id)).filter(Boolean);
  const layoutFact = facts
    .filter((f) => f.kind === 'layout.ir' && f.assertion && !f.assertion.solved)
    .sort((a, b) => ((a.factId || '') < (b.factId || '') ? -1 : 1))[0];
  if (!layoutFact || !layoutFact.assertion) return null;

  // Pack cannot read IrSlice; rebuild minimal envelope from fact assertion + NDG interpret is heavy.
  // Instead: only propose when materialize already wrote conflict Evidence, OR skip.
  // For pack-only path we need LayoutIR payload — stored on fact if present.
  if (layoutFact.assertion.payload) {
    return {
      sliceId: layoutFact.assertion.sliceId,
      checksum: layoutFact.assertion.checksum,
      payload: layoutFact.assertion.payload,
      stageId: 'layout-ir',
      graphId: layoutFact.assertion.graphId,
    };
  }
  return null;
}

function proposeRelax(ctx, rule) {
  const { graph } = loadNdgFromWorkspace(workspaceProxy(ctx));
  const layoutIr0 = loadBaselineLayoutFromFacts(ctx);
  if (!layoutIr0) {
    ctx.log('layout.constraint.relax skip — no LayoutIR₀ payload on Facts');
    return;
  }

  const network = buildConstraintNetwork(graph, layoutIr0, {});
  const policy = (ctx.policy && ctx.policy.profileId)
    ? ctx.policy
    : { profileId: 'default' };
  const solveResult = solveConstraints(network, graph, layoutIr0, {
    policy,
    decisions: [],
  });

  for (const hyp of solveResult.hypotheses || []) {
    const conflictEv = (solveResult.evidence || []).find(
      (e) => e.ref === 'layout.constraint.conflict'
        && e.detail
        && e.detail.constraintId === hyp.constraintId
    );
    const evidenceId = `ev:${rule.ruleId}:${hyp.constraintId}`;
    if (conflictEv) {
      ctx.addEvidence({
        evidenceId,
        kind: conflictEv.kind || 'other',
        ref: conflictEv.ref,
        detail: { ...conflictEv.detail, layout: true, constraint: true },
        ruleId: rule.ruleId,
      });
    }

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${hyp.constraintId}`,
      question: rule.question,
      subject: hyp.subject,
      ruleId: rule.ruleId,
      candidates: hyp.candidates,
      evidence: conflictEv
        ? [{ evidenceId, kind: 'other', ref: 'layout.constraint.conflict' }]
        : [],
      localScores: (hyp.candidates || []).map((c) => ({
        candidateId: c.candidateId,
        value: c.localScore,
      })),
    });
  }

  ctx.log('layout.constraint.relax complete', {
    hypotheses: (solveResult.hypotheses || []).length,
    status: solveResult.status,
  });
}

module.exports = {
  'layout.constraint.relax': proposeRelax,
};
