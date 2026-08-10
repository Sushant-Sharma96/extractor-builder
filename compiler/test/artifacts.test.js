'use strict';

/**
 * Product integration — compile() → artifacts (HTML/CSS/JS).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { compile } = require('../compile');

let passed = 0;
let failed = 0;

function pass(name) {
  passed += 1;
  console.log(`PASS  ${name}`);
}
function fail(name, err) {
  failed += 1;
  console.error(`FAIL  ${name} — ${err && err.message ? err.message : err}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => pass(name))
    .catch((e) => fail(name, e));
}

const fill = (c) => [{ type: 'SOLID', color: c }];

function sampleDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Page',
    layoutMode: 'VERTICAL',
    itemSpacing: 8,
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 240 },
    children: [
      {
        id: 'hdr',
        type: 'FRAME',
        name: 'Header',
        fills: fill({ r: 0.9, g: 0.9, b: 0.9, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 48 },
        children: [
          {
            id: 'ttl',
            type: 'TEXT',
            name: 'Title',
            characters: 'Hello',
            style: { fontSize: 28 },
            fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
            absoluteBoundingBox: { x: 8, y: 8, width: 100, height: 32 },
          },
        ],
      },
      {
        id: 'btn',
        type: 'FRAME',
        name: 'Button',
        fills: fill({ r: 0.2, g: 0.4, b: 0.9, a: 1 }),
        absoluteBoundingBox: { x: 8, y: 180, width: 100, height: 36 },
        children: [],
      },
    ],
  };
}

async function main() {
  await test('compile produces HTML/CSS/JS artifacts in memory', async () => {
    const result = await compile({
      document: sampleDoc(),
      graphId: 'g:art-mem',
      policyProfileId: 'pixel-faithful',
    });
    assert(result.ok, 'ok');
    assert(result.emitPlan, 'emit plan');
    assert(result.artifacts, 'artifacts');
    assert(result.artifacts.html && result.artifacts.html.includes('<!doctype html>'), 'html');
    assert(result.artifacts.css && result.artifacts.css.includes('.canvas'), 'css');
    assert(typeof result.artifacts.js === 'string', 'js');
    assert(result.artifacts.html.includes('styles.css'), 'css link');
    assert(result.artifacts.html.includes('script.js'), 'js link');
    assert(result.steps.some((s) => s.stage === 'artifacts'), 'artifacts step');
  });

  await test('compile writes browser-ready output directory', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'le-compile-'));
    const result = await compile({
      document: sampleDoc(),
      graphId: 'g:art-disk',
      policyProfileId: 'pixel-faithful',
      outDir,
      title: 'Artifact Test',
      slug: path.basename(outDir),
      downloadImages: false,
      useCache: false,
    });
    assert(result.artifacts.dir, 'dir');
    assert(fs.existsSync(path.join(outDir, 'index.html')), 'index.html');
    assert(fs.existsSync(path.join(outDir, 'styles.css')), 'styles.css');
    assert(fs.existsSync(path.join(outDir, 'script.js')), 'script.js');
    const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert(html.includes('Artifact Test'), 'title');
    assert(!html.includes('undefined'), 'no undefined');
  });

  await test('lightweight fingerprint cache reuses artifacts', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'le-cache-'));
    const opts = {
      document: sampleDoc(),
      graphId: 'g:art-cache',
      policyProfileId: 'pixel-faithful',
      outDir,
      slug: path.basename(outDir),
      downloadImages: false,
      useCache: true,
    };
    const a = await compile(opts);
    const b = await compile(opts);
    assert(a.artifacts.artifactFingerprint === b.artifacts.artifactFingerprint, 'fp match');
    assert(b.artifacts.cached === true, 'second run cached');
  });

  await test('engines.artifacts false stops at EmitPlan', async () => {
    const result = await compile({
      document: sampleDoc(),
      graphId: 'g:no-art',
      policyProfileId: 'pixel-faithful',
      engines: { artifacts: false },
    });
    assert(result.emitPlan, 'emit');
    assert(result.artifacts === null, 'no artifacts');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
