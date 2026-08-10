'use strict';

/**
 * Phase 5 — Policy Profiles tests.
 * Configuration only; no domain engines.
 */
const path = require('path');
const fs = require('fs');
const {
  PolicyError,
  PolicyErrorKind,
  validateProfile,
  resolveProfile,
  listProfiles,
  createPolicyRegistry,
  createDefaultPolicyRegistry,
  serializeProfile,
  deserializeProfile,
  checkCompatibility,
  gateOptionsFromProfile,
  getDefaultRegistry,
} = require('../policy');
const { createWorkspace } = require('../workspace');
const { createDecisionRuntime } = require('../decision');
const { createKernel } = require('../kernel');
const { evaluateGate } = require('../kernel/gates');

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

const CANDIDATES_MID = [
  { candidateId: 'section', answer: { tag: 'section' }, localScore: 0.65, priorityBand: 'P4' },
  { candidateId: 'div', answer: { tag: 'div' }, localScore: 0.4, priorityBand: 'P5', safeGeneric: true },
];

test('loading — default registry loads corpus', () => {
  const ids = listProfiles();
  assert(ids.includes('pixel-faithful'), 'pixel');
  assert(ids.includes('semantic-lean'), 'semantic');
  assert(ids.includes('static-ok'), 'static');
  assert(ids.includes('interactive-required'), 'interactive');
});

test('valid profiles resolve authoritative', () => {
  const p = resolveProfile('pixel-faithful');
  assert(p.valuesAuthoritative === true, 'auth');
  assert(p.thresholds.accept_min === 0.75, 'accept');
  assert(p.gateMode === 'fail_closed', 'gate');
  assert(Object.isFrozen(p), 'frozen');
});

test('invalid profiles rejected', () => {
  let threw = false;
  try {
    validateProfile({ contractId: 'PolicyProfile', profileId: 'x', valuesAuthoritative: true, thresholds: {} });
  } catch (e) {
    threw = e.kind === PolicyErrorKind.MISSING_THRESHOLDS;
  }
  assert(threw, 'missing thresholds');
});

test('invalid — bad gateMode', () => {
  let threw = false;
  try {
    validateProfile({
      profileId: 'bad',
      gateMode: 'yolo',
      valuesAuthoritative: false,
    });
  } catch (e) {
    threw = e.kind === PolicyErrorKind.INVALID_PROFILE;
  }
  assert(threw, 'gateMode');
});

test('profile inheritance — static-ok extends pixel-faithful', () => {
  const p = resolveProfile('static-ok');
  assert(p.profileId === 'static-ok', 'id');
  assert(p.thresholds.accept_min === 0.75, 'inherited accept');
  assert(p.flags.staticEmitOnly === true, 'child flag');
  assert(p.flags.aggressiveAbstain === true, 'parent flag');
  assert(p.resolvedFrom.includes('pixel-faithful'), 'chain');
  assert(!p.extends, 'extends cleared');
});

test('missing thresholds on authoritative leaf rejected', () => {
  const reg = createPolicyRegistry({ expectedSuiteVersion: '1.0.0' });
  reg.registerRaw({
    profileId: 'broken',
    suiteVersion: '1.0.0',
    valuesAuthoritative: true,
    thresholds: { accept_min: 0.5 },
  }, { skipValidate: true });
  let threw = false;
  try {
    reg.resolve('broken');
  } catch (e) {
    threw = e.kind === PolicyErrorKind.MISSING_THRESHOLDS;
  }
  assert(threw, 'missing');
});

test('authoritative enforcement — Decision Runtime consumes profile slots', () => {
  const policy = resolveProfile('pixel-faithful');
  const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
  const rt = createDecisionRuntime({ workspace: ws, policy, contractSuiteVersion: '1.0.0' });
  assert(rt.thresholds.authoritative === true, 'auth');
  assert(rt.thresholds.accept_min === 0.75, 'from profile');
  assert(rt.policy.valuesAuthoritative === true, 'flag');
});

test('compatibility — suite version mismatch', () => {
  const p = resolveProfile('semantic-lean');
  let threw = false;
  try {
    checkCompatibility(p, { suiteVersion: '9.9.9' });
  } catch (e) {
    threw = e.kind === PolicyErrorKind.INCOMPATIBLE;
  }
  assert(threw, 'suite');
});

test('compatibility — engine allowlist', () => {
  const reg = createPolicyRegistry({ expectedSuiteVersion: '1.0.0' });
  reg.registerRaw({
    profileId: 'locked',
    suiteVersion: '1.0.0',
    valuesAuthoritative: true,
    allowedEngineIds: ['engine.a'],
    thresholds: { accept_min: 0.5, margin_min: 0.05, fallback_below: 0.4 },
  });
  const p = reg.resolve('locked');
  let threw = false;
  try {
    checkCompatibility(p, { engineId: 'engine.b' });
  } catch (e) {
    threw = e.kind === PolicyErrorKind.INCOMPATIBLE;
  }
  assert(threw, 'engine');
  assert(checkCompatibility(p, { engineId: 'engine.a' }).ok === true, 'allowed');
});

test('serialization roundtrip', () => {
  const p = resolveProfile('semantic-lean');
  const json = serializeProfile(p);
  const back = deserializeProfile(json);
  assert(back.profileId === 'semantic-lean', 'id');
  assert(back.thresholds.accept_min === p.thresholds.accept_min, 'thresh');
});

test('version mismatch on resolve', () => {
  let threw = false;
  try {
    resolveProfile('pixel-faithful', { expectedSuiteVersion: '2.0.0' });
  } catch (e) {
    threw = e.kind === PolicyErrorKind.VERSION_MISMATCH;
  }
  assert(threw, 'version');
});

test('unknown profileId', () => {
  let threw = false;
  try {
    resolveProfile('does-not-exist');
  } catch (e) {
    threw = e.kind === PolicyErrorKind.UNKNOWN_PROFILE;
  }
  assert(threw, 'unknown');
});

test('same synthetic decisions differ by profile', () => {
  function run(profileId) {
    const policy = resolveProfile(profileId);
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const rt = createDecisionRuntime({ workspace: ws, policy, contractSuiteVersion: '1.0.0' });
    return rt.createSession({
      question: 'html.tag',
      subject: 'src:1',
      decisionId: `dec-${profileId}`,
    }).run({ candidates: CANDIDATES_MID });
  }
  const pixel = run('pixel-faithful');
  const lean = run('semantic-lean');
  // 0.65 < 0.75 → abstain under pixel-faithful; ≥ 0.55 → winner under semantic-lean
  assert(pixel.decision.winner.kind === 'abstain', 'pixel abstains');
  assert(lean.decision.winner.candidateId === 'section', 'lean accepts');
  assert(pixel.decision.status !== lean.decision.status
    || pixel.decision.winner.kind !== lean.decision.winner.kind, 'differ');
});

test('gateMode fail_closed vs best_effort', () => {
  const report = {
    contractId: 'QualityReport',
    suiteVersion: '1.0.0',
    reportId: 'q1',
    violations: [{ severity: 'error', code: 'x', message: 'err' }],
  };
  const pf = resolveProfile('pixel-faithful');
  const sl = resolveProfile('semantic-lean');
  assert(gateOptionsFromProfile(pf).failClosed === true, 'pf closed');
  assert(gateOptionsFromProfile(sl).failClosed === false, 'sl effort');
  assert(evaluateGate(report, gateOptionsFromProfile(pf)).ok === false, 'pf fail');
  assert(evaluateGate(report, gateOptionsFromProfile(sl)).ok === true, 'sl continue');
  assert(evaluateGate(report, gateOptionsFromProfile(sl)).reason === 'errors_present_but_best_effort', 'reason');
});

test('Kernel resolves policyProfileId from registry', () => {
  const k = createKernel();
  const job = k.createJob({ policyProfileId: 'pixel-faithful' });
  const pol = job.getPolicy();
  assert(pol.profileId === 'pixel-faithful', 'id');
  assert(pol.valuesAuthoritative === true, 'auth');
  assert(pol.thresholds.accept_min === 0.75, 'thresh');
});

test('Kernel gate uses profile gateMode by default', () => {
  const k = createKernel();
  const jobLean = k.createJob({ policyProfileId: 'semantic-lean' });
  const report = {
    contractId: 'QualityReport',
    suiteVersion: '1.0.0',
    reportId: 'q2',
    violations: [{ severity: 'error', code: 'x', message: 'err' }],
  };
  const st = jobLean.runEmpty({ qualityReport: report });
  assert(st.state === 'success', 'best_effort continues');

  const jobPf = k.createJob({ policyProfileId: 'pixel-faithful' });
  const st2 = jobPf.runEmpty({ qualityReport: report });
  assert(st2.state === 'failed', 'fail_closed');
});

test('policy invariants — configuration only', () => {
  const reg = getDefaultRegistry();
  assert(reg.invariants.providesConfigurationOnly === true, 'config');
  assert(reg.invariants.executesLogic === false, 'no logic');
  assert(reg.invariants.choosesWinners === false, 'no winners');
  assert(reg.invariants.emitsArtifacts === false, 'no emit');
});

test('circular inheritance rejected', () => {
  const reg = createPolicyRegistry({ expectedSuiteVersion: '1.0.0' });
  reg.registerRaw({
    profileId: 'a',
    suiteVersion: '1.0.0',
    extends: 'b',
    valuesAuthoritative: true,
    thresholds: { accept_min: 0.5, margin_min: 0.05, fallback_below: 0.4 },
  }, { skipValidate: true });
  reg.registerRaw({
    profileId: 'b',
    suiteVersion: '1.0.0',
    extends: 'a',
    valuesAuthoritative: true,
    thresholds: { accept_min: 0.5, margin_min: 0.05, fallback_below: 0.4 },
  }, { skipValidate: true });
  let threw = false;
  try {
    reg.resolve('a');
  } catch (e) {
    threw = e.kind === PolicyErrorKind.INHERITANCE;
  }
  assert(threw, 'cycle');
});

test('profiles directory files are valid JSON', () => {
  const dir = path.join(__dirname, '..', 'policy', 'profiles');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
});

console.log('\n---');
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed) process.exitCode = 1;
else console.log('Phase 5 policy profiles validation: OK');
