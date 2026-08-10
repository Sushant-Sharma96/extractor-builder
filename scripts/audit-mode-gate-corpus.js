'use strict';
// One-off diagnostic (not part of the compiler). For each fixture, finds every
// node whose top-scored interpretGraph mode is flow-row/flow-column/grid-track
// (i.e. currently EXEMPT from the ir-experimental-renderer.js absolute-
// positioning gate at line ~459-461), and classifies whether replacing that
// gate with a parent-layoutMode-aware check would change its behavior:
//   - parent has real Figma Auto Layout (layoutMode HORIZONTAL/VERTICAL)
//       -> UNCHANGED (flex from parent is legitimate; no absolute offset added)
//   - parent has NO Auto Layout (freeform; layoutMode null)
//       -> WOULD GAIN an absolute offset (this is the class of bug being fixed)
// Deleted after use.

const { prepareFigmaSources } = require('../server/scalability/index.js');
const { materializeNormalizedDesignGraph } = require('../compiler/ndg');
const { createWorkspace } = require('../compiler/workspace');
const { indexGraph } = require('../compiler/layout/collect');
const { interpretGraph } = require('../compiler/layout/interpret');
const { detectGeometry } = require('../compiler/geometry');

const FIXTURES = [
  { label: 'Challenge Arena', fileKey: 'c0kt3mp76RoEiq3CFoeCHa', nodeId: '1:4' },
  { label: 'Articles', fileKey: 'c0kt3mp76RoEiq3CFoeCHa', nodeId: '1:848' },
  { label: 'IBM (full page)', fileKey: 'c0kt3mp76RoEiq3CFoeCHa', nodeId: '1:2' },
];

async function auditOne({ label, fileKey, nodeId }) {
  const prepared = await prepareFigmaSources({
    fileKey, nodeId,
    url: `https://www.figma.com/design/${fileKey}/Untitled?node-id=${nodeId.replace(':', '-')}`,
    refresh: false, restCounter: { n: 0 }, t0: Date.now(), userKey: 'local', force: false,
    requestId: `audit-${nodeId}`,
  });
  const ws = createWorkspace();
  const ndg = await materializeNormalizedDesignGraph({
    workspace: ws, policy: { profileId: 'pixel-faithful' }, document: prepared.document, graphId: `g:audit:${nodeId}`,
  });
  const graph = ndg.graph;
  const index = indexGraph(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  function parentOf(id) {
    return index.parentOf.get(id) || null;
  }
  const detectedGeometry = detectGeometry(graph, {});
  const interpretations = interpretGraph(graph, index, {
    recognitionHintsByNode: detectedGeometry.recognitionHintsByNode,
  });

  let flowModeCount = 0;
  let unaffected = 0; // parent has real Auto Layout
  let wouldGainAbsolute = 0; // parent has no Auto Layout (freeform) -> behavior changes
  const changedSamples = [];
  const unaffectedSamples = [];

  for (const interp of interpretations) {
    const top = interp.modeCandidates[0] && interp.modeCandidates[0].mode;
    if (top !== 'flow-row' && top !== 'flow-column' && top !== 'grid-track') continue;
    flowModeCount += 1;
    const node = byId.get(interp.nodeId);
    const parentId = parentOf(interp.nodeId);
    const parentNode = parentId ? byId.get(parentId) : null;
    const parentLayoutMode = parentNode && parentNode.attributes && parentNode.attributes.layoutMode;
    const nodeOwnLayoutMode = node && node.attributes && node.attributes.layoutMode;
    if (parentLayoutMode) {
      unaffected += 1;
      if (unaffectedSamples.length < 3) {
        unaffectedSamples.push({
          nodeId: interp.nodeId, sourceNodeId: node.sourceNodeId, name: node.name,
          topMode: top, nodeOwnLayoutMode, parentSourceId: parentNode.sourceNodeId,
          parentLayoutMode,
        });
      }
    } else {
      wouldGainAbsolute += 1;
      if (changedSamples.length < 8) {
        changedSamples.push({
          nodeId: interp.nodeId, sourceNodeId: node.sourceNodeId, name: node.name,
          topMode: top, nodeOwnLayoutMode,
          parentSourceId: parentNode ? parentNode.sourceNodeId : null,
          parentLayoutMode: parentLayoutMode || null,
          isRoot: !parentId,
        });
      }
    }
  }

  console.log(`\n=== ${label} (${fileKey} ${nodeId}) ===`);
  console.log('total nodes:', graph.nodes.length);
  console.log('nodes with top mode in {flow-row,flow-column,grid-track}:', flowModeCount);
  console.log('  -> parent HAS real Auto Layout (UNCHANGED under new gate):', unaffected);
  console.log('  -> parent has NO Auto Layout / freeform (WOULD GAIN absolute offset):', wouldGainAbsolute);
  console.log('sample UNCHANGED nodes:', JSON.stringify(unaffectedSamples, null, 2));
  console.log('sample CHANGED nodes:', JSON.stringify(changedSamples, null, 2));
}

async function main() {
  for (const f of FIXTURES) {
    // eslint-disable-next-line no-await-in-loop
    await auditOne(f);
  }
}

main().catch((e) => { console.error('ERR', e.stack); process.exit(1); });
