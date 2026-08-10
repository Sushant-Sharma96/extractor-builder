'use strict';

/**
 * detect — pure component signals from NDG (+ optional layout context).
 * Never mutates. Never commits Decisions.
 */

const {
  EVIDENCE_SIGNAL,
  EVIDENCE_INSTANCE,
  EVIDENCE_OVERRIDE,
  EVIDENCE_ORPHAN,
  EVIDENCE_DEGRADED,
  EVIDENCE_CARD_SHAPE,
  EVIDENCE_CARD_GRID,
  EVIDENCE_BANNER_SHAPE,
  EVIDENCE_DIVIDER_SHAPE,
  EVIDENCE_ROW_SET,
} = require('./constants');
// Phase 2 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — card/banner/divider shape
// recognition, ported read-only from server/figma-build.js's
// collapseCardShells/stampFeatureCards/inferCardGrids/
// normalizeSiblingCardChrome/collapseBannerShells/polishBannerContent/
// convertDividersToBorders/isVerticalDivider/isThinOverlay/isChromeBg. Lives
// in the rule-pack package per the blueprint's Phase 2 file plan, but is a
// plain pure-function module (no rule-pack machinery needed to call it
// directly here — same "propose only, no Decision-runtime coupling" shape
// as everything else in this file).
const { detectComponentGeometry } = require('../rulepack/packs/component-detect/geometry-rules');

function attrs(node) {
  return (node && node.attributes) || {};
}

function upperType(node) {
  return String((node && node.type) || '').toUpperCase();
}

function defIdFromNode(node) {
  const a = attrs(node);
  if (a.componentKey) return String(a.componentKey);
  if (a.componentId && upperType(node) === 'COMPONENT') return String(a.componentId);
  if (upperType(node) === 'COMPONENT') return `def:${node.id}`;
  return null;
}

function instanceDefRef(node) {
  const a = attrs(node);
  if (a.mainComponent) return String(a.mainComponent);
  if (a.mainComponentId) return String(a.mainComponentId);
  if (a.componentId && upperType(node) === 'INSTANCE') return String(a.componentId);
  return null;
}

function variantAxesFrom(node) {
  const a = attrs(node);
  const props = a.componentPropertyDefinitions || a.variantProperties || a.componentProperties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null;
  const axes = Object.keys(props).sort();
  return axes.length ? axes : null;
}

function overrideKeysFrom(node) {
  const a = attrs(node);
  const ov = a.overrides;
  if (Array.isArray(ov)) {
    return ov
      .map((o) => (o && (o.id || o.field || o.key)) || null)
      .filter(Boolean)
      .map(String)
      .sort();
  }
  if (ov && typeof ov === 'object') {
    return Object.keys(ov).sort();
  }
  return [];
}

/**
 * docs/COMPILER_REDESIGN_ROADMAP.md Phase 2.5 — real Figma override VALUES,
 * not just key names (Research Part 5's "Components/Instances" row: "only
 * override key names are ever extracted, never the override's actual new
 * value"). An instance whose override merely hides a badge or lengthens a
 * headline is otherwise geometrically indistinguishable from a genuinely
 * different design to every downstream clustering system — knowing WHAT
 * changed (not just THAT something changed) is what would let a future
 * consumer tell "same component, cosmetic override" from "actually
 * different content" instead of degrading a repeating group's recognized
 * membership. Figma's own override entry shape varies (`{id/field/key,
 * value}` on the REST API's array form; a plain `{[field]: value}` map on
 * some Plugin-API-sourced documents) — both are handled, each entry
 * normalized to the same `{key, value}` shape.
 */
function overrideEntriesFrom(node) {
  const a = attrs(node);
  const ov = a.overrides;
  if (Array.isArray(ov)) {
    return ov
      .map((o) => {
        const key = o && (o.id || o.field || o.key);
        if (!key) return null;
        return { key: String(key), value: o.value !== undefined ? o.value : null };
      })
      .filter(Boolean)
      .sort((x, y) => (x.key < y.key ? -1 : 1));
  }
  if (ov && typeof ov === 'object') {
    return Object.keys(ov)
      .sort()
      .map((key) => ({ key, value: ov[key] !== undefined ? ov[key] : null }));
  }
  return [];
}

function variantFromInstance(node) {
  const a = attrs(node);
  if (a.variantProperties && typeof a.variantProperties === 'object') {
    const keys = Object.keys(a.variantProperties).sort();
    return keys.map((k) => `${k}=${a.variantProperties[k]}`).join(',');
  }
  if (a.componentProperties && typeof a.componentProperties === 'object') {
    const keys = Object.keys(a.componentProperties).sort();
    const parts = [];
    for (const k of keys) {
      const v = a.componentProperties[k];
      if (v && typeof v === 'object' && v.value != null) parts.push(`${k}=${v.value}`);
      else if (v != null && typeof v !== 'object') parts.push(`${k}=${v}`);
    }
    return parts.length ? parts.join(',') : null;
  }
  return null;
}

function layoutModeFor(nodeId, layoutIr) {
  if (!layoutIr || !layoutIr.payload || !Array.isArray(layoutIr.payload.nodes)) return null;
  const n = layoutIr.payload.nodes.find((x) => x.nodeId === nodeId);
  return n ? n.mode : null;
}

/**
 * @param {object} graph
 * @param {{ layoutIr?: object|null, layoutDegraded?: boolean, decisions?: object[], policy?: object }} [opts]
 */
function detectComponents(graph, opts = {}) {
  const nodes = [...(graph.nodes || [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  const definitions = [];
  const instances = [];
  const orphans = [];
  const evidence = [];
  const byDefKey = new Map(); // defId → definition record

  // Pass 1: definitions (COMPONENT nodes)
  for (const node of nodes) {
    if (upperType(node) !== 'COMPONENT') continue;
    const defId = defIdFromNode(node);
    if (!defId) continue;
    const def = {
      defId,
      sourceNodeId: node.sourceNodeId || null,
      nodeId: node.id,
      name: node.name || null,
      variantAxes: variantAxesFrom(node),
    };
    definitions.push(def);
    byDefKey.set(defId, def);
    byDefKey.set(node.id, def);
    if (node.sourceNodeId) byDefKey.set(String(node.sourceNodeId), def);
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_SIGNAL,
      detail: { nodeId: node.id, role: 'definition', defId },
    });
  }

  // Pass 2: instances
  for (const node of nodes) {
    if (upperType(node) !== 'INSTANCE') continue;
    const ref = instanceDefRef(node);
    const overrides = overrideKeysFrom(node);
    const overrideEntries = overrideEntriesFrom(node);
    const variant = variantFromInstance(node);
    const layoutMode = layoutModeFor(node.id, opts.layoutIr);

    let resolved = null;
    if (ref) {
      resolved = byDefKey.get(ref)
        || byDefKey.get(`def:${ref}`)
        || [...byDefKey.values()].find((d) => d.sourceNodeId === ref || d.nodeId === ref || d.defId === ref);
    }

    if (!resolved) {
      orphans.push({
        nodeId: node.id,
        reason: ref ? 'unresolved_def' : 'missing_def_ref',
        ref: ref || null,
      });
      evidence.push({
        kind: 'other',
        ref: EVIDENCE_ORPHAN,
        detail: { nodeId: node.id, reason: ref ? 'unresolved_def' : 'missing_def_ref', ref },
      });
      continue;
    }

    const inst = {
      nodeId: node.id,
      sourceNodeId: node.sourceNodeId || null,
      defId: resolved.defId,
      variant,
      overrideKeys: overrides,
      overrideEntries,
      layoutMode,
      treatment: 'keep', // default; Decision may set flatten
    };
    instances.push(inst);
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_INSTANCE,
      detail: {
        nodeId: node.id,
        defId: resolved.defId,
        variant,
        layoutMode,
      },
    });
    if (overrides.length) {
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_OVERRIDE,
        detail: { nodeId: node.id, defId: resolved.defId, overrideKeys: overrides },
      });
    }
  }

  if (opts.layoutDegraded) {
    evidence.push({
      kind: 'other',
      ref: EVIDENCE_DEGRADED,
      detail: { reason: 'layout_ir_missing', graphId: graph.graphId },
    });
  }

  // Apply committed Decisions for instanceTreatment
  const decisions = opts.decisions || [];
  const flattenPlan = [];
  for (const d of decisions) {
    if (!d || d.question !== 'component.instanceTreatment') continue;
    const st = d.status;
    if (st !== 'arbitrated' && st !== 'fallen-back' && st !== 'overridden') continue;
    let answer = null;
    const w = d.winner;
    if (w && w.kind === 'candidate' && Array.isArray(d.candidates)) {
      const cand = d.candidates.find((c) => c.candidateId === w.candidateId);
      answer = cand && cand.answer;
    } else if (w && w.answer) {
      answer = w.answer;
    }
    if (!answer || !answer.treatment) continue;
    const subject = d.subject;
    const inst = instances.find((i) => i.nodeId === subject);
    if (!inst) continue;
    inst.treatment = answer.treatment;
    inst.decisionIds = [d.decisionId || d.id].filter(Boolean);
    if (answer.treatment === 'flatten') {
      flattenPlan.push({
        nodeId: inst.nodeId,
        defId: inst.defId,
        decisionId: d.decisionId || d.id || null,
      });
    }
  }

  // Phase 2 — card/banner/divider shape recognition (additive; consumes
  // Phase 1's geometry candidates for divider assignment when supplied via
  // opts.geometryCandidatesByNode, degrades gracefully to "no divider facts"
  // when they aren't — never a hard dependency on the geometry stage).
  //
  // docs/COMPILER_REDESIGN_ROADMAP.md Phase 3 — `opts.componentGeometryDetected`
  // lets a caller that already computed detectComponentGeometry() (e.g.
  // ir-experimental-renderer.js, which needs the same result for its own
  // cardByNodeId/bannerByNodeId maps) pass it through directly instead of
  // this function recomputing it a second time per render pass with a
  // DIFFERENT (often empty) geometryCandidatesByNode — a real, confirmed
  // duplicate-computation bug caught while wiring Phase 2.5/3's Skeleton
  // integration: the render path's own call already threads real geometry
  // candidates through; a second, independent call with no candidates would
  // silently degrade divider-fact detection for no reason.
  const geo = opts.componentGeometryDetected || detectComponentGeometry(graph, {
    geometryCandidatesByNode: opts.geometryCandidatesByNode || {},
  });
  for (const card of geo.cardFacts) {
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_CARD_SHAPE,
      detail: {
        nodeId: card.nodeId,
        shape: card.shape,
        chromeId: card.chromeId,
        contentIds: card.contentIds,
        padding: card.padding,
        paddingNormalized: card.paddingNormalized,
      },
    });
  }
  for (const grid of geo.cardGridFacts) {
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_CARD_GRID,
      detail: { nodeId: grid.nodeId, orderedChildIds: grid.orderedChildIds, gap: grid.gap },
    });
  }
  for (const banner of geo.bannerFacts) {
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_BANNER_SHAPE,
      detail: { nodeId: banner.nodeId, chromeId: banner.chromeId, contentIds: banner.contentIds, padding: banner.padding },
    });
  }
  for (const divider of geo.dividerFacts) {
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_DIVIDER_SHAPE,
      detail: { nodeId: divider.nodeId, parentId: divider.parentId, afterColumnIndex: divider.afterColumnIndex },
    });
  }
  for (const rowSet of geo.rowSetFacts) {
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_ROW_SET,
      detail: {
        nodeId: rowSet.nodeId,
        orderedChildIds: rowSet.orderedChildIds,
        gap: rowSet.gap,
        columns: rowSet.columns,
      },
    });
  }

  definitions.sort((a, b) => (a.defId < b.defId ? -1 : 1));
  instances.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  orphans.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  flattenPlan.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  evidence.sort((a, b) => {
    const ka = `${a.ref}:${(a.detail && a.detail.nodeId) || ''}`;
    const kb = `${b.ref}:${(b.detail && b.detail.nodeId) || ''}`;
    return ka < kb ? -1 : 1;
  });

  // docs/COMPILER_REDESIGN_ROADMAP.md Phase 2.5 — the "claimed by Component
  // Recognition" fact: every node whose identity comes from a real,
  // DECLARED Figma component/instance relationship (componentId/
  // mainComponentId/variantProperties), as opposed to a GEOMETRIC guess
  // (cardPatterns/cardGridPatterns/bannerPatterns/dividerPatterns/
  // rowSetPatterns below, deliberately excluded from this set). Skeleton's
  // own geometric clustering (Phase 3) should treat membership here as
  // higher-precedence and skip re-clustering these nodes — the same
  // "declared beats inferred" rule already established for layout mode
  // (Research Part 7.5.4), now enforced as an actual data boundary between
  // the two recognition mechanisms instead of an unenforced convention two
  // separately-maintained systems happen not to collide on today.
  const claimedNodeIds = [...new Set([
    ...definitions.map((d) => d.nodeId),
    ...instances.map((i) => i.nodeId),
  ])].sort();

  return {
    definitions,
    instances,
    orphans,
    flattenPlan,
    evidence,
    layoutDegraded: opts.layoutDegraded === true,
    claimedNodeIds,
    cardPatterns: geo.cardFacts,
    cardGridPatterns: geo.cardGridFacts,
    bannerPatterns: geo.bannerFacts,
    dividerPatterns: geo.dividerFacts,
    rowSetPatterns: geo.rowSetFacts,
  };
}

module.exports = {
  detectComponents,
  defIdFromNode,
  instanceDefRef,
  overrideKeysFrom,
  overrideEntriesFrom,
};
