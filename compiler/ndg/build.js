'use strict';

/**
 * Deterministic NormalizedDesignGraph builder.
 * Structural only — no semantic interpretation.
 */

const {
  BUILDER_VERSION,
  EVIDENCE_DROPPED_INVISIBLE,
  EVIDENCE_DROPPED_EMPTY,
  EVIDENCE_COLLAPSED,
} = require('./constants');
const { NdgError, NdgErrorKind } = require('./errors');
const { stableCompileId, graphChecksum, edgeKey } = require('./ids');
const { collectIngestInput } = require('./ingest');
const { validateGraph } = require('./validate');

/**
 * Whether a wrapper node has any visual meaning of its own — gates whether
 * it's safe to delete/collapse it (see applyStructuralPolicies' Pass 2/3
 * below). Originally checked only paints/strokes/effects/cornerRadius, which
 * meant a single-child wrapper carrying ONLY a non-default opacity, rotation,
 * or per-corner radius (no fill/stroke/effect/uniform-radius of its own) was
 * judged to have "no paint signal" and deleted outright — not misplaced,
 * permanently discarded, wrapper and all. Confirmed as an independent
 * mechanism behind the same "translucent layer renders opaque" bug class
 * documented in docs/HANDOVER_TO_CLAUDE_2026-07-25.md. `isMask` is included
 * for the same reason: a mask's own box/paint can look trivial while the
 * clipping relationship it defines with its siblings is not.
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

function toNdgNode(wn) {
  const id = stableCompileId(wn.sourceNodeId);
  return {
    id,
    sourceNodeId: wn.sourceNodeId,
    visible: wn.visible !== false,
    name: wn.name,
    type: wn.type != null ? String(wn.type).toUpperCase() : null,
    box: wn.box,
    renderBox: wn.renderBox || null,
    paints: Array.isArray(wn.paints) ? wn.paints : [],
    geometry: wn.geometry && typeof wn.geometry === 'object' ? wn.geometry : {},
    attributes: {
      ...(wn.attributes || {}),
      constraints: (wn.attributes && wn.attributes.constraints) || null,
      strokes: wn.strokes || [],
      effects: wn.effects || [],
    },
  };
}

function buildEdges(bySource, idMap) {
  const edges = [];
  const edgeIds = [];

  for (const parentSource of [...bySource.keys()].sort()) {
    const children = orderedChildren(bySource, parentSource);
    const from = idMap.get(parentSource);
    children.forEach((childSource, index) => {
      const to = idMap.get(childSource);
      edges.push({ from, to, kind: 'parent', index });
      edgeIds.push(edgeKey('parent', from, to, index));
      if (index > 0) {
        const prev = idMap.get(children[index - 1]);
        edges.push({ from: prev, to, kind: 'order', index });
        edgeIds.push(edgeKey('order', prev, to, index));
      }
    });
  }

  edges.sort((a, b) => edgeKey(a.kind, a.from, a.to, a.index)
    .localeCompare(edgeKey(b.kind, b.from, b.to, b.index)));
  edgeIds.sort();
  return { edges, edgeIds };
}

/**
 * @param {object} opts — rawDocument | document | facts | workingNodes
 * @returns {{ graph, checksum, events, edgeIds, builderVersion, roots }}
 */
function buildNormalizedDesignGraph(opts = {}) {
  const ingested = collectIngestInput(opts);
  const bySource = indexWorking(ingested.nodes);
  const events = applyStructuralPolicies(bySource);
  detectCycle(bySource);

  const roots = findRoots(bySource);
  if (roots.length === 0 && bySource.size > 0) {
    throw new NdgError(NdgErrorKind.VALIDATION, 'no root nodes after normalization');
  }

  // Orphan check: every non-root must have parent in set
  for (const n of bySource.values()) {
    if (n.parentSourceId && !bySource.has(n.parentSourceId) && !roots.includes(n.sourceNodeId)) {
      // parent missing → treat as root (already in findRoots). OK.
    }
  }

  const idMap = new Map();
  for (const sourceId of [...bySource.keys()].sort()) {
    idMap.set(sourceId, stableCompileId(sourceId));
  }

  const nodes = [...bySource.keys()]
    .sort()
    .map((sid) => toNdgNode(bySource.get(sid)));

  const { edges, edgeIds } = buildEdges(bySource, idMap);

  const rawDocumentId = ingested.rawDocumentId || opts.rawDocumentId || null;
  const pendingChecksum = graphChecksum({
    graphId: 'ndg:pending',
    rawDocumentId,
    nodes,
    edges,
  });
  const graphId = opts.graphId
    || (rawDocumentId ? `ndg:${rawDocumentId}` : `ndg:${pendingChecksum.slice(0, 16)}`);

  const graph = {
    contractId: 'NormalizedDesignGraph',
    suiteVersion: opts.suiteVersion || '1.0.0',
    graphId,
    rawDocumentId,
    nodes,
    edges,
  };

  const checksum = graphChecksum(graph);
  const validation = validateGraph(graph, { edgeIds, roots: roots.map((r) => idMap.get(r)) });

  if (!validation.ok) {
    throw new NdgError(
      NdgErrorKind.VALIDATION,
      `NDG validation failed: ${validation.errors.map((e) => e.code).join(',')}`,
      { validation }
    );
  }

  return {
    graph,
    checksum,
    events,
    edgeIds,
    builderVersion: BUILDER_VERSION,
    roots: roots.map((r) => idMap.get(r)),
    validation,
  };
}

module.exports = {
  buildNormalizedDesignGraph,
  applyStructuralPolicies,
  indexWorking,
  toNdgNode,
};
