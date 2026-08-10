'use strict';

/**
 * Phase 19 — compile() end-to-end tests.
 */
const { compile } = require('../compile');
const { assertNoHiddenFingerprintFields } = require('../kernel/fingerprint');

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
        children: [],
      },
      {
        id: 'row',
        type: 'FRAME',
        name: 'HeroRow',
        layoutMode: 'HORIZONTAL',
        fills: fill({ r: 0.95, g: 0.95, b: 1, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 56, width: 320, height: 100 },
        children: [
          {
            id: 'c1',
            type: 'FRAME',
            name: 'Card',
            fills: fill({ r: 0.85, g: 0.85, b: 0.9, a: 1 }),
            absoluteBoundingBox: { x: 8, y: 60, width: 140, height: 80 },
            children: [],
          },
          {
            id: 'c2',
            type: 'FRAME',
            name: 'Card',
            fills: fill({ r: 0.85, g: 0.85, b: 0.9, a: 1 }),
            absoluteBoundingBox: { x: 160, y: 60, width: 140, height: 80 },
            children: [],
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
  await test('compile Raw → EmitPlan end-to-end', async () => {
    const result = await compile({
      document: sampleDoc(),
      graphId: 'g:e2e',
      policyProfileId: 'pixel-faithful',
      engines: { artifacts: false },
    });
    assert(result.ok === true, 'ok');
    assert(result.resolved && result.resolved.sliceId, 'resolved');
    assert(result.emitPlan && result.emitPlan.sliceId, 'emit');
    assert(result.fingerprint, 'fp');
    assert(result.fingerprint.ndgChecksum, 'ndg fp');
    assert(result.fingerprint.resolvedIrChecksum === result.resolved.checksum, 'res fp');
    assert(result.fingerprint.emitPlanChecksum === result.emitPlan.checksum, 'emit fp');
    assertNoHiddenFingerprintFields(result.fingerprint);

    const stages = result.steps.map((s) => s.stage);
    assert(stages.includes('ndg'), 'ndg step');
    assert(stages.includes('layout-ir'), 'layout');
    assert(stages.includes('resolved-ir'), 'resolved step');
    assert(stages.includes('emit-plan'), 'emit step');

    const ws = result.job.attachWorkspace();
    assert(ws.getIrSlice(result.resolved.sliceId), 'resolved published');
    assert(ws.getIrSlice(result.emitPlan.sliceId), 'emit published');
    const emit = ws.getIrSlice(result.emitPlan.sliceId);
    assert(emit.payload.classStrategy.mode === 'exporter-neutral', 'neutral');
    assert(!JSON.stringify(emit.payload).includes('React.createElement'), 'no react');
  });

  await test('compile tolerates optional engines off', async () => {
    const result = await compile({
      document: sampleDoc(),
      graphId: 'g:min',
      policyProfileId: 'pixel-faithful',
      engines: {
        layout: true,
        constraint: false,
        component: false,
        token: false,
        semantic: false,
        responsive: false,
        accessibility: false,
        resolved: true,
        emit: true,
        artifacts: false,
      },
    });
    assert(result.ok, 'ok');
    assert(result.resolved, 'resolved');
    assert(result.emitPlan, 'emit');
    assert(!result.steps.some((s) => s.stage === 'component-ir'), 'no component');
  });

  await test('compile deterministic fingerprint for same doc', async () => {
    const a = await compile({
      document: sampleDoc(),
      graphId: 'g:det',
      policyProfileId: 'pixel-faithful',
      engines: {
        layout: true,
        constraint: false,
        component: true,
        token: true,
        semantic: true,
        responsive: true,
        accessibility: true,
        resolved: true,
        emit: true,
        artifacts: false,
      },
    });
    const b = await compile({
      document: sampleDoc(),
      graphId: 'g:det',
      policyProfileId: 'pixel-faithful',
      engines: {
        layout: true,
        constraint: false,
        component: true,
        token: true,
        semantic: true,
        responsive: true,
        accessibility: true,
        resolved: true,
        emit: true,
        artifacts: false,
      },
    });
    assert(a.resolved.checksum === b.resolved.checksum, 'resolved cs');
    assert(a.emitPlan.checksum === b.emitPlan.checksum, 'emit cs');
  });

  await test('compile with artifacts produces HTML', async () => {
    const result = await compile({
      document: sampleDoc(),
      graphId: 'g:with-art',
      policyProfileId: 'pixel-faithful',
    });
    assert(result.artifacts && result.artifacts.html.includes('<!doctype html>'), 'html');
    assert(result.artifacts.css.includes('.canvas'), 'css');
  });

  await test('compile(): renderer "ir-experimental" recovers pure-geometry row recognition through the real Kernel LayoutIR (docs/COMPILER_REDESIGN_ROADMAP.md Kernel Integration, slice 2 — regression guard for a real gap found and fixed while verifying this slice: compile.js was not passing recognitionHintsByNode into job.projectLayoutIR(), so a container with NO declared layoutMode that only geometry recognition can classify as a row was silently falling back to unknown/absolute)', async () => {
    const doc = {
      id: 'page',
      type: 'FRAME',
      name: 'Page',
      fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
      absoluteBoundingBox: { x: 0, y: 0, width: 220, height: 120 },
      children: [{
        id: 'georow',
        type: 'FRAME',
        name: 'GeoRow',
        fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
        absoluteBoundingBox: { x: 10, y: 10, width: 200, height: 60 },
        children: [
          {
            id: 'georowa', type: 'FRAME', name: 'A', fills: fill({ r: 1, g: 0, b: 0, a: 1 }), absoluteBoundingBox: { x: 10, y: 10, width: 50, height: 50 }, children: [],
          },
          {
            id: 'georowb', type: 'FRAME', name: 'B', fills: fill({ r: 0, g: 1, b: 0, a: 1 }), absoluteBoundingBox: { x: 70, y: 10, width: 50, height: 50 }, children: [],
          },
        ],
      }],
    };
    const result = await compile({
      document: doc, graphId: 'g:kernel-integration-geo-row', renderer: 'ir-experimental', useCache: false,
    });
    const css = result.artifacts.css;
    const rule = /\.georow\s*\{([^}]*)\}/.exec(css);
    assert(rule, 'a CSS rule for the geometry-only row container exists');
    assert(/display:\s*flex/.test(rule[1]), 'geometry-only row recognition reaches display:flex through the real Kernel LayoutIR path (no declared layoutMode at all)');
    assert(/flex-direction:\s*row/.test(rule[1]), 'and specifically flex-direction:row, not a column/absolute fallback');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
