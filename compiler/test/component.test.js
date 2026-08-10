'use strict';

/**
 * Phase 12 — Component Engine tests.
 */
const path = require('path');
const {
  detectComponents,
  projectComponentIR,
  materializeComponentIR,
  BUILDER_VERSION,
  STAGE_ID,
  componentIrChecksum,
} = require('../components');
const { materializeNormalizedDesignGraph } = require('../ndg');
const { createWorkspace } = require('../workspace');
const { createKernel } = require('../kernel');
const { buildFingerprint, fingerprintKey, assertNoHiddenFingerprintFields } = require('../kernel/fingerprint');
const {
  createRulePackRegistry,
  loadComponentDetectPack,
} = require('../rulepack');
const { createPluginRegistry } = require('../plugin');

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

function componentDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    layoutMode: 'VERTICAL',
    fills: [{ type: 'SOLID' }],
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 120 },
    children: [
      {
        id: 'btn-def',
        type: 'COMPONENT',
        name: 'Button',
        componentKey: 'key-btn',
        fills: [{ type: 'SOLID' }],
        absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 32 },
        children: [
          {
            id: 'btn-label',
            type: 'TEXT',
            characters: 'OK',
            absoluteBoundingBox: { x: 8, y: 8, width: 40, height: 16 },
          },
        ],
      },
      {
        id: 'btn-a',
        type: 'INSTANCE',
        name: 'Button Instance A',
        mainComponent: 'key-btn',
        overrides: [{ id: 'text', field: 'characters', value: 'Submit' }],
        fills: [{ type: 'SOLID' }],
        absoluteBoundingBox: { x: 0, y: 40, width: 80, height: 32 },
        children: [],
      },
      {
        id: 'btn-b',
        type: 'INSTANCE',
        name: 'Button Instance B',
        mainComponent: 'key-btn',
        fills: [{ type: 'SOLID' }],
        absoluteBoundingBox: { x: 0, y: 80, width: 80, height: 32 },
        children: [],
      },
      {
        id: 'orphan-inst',
        type: 'INSTANCE',
        name: 'Orphan',
        mainComponent: 'missing-key',
        fills: [{ type: 'SOLID' }],
        absoluteBoundingBox: { x: 100, y: 40, width: 40, height: 20 },
        children: [],
      },
    ],
  };
}

async function seedNdg(ws, document, graphId) {
  return materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    document,
    graphId,
  });
}

async function main() {
  await test('detect — definitions, instances, orphans', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, componentDoc(), 'g-det');
    const detected = detectComponents(ndg.graph, { layoutDegraded: true });
    assert(detected.definitions.length === 1, 'defs');
    assert(detected.definitions[0].defId === 'key-btn', 'defId');
    assert(detected.instances.length === 2, 'instances');
    assert(detected.orphans.length === 1, 'orphan');
    assert(detected.evidence.some((e) => e.ref === 'component.instance'), 'ev');
  });

  await test('docs/COMPILER_REDESIGN_ROADMAP.md Phase 2.5 — override VALUES (not just key names) are extracted, and claimedNodeIds contains exactly the declared component/instance identities (never an orphan, never a geometric-pattern-only node)', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, componentDoc(), 'g-det-values');
    const detected = detectComponents(ndg.graph, { layoutDegraded: true });

    const instA = detected.instances.find((i) => i.nodeId.endsWith('btn-a') || i.sourceNodeId === 'btn-a');
    assert(instA, 'instance btn-a found');
    assert(Array.isArray(instA.overrideEntries) && instA.overrideEntries.length === 1, 'exactly 1 override entry');
    assert(instA.overrideEntries[0].key === 'text', 'override entry key extracted');
    assert(instA.overrideEntries[0].value === 'Submit', 'override entry VALUE extracted, not just the key name (Research Part 5\'s confirmed gap)');

    const instB = detected.instances.find((i) => i.sourceNodeId === 'btn-b');
    assert(instB && instB.overrideEntries.length === 0, 'instance with no overrides gets an empty array, not undefined');

    assert(detected.claimedNodeIds.length === 3, 'claimedNodeIds has exactly 1 definition + 2 resolved instances');
    const claimedSource = detected.claimedNodeIds.map((id) => {
      const node = ndg.graph.nodes.find((n) => n.id === id);
      return node && node.sourceNodeId;
    }).sort();
    assert(JSON.stringify(claimedSource) === JSON.stringify(['btn-a', 'btn-b', 'btn-def']), 'claimedNodeIds is exactly {def, both resolved instances} — the unresolved orphan is NOT claimed');
  });

  await test('project ComponentIR — immutable + checksum', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, componentDoc(), 'g-proj');
    const out = projectComponentIR(ndg.graph, {
      layoutDegraded: true,
      sliceId: 'slice:component:g-proj',
    });
    assert(out.slice.stageId === STAGE_ID, 'stage');
    assert(out.slice.payload.instances.length === 2, 'inst');
    assert(Array.isArray(out.slice.payload.claimedNodeIds) && out.slice.payload.claimedNodeIds.length === 3, 'claimedNodeIds (Phase 2.5) survives into the published payload, not just the in-memory detector result');
    assert(Object.isFrozen(out.slice), 'frozen');
    assert(out.checksum === componentIrChecksum(out.slice.payload), 'cs');
    const raw = JSON.stringify(out.slice.payload);
    assert(!raw.includes('display:'), 'no css');
    assert(!raw.includes('React'), 'no react');
  });

  await test('materialize + Workspace Fact/IrSlice', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, componentDoc(), 'g-mat');
    const out = await materializeComponentIR({
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      skipLayout: true,
      sliceId: 'slice:component:g-mat',
    });
    assert(ws.getIrSlice('slice:component:g-mat'), 'slice');
    const fact = ws.listIds('Fact').map((id) => ws.getFact(id))
      .find((f) => f.kind === 'component.ir');
    assert(fact && fact.assertion.checksum === out.checksum, 'fact');
  });

  await test('Decision — flatten treatment in flattenPlan', async () => {
    const { StoreKind } = require('../workspace');
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, componentDoc(), 'g-dec');
    const detected0 = detectComponents(ndg.graph, { layoutDegraded: true });
    const nodeId = detected0.instances[0].nodeId;
    ws.putDecision({
      contractId: 'DecisionRecord',
      suiteVersion: '1.0.0',
      id: 'dec:comp:1',
      decisionId: 'dec:comp:1',
      question: 'component.instanceTreatment',
      subject: nodeId,
      status: 'arbitrated',
      candidates: [
        {
          candidateId: `cand:component.treatment:${nodeId}:flatten`,
          answer: { treatment: 'flatten', defId: 'key-btn' },
        },
      ],
      winner: { kind: 'candidate', candidateId: `cand:component.treatment:${nodeId}:flatten` },
      evidence: [],
      scores: [],
      ranking: [],
      policy: { profileId: 'semantic-lean', profileVersion: null },
      alternatives_kept: [],
      trace_refs: [],
    }, { id: 'decision-runtime', capabilities: { writes: [StoreKind.DECISION, StoreKind.TRACE] } });

    const out = await materializeComponentIR({
      workspace: ws,
      policy: { profileId: 'semantic-lean' },
      skipLayout: true,
      sliceId: 'slice:component:g-dec',
    });
    assert(out.slice.payload.flattenPlan.some((f) => f.nodeId === nodeId), 'flatten');
    const inst = out.slice.payload.instances.find((i) => i.nodeId === nodeId);
    assert(inst.treatment === 'flatten', 'treatment');
  });

  await test('Rule Pack component.detect', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, componentDoc(), 'g-pack');
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadComponentDetectPack();
    reg.register(pack, handlers);
    const out = await reg.execute('component.detect', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      suiteVersion: '1.0.0',
    });
    assert(out.hypotheses.some((h) => h.question === 'component.instanceTreatment'), 'treat');
    assert(out.hypotheses.some((h) => h.question === 'component.reuse'), 'reuse');
    assert(ws.listIds('DecisionRecord').length === 0, 'no decide');
  });

  await test('Kernel projectComponentIR + fingerprint', async () => {
    const kernel = createKernel({ policyProfileId: 'pixel-faithful' });
    const job = kernel.createJob({});
    await job.materializeNormalizedDesignGraph({
      document: componentDoc(),
      graphId: 'g-kern',
    });
    const out = await job.projectComponentIR({
      skipLayout: true,
      sliceId: 'slice:component:g-kern',
    });
    const fp = job.getFingerprint();
    assert(fp.componentIrChecksum === out.checksum, 'fp cs');
    assert(fp.componentBuilderVersion === BUILDER_VERSION, 'fp bv');
    assert(fp.componentSliceId === out.sliceId, 'fp slice');
    assertNoHiddenFingerprintFields(fp);
  });

  await test('deterministic + idempotent', async () => {
    const run = async () => {
      const ws = createWorkspace();
      await seedNdg(ws, componentDoc(), 'g-idem');
      return materializeComponentIR({
        workspace: ws,
        policy: { profileId: 'pixel-faithful' },
        skipLayout: true,
        sliceId: 'slice:component:g-idem',
      });
    };
    const a = await run();
    const b = await run();
    assert(a.checksum === b.checksum, 'checksum');
  });

  await test('NDG unchanged after component project', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, componentDoc(), 'g-safe');
    const before = JSON.stringify(ndg.graph.nodes.map((n) => n.id).sort());
    await materializeComponentIR({
      workspace: ws,
      policy: { profileId: 'default' },
      skipLayout: true,
    });
    const slice = ws.listIds('IrSlice').map((id) => ws.getIrSlice(id))
      .find((s) => s.stageId === 'normalized-design-graph');
    const after = JSON.stringify(slice.graph.nodes.map((n) => n.id).sort());
    assert(before === after, 'ndg ids');
  });

  await test('fingerprint key includes component fields', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'pixel-faithful',
      componentIrChecksum: 'abc',
      componentBuilderVersion: '1.0.0',
      componentSliceId: 's1',
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'pixel-faithful',
      componentSliceId: 's1',
      componentBuilderVersion: '1.0.0',
      componentIrChecksum: 'abc',
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
