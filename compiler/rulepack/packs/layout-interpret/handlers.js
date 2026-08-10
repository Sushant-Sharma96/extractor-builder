'use strict';

/**
 * Phase 11a — Layout interpretation Rule Pack handlers.
 * Propose only. Never commit Decisions. Never mutate NDG.
 */

const {
  loadNdgFromWorkspace,
  indexGraph,
  interpretGraph,
} = require('../../../layout');

function runInterpretation(ctx) {
  // Rule packs cannot call getIrSlice unless we add it to rule context.
  // Load via Facts (ndg.node / ndg.graph) which RuleContext can read.
  const wsProxy = {
    listIds: (kind) => {
      if (kind === 'Fact') return ctx.listFactIds();
      if (kind === 'IrSlice') return []; // prefer Facts path from NDG publish
      return [];
    },
    getFact: (id) => ctx.getFact(id),
    getIrSlice: () => null,
  };

  // Prefer reconstructing from ndg Facts (always published with NDG)
  const { graph } = loadNdgFromWorkspace(wsProxy);
  const index = indexGraph(graph);
  const interpretations = interpretGraph(graph, index, {});
  return { graph, interpretations };
}

function interpretMode(ctx, rule) {
  const { interpretations } = runInterpretation(ctx);

  for (const interp of interpretations) {
    const evId = `ev:${rule.ruleId}:${interp.nodeId}`;
    const ev = interp.evidence[0];
    ctx.addEvidence({
      evidenceId: evId,
      kind: ev.kind,
      ref: ev.ref,
      detail: { ...ev.detail, layout: true },
      ruleId: rule.ruleId,
    });

    const candidates = interp.modeCandidates.map((c, i) => ({
      candidateId: `cand:layout.mode:${interp.nodeId}:${c.mode}`,
      answer: {
        mode: c.mode,
        axis: interp.axis,
        childOrder: interp.childOrder,
        outOfFlow: interp.outOfFlow,
        gap: interp.gap,
        padding: interp.padding,
      },
      localScore: c.localScore,
      priorityBand: rule.priorityBand || 'P3',
      safeGeneric: c.mode === 'unknown',
      cues: c.cues,
    }));

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${interp.nodeId}`,
      question: rule.question,
      subject: interp.nodeId,
      ruleId: rule.ruleId,
      candidates,
      evidence: [{ evidenceId: evId, kind: 'feature', ref: 'layout.signal' }],
      localScores: candidates.map((c) => ({ candidateId: c.candidateId, value: c.localScore })),
    });
  }

  ctx.log('layout.interpret.mode complete', { nodes: interpretations.length });
}

function interpretSizing(ctx, rule) {
  const { interpretations } = runInterpretation(ctx);

  for (const interp of interpretations) {
    const evId = `ev:${rule.ruleId}:${interp.nodeId}`;
    ctx.addEvidence({
      evidenceId: evId,
      kind: 'feature',
      ref: 'layout.signal',
      detail: {
        layout: true,
        nodeId: interp.nodeId,
        sizing: interp.sizing,
      },
      ruleId: rule.ruleId,
    });

    const h = interp.sizing.horizontal;
    const v = interp.sizing.vertical;
    const candidates = [
      {
        candidateId: `cand:layout.sizing:${interp.nodeId}:hv`,
        answer: { horizontal: h, vertical: v },
        localScore: h === 'unknown' && v === 'unknown' ? 0.25 : 0.7,
        priorityBand: rule.priorityBand || 'P4',
        safeGeneric: h === 'unknown' || v === 'unknown',
      },
    ];

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${interp.nodeId}`,
      question: rule.question,
      subject: interp.nodeId,
      ruleId: rule.ruleId,
      candidates,
      evidence: [{ evidenceId: evId, kind: 'feature', ref: 'layout.signal' }],
      localScores: candidates.map((c) => ({ candidateId: c.candidateId, value: c.localScore })),
    });
  }

  ctx.log('layout.interpret.sizing complete', { nodes: interpretations.length });
}

module.exports = {
  'layout.interpret.mode': interpretMode,
  'layout.interpret.sizing': interpretSizing,
};
