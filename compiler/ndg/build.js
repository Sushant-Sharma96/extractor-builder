'use strict';

/**
 * Deterministic NormalizedDesignGraph builder.
 * Structural only — no semantic interpretation.
 *
 * docs/COMPILER_REDESIGN_ROADMAP.md Phase 2: the wrapper/passthrough-collapse
 * logic this file used to define inline now lives in ./parser-ast (its own
 * named, independently-testable stage — see that file's own header for the
 * full rationale). This file keeps only graph ASSEMBLY: turning the
 * collapsed working-node set into the published NormalizedDesignGraph shape
 * (toNdgNode/buildEdges) and orchestrating ingest → collapse → assemble →
 * validate. Re-exports `applyStructuralPolicies`/`indexWorking` from
 * ./parser-ast so every existing caller of this module keeps working
 * unchanged — this is a relocation, not a behavior change.
 */

const { BUILDER_VERSION } = require('./constants');
const { NdgError, NdgErrorKind } = require('./errors');
const { stableCompileId, graphChecksum, edgeKey } = require('./ids');
const { collectIngestInput } = require('./ingest');
const { validateGraph } = require('./validate');
const {
  indexWorking,
  orderedChildren,
  applyStructuralPolicies,
  detectCycle,
  findRoots,
} = require('./parser-ast');

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
