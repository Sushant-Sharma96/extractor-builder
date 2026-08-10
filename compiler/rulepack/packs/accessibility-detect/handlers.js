'use strict';

/**
 * Phase 16 — Accessibility Rule Pack handlers.
 * Propose only. Never commit. Never mutate NDG / SemanticIR.
 */

const {
  loadNdgFromWorkspace,
  detectAccessibility,
  ACCESS_ROLE,
  KEYBOARD_HINT,
} = require('../../../accessibility');

function workspaceProxy(ctx) {
  return {
    listIds: (kind) => {
      if (kind === 'Fact') return ctx.listFactIds();
      if (kind === 'IrSlice' && typeof ctx.listIrSliceIds === 'function') {
        return ctx.listIrSliceIds();
      }
      return [];
    },
    getFact: (id) => ctx.getFact(id),
    getIrSlice: (id) => (typeof ctx.getIrSlice === 'function' ? ctx.getIrSlice(id) : null),
    getDecision: () => null,
  };
}

function runDetect(ctx) {
  const { graph } = loadNdgFromWorkspace(workspaceProxy(ctx));
  const detected = detectAccessibility(graph, {
    layoutIr: null,
    layoutDegraded: true,
    semanticIr: null,
    semanticDegraded: true,
    decisions: [],
    policy: ctx.policy || { profileId: 'default' },
  });
  return { graph, detected };
}

function proposeName(ctx, rule) {
  const { detected } = runDetect(ctx);
  const profile = (ctx.policy && ctx.policy.profileId) || 'default';
  const conservative = profile === 'pixel-faithful';

  for (const amb of detected.ambiguous.filter((a) => a.question === 'a11y.name')) {
    const evId = `ev:${rule.ruleId}:amb:${amb.nodeId}`;
    ctx.addEvidence({
      evidenceId: evId,
      kind: 'other',
      ref: 'a11y.ambiguous',
      detail: { nodeId: amb.nodeId, candidates: amb.candidates, a11y: true },
      ruleId: rule.ruleId,
    });

    const candidates = (amb.candidates || []).map((c, i) => ({
      candidateId: `cand:a11y.name:${amb.nodeId}:${i}`,
      answer: {
        nodeId: amb.nodeId,
        candidateName: c.candidateName,
      },
      localScore: Math.max(0.2, (c.score != null ? c.score : 0.5) - i * 0.05),
      priorityBand: rule.priorityBand || 'P2',
    }));
    candidates.push({
      candidateId: `cand:a11y.name:${amb.nodeId}:abstain`,
      answer: { nodeId: amb.nodeId, candidateName: null, abstain: true },
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
      evidence: [{ evidenceId: evId, kind: 'other', ref: 'a11y.ambiguous' }],
      localScores: candidates.map((c) => ({ candidateId: c.candidateId, value: c.localScore })),
    });
  }

  for (const n of detected.names.slice(0, 25)) {
    ctx.addEvidence({
      evidenceId: `ev:${rule.ruleId}:name:${n.nodeId}`,
      kind: 'feature',
      ref: 'a11y.name',
      detail: { ...n, a11y: true },
      ruleId: rule.ruleId,
    });
  }

  for (const w of detected.warnings.slice(0, 20)) {
    ctx.addEvidence({
      evidenceId: `ev:${rule.ruleId}:warn:${w.nodeId}:${w.code}`,
      kind: 'other',
      ref: 'a11y.validate',
      detail: { ...w, a11y: true },
      ruleId: rule.ruleId,
    });
  }

  ctx.log('accessibility.detect.name complete', {
    ambiguous: detected.ambiguous.length,
    names: detected.names.length,
  });
}

function proposeRole(ctx, rule) {
  const { detected } = runDetect(ctx);

  for (const kh of detected.keyboardHints) {
    const evId = `ev:${rule.ruleId}:${kh.nodeId}`;
    ctx.addEvidence({
      evidenceId: evId,
      kind: 'feature',
      ref: 'a11y.focus',
      detail: { ...kh, a11y: true },
      ruleId: rule.ruleId,
    });

    if (kh.accessRole !== ACCESS_ROLE.INTERACTIVE && kh.accessRole !== ACCESS_ROLE.LANDMARK) {
      continue;
    }

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${kh.nodeId}`,
      question: rule.question,
      subject: kh.nodeId,
      ruleId: rule.ruleId,
      candidates: [
        {
          candidateId: `cand:a11y.role:${kh.nodeId}:${kh.accessRole}`,
          answer: {
            nodeId: kh.nodeId,
            accessRole: kh.accessRole,
            hint: kh.hint,
          },
          localScore: 0.7,
          priorityBand: rule.priorityBand || 'P3',
        },
        {
          candidateId: `cand:a11y.role:${kh.nodeId}:static`,
          answer: {
            nodeId: kh.nodeId,
            accessRole: ACCESS_ROLE.STATIC,
            hint: KEYBOARD_HINT.NONE,
          },
          localScore: 0.35,
          priorityBand: rule.priorityBand || 'P3',
          safeGeneric: true,
        },
      ],
      evidence: [{ evidenceId: evId, kind: 'feature', ref: 'a11y.focus' }],
      localScores: [
        { candidateId: `cand:a11y.role:${kh.nodeId}:${kh.accessRole}`, value: 0.7 },
        { candidateId: `cand:a11y.role:${kh.nodeId}:static`, value: 0.35 },
      ],
    });
  }

  ctx.log('accessibility.detect.role complete', {
    hints: detected.keyboardHints.length,
  });
}

module.exports = {
  'accessibility.detect.name': proposeName,
  'accessibility.detect.role': proposeRole,
};
