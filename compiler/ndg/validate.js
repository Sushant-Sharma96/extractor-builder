'use strict';

/**
 * Structural validation of a NormalizedDesignGraph.
 */

const { edgeKey } = require('./ids');

function validateGraph(graph, opts = {}) {
  const errors = [];
  const warnings = [];

  if (!graph || graph.contractId !== 'NormalizedDesignGraph') {
    errors.push({ code: 'bad_contract', message: 'contractId must be NormalizedDesignGraph' });
  }
  if (!graph || !graph.graphId) {
    errors.push({ code: 'missing_graphId', message: 'graphId required' });
  }

  const nodes = (graph && graph.nodes) || [];
  const edges = (graph && graph.edges) || [];
  const byId = new Map();

  for (const n of nodes) {
    if (!n || !n.id) {
      errors.push({ code: 'node_missing_id', message: 'node missing id' });
      continue;
    }
    if (byId.has(n.id)) {
      errors.push({ code: 'duplicate_id', message: `duplicate node id ${n.id}`, nodeId: n.id });
    }
    byId.set(n.id, n);
    if (n.box) {
      const { width, height } = n.box;
      if (width != null && width < 0) {
        errors.push({ code: 'invalid_geometry', message: `negative width on ${n.id}`, nodeId: n.id });
      }
      if (height != null && height < 0) {
        errors.push({ code: 'invalid_geometry', message: `negative height on ${n.id}`, nodeId: n.id });
      }
    }
  }

  const parentOf = new Map(); // child -> parent
  const childrenOf = new Map(); // parent -> [{to,index}]

  for (const e of edges) {
    if (!e || !e.from || !e.to || !e.kind) {
      errors.push({ code: 'bad_edge', message: 'edge missing from/to/kind' });
      continue;
    }
    if (!byId.has(e.from) || !byId.has(e.to)) {
      errors.push({
        code: 'broken_reference',
        message: `edge ${e.kind} ${e.from}->${e.to} references missing node`,
      });
      continue;
    }
    if (e.kind === 'parent') {
      if (parentOf.has(e.to)) {
        errors.push({
          code: 'multiple_parents',
          message: `node ${e.to} has multiple parents`,
          nodeId: e.to,
        });
      }
      parentOf.set(e.to, e.from);
      if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
      childrenOf.get(e.from).push({ to: e.to, index: e.index });
    }
  }

  // Ordering consistency on parent edges
  for (const [parent, kids] of childrenOf.entries()) {
    const sorted = [...kids].sort((a, b) => (a.index || 0) - (b.index || 0));
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i].index != null && sorted[i].index !== i) {
        warnings.push({
          code: 'ordering_gap',
          message: `parent ${parent} child index gap at ${sorted[i].to}`,
          nodeId: parent,
        });
        break;
      }
    }
  }

  // Roots / orphans
  const roots = opts.roots || nodes.filter((n) => !parentOf.has(n.id)).map((n) => n.id);
  for (const n of nodes) {
    if (!parentOf.has(n.id) && !roots.includes(n.id)) {
      errors.push({ code: 'orphan', message: `orphan node ${n.id}`, nodeId: n.id });
    }
  }

  // Cycle via parent links
  const visiting = new Set();
  const visited = new Set();
  function dfs(id) {
    if (visiting.has(id)) {
      errors.push({ code: 'cycle', message: `cycle at ${id}`, nodeId: id });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const p = parentOf.get(id);
    if (p) dfs(p);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) dfs(id);

  // Disconnected: every node reachable from some root via children
  if (roots.length && nodes.length) {
    const reachable = new Set();
    const queue = [...roots];
    while (queue.length) {
      const id = queue.shift();
      if (reachable.has(id)) continue;
      reachable.add(id);
      const kids = childrenOf.get(id) || [];
      for (const k of kids) queue.push(k.to);
    }
    for (const n of nodes) {
      if (!reachable.has(n.id)) {
        errors.push({
          code: 'disconnected',
          message: `node ${n.id} not reachable from roots`,
          nodeId: n.id,
        });
      }
    }
  }

  if (Array.isArray(opts.edgeIds) && opts.edgeIds.length) {
    const expected = new Set(opts.edgeIds);
    for (const e of edges) {
      const k = edgeKey(e.kind, e.from, e.to, e.index);
      if (!expected.has(k)) {
        errors.push({ code: 'edge_id_mismatch', message: `missing edge id ${k}` });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    rootCount: roots.length,
    roots,
  };
}

module.exports = { validateGraph };
