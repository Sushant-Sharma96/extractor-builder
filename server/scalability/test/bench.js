'use strict';
/**
 * Performance benchmarks for product shell (no live Figma).
 * Writes JSON summary to stdout and docs-friendly numbers in report.
 */
const path = require('path');
const fs = require('fs');
const {
  tmpRoot, rmrf, landingDocument, writeMinimalSnapshot,
} = require('./_helpers');

function memMb() {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) total += dirSize(p);
    else total += fs.statSync(p).size;
  }
  return total;
}

async function main() {
  const cacheDir = tmpRoot('bench');
  process.env.FIGMA_CACHE_DIR = cacheDir;
  process.env.FIGMA_BUDGET_DIR = tmpRoot('bench-bud');

  delete require.cache[require.resolve('../../figma-snapshot')];
  delete require.cache[require.resolve('../cache-resolver')];
  delete require.cache[require.resolve('../index')];
  delete require.cache[require.resolve('../planner')];
  delete require.cache[require.resolve('../budget')];
  delete require.cache[require.resolve('../budget-state')];

  const fileKey = 'BenchFileKey000000000000000';
  const desktop = landingDocument();
  const snapT0 = Date.now();
  writeMinimalSnapshot(cacheDir, fileKey, '1:1', desktop);
  const snapshotSaveMs = Date.now() - snapT0;

  const { resolve } = require('../cache-resolver');
  const { prepareFigmaSources } = require('../index');
  const { compile } = require('../../../compiler/compile');

  const loadT0 = Date.now();
  const exact = resolve({ fileKey, nodeId: '1:1', refresh: false });
  const snapshotLoadMs = Date.now() - loadT0;

  const subT0 = Date.now();
  const sub = resolve({ fileKey, nodeId: '3:1', refresh: false });
  const subtreeResolveMs = Date.now() - subT0;

  const restCounter = { n: 0 };
  const prepT0 = Date.now();
  const prepared = await prepareFigmaSources({
    fileKey,
    nodeId: '3:1',
    auth: { token: 'x', oauth: false },
    refresh: false,
    restCounter,
    t0: Date.now(),
  });
  const prepareSubtreeMs = Date.now() - prepT0;

  const outDir = path.join(cacheDir, 'bench-out');
  const compileT0 = Date.now();
  const compiled = await compile({
    document: prepared.document,
    graphId: 'g:bench',
    policyProfileId: 'pixel-faithful',
    title: 'Pricing',
    slug: 'bench-pricing',
    outDir,
    imageUrls: {},
    imageFillUrls: {},
    svgMarkup: {},
    fonts: [],
    downloadImages: false,
    useCache: false,
  });
  const compileMs = Date.now() - compileT0;

  const results = {
    coldMissRest: 'n/a (offline bench — no Figma)',
    warmExactHitMs: snapshotLoadMs,
    warmSubtreeResolveMs: subtreeResolveMs,
    warmSubtreePrepareMs: prepareSubtreeMs,
    refresh: 'bypass → MISS (not timed vs live API)',
    compileMs,
    snapshotSaveMs,
    snapshotLoadMs,
    restCallsSubtree: restCounter.n,
    memoryHeapMb: memMb(),
    cacheSizeBytes: dirSize(cacheDir),
    exactStatus: exact.cacheStatus,
    subtreeStatus: sub.cacheStatus,
    htmlBytes: (compiled.artifacts.html || '').length,
  };

  console.log(JSON.stringify(results, null, 2));

  const outJson = path.join(__dirname, 'bench-results.json');
  fs.writeFileSync(outJson, JSON.stringify(results, null, 2));

  rmrf(cacheDir);
  rmrf(process.env.FIGMA_BUDGET_DIR);
  delete process.env.FIGMA_CACHE_DIR;
  delete process.env.FIGMA_BUDGET_DIR;
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
