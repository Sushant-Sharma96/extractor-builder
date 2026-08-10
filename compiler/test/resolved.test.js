'use strict';

/**
 * Phase 17 — ResolvedIR composition tests.
 */
const { materializeNormalizedDesignGraph } = require('../ndg');
const { materializeLayoutIR } = require('../layout');
const { materializeComponentIR } = require('../components');
const { materializeTokenIR } = require('../tokens');
const { materializeSemanticIR } = require('../semantic');
const {
  materializeResolvedIR,
  BUILDER_VERSION,
  STAGE_ID,
  resolvedIrChecksum,
} = require('../resolved');
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
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
    children: [
      {
        id: 'hdr',
        type: 'FRAME',
        name: 'Header',
        fills: fill({ r: 0.9, g: 0.9, b: 0.9, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
        children: [],
      },
      {
        id: 'btn',
        type: 'FRAME',
        name: 'Button',
        fills: fill({ r: 0.2, g: 0.4, b: 0.9, a: 1 }),
        absoluteBoundingBox: { x: 8, y: 60, width: 80, height: 32 },
        children: [],
      },
    ],
  };
}

async function seedDomain(ws, graphId) {
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
  await materializeComponentIR({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    sliceId: `slice:component:${graphId}`,
  });
  await materializeTokenIR({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    sliceId: `slice:token:${graphId}`,
  });
  await materializeSemanticIR({
    workspace: ws,
    policy: { profileId: 'semantic-lean' },
    sliceId: `slice:semantic:${graphId}`,
  });
}

async function main() {
  await test('compose ResolvedIR from slices — immutable', async () => {
    const ws = createWorkspace();
    await seedDomain(ws, 'g-res');
    const out = await materializeResolvedIR({
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      sliceId: 'slice:resolved:g-res',
    });
    assert(out.slice.stageId === STAGE_ID, 'stage');
    assert(Object.isFrozen(out.slice), 'frozen');
    assert(out.slice.payload.contractId === 'ResolvedIR', 'cid');
    assert(out.slice.payload.slices.length >= 1, 'slices');
    assert(out.checksum === resolvedIrChecksum(out.slice.payload), 'cs');
    assert(ws.getIrSlice('slice:resolved:g-res'), 'published');
    // does not mutate layout
    assert(ws.getIrSlice('slice:layout:g-res'), 'layout intact');
  });

  await test('tolerates missing asset/behavior', async () => {
    const ws = createWorkspace();
    await seedDomain(ws, 'g-miss');
    const out = await materializeResolvedIR({
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      sliceId: 'slice:resolved:g-miss',
    });
    assert(out.missingStages.some((m) => m.stageId === 'asset-ir'), 'asset missing');
    assert(out.missingStages.some((m) => m.stageId === 'behavior-ir'), 'behavior missing');
    assert(out.slice.payload.slices.every((s) => s.stageId !== 'asset-ir'), 'no asset slice');
  });

  await test('Kernel projectResolvedIR + fingerprint', async () => {
    const kernel = createKernel({ policyProfileId: 'pixel-faithful' });
    const job = kernel.createJob({});
    await job.materializeNormalizedDesignGraph({ document: sampleDoc(), graphId: 'g-kern' });
    await job.projectLayoutIR({ sliceId: 'slice:layout:g-kern' });
    await job.projectSemanticIR({ sliceId: 'slice:semantic:g-kern' });
    const out = await job.projectResolvedIR({ sliceId: 'slice:resolved:g-kern' });
    const fp = job.getFingerprint();
    assert(fp.resolvedIrChecksum === out.checksum, 'fp');
    assert(fp.resolvedBuilderVersion === BUILDER_VERSION, 'bv');
    assert(fp.resolvedSliceId === out.sliceId, 'slice');
    assertNoHiddenFingerprintFields(fp);
  });

  await test('deterministic + idempotent', async () => {
    const run = async () => {
      const ws = createWorkspace();
      await seedDomain(ws, 'g-idem');
      return materializeResolvedIR({
        workspace: ws,
        policy: { profileId: 'pixel-faithful' },
        sliceId: 'slice:resolved:g-idem',
      });
    };
    const a = await run();
    const b = await run();
    assert(a.checksum === b.checksum, 'cs');
  });

  await test('fingerprint key includes resolved fields', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'pixel-faithful',
      resolvedIrChecksum: 'r1',
      resolvedBuilderVersion: '1.0.0',
      resolvedSliceId: 's',
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'pixel-faithful',
      resolvedSliceId: 's',
      resolvedBuilderVersion: '1.0.0',
      resolvedIrChecksum: 'r1',
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
