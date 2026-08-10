'use strict';

/**
 * Phase 5 (docs/COMPILER_MIGRATION_BLUEPRINT.md, NARROWED per explicit user decision:
 * toggle only, no cutover, no deletions) — proves `emitArtifacts()`'s new `opts.renderer`
 * flag:
 *
 *  (a) omitting the flag, or passing 'legacy' explicitly, is byte-identical to
 *      `emitArtifacts()`'s pre-existing (pre-this-phase) behavior — the single most
 *      important regression proof in this file;
 *  (b) passing 'ir-experimental' actually reaches the new NDG -> geometry/component/
 *      layout/responsive -> materializeHtml() pipeline and returns real, non-empty
 *      HTML/CSS for a small fixture, in the same return shape;
 *  (c) the two paths produce genuinely DIFFERENT output — proving the flag switches
 *      real behavior rather than silently falling through to legacy.
 */
const assert = require('assert');
const { emitArtifacts, stampDataNodeIds } = require('../artifacts');
const { applyPlanToTree } = require('../artifacts/apply-plan');
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
  // --- (a) default-path regression proof -----------------------------------------
  await test('emitArtifacts: omitting opts.renderer is identical to passing "legacy" explicitly', async () => {
    const document = sampleDoc();
    const base = { document, title: 'Toggle Test', useCache: false };
    const omitted = await emitArtifacts({ ...base });
    const explicitLegacy = await emitArtifacts({ ...base, renderer: 'legacy' });
    assert.strictEqual(omitted.html, explicitLegacy.html, 'html identical');
    assert.strictEqual(omitted.css, explicitLegacy.css, 'css identical');
    assert.strictEqual(omitted.js, explicitLegacy.js, 'js identical');
    assert.strictEqual(omitted.artifactFingerprint, explicitLegacy.artifactFingerprint, 'fingerprint identical');
  });

  await test('emitArtifacts: legacy renderer output matches pre-flag figmaBuild.analyze()+emit() call path', async () => {
    // Direct regression proof against the underlying legacy emitter itself (not just
    // "the flag didn't change anything relative to itself") — confirms the code path
    // emitArtifacts() takes by default is still exactly server/figma-build.js's
    // analyze()+emit(), unmodified.
    const figmaBuild = require('../../server/figma-build');
    const document = sampleDoc();
    const result = await emitArtifacts({ document, title: 'Toggle Test', useCache: false });

    const analyzed = figmaBuild.analyze(document, { emitMode: 'auto' });
    applyPlanToTree(analyzed.tree, {});
    stampDataNodeIds(analyzed.tree);
    figmaBuild.polishGeneratedTree(analyzed.tree);
    const emitted = figmaBuild.emit(analyzed.tree, { title: 'Toggle Test', fonts: analyzed.fonts || [] });
    assert.strictEqual(result.html, emitted.html, 'html matches raw figmaBuild path');
  });

  await test('compile(): omitting options.renderer produces artifacts identical to renderer:"legacy"', async () => {
    const a = await compile({
      document: sampleDoc(),
      graphId: 'g:renderer-toggle-a',
      policyProfileId: 'pixel-faithful',
    });
    const b = await compile({
      document: sampleDoc(),
      graphId: 'g:renderer-toggle-b',
      policyProfileId: 'pixel-faithful',
      renderer: 'legacy',
    });
    assert.strictEqual(a.artifacts.html, b.artifacts.html, 'compile() html identical');
    assert.strictEqual(a.artifacts.css, b.artifacts.css, 'compile() css identical');
  });

  // --- (b) opt-in path reaches real new-pipeline output ---------------------------
  await test('emitArtifacts: renderer "ir-experimental" returns real, non-empty HTML/CSS', async () => {
    const document = sampleDoc();
    const result = await emitArtifacts({ document, title: 'Toggle Test', renderer: 'ir-experimental' });
    assert.strictEqual(result.ok, true, 'ok');
    assert.strictEqual(typeof result.html, 'string', 'html is string');
    assert.strictEqual(typeof result.css, 'string', 'css is string');
    assert(result.html.length > 0, 'html non-empty');
    assert(result.css.length > 0, 'css non-empty');
    assert(result.html.includes('Hello'), 'html carries through real text content');
    assert(result.html.includes('<!doctype html>') || result.html.includes('<!DOCTYPE html>'), 'real document shell');
    // Same return-shape contract as the legacy branch — opt-in callers need no
    // special-case handling beyond passing the flag.
    for (const key of ['ok', 'cached', 'artifactFingerprint', 'html', 'css', 'js', 'sections', 'fonts', 'analyzed', 'emitMode', 'dir', 'paths', 'package', 'timings', 'summary']) {
      assert(key in result, `result has "${key}" key`);
    }
  });

  await test('compile(): options.renderer "ir-experimental" reaches the new renderer end-to-end', async () => {
    const result = await compile({
      document: sampleDoc(),
      graphId: 'g:renderer-toggle-ir',
      policyProfileId: 'pixel-faithful',
      renderer: 'ir-experimental',
    });
    assert(result.artifacts, 'artifacts present');
    assert.strictEqual(result.artifacts.ok, true, 'ok');
    assert(result.artifacts.html.length > 0, 'html non-empty');
    assert(result.artifacts.css.length > 0, 'css non-empty');
    assert(result.artifacts.html.includes('Hello'), 'text content present');
  });

  // --- (c) the two paths are genuinely different ----------------------------------
  await test('emitArtifacts: "legacy" and "ir-experimental" produce different HTML/CSS for the same document', async () => {
    const document = sampleDoc();
    const legacy = await emitArtifacts({ document, title: 'Toggle Test', renderer: 'legacy', useCache: false });
    const experimental = await emitArtifacts({ document, title: 'Toggle Test', renderer: 'ir-experimental' });
    assert.notStrictEqual(legacy.html, experimental.html, 'html differs between renderers');
    assert.notStrictEqual(legacy.css, experimental.css, 'css differs between renderers');
    assert.notStrictEqual(legacy.artifactFingerprint, experimental.artifactFingerprint, 'fingerprint differs between renderers');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
