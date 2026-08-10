#!/usr/bin/env node
'use strict';
/**
 * Offline Articles recompile from figma-cache (no Figma API).
 * Usage: node scripts/recompile-articles-offline.js [auto|standard|pixel]
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const figmaBuild = require('../server/figma-build');
const { reconstructSvgMarkup } = require('../server/figma-generate');
const { compile } = require('../compiler/compile');

async function main() {
  const emitMode = (process.argv[2] || 'auto').toLowerCase();
  const cacheDir = path.join(__dirname, '..', 'output', 'figma-cache', 'c0kt3mp76RoEiq3CFoeCHa__1_848');
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
  console.log('[offline-articles] emitMode=', emitMode, 'local assets', Object.keys(localByUrl).length);

  const layoutA = figmaBuild.analyze(document, { emitMode });
  const svgMarkup = reconstructSvgMarkup(layoutA.svgNodes || {});
  const outDir = path.join(__dirname, '..', 'output', 'articles');
  const compiled = await compile({
    document,
    graphId: 'g:figma:c0kt3mp76RoEiq3CFoeCHa:1:848',
    policyProfileId: 'pixel-faithful',
    title: 'Articles',
    slug: 'articles',
    url: 'https://www.figma.com/design/c0kt3mp76RoEiq3CFoeCHa/Untitled?node-id=1-848',
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
  const ct = (compiled.layoutReport && compiled.layoutReport.constraintTranscriber)
    || (layoutA.layoutReport && layoutA.layoutReport.constraintTranscriber)
    || null;
  const report = {
    emitMode,
    etPathB: html.includes('et-path-b'),
    etCard: (html.match(/\bet-card\b/g) || []).length,
    etMeasured: (html.match(/\bet-measured-/g) || []).length,
    etMediaOverlay: (html.match(/\bet-media-overlay\b/g) || []).length,
    etCardGrid: html.includes('et-card-grid') || html.includes('et-measured-grid'),
    cssAbs: (css.match(/position:\s*absolute/g) || []).length,
    constraint: ct,
    qaReady: !!(compiled.layoutReport && compiled.layoutReport.qaReady)
      || !!(layoutA.layoutReport && layoutA.layoutReport.qaReady),
  };
  fs.writeFileSync(path.join(outDir, '_emit-qa.json'), JSON.stringify(report, null, 2));
  console.log('[offline-articles] DONE', JSON.stringify(report, null, 2));
  if ((emitMode === 'auto' || emitMode === 'standard') && report.etPathB && report.etMeasured === 0) {
    console.warn('[offline-articles] WARN: Path B with no measured regions');
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error('[offline-articles] FATAL', e);
  process.exit(1);
});
