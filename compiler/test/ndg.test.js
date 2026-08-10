'use strict';

/**
 * Phase 10 — NormalizedDesignGraph materialization tests.
 */
const path = require('path');
const {
  buildNormalizedDesignGraph,
  validateGraph,
  buildGraphReport,
  materializeNormalizedDesignGraph,
  edgeKey,
  BUILDER_VERSION,
  FACT_KIND_GRAPH,
  STAGE_ID,
  NdgErrorKind,
  workingNodeFromRaw,
} = require('../ndg');
const {
  hasPaintSignal,
  isWrapperType,
  applyStructuralPolicies,
  indexWorking,
} = require('../ndg/parser-ast');
const { createWorkspace } = require('../workspace');
const { createKernel } = require('../kernel');
const { buildFingerprint, fingerprintKey } = require('../kernel/fingerprint');
const {
  createRulePackRegistry,
  loadFeatureExtractPack,
  loadRecognitionBasicPack,
} = require('../rulepack');
const { createPluginRegistry } = require('../plugin');
const { createKnowledgeRegistry } = require('../knowledge');

const RECOG_BUNDLE = path.join(__dirname, '..', 'knowledge', 'bundles', 'recognition-ontology.1.0.0.json');

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

function sampleTree() {
  return {
    documentId: 'raw-demo-1',
    document: {
      id: '1:1',
      name: 'Root',
      type: 'FRAME',
      visible: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
      children: [
        {
          id: '1:2',
          name: 'Wrapper',
          type: 'FRAME',
          visible: true,
          children: [
            {
              id: '1:3',
              name: 'Label',
              type: 'TEXT',
              characters: 'Hi',
              absoluteBoundingBox: { x: 8, y: 8, width: 80, height: 24 },
            },
          ],
        },
        {
          id: '1:4',
          name: 'Hidden',
          type: 'FRAME',
          visible: false,
          children: [
            {
              id: '1:5',
              name: 'Ghost',
              type: 'TEXT',
              characters: 'nope',
            },
          ],
        },
        {
          id: '1:6',
          name: 'Empty',
          type: 'FRAME',
          visible: true,
          children: [],
        },
      ],
    },
  };
}

function sourceNodeFacts() {
  return [
    {
      contractId: 'Fact',
      suiteVersion: '1.0.0',
      factId: 'f-a',
      kind: 'source.node',
      subject: 'src:a',
      assertion: {
        id: 'a',
        type: 'FRAME',
        name: 'A',
        layoutMode: 'VERTICAL',
        fills: [{ type: 'SOLID' }],
        childIds: ['b'],
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      },
    },
    {
      contractId: 'Fact',
      suiteVersion: '1.0.0',
      factId: 'f-b',
      kind: 'source.node',
      subject: 'src:b',
      assertion: {
        id: 'b',
        type: 'TEXT',
        name: 'B',
        characters: 'x',
        parentId: 'a',
        absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 20 },
      },
    },
  ];
}

async function main() {
  await test('graph construction from raw tree', () => {
    const built = buildNormalizedDesignGraph({
      rawDocument: sampleTree(),
      graphId: 'ndg:test-1',
    });
    assert(built.graph.contractId === 'NormalizedDesignGraph', 'contract');
    assert(built.graph.nodes.length >= 2, 'nodes');
    assert(built.graph.edges.some((e) => e.kind === 'parent'), 'parent edges');
    assert(built.checksum && built.checksum.length === 64, 'checksum');
    assert(built.builderVersion === BUILDER_VERSION, 'ver');
  });

  await test('hierarchy — single parent + sibling order', () => {
    const built = buildNormalizedDesignGraph({
      document: {
        id: 'r',
        type: 'FRAME',
        children: [
          { id: 'c1', type: 'TEXT', characters: 'a' },
          { id: 'c2', type: 'TEXT', characters: 'b' },
        ],
      },
      graphId: 'ndg:ord',
    });
    const parents = built.graph.edges.filter((e) => e.kind === 'parent');
    assert(parents.length === 2, '2 children');
    assert(parents.every((e) => e.from === 'src:r'), 'same parent');
    const idxs = parents.map((e) => e.index).sort();
    assert(JSON.stringify(idxs) === JSON.stringify([0, 1]), 'order');
    const childParents = new Map();
    for (const e of parents) {
      assert(!childParents.has(e.to), 'one parent');
      childParents.set(e.to, e.from);
    }
  });

  await test('visibility drop + empty drop + passthrough collapse', () => {
    const built = buildNormalizedDesignGraph({
      rawDocument: sampleTree(),
      graphId: 'ndg:policy',
    });
    const ids = new Set(built.graph.nodes.map((n) => n.sourceNodeId));
    assert(!ids.has('1:4'), 'hidden dropped');
    assert(ids.has('1:5'), 'child of hidden reparented');
    assert(!ids.has('1:6'), 'empty dropped');
    assert(!ids.has('1:2'), 'passthrough collapsed');
    assert(ids.has('1:3'), 'label kept');
    assert(built.events.some((e) => e.reason.includes('invisible')), 'ev invis');
    assert(built.events.some((e) => e.reason.includes('empty')), 'ev empty');
    assert(built.events.some((e) => e.reason.includes('passthrough')), 'ev collapse');
  });

  await test('geometry + constraints + attributes preserved', () => {
    const built = buildNormalizedDesignGraph({
      document: {
        id: 'g1',
        type: 'FRAME',
        absoluteBoundingBox: { x: 1, y: 2, width: 10, height: 20 },
        constraints: { horizontal: 'LEFT', vertical: 'TOP' },
        layoutMode: 'HORIZONTAL',
        fills: [{ type: 'SOLID' }],
        children: [],
      },
      graphId: 'ndg:geo',
    });
    const n = built.graph.nodes[0];
    assert(n.box.width === 10, 'box');
    assert(n.attributes.constraints.horizontal === 'LEFT', 'constraints');
    assert(n.attributes.layoutMode === 'HORIZONTAL', 'layout attr');
    assert(n.paints.length === 1, 'paints');
  });

  await test('duplicate id detection', () => {
    let threw = false;
    try {
      buildNormalizedDesignGraph({
        document: {
          id: 'dup',
          type: 'FRAME',
          children: [{ id: 'dup', type: 'TEXT', characters: 'x' }],
        },
        graphId: 'ndg:dup',
      });
    } catch (e) {
      threw = e.kind === NdgErrorKind.DUPLICATE_ID;
    }
    assert(threw, 'dup');
  });

  await test('cycle detection', () => {
    let threw = false;
    try {
      buildNormalizedDesignGraph({
        workingNodes: [
          {
            sourceNodeId: 'a',
            type: 'FRAME',
            visible: true,
            childSourceIds: ['b'],
            parentSourceId: 'b',
            paints: [{ type: 'SOLID' }],
            strokes: [],
            effects: [],
            geometry: {},
            attributes: {},
            box: null,
            name: 'a',
          },
          {
            sourceNodeId: 'b',
            type: 'FRAME',
            visible: true,
            childSourceIds: ['a'],
            parentSourceId: 'a',
            paints: [{ type: 'SOLID' }],
            strokes: [],
            effects: [],
            geometry: {},
            attributes: {},
            box: null,
            name: 'b',
          },
        ],
        graphId: 'ndg:cycle',
      });
    } catch (e) {
      threw = e.kind === NdgErrorKind.CYCLE || e.kind === NdgErrorKind.VALIDATION;
    }
    assert(threw, 'cycle');
  });

  await test('stable ids + ordering + deterministic rebuild', () => {
    const a = buildNormalizedDesignGraph({ rawDocument: sampleTree(), graphId: 'ndg:det' });
    const b = buildNormalizedDesignGraph({ rawDocument: sampleTree(), graphId: 'ndg:det' });
    assert(a.checksum === b.checksum, 'checksum');
    assert(JSON.stringify(a.graph.nodes.map((n) => n.id))
      === JSON.stringify(b.graph.nodes.map((n) => n.id)), 'ids');
    assert(JSON.stringify(a.graph.edges) === JSON.stringify(b.graph.edges), 'edges');
    assert(a.edgeIds.every((id, i) => id === b.edgeIds[i]), 'edgeIds');
  });

  await test('validateGraph catches broken refs', () => {
    const v = validateGraph({
      contractId: 'NormalizedDesignGraph',
      suiteVersion: '1.0.0',
      graphId: 'x',
      nodes: [{ id: 'src:1', sourceNodeId: '1', visible: true }],
      edges: [{ from: 'src:1', to: 'src:missing', kind: 'parent', index: 0 }],
    });
    assert(!v.ok, 'fail');
    assert(v.errors.some((e) => e.code === 'broken_reference'), 'broken');
  });

  await test('graph validation report', () => {
    const built = buildNormalizedDesignGraph({ rawDocument: sampleTree(), graphId: 'ndg:rep' });
    const report = buildGraphReport({
      graph: built.graph,
      checksum: built.checksum,
      validation: built.validation,
      events: built.events,
      edgeIds: built.edgeIds,
      fingerprint: { seed: 't' },
      timing: { ms: 1 },
    });
    assert(report.validationStatus === 'ok', 'status');
    assert(report.nodeCount === built.graph.nodes.length, 'nodes');
    assert(report.builderVersion === BUILDER_VERSION, 'bv');
    assert(report.droppedNodes >= 1, 'dropped');
    assert(report.checksum === built.checksum, 'cs');
  });

  await test('workspace integration — Facts + IrSlice', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const out = await materializeNormalizedDesignGraph({
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      rawDocument: sampleTree(),
      graphId: 'ndg:ws',
    });
    assert(out.report.validationStatus === 'ok', 'report');
    assert(ws.getIrSlice(out.sliceId).stageId === STAGE_ID, 'slice');
    assert(ws.getIrSlice(out.sliceId).graph.graphId === 'ndg:ws', 'graph');
    assert(ws.getFact(`fact:ndg.graph:ndg:ws`).kind === FACT_KIND_GRAPH, 'graph fact');
    const nodeFacts = ws.listIds('Fact').filter((id) => id.startsWith('fact:ndg.node:'));
    assert(nodeFacts.length === out.graph.nodes.length, 'node facts');
    assert(ws.listIds('DecisionRecord').length === 0, 'no decisions');
  });

  await test('idempotent publish', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const a = await materializeNormalizedDesignGraph({
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      rawDocument: sampleTree(),
      graphId: 'ndg:idem',
    });
    const b = await materializeNormalizedDesignGraph({
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      rawDocument: sampleTree(),
      graphId: 'ndg:idem',
    });
    assert(a.checksum === b.checksum, 'same');
    assert(ws.listIds('Fact').filter((id) => id.includes('ndg.node')).length === a.graph.nodes.length, 'count');
  });

  await test('source.node Facts ingest', () => {
    const built = buildNormalizedDesignGraph({
      facts: sourceNodeFacts(),
      graphId: 'ndg:src',
    });
    assert(built.graph.nodes.length === 2, '2');
    assert(built.graph.edges.some((e) => e.kind === 'parent'), 'edge');
  });

  await test('Phase 9 packs consume ndg.node', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    await materializeNormalizedDesignGraph({
      workspace: ws,
      policy: { profileId: 'pixel-faithful', thresholds: { pattern_name_cap: 0.35 } },
      document: {
        id: 't1',
        type: 'TEXT',
        name: 'Title',
        characters: 'Hello',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 24 },
      },
      graphId: 'ndg:p9',
    });

    const know = createKnowledgeRegistry();
    know.loadAndRegister(RECOG_BUNDLE);
    const { handle } = know.pin('recognition-ontology', '1.0.0');
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const fe = loadFeatureExtractPack();
    const rb = loadRecognitionBasicPack();
    reg.register(fe.pack, fe.handlers);
    reg.register(rb.pack, rb.handlers);

    const feat = await reg.execute('feature.extract', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful', thresholds: { pattern_name_cap: 0.35 } },
      knowledge: handle,
      suiteVersion: '1.0.0',
    });
    assert(feat.evidence.some((e) => e.detail && e.detail.inputMode === 'ndg'), 'ndg mode');
    assert(feat.hypotheses.length >= 1, 'feat hyp');

    const recog = await reg.execute('recognition.basic', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful', thresholds: { pattern_name_cap: 0.35 } },
      knowledge: handle,
      suiteVersion: '1.0.0',
    });
    assert(recog.candidates.some((c) => c.answer.blockKind === 'text-block'), 'text');
    assert(recog.candidates.some((c) => c.answer.inputMode === 'ndg'), 'mode');
  });

  await test('fingerprint stability includes ndg fields', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      ndgChecksum: 'aaa',
      ndgBuilderVersion: '1.0.0',
      ndgGraphId: 'ndg:1',
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      ndgGraphId: 'ndg:1',
      ndgBuilderVersion: '1.0.0',
      ndgChecksum: 'aaa',
    }));
    assert(a === b, 'stable');
    const c = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      ndgChecksum: 'bbb',
      ndgBuilderVersion: '1.0.0',
      ndgGraphId: 'ndg:1',
    }));
    assert(a !== c, 'diff');
  });

  await test('Kernel materializeNormalizedDesignGraph', async () => {
    const k = createKernel();
    const job = k.createJob({
      policyProfileId: 'pixel-faithful',
      seed: 'ndg-k',
      jobId: 'job-ndg',
    });
    const out = await job.materializeNormalizedDesignGraph({
      rawDocument: sampleTree(),
      graphId: 'ndg:kernel',
    });
    assert(out.graph.nodes.length >= 1, 'nodes');
    const fp = job.getFingerprint();
    assert(fp.ndgChecksum === out.checksum, 'fp cs');
    assert(fp.ndgGraphId === 'ndg:kernel', 'fp id');
    assert(fp.ndgBuilderVersion === BUILDER_VERSION, 'fp bv');
    assert(job.getWorkspace().getIrSlice(out.sliceId) != null, 'slice');
  });

  await test('edgeKey stability', () => {
    assert(edgeKey('parent', 'src:1', 'src:2', 0) === 'parent:src:1:src:2:0', 'key');
  });

  await test('Phase A: Auto Layout sub-fields + clipsContent + mask/blend/stroke-dash/text-decoration ingested', () => {
    const wn = workingNodeFromRaw({
      id: '1:1',
      type: 'FRAME',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'MAX',
      layoutWrap: 'WRAP',
      layoutGrow: 1,
      layoutAlign: 'STRETCH',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'AUTO',
      layoutSizingHorizontal: 'FILL',
      layoutSizingVertical: 'HUG',
      clipsContent: true,
      isMask: true,
      maskType: 'ALPHA',
      blendMode: 'MULTIPLY',
      strokeDashes: [10, 10],
      strokeCap: 'ROUND',
      strokeJoin: 'ROUND',
      cornerSmoothing: 0.6,
      absoluteRenderBounds: { x: -5, y: -5, width: 110, height: 110 },
    });
    assert(wn.attributes.primaryAxisAlignItems === 'CENTER', 'primaryAxisAlignItems');
    assert(wn.attributes.counterAxisAlignItems === 'MAX', 'counterAxisAlignItems');
    assert(wn.attributes.layoutWrap === 'WRAP', 'layoutWrap');
    assert(wn.attributes.layoutGrow === 1, 'layoutGrow');
    assert(wn.attributes.layoutAlign === 'STRETCH', 'layoutAlign');
    assert(wn.attributes.primaryAxisSizingMode === 'FIXED', 'primaryAxisSizingMode');
    assert(wn.attributes.counterAxisSizingMode === 'AUTO', 'counterAxisSizingMode');
    assert(wn.attributes.layoutSizingHorizontal === 'FILL', 'layoutSizingHorizontal');
    assert(wn.attributes.layoutSizingVertical === 'HUG', 'layoutSizingVertical');
    assert(wn.attributes.clipsContent === true, 'clipsContent');
    assert(wn.geometry.isMask === true, 'isMask');
    assert(wn.geometry.maskType === 'ALPHA', 'maskType');
    assert(wn.geometry.blendMode === 'MULTIPLY', 'blendMode');
    assert(JSON.stringify(wn.geometry.strokeDashes) === '[10,10]', 'strokeDashes');
    assert(wn.geometry.strokeCap === 'ROUND', 'strokeCap');
    assert(wn.geometry.strokeJoin === 'ROUND', 'strokeJoin');
    assert(wn.geometry.cornerSmoothing === 0.6, 'cornerSmoothing');
    assert(wn.renderBox && wn.renderBox.width === 110, 'renderBox');
  });

  await test('Phase A: clipsContent reads the real field, not the non-existent overflowDirection', () => {
    const wn = workingNodeFromRaw({ id: '1:2', type: 'FRAME', clipsContent: false });
    assert(wn.attributes.clipsContent === false, 'clipsContent false preserved (not truthy-coalesced away)');
    const wn2 = workingNodeFromRaw({ id: '1:3', type: 'FRAME' });
    assert(wn2.attributes.clipsContent === null, 'clipsContent absent -> null, not false');
  });

  await test('Phase A: textDecoration nests under style like textCase', () => {
    const wn = workingNodeFromRaw({
      id: '1:4',
      type: 'TEXT',
      characters: 'x',
      style: { textDecoration: 'UNDERLINE' },
    });
    assert(wn.attributes.textDecoration === 'UNDERLINE', 'textDecoration from style');
  });

  await test('Phase A: renderBox + new attributes survive into the final graph node', () => {
    const built = buildNormalizedDesignGraph({
      document: {
        id: 'g2',
        type: 'FRAME',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        absoluteRenderBounds: { x: -10, y: -10, width: 120, height: 120 },
        layoutSizingHorizontal: 'FILL',
        clipsContent: true,
        fills: [{ type: 'SOLID' }],
        children: [],
      },
      graphId: 'ndg:phaseA',
    });
    const n = built.graph.nodes[0];
    assert(n.renderBox && n.renderBox.width === 120, 'renderBox on graph node');
    assert(n.attributes.layoutSizingHorizontal === 'FILL', 'layoutSizingHorizontal on graph node');
    assert(n.attributes.clipsContent === true, 'clipsContent on graph node');
  });

  await test('Phase A: hasPaintSignal fix — opacity-only wrapper is not silently deleted', () => {
    const built = buildNormalizedDesignGraph({
      document: {
        id: 'p1',
        type: 'FRAME',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        opacity: 0.5,
        children: [{
          id: 'p1-child',
          type: 'TEXT',
          characters: 'hello',
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
        }],
      },
      graphId: 'ndg:paintsignal-opacity',
    });
    const ids = new Set(built.graph.nodes.map((n) => n.sourceNodeId));
    assert(ids.has('p1'), 'opacity-only wrapper survives (previously silently deleted)');
    const wrapper = built.graph.nodes.find((n) => n.sourceNodeId === 'p1');
    assert(wrapper.geometry.opacity === 0.5, 'opacity preserved on the surviving wrapper');
  });

  await test('Phase A: hasPaintSignal fix — rotation-only wrapper is not silently deleted', () => {
    const built = buildNormalizedDesignGraph({
      document: {
        id: 'p2',
        type: 'FRAME',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        rotation: 3.141592653589793,
        children: [{
          id: 'p2-child',
          type: 'TEXT',
          characters: 'hello',
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
        }],
      },
      graphId: 'ndg:paintsignal-rotation',
    });
    const ids = new Set(built.graph.nodes.map((n) => n.sourceNodeId));
    assert(ids.has('p2'), 'rotation-only wrapper survives (previously silently deleted)');
  });

  await test('Phase A: hasPaintSignal fix — genuinely empty wrapper still collapses (no over-correction)', () => {
    const built = buildNormalizedDesignGraph({
      document: {
        id: 'p3',
        type: 'FRAME',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        children: [{
          id: 'p3-child',
          type: 'TEXT',
          characters: 'hello',
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
        }],
      },
      graphId: 'ndg:paintsignal-empty',
    });
    const ids = new Set(built.graph.nodes.map((n) => n.sourceNodeId));
    assert(!ids.has('p3'), 'genuinely empty passthrough wrapper still collapses');
    assert(ids.has('p3-child'), 'child reparented to grandparent');
  });

  await test('Native Grid Auto Layout: gridColumnCount/gridRowCount/gaps/sizing strings + per-child anchor+span ingested', () => {
    const wn = workingNodeFromRaw({
      id: '1:5',
      type: 'FRAME',
      layoutMode: 'GRID',
      gridColumnCount: 3,
      gridRowCount: 2,
      gridRowGap: 1,
      gridColumnGap: 1,
      gridColumnsSizing: 'repeat(3,minmax(0,1fr))',
      gridRowsSizing: '  209.50px 209.50px',
    });
    assert(wn.attributes.gridColumnCount === 3, 'gridColumnCount');
    assert(wn.attributes.gridRowCount === 2, 'gridRowCount');
    assert(wn.attributes.gridRowGap === 1, 'gridRowGap');
    assert(wn.attributes.gridColumnGap === 1, 'gridColumnGap');
    assert(wn.attributes.gridColumnsSizing === 'repeat(3,minmax(0,1fr))', 'gridColumnsSizing');
    assert(wn.attributes.gridRowsSizing === '  209.50px 209.50px', 'gridRowsSizing');

    const child = workingNodeFromRaw({
      id: '1:6', type: 'FRAME', gridRowAnchorIndex: 1, gridColumnAnchorIndex: 2, gridRowSpan: 1, gridColumnSpan: 1,
    });
    assert(child.attributes.gridRowAnchorIndex === 1, 'gridRowAnchorIndex');
    assert(child.attributes.gridColumnAnchorIndex === 2, 'gridColumnAnchorIndex');
    assert(child.attributes.gridRowSpan === 1, 'gridRowSpan');
    assert(child.attributes.gridColumnSpan === 1, 'gridColumnSpan');
  });

  await test('docs/COMPILER_REDESIGN_ROADMAP.md Phase 2 — parser-ast.js is independently testable, no ingest/build pipeline needed: hasPaintSignal/isWrapperType/applyStructuralPolicies work directly against hand-built working-node objects', () => {
    assert(isWrapperType('FRAME') && isWrapperType('GROUP') && !isWrapperType('TEXT'), 'isWrapperType classifies structural vs. leaf types');
    assert(hasPaintSignal({ geometry: { opacity: 0.5 } }) === true, 'hasPaintSignal recognizes non-default opacity alone as real signal');
    assert(hasPaintSignal({ geometry: {} }) === false, 'hasPaintSignal recognizes a genuinely signal-less node');

    // A single-child passthrough wrapper (Pass 3) collapses; its sibling
    // with real paint survives untouched — proves applyStructuralPolicies
    // runs correctly against a synthetic graph with no ingest.js involved.
    const nodes = [
      { sourceNodeId: 'root', type: 'FRAME', visible: true, childSourceIds: ['wrapper', 'real'], geometry: {}, attributes: {} },
      { sourceNodeId: 'wrapper', type: 'FRAME', visible: true, parentSourceId: 'root', childSourceIds: ['leaf'], geometry: {}, attributes: {} },
      { sourceNodeId: 'leaf', type: 'TEXT', visible: true, parentSourceId: 'wrapper', childSourceIds: [], geometry: {}, attributes: { characters: 'hi' } },
      { sourceNodeId: 'real', type: 'FRAME', visible: true, parentSourceId: 'root', childSourceIds: [], geometry: { cornerRadius: 8 }, attributes: {}, paints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }] },
    ];
    const bySource = indexWorking(nodes);
    applyStructuralPolicies(bySource);
    assert(!bySource.has('wrapper'), 'paint-less single-child wrapper collapsed');
    assert(bySource.has('leaf') && bySource.get('leaf').parentSourceId === 'root', 'leaf reparented directly to root');
    assert(bySource.has('real') && bySource.get('real').parentSourceId === 'root', 'sibling with real paint/cornerRadius untouched');
  });

  console.log('\n---');
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed) process.exitCode = 1;
  else console.log('Phase 10 NDG materialization: OK');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
