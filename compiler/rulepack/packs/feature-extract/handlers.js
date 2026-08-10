'use strict';

/**
 * Phase 9 — Feature Extraction rule handlers.
 * Phase 10: prefer ndg.node Facts (structural SSOT).
 */

const {
  extractFeatures,
  assertionFromFact,
  collectNodeFacts,
  SOURCE_NODE_KIND,
} = require('../../../features');

function extractNodes(ctx, rule) {
  const signal = ctx.knowledgeGet('feature:recognition.signals');
  const { facts: nodeFacts, inputMode } = collectNodeFacts(
    (id) => ctx.getFact(id),
    () => ctx.listFactIds()
  );

  if (inputMode === 'transitional-source-node') {
    ctx.warn('feature.extract using transitional source.node input', { inputMode });
  }

  if (!nodeFacts.length) {
    ctx.addEvidence({
      evidenceId: `ev:${rule.ruleId}:empty`,
      kind: 'feature',
      ref: signal ? signal.entryId : 'feature:recognition.signals',
      detail: { nodeCount: 0, note: 'no ndg.node or source.node facts', inputMode },
      ruleId: rule.ruleId,
    });
    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:empty`,
      question: rule.question,
      subject: 'src:none',
      ruleId: rule.ruleId,
      candidates: [
        {
          candidateId: 'cand:features:none',
          answer: { extracted: false, nodeCount: 0, inputMode },
          localScore: 0.1,
          priorityBand: rule.priorityBand || 'P5',
          safeGeneric: true,
        },
      ],
      evidence: [{ evidenceId: `ev:${rule.ruleId}:empty`, kind: 'feature', ref: 'feature:recognition.signals' }],
      localScores: [{ candidateId: 'cand:features:none', value: 0.1 }],
    });
    ctx.log('feature.extract: no nodes', { inputMode });
    return;
  }

  for (const fact of nodeFacts) {
    const assertion = assertionFromFact(fact);
    const extracted = extractFeatures(assertion);
    const subject = fact.subject || fact.factId;
    const evId = `ev:${rule.ruleId}:${fact.factId}`;

    ctx.knowledgeGet('feature:nodeType');
    ctx.knowledgeGet('feature:autoLayout');
    ctx.knowledgeGet('feature:hierarchy');

    ctx.addEvidence({
      evidenceId: evId,
      kind: 'feature',
      ref: signal ? signal.entryId : 'feature:recognition.signals',
      detail: {
        factId: fact.factId,
        kind: fact.kind || SOURCE_NODE_KIND,
        inputMode,
        features: extracted.features,
        presentKeys: extracted.presentKeys,
        meta: extracted.meta,
      },
      ruleId: rule.ruleId,
    });

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${fact.factId}`,
      question: rule.question,
      subject,
      ruleId: rule.ruleId,
      candidates: [
        {
          candidateId: `cand:features:${fact.factId}`,
          answer: {
            extracted: true,
            featureKeys: extracted.presentKeys,
            nodeType: extracted.features.nodeType,
            inputMode,
          },
          localScore: 0.9,
          priorityBand: rule.priorityBand || 'P5',
        },
      ],
      evidence: [{ evidenceId: evId, kind: 'feature', ref: 'feature:recognition.signals' }],
      localScores: [{ candidateId: `cand:features:${fact.factId}`, value: 0.9 }],
    });
  }

  ctx.log('feature.extract complete', { nodeCount: nodeFacts.length, inputMode });
}

module.exports = {
  'feature.extract.nodes': extractNodes,
};
