'use strict';

/**
 * Phase 18 — EmitPlan tests.
 */
const { materializeNormalizedDesignGraph } = require('../ndg');
const { materializeLayoutIR } = require('../layout');
const { materializeSemanticIR } = require('../semantic');
const { materializeResolvedIR } = require('../resolved');
const {
  materializeEmitPlan,
  BUILDER_VERSION,
  STAGE_ID,
  emitPlanChecksum,
} = require('../emit');
const { createWorkspace } = require('../workspace');
const { createKernel } = require('../kernel');
const { buildFingerprint, fingerprintKey, assertNoHiddenFingerprintFields } = require('../kernel/fingerprint');

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
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 120 },
    children: [
      {
        id: 'main',
        type: 'FRAME',
        name: 'Main',
        fills: fill({ r: 0.95, g: 0.95, b: 0.95, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 120 },
        children: [],
      },
    ],
  };
}

async function seedResolved(ws, graphId) {
  await materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    document: sampleDoc(),
    graphId,
  });
  await materializeLayoutIR({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    sliceId: `slice:layout:${graphId}`,
  });
  await materializeSemanticIR({
    workspace: ws,
    policy: { profileId: 'semantic-lean' },
    sliceId: `slice:semantic:${graphId}`,
  });
  return materializeResolvedIR({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    sliceId: `slice:resolved:${graphId}`,
  });
}

function assertNoCodeEmit(payload) {
  const raw = JSON.stringify(payload);
  assert(!raw.includes('<div'), 'no html');
  assert(!raw.includes('display:'), 'no css');
  assert(!raw.includes('React.createElement'), 'no react');
  assert(!raw.includes('@media'), 'no media');
}

async function main() {
  await test('EmitPlan from ResolvedIR — neutral plan', async () => {
    const ws = createWorkspace();
    const resolved = await seedResolved(ws, 'g-emit');
    const out = await materializeEmitPlan({
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      sliceId: 'slice:emit:g-emit',
      resolvedSliceId: resolved.sliceId,
    });
    assert(out.slice.stageId === STAGE_ID, 'stage');
    assert(Object.isFrozen(out.slice), 'frozen');
    assert(out.slice.payload.contractId === 'EmitPlan', 'cid');
    assert(out.slice.payload.resolvedId === resolved.resolvedId, 'resolved link');
    assert(out.slice.payload.classStrategy.mode === 'exporter-neutral', 'mode');
    assert(Array.isArray(out.slice.payload.classStrategy.renderOrder), 'render');
    assert(Array.isArray(out.slice.payload.classStrategy.dependencyOrder), 'deps');
    assert(out.slice.payload.classStrategy.chunkPlan, 'chunks');
    assert(out.checksum === emitPlanChecksum(out.slice.payload), 'cs');
    assertNoCodeEmit(out.slice.payload);
  });

  await test('missing ResolvedIR fails closed', async () => {
    const ws = createWorkspace();
    await materializeNormalizedDesignGraph({
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      document: sampleDoc(),
      graphId: 'g-fail',
    });
    let threw = false;
    try {
      await materializeEmitPlan({
        workspace: ws,
        policy: { profileId: 'pixel-faithful' },
        sliceId: 'slice:emit:g-fail',
      });
    } catch (e) {
      threw = true;
      assert(e.kind === 'missing_resolved' || /ResolvedIR/i.test(e.message), 'kind');
    }
    assert(threw, 'threw');
  });

  await test('Kernel projectEmitPlan + fingerprint', async () => {
    const kernel = createKernel({ policyProfileId: 'pixel-faithful' });
    const job = kernel.createJob({});
    await job.materializeNormalizedDesignGraph({ document: sampleDoc(), graphId: 'g-kern' });
    await job.projectLayoutIR({ sliceId: 'slice:layout:g-kern' });
    await job.projectResolvedIR({ sliceId: 'slice:resolved:g-kern' });
    const out = await job.projectEmitPlan({
      sliceId: 'slice:emit:g-kern',
      resolvedSliceId: 'slice:resolved:g-kern',
    });
    const fp = job.getFingerprint();
    assert(fp.emitPlanChecksum === out.checksum, 'fp');
    assert(fp.emitBuilderVersion === BUILDER_VERSION, 'bv');
    assert(fp.emitPlanSliceId === out.sliceId, 'slice');
    assertNoHiddenFingerprintFields(fp);
  });

  await test('deterministic + idempotent', async () => {
    const run = async () => {
      const ws = createWorkspace();
      const resolved = await seedResolved(ws, 'g-idem');
      return materializeEmitPlan({
        workspace: ws,
        policy: { profileId: 'pixel-faithful' },
        sliceId: 'slice:emit:g-idem',
        resolvedSliceId: resolved.sliceId,
      });
    };
    const a = await run();
    const b = await run();
    assert(a.checksum === b.checksum, 'cs');
  });

  await test('fingerprint key includes emit fields', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'pixel-faithful',
      emitPlanChecksum: 'e1',
      emitBuilderVersion: '1.0.0',
      emitPlanSliceId: 's',
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'pixel-faithful',
      emitPlanSliceId: 's',
      emitBuilderVersion: '1.0.0',
      emitPlanChecksum: 'e1',
    }));
    assert(a === b, 'order');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
