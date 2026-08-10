'use strict';

/**
 * Synthetic rule handlers — infrastructure demo only.
 * No Navbar/Hero/Card production logic.
 */

function factToHypothesis(ctx, rule) {
  const factIds = ctx.listFactIds();
  const subject = factIds.length ? factIds[0] : 'src:synthetic';
  const fact = factIds.length ? ctx.getFact(factIds[0]) : null;

  // Knowledge lookup (read-only)
  const feature = ctx.knowledgeGet('feature:equalGap');
  const pattern = ctx.knowledgeGet('pattern:block.generic');

  ctx.addEvidence({
    evidenceId: `ev:${rule.ruleId}:1`,
    kind: 'feature',
    ref: feature ? feature.entryId : 'feature:equalGap',
    detail: {
      hasFact: !!fact,
      patternId: pattern ? pattern.entryId : null,
    },
    ruleId: rule.ruleId,
  });

  const candidateId = 'cand-div-safe';
  ctx.addHypothesis({
    hypothesisId: `hyp:${rule.ruleId}:1`,
    question: rule.question,
    subject: fact ? fact.subject : subject,
    ruleId: rule.ruleId,
    candidates: [
      {
        candidateId,
        answer: { tag: 'div' },
        localScore: 0.55,
        priorityBand: rule.priorityBand || 'P5',
        safeGeneric: true,
      },
    ],
    evidence: [{ evidenceId: `ev:${rule.ruleId}:1`, kind: 'feature', ref: 'feature:equalGap' }],
    localScores: [{ candidateId, value: 0.55 }],
  });

  ctx.log('synthetic.fact-to-hypothesis complete', { subject });
}

module.exports = {
  'synthetic.fact-to-hypothesis': factToHypothesis,
};
