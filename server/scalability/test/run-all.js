'use strict';
/**
 * Unit + integration + regression tests for production hardening.
 * No live Figma network calls.
 */
const path = require('path');
const fs = require('fs');
const {
  assert, test, summary, resetCounts, tmpRoot, rmrf,
  landingDocument, writeMinimalSnapshot, counts,
} = require('./_helpers');

async function run() {
  resetCounts();

  // ── Planner ────────────────────────────────────────────────────────────
  await test('planner: exact HIT → offline zero needs', () => {
    const planner = require('../planner');
    const p = planner.plan({ refresh: false, cacheHit: true, cachePath: 'exact', nodeId: '1:1' });
    assert(p.action === 'offline_compile', 'action');
    assert(p.prediction.t1 === 0 && p.prediction.t2 === 0, 'pred');
    assert(!p.needs.geometry && !p.needs.imageFills, 'needs');
  });

  await test('planner: subtree HIT → offline', () => {
    const planner = require('../planner');
    const p = planner.plan({ refresh: false, cacheHit: true, cachePath: 'subtree', nodeId: '3:1' });
    assert(p.cacheStrategy === 'subtree', 'strategy');
    assert(p.action === 'offline_compile', 'action');
  });

  await test('planner: refresh forces miss covering path', () => {
    const planner = require('../planner');
    const p = planner.plan({ refresh: true, cacheHit: true, cachePath: 'exact', nodeId: '2:1' });
    assert(p.cacheStrategy === 'refresh', 'refresh strategy');
    assert(p.needs.geometry === true, 'geometry');
  });

  await test('planner: refineAfterGeometry self FRAME', () => {
    const planner = require('../planner');
    let p = planner.plan({ refresh: false, cacheHit: false, nodeId: '1:1' });
    p = planner.refineAfterGeometry(p, { id: '1:1', type: 'FRAME', name: 'Desktop' }, '1:1');
    assert(p.coveringStrategy === 'self', 'self');
    assert(p.needs.structure === false, 'no structure');
  });

  await test('planner: refineAfterCovering skips fills when no images', () => {
    const planner = require('../planner');
    let p = planner.plan({ refresh: false, cacheHit: false, nodeId: '1:1' });
    const doc = {
      id: '1:1', type: 'FRAME', name: 'T', children: [{
        id: 't1', type: 'TEXT', characters: 'Hi',
        style: { fontSize: 12 }, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
        absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 }, children: [],
      }],
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
    };
    p = planner.refineAfterCovering(p, doc);
    assert(p.needs.imageFills === false, 'no fills');
    assert(p.needs.png === false, 'no png');
  });

  // ── Covering ───────────────────────────────────────────────────────────
  await test('covering: prefers top-level FRAME under CANVAS', () => {
    const { findPathToNode, selectCoveringFromPath } = require('../covering');
    const tree = {
      id: '0:0', type: 'DOCUMENT', children: [{
        id: '0:1', type: 'CANVAS', name: 'Page', children: [{
          id: '1:1', type: 'FRAME', name: 'Desktop', children: [{
            id: '2:1', type: 'FRAME', name: 'Hero', children: [
              { id: '2:5', type: 'RECTANGLE', name: 'x', children: [] },
            ],
          }],
        }],
      }],
    };
    const sel = selectCoveringFromPath(findPathToNode(tree, '2:5'));
    assert(sel.coveringId === '1:1', 'desktop cover');
    assert(sel.coverageType === 'FRAME', 'type');
  });

  // ── Budget ─────────────────────────────────────────────────────────────
  await test('budget: HIT allow pred 0', () => {
    const budget = require('../budget');
    const planner = require('../planner');
    const plan = planner.plan({ refresh: false, cacheHit: true, cachePath: 'exact' });
    const d = budget.authorize({ plan, cacheStatus: 'HIT', fileKey: 'fk', refresh: false });
    assert(d.outcome === 'Allow', 'allow');
    assert(d.predictedTier1 === 0, 't1');
  });

  await test('budget: 429 lock denies MISS but allows HIT', () => {
    const root = tmpRoot('budget');
    process.env.FIGMA_BUDGET_DIR = root;
    // fresh modules see new env via getters
    delete require.cache[require.resolve('../budget-state')];
    delete require.cache[require.resolve('../budget')];
    delete require.cache[require.resolve('../planner')];
    const budget = require('../budget');
    const planner = require('../planner');
    budget.recordRateLimit({ retryAfterSec: 600, planTier: 'starter', fileKey: 'fk' });
    const missPlan = planner.plan({ refresh: false, cacheHit: false, nodeId: '1:1' });
    const deny = budget.authorize({ plan: missPlan, cacheStatus: 'MISS', fileKey: 'fk', refresh: false });
    assert(deny.outcome === 'Deny', 'deny miss');
    assert(deny.reason === 'rate_limit_lock_active', 'lock reason');
    const hitPlan = planner.plan({ refresh: false, cacheHit: true, cachePath: 'exact' });
    const allow = budget.authorize({ plan: hitPlan, cacheStatus: 'HIT', fileKey: 'fk', refresh: false });
    assert(allow.outcome === 'Allow', 'allow hit under lock');
    rmrf(root);
    delete process.env.FIGMA_BUDGET_DIR;
    delete require.cache[require.resolve('../budget-state')];
    delete require.cache[require.resolve('../budget')];
  });

  await test('budget: corrupt state recovers', () => {
    const root = tmpRoot('budget-corrupt');
    process.env.FIGMA_BUDGET_DIR = root;
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'state.json'), '{not-json');
    delete require.cache[require.resolve('../budget-state')];
    const { loadState } = require('../budget-state');
    const s = loadState();
    assert(s && s.locks && typeof s.locks === 'object', 'default state');
    rmrf(root);
    delete process.env.FIGMA_BUDGET_DIR;
    delete require.cache[require.resolve('../budget-state')];
  });

  // ── Resolver + Snapshot + Subtree integration ──────────────────────────
  await test('integration: Desktop snap → Pricing SUBTREE → 0 REST path', async () => {
    const cacheDir = tmpRoot('cache');
    process.env.FIGMA_CACHE_DIR = cacheDir;
    process.env.FIGMA_BUDGET_DIR = tmpRoot('bud2');
    delete require.cache[require.resolve('../../figma-snapshot')];
    delete require.cache[require.resolve('../cache-resolver')];
    delete require.cache[require.resolve('../index')];
    delete require.cache[require.resolve('../planner')];
    delete require.cache[require.resolve('../budget')];
    delete require.cache[require.resolve('../budget-state')];

    const fileKey = 'TestFileKey000000000000000';
    const desktop = landingDocument();
    writeMinimalSnapshot(cacheDir, fileKey, '1:1', desktop, { kind: 'page', coverageType: 'FRAME' });

    const { resolve } = require('../cache-resolver');
    const exact = resolve({ fileKey, nodeId: '1:1', refresh: false });
    assert(exact.cacheStatus === 'HIT', 'exact desktop');

    const sub = resolve({ fileKey, nodeId: '3:1', refresh: false });
    assert(sub.cacheStatus === 'SUBTREE', `expected SUBTREE got ${sub.cacheStatus}`);
    assert(sub.snap.document.id === '3:1', 'pricing root');
    assert(sub.snap.document.name === 'Pricing', 'pricing name');

    const refresh = resolve({ fileKey, nodeId: '3:1', refresh: true });
    assert(refresh.cacheStatus === 'MISS', 'refresh bypass');

    const { prepareFigmaSources } = require('../index');
    const restCounter = { n: 0 };
    const prepared = await prepareFigmaSources({
      fileKey,
      nodeId: '3:1',
      auth: { token: 'test', oauth: false },
      refresh: false,
      restCounter,
      t0: Date.now(),
      userKey: 'test',
    });
    assert(prepared.cacheStatus === 'SUBTREE', 'prepare subtree');
    assert(restCounter.n === 0, '0 REST');
    assert(prepared.authz.outcome === 'Allow', 'budget allow');
    assert(prepared.plan.action === 'offline_compile', 'offline plan');
    assert(prepared.document && prepared.document.id === '3:1', 'doc');

    // compile integration — HTML for Pricing
    const { compile } = require('../../../compiler/compile');
    const outDir = path.join(cacheDir, 'out-pricing');
    const compiled = await compile({
      document: prepared.document,
      graphId: 'g:test:pricing',
      policyProfileId: 'pixel-faithful',
      title: 'Pricing',
      slug: 'pricing-test',
      outDir,
      imageUrls: {},
      imageFillUrls: {},
      svgMarkup: {},
      fonts: [],
      downloadImages: false,
      useCache: false,
    });
    assert(compiled.artifacts && compiled.artifacts.html, 'html');
    assert(/9|Price|Pricing/i.test(compiled.artifacts.html), 'pricing content');

    rmrf(cacheDir);
    rmrf(process.env.FIGMA_BUDGET_DIR);
    delete process.env.FIGMA_CACHE_DIR;
    delete process.env.FIGMA_BUDGET_DIR;
  });

  await test('integration: Hero extract from Desktop snap', async () => {
    const cacheDir = tmpRoot('hero');
    process.env.FIGMA_CACHE_DIR = cacheDir;
    delete require.cache[require.resolve('../../figma-snapshot')];
    delete require.cache[require.resolve('../cache-resolver')];
    const fileKey = 'HeroFileKey0000000000000000';
    writeMinimalSnapshot(cacheDir, fileKey, '1:1', landingDocument());
    const { resolve } = require('../cache-resolver');
    const hero = resolve({ fileKey, nodeId: '2:1', refresh: false });
    assert(hero.cacheStatus === 'SUBTREE', 'hero subtree');
    assert(hero.snap.document.name === 'Hero', 'hero name');
    rmrf(cacheDir);
    delete process.env.FIGMA_CACHE_DIR;
  });

  // ── Snapshot extract / validation ──────────────────────────────────────
  await test('snapshot: extractSubtree + filterAssets', () => {
    const snap = require('../../figma-snapshot');
    const doc = landingDocument();
    const pricing = snap.extractSubtree(doc, '3:1');
    assert(pricing && pricing.id === '3:1', 'extract');
    const parentSnap = {
      document: doc,
      imageFillsRemote: { abc: 'https://example.com/a.png' },
      pngRemote: { '3:2': 'https://example.com/b.png', '2:5': 'https://example.com/c.png' },
      svgFallback: {},
      urlToAbs: {},
      meta: { nodeId: '1:1' },
    };
    const filtered = snap.filterAssetsForSubtree(parentSnap, pricing);
    assert(!filtered.pngRemote['2:5'], 'hero png excluded');
  });

  await test('snapshot: validate rejects incomplete', () => {
    const dir = tmpRoot('bad-snap');
    const snapDir = path.join(dir, 'x__1_1');
    fs.mkdirSync(snapDir, { recursive: true });
    process.env.FIGMA_CACHE_DIR = dir;
    delete require.cache[require.resolve('../../figma-snapshot')];
    const { validateSnapshot } = require('../../figma-snapshot');
    const v = validateSnapshot(snapDir);
    assert(v.ok === false, 'incomplete');
    rmrf(dir);
    delete process.env.FIGMA_CACHE_DIR;
  });

  // ── Regression: compile fixture stable ─────────────────────────────────
  await test('regression: compile fixture HTML stable fingerprint', async () => {
    const { compile } = require('../../../compiler/compile');
    const doc = landingDocument();
    const outA = tmpRoot('reg-a');
    const outB = tmpRoot('reg-b');
    const opts = {
      document: doc,
      graphId: 'g:reg',
      policyProfileId: 'pixel-faithful',
      title: 'Desktop',
      slug: 'reg-desktop',
      imageUrls: {},
      imageFillUrls: {},
      svgMarkup: {},
      fonts: [],
      downloadImages: false,
      useCache: false,
    };
    const a = await compile({ ...opts, outDir: outA });
    const b = await compile({ ...opts, outDir: outB });
    assert(a.artifacts.html === b.artifacts.html, 'html identical');
    assert(
      a.fingerprint.emitPlanChecksum === b.fingerprint.emitPlanChecksum,
      'emit checksum'
    );
    rmrf(outA);
    rmrf(outB);
  });

  // ── Executor fromSnapshot opacity ──────────────────────────────────────
  await test('executor: fromSnapshot shape', () => {
    const { fromSnapshot } = require('../executor');
    const src = fromSnapshot({
      document: { id: '1', name: 'N' },
      name: 'N',
      imageFillsRemote: {},
      pngRemote: {},
      svgFallback: {},
      urlToAbs: { u: '/tmp/x' },
    });
    assert(src.document.id === '1', 'doc');
    assert(src.fetchedMeta === null, 'no meta');
    assert(src.localByUrl.u === '/tmp/x', 'local');
  });

  const ok = summary();
  process.exit(ok ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
