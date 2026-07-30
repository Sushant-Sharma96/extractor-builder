'use strict';

/**
 * Phase 11a — Layout Interpretation Core tests.
 */
const path = require('path');
const {
  interpretNode,
  interpretGraph,
  projectLayoutIR,
  materializeLayoutIR,
  loadNdgFromWorkspace,
  indexGraph,
  LAYOUT_MODES,
  BUILDER_VERSION,
  STAGE_ID,
  LayoutErrorKind,
  layoutIrChecksum,
} = require('../layout');
const { materializeNormalizedDesignGraph } = require('../ndg');
const { createWorkspace } = require('../workspace');
const { createKernel } = require('../kernel');
const { buildFingerprint, fingerprintKey } = require('../kernel/fingerprint');
const {
  createRulePackRegistry,
  loadLayoutInterpretPack,
} = require('../rulepack');
const { createPluginRegistry } = require('../plugin');

const LAYOUT_DIR = path.join(__dirname, '..', 'rulepack', 'packs', 'layout-interpret');

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

function flowDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    layoutMode: 'HORIZONTAL',
    itemSpacing: 8,
    paddingLeft: 4,
    fills: [{ type: 'SOLID' }],
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
    children: [
      {
        id: 'a',
        type: 'TEXT',
        characters: 'A',
        absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 20 },
      },
      {
        id: 'b',
        type: 'FRAME',
        layoutMode: 'VERTICAL',
        layoutPositioning: 'ABSOLUTE',
        fills: [{ type: 'SOLID' }],
        absoluteBoundingBox: { x: 50, y: 0, width: 40, height: 40 },
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
  await test('layout interpretation — flow-row / absolute / mixed', () => {
    const node = {
      id: 'src:root',
      sourceNodeId: 'root',
      attributes: { layoutMode: 'HORIZONTAL', itemSpacing: 8 },
      childIds: ['src:a', 'src:b'],
      box: { x: 0, y: 0, width: 200, height: 40 },
    };
    const kids = [
      { id: 'src:a', attributes: {}, box: { width: 40, height: 20 } },
      {
        id: 'src:b',
        attributes: { layoutPositioning: 'ABSOLUTE' },
        box: { width: 40, height: 40 },
      },
    ];
    const r = interpretNode(node, { childNodes: kids });
    assert(r.modeCandidates.some((c) => c.mode === 'flow-row'), 'row');
    assert(r.modeCandidates.some((c) => c.mode === 'mixed'), 'mixed');
    assert(r.outOfFlow.includes('src:b'), 'oof');
    assert(r.childOrder.includes('src:a'), 'order');
    assert(!JSON.stringify(r).includes('display:'), 'no css');
    assert(!JSON.stringify(r).includes('flex'), 'no flex word');
  });

  await test('nested layouts — per-node modes', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    await seedNdg(ws, {
      id: 'p',
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      fills: [{ type: 'SOLID' }],
      children: [
        {
          id: 'c',
          type: 'FRAME',
          layoutMode: 'HORIZONTAL',
          fills: [{ type: 'SOLID' }],
          children: [{ id: 't', type: 'TEXT', characters: 'x' }],
        },
      ],
    }, 'ndg:nest');
    const { graph } = loadNdgFromWorkspace(ws);
    const interps = interpretGraph(graph, indexGraph(graph));
    const parent = interps.find((i) => i.sourceNodeId === 'p');
    const child = interps.find((i) => i.sourceNodeId === 'c');
    assert(parent, 'parent interp');
    assert(child, 'child interp');
    assert(parent.modeCandidates[0].mode === 'flow-column', 'parent col');
    assert(child.modeCandidates[0].mode === 'flow-row', 'child row');
  });

  await test('evidence + hypothesis via rule pack', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    await seedNdg(ws, flowDoc(), 'ndg:pack');
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadLayoutInterpretPack();
    reg.register(pack, handlers);
    const out = await reg.execute('layout.interpret', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      suiteVersion: '1.0.0',
    });
    assert(out.evidence.length >= 1, 'ev');
    assert(out.hypotheses.some((h) => h.question === 'layout.mode'), 'mode hyp');
    assert(out.hypotheses.some((h) => h.question === 'layout.sizing'), 'sizing hyp');
    assert(out.candidates.some((c) => c.answer && c.answer.mode === 'flow-row'), 'cand');
    assert(ws.listIds('DecisionRecord').length === 0, 'no decide');
  });

  await test('LayoutIR generation — neutral vocabulary', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    await seedNdg(ws, flowDoc(), 'ndg:ir');
    const out = await materializeLayoutIR({
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
    });
    assert(out.slice.stageId === STAGE_ID, 'stage');
    assert(out.slice.payload.nodes.length >= 1, 'nodes');
    const modes = out.slice.payload.nodes.map((n) => n.mode);
    assert(modes.every((m) => LAYOUT_MODES.includes(m)), 'vocab');
    const raw = JSON.stringify(out.slice.payload);
    assert(!raw.includes('display:'), 'no css');
    assert(!raw.includes('React'), 'no react');
    assert(Object.isFrozen(out.slice), 'frozen');
  });

  await test('workspace + plugin integration', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    await seedNdg(ws, flowDoc(), 'ndg:ws');
    const out = await materializeLayoutIR({ workspace: ws, policy: { profileId: 'p' } });
    assert(ws.getIrSlice(out.sliceId) != null, 'slice');
    assert(ws.getFact(`fact:layout.ir:ndg:ws`) != null, 'fact');
    const ndgBefore = ws.getIrSlice(
      ws.listIds('IrSlice').find((id) => ws.getIrSlice(id).stageId === 'normalized-design-graph')
    );
    const ndgNodes = ndgBefore.graph.nodes.length;
    await materializeLayoutIR({ workspace: ws, policy: { profileId: 'p' } });
    assert(ws.getIrSlice(ndgBefore.sliceId).graph.nodes.length === ndgNodes, 'ndg immutable');
  });

  await test('Decision Runtime integration — decision wins modeSource', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    await seedNdg(ws, {
      id: 'only',
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      fills: [{ type: 'SOLID' }],
      children: [],
    }, 'ndg:dec');
    const { graph } = loadNdgFromWorkspace(ws);
    const nodeId = graph.nodes[0].id;

    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const loaded = loadLayoutInterpretPack();
    reg.register(loaded.pack, loaded.handlers);
    await reg.execute('layout.interpret', {
      workspace: ws,
      policy: {
        profileId: 'pixel-faithful',
        valuesAuthoritative: true,
        thresholds: {
          accept_min: 0.5,
          margin_min: 0.01,
          fallback_below: 0.2,
          pattern_name_cap: 0.35,
        },
      },
      suiteVersion: '1.0.0',
    });

    const hyp = ws.listIds('Hypothesis')
      .map((id) => ws.getHypothesis(id))
      .find((h) => h.question === 'layout.mode' && h.subject === nodeId);
    assert(hyp, 'hyp');
    const winnerCand = hyp.candidates.find((c) => c.answer.mode === 'flow-row');
    assert(winnerCand, 'flow-row cand');

    const { StoreKind } = require('../workspace');
    ws.putDecision({
      contractId: 'DecisionRecord',
      suiteVersion: '1.0.0',
      id: 'dec-layout-test',
      subject: nodeId,
      question: 'layout.mode',
      candidates: hyp.candidates,
      evidence: hyp.evidence,
      scores: hyp.candidates.map((c) => ({
        candidateId: c.candidateId,
        value: c.answer.mode === 'flow-row' ? 0.9 : 0.2,
      })),
      ranking: hyp.candidates.map((c) => c.candidateId),
      winner: {
        kind: 'candidate',
        candidateId: winnerCand.candidateId,
      },
      policy: { profileId: 'pixel-faithful', profileVersion: null },
      status: 'arbitrated',
      alternatives_kept: [],
      trace_refs: [],
    }, { id: 'decision-runtime', capabilities: { writes: [StoreKind.DECISION, StoreKind.TRACE] } });

    const out = await materializeLayoutIR({ workspace: ws, policy: { profileId: 'pixel-faithful' } });
    const n = out.slice.payload.nodes.find((x) => x.nodeId === nodeId);
    assert(n.mode === 'flow-row', 'mode');
    assert(n.modeSource === 'decision', 'source');
    assert(n.decisionIds.includes('dec-layout-test'), 'dec id');
  });

  await test('fingerprint stability', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      layoutIrChecksum: 'abc',
      layoutBuilderVersion: '1.0.0',
      layoutSliceId: 'slice:x',
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      layoutSliceId: 'slice:x',
      layoutBuilderVersion: '1.0.0',
      layoutIrChecksum: 'abc',
    }));
    assert(a === b, 'stable');
  });

  await test('deterministic + idempotent rebuild', async () => {
    const run = async () => {
      const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
      await seedNdg(ws, flowDoc(), 'ndg:det');
      return materializeLayoutIR({ workspace: ws, policy: { profileId: 'p' } });
    };
    const a = await run();
    const b = await run();
    assert(a.checksum === b.checksum, 'cs');
    assert(layoutIrChecksum(a.slice.payload) === a.checksum, 'match');

    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    await seedNdg(ws, flowDoc(), 'ndg:idem');
    const x = await materializeLayoutIR({ workspace: ws, policy: { profileId: 'p' } });
    const y = await materializeLayoutIR({ workspace: ws, policy: { profileId: 'p' } });
    assert(x.checksum === y.checksum, 'idem');
  });

  await test('provenance fields present', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    await seedNdg(ws, flowDoc(), 'ndg:prov');
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const loaded = loadLayoutInterpretPack();
    reg.register(loaded.pack, loaded.handlers);
    await reg.execute('layout.interpret', {
      workspace: ws,
      policy: { profileId: 'p' },
      suiteVersion: '1.0.0',
    });
    const out = await materializeLayoutIR({ workspace: ws, policy: { profileId: 'p' } });
    for (const n of out.slice.payload.nodes) {
      assert(n.nodeId, 'ndg id');
      assert('sourceNodeId' in n, 'source');
      assert(Array.isArray(n.evidenceIds), 'ev');
      assert(Array.isArray(n.decisionIds), 'dec');
    }
  });

  await test('missing NDG fails closed', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    let threw = false;
    try {
      await materializeLayoutIR({ workspace: ws, policy: { profileId: 'p' } });
    } catch (e) {
      threw = e.kind === LayoutErrorKind.MISSING_NDG;
    }
    assert(threw, 'missing');
  });

  await test('Kernel projectLayoutIR + load layout pack', async () => {
    const k = createKernel();
    k.loadRulePackDirectory(LAYOUT_DIR);
    const job = k.createJob({
      policyProfileId: 'pixel-faithful',
      seed: 'layout-k',
      jobId: 'job-layout',
    });
    await job.materializeNormalizedDesignGraph({
      document: flowDoc(),
      graphId: 'ndg:kern',
    });
    await job.executeRulePack('layout.interpret');
    const out = await job.projectLayoutIR();
    assert(out.checksum, 'cs');
    const fp = job.getFingerprint();
    assert(fp.layoutIrChecksum === out.checksum, 'fp');
    assert(fp.layoutBuilderVersion === BUILDER_VERSION, 'bv');
    assert(fp.ndgGraphId === 'ndg:kern', 'ndg kept');
  });

  await test('grid-track candidate when many children + gap', () => {
    const kids = [];
    for (let i = 0; i < 5; i += 1) {
      kids.push({ id: `src:c${i}`, attributes: {}, box: { width: 10, height: 10 } });
    }
    const r = interpretNode({
      id: 'src:g',
      attributes: { layoutMode: 'HORIZONTAL', itemSpacing: 4 },
      childIds: kids.map((k) => k.id),
      box: { width: 100, height: 20 },
    }, { childNodes: kids });
    assert(r.modeCandidates.some((c) => c.mode === 'grid-track'), 'grid cand');
    assert(r.modeCandidates.filter((c) => c.mode === 'flow-row').length === 1, 'still row');
  });

  await test('Phase A smoking-gun fix: sizingAxis reads layoutSizingHorizontal/Vertical directly', () => {
    const r = interpretNode({
      id: 'src:sz1',
      attributes: { layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' },
      box: { width: 100, height: 20 },
    });
    assert(r.sizing.horizontal === 'fill', 'horizontal fill from layoutSizingHorizontal');
    assert(r.sizing.vertical === 'hug', 'vertical hug from layoutSizingVertical');
  });

  await test('Phase A: sizingAxis falls back to constraints when layoutSizing* absent (no regression)', () => {
    const r = interpretNode({
      id: 'src:sz2',
      attributes: { constraints: { horizontal: 'SCALE', vertical: 'TOP' } },
      box: { width: 100, height: 20 },
    });
    assert(r.sizing.horizontal === 'fixed', 'SCALE still resolves fixed via legacy fallback');
    assert(r.sizing.vertical === 'fixed', 'TOP still resolves fixed via legacy fallback');
  });

  await test('Phase A: real Figma constraints vocabulary never satisfies FILL/HUG (confirms the bug this replaces)', () => {
    // constraints.horizontal's real values are only ever LEFT/RIGHT/CENTER/
    // LEFT_RIGHT/SCALE/TOP/BOTTOM — none of which is FILL/HUG/STRETCH/MIN —
    // so a node Figma actually declares FILL-sizing for could never resolve
    // to 'fill' from constraints alone, no matter which of those 7 values it
    // carries. layoutSizingHorizontal is what actually closes the gap.
    const withoutFix = interpretNode({
      id: 'src:sz3a',
      attributes: { constraints: { horizontal: 'LEFT_RIGHT' } },
      box: { width: 100, height: 20 },
    });
    assert(withoutFix.sizing.horizontal === 'fixed', 'constraints alone never yields fill, even for LEFT_RIGHT');
    const withFix = interpretNode({
      id: 'src:sz3b',
      attributes: { constraints: { horizontal: 'LEFT_RIGHT' }, layoutSizingHorizontal: 'FILL' },
      box: { width: 100, height: 20 },
    });
    assert(withFix.sizing.horizontal === 'fill', 'layoutSizingHorizontal correctly wins when present');
  });

  await test('Phase A: overflowHint reads clipsContent (real field) directly', () => {
    const r = interpretNode({
      id: 'src:clip1',
      attributes: { clipsContent: true },
      box: { width: 10, height: 10 },
    });
    assert(r.overflow === 'clip', 'clipsContent:true resolves to clip');
  });

  console.log('\n---');
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed) process.exitCode = 1;
  else console.log('Phase 11a layout interpretation: OK');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
