'use strict';

/**
 * Phase 3 Workspace tests — passive blackboard only.
 */
const {
  createWorkspace,
  StoreKind,
  WorkspaceState,
  WorkspaceError,
  WorkspaceErrorKind,
} = require('../workspace');
const { createKernel } = require('../kernel');

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
  try {
    fn();
    pass(name);
  } catch (e) {
    fail(name, e);
  }
}

function fact(id, over = {}) {
  return {
    contractId: 'Fact',
    suiteVersion: '1.0.0',
    factId: id,
    kind: 'source.layoutMode',
    subject: 'src:1:2',
    assertion: { layoutMode: 'HORIZONTAL' },
    ...over,
  };
}

function hyp(id) {
  return {
    contractId: 'Hypothesis',
    suiteVersion: '1.0.0',
    hypothesisId: id,
    question: 'html.tag',
    subject: 'src:1:2',
    candidates: [{ candidateId: 'c1', answer: { tag: 'div' } }],
  };
}

function decision(id, over = {}) {
  return {
    contractId: 'DecisionRecord',
    suiteVersion: '1.0.0',
    id,
    subject: 'src:1:2',
    question: 'html.tag',
    candidates: [{ candidateId: 'c1', answer: { tag: 'div' } }],
    evidence: [],
    scores: [{ candidateId: 'c1', value: 0.9 }],
    ranking: ['c1'],
    winner: { kind: 'candidate', candidateId: 'c1' },
    policy: { profileId: 'pixel-faithful' },
    status: 'arbitrated',
    alternatives_kept: [],
    trace_refs: [],
    ...over,
  };
}

test('workspace creation', () => {
  const ws = createWorkspace({ jobId: 'j1', contractSuiteVersion: '1.0.0' });
  const st = ws.getStatus();
  assert(st.state === WorkspaceState.OPEN, 'open');
  assert(st.jobId === 'j1', 'jobId');
  assert(ws.invariants.isPassive === true, 'passive');
});

test('fact insertion + get', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  const f = ws.putFact(fact('f1'));
  assert(f.factId === 'f1', 'id');
  assert(ws.getFact('f1').assertion.layoutMode === 'HORIZONTAL', 'get');
});

test('fact immutability — reject different overwrite', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  ws.putFact(fact('f1'));
  let threw = false;
  try {
    ws.putFact(fact('f1', { assertion: { layoutMode: 'VERTICAL' } }));
  } catch (e) {
    threw = e.kind === WorkspaceErrorKind.IMMUTABLE_FACT;
  }
  assert(threw, 'immutable');
});

test('fact idempotent identical rewrite', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  ws.putFact(fact('f1'));
  const again = ws.putFact(fact('f1'));
  assert(again.factId === 'f1', 'idempotent');
});

test('fact frozen against mutation', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  const f = ws.putFact(fact('f1'));
  let threw = false;
  try {
    f.assertion.layoutMode = 'VERTICAL';
  } catch (e) {
    threw = true;
  }
  // strict mode freeze throws; also verify stored value unchanged
  assert(ws.getFact('f1').assertion.layoutMode === 'HORIZONTAL', 'unchanged');
  assert(threw || Object.isFrozen(f.assertion), 'frozen');
});

test('hypothesis insertion', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  ws.putHypothesis(hyp('h1'));
  assert(ws.getHypothesis('h1').question === 'html.tag', 'hyp');
});

test('decision record insertion — store only', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  ws.putDecision(decision('d1'));
  assert(ws.getDecision('d1').winner.candidateId === 'c1', 'decision');
  assert(typeof ws.arbitrate !== 'function', 'no arbitrate on workspace');
});

test('evidence storage', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  ws.putEvidence({ evidenceId: 'e1', kind: 'feature', ref: 'equalGap' });
  assert(ws.getEvidence('e1').ref === 'equalGap', 'evidence');
});

test('ir slice storage', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  ws.putIrSlice({
    suiteVersion: '1.0.0',
    stageId: 'layout-ir',
    sliceId: 'slice-1',
    nodeIds: ['src:1:2'],
    payload: {},
  });
  assert(ws.getIrSlice('slice-1').stageId === 'layout-ir', 'slice');
});

test('ir slice rejects unknown stageId', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  let threw = false;
  try {
    ws.putIrSlice({
      suiteVersion: '1.0.0',
      stageId: 'not-a-registered-stage',
      sliceId: 'slice-bad',
      nodeIds: [],
      payload: {},
    });
  } catch (e) {
    threw = e.kind === WorkspaceErrorKind.UNKNOWN_IR_STAGE;
  }
  assert(threw, 'unknown stage');
});

test('ir slice accepts registry stageIds', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  for (const stageId of ['raw-design-document', 'normalized-design-graph', 'layout-ir', 'emit-plan']) {
    ws.putIrSlice({
      suiteVersion: '1.0.0',
      stageId,
      sliceId: `slice-${stageId}`,
      nodeIds: [],
      payload: {},
    });
    assert(ws.getIrSlice(`slice-${stageId}`).stageId === stageId, stageId);
  }
});

test('decision trace passive storage', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  const writer = { id: 'decision-runtime', capabilities: { writes: [StoreKind.TRACE] } };
  const trace = {
    traceId: 'trace:d1',
    decisionId: 'd1',
    question: 'html.tag',
    subject: 'src:1',
    arbitration: { reason: 'winner_selected' },
  };
  ws.putTrace(trace, writer);
  assert(ws.getTrace('trace:d1').decisionId === 'd1', 'get');
  assert(ws.listIds(StoreKind.TRACE).includes('trace:d1'), 'list');
  assert(ws.snapshot().traces['trace:d1'].traceId === 'trace:d1', 'snap');
});

test('provenance storage + cross-ref', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  ws.putDecision(decision('d1'));
  ws.putProvenance({
    contractId: 'ProvenanceBundle',
    suiteVersion: '1.0.0',
    bundleId: 'p1',
    bindings: [{ bindingId: 'b1', decisionId: 'd1', irNodeId: 'src:1:2' }],
  });
  assert(ws.getProvenance('p1').bindings[0].decisionId === 'd1', 'prov');
});

test('provenance cross-ref failure', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  let threw = false;
  try {
    ws.putProvenance({
      contractId: 'ProvenanceBundle',
      suiteVersion: '1.0.0',
      bundleId: 'p1',
      bindings: [{ bindingId: 'b1', decisionId: 'missing-dec' }],
    });
  } catch (e) {
    threw = e.kind === WorkspaceErrorKind.CROSS_REF;
  }
  assert(threw, 'cross-ref');
});

test('version mismatch rejected', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  let threw = false;
  try {
    ws.putFact(fact('f1', { suiteVersion: '9.9.9' }));
  } catch (e) {
    threw = e.kind === WorkspaceErrorKind.VERSION;
  }
  assert(threw, 'version');
});

test('snapshot behavior', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  ws.putFact(fact('f1'));
  const snap = ws.snapshot();
  assert(snap.facts.f1.factId === 'f1', 'snap fact');
  snap.facts.f1.assertion.layoutMode = 'VERTICAL';
  assert(ws.getFact('f1').assertion.layoutMode === 'HORIZONTAL', 'snap isolated');
});

test('invalid writes', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  let threw = false;
  try {
    ws.putFact({ contractId: 'Fact', suiteVersion: '1.0.0' });
  } catch (e) {
    threw = e.kind === WorkspaceErrorKind.INVALID_WRITE;
  }
  assert(threw, 'invalid');
});

test('duplicate decision identity', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  ws.putDecision(decision('d1'));
  let threw = false;
  try {
    ws.putDecision(decision('d1', { status: 'rejected' }));
  } catch (e) {
    threw = e.kind === WorkspaceErrorKind.DUPLICATE_IDENTITY;
  }
  assert(threw, 'dup');
});

test('capability denied', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  const writer = { id: 'engine.a', capabilities: { writes: [StoreKind.FACT] } };
  ws.putFact(fact('f1'), writer);
  let threw = false;
  try {
    ws.putHypothesis(hyp('h1'), writer);
  } catch (e) {
    threw = e.kind === WorkspaceErrorKind.CAPABILITY_DENIED;
  }
  assert(threw, 'cap');
});

test('finalize blocks writes', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  ws.finalize();
  let threw = false;
  try {
    ws.putFact(fact('f1'));
  } catch (e) {
    threw = e.kind === WorkspaceErrorKind.INVALID_STATE;
  }
  assert(threw, 'finalized');
});

test('discard clears', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  ws.putFact(fact('f1'));
  ws.discard();
  assert(ws.getStatus().state === WorkspaceState.DISCARDED, 'discarded');
  let threw = false;
  try {
    ws.getFact('f1');
  } catch (e) {
    threw = e.kind === WorkspaceErrorKind.INVALID_STATE;
  }
  assert(threw, 'no read after discard');
});

test('invalidate fact without mutating', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  ws.putFact(fact('f1'));
  ws.invalidateFact('f1', { reason: 'superseded' }, { id: 'engine.norm' });
  assert(ws.isFactInvalidated('f1') === true, 'invalidated');
  assert(ws.getFact('f1').assertion.layoutMode === 'HORIZONTAL', 'fact intact');
});

test('two fake engines communicate only via workspace', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  const engineA = {
    id: 'fake.a',
    capabilities: { writes: [StoreKind.FACT] },
    run() {
      ws.putFact(fact('shared-fact'), engineA);
    },
  };
  const engineB = {
    id: 'fake.b',
    capabilities: { writes: [StoreKind.HYPOTHESIS] },
    run() {
      const f = ws.getFact('shared-fact');
      assert(f != null, 'B reads A via workspace');
      ws.putHypothesis(
        {
          ...hyp('h-from-b'),
          subject: f.subject,
        },
        engineB
      );
    },
  };
  // No private pipe between A and B
  engineA.run();
  engineB.run();
  assert(ws.getHypothesis('h-from-b').subject === 'src:1:2', 'linked via fact');
  assert(ws.getAuditLog().some((e) => e.writerId === 'fake.a'), 'audit a');
  assert(ws.getAuditLog().some((e) => e.writerId === 'fake.b'), 'audit b');
});

test('kernel attachWorkspace integration', () => {
  const k = createKernel();
  const job = k.createJob({
    policyProfile: {
      contractId: 'PolicyProfile',
      suiteVersion: '1.0.0',
      profileId: 'pixel-faithful',
      valuesAuthoritative: false,
    },
  });
  const ws = job.attachWorkspace();
  ws.putFact(fact('f-kernel'));
  assert(job.getWorkspace().getFact('f-kernel') != null, 'via kernel');
});

test('derivedFromFactIds cross-ref', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  let threw = false;
  try {
    ws.putFact(fact('f2', { derivedFromFactIds: ['missing'] }));
  } catch (e) {
    threw = e.kind === WorkspaceErrorKind.CROSS_REF;
  }
  assert(threw, 'derived cross-ref');
  ws.putFact(fact('f1'));
  ws.putFact(fact('f2', { derivedFromFactIds: ['f1'], assertion: { ok: true } }));
  assert(ws.getFact('f2') != null, 'ok after parent');
});

console.log('\n---');
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed) process.exitCode = 1;
else console.log('Phase 3 workspace validation: OK');
