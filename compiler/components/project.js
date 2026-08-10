'use strict';

/**
 * project — immutable ComponentIR in memory.
 */

const { BUILDER_VERSION, STAGE_ID } = require('./constants');
const { componentIrChecksum } = require('./checksum');
const { deepFreeze } = require('./collect');
const { detectComponents } = require('./detect');
const { ComponentError, ComponentErrorKind } = require('./errors');

function projectComponentIR(graph, opts = {}) {
  if (!graph || !graph.graphId) {
    throw new ComponentError(ComponentErrorKind.INVALID_INPUT, 'graph required');
  }

  const detected = opts.detected || detectComponents(graph, {
    layoutIr: opts.layoutIr || null,
    layoutDegraded: opts.layoutDegraded === true,
    decisions: opts.decisions || [],
    policy: opts.policy || {},
  });

  const evidenceIdMap = opts.evidenceIdMap || {};
  const instances = detected.instances.map((inst) => ({
    ...inst,
    evidenceIds: evidenceIdMap[inst.nodeId] || [],
    decisionIds: inst.decisionIds || [],
  }));

  const payload = {
    graphId: graph.graphId,
    builderVersion: BUILDER_VERSION,
    definitions: detected.definitions.map((d) => ({ ...d })),
    instances,
    orphans: detected.orphans.map((o) => ({ ...o })),
    flattenPlan: detected.flattenPlan.map((f) => ({ ...f })),
    layoutDegraded: detected.layoutDegraded === true,
    // docs/COMPILER_REDESIGN_ROADMAP.md Phase 2.5 — declared-only claim set
    // (real component/instance identity), deliberately kept separate from
    // the geometric cardPatterns/etc. below — see detect.js's own comment
    // on claimedNodeIds for why the two must not be merged.
    claimedNodeIds: [...(detected.claimedNodeIds || [])],
    layoutIrSliceId: (opts.layoutIr && opts.layoutIr.sliceId) || null,
    // Phase 2 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — card/banner/divider
    // shape Facts, carried through to Component IR's published payload (not
    // just the in-memory detector result) — this is what makes the
    // end-to-end test in compiler/test/component-geometry.test.js decisive.
    cardPatterns: (detected.cardPatterns || []).map((c) => ({
      ...c,
      contentIds: [...(c.contentIds || [])],
      overlayIds: [...(c.overlayIds || [])],
      badgeIds: [...(c.badgeIds || [])],
      padding: { ...c.padding },
    })),
    cardGridPatterns: (detected.cardGridPatterns || []).map((g) => ({
      ...g,
      orderedChildIds: [...(g.orderedChildIds || [])],
    })),
    bannerPatterns: (detected.bannerPatterns || []).map((b) => ({
      ...b,
      contentIds: [...(b.contentIds || [])],
      padding: { ...b.padding },
    })),
    dividerPatterns: (detected.dividerPatterns || []).map((d) => ({ ...d })),
    // Row-set (repeating-pattern / table) shape Facts — same carry-through
    // discipline as cardPatterns/bannerPatterns above (published payload,
    // not just the in-memory detector result).
    rowSetPatterns: (detected.rowSetPatterns || []).map((r) => ({
      ...r,
      orderedChildIds: [...(r.orderedChildIds || [])],
      columns: (r.columns || []).map((c) => ({ ...c, memberIds: [...(c.memberIds || [])] })),
    })),
  };

  const checksum = componentIrChecksum(payload);
  const sliceId = opts.sliceId || `slice:component:${graph.graphId}`;
  const nodeIds = [
    ...payload.definitions.map((d) => d.nodeId),
    ...payload.instances.map((i) => i.nodeId),
    ...payload.orphans.map((o) => o.nodeId),
    ...payload.cardPatterns.map((c) => c.nodeId),
    ...payload.cardGridPatterns.map((g) => g.nodeId),
    ...payload.bannerPatterns.map((b) => b.nodeId),
    ...payload.dividerPatterns.map((d) => d.nodeId),
    ...payload.rowSetPatterns.map((r) => r.nodeId),
  ].filter(Boolean);
  nodeIds.sort();

  const frozen = deepFreeze({
    contractId: 'SpecializedIrEnvelope',
    suiteVersion: opts.suiteVersion || graph.suiteVersion || '1.0.0',
    stageId: STAGE_ID,
    sliceId,
    nodeIds: [...new Set(nodeIds)],
    graphId: graph.graphId,
    checksum,
    builderVersion: BUILDER_VERSION,
    payload,
  });

  return {
    slice: frozen,
    checksum,
    detected,
    builderVersion: BUILDER_VERSION,
  };
}

module.exports = { projectComponentIR };
