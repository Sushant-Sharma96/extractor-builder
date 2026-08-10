'use strict';

/**
 * Phase 12 — Component Rule Pack handlers.
 * Propose only. Never commit. Never mutate NDG/Layout.
 */

const {
  loadNdgFromWorkspace,
  detectComponents,
} = require('../../../components');
const { detectComponentGeometry } = require('./geometry-rules');

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
  const detected = detectComponents(graph, {
    layoutIr: null,
    layoutDegraded: true,
    decisions: [],
    policy: ctx.policy || { profileId: 'default' },
  });
  return { graph, detected };
}

function proposeTreatment(ctx, rule) {
  const { detected } = runDetect(ctx);
  const profile = (ctx.policy && ctx.policy.profileId) || 'default';
  const preferKeep = profile === 'pixel-faithful' || profile === 'default';

  for (const inst of detected.instances) {
    const evId = `ev:${rule.ruleId}:${inst.nodeId}`;
    ctx.addEvidence({
      evidenceId: evId,
      kind: 'feature',
      ref: 'component.instance',
      detail: {
        nodeId: inst.nodeId,
        defId: inst.defId,
        variant: inst.variant,
        component: true,
      },
      ruleId: rule.ruleId,
    });

    const keepScore = preferKeep ? 0.72 : 0.55;
    const flattenScore = preferKeep ? 0.28 : 0.45;

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${inst.nodeId}`,
      question: rule.question,
      subject: inst.nodeId,
      ruleId: rule.ruleId,
      candidates: [
        {
          candidateId: `cand:component.treatment:${inst.nodeId}:keep`,
          answer: { treatment: 'keep', defId: inst.defId },
          localScore: keepScore,
          priorityBand: rule.priorityBand || 'P3',
          safeGeneric: true,
        },
        {
          candidateId: `cand:component.treatment:${inst.nodeId}:flatten`,
          answer: { treatment: 'flatten', defId: inst.defId },
          localScore: flattenScore,
          priorityBand: rule.priorityBand || 'P3',
        },
      ],
      evidence: [{ evidenceId: evId, kind: 'feature', ref: 'component.instance' }],
      localScores: [
        { candidateId: `cand:component.treatment:${inst.nodeId}:keep`, value: keepScore },
        { candidateId: `cand:component.treatment:${inst.nodeId}:flatten`, value: flattenScore },
      ],
    });
  }

  for (const o of detected.orphans) {
    ctx.addEvidence({
      evidenceId: `ev:${rule.ruleId}:orphan:${o.nodeId}`,
      kind: 'other',
      ref: 'component.orphan',
      detail: { ...o, component: true },
      ruleId: rule.ruleId,
    });
  }

  ctx.log('component.detect.treatment complete', {
    instances: detected.instances.length,
    orphans: detected.orphans.length,
  });
}

function proposeReuse(ctx, rule) {
  const { detected } = runDetect(ctx);

  for (const def of detected.definitions) {
    const evId = `ev:${rule.ruleId}:${def.defId}`;
    ctx.addEvidence({
      evidenceId: evId,
      kind: 'feature',
      ref: 'component.signal',
      detail: { nodeId: def.nodeId, defId: def.defId, role: 'definition', component: true },
      ruleId: rule.ruleId,
    });

    const instanceCount = detected.instances.filter((i) => i.defId === def.defId).length;
    const reuseScore = instanceCount >= 2 ? 0.7 : 0.4;

    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:${def.defId}`,
      question: rule.question,
      subject: def.nodeId,
      ruleId: rule.ruleId,
      candidates: [
        {
          candidateId: `cand:component.reuse:${def.defId}:hint`,
          answer: { reuse: 'emit-reuse-hint', defId: def.defId, instanceCount },
          localScore: reuseScore,
          priorityBand: rule.priorityBand || 'P4',
        },
        {
          candidateId: `cand:component.reuse:${def.defId}:none`,
          answer: { reuse: 'none', defId: def.defId },
          localScore: 1 - reuseScore,
          priorityBand: rule.priorityBand || 'P4',
          safeGeneric: true,
        },
      ],
      evidence: [{ evidenceId: evId, kind: 'feature', ref: 'component.signal' }],
      localScores: [
        { candidateId: `cand:component.reuse:${def.defId}:hint`, value: reuseScore },
        { candidateId: `cand:component.reuse:${def.defId}:none`, value: 1 - reuseScore },
      ],
    });
  }

  ctx.log('component.detect.reuse complete', { definitions: detected.definitions.length });
}

/**
 * Phase 2 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — card/banner/divider shape
 * recognition, propose-only. Consumes NDG directly via geometry-rules.js's
 * pure detectComponentGeometry sweep (no geometry-IR Fact dependency wired
 * here yet — divider assignment simply abstains without Phase-1 column-flex
 * candidates, which is a safe, documented degrade, not a silent wrong answer).
 */
function proposeCardBannerDivider(ctx, rule) {
  const { graph } = loadNdgFromWorkspace(workspaceProxy(ctx));
  const geo = detectComponentGeometry(graph, {});

  for (const card of geo.cardFacts) {
    const evId = `ev:${rule.ruleId}:card:${card.nodeId}`;
    ctx.addEvidence({
      evidenceId: evId,
      kind: 'feature',
      ref: 'component.card-shape',
      detail: {
        nodeId: card.nodeId,
        shape: card.shape,
        chromeId: card.chromeId,
        contentIds: card.contentIds,
        padding: card.padding,
        paddingNormalized: card.paddingNormalized,
        component: true,
      },
      ruleId: rule.ruleId,
    });
    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:card:${card.nodeId}`,
      question: 'component.cardPattern',
      subject: card.nodeId,
      ruleId: rule.ruleId,
      candidates: [
        {
          candidateId: `cand:component.card:${card.nodeId}:recognize`,
          answer: { pattern: 'card', shape: card.shape },
          localScore: 0.7,
          priorityBand: rule.priorityBand || 'P3',
        },
        {
          candidateId: `cand:component.card:${card.nodeId}:abstain`,
          answer: { pattern: 'none' },
          localScore: 0.3,
          priorityBand: rule.priorityBand || 'P3',
          safeGeneric: true,
        },
      ],
      evidence: [{ evidenceId: evId, kind: 'feature', ref: 'component.card-shape' }],
      localScores: [
        { candidateId: `cand:component.card:${card.nodeId}:recognize`, value: 0.7 },
        { candidateId: `cand:component.card:${card.nodeId}:abstain`, value: 0.3 },
      ],
    });
  }

  for (const grid of geo.cardGridFacts) {
    ctx.addEvidence({
      evidenceId: `ev:${rule.ruleId}:card-grid:${grid.nodeId}`,
      kind: 'feature',
      ref: 'component.card-grid',
      detail: { nodeId: grid.nodeId, orderedChildIds: grid.orderedChildIds, gap: grid.gap, component: true },
      ruleId: rule.ruleId,
    });
  }

  for (const banner of geo.bannerFacts) {
    const evId = `ev:${rule.ruleId}:banner:${banner.nodeId}`;
    ctx.addEvidence({
      evidenceId: evId,
      kind: 'feature',
      ref: 'component.banner-shape',
      detail: {
        nodeId: banner.nodeId,
        chromeId: banner.chromeId,
        contentIds: banner.contentIds,
        padding: banner.padding,
        component: true,
      },
      ruleId: rule.ruleId,
    });
    ctx.addHypothesis({
      hypothesisId: `hyp:${rule.ruleId}:banner:${banner.nodeId}`,
      question: 'component.bannerPattern',
      subject: banner.nodeId,
      ruleId: rule.ruleId,
      candidates: [
        {
          candidateId: `cand:component.banner:${banner.nodeId}:recognize`,
          answer: { pattern: 'banner' },
          localScore: 0.65,
          priorityBand: rule.priorityBand || 'P3',
        },
        {
          candidateId: `cand:component.banner:${banner.nodeId}:abstain`,
          answer: { pattern: 'none' },
          localScore: 0.35,
          priorityBand: rule.priorityBand || 'P3',
          safeGeneric: true,
        },
      ],
      evidence: [{ evidenceId: evId, kind: 'feature', ref: 'component.banner-shape' }],
      localScores: [
        { candidateId: `cand:component.banner:${banner.nodeId}:recognize`, value: 0.65 },
        { candidateId: `cand:component.banner:${banner.nodeId}:abstain`, value: 0.35 },
      ],
    });
  }

  for (const divider of geo.dividerFacts) {
    ctx.addEvidence({
      evidenceId: `ev:${rule.ruleId}:divider:${divider.nodeId}`,
      kind: 'feature',
      ref: 'component.divider-shape',
      detail: {
        nodeId: divider.nodeId,
        parentId: divider.parentId,
        afterColumnIndex: divider.afterColumnIndex,
        component: true,
      },
      ruleId: rule.ruleId,
    });
  }

  ctx.log('component.detect.cardBannerDivider complete', geo.metrics);
}

module.exports = {
  'component.detect.treatment': proposeTreatment,
  'component.detect.reuse': proposeReuse,
  'component.detect.cardBannerDivider': proposeCardBannerDivider,
};
