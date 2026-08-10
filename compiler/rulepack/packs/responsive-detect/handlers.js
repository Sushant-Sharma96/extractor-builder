'use strict';

/**
 * Phase 15 — Responsive Rule Pack handlers.
 * Propose only. Never commit. Never mutate NDG.
 */

const {
  loadNdgFromWorkspace,
  detectResponsive,
  STRATEGY,
} = require('../../../responsive');

function workspaceProxy(ctx) {
  return {
    listIds: (kind) => {
      if (kind === 'Fact') return ctx.listFactIds();
      return [];
    },
    getFact: (id) => ctx.getFact(id),
    getIrSlice: () => null,
    getDecision: () => null,
  };
}

function runDetect(ctx) {
  const { graph } = loadNdgFromWorkspace(workspaceProxy(ctx));
  const detected = detectResponsive(graph, {
    layoutIr: null,
    layoutDegraded: true,
    decisions: [],
    policy: ctx.policy || { profileId: 'default' },
  });
  return { graph, detected };
}

function proposeStrategy(ctx, rule) {
  const { detected } = runDetect(ctx);
  const profile = (ctx.policy && ctx.policy.profileId) || 'default';
  const conservative = profile === 'pixel-faithful';

  for (const amb of detected.ambiguous) {
    const evId = `ev:${rule.ruleId}:amb:${amb.nodeId}`;
    ctx.addEvidence({
      evidenceId: evId,
      kind: 'other',
      ref: 'responsive.ambiguous',
      detail: { nodeId: amb.nodeId, strategies: amb.strategies, responsive: true },
      ruleId: rule.ruleId,
    });

    const candidates = (amb.strategies || []).map((s, i) => ({
      candidateId: `cand:responsive.strategy:${amb.nodeId}:${s.strategy}`,
      answer: {
        nodeId: amb.nodeId,
        strategy: s.strategy,
        atBreakpointIds: s.atBreakpointIds || ['bp:narrow'],
      },
      localScore: Math.max(0.2, (s.score != null ? s.score : 0.5) - i * 0.05),
      priorityBand: rule.priorityBand || 'P2',
    }));
    candidates.push({
      candidateId: `cand:responsive.strategy:${amb.nodeId}:abstain`,
      answer: {
        nodeId: amb.nodeId,
        strategy: STRATEGY.ABSTAIN,
        atBreakpointIds: ['bp:narrow'],
      },
      localScore: conservative ? 0.72 : 0.35,
      priorityBand: rule.priorityBand || 'P2',
      safeGeneric: true,
    });

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${amb.nodeId}`,
      question: rule.question,
      subject: amb.nodeId,
      ruleId: rule.ruleId,
      candidates,
      evidence: [{ evidenceId: evId, kind: 'other', ref: 'responsive.ambiguous' }],
      localScores: candidates.map((c) => ({ candidateId: c.candidateId, value: c.localScore })),
    });
  }

  for (const ad of detected.adaptations.slice(0, 30)) {
    ctx.addEvidence({
      evidenceId: `ev:${rule.ruleId}:adapt:${ad.nodeId}`,
      kind: 'feature',
      ref: 'responsive.adapt',
      detail: {
        nodeId: ad.nodeId,
        strategy: ad.strategy,
        atBreakpointIds: ad.atBreakpointIds,
        responsive: true,
      },
      ruleId: rule.ruleId,
    });
  }

  ctx.log('responsive.detect.strategy complete', {
    ambiguous: detected.ambiguous.length,
    adaptations: detected.adaptations.length,
  });
}

function proposeBreakpoint(ctx, rule) {
  const { detected } = runDetect(ctx);
  const profile = (ctx.policy && ctx.policy.profileId) || 'default';
  const conservative = profile === 'pixel-faithful';

  for (const bp of detected.breakpoints) {
    const evId = `ev:${rule.ruleId}:${bp.breakpointId}`;
    ctx.addEvidence({
      evidenceId: evId,
      kind: 'feature',
      ref: 'responsive.breakpoint',
      detail: {
        breakpointId: bp.breakpointId,
        kind: bp.kind,
        widthHint: bp.widthHint,
        responsive: true,
      },
      ruleId: rule.ruleId,
    });

    const honorScore = conservative && bp.kind === 'narrow' ? 0.55 : 0.7;
    const abstainScore = conservative ? 0.6 : 0.3;

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${bp.breakpointId}`,
      question: rule.question,
      subject: bp.breakpointId,
      ruleId: rule.ruleId,
      candidates: [
        {
          candidateId: `cand:responsive.breakpoint:${bp.breakpointId}:honor`,
          answer: { breakpointId: bp.breakpointId, honor: true, widthHint: bp.widthHint },
          localScore: honorScore,
          priorityBand: rule.priorityBand || 'P3',
        },
        {
          candidateId: `cand:responsive.breakpoint:${bp.breakpointId}:abstain`,
          answer: { breakpointId: bp.breakpointId, honor: false },
          localScore: abstainScore,
          priorityBand: rule.priorityBand || 'P3',
          safeGeneric: true,
        },
      ],
      evidence: [{ evidenceId: evId, kind: 'feature', ref: 'responsive.breakpoint' }],
      localScores: [
        { candidateId: `cand:responsive.breakpoint:${bp.breakpointId}:honor`, value: honorScore },
        { candidateId: `cand:responsive.breakpoint:${bp.breakpointId}:abstain`, value: abstainScore },
      ],
    });
  }

  ctx.log('responsive.detect.breakpoint complete', {
    breakpoints: detected.breakpoints.length,
  });
}

module.exports = {
  'responsive.detect.strategy': proposeStrategy,
  'responsive.detect.breakpoint': proposeBreakpoint,
};
