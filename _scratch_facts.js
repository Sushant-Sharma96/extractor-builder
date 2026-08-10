'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { materializeNormalizedDesignGraph } = require('./compiler/ndg');
const { createWorkspace } = require('./compiler/workspace');
const { indexGraph } = require('./compiler/layout/collect');
const { interpretGraph } = require('./compiler/layout/interpret');
const { detectGeometry } = require('./compiler/geometry');
const { detectComponentGeometry } = require('./compiler/rulepack/packs/component-detect/geometry-rules');
(async () => {
  const cacheDir = path.join(__dirname, 'output', 'figma-cache', 'c0kt3mp76RoEiq3CFoeCHa__1_848');
  const doc = JSON.parse(fs.readFileSync(path.join(cacheDir, 'document.json'), 'utf8'));
  const document = doc.document || doc;
  const ws = createWorkspace();
  const ndg = await materializeNormalizedDesignGraph({ workspace: ws, policy: { profileId: 'pixel-faithful' }, document, graphId: 'g:probe' });
  const graph = ndg.graph;
  const index = indexGraph(graph);
  const detectedGeometry = detectGeometry(graph, {});
  console.log('geometry candidates:', (detectedGeometry.candidates||[]).length);
  for (const c of (detectedGeometry.candidates||[])) {
    console.log('  cand', c.nodeId, c.kind || c.type, JSON.stringify(c.shape||c).slice(0,120));
  }
  const geometryCandidatesByNode = {};
  for (const c of detectedGeometry.candidates || []) geometryCandidatesByNode[c.nodeId] = c;
  const detectedComponent = detectComponentGeometry(graph, { geometryCandidatesByNode });
  console.log('cardFacts:', (detectedComponent.cardFacts||[]).length, 'bannerFacts:', (detectedComponent.bannerFacts||[]).length);
  for (const c of (detectedComponent.cardFacts||[])) console.log('  card', JSON.stringify(c).slice(0,200));
  // interpret modes
  const interps = interpretGraph(graph, index, { recognitionHintsByNode: detectedGeometry.recognitionHintsByNode });
  const modeCount = {};
  for (const i of interps) { const m = i.modeCandidates && i.modeCandidates[0] && i.modeCandidates[0].mode; modeCount[m]=(modeCount[m]||0)+1; }
  console.log('modes:', JSON.stringify(modeCount));
})().catch(e=>{console.error(e);process.exit(1);});
