#!/usr/bin/env node
'use strict';
/**
 * Offline IBM recompile from figma-cache (no Figma API).
 * Default: auto → Standards Promotion (flex/grid QA bar).
 * Use `pixel` for Path B fidelity oracle preview.
 * Usage: node scripts/recompile-ibm-offline.js [auto|standard|pixel]
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const figmaBuild = require('../server/figma-build');
const { reconstructSvgMarkup } = require('../server/figma-generate');
const { compile } = require('../compiler/compile');

async function main() {
  const emitMode = (process.argv[2] || 'auto').toLowerCase();
  const cacheDir = path.join(__dirname, '..', 'output', 'figma-cache', 'oPJPuHvvZOPo4nkzVxr11M__11_79');
  const doc = JSON.parse(fs.readFileSync(path.join(cacheDir, 'document.json'), 'utf8'));
  const document = doc.document || doc;
  const imageUrls = JSON.parse(fs.readFileSync(path.join(cacheDir, 'png-remote.json'), 'utf8'));
  const imageFillUrls = JSON.parse(fs.readFileSync(path.join(cacheDir, 'image-fills.remote.json'), 'utf8'));
  const urlLocal = JSON.parse(fs.readFileSync(path.join(cacheDir, 'url-local.json'), 'utf8'));
  const fillsLocal = JSON.parse(fs.readFileSync(path.join(cacheDir, 'image-fills.json'), 'utf8'));
  const localByUrl = {};
  for (const [url, rel] of Object.entries(urlLocal)) {
    const abs = path.resolve(cacheDir, rel);
    if (fs.existsSync(abs)) localByUrl[url] = abs;
  }
  for (const [ref, remote] of Object.entries(imageFillUrls)) {
    const rel = fillsLocal[ref];
    if (!rel) continue;
    const abs = path.resolve(cacheDir, rel);
    if (fs.existsSync(abs)) localByUrl[remote] = abs;
  }
  console.log('[offline] emitMode=', emitMode, 'local assets', Object.keys(localByUrl).length);

  const layoutA = figmaBuild.analyze(document, { emitMode });
  const svgMarkup = reconstructSvgMarkup(layoutA.svgNodes || {});
  const outDir = path.join(__dirname, '..', 'output', 'ibm');
  const compiled = await compile({
    document,
    graphId: 'g:figma:oPJPuHvvZOPo4nkzVxr11M:11:79',
    policyProfileId: 'pixel-faithful',
    title: 'IBM Lifecycle',
    slug: 'ibm',
    url: 'https://www.figma.com/design/oPJPuHvvZOPo4nkzVxr11M/Untitled?node-id=11-79',
    outDir,
    imageUrls,
    imageFillUrls,
    svgMarkup,
    fonts: layoutA.fonts,
    localByUrl,
    downloadImages: false,
    useCache: false,
    emitMode,
  });

  const html = compiled.artifacts.html || '';
  const css = compiled.artifacts.css || '';
  const report = {
    emitMode,
    etPathB: html.includes('et-path-b'),
    etCard: (html.match(/\bet-card\b/g) || []).length,
    etBanner: html.includes('et-banner'),
    etCardGrid: html.includes('et-card-grid'),
    standardsPromoted: html.includes('et-standards-promoted'),
    qaReady: !!(compiled.layoutReport && compiled.layoutReport.qaReady)
      || !!(layoutA.layoutReport && layoutA.layoutReport.qaReady),
    fallbacks: (html.match(/data-asset-fallback/g) || []).length,
    cssAbs: (css.match(/position:\s*absolute/g) || []).length,
    standards: (layoutA.standardsReport || compiled.layoutReport && compiled.layoutReport.standards) || null,
  };
  fs.writeFileSync(path.join(outDir, '_emit-qa.json'), JSON.stringify(report, null, 2));
  console.log('[offline] DONE', JSON.stringify(report, null, 2));
  if (emitMode === 'pixel' && !report.etPathB) process.exit(2);
  if ((emitMode === 'auto' || emitMode === 'standard') && report.etPathB && !report.etCard) {
    console.warn('[offline] WARN: QA mode still Path B with no et-card — promoters need work');
  }
}

main().catch((e) => {
  console.error('[offline] FATAL', e);
  process.exit(1);
});
