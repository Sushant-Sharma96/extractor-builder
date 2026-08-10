#!/usr/bin/env node
/** Regenerate output/explore via ir-experimental for the current Figma file (fYKUEGHAxVkJwn8CwvJCsp). */
require('dotenv').config();
const path = require('path');
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
  const fileKey = 'fYKUEGHAxVkJwn8CwvJCsp';
  const snap = snapMod.loadSnapshot(fileKey, '86:60');
  if (!snap) throw new Error('no snapshot for ' + fileKey + ' 86:60');
  const document = find(snap.document, '86:60');
  if (!document) throw new Error('node 86:60 not found in snapshot');

  const a = figmaBuild.analyze(document, { emitMode: 'standard' });
  const svgMarkup = reconstructSvgMarkup(a.svgNodes);
  for (const id of Object.keys(snap.svgFallback || {})) {
    if (!svgMarkup[id] && snap.svgFallback[id]) svgMarkup[id] = snap.svgFallback[id];
  }

  const outDir = path.join(__dirname, '../output/explore');
  const result = await compile({
    document,
    graphId: 'g:explore-ir-fix',
    title: 'Explore Hackathons by Category',
    slug: 'explore',
    url: 'https://www.figma.com/design/fYKUEGHAxVkJwn8CwvJCsp/Untitled?node-id=86-60',
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
    htmlBytes: result.artifacts.summary && result.artifacts.summary.htmlBytes,
    cssBytes: result.artifacts.summary && result.artifacts.summary.cssBytes,
    nodeCount: result.artifacts.summary && result.artifacts.summary.nodeCount,
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
