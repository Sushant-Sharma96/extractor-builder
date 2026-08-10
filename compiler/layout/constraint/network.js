'use strict';

/**
 * Build internal ConstraintNetwork from NDG + LayoutIR₀.
 * Never published as an IR stage.
 */

const { STRENGTH, CONSTRAINT_KINDS } = require('./constants');
const { indexGraph } = require('../collect');
const { LayoutError, LayoutErrorKind } = require('../errors');

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function boxOf(ndgNode) {
  return ndgNode && ndgNode.box ? ndgNode.box : null;
}

function layoutNodeMap(layoutIr) {
  const m = new Map();
  const nodes = (layoutIr && layoutIr.payload && layoutIr.payload.nodes) || [];
  for (const n of nodes) m.set(n.nodeId, n);
  return m;
}

/**
 * @param {object} graph — NormalizedDesignGraph
 * @param {object} layoutIr — LayoutIR₀ slice (with payload)
 * @param {{ decisions?: object[] }} [opts]
 */
function buildConstraintNetwork(graph, layoutIr, opts = {}) {
  if (!graph || !graph.graphId) {
    throw new LayoutError(LayoutErrorKind.INVALID_INPUT, 'NDG required for constraint network');
  }
  if (!layoutIr || !layoutIr.payload || !layoutIr.sliceId) {
    throw new LayoutError(LayoutErrorKind.INVALID_INPUT, 'LayoutIR₀ required for constraint network');
  }

  const index = indexGraph(graph);
  const byId = index.byId;
  const lir = layoutNodeMap(layoutIr);
  const variables = [];
  const constraints = [];

  for (const node of [...(graph.nodes || [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const box = boxOf(node);
    variables.push({
      id: `var:${node.id}:w`,
      nodeId: node.id,
      axis: 'width',
      value: box ? num(box.width) : null,
    });
    variables.push({
      id: `var:${node.id}:h`,
      nodeId: node.id,
      axis: 'height',
      value: box ? num(box.height) : null,
    });
    variables.push({
      id: `var:${node.id}:x`,
      nodeId: node.id,
      axis: 'x',
      value: box ? num(box.x) : null,
    });
    variables.push({
      id: `var:${node.id}:y`,
      nodeId: node.id,
      axis: 'y',
      value: box ? num(box.y) : null,
    });

    const ln = lir.get(node.id);
    const gap = ln && ln.gap != null ? num(ln.gap) : num(node.attributes && node.attributes.itemSpacing);
    const pad = (ln && ln.padding) || {};
    const attrs = node.attributes || {};

    // gap_nonneg
    if (gap != null) {
      constraints.push({
        id: `c:gap:${node.id}`,
        kind: 'gap_nonneg',
        nodes: [node.id],
        strength: STRENGTH.WEAK,
        source: 'layout.gap',
        meta: { gap },
      });
    }

    // padding_nonneg
    const pads = [
      pad.top != null ? pad.top : attrs.paddingTop,
      pad.right != null ? pad.right : attrs.paddingRight,
      pad.bottom != null ? pad.bottom : attrs.paddingBottom,
      pad.left != null ? pad.left : attrs.paddingLeft,
    ].map(num);
    if (pads.some((p) => p != null)) {
      constraints.push({
        id: `c:pad:${node.id}`,
        kind: 'padding_nonneg',
        nodes: [node.id],
        strength: STRENGTH.WEAK,
        source: 'layout.padding',
        meta: { pads },
      });
    }

    const kids = (index.childrenOf.get(node.id) || []).map((k) => k.id);
    const inFlow = ln && Array.isArray(ln.childOrder) ? ln.childOrder : kids;
    const outOfFlow = new Set((ln && ln.outOfFlow) || []);
    const flowKids = inFlow.filter((id) => !outOfFlow.has(id) && byId.has(id));
    const mode = ln ? ln.mode : 'unknown';

    if (flowKids.length && (mode === 'flow-row' || mode === 'flow-column' || mode === 'grid-track')) {
      constraints.push({
        id: `c:fit:${node.id}`,
        kind: 'parent_fit',
        nodes: [node.id, ...flowKids],
        strength: STRENGTH.STRONG,
        source: 'layout.mode',
        meta: {
          mode,
          axis: mode === 'flow-column' ? 'vertical' : 'horizontal',
          gap: gap || 0,
          childIds: flowKids,
        },
      });
      constraints.push({
        id: `c:overflow:${node.id}`,
        kind: 'overflow',
        nodes: [node.id, ...flowKids],
        strength: STRENGTH.MEDIUM,
        source: 'geometry',
        meta: {
          mode,
          axis: mode === 'flow-column' ? 'vertical' : 'horizontal',
          gap: gap || 0,
          childIds: flowKids,
        },
      });
    }

    // sizing_axis from layout IR hints vs box
    if (ln && ln.sizing) {
      constraints.push({
        id: `c:sizing:${node.id}`,
        kind: 'sizing_axis',
        nodes: [node.id],
        strength: STRENGTH.MEDIUM,
        source: 'layout.sizing',
        meta: { sizing: ln.sizing, box },
      });
    }

    // absolute children should have positioning absolute in LayoutIR
    for (const cid of outOfFlow) {
      if (!byId.has(cid)) continue;
      constraints.push({
        id: `c:abs:${node.id}:${cid}`,
        kind: 'absolute_bounds',
        nodes: [node.id, cid],
        strength: STRENGTH.STRONG,
        source: 'layout.outOfFlow',
        meta: { parentId: node.id, childId: cid },
      });
    }
  }

  variables.sort((a, b) => (a.id < b.id ? -1 : 1));
  constraints.sort((a, b) => (a.id < b.id ? -1 : 1));

  return Object.freeze({
    graphId: graph.graphId,
    layoutIrSliceId: layoutIr.sliceId,
    layoutIrChecksum: layoutIr.checksum || null,
    variables: Object.freeze(variables.map((v) => Object.freeze({ ...v }))),
    constraints: Object.freeze(constraints.map((c) => Object.freeze({
      ...c,
      nodes: Object.freeze([...c.nodes]),
      meta: Object.freeze({ ...(c.meta || {}) }),
    }))),
    kinds: CONSTRAINT_KINDS,
  });
}

module.exports = { buildConstraintNetwork, layoutNodeMap, boxOf, num };
