#!/usr/bin/env node
'use strict';
/**
 * Force-refresh IBM Lifecycle section (node 11:79) with standard/flex emit.
 * Usage: node scripts/demo-convert-ibm.js
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const URL = process.argv[2]
  || 'https://www.figma.com/design/oPJPuHvvZOPo4nkzVxr11M/Untitled?node-id=11-79';

async function main() {
  if (!process.env.FIGMA_TOKEN) {
    console.error('FIGMA_TOKEN missing in .env');
    process.exit(1);
  }

  const { parseFigmaUrl } = require('../server/figma-fetch');
  const { prepareFigmaSources } = require('../server/scalability');
  const figmaBuild = require('../server/figma-build');
  const { reconstructSvgMarkup } = require('../server/figma-generate');
  const { compile } = require('../compiler/compile');
  const { saveSnapshotAtomic } = require('../server/figma-snapshot');

  const { fileKey, nodeId } = parseFigmaUrl(URL);
  console.log('[ibm] fileKey=', fileKey, 'nodeId=', nodeId);

  const restCounter = { n: 0 };
  const t0 = Date.now();

  const prepared = await prepareFigmaSources({
    fileKey,
    nodeId,
    auth: { token: process.env.FIGMA_TOKEN, oauth: false },
    refresh: true,
    restCounter,
    t0,
    userKey: 'demo',
    force: true,
    requestId: 'demo-ibm',
  });

  if (prepared.denied || prepared.budgetBlocked) {
    console.error('[ibm] BLOCKED', prepared.authz);
    process.exit(2);
  }
  if (!prepared.document) {
    console.error('[ibm] No document', prepared.authz || prepared);
    process.exit(2);
  }

  const {
    document, name, imageFillUrls, imageUrls, svgFallback, fetchedMeta, localByUrl,
  } = prepared;

  const layoutA = figmaBuild.analyze(document, { emitMode: 'standard' });
  const svgMarkup = reconstructSvgMarkup(layoutA.svgNodes);
  for (const id of Object.keys(svgFallback || {})) {
    if (!svgMarkup[id] && svgFallback[id]) svgMarkup[id] = svgFallback[id];
  }

  const lr = layoutA.layoutReport || {};
  console.log('[ibm] freeform=', lr.freeformContainerCount,
    'banner=', lr.bannerShells, 'feature=', lr.featureCards, 'grids=', lr.cardGrids);
  console.log('[ibm] warnings=', (lr.warnings || []).map((w) => w.code));

  const slug = 'ibm';
  const outDir = path.join(__dirname, '..', 'output', slug);

  const compiled = await compile({
    document,
    graphId: `g:figma:${fileKey}:${nodeId || 'root'}`,
    policyProfileId: 'pixel-faithful',
    title: name || 'IBM Lifecycle',
    slug,
    url: URL,
    outDir,
    imageUrls,
    imageFillUrls,
    svgMarkup,
    fonts: layoutA.fonts,
    localByUrl,
    downloadImages: true,
    useCache: false,
    emitMode: 'standard',
  });

  const html = compiled.artifacts.html || '';
  const css = compiled.artifacts.css || '';
  const missing = (html.match(/data-figma-missing-asset/g) || []).length;
  const imgs = (html.match(/<img\b/gi) || []).length;

  const bannerRule = (css.match(/\.group-1171277389\s*\{[^}]+\}/) || [])[0] || '';
  const hasPink = html.includes('rgba(255,80,80');
  console.log('[ibm] output=', outDir);
  console.log('[ibm] missingAssets=', missing, 'imgs=', imgs);
  console.log('[ibm] et-banner=', html.includes('et-banner'), 'et-card=', (html.match(/\bet-card\b/g) || []).length);
  console.log('[ibm] banner has #03113e=', /#03113e/i.test(bannerRule));
  console.log('[ibm] pink placeholder=', hasPink);
  console.log('[ibm] REST=', restCounter.n, 'ms=', Date.now() - t0);

  if (fetchedMeta) {
    const coverId = fetchedMeta.coveringNodeId != null ? fetchedMeta.coveringNodeId : nodeId;
    const coverDoc = fetchedMeta.coveringDocument || document;
    const coverA = figmaBuild.analyze(coverDoc, { emitMode: 'standard' });
    const coverReconstructed = reconstructSvgMarkup(coverA.svgNodes || {});
    try {
      const snapDir = await saveSnapshotAtomic({
        fileKey,
        nodeId: coverId,
        url: URL,
        kind: fetchedMeta.kind || 'exact',
        coverageType: fetchedMeta.coverageType || null,
        documentPayload: {
          document: coverDoc,
          name: fetchedMeta.coveringName || fetchedMeta.name,
          fileName: fetchedMeta.fileName,
          version: fetchedMeta.version,
        },
        imageFillsRemote: imageFillUrls,
        pngRemote: imageUrls,
        svgFallback,
        requiredVectorIds: [
          ...(coverA.svgNodeIds || []),
          ...(coverA.imageNodeIds || []),
        ],
        reconstructedVectorIds: Object.keys(coverReconstructed),
      });
      console.log('[ibm] snapshot saved=', snapDir);
    } catch (e) {
      console.error('[ibm] snapshot FAILED:', e.message);
    }
  }

  const report = {
    url: URL,
    fileKey,
    nodeId,
    slug,
    outDir,
    missingAssets: missing,
    etBanner: html.includes('et-banner'),
    bannerDarkFill: /#03113e/i.test(bannerRule),
    pinkPlaceholder: hasPink,
    bannerShells: lr.bannerShells,
    featureCards: lr.featureCards,
    cardGrids: lr.cardGrids,
    previewHint: `Open output/${slug}/index.html or /preview/${slug}/`,
  };
  fs.writeFileSync(path.join(outDir, '_demo-qa.json'), JSON.stringify(report, null, 2));
  console.log('[ibm] DONE', JSON.stringify(report, null, 2));

  if (!html.includes('et-banner') || !/#03113e/i.test(bannerRule)) process.exit(1);
  if (hasPink && missing > 3) process.exit(3);
}

main().catch((e) => {
  console.error('[ibm] FATAL', e);
  process.exit(1);
});
