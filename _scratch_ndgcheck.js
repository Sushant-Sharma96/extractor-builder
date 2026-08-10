'use strict';
require('dotenv').config();
const path = require('path'); const fs = require('fs');
const { materializeNormalizedDesignGraph } = require('./compiler/ndg');
const { createWorkspace } = require('./compiler/workspace');
(async () => {
  const cacheDir = path.join(__dirname, 'output', 'figma-cache', 'c0kt3mp76RoEiq3CFoeCHa__1_848');
  const doc = JSON.parse(fs.readFileSync(path.join(cacheDir, 'document.json'), 'utf8'));
  const ws = createWorkspace();
  const ndg = await materializeNormalizedDesignGraph({ workspace: ws, policy: { profileId: 'pixel-faithful' }, document: doc.document||doc, graphId: 'g:check' });
  const t = ndg.graph.nodes.find(n => n.attributes && n.attributes.characters === 'Take A Look at Our Latest Articles');
  console.log('found node:', !!t);
  console.log('CSO present:', Array.isArray(t.attributes.characterStyleOverrides), 'len', t.attributes.characterStyleOverrides && t.attributes.characterStyleOverrides.length);
  console.log('table present:', !!t.attributes.styleOverrideTable, JSON.stringify(t.attributes.styleOverrideTable));
})().catch(e=>{console.error(e);process.exit(1);});
