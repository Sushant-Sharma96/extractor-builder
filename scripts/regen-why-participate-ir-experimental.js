#!/usr/bin/env node
/** Regenerate output/why-participate via ir-experimental. */
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
  const snap = snapMod.loadSnapshot(fileKey, '39:3');
  if (!snap) throw new Error('no snapshot for ' + fileKey + ' 39:3');
  const document = find(snap.document, '39:3');
  if (!document) throw new Error('node 39:3 not found in snapshot');

  const a = figmaBuild.analyze(document, { emitMode: 'standard' });
  const svgMarkup = reconstructSvgMarkup(a.svgNodes);
  for (const id of Object.keys(snap.svgFallback || {})) {
    if (!svgMarkup[id] && snap.svgFallback[id]) svgMarkup[id] = snap.svgFallback[id];
  }

  const outDir = path.join(__dirname, '../output/why-participate');
  const result = await compile({
    document,
    graphId: 'g:why-participate-tier1-fix',
    title: 'Why Participate',
    slug: 'why-participate',
    url: 'https://www.figma.com/design/c0kt3mp76RoEiq3CFoeCHa/Untitled?node-id=39-3',
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
