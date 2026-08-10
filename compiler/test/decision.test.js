'use strict';

/**
 * Phase 4 Decision Runtime tests — orchestration only, no domain intelligence.
 */
const { createWorkspace, StoreKind } = require('../workspace');
const { createKernel } = require('../kernel');
const {
  createDecisionRuntime,
  SessionState,
  DecisionError,
  DecisionErrorKind,
} = require('../decision');

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

function policy(over = {}) {
  return {
    contractId: 'PolicyProfile',
    suiteVersion: '1.0.0',
    profileId: 'pixel-faithful',
    valuesAuthoritative: false,
    thresholds: {
      accept_min: 0.5,
      margin_min: 0.05,
      fallback_below: 0.4,
      fail_closed_below: null,
      pattern_name_cap: null,
    },
    ...over,
  };
}

function runtime() {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  const rt = createDecisionRuntime({ workspace: ws, policy: policy(), contractSuiteVersion: '1.0.0' });
  return { ws, rt };
}

test('decision session creation', () => {
  const { rt } = runtime();
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1' });
  assert(s.getStatus().state === SessionState.OPEN, 'open');
  assert(s.decisionId, 'id');
});

test('candidate registration', () => {
  const { rt } = runtime();
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1' });
  s.registerCandidate({ candidateId: 'a', answer: { tag: 'div' }, localScore: 0.6 });
  assert(s.getStatus().candidateCount === 1, 'count');
});

test('evidence registration', () => {
  const { rt } = runtime();
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1' });
  s.registerCandidate({ candidateId: 'a', answer: { tag: 'div' }, localScore: 0.6 });
  s.registerEvidence({ evidenceId: 'e1', kind: 'feature', ref: 'x' });
  assert(s.getStatus().evidenceCount === 1, 'ev');
});

test('ranking', () => {
  const { rt } = runtime();
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1' });
  s.registerCandidate({ candidateId: 'low', answer: { t: 1 }, localScore: 0.4, priorityBand: 'P5' });
  s.registerCandidate({ candidateId: 'high', answer: { t: 2 }, localScore: 0.9, priorityBand: 'P5' });
  const r = s.rank();
  assert(r.ranking[0] === 'high', 'rank order');
});

test('winner selection + commit', () => {
  const { ws, rt } = runtime();
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1', decisionId: 'dec-win' });
  const out = s.run({
    candidates: [
      { candidateId: 'section', answer: { tag: 'section' }, localScore: 0.8, priorityBand: 'P4' },
      { candidateId: 'div', answer: { tag: 'div' }, localScore: 0.3, priorityBand: 'P5', safeGeneric: true },
    ],
  });
  assert(out.decision.winner.candidateId === 'section', 'winner');
  assert(out.decision.status === 'arbitrated', 'status');
  assert(ws.getDecision('dec-win') != null, 'workspace');
  assert(out.trace.arbitration.reason === 'winner_selected', 'trace');
});

test('abstain on low margin', () => {
  const { rt } = runtime();
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1' });
  const out = s.run({
    candidates: [
      { candidateId: 'a', answer: { tag: 'section' }, localScore: 0.52, priorityBand: 'P4' },
      { candidateId: 'b', answer: { tag: 'div' }, localScore: 0.51, priorityBand: 'P4' },
    ],
  });
  assert(out.decision.winner.kind === 'abstain', 'abstain');
  assert(out.decision.status === 'arbitrated', 'status');
  assert(out.trace.arbitration.reason === 'margin_below_threshold', 'reason');
});

test('abstain below accept_min', () => {
  const { rt } = runtime();
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1' });
  const out = s.run({
    candidates: [
      { candidateId: 'a', answer: { tag: 'x' }, localScore: 0.2, priorityBand: 'P5' },
    ],
  });
  assert(out.decision.winner.kind === 'abstain', 'abstain');
  assert(out.decision.winner.reason === 'below_accept_min', 'reason');
});

test('override handling', () => {
  const { ws, rt } = runtime();
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1', decisionId: 'dec-ov' });
  const out = s.run({
    candidates: [
      { candidateId: 'section', answer: { tag: 'section' }, localScore: 0.9, priorityBand: 'P4' },
      { candidateId: 'div', answer: { tag: 'div' }, localScore: 0.4, priorityBand: 'P5' },
    ],
    override: {
      forcedCandidateId: 'div',
      actor: 'reviewer',
      reason: 'gold corpus',
    },
  });
  assert(out.decision.status === 'overridden', 'overridden');
  assert(out.decision.winner.candidateId === 'div', 'forced');
  assert(out.decision.override.actor === 'reviewer', 'meta');
  assert(ws.getDecision('dec-ov').status === 'overridden', 'ws');
});

test('workspace hypothesis collect', () => {
  const { ws, rt } = runtime();
  ws.putHypothesis({
    contractId: 'Hypothesis',
    suiteVersion: '1.0.0',
    hypothesisId: 'h1',
    question: 'html.tag',
    subject: 'src:9',
    candidates: [
      { candidateId: 'c1', answer: { tag: 'p' }, localScore: 0.7, priorityBand: 'P5' },
    ],
    evidence: [{ evidenceId: 'e1', kind: 'feature', ref: 'text' }],
    localScores: [{ candidateId: 'c1', value: 0.7 }],
  }, { id: 'fake', capabilities: { writes: [StoreKind.HYPOTHESIS] } });

  const s = rt.createSession({ question: 'html.tag', subject: 'src:9', decisionId: 'dec-ws' });
  const out = s.run({ fromWorkspace: true });
  assert(out.decision.winner.candidateId === 'c1', 'from hyp');
});

test('immutable facts — runtime does not create/mutate facts', () => {
  const { ws, rt } = runtime();
  ws.putFact({
    contractId: 'Fact',
    suiteVersion: '1.0.0',
    factId: 'f1',
    kind: 'source.x',
    subject: 'src:1',
    assertion: { v: 1 },
  });
  const before = JSON.stringify(ws.getFact('f1'));
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1' });
  s.run({
    candidates: [{ candidateId: 'a', answer: { tag: 'div' }, localScore: 0.9, priorityBand: 'P5' }],
  });
  assert(JSON.stringify(ws.getFact('f1')) === before, 'fact unchanged');
  assert(rt.invariants.mutatesFacts === false, 'flag');
});

test('invalid transition — commit before arbitrate', () => {
  const { rt } = runtime();
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1' });
  s.registerCandidate({ candidateId: 'a', answer: { tag: 'div' }, localScore: 0.9 });
  let threw = false;
  try {
    s.commit();
  } catch (e) {
    threw = e.kind === DecisionErrorKind.INVALID_STATE;
  }
  assert(threw, 'invalid');
});

test('duplicate decision rejection via workspace', () => {
  const { ws, rt } = runtime();
  rt.createSession({ question: 'html.tag', subject: 'src:1', decisionId: 'dup' }).run({
    candidates: [{ candidateId: 'a', answer: { tag: 'div' }, localScore: 0.9, priorityBand: 'P5' }],
  });
  let threw = false;
  try {
    rt.createSession({ question: 'html.tag', subject: 'src:1', decisionId: 'dup' }).run({
      candidates: [{ candidateId: 'b', answer: { tag: 'span' }, localScore: 0.95, priorityBand: 'P5' }],
    });
  } catch (e) {
    threw = e.kind === DecisionErrorKind.COMMIT_FAILED;
  }
  assert(threw, 'dup commit');
  assert(ws.getDecision('dup').winner.candidateId === 'a', 'first kept');
});

test('policy validation — missing profile', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  let threw = false;
  try {
    createDecisionRuntime({ workspace: ws, policy: {} });
  } catch (e) {
    threw = e.kind === DecisionErrorKind.POLICY;
  }
  assert(threw, 'policy');
});

test('trace generation', () => {
  const { rt } = runtime();
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1', decisionId: 'dec-tr' });
  const out = s.run({
    candidates: [{ candidateId: 'a', answer: { tag: 'div' }, localScore: 0.9, priorityBand: 'P5' }],
    evidence: [{ evidenceId: 'e1', kind: 'feature', ref: 'x' }],
  });
  assert(out.trace.traceId === 'trace:dec-tr', 'id');
  assert(out.trace.question === 'html.tag', 'q');
  assert(out.trace.scored.length === 1, 'scored');
  assert(rt.getTrace('trace:dec-tr') != null, 'runtime store');
});

test('persisted traces — Workspace durable store after commit', () => {
  const { ws, rt } = runtime();
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1', decisionId: 'dec-persist' });
  const out = s.run({
    candidates: [{ candidateId: 'a', answer: { tag: 'div' }, localScore: 0.9, priorityBand: 'P5' }],
  });
  assert(ws.getTrace('trace:dec-persist') != null, 'ws store');
  assert(ws.getTrace('trace:dec-persist').decisionId === 'dec-persist', 'decisionId');
  assert(ws.listIds(StoreKind.TRACE).includes('trace:dec-persist'), 'list');
  assert(out.trace.traceId === ws.getTrace('trace:dec-persist').traceId, 'same id');
});

test('trace retrieval — Runtime reads Workspace as durable SoT', () => {
  const { ws, rt } = runtime();
  rt.createSession({ question: 'html.tag', subject: 'src:1', decisionId: 'dec-ret' }).run({
    candidates: [{ candidateId: 'a', answer: { tag: 'div' }, localScore: 0.9, priorityBand: 'P5' }],
  });
  // Simulate fresh Runtime bound to same Workspace (no memory cache)
  const rt2 = createDecisionRuntime({ workspace: ws, policy: policy(), contractSuiteVersion: '1.0.0' });
  const retrieved = rt2.getTrace('trace:dec-ret');
  assert(retrieved != null, 'from workspace');
  assert(retrieved.question === 'html.tag', 'content');
  assert(retrieved.arbitration.reason === 'winner_selected', 'arb');
});

test('authoritative thresholds — reject missing slots', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  let threw = false;
  try {
    createDecisionRuntime({
      workspace: ws,
      policy: {
        profileId: 'strict',
        valuesAuthoritative: true,
        thresholds: { accept_min: 0.7 }, // missing margin_min, fallback_below
      },
    });
  } catch (e) {
    threw = e.kind === DecisionErrorKind.POLICY && /accept_min|margin_min|fallback_below/.test(e.message);
  }
  assert(threw, 'missing authoritative');
});

test('authoritative thresholds — consume slots only (no defaults)', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  const rt = createDecisionRuntime({
    workspace: ws,
    policy: {
      profileId: 'strict',
      valuesAuthoritative: true,
      thresholds: {
        accept_min: 0.8,
        margin_min: 0.1,
        fallback_below: 0.5,
      },
    },
  });
  assert(rt.thresholds.authoritative === true, 'auth');
  assert(rt.thresholds.accept_min === 0.8, 'accept');
  assert(rt.thresholds.margin_min === 0.1, 'margin');
  assert(rt.thresholds.fallback_below === 0.5, 'fallback');
});

test('non-authoritative thresholds — defaults allowed (not production policy)', () => {
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  const rt = createDecisionRuntime({
    workspace: ws,
    policy: { profileId: 'dev', valuesAuthoritative: false, thresholds: {} },
  });
  assert(rt.thresholds.authoritative === false, 'non-auth');
  assert(typeof rt.thresholds.accept_min === 'number', 'defaulted');
});

test('kernel invokeDecisionRuntime facade (alias of arbitrate)', () => {
  const k = createKernel();
  const job = k.createJob({ policyProfile: policy() });
  assert(typeof job.invokeDecisionRuntime === 'function', 'named facade');
  assert(k.invariants.ownsArbitration === false, 'kernel does not own');
  const out = job.invokeDecisionRuntime({
    question: 'html.tag',
    subject: 'src:facade',
    candidates: [
      { candidateId: 'x', answer: { tag: 'div' }, localScore: 0.85, priorityBand: 'P5' },
    ],
  });
  assert(out.decision.status === 'arbitrated', 'ok');
  assert(job.getWorkspace().getTrace(out.trace.traceId) != null, 'trace persisted');
});

test('band priority beats lower score', () => {
  const { rt } = runtime();
  const s = rt.createSession({ question: 'layout.mode', subject: 'src:1' });
  const out = s.run({
    candidates: [
      { candidateId: 'weak', answer: { mode: 'guess' }, localScore: 0.99, priorityBand: 'P6' },
      { candidateId: 'strong', answer: { mode: 'factish' }, localScore: 0.55, priorityBand: 'P2' },
    ],
  });
  assert(out.decision.winner.candidateId === 'strong', 'band wins');
});

test('fallen-back to safe generic on tie', () => {
  const { rt } = runtime();
  const s = rt.createSession({ question: 'html.tag', subject: 'src:1' });
  const out = s.run({
    candidates: [
      { candidateId: 'a', answer: { tag: 'section' }, localScore: 0.52, priorityBand: 'P4' },
      { candidateId: 'div', answer: { tag: 'div' }, localScore: 0.51, priorityBand: 'P4', safeGeneric: true },
    ],
  });
  assert(out.decision.status === 'fallen-back', 'fallen-back');
  assert(out.decision.winner.candidateId === 'div', 'generic');
});

test('kernel arbitrate integration', () => {
  const k = createKernel();
  const job = k.createJob({ policyProfile: policy() });
  const out = job.arbitrate({
    question: 'html.tag',
    subject: 'src:k',
    candidates: [
      { candidateId: 'x', answer: { tag: 'div' }, localScore: 0.85, priorityBand: 'P5' },
    ],
  });
  assert(out.decision.status === 'arbitrated', 'ok');
  assert(job.getWorkspace().listIds(StoreKind.DECISION).length >= 1, 'stored');
});

test('recovery hook surface', () => {
  const { rt } = runtime();
  const r = rt.recoveryHook('ambiguity', { question: 'html.tag' });
  assert(r.acknowledged === true, 'ack');
  assert(r.action === 'reopen_session_bounded', 'action');
});

console.log('\n---');
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed) process.exitCode = 1;
else console.log('Phase 4 decision runtime validation: OK');
