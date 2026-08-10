'use strict';

const fs = require('fs');
const path = require('path');
const figmaBuild = require('../server/figma-build');
const { reconstructSvgMarkup } = require('../server/figma-generate');
const { loadSnapshot } = require('../server/figma-snapshot');
const { compile } = require('../compiler/compile');

function countFigmaNodes(n, acc = { total: 0, text: 0, image: 0, vector: 0, frame: 0, other: 0 }) {
  if (!n || n.visible === false) return acc;
  acc.total += 1;
  const t = n.type;
  if (t === 'TEXT') acc.text += 1;
  else if (['VECTOR', 'LINE', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON'].includes(t)) acc.vector += 1;
  else if (t === 'RECTANGLE' || t === 'ELLIPSE') {
    const hasImg = (n.fills || []).some((f) => f.visible !== false && f.type === 'IMAGE');
    if (hasImg) acc.image += 1;
    else acc.other += 1;
  } else if (['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(t)) acc.frame += 1;
  else acc.other += 1;
  for (const c of n.children || []) countFigmaNodes(c, acc);
  return acc;
}

function countTree(el, acc = { total: 0, text: 0, img: 0, svg: 0, el: 0 }) {
  if (!el) return acc;
  acc.total += 1;
  if (el.kind === 'svg') acc.svg += 1;
  else if (el.kind === 'img') acc.img += 1;
  else if (el.text != null || el.runs) acc.text += 1;
  else acc.el += 1;
  for (const c of el.children || []) countTree(c, acc);
  return acc;
}

function countHtml(html) {
  return {
    tags: (html.match(/<(p|h[1-6]|div|img|svg|button|nav|header|footer|section|span)\b/gi) || []).length,
    textTags: (html.match(/<(p|h[1-6]|button)\b/gi) || []).length,
    imgs: (html.match(/<img\b/gi) || []).length,
    svgs: (html.match(/<svg\b/gi) || []).length,
    emptySections: (html.match(/<section[^>]*>\s*<\/section>/gi) || []).length,
    hackspace: /HackSpace|Hackspace/i.test(html),
    register: /Register Now/i.test(html),
    offline: /Offline/i.test(html),
    registration: /Registration Ends/i.test(html),
  };
}

async function main() {
  const snap = loadSnapshot('fYKUEGHAxVkJwn8CwvJCsp', '2:2');
  if (!snap) {
    console.error('NO_SNAPSHOT');
    process.exit(1);
  }
  const figmaCounts = countFigmaNodes(snap.document);
  const a = figmaBuild.analyze(snap.document);
  const treeCounts = countTree(a.tree);
  const svgMarkup = reconstructSvgMarkup(a.svgNodes);
  Object.assign(svgMarkup, snap.svgFallback || {});

  const outDir = path.join(__dirname, '..', 'output', 'untitled');
  const r = await compile({
    document: snap.document,
    graphId: 'g:figma:fYKUEGHAxVkJwn8CwvJCsp:2:2',
    policyProfileId: 'pixel-faithful',
    title: snap.name || 'Untitled',
    slug: 'untitled',
    outDir,
    imageUrls: snap.pngRemote || {},
    imageFillUrls: snap.imageFillsRemote || {},
    svgMarkup,
    fonts: a.fonts,
    localByUrl: snap.urlToAbs || null,
    downloadImages: true,
    useCache: false,
  });

  const html = r.artifacts.html;
  const hc = countHtml(html);
  const report = {
    figmaNodeCounts: figmaCounts,
    analyzedTreeCounts: treeCounts,
    htmlCounts: hc,
    imgSrcSample: (html.match(/src="([^"]+)"/g) || []).slice(0, 8),
    assetsDownloaded: (r.artifacts.package && r.artifacts.package.assets) || 0,
    emptySections: hc.emptySections,
  };
  const outPath = path.join(__dirname, 'html-emit-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  const body = html.split('<body>')[1].split('</body>')[0];
  console.log('--- body ---');
  console.log(body.slice(0, 3500));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
