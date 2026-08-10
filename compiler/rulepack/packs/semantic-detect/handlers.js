'use strict';

/**
 * Phase 14 — Semantic Rule Pack handlers.
 * Propose only. Never commit. Never mutate NDG.
 */

const {
  loadNdgFromWorkspace,
  detectSemantics,
  ROLE,
} = require('../../../semantic');

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
  const detected = detectSemantics(graph, {
    layoutIr: null,
    layoutDegraded: true,
    decisions: [],
    policy: ctx.policy || { profileId: 'default' },
  });
  return { graph, detected };
}

function proposeRole(ctx, rule) {
  const { detected } = runDetect(ctx);
  const profile = (ctx.policy && ctx.policy.profileId) || 'default';
  const conservative = profile === 'pixel-faithful';

  for (const amb of detected.ambiguous) {
    const evId = `ev:${rule.ruleId}:amb:${amb.nodeId}`;
    ctx.addEvidence({
      evidenceId: evId,
      kind: 'other',
      ref: 'semantic.ambiguous',
      detail: { nodeId: amb.nodeId, roles: amb.roles, semantic: true },
      ruleId: rule.ruleId,
    });

    const candidates = (amb.roles || []).map((r, i) => ({
      candidateId: `cand:semantic.role:${amb.nodeId}:${r.role}`,
      answer: {
        nodeId: amb.nodeId,
        role: r.role,
        level: r.level != null ? r.level : null,
      },
      localScore: Math.max(0.2, (r.score != null ? r.score : 0.5) - i * 0.05),
      priorityBand: rule.priorityBand || 'P2',
    }));
    candidates.push({
      candidateId: `cand:semantic.role:${amb.nodeId}:generic`,
      answer: { nodeId: amb.nodeId, role: ROLE.GENERIC, level: null },
      localScore: conservative ? 0.7 : 0.35,
      priorityBand: rule.priorityBand || 'P2',
      safeGeneric: true,
    });

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${amb.nodeId}`,
      question: rule.question,
      subject: amb.nodeId,
      ruleId: rule.ruleId,
      candidates,
      evidence: [{ evidenceId: evId, kind: 'other', ref: 'semantic.ambiguous' }],
      localScores: candidates.map((c) => ({ candidateId: c.candidateId, value: c.localScore })),
    });
  }

  // Landmark signals (pack visibility) even when unambiguous
  for (const lm of detected.landmarks.slice(0, 30)) {
    ctx.addEvidence({
      evidenceId: `ev:${rule.ruleId}:lm:${lm.nodeId}`,
      kind: 'feature',
      ref: 'semantic.landmark',
      detail: { nodeId: lm.nodeId, role: lm.role, semantic: true },
      ruleId: rule.ruleId,
    });
  }

  for (const h of detected.headings.slice(0, 20)) {
    ctx.addEvidence({
      evidenceId: `ev:${rule.ruleId}:h:${h.nodeId}`,
      kind: 'feature',
      ref: 'semantic.heading',
      detail: { nodeId: h.nodeId, level: h.level, semantic: true },
      ruleId: rule.ruleId,
    });
  }

  ctx.log('semantic.detect.role complete', {
    ambiguous: detected.ambiguous.length,
    landmarks: detected.landmarks.length,
  });
}

function proposeRegion(ctx, rule) {
  const { detected } = runDetect(ctx);

  for (const g of detected.groups) {
    const evId = `ev:${rule.ruleId}:${g.groupId}`;
    ctx.addEvidence({
      evidenceId: evId,
      kind: 'feature',
      ref: 'semantic.group',
      detail: { ...g, semantic: true },
      ruleId: rule.ruleId,
    });

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${g.groupId}`,
      question: rule.question,
      subject: g.parentNodeId || g.groupId,
      ruleId: rule.ruleId,
      candidates: [
        {
          candidateId: `cand:semantic.region:${g.groupId}:keep`,
          answer: { regionKind: g.kind, groupId: g.groupId, keep: true },
          localScore: 0.7,
          priorityBand: rule.priorityBand || 'P3',
        },
        {
          candidateId: `cand:semantic.region:${g.groupId}:abstain`,
          answer: { regionKind: g.kind, groupId: g.groupId, keep: false },
          localScore: 0.4,
          priorityBand: rule.priorityBand || 'P3',
          safeGeneric: true,
        },
      ],
      evidence: [{ evidenceId: evId, kind: 'feature', ref: 'semantic.group' }],
      localScores: [
        { candidateId: `cand:semantic.region:${g.groupId}:keep`, value: 0.7 },
        { candidateId: `cand:semantic.region:${g.groupId}:abstain`, value: 0.4 },
      ],
    });
  }

  // Always emit at least landmark evidence for region pack visibility
  if (detected.groups.length === 0) {
    for (const lm of detected.landmarks.filter((l) => l.role === 'region' || l.role === 'main').slice(0, 10)) {
      ctx.addEvidence({
        evidenceId: `ev:${rule.ruleId}:region:${lm.nodeId}`,
        kind: 'feature',
        ref: 'semantic.landmark',
        detail: { nodeId: lm.nodeId, role: lm.role, semantic: true, regionHint: true },
        ruleId: rule.ruleId,
      });
    }
  }

  ctx.log('semantic.detect.region complete', { groups: detected.groups.length });
}

module.exports = {
  'semantic.detect.role': proposeRole,
  'semantic.detect.region': proposeRegion,
};
