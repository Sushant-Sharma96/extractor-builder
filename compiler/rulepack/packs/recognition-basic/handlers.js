'use strict';

/**
 * Phase 9 — Recognition rule handlers.
 * Phase 10: prefer ndg.node Facts (structural SSOT).
 */

const {
  recognizeBlockKinds,
  assertionFromFact,
  extractFeatures,
  collectNodeFacts,
} = require('../../../features');

function resolveNameCap(ctx) {
  const t = ctx.policy && ctx.policy.thresholds;
  if (t && typeof t.pattern_name_cap === 'number') return t.pattern_name_cap;
  return 0.4;
}

function recognizeBlockKind(ctx, rule) {
  const cap = resolveNameCap(ctx);
  const generic = ctx.knowledgeGet('pattern:block.generic-block');
  const signal = ctx.knowledgeGet('feature:recognition.signals');

  for (const id of [
    'pattern:block.button-like',
    'pattern:block.card-like',
    'pattern:block.container-like',
    'pattern:block.text-block',
    'pattern:block.image-block',
    'pattern:block.divider',
    'pattern:block.section',
    'pattern:block.grid',
    'pattern:block.stack',
    'pattern:block.list',
  ]) {
    ctx.knowledgeGet(id);
  }

  const { facts: nodeFacts, inputMode } = collectNodeFacts(
    (id) => ctx.getFact(id),
    () => ctx.listFactIds()
  );

  if (inputMode === 'transitional-source-node') {
    ctx.warn('recognition.basic using transitional source.node input', { inputMode });
  }

  if (!nodeFacts.length) {
    ctx.addEvidence({
      evidenceId: `ev:${rule.ruleId}:empty`,
      kind: 'feature',
      ref: signal ? signal.entryId : 'feature:recognition.signals',
      detail: { nodeCount: 0, inputMode },
      ruleId: rule.ruleId,
    });
    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:empty`,
      question: rule.question,
      subject: 'src:none',
      ruleId: rule.ruleId,
      candidates: [
        {
          candidateId: 'cand:generic-block',
          answer: {
            blockKind: 'generic-block',
            patternRef: generic ? generic.entryId : 'pattern:block.generic-block',
            inputMode,
          },
          localScore: 0.4,
          priorityBand: 'P5',
          patternRef: 'pattern:block.generic-block',
          safeGeneric: true,
        },
      ],
      evidence: [{ evidenceId: `ev:${rule.ruleId}:empty`, kind: 'feature', ref: 'feature:recognition.signals' }],
      localScores: [{ candidateId: 'cand:generic-block', value: 0.4 }],
    });
    ctx.log('recognition.basic: no nodes', { inputMode });
    return;
  }

  for (const fact of nodeFacts) {
    const result = recognizeBlockKinds(extractFeatures(assertionFromFact(fact)), {
      patternNameCap: cap,
    });

    const evIds = [];
    result.evidence.forEach((ev, i) => {
      const evidenceId = `ev:${rule.ruleId}:${fact.factId}:${i}`;
      ctx.addEvidence({
        evidenceId,
        kind: ev.kind,
        ref: ev.ref,
        detail: {
          ...ev.detail,
          factId: fact.factId,
          subject: fact.subject,
          inputMode,
        },
        ruleId: rule.ruleId,
      });
      evIds.push({ evidenceId, kind: ev.kind, ref: ev.ref });
    });

    const candidates = result.candidates.map((c) => ({
      candidateId: `${c.candidateId}:${fact.factId}`,
      answer: { ...c.answer, inputMode },
      localScore: c.localScore,
      priorityBand: c.priorityBand || rule.priorityBand || 'P5',
      patternRef: c.patternRef,
      safeGeneric: c.safeGeneric === true,
      nameOnly: c.nameOnly === true,
      cues: c.cues,
    }));

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${fact.factId}`,
      question: rule.question,
      subject: fact.subject || fact.factId,
      ruleId: rule.ruleId,
      candidates,
      evidence: evIds,
      localScores: candidates.map((c) => ({ candidateId: c.candidateId, value: c.localScore })),
    });
  }

  ctx.log('recognition.basic complete', {
    nodeCount: nodeFacts.length,
    patternNameCap: cap,
    inputMode,
  });
}

module.exports = {
  'recognition.basic.blockKind': recognizeBlockKind,
};
