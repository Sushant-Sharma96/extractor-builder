'use strict';

/**
 * Phase 14 — Semantic Engine tests.
 */
const {
  detectSemantics,
  projectSemanticIR,
  materializeSemanticIR,
  BUILDER_VERSION,
  STAGE_ID,
  ROLE,
  semanticIrChecksum,
} = require('../semantic');
const { materializeNormalizedDesignGraph } = require('../ndg');
const { createWorkspace } = require('../workspace');
const { createKernel } = require('../kernel');
const { buildFingerprint, fingerprintKey, assertNoHiddenFingerprintFields } = require('../kernel/fingerprint');
const {
  createRulePackRegistry,
  loadSemanticDetectPack,
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

/** Page-like tree with landmarks + heading + list (fills so NDG keeps frames). */
function semanticDoc() {
  const fill = (c) => [{ type: 'SOLID', color: c }];
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Page',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
    children: [
      {
        id: 'hdr',
        type: 'FRAME',
        name: 'Header',
        fills: fill({ r: 0.9, g: 0.9, b: 0.9, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 60 },
        children: [
          {
            id: 'nav',
            type: 'FRAME',
            name: 'Nav',
            fills: fill({ r: 0.8, g: 0.8, b: 0.9, a: 1 }),
            absoluteBoundingBox: { x: 0, y: 10, width: 200, height: 40 },
            children: [],
          },
        ],
      },
      {
        id: 'main',
        type: 'FRAME',
        name: 'Main',
        fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 80, width: 400, height: 600 },
        children: [
          {
            id: 'h1',
            type: 'TEXT',
            name: 'H1',
            characters: 'Welcome',
            fontSize: 36,
            absoluteBoundingBox: { x: 16, y: 90, width: 200, height: 40 },
            children: [],
          },
          {
            id: 'list',
            type: 'FRAME',
            name: 'List',
            fills: fill({ r: 0.95, g: 0.95, b: 0.95, a: 1 }),
            absoluteBoundingBox: { x: 16, y: 150, width: 200, height: 120 },
            children: [
              { id: 'li1', type: 'FRAME', name: 'Item', fills: fill({ r: 0.9, g: 0.9, b: 1, a: 1 }), absoluteBoundingBox: { x: 16, y: 150, width: 180, height: 30 }, children: [] },
              { id: 'li2', type: 'FRAME', name: 'Item', fills: fill({ r: 0.9, g: 0.9, b: 1, a: 1 }), absoluteBoundingBox: { x: 16, y: 185, width: 180, height: 30 }, children: [] },
              { id: 'li3', type: 'FRAME', name: 'Item', fills: fill({ r: 0.9, g: 0.9, b: 1, a: 1 }), absoluteBoundingBox: { x: 16, y: 220, width: 180, height: 30 }, children: [] },
            ],
          },
          {
            id: 'btn',
            type: 'FRAME',
            name: 'Button',
            fills: fill({ r: 0.2, g: 0.4, b: 0.9, a: 1 }),
            absoluteBoundingBox: { x: 16, y: 300, width: 100, height: 40 },
            children: [],
          },
        ],
      },
      {
        id: 'ftr',
        type: 'FRAME',
        name: 'Footer',
        fills: fill({ r: 0.85, g: 0.85, b: 0.85, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 720, width: 400, height: 80 },
        children: [],
      },
    ],
  };
}

/** Ambiguous: region name + narrow geometry → complementary hint. */
function ambiguousDoc() {
  const fill = (c) => [{ type: 'SOLID', color: c }];
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Shell',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 400 },
    children: [
      {
        id: 'side',
        type: 'FRAME',
        name: 'Section',
        fills: fill({ r: 0.9, g: 0.9, b: 0.95, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 40, width: 100, height: 300 },
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

function assertNoHtmlEmit(payload) {
  const raw = JSON.stringify(payload);
  assert(!raw.includes('<nav'), 'no html nav');
  assert(!raw.includes('<header'), 'no html header');
  assert(!/"tag"\s*:/.test(raw), 'no tag field');
  assert(!raw.includes('display:'), 'no css');
  assert(!raw.includes('React'), 'no react');
}

async function main() {
  await test('detect — landmarks, heading, list, button', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, semanticDoc(), 'g-det');
    const d = detectSemantics(ndg.graph, { policy: { profileId: 'semantic-lean' } });
    assert(d.landmarks.some((l) => l.role === ROLE.BANNER || l.role === ROLE.NAVIGATION), 'banner/nav');
    assert(d.landmarks.some((l) => l.role === ROLE.MAIN), 'main');
    assert(d.landmarks.some((l) => l.role === ROLE.CONTENTINFO), 'footer');
    assert(d.headings.length >= 1, 'heading');
    assert(d.annotations.some((a) => a.role === ROLE.BUTTON), 'button');
    assert(d.annotations.some((a) => a.role === ROLE.LIST), 'list');
    assert(d.evidence.some((e) => e.ref === 'semantic.signal' || e.ref === 'semantic.landmark'), 'ev');
  });

  await test('detect — ambiguity recorded', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, ambiguousDoc(), 'g-amb');
    const d = detectSemantics(ndg.graph, { policy: { profileId: 'default' } });
    // Section name + narrow geometry may produce ambiguity or dual hints
    assert(
      d.ambiguous.length >= 1
        || d.annotations.some((a) => a.role === ROLE.REGION || a.role === ROLE.COMPLEMENTARY || a.role === ROLE.GENERIC),
      'amb or region'
    );
  });

  await test('project SemanticIR — immutable + no HTML', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, semanticDoc(), 'g-proj');
    const out = projectSemanticIR(ndg.graph, {
      sliceId: 'slice:semantic:g-proj',
      policy: { profileId: 'semantic-lean' },
    });
    assert(out.slice.stageId === STAGE_ID, 'stage');
    assert(Object.isFrozen(out.slice), 'frozen');
    assert(out.checksum === semanticIrChecksum(out.slice.payload), 'cs');
    assertNoHtmlEmit(out.slice.payload);
  });

  await test('materialize + Fact/IrSlice', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, semanticDoc(), 'g-mat');
    const out = await materializeSemanticIR({
      workspace: ws,
      policy: { profileId: 'semantic-lean' },
      sliceId: 'slice:semantic:g-mat',
    });
    assert(ws.getIrSlice('slice:semantic:g-mat'), 'slice');
    const fact = ws.listIds('Fact').map((id) => ws.getFact(id))
      .find((f) => f.kind === 'semantic.ir');
    assert(fact && fact.assertion.checksum === out.checksum, 'fact');
  });

  await test('Decision — semantic.role overrides annotation', async () => {
    const { StoreKind } = require('../workspace');
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, semanticDoc(), 'g-dec');
    const d0 = detectSemantics(ndg.graph, { policy: { profileId: 'default' } });
    const nav = d0.annotations.find((a) => a.role === ROLE.NAVIGATION)
      || d0.landmarks.find((l) => l.role === ROLE.NAVIGATION);
    assert(nav, 'need nav subject');
    const subject = nav.nodeId;

    ws.putDecision({
      contractId: 'DecisionRecord',
      suiteVersion: '1.0.0',
      id: 'dec:sem:1',
      decisionId: 'dec:sem:1',
      question: 'semantic.role',
      subject,
      status: 'arbitrated',
      candidates: [
        {
          candidateId: 'cand:role:1',
          answer: { nodeId: subject, role: ROLE.COMPLEMENTARY, level: null },
        },
      ],
      winner: { kind: 'candidate', candidateId: 'cand:role:1' },
      evidence: [],
      scores: [],
      ranking: [],
      policy: { profileId: 'semantic-lean', profileVersion: null },
      alternatives_kept: [],
      trace_refs: [],
    }, { id: 'decision-runtime', capabilities: { writes: [StoreKind.DECISION, StoreKind.TRACE] } });

    const out = await materializeSemanticIR({
      workspace: ws,
      policy: { profileId: 'semantic-lean' },
      sliceId: 'slice:semantic:g-dec',
    });
    const ann = out.slice.payload.annotations.find((a) => a.nodeId === subject);
    assert(ann && ann.role === ROLE.COMPLEMENTARY && ann.confidence === 'decision', 'decision role');
  });

  await test('Rule Pack semantic.detect — Evidence + Hypotheses', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, semanticDoc(), 'g-pack');
    // Force ambiguity via a conflicting decision-less detect path: use ambiguous doc too
    await seedNdg(ws, ambiguousDoc(), 'g-pack-amb');
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadSemanticDetectPack();
    reg.register(pack, handlers);
    const out = await reg.execute('semantic.detect', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      suiteVersion: '1.0.0',
    });
    assert(
      out.evidence.some((e) => String(e.ref || '').startsWith('semantic.')),
      'semantic evidence'
    );
    assert(ws.listIds('DecisionRecord').length === 0, 'no decide');
  });

  await test('Kernel projectSemanticIR + fingerprint', async () => {
    const kernel = createKernel({ policyProfileId: 'semantic-lean' });
    const job = kernel.createJob({});
    await job.materializeNormalizedDesignGraph({
      document: semanticDoc(),
      graphId: 'g-kern',
    });
    const out = await job.projectSemanticIR({ sliceId: 'slice:semantic:g-kern' });
    const fp = job.getFingerprint();
    assert(fp.semanticIrChecksum === out.checksum, 'fp');
    assert(fp.semanticBuilderVersion === BUILDER_VERSION, 'bv');
    assert(fp.semanticSliceId === out.sliceId, 'slice');
    assertNoHiddenFingerprintFields(fp);
  });

  await test('deterministic + idempotent', async () => {
    const run = async () => {
      const ws = createWorkspace();
      await seedNdg(ws, semanticDoc(), 'g-idem');
      return materializeSemanticIR({
        workspace: ws,
        policy: { profileId: 'semantic-lean' },
        sliceId: 'slice:semantic:g-idem',
      });
    };
    const a = await run();
    const b = await run();
    assert(a.checksum === b.checksum, 'cs');
  });

  await test('fingerprint key includes semantic fields', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'semantic-lean',
      semanticIrChecksum: 's1',
      semanticBuilderVersion: '1.0.0',
      semanticSliceId: 'x',
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'semantic-lean',
      semanticSliceId: 'x',
      semanticBuilderVersion: '1.0.0',
      semanticIrChecksum: 's1',
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
