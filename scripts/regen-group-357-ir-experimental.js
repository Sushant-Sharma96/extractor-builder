#!/usr/bin/env node
/** Regenerate output/group-357 via ir-experimental (fileKey eOwzPCQP0f3sAxzI0T0b9d, node "Group 357"). */
require('dotenv').config();
const path = require('path');
process.env.FIGMA_CACHE_DIR = path.resolve(__dirname, '../output/figma-cache');

const snapMod = require('../server/figma-snapshot');
const { reconstructSvgMarkup } = require('../server/figma-generate');
const figmaBuild = require('../server/figma-build');
const { compile } = require('../compiler/compile');

function findByName(n, name) {
  if (!n) return null;
  if (n.name === name) return n;
  for (const c of n.children || []) {
    const f = findByName(c, name);
    if (f) return f;
  }
  return null;
}

(async () => {
  const fileKey = 'eOwzPCQP0f3sAxzI0T0b9d';
  const snap = snapMod.loadSnapshot(fileKey, '45:14510');
  if (!snap) throw new Error('no snapshot for ' + fileKey + ' 45:14510');
  const document = findByName(snap.document, 'Group 357');
  if (!document) throw new Error('"Group 357" not found in snapshot');

  const a = figmaBuild.analyze(document, { emitMode: 'standard' });
  const svgMarkup = reconstructSvgMarkup(a.svgNodes);
  for (const id of Object.keys(snap.svgFallback || {})) {
    if (!svgMarkup[id] && snap.svgFallback[id]) svgMarkup[id] = snap.svgFallback[id];
  }

  const outDir = path.join(__dirname, '../output/group-357');
  const result = await compile({
    document,
    graphId: 'g:group-357-ir-fix',
    title: 'Group 357',
    slug: 'group-357',
    url: 'https://www.figma.com/design/eOwzPCQP0f3sAxzI0T0b9d/Untitled?node-id=45-14510',
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
    dir: result.artifacts.dir,
    htmlBytes: result.artifacts.summary && result.artifacts.summary.htmlBytes,
    cssBytes: result.artifacts.summary && result.artifacts.summary.cssBytes,
    nodeCount: result.artifacts.summary && result.artifacts.summary.nodeCount,
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
