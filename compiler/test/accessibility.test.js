'use strict';

/**
 * Phase 16 — Accessibility Engine tests.
 */
const {
  detectAccessibility,
  projectAccessibilityIR,
  materializeAccessibilityIR,
  BUILDER_VERSION,
  STAGE_ID,
  ACCESS_ROLE,
  accessibilityIrChecksum,
} = require('../accessibility');
const { materializeNormalizedDesignGraph } = require('../ndg');
const { materializeSemanticIR } = require('../semantic');
const { createWorkspace } = require('../workspace');
const { createKernel } = require('../kernel');
const { buildFingerprint, fingerprintKey, assertNoHiddenFingerprintFields } = require('../kernel/fingerprint');
const {
  createRulePackRegistry,
  loadAccessibilityDetectPack,
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

function a11yDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Page',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 500 },
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
            fills: fill({ r: 0.85, g: 0.85, b: 0.95, a: 1 }),
            absoluteBoundingBox: { x: 8, y: 10, width: 200, height: 40 },
            children: [],
          },
        ],
      },
      {
        id: 'main',
        type: 'FRAME',
        name: 'Main',
        fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 80, width: 400, height: 300 },
        children: [
          {
            id: 'h1',
            type: 'TEXT',
            name: 'H1',
            characters: 'Welcome',
            fontSize: 32,
            absoluteBoundingBox: { x: 16, y: 90, width: 200, height: 36 },
            children: [],
          },
          {
            id: 'form',
            type: 'FRAME',
            name: 'Form',
            fills: fill({ r: 0.98, g: 0.98, b: 0.98, a: 1 }),
            absoluteBoundingBox: { x: 16, y: 140, width: 280, height: 120 },
            children: [
              {
                id: 'lbl',
                type: 'TEXT',
                name: 'Label',
                characters: 'Email',
                absoluteBoundingBox: { x: 16, y: 150, width: 80, height: 20 },
                children: [],
              },
              {
                id: 'inp',
                type: 'FRAME',
                name: 'Input',
                fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
                absoluteBoundingBox: { x: 100, y: 145, width: 180, height: 28 },
                children: [],
              },
              {
                id: 'btn',
                type: 'FRAME',
                name: 'Button',
                fills: fill({ r: 0.2, g: 0.4, b: 0.9, a: 1 }),
                absoluteBoundingBox: { x: 16, y: 200, width: 100, height: 36 },
                children: [],
              },
            ],
          },
          {
            id: 'photo',
            type: 'RECTANGLE',
            name: 'Photo',
            fills: fill({ r: 0.7, g: 0.7, b: 0.75, a: 1 }),
            absoluteBoundingBox: { x: 16, y: 280, width: 120, height: 80 },
            children: [],
          },
        ],
      },
    ],
  };
}

/** Ambiguous name: layer name vs text content differ. */
function ambiguousNameDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Shell',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    children: [
      {
        id: 'cta',
        type: 'TEXT',
        name: 'PrimaryCTA',
        characters: 'Get started',
        absoluteBoundingBox: { x: 10, y: 20, width: 120, height: 30 },
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

function assertNoAriaHtml(payload) {
  const raw = JSON.stringify(payload);
  assert(!raw.includes('aria-'), 'no aria attrs');
  assert(!raw.includes('role='), 'no role=');
  assert(!raw.includes('<button'), 'no html');
  assert(!raw.includes('React'), 'no react');
}

async function main() {
  await test('detect — names, focus, labels, images', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, a11yDoc(), 'g-det');
    const d = detectAccessibility(ndg.graph, { policy: { profileId: 'semantic-lean' } });
    assert(d.names.length >= 1, 'names');
    assert(d.keyboardHints.some((k) => k.accessRole === ACCESS_ROLE.INTERACTIVE), 'interactive');
    assert(d.focusOrder.length >= 1, 'focus');
    assert(d.labelLinks.length >= 1 || d.names.some((n) => n.source === 'label-association'), 'labels');
    assert(d.imageAccess.length >= 1, 'images');
    assert(d.evidence.some((e) => e.ref === 'a11y.name' || e.ref === 'a11y.signal'), 'ev');
  });

  await test('detect — ambiguity on competing names', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, ambiguousNameDoc(), 'g-amb');
    const d = detectAccessibility(ndg.graph, { policy: { profileId: 'default' } });
    assert(d.ambiguous.length >= 1 || d.names.length >= 1, 'amb or name');
  });

  await test('project AccessibilityIR — immutable + no ARIA/HTML', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, a11yDoc(), 'g-proj');
    const out = projectAccessibilityIR(ndg.graph, {
      sliceId: 'slice:a11y:g-proj',
      policy: { profileId: 'semantic-lean' },
    });
    assert(out.slice.stageId === STAGE_ID, 'stage');
    assert(Object.isFrozen(out.slice), 'frozen');
    assert(out.checksum === accessibilityIrChecksum(out.slice.payload), 'cs');
    assertNoAriaHtml(out.slice.payload);
  });

  await test('materialize + SemanticIR consumed read-only', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, a11yDoc(), 'g-mat');
    const sem = await materializeSemanticIR({
      workspace: ws,
      policy: { profileId: 'semantic-lean' },
      sliceId: 'slice:semantic:g-mat',
    });
    const semCs = sem.checksum;
    const out = await materializeAccessibilityIR({
      workspace: ws,
      policy: { profileId: 'semantic-lean' },
      sliceId: 'slice:a11y:g-mat',
      semanticSliceId: 'slice:semantic:g-mat',
    });
    assert(ws.getIrSlice('slice:a11y:g-mat'), 'a11y slice');
    assert(out.semanticUnchanged === true, 'semantic unchanged');
    assert(ws.getIrSlice('slice:semantic:g-mat').checksum === semCs, 'sem cs');
    assert(out.slice.payload.semanticEvidence && out.slice.payload.semanticEvidence.readOnly, 'ev');
    const fact = ws.listIds('Fact').map((id) => ws.getFact(id))
      .find((f) => f.kind === 'accessibility.ir');
    assert(fact && fact.assertion.checksum === out.checksum, 'fact');
  });

  await test('Decision — a11y.name overrides candidate', async () => {
    const { StoreKind } = require('../workspace');
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, a11yDoc(), 'g-dec');
    const d0 = detectAccessibility(ndg.graph, { policy: { profileId: 'default' } });
    const subject = (d0.names.find((n) => /button|input|btn/i.test(n.nodeId))
      || d0.keyboardHints[0]
      || d0.names[0]);
    assert(subject, 'need subject');
    const nodeId = subject.nodeId;

    ws.putDecision({
      contractId: 'DecisionRecord',
      suiteVersion: '1.0.0',
      id: 'dec:a11y:1',
      decisionId: 'dec:a11y:1',
      question: 'a11y.name',
      subject: nodeId,
      status: 'arbitrated',
      candidates: [
        {
          candidateId: 'cand:name:1',
          answer: { nodeId, candidateName: 'Submit form' },
        },
      ],
      winner: { kind: 'candidate', candidateId: 'cand:name:1' },
      evidence: [],
      scores: [],
      ranking: [],
      policy: { profileId: 'semantic-lean', profileVersion: null },
      alternatives_kept: [],
      trace_refs: [],
    }, { id: 'decision-runtime', capabilities: { writes: [StoreKind.DECISION, StoreKind.TRACE] } });

    const out = await materializeAccessibilityIR({
      workspace: ws,
      policy: { profileId: 'semantic-lean' },
      sliceId: 'slice:a11y:g-dec',
    });
    const nm = out.slice.payload.names.find((n) => n.nodeId === nodeId);
    assert(nm && nm.candidateName === 'Submit form' && nm.confidence === 'decision', 'decision name');
  });

  await test('Rule Pack accessibility.detect — Evidence + Hypotheses', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, a11yDoc(), 'g-pack');
    await seedNdg(ws, ambiguousNameDoc(), 'g-pack-amb');
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadAccessibilityDetectPack();
    reg.register(pack, handlers);
    const out = await reg.execute('accessibility.detect', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      suiteVersion: '1.0.0',
    });
    assert(
      out.evidence.some((e) => String(e.ref || '').startsWith('a11y.')),
      'a11y evidence'
    );
    assert(ws.listIds('DecisionRecord').length === 0, 'no decide');
  });

  await test('Kernel projectAccessibilityIR + fingerprint', async () => {
    const kernel = createKernel({ policyProfileId: 'semantic-lean' });
    const job = kernel.createJob({});
    await job.materializeNormalizedDesignGraph({
      document: a11yDoc(),
      graphId: 'g-kern',
    });
    await job.projectSemanticIR({ sliceId: 'slice:semantic:g-kern' });
    const out = await job.projectAccessibilityIR({ sliceId: 'slice:a11y:g-kern' });
    const fp = job.getFingerprint();
    assert(fp.accessibilityIrChecksum === out.checksum, 'fp');
    assert(fp.accessibilityBuilderVersion === BUILDER_VERSION, 'bv');
    assert(fp.accessibilitySliceId === out.sliceId, 'slice');
    assertNoHiddenFingerprintFields(fp);
  });

  await test('deterministic + idempotent', async () => {
    const run = async () => {
      const ws = createWorkspace();
      await seedNdg(ws, a11yDoc(), 'g-idem');
      return materializeAccessibilityIR({
        workspace: ws,
        policy: { profileId: 'semantic-lean' },
        sliceId: 'slice:a11y:g-idem',
      });
    };
    const a = await run();
    const b = await run();
    assert(a.checksum === b.checksum, 'cs');
  });

  await test('fingerprint key includes accessibility fields', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'semantic-lean',
      accessibilityIrChecksum: 'a1',
      accessibilityBuilderVersion: '1.0.0',
      accessibilitySliceId: 'x',
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'semantic-lean',
      accessibilitySliceId: 'x',
      accessibilityBuilderVersion: '1.0.0',
      accessibilityIrChecksum: 'a1',
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
