'use strict';

/**
 * Load NormalizedDesignGraph from Workspace (IrSlice or Facts).
 * Never rebuilds hierarchy from raw.
 */

const { LayoutError, LayoutErrorKind } = require('./errors');
const { FACT_KIND_NODE, FACT_KIND_GRAPH } = require('../ndg/constants');

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const k of Object.keys(obj)) deepFreeze(obj[k]);
  return obj;
}

function findNdgSlice(workspace) {
  const ids = workspace.listIds('IrSlice');
  for (const id of ids) {
    const slice = workspace.getIrSlice(id);
    if (slice && slice.stageId === 'normalized-design-graph' && slice.graph) {
      return slice;
    }
  }
  return null;
}

function graphFromNdgFacts(workspace) {
  const facts = workspace.listIds('Fact').map((id) => workspace.getFact(id)).filter(Boolean);
  const graphFact = facts.find((f) => f.kind === FACT_KIND_GRAPH);
  const nodeFacts = facts.filter((f) => f.kind === FACT_KIND_NODE);
  if (!graphFact || !nodeFacts.length) return null;

  const nodes = nodeFacts.map((f) => {
    const a = f.assertion || {};
    return {
      id: a.id || f.subject,
      sourceNodeId: a.sourceNodeId || null,
      visible: a.visible !== false,
      name: a.name ?? null,
      type: a.type ?? null,
      box: a.box || null,
      paints: a.paints || [],
      geometry: a.geometry || {},
      attributes: a.attributes || {},
      parentId: a.parentId || null,
      childIds: Array.isArray(a.childIds) ? a.childIds : [],
    };
  });

  const edges = [];
  for (const n of nodes) {
    (n.childIds || []).forEach((cid, index) => {
      edges.push({ from: n.id, to: cid, kind: 'parent', index });
    });
  }

  return {
    contractId: 'NormalizedDesignGraph',
    suiteVersion: graphFact.suiteVersion || '1.0.0',
    graphId: graphFact.subject || graphFact.assertion.graphId,
    rawDocumentId: (graphFact.assertion && graphFact.assertion.rawDocumentId) || null,
    nodes,
    edges,
  };
}

/**
 * @returns {{ graph: object, sliceId: string|null }}
 */
function loadNdgFromWorkspace(workspace) {
  if (!workspace) {
    throw new LayoutError(LayoutErrorKind.MISSING_NDG, 'workspace required');
  }
  const slice = findNdgSlice(workspace);
  if (slice && slice.graph) {
    return { graph: slice.graph, sliceId: slice.sliceId };
  }
  const fromFacts = graphFromNdgFacts(workspace);
  if (fromFacts) {
    return { graph: fromFacts, sliceId: null };
  }
  throw new LayoutError(
    LayoutErrorKind.MISSING_NDG,
    'NormalizedDesignGraph required — materialize NDG before Layout'
  );
}

function indexGraph(graph) {
  const byId = new Map();
  for (const n of graph.nodes || []) byId.set(n.id, n);
  const childrenOf = new Map();
  const parentOf = new Map();
  for (const e of graph.edges || []) {
    if (e.kind !== 'parent') continue;
    parentOf.set(e.to, e.from);
    if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
    childrenOf.get(e.from).push({ id: e.to, index: e.index == null ? 0 : e.index });
  }
  for (const [, kids] of childrenOf) kids.sort((a, b) => a.index - b.index);
  return { byId, childrenOf, parentOf };
}

module.exports = {
  loadNdgFromWorkspace,
  indexGraph,
  findNdgSlice,
  graphFromNdgFacts,
  deepFreeze,
};
