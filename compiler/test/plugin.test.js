'use strict';

/**
 * Phase 6 — Plugin Capability Contract tests.
 */
const { createKernel, FailureKind, JobState } = require('../kernel');
const { createWorkspace, StoreKind } = require('../workspace');
const {
  PluginError,
  PluginErrorKind,
  validateDeclaration,
  createPluginRegistry,
  createPluginContext,
  executePlugin,
  buildPluginSchedule,
  checkPluginCompatibility,
  baseDeclaration,
  REQUIRED_FIELDS,
} = require('../plugin');
const { buildFingerprint, fingerprintKey } = require('../kernel/fingerprint');
const { resolveProfile } = require('../policy');

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

function fact(id, assertion = { v: 1 }) {
  return {
    contractId: 'Fact',
    suiteVersion: '1.0.0',
    factId: id,
    kind: 'source.x',
    subject: 'src:1',
    assertion,
  };
}

function hyp(id) {
  return {
    contractId: 'Hypothesis',
    suiteVersion: '1.0.0',
    hypothesisId: id,
    question: 'html.tag',
    subject: 'src:1',
    candidates: [{ candidateId: 'c1', answer: { tag: 'div' } }],
  };
}

async function main() {
  await test('registration — valid plugin', () => {
    const reg = createPluginRegistry();
    const d = reg.register(baseDeclaration({ id: 'engine.fake.a' }));
    assert(d.id === 'engine.fake.a', 'id');
    assert(reg.has('engine.fake.a'), 'has');
  });

  await test('duplicate ids rejected', () => {
    const reg = createPluginRegistry();
    reg.register(baseDeclaration({ id: 'engine.fake.dup' }));
    let threw = false;
    try {
      reg.register(baseDeclaration({ id: 'engine.fake.dup', version: '1.0.1' }));
    } catch (e) {
      threw = e.kind === PluginErrorKind.DUPLICATE_ID;
    }
    assert(threw, 'dup id');
  });

  await test('bad semver rejected', () => {
    let threw = false;
    try {
      validateDeclaration(baseDeclaration({ version: 'not-semver' }));
    } catch (e) {
      threw = e.kind === PluginErrorKind.BAD_SEMVER;
    }
    assert(threw, 'semver');
  });

  await test('missing required fields rejected', () => {
    let threw = false;
    try {
      validateDeclaration({ id: 'x', version: '1.0.0' });
    } catch (e) {
      threw = e.kind === PluginErrorKind.INVALID_DECLARATION;
    }
    assert(threw, 'missing');
    assert(REQUIRED_FIELDS.length >= 24, 'field count');
  });

  await test('invalid StoreKinds rejected', () => {
    let threw = false;
    try {
      validateDeclaration(baseDeclaration({ reads: ['NotAKind'] }));
    } catch (e) {
      threw = e.kind === PluginErrorKind.UNKNOWN_STORE_KIND;
    }
    assert(threw, 'store kind');
  });

  await test('Decision monopoly — write DecisionRecord rejected', () => {
    let threw = false;
    try {
      validateDeclaration(baseDeclaration({
        writes: [StoreKind.DECISION, StoreKind.HYPOTHESIS],
        creates: [StoreKind.HYPOTHESIS],
      }));
    } catch (e) {
      threw = e.kind === PluginErrorKind.FORBIDDEN_WRITE;
    }
    assert(threw, 'decision');
  });

  await test('DecisionTrace monopoly rejected', () => {
    let threw = false;
    try {
      validateDeclaration(baseDeclaration({
        writes: [StoreKind.TRACE],
        creates: [],
      }));
    } catch (e) {
      threw = e.kind === PluginErrorKind.FORBIDDEN_WRITE;
    }
    assert(threw, 'trace');
  });

  await test('creates must be ⊆ writes', () => {
    let threw = false;
    try {
      validateDeclaration(baseDeclaration({
        writes: [StoreKind.HYPOTHESIS],
        creates: [StoreKind.EVIDENCE],
      }));
    } catch (e) {
      threw = e.kind === PluginErrorKind.CREATES_NOT_SUBSET;
    }
    assert(threw, 'subset');
  });

  await test('invalid IR stage rejected', () => {
    let threw = false;
    try {
      validateDeclaration(baseDeclaration({
        writes: [StoreKind.IR_SLICE],
        creates: [StoreKind.IR_SLICE],
        emittedIR: ['not-a-real-stage'],
      }));
    } catch (e) {
      threw = e.kind === PluginErrorKind.UNKNOWN_IR_STAGE;
    }
    assert(threw, 'ir');
  });

  await test('invalid question id rejected', () => {
    let threw = false;
    try {
      validateDeclaration(baseDeclaration({ acceptedQuestions: ['not.a.question'] }));
    } catch (e) {
      threw = e.kind === PluginErrorKind.UNKNOWN_QUESTION;
    }
    assert(threw, 'question');
  });

  await test('undeclared write denied at context', () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const decl = baseDeclaration({
      writes: [StoreKind.HYPOTHESIS],
      creates: [StoreKind.HYPOTHESIS],
      reads: [StoreKind.FACT],
    });
    const ctx = createPluginContext({ workspace: ws, declaration: decl, policy: { profileId: 'x' } });
    let threw = false;
    try {
      ctx.putEvidence({ evidenceId: 'e1', kind: 'feature' });
    } catch (e) {
      threw = e.kind === PluginErrorKind.CAPABILITY_DENIED;
    }
    assert(threw, 'write deny');
  });

  await test('undeclared read denied at context', () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const decl = baseDeclaration({
      reads: [StoreKind.FACT],
      writes: [StoreKind.HYPOTHESIS],
      creates: [StoreKind.HYPOTHESIS],
    });
    const ctx = createPluginContext({ workspace: ws, declaration: decl, policy: { profileId: 'x' } });
    let threw = false;
    try {
      ctx.getHypothesis('h1');
    } catch (e) {
      threw = e.kind === PluginErrorKind.CAPABILITY_DENIED;
    }
    assert(threw, 'read deny');
  });

  await test('Fact mutation rejection', () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    ws.putFact(fact('f1', { v: 1 }));
    const decl = baseDeclaration({
      reads: [StoreKind.FACT],
      writes: [StoreKind.FACT],
      creates: [StoreKind.FACT],
    });
    const ctx = createPluginContext({ workspace: ws, declaration: decl, policy: { profileId: 'x' } });
    let threw = false;
    try {
      ctx.putFact(fact('f1', { v: 2 }));
    } catch (e) {
      threw = e.kind === PluginErrorKind.CAPABILITY_DENIED;
    }
    assert(threw, 'mutate');
  });

  await test('Workspace bypass rejection', () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const ctx = createPluginContext({
      workspace: ws,
      declaration: baseDeclaration(),
      policy: { profileId: 'x' },
    });
    let threw = false;
    try {
      ctx.getWorkspace();
    } catch (e) {
      threw = e.kind === PluginErrorKind.CAPABILITY_DENIED;
    }
    assert(threw, 'bypass ws');
  });

  await test('Runtime bypass rejection', () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const ctx = createPluginContext({
      workspace: ws,
      declaration: baseDeclaration(),
      policy: { profileId: 'x' },
    });
    let threw = false;
    try {
      ctx.putDecision({});
    } catch (e) {
      threw = e.kind === PluginErrorKind.CAPABILITY_DENIED;
    }
    assert(threw, 'bypass decision');
    threw = false;
    try {
      ctx.invokeDecisionRuntime();
    } catch (e) {
      threw = e.kind === PluginErrorKind.CAPABILITY_DENIED;
    }
    assert(threw, 'bypass runtime');
  });

  await test('plugin isolation — staged commit', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const decl = baseDeclaration({ id: 'engine.fake.iso' });
    const out = await executePlugin({
      declaration: decl,
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      handler: (ctx) => {
        ctx.putHypothesis(hyp('h-iso'));
        assert(ws.getHypothesis('h-iso') === null, 'not yet in ws');
        return 'ok';
      },
    });
    assert(out.ok === true, 'ok');
    assert(ws.getHypothesis('h-iso') != null, 'committed');
  });

  await test('crash handling — workspace & decisions preserved', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    ws.putFact(fact('f-keep'));
    const k = createKernel();
    const job = k.createJob({ policyProfileId: 'pixel-faithful', jobId: 'job-crash' });
    // commit a decision first
    job.attachWorkspace();
    // use same workspace as job
    const wsJob = job.getWorkspace();
    wsJob.putFact(fact('f-job'));
    const dec = job.invokeDecisionRuntime({
      question: 'html.tag',
      subject: 'src:1',
      decisionId: 'dec-keep',
      candidates: [
        { candidateId: 'a', answer: { tag: 'div' }, localScore: 0.9, priorityBand: 'P5' },
      ],
    });
    assert(wsJob.getDecision('dec-keep') != null, 'dec');
    assert(wsJob.getTrace(dec.trace.traceId) != null, 'trace');

    k.registerPlugin(baseDeclaration({
      id: 'engine.fake.crash',
      retries: 0,
      timeout: 2000,
    }));
    // re-create job won't have plugin in fingerprint from before register — execute on new job
    const job2 = k.createJob({ policyProfileId: 'semantic-lean', jobId: 'job-crash-2' });
    const ws2 = job2.attachWorkspace();
    ws2.putFact(fact('f2'));
    // seed decision on ws2
    job2.invokeDecisionRuntime({
      question: 'html.tag',
      subject: 'src:1',
      decisionId: 'dec-keep-2',
      candidates: [
        { candidateId: 'a', answer: { tag: 'div' }, localScore: 0.9, priorityBand: 'P5' },
      ],
    });

    const result = await job2.executePlugin('engine.fake.crash', () => {
      throw new Error('boom');
    }, { onFailure: 'continue' });

    assert(result.ok === false, 'failed');
    assert(ws2.getDecision('dec-keep-2') != null, 'decision preserved');
    assert(ws2.getFact('f2') != null, 'fact preserved');
    assert(ws2.listIds(StoreKind.TRACE).length >= 1, 'trace preserved');
  });

  await test('rollback — failed execute does not persist staged writes', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const decl = baseDeclaration({ id: 'engine.fake.rollback', retries: 0 });
    const out = await executePlugin({
      declaration: decl,
      workspace: ws,
      policy: { profileId: 'x' },
      onFailure: 'continue',
      handler: (ctx) => {
        ctx.putHypothesis(hyp('h-roll'));
        throw new Error('fail after stage');
      },
    });
    assert(out.ok === false, 'fail');
    assert(ws.getHypothesis('h-roll') === null, 'rolled back');
  });

  await test('retry — succeeds on second attempt', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const decl = baseDeclaration({ id: 'engine.fake.retry', retries: 1, timeout: 3000 });
    let n = 0;
    const out = await executePlugin({
      declaration: decl,
      workspace: ws,
      policy: { profileId: 'x' },
      handler: (ctx) => {
        n += 1;
        if (n === 1) throw new Error('transient');
        ctx.putHypothesis(hyp('h-retry'));
      },
    });
    assert(out.ok === true, 'ok');
    assert(out.attempts === 2, 'attempts');
    assert(ws.getHypothesis('h-retry') != null, 'persisted');
  });

  await test('timeout handling', async () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const decl = baseDeclaration({ id: 'engine.fake.slow', timeout: 50, retries: 0 });
    const out = await executePlugin({
      declaration: decl,
      workspace: ws,
      policy: { profileId: 'x' },
      onFailure: 'continue',
      handler: () => new Promise((r) => setTimeout(r, 500)),
    });
    assert(out.ok === false, 'timeout fail');
    assert(out.error.kind === PluginErrorKind.TIMEOUT, 'kind');
  });

  await test('fingerprint includes plugins stable order', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      plugins: [{ id: 'engine.b', version: '1.0.0' }, { id: 'engine.a', version: '2.0.0' }],
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      plugins: [{ id: 'engine.a', version: '2.0.0' }, { id: 'engine.b', version: '1.0.0' }],
    }));
    assert(a === b, 'order stable');
    assert(a.includes('engine.a'), 'has a');
  });

  await test('policy compatibility', () => {
    const p = baseDeclaration({
      id: 'engine.fake.pol',
      allowedPolicies: ['pixel-faithful'],
    });
    let threw = false;
    try {
      checkPluginCompatibility(p, { profileId: 'semantic-lean' });
    } catch (e) {
      threw = e.kind === PluginErrorKind.INCOMPATIBLE;
    }
    assert(threw, 'policy');
    assert(checkPluginCompatibility(p, { profileId: 'pixel-faithful' }).ok, 'ok');
  });

  await test('version / suite compatibility', () => {
    const p = baseDeclaration({
      id: 'engine.fake.ver',
      contractSuiteVersion: '1.0.0',
      minCompilerVersion: '2.0.0',
    });
    let threw = false;
    try {
      checkPluginCompatibility(p, { suiteVersion: '1.0.0', compilerVersion: '1.0.0' });
    } catch (e) {
      threw = e.kind === PluginErrorKind.INCOMPATIBLE;
    }
    assert(threw, 'compiler min');
  });

  await test('engine allowlist', () => {
    const p = baseDeclaration({ id: 'engine.fake.allow' });
    let threw = false;
    try {
      checkPluginCompatibility(p, { allowedEngineIds: ['other.engine'] });
    } catch (e) {
      threw = e.kind === PluginErrorKind.INCOMPATIBLE;
    }
    assert(threw, 'allowlist');
  });

  await test('scheduler ordering by cost then id', () => {
    const list = [
      baseDeclaration({ id: 'engine.z', phaseAffinity: 'mid', estimatedCost: 5 }),
      baseDeclaration({ id: 'engine.a', phaseAffinity: 'mid', estimatedCost: 1 }),
      baseDeclaration({ id: 'engine.b', phaseAffinity: 'early', estimatedCost: 9 }),
    ];
    const sch = buildPluginSchedule(list);
    assert(sch.waves[0].engineIds[0] === 'engine.b', 'early');
    assert(sch.waves[1].engineIds[0] === 'engine.a', 'cheap first');
    assert(sch.waves[1].engineIds[1] === 'engine.z', 'then z');
  });

  await test('determinism — nondeterministic excluded when strict', () => {
    const reg = createPluginRegistry();
    reg.register(baseDeclaration({ id: 'engine.fake.pure', determinism: 'pure' }));
    reg.register(baseDeclaration({
      id: 'engine.fake.nd',
      determinism: 'nondeterministic',
      acceptedQuestions: ['html.tag'],
    }));
    const enabled = reg.listEnabled({
      profileId: 'pixel-faithful',
      determinismStrict: true,
    });
    assert(enabled.some((p) => p.id === 'engine.fake.pure'), 'pure');
    assert(!enabled.some((p) => p.id === 'engine.fake.nd'), 'nd out');
  });

  await test('Kernel registerPlugin + execute + fingerprint', async () => {
    const k = createKernel();
    k.registerPlugin(baseDeclaration({ id: 'engine.fake.kern' }));
    const job = k.createJob({
      policyProfileId: 'pixel-faithful',
      seed: 's1',
      jobId: 'job-fp',
    });
    const fp = job.getFingerprint();
    assert(fp.plugins.some((p) => p.id === 'engine.fake.kern'), 'fp plugin');
    const out = await job.executePlugin('engine.fake.kern', (ctx) => {
      ctx.putHypothesis(hyp('h-kern'));
      return 1;
    }, { onFailure: 'continue' });
    assert(out.ok === true, 'exec');
    assert(job.getWorkspace().getHypothesis('h-kern') != null, 'ws');
  });

  await test('incompatiblePlugins mutual exclusion', () => {
    const reg = createPluginRegistry();
    reg.register(baseDeclaration({
      id: 'engine.fake.x',
      incompatiblePlugins: ['engine.fake.y'],
    }));
    reg.register(baseDeclaration({
      id: 'engine.fake.y',
      incompatiblePlugins: ['engine.fake.x'],
    }));
    const enabled = reg.listEnabled({ profileId: 'pixel-faithful' });
    // both list each other — filter removes both or one? Our filter: if other in enabledIds, exclude.
    // Both would be in first pass, then both excluded → empty for those two.
    assert(!enabled.find((p) => p.id === 'engine.fake.x')
      || !enabled.find((p) => p.id === 'engine.fake.y'), 'mutex');
    assert(enabled.filter((p) => p.id === 'engine.fake.x' || p.id === 'engine.fake.y').length <= 1, 'at most one');
  });

  console.log('\n---');
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed) process.exitCode = 1;
  else console.log('Phase 6 plugin capability validation: OK');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
