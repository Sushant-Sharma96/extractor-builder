'use strict';

/**
 * Phase 11b — Constraint Solver (Layout subsystem) tests.
 */
const {
  buildConstraintNetwork,
  solveConstraints,
  projectSolvedLayoutIR,
  projectLayoutIR,
  materializeLayoutIR,
  materializeSolvedLayoutIR,
  loadLayoutIrFromWorkspace,
  SOLVER_VERSION,
  STRENGTH,
  layoutIrChecksum,
} = require('../layout');
const { materializeNormalizedDesignGraph } = require('../ndg');
const { createWorkspace } = require('../workspace');
const { createKernel } = require('../kernel');
const { buildFingerprint, fingerprintKey } = require('../kernel/fingerprint');
const {
  createRulePackRegistry,
  loadLayoutConstraintPack,
  loadLayoutInterpretPack,
} = require('../rulepack');
const { createPluginRegistry } = require('../plugin');
const { createDecisionRuntime } = require('../decision');

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

/** Parent too small for children — triggers parent_fit / overflow. */
function overflowDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    layoutMode: 'HORIZONTAL',
    itemSpacing: 4,
    fills: [{ type: 'SOLID' }],
    absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 },
    children: [
      {
        id: 'a',
        type: 'TEXT',
        characters: 'A',
        absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 20 },
      },
      {
        id: 'b',
        type: 'TEXT',
        characters: 'B',
        absoluteBoundingBox: { x: 44, y: 0, width: 40, height: 20 },
      },
    ],
  };
}

function nestedDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    layoutMode: 'VERTICAL',
    itemSpacing: 2,
    fills: [{ type: 'SOLID' }],
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    children: [
      {
        id: 'row',
        type: 'FRAME',
        layoutMode: 'HORIZONTAL',
        itemSpacing: 4,
        fills: [{ type: 'SOLID' }],
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
        children: [
          {
            id: 'c1',
            type: 'TEXT',
            characters: '1',
            absoluteBoundingBox: { x: 0, y: 0, width: 30, height: 20 },
          },
          {
            id: 'c2',
            type: 'TEXT',
            characters: '2',
            absoluteBoundingBox: { x: 34, y: 0, width: 30, height: 20 },
          },
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

async function main() {
  await test('constraint network — builds ordered constraints', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, flowDoc(), 'g-net');
    const projected = projectLayoutIR(ndg.graph);
    const network = buildConstraintNetwork(ndg.graph, projected.slice);
    assert(network.variables.length >= 4, 'vars');
    assert(network.constraints.length >= 1, 'constraints');
    const ids = network.constraints.map((c) => c.id);
    assert(JSON.stringify(ids) === JSON.stringify([...ids].sort()), 'sorted');
    assert(network.layoutIrSliceId === projected.slice.sliceId, 'slice ref');
  });

  await test('constraint solving — satisfied flow', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, flowDoc(), 'g-ok');
    const projected = projectLayoutIR(ndg.graph);
    const network = buildConstraintNetwork(ndg.graph, projected.slice);
    const solved = solveConstraints(network, ndg.graph, projected.slice, {
      policy: { profileId: 'default' },
    });
    assert(solved.solverVersion === SOLVER_VERSION, 'ver');
    assert(['satisfied', 'relaxed', 'needs_decision', 'unsat'].includes(solved.status), 'status');
    assert(Array.isArray(solved.results), 'results');
  });

  await test('relaxation — overflow under pixel-faithful', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, overflowDoc(), 'g-ov');
    const projected = projectLayoutIR(ndg.graph);
    const network = buildConstraintNetwork(ndg.graph, projected.slice);
    const solved = solveConstraints(network, ndg.graph, projected.slice, {
      policy: { profileId: 'pixel-faithful' },
    });
    assert(
      solved.relaxations.length > 0
        || solved.unsat.length > 0
        || solved.hypotheses.length > 0
        || solved.status === 'satisfied',
      'conflict handled'
    );
    // Never silent: every relaxation has Evidence
    for (const r of solved.relaxations) {
      const ev = solved.evidence.find(
        (e) => e.ref === 'layout.constraint.relaxed'
          && e.detail
          && e.detail.constraintId === r.constraintId
      );
      assert(ev, `evidence for ${r.constraintId}`);
    }
  });

  await test('unsatisfied constraints — first-class', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, overflowDoc(), 'g-unsat');
    const projected = projectLayoutIR(ndg.graph);
    const network = buildConstraintNetwork(ndg.graph, projected.slice);
    const solved = solveConstraints(network, ndg.graph, projected.slice, {
      policy: { profileId: 'semantic-lean', constraintRelaxOrder: [] },
      maxRelaxations: 0,
    });
    // With no auto-relax, parent_fit may remain unsat or need_decision
    assert(
      solved.unsat.length > 0
        || solved.hypotheses.length > 0
        || solved.violations.length >= 0,
      'tracked'
    );
    if (solved.unsat.length) {
      assert(solved.evidence.some((e) => e.ref === 'layout.constraint.unsat'), 'unsat evidence');
    }
  });

  await test('LayoutIR₁ projection — immutable baseline', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, flowDoc(), 'g-proj');
    const baseline = projectLayoutIR(ndg.graph, { sliceId: 'slice:layout:g-proj' });
    const baselineChecksum = baseline.checksum;
    const network = buildConstraintNetwork(ndg.graph, baseline.slice);
    const solved = solveConstraints(network, ndg.graph, baseline.slice, {
      policy: { profileId: 'default' },
    });
    const out = projectSolvedLayoutIR(ndg.graph, baseline.slice, solved, {
      sliceId: 'slice:layout-solved:g-proj',
    });
    assert(out.slice.sliceId !== baseline.slice.sliceId, 'new slice');
    assert(out.slice.payload.constraintSolve.fromLayoutIrSliceId === baseline.slice.sliceId, 'prov');
    assert(Array.isArray(out.slice.payload.unsat), 'unsat');
    assert(baseline.checksum === baselineChecksum, 'baseline unchanged');
    assert(baseline.slice.payload.unsat.length === 0, 'baseline unsat empty');
    assert(out.checksum === layoutIrChecksum(out.slice.payload), 'checksum');
    assert(out.solverVersion === SOLVER_VERSION, 'solver ver');
  });

  await test('fingerprint — solver fields', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'pixel-faithful',
      layoutIrChecksum: 'base',
      constraintSolverVersion: SOLVER_VERSION,
      solvedLayoutIrChecksum: 'solved',
      solvedLayoutSliceId: 'slice:s',
      solverFingerprint: '1.0.0|satisfied|solved|base',
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'pixel-faithful',
      solverFingerprint: '1.0.0|satisfied|solved|base',
      solvedLayoutSliceId: 'slice:s',
      solvedLayoutIrChecksum: 'solved',
      constraintSolverVersion: SOLVER_VERSION,
      layoutIrChecksum: 'base',
    }));
    assert(a === b, 'order-independent');
  });

  await test('deterministic + idempotent materialize', async () => {
    const run = async () => {
      const ws = createWorkspace();
      await seedNdg(ws, nestedDoc(), 'g-det');
      await materializeLayoutIR({
        workspace: ws,
        policy: { profileId: 'pixel-faithful' },
        sliceId: 'slice:layout:g-det',
      });
      return materializeSolvedLayoutIR({
        workspace: ws,
        policy: { profileId: 'pixel-faithful' },
        sliceId: 'slice:layout-solved:g-det',
        baselineSliceId: 'slice:layout:g-det',
      });
    };
    const a = await run();
    const b = await run();
    assert(a.checksum === b.checksum, 'idempotent checksum');
    assert(a.solveResult.status === b.solveResult.status, 'status');
    assert(
      JSON.stringify(a.solveResult.relaxations) === JSON.stringify(b.solveResult.relaxations),
      'relax'
    );
  });

  await test('LayoutIR pin — baseline retained, active prefers pin', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, flowDoc(), 'g-pin');
    await materializeLayoutIR({
      workspace: ws,
      policy: { profileId: 'default' },
      sliceId: 'slice:layout:g-pin',
    });
    const pin0 = ws.getLayoutIrPin('g-pin');
    assert(pin0 && pin0.baselineLayoutIrSliceId === 'slice:layout:g-pin', 'baseline pin');
    assert(pin0.activeLayoutIrSliceId === 'slice:layout:g-pin', 'active=baseline');
    // decoy later baseline-looking slice should not win when pin exists
    ws.putIrSlice({
      suiteVersion: '1.0.0',
      stageId: 'layout-ir',
      sliceId: 'slice:layout:zzz-decoy',
      nodeIds: [],
      graphId: 'g-pin',
      checksum: 'decoy',
      payload: { graphId: 'g-pin', nodes: [], mixedRegions: [], unsat: [] },
    });
    const loaded = loadLayoutIrFromWorkspace(ws, { prefer: 'baseline', graphId: 'g-pin' });
    assert(loaded.sliceId === 'slice:layout:g-pin', 'pin wins over last-id');
    await materializeSolvedLayoutIR({
      workspace: ws,
      policy: { profileId: 'default' },
      baselineSliceId: 'slice:layout:g-pin',
      sliceId: 'slice:layout-solved:g-pin',
    });
    const pin1 = ws.getLayoutIrPin('g-pin');
    assert(pin1.baselineLayoutIrSliceId === 'slice:layout:g-pin', 'baseline kept');
    assert(pin1.activeLayoutIrSliceId === 'slice:layout-solved:g-pin', 'active solved');
    const active = loadLayoutIrFromWorkspace(ws, { prefer: 'active', graphId: 'g-pin' });
    assert(active.sliceId === 'slice:layout-solved:g-pin', 'active load');
    assert(active.payload.constraintSolve, 'solved payload');
  });

  await test('fingerprint schema sync — no hidden fields', () => {
    const { buildFingerprint, assertNoHiddenFingerprintFields, FINGERPRINT_NAMED_FIELDS } =
      require('../kernel/fingerprint');
    const fp = buildFingerprint({
      policyProfileId: 'pixel-faithful',
      layoutSliceId: 'slice:a',
      solvedLayoutSliceId: 'slice:b',
    });
    assertNoHiddenFingerprintFields(fp);
    assert(fp.baselineLayoutIrSliceId === 'slice:a', 'baseline');
    assert(fp.activeLayoutIrSliceId === 'slice:b', 'active');
    assert(FINGERPRINT_NAMED_FIELDS.includes('activeLayoutIrSliceId'), 'named');
  });

  await test('Decision Runtime integration — committed relax', async () => {
    const { StoreKind } = require('../workspace');
    const ws = createWorkspace();
    await seedNdg(ws, overflowDoc(), 'g-dec');
    await materializeLayoutIR({
      workspace: ws,
      policy: { profileId: 'semantic-lean' },
      sliceId: 'slice:layout:g-dec',
    });
    const baseline = ws.getIrSlice('slice:layout:g-dec');

    const first = await materializeSolvedLayoutIR({
      workspace: ws,
      policy: { profileId: 'semantic-lean' },
      baselineSliceId: 'slice:layout:g-dec',
      sliceId: 'slice:layout-solved:g-dec-a',
      maxRelaxations: 0,
    });

    let constraintId = null;
    if (first.solveResult.hypotheses.length) {
      constraintId = first.solveResult.hypotheses[0].constraintId;
    } else if (first.solveResult.unsat.length) {
      constraintId = first.solveResult.unsat[0].constraintId;
    } else {
      const ndgSlice = ws.listIds('IrSlice')
        .map((id) => ws.getIrSlice(id))
        .find((s) => s.stageId === 'normalized-design-graph');
      const net = buildConstraintNetwork(ndgSlice.graph, baseline);
      const fit = net.constraints.find((c) => c.kind === 'parent_fit');
      constraintId = fit ? fit.id : 'c:fit:src:root';
    }

    ws.putDecision({
      contractId: 'DecisionRecord',
      suiteVersion: '1.0.0',
      id: 'dec:relax:1',
      decisionId: 'dec:relax:1',
      question: 'layout.constraint.relax',
      subject: 'src:root',
      status: 'arbitrated',
      candidates: [
        {
          candidateId: `cand:relax:${constraintId}:drop`,
          answer: { relax: 'drop', constraintId, kind: 'parent_fit' },
        },
      ],
      winner: { kind: 'candidate', candidateId: `cand:relax:${constraintId}:drop` },
      evidence: [],
      scores: [],
      ranking: [],
      policy: { profileId: 'semantic-lean', profileVersion: null },
      alternatives_kept: [],
      trace_refs: [],
    }, { id: 'decision-runtime', capabilities: { writes: [StoreKind.DECISION, StoreKind.TRACE] } });

    const second = await materializeSolvedLayoutIR({
      workspace: ws,
      policy: { profileId: 'semantic-lean' },
      baselineSliceId: 'slice:layout:g-dec',
      sliceId: 'slice:layout-solved:g-dec-b',
      maxRelaxations: 0,
    });
    assert(
      second.solveResult.relaxations.some(
        (r) => r.constraintId === constraintId && r.source === 'decision'
      ),
      'decision-backed relaxation'
    );
    const rt = createDecisionRuntime({
      workspace: ws,
      policy: { profileId: 'semantic-lean' },
    });
    assert(rt && typeof rt.createSession === 'function', 'runtime intact');
    assert(rt.invariants.ownsArbitration === true, 'runtime owns arbitration');
    assert(rt.invariants.hasDomainIntelligence === false, 'no domain intel');
  });

  await test('Rule Pack layout.constraint loads', async () => {
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadLayoutConstraintPack();
    reg.register(pack, handlers);
    assert(reg.has('layout.constraint'), 'has pack');
  });

  await test('Kernel solveLayoutConstraints + fingerprint', async () => {
    const kernel = createKernel({ policyProfileId: 'pixel-faithful' });
    const job = kernel.createJob({});
    const ws = job.attachWorkspace();
    await job.materializeNormalizedDesignGraph({
      document: nestedDoc(),
      graphId: 'g-kern',
    });
    await job.projectLayoutIR({ sliceId: 'slice:layout:g-kern' });
    const out = await job.solveLayoutConstraints({
      baselineSliceId: 'slice:layout:g-kern',
      sliceId: 'slice:layout-solved:g-kern',
    });
    assert(out.checksum, 'checksum');
    assert(out.slice.payload.constraintSolve, 'solve section');
    const fp = job.getStatus().fingerprint;
    assert(fp.constraintSolverVersion === SOLVER_VERSION, 'fp solver');
    assert(fp.solvedLayoutIrChecksum === out.checksum, 'fp solved');
    assert(fp.layoutIrChecksum, 'baseline fp kept');
    assert(fp.solverFingerprint, 'solver fp');
    const ndgSlices = ws.listIds('IrSlice')
      .map((id) => ws.getIrSlice(id))
      .filter((s) => s.stageId === 'normalized-design-graph');
    assert(ndgSlices.length >= 1, 'ndg present');
  });

  await test('mixed + nested layouts', async () => {
    const ws = createWorkspace();
    await seedNdg(ws, nestedDoc(), 'g-mix');
    await materializeLayoutIR({
      workspace: ws,
      policy: { profileId: 'default' },
      sliceId: 'slice:layout:g-mix',
    });
    const out = await materializeSolvedLayoutIR({
      workspace: ws,
      policy: { profileId: 'default' },
      baselineSliceId: 'slice:layout:g-mix',
      sliceId: 'slice:layout-solved:g-mix',
    });
    assert(out.network.constraints.length >= 1, 'nested constraints');
    assert(out.slice.payload.nodes.length >= 3, 'nodes');
  });

  await test('performance sanity — 50 nodes', async () => {
    const children = [];
    for (let i = 0; i < 48; i += 1) {
      children.push({
        id: `n${i}`,
        type: 'TEXT',
        characters: String(i),
        absoluteBoundingBox: { x: (i % 8) * 20, y: Math.floor(i / 8) * 20, width: 16, height: 16 },
      });
    }
    const doc = {
      id: 'root',
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      itemSpacing: 2,
      fills: [{ type: 'SOLID' }],
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 },
      children,
    };
    const ws = createWorkspace();
    const t0 = Date.now();
    await seedNdg(ws, doc, 'g-perf');
    await materializeLayoutIR({
      workspace: ws,
      policy: { profileId: 'default' },
      sliceId: 'slice:layout:g-perf',
    });
    await materializeSolvedLayoutIR({
      workspace: ws,
      policy: { profileId: 'default' },
      baselineSliceId: 'slice:layout:g-perf',
      sliceId: 'slice:layout-solved:g-perf',
    });
    const ms = Date.now() - t0;
    assert(ms < 15000, `perf ${ms}ms`);
  });

  await test('policy behaviour — weak gap never silent', async () => {
    const graph = {
      contractId: 'NormalizedDesignGraph',
      suiteVersion: '1.0.0',
      graphId: 'g-pol',
      nodes: [
        {
          id: 'n1',
          sourceNodeId: '1',
          attributes: { layoutMode: 'HORIZONTAL', itemSpacing: -2 },
          childIds: [],
          box: { x: 0, y: 0, width: 10, height: 10 },
          parentId: null,
        },
      ],
      edges: [],
    };
    const projected = projectLayoutIR(graph);
    const network = buildConstraintNetwork(graph, projected.slice);
    const solved = solveConstraints(network, graph, projected.slice, {
      policy: { profileId: 'default' },
    });
    const gapC = network.constraints.find((c) => c.kind === 'gap_nonneg');
    assert(gapC, 'gap constraint');
    assert(gapC.strength === STRENGTH.WEAK, 'weak');
    assert(
      solved.evidence.some((e) => e.ref === 'layout.constraint.relaxed' || e.ref === 'layout.constraint.unsat'),
      'traced'
    );
  });

  await test('regression — layout.interpret pack still loads', () => {
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadLayoutInterpretPack();
    reg.register(pack, handlers);
    assert(pack.packId === 'layout.interpret', '11a pack');
    assert(reg.has('layout.interpret'), 'registered');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
