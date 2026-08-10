'use strict';

/**
 * Phase 13 — Token Rule Pack handlers.
 * Propose only. Never commit. Never mutate NDG.
 */

const {
  loadNdgFromWorkspace,
  detectTokens,
} = require('../../../tokens');

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

function proposeBind(ctx, rule) {
  const { graph } = loadNdgFromWorkspace(workspaceProxy(ctx));
  const detected = detectTokens(graph, {
    decisions: [],
    policy: ctx.policy || { profileId: 'default' },
  });

  const profile = (ctx.policy && ctx.policy.profileId) || 'default';
  const conservative = profile === 'pixel-faithful';

  // Propose for ambiguous cases and for unbound color literals (optional bind-to-new abstain)
  for (const amb of detected.ambiguous) {
    const evId = `ev:${rule.ruleId}:amb:${amb.nodeId}:${amb.property}`;
    ctx.addEvidence({
      evidenceId: evId,
      kind: 'other',
      ref: 'token.ambiguous',
      detail: { ...amb, token: true },
      ruleId: rule.ruleId,
    });

    const candidates = (amb.tokenIds || []).map((tokenId, i) => ({
      candidateId: `cand:token.bind:${amb.nodeId}:${amb.property}:${tokenId}`,
      answer: {
        bind: true,
        nodeId: amb.nodeId,
        property: amb.property,
        tokenId,
      },
      localScore: 0.6 - i * 0.1,
      priorityBand: rule.priorityBand || 'P3',
    }));
    candidates.push({
      candidateId: `cand:token.bind:${amb.nodeId}:${amb.property}:abstain`,
      answer: {
        bind: false,
        nodeId: amb.nodeId,
        property: amb.property,
        tokenId: null,
      },
      localScore: conservative ? 0.65 : 0.35,
      priorityBand: rule.priorityBand || 'P3',
      safeGeneric: true,
    });

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${amb.nodeId}:${amb.property}`,
      question: rule.question,
      subject: amb.nodeId,
      ruleId: rule.ruleId,
      candidates,
      evidence: [{ evidenceId: evId, kind: 'other', ref: 'token.ambiguous' }],
      localScores: candidates.map((c) => ({ candidateId: c.candidateId, value: c.localScore })),
    });
  }

  // If no ambiguous, still emit signal Evidence for tokens (pack visibility)
  for (const t of detected.tokens.slice(0, 20)) {
    ctx.addEvidence({
      evidenceId: `ev:${rule.ruleId}:tok:${t.tokenId}`,
      kind: 'feature',
      ref: 'token.signal',
      detail: { tokenId: t.tokenId, kind: t.kind, value: t.value, token: true },
      ruleId: rule.ruleId,
    });
  }

  ctx.log('token.detect.bind complete', {
    ambiguous: detected.ambiguous.length,
    tokens: detected.tokens.length,
  });
}

module.exports = {
  'token.detect.bind': proposeBind,
};
