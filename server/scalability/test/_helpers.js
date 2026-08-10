'use strict';
/**
 * Shared helpers for scalability hardening tests.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

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

function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed === 0;
}

function tmpRoot(prefix) {
  const dir = path.join(os.tmpdir(), `figma-hard-${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Minimal desktop frame: Desktop > Hero > Pricing */
function landingDocument() {
  return {
    id: '1:1',
    type: 'FRAME',
    name: 'Desktop',
    layoutMode: 'VERTICAL',
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
    children: [
      {
        id: '2:1',
        type: 'FRAME',
        name: 'Hero',
        absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 },
        fills: [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 1, a: 1 } }],
        children: [
          {
            id: '2:5',
            type: 'TEXT',
            name: 'HeroTitle',
            characters: 'Welcome',
            style: { fontSize: 24, fontFamily: 'Inter', fontWeight: 700 },
            absoluteBoundingBox: { x: 16, y: 16, width: 200, height: 32 },
            fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
            children: [],
          },
        ],
      },
      {
        id: '3:1',
        type: 'FRAME',
        name: 'Pricing',
        absoluteBoundingBox: { x: 0, y: 220, width: 400, height: 200 },
        fills: [{ type: 'SOLID', color: { r: 0.95, g: 1, b: 0.95, a: 1 } }],
        children: [
          {
            id: '3:2',
            type: 'TEXT',
            name: 'Price',
            characters: '$9',
            style: { fontSize: 20, fontFamily: 'Inter', fontWeight: 600 },
            absoluteBoundingBox: { x: 16, y: 236, width: 80, height: 28 },
            fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
            children: [],
          },
        ],
      },
    ],
  };
}

/**
 * Write a validated offline snapshot without network downloads
 * (empty remote maps → no asset files required beyond url-local {}).
 */
function writeMinimalSnapshot(cacheDir, fileKey, nodeId, document, metaExtra = {}) {
  const key = `${fileKey}__${(nodeId || 'root').replace(/[^\w.-]/g, '_')}`;
  const dir = path.join(cacheDir, key);
  fs.mkdirSync(path.join(dir, 'assets', 'fills'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'png'), { recursive: true });
  const pkg = require('../../../package.json');
  const write = (name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2));
  write('document.json', {
    document,
    name: document.name || 'test',
    fileName: 'test',
    version: '1',
  });
  write('image-fills.remote.json', {});
  write('image-fills.json', {});
  write('png-remote.json', {});
  write('png-ids.json', {});
  write('svg-fallback.json', {});
  write('url-local.json', {});
  write('metadata.json', {
    schemaVersion: 1,
    compilerVersion: pkg.version || '2.0.0',
    fileKey,
    nodeId,
    rootNodeId: nodeId,
    kind: metaExtra.kind || 'page',
    coverageType: metaExtra.coverageType || 'FRAME',
    name: document.name,
    figmaVersion: '1',
    fetchedAt: new Date().toISOString(),
    complete: true,
  });
  return dir;
}

module.exports = {
  pass,
  fail,
  assert,
  test,
  summary,
  get counts() { return { passed, failed }; },
  resetCounts() { passed = 0; failed = 0; },
  tmpRoot,
  rmrf,
  landingDocument,
  writeMinimalSnapshot,
};
