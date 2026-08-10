'use strict';
// One-off diagnostic (not part of the compiler): traces the exact horizontal
// offset for Challenge Arena row 1's image (1:333) and title/description
// wrapper (1:334) through every real pipeline stage, printing actual values
// only (no inference). Deleted after use.

const { prepareFigmaSources } = require('../server/scalability/index.js');
const { materializeNormalizedDesignGraph } = require('../compiler/ndg');
const { createWorkspace } = require('../compiler/workspace');
const { indexGraph } = require('../compiler/layout/collect');
const { interpretGraph } = require('../compiler/layout/interpret');
const { detectGeometry } = require('../compiler/geometry');
const { detectComponentGeometry } = require('../compiler/rulepack/packs/component-detect/geometry-rules');
const { detectFreeformLayout } = require('../compiler/freeform-layout');
const { renderIrExperimental } = require('../compiler/artifacts/ir-experimental-renderer');

const TARGETS = ['1:333', '1:334']; // image, title/desc wrapper
const PARENT = '1:332'; // Frame 1171277998

async function main() {
  const prepared = await prepareFigmaSources({
    fileKey: 'c0kt3mp76RoEiq3CFoeCHa',
    nodeId: '1:4',
    url: 'https://www.figma.com/design/c0kt3mp76RoEiq3CFoeCHa/Untitled?node-id=1-4',
    refresh: false,
    restCounter: { n: 0 },
    t0: Date.now(),
    userKey: 'local',
    force: false,
    requestId: 'trace-row1',
  });

  // ---- Stage 1: Figma raw ----
  function findRaw(node, id) {
    if (node.id === id) return node;
    for (const c of node.children || []) {
      const r = findRaw(c, id);
      if (r) return r;
    }
    return null;
  }
  console.log('\n=== STAGE 1: Figma raw (document.json) ===');
  for (const id of [PARENT, ...TARGETS]) {
    const n = findRaw(prepared.document, id);
    const b = n.absoluteBoundingBox || {};
    console.log(id, JSON.stringify({
      name: n.name, type: n.type,
      x: b.x, y: b.y, width: b.width, height: b.height,
      layoutMode: n.layoutMode || null,
    }));
  }

  // ---- Stage 2: NDG ----
  const ws = createWorkspace();
  const ndg = await materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    document: prepared.document,
    graphId: 'g:trace:row1',
  });
  const graph = ndg.graph;
  console.log('\nsample NDG node keys:', JSON.stringify(Object.keys(graph.nodes[0] || {})));
  console.log('sample NDG node:', JSON.stringify(graph.nodes[0], null, 2).slice(0, 500));
  // Figure out which field on an NDG node carries the original Figma id.
  const bySourceId = new Map();
  for (const n of graph.nodes) {
    const sid = n.sourceNodeId || n.sourceId || n.figmaId || n.rawId || n.id;
    bySourceId.set(sid, n);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const index = indexGraph(graph);
  function parentOf(graphId) {
    for (const [p, kids] of index.childrenOf.entries()) {
      if ((kids || []).some((k) => (k.id || k) === graphId)) return p;
    }
    return null;
  }
  console.log('\n=== STAGE 2: NDG (compiler/ndg) ===');
  for (const id of [PARENT, ...TARGETS]) {
    const n = bySourceId.get(id);
    if (!n) { console.log(id, 'NOT IN NDG (by sourceNodeId)'); continue; }
    const parentGraphId = parentOf(n.id);
    const parentNode = parentGraphId ? byId.get(parentGraphId) : null;
    console.log(id, JSON.stringify({
      ndgId: n.id,
      parentGraphId,
      parentSourceId: parentNode && (parentNode.sourceNodeId || parentNode.sourceId || parentNode.id),
      x: n.box && n.box.x, y: n.box && n.box.y,
      width: n.box && n.box.width, height: n.box && n.box.height,
      layoutMode: n.attributes && n.attributes.layoutMode,
    }));
  }

  // ---- Stage 3a: interpretGraph mode decision (per user's follow-up ask) ----
  const detectedGeometry0 = detectGeometry(graph, {});
  const interpretations0 = interpretGraph(graph, index, {
    recognitionHintsByNode: detectedGeometry0.recognitionHintsByNode,
  });
  console.log('\n=== STAGE 3a: interpretGraph — mode decision detail ===');
  for (const id of [PARENT, ...TARGETS]) {
    const n = bySourceId.get(id);
    const interp = interpretations0.find((i) => i.nodeId === n.id);
    console.log(id, JSON.stringify({
      recognitionHints: (detectedGeometry0.recognitionHintsByNode || {})[n.id] || [],
      modeCandidates: interp.modeCandidates,
      evidence: interp.evidence,
    }, null, 2));
  }

  // ---- Stage 3: Freeform Layout IR ----
  const detectedGeometry = detectGeometry(graph, {});
  const geometryCandidatesByNode = {};
  for (const c of detectedGeometry.candidates || []) geometryCandidatesByNode[c.nodeId] = c;
  const detectedComponent = detectComponentGeometry(graph, { geometryCandidatesByNode });
  const detectedFreeform = detectFreeformLayout(graph, { componentDetected: detectedComponent });
  console.log('\n=== STAGE 3: Freeform Layout IR (compiler/freeform-layout) ===');
  console.log('groups found:', (detectedFreeform.groups || []).length);
  let foundInFreeform = false;
  for (const g of detectedFreeform.groups || []) {
    const touchesTarget = g.containerNodeId === PARENT
      || (g.members || []).some((m) => m.nodeId === PARENT
        || Object.values(m.memberColumnMap || {}).some((v) => TARGETS.includes(v)));
    if (touchesTarget) {
      foundInFreeform = true;
      console.log('group containerNodeId:', g.containerNodeId, 'axis:', g.axis);
      for (const m of g.members || []) {
        console.log('  member', m.nodeId, 'memberColumnMap:', JSON.stringify(m.memberColumnMap));
      }
    }
  }
  if (!foundInFreeform) console.log('(neither', PARENT, 'nor', TARGETS.join(','), 'appear in any freeform-layout-ir group)');

  // ---- Stage 4: RenderNode (layoutChoice) + Stage 5: Final CSS ----
  const rendered = await renderIrExperimental(prepared.document, {
    graphId: 'g:trace:row1:render',
    title: 'trace',
    imageUrls: prepared.imageUrls || {},
    imageFillUrls: prepared.imageFillUrls || {},
  });
  console.log('\n=== STAGE 4+5: RenderNode / Final CSS (rendered html+css) ===');
  const { html, css } = rendered;
  for (const id of [PARENT, ...TARGETS]) {
    // find the element whose data-node-id (if present) or class corresponds; fall back to matching by known class names
    const classGuess = { '1:332': 'frame-1171277998', '1:333': 'rectangle-34624593', '1:334': 'group-1171278050' }[id];
    const re = new RegExp(`\\.${classGuess.replace(/[^a-z0-9-]/gi, '\\$&')}\\s*\\{([^}]*)\\}`, 'i');
    const m = css.match(re);
    console.log(id, classGuess, '=>', m ? m[1].trim().replace(/\s+/g, ' ') : '(no CSS rule found)');
  }
}

main().catch((e) => { console.error('ERR', e.stack); process.exit(1); });
