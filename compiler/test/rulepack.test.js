'use strict';

/**
 * Phase 8 — Rule Pack infrastructure tests.
 */
const path = require('path');
const {
  RulePackError,
  RulePackErrorKind,
  validateRulePack,
  createRulePackRegistry,
  createRuleContext,
  executeRulePack,
  loadRulePackDirectory,
  loadSyntheticBasicPack,
  FORBIDDEN_WRITES,
  StoreKind,
} = require('../rulepack');
const { createPluginRegistry, createPluginContext, baseDeclaration } = require('../plugin');
const { createWorkspace } = require('../workspace');
const { createKnowledgeRegistry } = require('../knowledge');
const { createKernel } = require('../kernel');
const { buildFingerprint, fingerprintKey } = require('../kernel/fingerprint');

const BUNDLE = path.join(__dirname, '..', 'knowledge', 'bundles', 'compiler-ui-ontology.1.0.0.json');

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

function fact(id) {
  return {
    contractId: 'Fact',
    suiteVersion: '1.0.0',
    factId: id,
    kind: 'source.x',
    subject: 'src:1',
    assertion: { v: 1 },
  };
}

async function main() {
  await test('rule registration via plugin registry', () => {
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadSyntheticBasicPack();
    const n = reg.register(pack, handlers);
    assert(n.packId === 'synthetic.basic', 'id');
    assert(plugins.has('rulepack.synthetic.basic'), 'plugin registered');
    assert(reg.invariants.isPluginBased === true, 'plugin based');
  });

  await test('version validation — bad semver', () => {
    const { pack } = loadSyntheticBasicPack();
    pack.version = 'nope';
    let threw = false;
    try {
      validateRulePack(pack);
    } catch (e) {
      threw = e.kind === RulePackErrorKind.BAD_SEMVER;
    }
    assert(threw, 'semver');
  });

  await test('compatibility — policy deny', () => {
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadSyntheticBasicPack();
    pack.allowedPolicies = ['pixel-faithful'];
    pack.plugin.allowedPolicies = ['pixel-faithful'];
    reg.register(pack, handlers);
    const enabled = reg.listEnabled({ profileId: 'semantic-lean', suiteVersion: '1.0.0' });
    assert(!enabled.find((p) => p.packId === 'synthetic.basic'), 'denied');
  });

  await test('dependency validation', () => {
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadSyntheticBasicPack();
    pack.packId = 'needs-dep';
    pack.plugin.id = 'rulepack.needs-dep';
    pack.dependencies = [{ packId: 'missing.pack', versionRange: '1.0.0', required: true }];
    reg.register(pack, handlers);
    let threw = false;
    try {
      reg.listEnabled({ profileId: 'pixel-faithful', suiteVersion: '1.0.0' });
      // listEnabled skips incompatible — so execute should throw
      // Actually listEnabled catches and skips — pack won't be enabled
    } catch (_) { /* */ }
    const enabled = reg.listEnabled({ profileId: 'pixel-faithful', suiteVersion: '1.0.0' });
    assert(!enabled.find((p) => p.packId === 'needs-dep'), 'dep missing skips enable');
  });

  await test('execution lifecycle — evidence/hypothesis/candidate', async () => {
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadSyntheticBasicPack();
    reg.register(pack, handlers);

    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    ws.putFact(fact('f1'));
    const know = createKnowledgeRegistry();
    know.loadAndRegister(BUNDLE);
    const { handle } = know.pin('compiler-ui-ontology', '1.0.0');

    const out = await reg.execute('synthetic.basic', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful', valuesAuthoritative: true },
      knowledge: handle,
      fingerprint: { seed: 't' },
      suiteVersion: '1.0.0',
      clock: (() => {
        let t = 1000;
        return () => { t += 1; return t; };
      })(),
    });

    assert(out.evidence.length >= 1, 'evidence');
    assert(out.hypotheses.length >= 1, 'hyp');
    assert(out.candidates.length >= 1, 'cand');
    assert(out.timing.ms >= 0, 'timing');
    assert(out.diagnostics.length >= 1, 'diag');
    assert(ws.getHypothesis('hyp:synthetic.fact-to-hypothesis:1') != null, 'ws hyp');
    assert(ws.getEvidence('ev:synthetic.fact-to-hypothesis:1') != null, 'ws ev');
    assert(ws.listIds('DecisionRecord').length === 0, 'no decisions');
  });

  await test('knowledge read in rule', async () => {
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadSyntheticBasicPack();
    reg.register(pack, handlers);
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const know = createKnowledgeRegistry();
    know.loadAndRegister(BUNDLE);
    const { handle } = know.pin('compiler-ui-ontology', '1.0.0');
    const out = await reg.execute('synthetic.basic', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      knowledge: handle,
      suiteVersion: '1.0.0',
    });
    assert(out.evidence[0].ref === 'feature:equalGap', 'knowledge ref');
  });

  await test('workspace read in rule', async () => {
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadSyntheticBasicPack();
    reg.register(pack, handlers);
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    ws.putFact(fact('f-read'));
    const know = createKnowledgeRegistry();
    know.loadAndRegister(BUNDLE);
    const { handle } = know.pin('compiler-ui-ontology', '1.0.0');
    const out = await reg.execute('synthetic.basic', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      knowledge: handle,
      suiteVersion: '1.0.0',
    });
    assert(out.hypotheses[0].subject === 'src:1', 'subject from fact');
  });

  await test('capability — Fact write forbidden at pack validate', () => {
    const { pack } = loadSyntheticBasicPack();
    pack.plugin.writes = ['Hypothesis', 'Evidence', 'Fact'];
    pack.plugin.creates = ['Hypothesis', 'Evidence', 'Fact'];
    let threw = false;
    try {
      validateRulePack(pack);
    } catch (e) {
      threw = e.kind === RulePackErrorKind.FORBIDDEN;
    }
    assert(threw, 'fact write');
  });

  await test('Decision denial on rule context', () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const decl = baseDeclaration({
      writes: [StoreKind.HYPOTHESIS, StoreKind.EVIDENCE],
      creates: [StoreKind.HYPOTHESIS, StoreKind.EVIDENCE],
      requiredCapabilities: [],
    });
    const pluginCtx = createPluginContext({
      workspace: ws,
      declaration: decl,
      policy: { profileId: 'x' },
    });
    const ctx = createRuleContext(pluginCtx, { policy: { profileId: 'x' }, pack: { packId: 't', version: '1.0.0' } });
    let threw = false;
    try {
      ctx.putDecision({});
    } catch (e) {
      threw = e.kind === RulePackErrorKind.FORBIDDEN;
    }
    assert(threw, 'decision');
    threw = false;
    try {
      ctx.arbitrate();
    } catch (e) {
      threw = e.kind === RulePackErrorKind.FORBIDDEN;
    }
    assert(threw, 'arbitrate');
  });

  await test('Workspace mutation denial', () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const decl = baseDeclaration({
      writes: [StoreKind.HYPOTHESIS, StoreKind.EVIDENCE],
      creates: [StoreKind.HYPOTHESIS, StoreKind.EVIDENCE],
    });
    const pluginCtx = createPluginContext({
      workspace: ws,
      declaration: decl,
      policy: { profileId: 'x' },
    });
    const ctx = createRuleContext(pluginCtx, { policy: { profileId: 'x' }, pack: { packId: 't', version: '1.0.0' } });
    let threw = false;
    try {
      ctx.putFact({});
    } catch (e) {
      threw = e.kind === RulePackErrorKind.FORBIDDEN;
    }
    assert(threw, 'putFact');
  });

  await test('Knowledge mutation denial', () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const decl = baseDeclaration({
      writes: [StoreKind.HYPOTHESIS, StoreKind.EVIDENCE],
      creates: [StoreKind.HYPOTHESIS, StoreKind.EVIDENCE],
    });
    const pluginCtx = createPluginContext({
      workspace: ws,
      declaration: decl,
      policy: { profileId: 'x' },
    });
    const ctx = createRuleContext(pluginCtx, { policy: { profileId: 'x' }, pack: { packId: 't', version: '1.0.0' } });
    let threw = false;
    try {
      ctx.mutateKnowledge();
    } catch (e) {
      threw = e.kind === RulePackErrorKind.FORBIDDEN;
    }
    assert(threw, 'knowledge');
  });

  await test('fingerprint stability for rule packs', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      rulePacks: [
        { packId: 'b', version: '1.0.0' },
        { packId: 'a', version: '2.0.0' },
      ],
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      rulePacks: [
        { packId: 'a', version: '2.0.0' },
        { packId: 'b', version: '1.0.0' },
      ],
    }));
    assert(a === b, 'stable order');
  });

  await test('deterministic execution', async () => {
    const run = async () => {
      const plugins = createPluginRegistry();
      const reg = createRulePackRegistry({ pluginRegistry: plugins });
      const { pack, handlers } = loadSyntheticBasicPack();
      // unique plugin id per run would conflict — use fresh registries
      pack.plugin.id = 'rulepack.synthetic.basic';
      reg.register(pack, handlers);
      const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
      ws.putFact(fact('f1'));
      const know = createKnowledgeRegistry();
      know.loadAndRegister(BUNDLE);
      const { handle } = know.pin('compiler-ui-ontology', '1.0.0');
      let t = 0;
      return reg.execute('synthetic.basic', {
        workspace: ws,
        policy: { profileId: 'pixel-faithful' },
        knowledge: handle,
        suiteVersion: '1.0.0',
        clock: () => { t += 1; return t; },
      });
    };
    const a = await run();
    const b = await run();
    assert(JSON.stringify(a.candidates) === JSON.stringify(b.candidates), 'cands');
    assert(JSON.stringify(a.hypotheses.map((h) => h.hypothesisId))
      === JSON.stringify(b.hypotheses.map((h) => h.hypothesisId)), 'hyps');
  });

  await test('Kernel load + executeRulePack + fingerprint', async () => {
    const k = createKernel();
    k.loadKnowledge(BUNDLE);
    k.loadRulePackDirectory(path.join(__dirname, '..', 'rulepack', 'packs', 'synthetic-basic'));
    const job = k.createJob({
      policyProfileId: 'pixel-faithful',
      knowledgeBundleId: 'compiler-ui-ontology',
      knowledgeBundleVersion: '1.0.0',
      seed: 'rp1',
      jobId: 'job-rp',
    });
    assert(job.getFingerprint().rulePacks.some((p) => p.packId === 'synthetic.basic'), 'fp');
    job.attachWorkspace().putFact(fact('f-k'));
    const out = await job.executeRulePack('synthetic.basic');
    assert(out.hypotheses.length === 1, 'hyp');
    assert(job.getWorkspace().listIds('DecisionRecord').length === 0, 'no dec');
  });

  await test('FORBIDDEN_WRITES includes Decision and Fact', () => {
    assert(FORBIDDEN_WRITES.includes(StoreKind.DECISION), 'dec');
    assert(FORBIDDEN_WRITES.includes(StoreKind.FACT), 'fact');
    assert(FORBIDDEN_WRITES.includes(StoreKind.TRACE), 'trace');
  });

  console.log('\n---');
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed) process.exitCode = 1;
  else console.log('Phase 8 rule pack validation: OK');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
