'use strict';

/**
 * project — EmitPlan from ResolvedIR only.
 * Exporter-neutral: no HTML/CSS/React code. Plan structures only.
 * Schema-required fields filled; rich plan nested under classStrategy.
 */

const { BUILDER_VERSION, STAGE_ID, STAGE_ORDER } = require('./constants');
const { emitPlanChecksum } = require('./checksum');
const { deepFreeze } = require('./collect');
const { EmitError, EmitErrorKind } = require('./errors');

function decisionAnswer(d) {
  const st = d.status;
  if (st !== 'arbitrated' && st !== 'fallen-back' && st !== 'overridden') return null;
  const w = d.winner;
  if (w && w.kind === 'candidate' && Array.isArray(d.candidates)) {
    const cand = d.candidates.find((c) => c.candidateId === w.candidateId);
    return cand && cand.answer;
  }
  if (w && w.answer) return w.answer;
  return null;
}

/**
 * Map committed Decisions to schema tag/role choices.
 * Uses exporter-neutral unit ids (not framework tags) when answer provides emitUnit/role/tag.
 */
function buildChoices(decisions) {
  const tagChoices = [];
  const roleChoices = [];
  const jsModules = [];

  for (const d of decisions || []) {
    const answer = decisionAnswer(d);
    if (!answer) continue;
    const decisionId = d.decisionId || d.id;
    if (!decisionId) continue;

    if (d.question === 'html.tag') {
      const nodeId = answer.nodeId || d.subject;
      const tag = answer.emitUnit || answer.unit || answer.tag;
      if (nodeId && tag) {
        tagChoices.push({ nodeId: String(nodeId), tag: String(tag), decisionId: String(decisionId) });
      }
    }
    if (d.question === 'semantic.role' || d.question === 'a11y.role') {
      const nodeId = answer.nodeId || d.subject;
      const role = answer.role || answer.accessRole;
      if (nodeId && role) {
        roleChoices.push({ nodeId: String(nodeId), role: String(role), decisionId: String(decisionId) });
      }
    }
    if (d.question === 'behavior.authorize_js' && answer.authorized === true) {
      jsModules.push({
        moduleId: String(answer.moduleId || `mod:${decisionId}`),
        authorizedByDecisionId: String(decisionId),
      });
    }
  }

  tagChoices.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  roleChoices.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  jsModules.sort((a, b) => (a.moduleId < b.moduleId ? -1 : 1));
  return { tagChoices, roleChoices, jsModules };
}

/**
 * Phase 3 (docs/COMPILER_MIGRATION_BLUEPRINT.md §3) — `layoutChoices`, the one
 * contract addition the Renderer needs: symmetrical to the existing
 * `tagChoices`/`roleChoices` arrays above (same flat, sorted-by-nodeId shape).
 *
 * Sourced from Phase 0-2's IR directly (not from Decisions — LayoutIR has no
 * committed `layout.mode` Decision in most fixtures yet, so, like LayoutIR's
 * own `resolveMode()` fact-baseline branch, this reads each node's
 * already-published `mode`/`gap`/`padding` from LayoutIR's `nodes[]`, plus
 * Component IR's `cardPatterns`/`bannerPatterns` for chrome facts) — exactly
 * the blueprint's own wording: "top-scoring modeCandidates[0].mode plus
 * Component IR's card/banner facts".
 *
 * `layoutIrPayload`/`componentIrPayload` are the *published* payloads (the
 * same shape `compiler/layout`/`compiler/components`' `project*` functions
 * already produce) — optional; when absent, `layoutChoices` is `[]`, so this
 * never breaks a caller that doesn't pass them (no serving-path caller does
 * today — see Phase 3's STATUS note on the default-off discipline).
 *
 * @param {object} [layoutIrPayload] — LayoutIR published payload ({ nodes: [...] })
 * @param {object} [componentIrPayload] — Component IR published payload
 * @returns {Array<object>} layoutChoices, sorted by nodeId
 */
function buildLayoutChoices(layoutIrPayload, componentIrPayload) {
  if (!layoutIrPayload || !Array.isArray(layoutIrPayload.nodes)) return [];

  const cardByNode = new Map();
  const bannerByNode = new Map();
  if (componentIrPayload) {
    for (const c of componentIrPayload.cardPatterns || []) {
      if (c && c.nodeId) cardByNode.set(String(c.nodeId), c);
    }
    for (const b of componentIrPayload.bannerPatterns || []) {
      if (b && b.nodeId) bannerByNode.set(String(b.nodeId), b);
    }
  }

  const choices = layoutIrPayload.nodes.map((n) => {
    const nodeId = String(n.nodeId);
    const cardFactRaw = cardByNode.get(nodeId) || null;
    const bannerFactRaw = bannerByNode.get(nodeId) || null;
    const choice = {
      nodeId,
      mode: n.mode || 'unknown',
      gap: n.gap != null ? n.gap : null,
      padding: n.padding || null,
      decisionIds: [...(n.decisionIds || [])],
    };
    if (cardFactRaw) {
      choice.cardShape = cardFactRaw.shape || 'shell';
      choice.cardFact = { shape: cardFactRaw.shape || null, padding: { ...(cardFactRaw.padding || {}) } };
    }
    if (bannerFactRaw) {
      choice.bannerShape = true;
      choice.bannerFact = { padding: { ...(bannerFactRaw.padding || {}) } };
    }
    return choice;
  });

  choices.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  return choices;
}

function buildNeutralPlan(resolved) {
  const slices = [...(resolved.slices || [])].sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a.stageId);
    const ib = STAGE_ORDER.indexOf(b.stageId);
    const sa = ia < 0 ? 999 : ia;
    const sb = ib < 0 ? 999 : ib;
    return sa - sb || (a.sliceId < b.sliceId ? -1 : 1);
  });

  const renderOrder = [...new Set(slices.flatMap((s) => s.nodeIds || []))].sort();

  const dependencyOrder = slices.map((s) => ({
    stageId: s.stageId,
    sliceId: s.sliceId,
  }));

  const resourceGraph = {
    nodes: slices.map((s) => ({ id: s.sliceId, stageId: s.stageId })),
    edges: [],
  };
  for (let i = 1; i < slices.length; i += 1) {
    resourceGraph.edges.push({
      from: slices[i - 1].sliceId,
      to: slices[i].sliceId,
      kind: 'pipeline-order',
    });
  }

  const componentExpansionPlan = slices
    .filter((s) => s.stageId === 'component-ir')
    .map((s) => ({
      sliceId: s.sliceId,
      expand: true,
      nodeIds: [...(s.nodeIds || [])],
    }));

  const assetPlan = {
    refs: [],
    note: 'AssetIR optional — empty when absent',
  };

  const exportPlan = {
    resolvedId: resolved.resolvedId,
    includedStages: slices.map((s) => s.stageId),
    decisionIds: [...(resolved.decisionIds || [])],
  };

  const chunkPlan = {
    chunks: [
      {
        chunkId: 'chunk:main',
        memberSliceIds: slices.map((s) => s.sliceId),
        memberNodeIds: renderOrder,
      },
    ],
  };

  return {
    exportPlan,
    assetPlan,
    componentExpansionPlan,
    renderOrder,
    dependencyOrder,
    resourceGraph,
    chunkPlan,
  };
}

function projectEmitPlan(collected, opts = {}) {
  if (!collected || !collected.resolved) {
    throw new EmitError(EmitErrorKind.INVALID_INPUT, 'ResolvedIR required');
  }

  const { tagChoices, roleChoices, jsModules } = buildChoices(collected.decisions);
  const neutral = buildNeutralPlan(collected.resolved);
  const planId = opts.planId || `emit:${collected.resolved.resolvedId}`;
  // Phase 3 — new, additive, optional (see buildLayoutChoices doc comment).
  const layoutChoices = buildLayoutChoices(opts.layoutIr, opts.componentIr);

  // EmitPlan contract shape — rich plan under classStrategy (additionalProperties allowed there)
  const payload = {
    contractId: 'EmitPlan',
    suiteVersion: opts.suiteVersion || '1.0.0',
    planId,
    resolvedId: collected.resolved.resolvedId,
    policyProfileId: collected.policyProfileId || 'default',
    tagChoices,
    roleChoices,
    layoutChoices,
    classStrategy: {
      mode: 'exporter-neutral',
      ...neutral,
    },
    jsModules,
    assetEmbedRefs: [],
  };

  const checksum = emitPlanChecksum(payload);
  const graphId = collected.resolvedSlice.graphId || null;
  const sliceId = opts.sliceId || `slice:emit:${collected.resolved.resolvedId}`;
  const nodeIds = [...neutral.renderOrder];

  const frozen = deepFreeze({
    stageId: STAGE_ID,
    sliceId,
    nodeIds,
    graphId,
    checksum,
    builderVersion: BUILDER_VERSION,
    suiteVersion: payload.suiteVersion,
    payload,
  });

  return {
    slice: frozen,
    checksum,
    builderVersion: BUILDER_VERSION,
    planId,
    neutral,
  };
}

module.exports = { projectEmitPlan, buildNeutralPlan, buildChoices, buildLayoutChoices };
