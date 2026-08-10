'use strict';

/**
 * Phase 15 — Responsive Engine tests.
 */
const {
  detectResponsive,
  projectResponsiveIR,
  materializeResponsiveIR,
  BUILDER_VERSION,
  STAGE_ID,
  STRATEGY,
  responsiveIrChecksum,
} = require('../responsive');
const { materializeNormalizedDesignGraph } = require('../ndg');
const { createWorkspace } = require('../workspace');
const { createKernel } = require('../kernel');
const { buildFingerprint, fingerprintKey, assertNoHiddenFingerprintFields } = require('../kernel/fingerprint');
const {
  createRulePackRegistry,
  loadResponsiveDetectPack,
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

const fill = (c) => [{ type: 'SOLID', color: c }];

/** Horizontal row with several children → stack/wrap candidates. */
function responsiveDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Page',
    layoutMode: 'VERTICAL',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 400 },
    children: [
      {
        id: 'row',
        type: 'FRAME',
        name: 'HeroRow',
        layoutMode: 'HORIZONTAL',
        fills: fill({ r: 0.95, g: 0.95, b: 1, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 200 },
        children: [
          { id: 'c1', type: 'FRAME', name: 'Card1', fills: fill({ r: 0.9, g: 0.9, b: 0.9, a: 1 }), absoluteBoundingBox: { x: 0, y: 0, width: 280, height: 180 }, children: [] },
          { id: 'c2', type: 'FRAME', name: 'Card2', fills: fill({ r: 0.9, g: 0.9, b: 0.9, a: 1 }), absoluteBoundingBox: { x: 300, y: 0, width: 280, height: 180 }, children: [] },
          { id: 'c3', type: 'FRAME', name: 'Card3', fills: fill({ r: 0.9, g: 0.9, b: 0.9, a: 1 }), absoluteBoundingBox: { x: 600, y: 0, width: 280, height: 180 }, children: [] },
          { id: 'c4', type: 'FRAME', name: 'Card4', fills: fill({ r: 0.9, g: 0.9, b: 0.9, a: 1 }), absoluteBoundingBox: { x: 900, y: 0, width: 280, height: 180 }, children: [] },
        ],
      },
      {
        id: 'col',
        type: 'FRAME',
        name: 'Stack',
        layoutMode: 'VERTICAL',
        fills: fill({ r: 1, g: 1, b: 0.95, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 220, width: 400, height: 160 },
        children: [
          { id: 's1', type: 'FRAME', name: 'Block1', fills: fill({ r: 0.85, g: 0.9, b: 0.85, a: 1 }), absoluteBoundingBox: { x: 0, y: 220, width: 400, height: 70 }, children: [] },
          { id: 's2', type: 'FRAME', name: 'Block2', fills: fill({ r: 0.85, g: 0.9, b: 0.85, a: 1 }), absoluteBoundingBox: { x: 0, y: 300, width: 400, height: 70 }, children: [] },
        ],
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

function assertNoCssEmit(payload) {
  const raw = JSON.stringify(payload);
  assert(!raw.includes('@media'), 'no media query');
  assert(!raw.includes('max-width:'), 'no css max-width');
  assert(!raw.includes('display:'), 'no css display');
  assert(!raw.includes('React'), 'no react');
}

async function main() {
  await test('detect — breakpoints + row adaptations', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, responsiveDoc(), 'g-det');
    const d = detectResponsive(ndg.graph, { policy: { profileId: 'default' } });
    assert(d.breakpoints.length === 3, '3 bps');
    assert(d.breakpoints.some((b) => b.kind === 'narrow'), 'narrow');
    assert(d.adaptations.length >= 1, 'adaptations');
    assert(
      d.adaptations.some((a) => [STRATEGY.STACK, STRATEGY.WRAP, STRATEGY.ABSTAIN, STRATEGY.ROW].includes(a.strategy)),
      'strategy'
    );
    assert(d.evidence.some((e) => e.ref === 'responsive.breakpoint'), 'bp ev');
    assert(d.evidence.some((e) => e.ref === 'responsive.adapt' || e.ref === 'responsive.signal'), 'adapt ev');
  });

  await test('detect — ambiguity on competing strategies', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, responsiveDoc(), 'g-amb');
    const d = detectResponsive(ndg.graph, { policy: { profileId: 'default' } });
    assert(
      d.ambiguous.length >= 1
        || d.adaptations.some((a) => a.strategy === STRATEGY.ABSTAIN || a.candidateStrategies),
      'ambiguous or abstain'
    );
  });

  await test('project ResponsiveIR — immutable + no CSS', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, responsiveDoc(), 'g-proj');
    const out = projectResponsiveIR(ndg.graph, {
      sliceId: 'slice:responsive:g-proj',
      policy: { profileId: 'default' },
    });
    assert(out.slice.stageId === STAGE_ID, 'stage');
    assert(Object.isFrozen(out.slice), 'frozen');
    assert(out.checksum === responsiveIrChecksum(out.slice.payload), 'cs');
    assertNoCssEmit(out.slice.payload);
  });

  await test('materialize + Fact/IrSlice', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, responsiveDoc(), 'g-mat');
    const out = await materializeResponsiveIR({
      workspace: ws,
      policy: { profileId: 'default' },
      sliceId: 'slice:responsive:g-mat',
    });
    assert(ws.getIrSlice('slice:responsive:g-mat'), 'slice');
    const fact = ws.listIds('Fact').map((id) => ws.getFact(id))
      .find((f) => f.kind === 'responsive.ir');
    assert(fact && fact.assertion.checksum === out.checksum, 'fact');
  });

  await test('Decision — responsive.strategy overrides adaptation', async () => {
    const { StoreKind } = require('../workspace');
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, responsiveDoc(), 'g-dec');
    const d0 = detectResponsive(ndg.graph, { policy: { profileId: 'default' } });
    const subject = (d0.adaptations[0] && d0.adaptations[0].nodeId)
      || (d0.ambiguous[0] && d0.ambiguous[0].nodeId);
    assert(subject, 'need subject');

    ws.putDecision({
      contractId: 'DecisionRecord',
      suiteVersion: '1.0.0',
      id: 'dec:resp:1',
      decisionId: 'dec:resp:1',
      question: 'responsive.strategy',
      subject,
      status: 'arbitrated',
      candidates: [
        {
          candidateId: 'cand:strat:1',
          answer: {
            nodeId: subject,
            strategy: STRATEGY.WRAP,
            atBreakpointIds: ['bp:narrow'],
          },
        },
      ],
      winner: { kind: 'candidate', candidateId: 'cand:strat:1' },
      evidence: [],
      scores: [],
      ranking: [],
      policy: { profileId: 'semantic-lean', profileVersion: null },
      alternatives_kept: [],
      trace_refs: [],
    }, { id: 'decision-runtime', capabilities: { writes: [StoreKind.DECISION, StoreKind.TRACE] } });

    const out = await materializeResponsiveIR({
      workspace: ws,
      policy: { profileId: 'semantic-lean' },
      sliceId: 'slice:responsive:g-dec',
    });
    const ad = out.slice.payload.adaptations.find((a) => a.nodeId === subject);
    assert(ad && ad.strategy === STRATEGY.WRAP && ad.confidence === 'decision', 'decision strat');
  });

  await test('Rule Pack responsive.detect — Evidence + Hypotheses', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, responsiveDoc(), 'g-pack');
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadResponsiveDetectPack();
    reg.register(pack, handlers);
    const out = await reg.execute('responsive.detect', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      suiteVersion: '1.0.0',
    });
    assert(
      out.evidence.some((e) => String(e.ref || '').startsWith('responsive.')),
      'responsive evidence'
    );
    assert(out.hypotheses.length >= 1, 'hypotheses');
    assert(ws.listIds('DecisionRecord').length === 0, 'no decide');
  });

  await test('Kernel projectResponsiveIR + fingerprint', async () => {
    const kernel = createKernel({ policyProfileId: 'pixel-faithful' });
    const job = kernel.createJob({});
    await job.materializeNormalizedDesignGraph({
      document: responsiveDoc(),
      graphId: 'g-kern',
    });
    const out = await job.projectResponsiveIR({ sliceId: 'slice:responsive:g-kern' });
    const fp = job.getFingerprint();
    assert(fp.responsiveIrChecksum === out.checksum, 'fp');
    assert(fp.responsiveBuilderVersion === BUILDER_VERSION, 'bv');
    assert(fp.responsiveSliceId === out.sliceId, 'slice');
    assertNoHiddenFingerprintFields(fp);
  });

  await test('deterministic + idempotent', async () => {
    const run = async () => {
      const ws = createWorkspace();
      await seedNdg(ws, responsiveDoc(), 'g-idem');
      return materializeResponsiveIR({
        workspace: ws,
        policy: { profileId: 'default' },
        sliceId: 'slice:responsive:g-idem',
      });
    };
    const a = await run();
    const b = await run();
    assert(a.checksum === b.checksum, 'cs');
  });

  await test('fingerprint key includes responsive fields', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'pixel-faithful',
      responsiveIrChecksum: 'r1',
      responsiveBuilderVersion: '1.0.0',
      responsiveSliceId: 'x',
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'pixel-faithful',
      responsiveSliceId: 'x',
      responsiveBuilderVersion: '1.0.0',
      responsiveIrChecksum: 'r1',
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
