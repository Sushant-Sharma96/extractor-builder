'use strict';

/**
 * Phase 13 — Design Token Engine tests.
 */
const {
  detectTokens,
  projectTokenIR,
  materializeTokenIR,
  BUILDER_VERSION,
  STAGE_ID,
  tokenIrChecksum,
} = require('../tokens');
const { materializeNormalizedDesignGraph } = require('../ndg');
const { createWorkspace } = require('../workspace');
const { createKernel } = require('../kernel');
const { buildFingerprint, fingerprintKey, assertNoHiddenFingerprintFields } = require('../kernel/fingerprint');
const {
  createRulePackRegistry,
  loadTokenDetectPack,
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

/** Shared color + spacing → tokens; unique literal unbound. */
function tokenDoc() {
  const shared = { r: 0.2, g: 0.4, b: 0.8, a: 1 };
  return {
    id: 'root',
    type: 'FRAME',
    layoutMode: 'VERTICAL',
    itemSpacing: 8,
    fills: [{ type: 'SOLID', color: shared }],
    styles: { fill: 'style-primary' },
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    children: [
      {
        id: 'a',
        type: 'FRAME',
        itemSpacing: 8,
        fills: [{ type: 'SOLID', color: shared }],
        absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 40 },
        children: [],
      },
      {
        id: 'b',
        type: 'FRAME',
        itemSpacing: 8,
        fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }],
        absoluteBoundingBox: { x: 0, y: 48, width: 80, height: 40 },
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
  await test('detect — shared color/spacing tokens + literals', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, tokenDoc(), 'g-det');
    const d = detectTokens(ndg.graph, {});
    assert(d.tokens.some((t) => t.kind === 'color'), 'color tok');
    assert(d.tokens.some((t) => t.kind === 'spacing'), 'space tok');
    assert(d.tokens.some((t) => t.kind === 'style'), 'style tok');
    assert(d.bindings.length >= 1, 'bindings');
    assert(d.metrics.tokenCount >= 1, 'metrics');
    assert(typeof d.metrics.tokenRate === 'number', 'rate');
  });

  await test('project TokenIR — immutable + checksum', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, tokenDoc(), 'g-proj');
    const out = projectTokenIR(ndg.graph, { sliceId: 'slice:token:g-proj' });
    assert(out.slice.stageId === STAGE_ID, 'stage');
    assert(Object.isFrozen(out.slice), 'frozen');
    assert(out.checksum === tokenIrChecksum(out.slice.payload), 'cs');
    const raw = JSON.stringify(out.slice.payload);
    assert(!raw.includes('display:'), 'no css');
  });

  await test('materialize + Fact/IrSlice', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, tokenDoc(), 'g-mat');
    const out = await materializeTokenIR({
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      sliceId: 'slice:token:g-mat',
    });
    assert(ws.getIrSlice('slice:token:g-mat'), 'slice');
    const fact = ws.listIds('Fact').map((id) => ws.getFact(id))
      .find((f) => f.kind === 'token.ir');
    assert(fact && fact.assertion.checksum === out.checksum, 'fact');
  });

  await test('Decision — token.bind updates binding', async () => {
    const { StoreKind } = require('../workspace');
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, tokenDoc(), 'g-dec');
    const d0 = detectTokens(ndg.graph, {});
    const lit = d0.unboundLiterals.find((u) => u.kind === 'color');
    assert(lit, 'need unbound color');
    const tokenId = d0.tokens.find((t) => t.kind === 'color').tokenId;

    ws.putDecision({
      contractId: 'DecisionRecord',
      suiteVersion: '1.0.0',
      id: 'dec:tok:1',
      decisionId: 'dec:tok:1',
      question: 'token.bind',
      subject: lit.nodeId,
      status: 'arbitrated',
      candidates: [
        {
          candidateId: 'cand:bind:1',
          answer: {
            bind: true,
            nodeId: lit.nodeId,
            property: lit.property,
            tokenId,
          },
        },
      ],
      winner: { kind: 'candidate', candidateId: 'cand:bind:1' },
      evidence: [],
      scores: [],
      ranking: [],
      policy: { profileId: 'semantic-lean', profileVersion: null },
      alternatives_kept: [],
      trace_refs: [],
    }, { id: 'decision-runtime', capabilities: { writes: [StoreKind.DECISION, StoreKind.TRACE] } });

    const out = await materializeTokenIR({
      workspace: ws,
      policy: { profileId: 'semantic-lean' },
      sliceId: 'slice:token:g-dec',
    });
    const bound = out.slice.payload.bindings.find(
      (b) => b.nodeId === lit.nodeId && b.property === lit.property && b.tokenId === tokenId
    );
    assert(bound && bound.confidence === 'decision', 'decision bind');
  });

  await test('Rule Pack token.detect', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, tokenDoc(), 'g-pack');
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadTokenDetectPack();
    reg.register(pack, handlers);
    const out = await reg.execute('token.detect', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      suiteVersion: '1.0.0',
    });
    assert(out.evidence.some((e) => e.ref === 'token.signal' || e.ref === 'token.ambiguous'), 'ev');
    assert(ws.listIds('DecisionRecord').length === 0, 'no decide');
  });

  await test('Kernel projectTokenIR + fingerprint', async () => {
    const kernel = createKernel({ policyProfileId: 'pixel-faithful' });
    const job = kernel.createJob({});
    await job.materializeNormalizedDesignGraph({
      document: tokenDoc(),
      graphId: 'g-kern',
    });
    const out = await job.projectTokenIR({ sliceId: 'slice:token:g-kern' });
    const fp = job.getFingerprint();
    assert(fp.tokenIrChecksum === out.checksum, 'fp');
    assert(fp.tokenBuilderVersion === BUILDER_VERSION, 'bv');
    assert(fp.tokenSliceId === out.sliceId, 'slice');
    assertNoHiddenFingerprintFields(fp);
  });

  await test('deterministic + idempotent', async () => {
    const run = async () => {
      const ws = createWorkspace();
      await seedNdg(ws, tokenDoc(), 'g-idem');
      return materializeTokenIR({
        workspace: ws,
        policy: { profileId: 'pixel-faithful' },
        sliceId: 'slice:token:g-idem',
      });
    };
    const a = await run();
    const b = await run();
    assert(a.checksum === b.checksum, 'cs');
  });

  await test('policy — pixel-faithful pack still proposes without commit', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, tokenDoc(), 'g-pol');
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadTokenDetectPack();
    reg.register(pack, handlers);
    await reg.execute('token.detect', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      suiteVersion: '1.0.0',
    });
    assert(ws.listIds('DecisionRecord').length === 0, 'no commit');
  });

  await test('fingerprint key includes token fields', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'pixel-faithful',
      tokenIrChecksum: 't1',
      tokenBuilderVersion: '1.0.0',
      tokenSliceId: 's',
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'pixel-faithful',
      tokenSliceId: 's',
      tokenBuilderVersion: '1.0.0',
      tokenIrChecksum: 't1',
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
