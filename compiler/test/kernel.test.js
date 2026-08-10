'use strict';

/**
 * Phase 2 Kernel tests — lifecycle, fingerprint determinism, invariants, registry, gates, budgets.
 */
const fs = require('fs');
const path = require('path');
const {
  createKernel,
  JobState,
  FailureKind,
  KernelError,
  fingerprintKey,
} = require('../kernel');

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

function basePolicy(over = {}) {
  return {
    contractId: 'PolicyProfile',
    suiteVersion: '1.0.0',
    profileId: 'pixel-faithful',
    valuesAuthoritative: false,
    budgets: { maxTimeMs: 1000, maxDomNodes: 100, maxMemoryBytes: null, maxAssetBytes: null },
    ...over,
  };
}

function test(name, fn) {
  try {
    fn();
    pass(name);
  } catch (e) {
    fail(name, e);
  }
}

test('empty job → success with policy', () => {
  const k = createKernel();
  const job = k.createJob({ policyProfile: basePolicy() });
  const st = job.runEmpty({ outcome: 'success' });
  assert(st.state === JobState.SUCCESS, `state=${st.state}`);
  assert(st.policy.profileId === 'pixel-faithful', 'policy bound');
  assert(st.result && st.result.kind === 'empty_job', 'empty result');
  assert(st.fingerprint.contractId === 'CompileJobFingerprint', 'fingerprint shape');
});

test('empty job → fail', () => {
  const k = createKernel();
  const job = k.createJob({ policyProfile: basePolicy() });
  const st = job.runEmpty({ outcome: 'fail', failMessage: 'boom' });
  assert(st.state === JobState.FAILED, `state=${st.state}`);
  assert(st.failure && st.failure.message === 'boom', 'failure message');
});

test('empty job → abort outcome', () => {
  const k = createKernel();
  const job = k.createJob({ policyProfile: basePolicy() });
  const st = job.runEmpty({ outcome: 'abort' });
  assert(st.state === JobState.ABORTED, `state=${st.state}`);
  assert(st.failure.kind === FailureKind.ABORTED, 'aborted kind');
});

test('abort from created', () => {
  const k = createKernel();
  const job = k.createJob({ policyProfile: basePolicy() });
  const st = job.abort('user cancel');
  assert(st.state === JobState.ABORTED, 'aborted');
});

test('fingerprint deterministic', () => {
  const k = createKernel();
  const opts = {
    policyProfile: basePolicy(),
    knowledgeBundleVersion: null,
    ruleSetVersion: 'r1',
    seed: 's0',
  };
  const a = k.createJob(opts).fingerprintKey();
  const b = k.createJob(opts).fingerprintKey();
  assert(a === b, 'keys differ');
});

test('fingerprint changes with policy', () => {
  const k = createKernel();
  const a = k.createJob({ policyProfile: basePolicy({ profileId: 'a' }) }).fingerprintKey();
  const b = k.createJob({ policyProfile: basePolicy({ profileId: 'b' }) }).fingerprintKey();
  assert(a !== b, 'expected different keys');
});

test('reject ontology in profileId', () => {
  const k = createKernel();
  let threw = false;
  try {
    k.createJob({ policyProfile: basePolicy({ profileId: 'hero-landing' }) });
  } catch (e) {
    threw = e instanceof KernelError && e.kind === FailureKind.INVARIANT_VIOLATION;
  }
  assert(threw, 'expected invariant violation');
});

test('reject ontology in engine id', () => {
  const k = createKernel();
  let threw = false;
  try {
    k.registerEngine({ id: 'engine.navbar', phaseAffinity: 'mid' });
  } catch (e) {
    threw = e.kind === FailureKind.INVARIANT_VIOLATION;
  }
  assert(threw, 'expected ontology reject');
});

test('engine registry + schedule skeleton', () => {
  const k = createKernel();
  k.registerEngine({ id: 'engine.norm', phaseAffinity: 'early', capabilities: { reads: [], writes: ['Fact'] } });
  k.registerEngine({ id: 'engine.layout', phaseAffinity: 'mid' });
  k.registerEngine({ id: 'engine.lower', phaseAffinity: 'lowering' });
  const schedule = k.buildSchedule();
  assert(schedule.waves.length === 4, '4 waves');
  assert(schedule.waves[0].engineIds.includes('engine.norm'), 'early');
  assert(schedule.waves[3].engineIds.includes('engine.lower'), 'lowering');
  const job = k.createJob({ policyProfile: basePolicy() });
  const st = job.runEmpty();
  assert(st.result.schedule.waves[0].engineIds.includes('engine.norm'), 'job schedule');
});

test('gate fail-closed', () => {
  const k = createKernel();
  const job = k.createJob({ policyProfile: basePolicy() });
  const st = job.runEmpty({
    outcome: 'success',
    qualityReport: {
      contractId: 'QualityReport',
      suiteVersion: '1.0.0',
      reportId: 'r1',
      scores: {},
      violations: [{ code: 'X', severity: 'error', message: 'bad' }],
    },
    failClosed: true,
  });
  assert(st.state === JobState.FAILED, 'should fail');
  assert(st.failure.kind === FailureKind.GATE_FAIL, 'gate kind');
});

test('budget exceeded', () => {
  const k = createKernel();
  const job = k.createJob({ policyProfile: basePolicy() });
  const st = job.runEmpty({
    outcome: 'success',
    budgetUsage: { timeMs: 5000 },
  });
  assert(st.state === JobState.FAILED, 'budget fail');
  assert(st.failure.kind === FailureKind.BUDGET_EXCEEDED, 'budget kind');
});

test('IR stages from Phase 1 registry', () => {
  const k = createKernel();
  assert(k.isKnownIrStage('normalized-design-graph'), 'ndg');
  assert(k.isKnownIrStage('emit-plan'), 'emit');
  assert(!k.isKnownIrStage('not-a-stage'), 'unknown');
  assert(k.listIrStages().length >= 10, 'enumerable');
});

test('attachWorkspace returns live workspace', () => {
  const k = createKernel();
  const job = k.createJob({ policyProfile: basePolicy() });
  const ws = job.attachWorkspace();
  assert(ws && ws.putFact && ws.invariants.isPassive === true, 'workspace attached');
  assert(job.attachWorkspace() === ws, 'same instance');
});

test('arbitrate via decision runtime', () => {
  const k = createKernel();
  const job = k.createJob({ policyProfile: basePolicy() });
  const out = job.arbitrate({
    question: 'html.tag',
    subject: 'src:1:2',
    candidates: [
      { candidateId: 'cand-section', answer: { tag: 'section' }, localScore: 0.8, priorityBand: 'P4' },
      { candidateId: 'cand-div', answer: { tag: 'div' }, localScore: 0.4, priorityBand: 'P5', safeGeneric: true },
    ],
  });
  assert(out.decision && out.decision.status === 'arbitrated', 'committed');
  assert(out.decision.winner.candidateId === 'cand-section', 'winner');
  assert(out.trace && out.trace.traceId, 'trace');
  assert(job.getWorkspace().getDecision(out.decision.id) != null, 'in workspace');
  assert(job.getWorkspace().getTrace(out.trace.traceId) != null, 'trace persisted');
});

test('invokeDecisionRuntime is arbitrate alias', () => {
  const k = createKernel();
  const job = k.createJob({ policyProfile: basePolicy() });
  assert(typeof job.invokeDecisionRuntime === 'function', 'facade');
  assert(k.invariants.ownsArbitration === false, 'no ownership');
  const a = job.invokeDecisionRuntime({
    question: 'html.tag',
    subject: 'src:alias',
    decisionId: 'dec-alias',
    candidates: [
      { candidateId: 'x', answer: { tag: 'div' }, localScore: 0.9, priorityBand: 'P5' },
    ],
  });
  assert(a.decision.status === 'arbitrated', 'ok');
});

test('kernel source has no forbidden ontology tokens', () => {
  const dir = path.join(__dirname, '..', 'kernel');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  const forbidden = ['navbar', 'hero', 'carousel', 'accordion', 'pricing', 'megamenu'];
  // Allow the policy module's FORBIDDEN_ONTOLOGY list itself
  for (const f of files) {
    if (f === 'policy.js') continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8').toLowerCase();
    for (const bad of forbidden) {
      assert(!text.includes(`'${bad}'`) && !text.includes(`"${bad}"`), `${f} contains ${bad}`);
    }
  }
});

test('invariants flags', () => {
  const k = createKernel();
  assert(k.invariants.hasUiOntology === false);
  assert(k.invariants.emitsHtml === false);
  assert(k.invariants.callsDesignApi === false);
  assert(k.invariants.ownsArbitration === false, 'delegation only');
  assert(typeof k.emitHtml !== 'function', 'no emitHtml');
});

console.log('\n---');
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed) process.exitCode = 1;
else console.log('Phase 2 kernel validation: OK');
