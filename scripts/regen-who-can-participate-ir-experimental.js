#!/usr/bin/env node
/** Regenerate output/who-can-participate via ir-experimental. */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
process.env.FIGMA_CACHE_DIR = path.resolve(__dirname, '../output/figma-cache');

const snapMod = require('../server/figma-snapshot');
const { reconstructSvgMarkup } = require('../server/figma-generate');
const figmaBuild = require('../server/figma-build');
const { compile } = require('../compiler/compile');

function find(n, id) {
  if (!n) return null;
  if (n.id === id) return n;
  for (const c of n.children || []) {
    const f = find(c, id);
    if (f) return f;
  }
  return null;
}

(async () => {
  const fileKey = 'c0kt3mp76RoEiq3CFoeCHa';
  const snap = snapMod.loadSnapshot(fileKey, '35:2');
  if (!snap) throw new Error('no snapshot for ' + fileKey + ' 35:2');
  const document = find(snap.document, '36:3');
  if (!document) throw new Error('node 36:3 not found in snapshot');

  const a = figmaBuild.analyze(document, { emitMode: 'standard' });
  const svgMarkup = reconstructSvgMarkup(a.svgNodes);
  for (const id of Object.keys(snap.svgFallback || {})) {
    if (!svgMarkup[id] && snap.svgFallback[id]) svgMarkup[id] = snap.svgFallback[id];
  }

  const outDir = path.join(__dirname, '../output/who-can-participate');
  const result = await compile({
    document,
    graphId: 'g:who-can-participate-ir-fix',
    title: 'Who can Participate',
    slug: 'who-can-participate',
    url: 'https://www.figma.com/design/c0kt3mp76RoEiq3CFoeCHa/Untitled?node-id=36-3',
    outDir,
    imageUrls: snap.pngRemote || {},
    imageFillUrls: snap.imageFillsRemote || {},
    svgMarkup,
    fonts: a.fonts,
    localByUrl: snap.urlToAbs || null,
    downloadImages: true,
    useCache: false,
    renderer: 'ir-experimental',
  });

  console.log(JSON.stringify({
    ok: result.ok,
    renderer: result.artifacts.renderer,
    rendererSwitchedFrom: result.artifacts.rendererSwitchedFrom,
    dir: result.artifacts.dir,
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
