#!/usr/bin/env node
/** Regenerate output/section-section-light via ir-experimental (fileKey oPJPuHvvZOPo4nkzVxr11M, node 43:2). */
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
  const fileKey = 'oPJPuHvvZOPo4nkzVxr11M';
  const snap = snapMod.loadSnapshot(fileKey, '43:2');
  if (!snap) throw new Error('no snapshot for ' + fileKey + ' 43:2');
  const document = find(snap.document, '43:2');
  if (!document) throw new Error('node 43:2 not found in snapshot');

  const a = figmaBuild.analyze(document, { emitMode: 'standard' });
  const svgMarkup = reconstructSvgMarkup(a.svgNodes);
  for (const id of Object.keys(snap.svgFallback || {})) {
    if (!svgMarkup[id] && snap.svgFallback[id]) svgMarkup[id] = snap.svgFallback[id];
  }

  const outDir = path.join(__dirname, '../output/section-section-light');
  const result = await compile({
    document,
    graphId: 'g:section-light-ir-fix',
    title: 'The Dialogue',
    slug: 'section-section-light',
    url: 'https://www.figma.com/design/oPJPuHvvZOPo4nkzVxr11M/Untitled?node-id=43-2',
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
