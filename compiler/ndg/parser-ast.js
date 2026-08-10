'use strict';

/**
 * Parser AST — docs/COMPILER_REDESIGN_ROADMAP.md Phase 2 / Section 1.5.1.
 *
 * Structural normalization ONLY: wrapper/passthrough collapse, parent-child
 * re-linking, cycle/root resolution. No role or semantic judgment lives
 * here — deciding "is this node a card, is it decorative" is Skeleton's job
 * (compiler/skeleton), one stage later. The distinction matters: unlike a
 * real programming-language parser, this stage cannot fully separate
 * "structure" from "meaning" the way a lexer/parser can for unambiguous
 * source text (Figma's own tree shape is not semantically unambiguous —
 * see docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md Part 2) — so this
 * module's scope is deliberately narrow: only collapse/re-link decisions
 * that require no judgment about what a node REPRESENTS, only whether it
 * carries its own visual signal.
 *
 * Relocated verbatim from compiler/ndg/build.js (previously bundled
 * alongside raw ingest under one "NDG" name) — this is a pure move, not a
 * behavior change; see this file's own test suite for the byte-identical
 * proof.
 */

const { EVIDENCE_DROPPED_INVISIBLE, EVIDENCE_DROPPED_EMPTY, EVIDENCE_COLLAPSED } = require('./constants');
const { NdgError, NdgErrorKind } = require('./errors');

/**
 * Whether a wrapper node has any visual meaning of its own — gates whether
 * it's safe to delete/collapse it (see applyStructuralPolicies' Pass 2/3
 * below). Checks paints/strokes/effects/cornerRadius/rectangleCornerRadii/
 * opacity/rotation/isMask — a single-child wrapper carrying ONLY a
 * non-default opacity, rotation, or per-corner radius (no fill/stroke/
 * effect/uniform-radius of its own) must NOT be judged "no paint signal"
 * and deleted outright — not misplaced, permanently discarded, wrapper and
 * all. `isMask` is included for the same reason: a mask's own box/paint can
 * look trivial while the clipping relationship it defines with its
 * siblings is not.
 */
function hasPaintSignal(wn) {
  const g = wn.geometry;
  return (wn.paints && wn.paints.length > 0)
    || (wn.strokes && wn.strokes.length > 0)
    || (wn.effects && wn.effects.length > 0)
    || (g && g.cornerRadius != null)
    || (g && Array.isArray(g.rectangleCornerRadii) && g.rectangleCornerRadii.some((r) => r))
    || (g && g.opacity != null && g.opacity !== 1)
    || (g && g.rotation != null && g.rotation !== 0)
    || (g && g.isMask === true);
}

function hasText(wn) {
  return !!(wn.attributes && wn.attributes.characters);
}

function isWrapperType(type) {
  const t = String(type || '').toUpperCase();
  return t === 'FRAME' || t === 'GROUP' || t === 'COMPONENT' || t === 'INSTANCE';
}

/**
 * Build adjacency from working nodes; repair missing parent from children lists.
 */
function indexWorking(nodes) {
  const bySource = new Map();
  for (const n of nodes) {
    if (bySource.has(n.sourceNodeId)) {
      throw new NdgError(
        NdgErrorKind.DUPLICATE_ID,
        `duplicate sourceNodeId: ${n.sourceNodeId}`,
        { sourceNodeId: n.sourceNodeId }
      );
    }
    bySource.set(n.sourceNodeId, { ...n, childSourceIds: [...(n.childSourceIds || [])] });
  }
  for (const n of bySource.values()) {
    for (const cid of n.childSourceIds) {
      const child = bySource.get(cid);
      if (child && child.parentSourceId == null) child.parentSourceId = n.sourceNodeId;
    }
  }
  return bySource;
}

function orderedChildren(bySource, parentId) {
  const parent = bySource.get(parentId);
  if (!parent) return [];
  return parent.childSourceIds.filter((id) => bySource.has(id));
}

function reparentChildren(bySource, droppedId, grandparentId) {
  const dropped = bySource.get(droppedId);
  if (!dropped) return;
  const kids = [...dropped.childSourceIds];
  for (const kid of kids) {
    const child = bySource.get(kid);
    if (child) child.parentSourceId = grandparentId;
  }
  if (grandparentId && bySource.has(grandparentId)) {
    const gp = bySource.get(grandparentId);
    const idx = gp.childSourceIds.indexOf(droppedId);
    const next = [...gp.childSourceIds];
    if (idx >= 0) {
      next.splice(idx, 1, ...kids);
    } else {
      next.push(...kids);
    }
    gp.childSourceIds = next;
  } else {
    // dropped was root-ish: children become roots
    for (const kid of kids) {
      const child = bySource.get(kid);
      if (child) child.parentSourceId = null;
    }
  }
  bySource.delete(droppedId);
}

function collapseReplace(bySource, wrapperId, childId) {
  const wrapper = bySource.get(wrapperId);
  const child = bySource.get(childId);
  if (!wrapper || !child) return;
  const gp = wrapper.parentSourceId;
  child.parentSourceId = gp;
  if (gp && bySource.has(gp)) {
    const parent = bySource.get(gp);
    parent.childSourceIds = parent.childSourceIds.map((id) => (id === wrapperId ? childId : id));
  }
  bySource.delete(wrapperId);
}

/**
 * Apply visibility / empty / passthrough policies. Mutates map; returns event log.
 */
function applyStructuralPolicies(bySource) {
  const events = [];

  // Pass 1: invisible — drop and reparent
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...bySource.keys()].sort()) {
      const n = bySource.get(id);
      if (!n || n.visible !== false) continue;
      events.push({
        type: 'dropped',
        reason: EVIDENCE_DROPPED_INVISIBLE,
        sourceNodeId: id,
        parentSourceId: n.parentSourceId,
        childSourceIds: [...n.childSourceIds],
      });
      reparentChildren(bySource, id, n.parentSourceId);
      changed = true;
      break;
    }
  }

  // Pass 2: empty leaf wrappers
  changed = true;
  while (changed) {
    changed = false;
    for (const id of [...bySource.keys()].sort()) {
      const n = bySource.get(id);
      if (!n) continue;
      if (!isWrapperType(n.type)) continue;
      if (n.childSourceIds.length !== 0) continue;
      if (hasPaintSignal(n) || hasText(n)) continue;
      events.push({
        type: 'dropped',
        reason: EVIDENCE_DROPPED_EMPTY,
        sourceNodeId: id,
        parentSourceId: n.parentSourceId,
        childSourceIds: [],
      });
      reparentChildren(bySource, id, n.parentSourceId);
      changed = true;
      break;
    }
  }

  // Pass 3: passthrough wrappers (single child, no paint)
  changed = true;
  while (changed) {
    changed = false;
    for (const id of [...bySource.keys()].sort()) {
      const n = bySource.get(id);
      if (!n) continue;
      if (!isWrapperType(n.type)) continue;
      if (n.childSourceIds.length !== 1) continue;
      if (hasPaintSignal(n) || hasText(n)) continue;
      const childId = n.childSourceIds[0];
      if (!bySource.has(childId)) continue;
      events.push({
        type: 'collapsed',
        reason: EVIDENCE_COLLAPSED,
        sourceNodeId: id,
        replacedBy: childId,
        parentSourceId: n.parentSourceId,
      });
      collapseReplace(bySource, id, childId);
      changed = true;
      break;
    }
  }

  return events;
}

function detectCycle(bySource) {
  const visiting = new Set();
  const visited = new Set();

  function dfs(id) {
    if (visiting.has(id)) return id;
    if (visited.has(id)) return null;
    visiting.add(id);
    const n = bySource.get(id);
    if (n && n.parentSourceId && bySource.has(n.parentSourceId)) {
      const hit = dfs(n.parentSourceId);
      if (hit) return hit;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  for (const id of [...bySource.keys()].sort()) {
    const hit = dfs(id);
    if (hit) {
      throw new NdgError(NdgErrorKind.CYCLE, `cycle detected at ${hit}`, { nodeId: hit });
    }
  }
}

function findRoots(bySource) {
  const roots = [];
  for (const n of bySource.values()) {
    if (!n.parentSourceId || !bySource.has(n.parentSourceId)) {
      roots.push(n.sourceNodeId);
    }
  }
  return roots.sort();
}

module.exports = {
  hasPaintSignal,
  hasText,
  isWrapperType,
  indexWorking,
  orderedChildren,
  reparentChildren,
  collapseReplace,
  applyStructuralPolicies,
  detectCycle,
  findRoots,
};
