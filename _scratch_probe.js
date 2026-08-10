'use strict';
const path = require('path');
const fs = require('fs');
const cacheDir = path.join(__dirname, 'output', 'figma-cache', 'c0kt3mp76RoEiq3CFoeCHa__1_848');
const doc = JSON.parse(fs.readFileSync(path.join(cacheDir, 'document.json'), 'utf8'));
const document = doc.document || doc;
let textNodes = [];
(function walk(n){
  if (!n || typeof n !== 'object') return;
  if (n.type === 'TEXT') textNodes.push(n);
  (n.children||[]).forEach(walk);
})(document);
console.log('TEXT node count:', textNodes.length);
for (const t of textNodes) {
  console.log('---', JSON.stringify(t.characters).slice(0,50),
    'hasCSO:', Array.isArray(t.characterStyleOverrides) && t.characterStyleOverrides.length,
    'hasTable:', t.styleOverrideTable && Object.keys(t.styleOverrideTable).length,
    'fontName:', t.style && t.style.fontFamily);
}
// Dump the one with overrides fully
const withOv = textNodes.find(t=>Array.isArray(t.characterStyleOverrides) && t.characterStyleOverrides.some(x=>x));
if (withOv) {
  console.log('\n=== Node with overrides ===');
  console.log('characters:', JSON.stringify(withOv.characters));
  console.log('characterStyleOverrides:', JSON.stringify(withOv.characterStyleOverrides));
  console.log('styleOverrideTable:', JSON.stringify(withOv.styleOverrideTable));
}
