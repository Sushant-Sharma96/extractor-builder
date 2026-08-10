'use strict';

/**
 * Phase 7 — Knowledge Bundle infrastructure tests.
 */
const path = require('path');
const {
  KnowledgeError,
  KnowledgeErrorKind,
  validateBundle,
  loadBundle,
  sealWithChecksum,
  computeChecksum,
  createKnowledgeRegistry,
  createKnowledgeHandle,
  composeLayers,
  resolveDependencies,
  emptyBundle,
} = require('../knowledge');
const { createKernel } = require('../kernel');
const { fingerprintKey } = require('../kernel/fingerprint');
const { createWorkspace, StoreKind } = require('../workspace');
const {
  createPluginContext,
  executePlugin,
  baseDeclaration,
  PluginErrorKind,
} = require('../plugin');
const { buildFingerprint } = require('../kernel/fingerprint');

const BUNDLE_DIR = path.join(__dirname, '..', 'knowledge', 'bundles');

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

async function main() {
  await test('valid bundles load + register', () => {
    const reg = createKnowledgeRegistry();
    const b = reg.loadAndRegister(path.join(BUNDLE_DIR, 'compiler-ui-ontology.1.0.0.json'));
    assert(b.bundleId === 'compiler-ui-ontology', 'id');
    assert(b.checksum && b.checksum.length === 64, 'checksum');
    assert(reg.get('compiler-ui-ontology', '1.0.0') != null, 'get');
  });

  await test('invalid bundles rejected', () => {
    let threw = false;
    try {
      validateBundle({ contractId: 'KnowledgeBundle', bundleId: 'x' });
    } catch (e) {
      threw = e.kind === KnowledgeErrorKind.INVALID_BUNDLE;
    }
    assert(threw, 'invalid');
  });

  await test('checksum mismatch', () => {
    const sealed = sealWithChecksum(emptyBundle({
      entries: [{ entryId: 'pattern:a', kind: 'pattern' }],
      relations: [],
    }));
    const tampered = JSON.parse(JSON.stringify(sealed));
    tampered.entries.push({ entryId: 'pattern:b', kind: 'pattern' });
    // keep old checksum
    let threw = false;
    try {
      validateBundle(tampered, { verifyChecksum: true });
    } catch (e) {
      threw = e.kind === KnowledgeErrorKind.CHECKSUM_MISMATCH;
    }
    assert(threw, 'checksum');
  });

  await test('version mismatch on suite', () => {
    const b = emptyBundle();
    let threw = false;
    try {
      validateBundle(b, { expectedSuiteVersion: '9.9.9' });
    } catch (e) {
      threw = e.kind === KnowledgeErrorKind.VERSION_MISMATCH;
    }
    assert(threw, 'suite');
  });

  await test('dependency cycles rejected', () => {
    const a = sealWithChecksum(emptyBundle({
      bundleId: 'dep-a',
      version: '1.0.0',
      dependencies: [{ bundleId: 'dep-b', versionRange: '1.0.0', required: true }],
    }));
    const b = sealWithChecksum(emptyBundle({
      bundleId: 'dep-b',
      version: '1.0.0',
      dependencies: [{ bundleId: 'dep-a', versionRange: '1.0.0', required: true }],
    }));
    const catalog = (id) => {
      if (id === 'dep-a') return [{ version: '1.0.0', bundle: a }];
      if (id === 'dep-b') return [{ version: '1.0.0', bundle: b }];
      return [];
    };
    let threw = false;
    try {
      resolveDependencies(a, catalog);
    } catch (e) {
      threw = e.kind === KnowledgeErrorKind.DEPENDENCY_CYCLE;
    }
    assert(threw, 'cycle');
  });

  await test('layer composition deterministic', () => {
    const reg = createKnowledgeRegistry();
    reg.loadAndRegister(path.join(BUNDLE_DIR, 'compiler-ui-ontology.1.0.0.json'));
    reg.loadAndRegister(path.join(BUNDLE_DIR, 'compiler-ui-ontology-overlay.1.0.0.json'));
    reg.loadAndRegister(path.join(BUNDLE_DIR, 'compiler-ui-composed.1.0.0.json'));
    const p1 = reg.pin('compiler-ui-composed', '1.0.0');
    const p2 = reg.pin('compiler-ui-composed', '1.0.0');
    assert(p1.pin.knowledgeChecksum === p2.pin.knowledgeChecksum, 'same checksum');
    assert(p1.handle.get('pattern:block.generic').aliases.includes('overlay-alias'), 'overlay wins');
    assert(p1.handle.get('pattern:region.band') != null, 'new entry');
    assert(p1.handle.get('motif:repeated-peer') != null, 'base kept');
  });

  await test('composeLayers order stable', () => {
    const base = sealWithChecksum(emptyBundle({
      bundleId: 'base',
      entries: [{ entryId: 'pattern:x', kind: 'pattern', aliases: ['a'] }],
    }));
    const layer = sealWithChecksum(emptyBundle({
      bundleId: 'layer',
      entries: [{ entryId: 'pattern:x', kind: 'pattern', aliases: ['b'] }],
    }));
    const c1 = composeLayers(base, [layer]);
    const c2 = composeLayers(base, [layer]);
    assert(c1.checksum === c2.checksum, 'det');
    assert(c1.entries[0].aliases[0] === 'b', 'override');
  });

  await test('fingerprint changes with knowledge pin', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      knowledgeBundleId: 'compiler-ui-ontology',
      knowledgeBundleVersion: '1.0.0',
      knowledgeChecksum: 'aaa',
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      knowledgeBundleId: 'compiler-ui-ontology',
      knowledgeBundleVersion: '1.0.1',
      knowledgeChecksum: 'bbb',
    }));
    assert(a !== b, 'diff');
  });

  await test('plugin read access via handle', async () => {
    const reg = createKnowledgeRegistry();
    reg.loadAndRegister(path.join(BUNDLE_DIR, 'compiler-ui-ontology.1.0.0.json'));
    const { handle } = reg.pin('compiler-ui-ontology', '1.0.0');
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    const decl = baseDeclaration({
      id: 'engine.fake.know',
      requiredCapabilities: ['knowledge:read'],
    });
    const out = await executePlugin({
      declaration: decl,
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      knowledge: handle,
      handler: (ctx) => {
        const e = ctx.getKnowledge().get('pattern:block.generic');
        assert(e && e.kind === 'pattern', 'read');
        return e.entryId;
      },
    });
    assert(out.ok === true, 'ok');
    assert(out.result === 'pattern:block.generic', 'id');
  });

  await test('denied mutation on handle', () => {
    const handle = createKnowledgeHandle(sealWithChecksum(emptyBundle({
      entries: [{ entryId: 'pattern:z', kind: 'pattern' }],
    })));
    let threw = false;
    try {
      handle.put({ entryId: 'x' });
    } catch (e) {
      threw = e.kind === KnowledgeErrorKind.IMMUTABLE;
    }
    assert(threw, 'put');
    threw = false;
    try {
      handle.rank();
    } catch (e) {
      threw = e.kind === KnowledgeErrorKind.CAPABILITY_DENIED;
    }
    assert(threw, 'rank');
  });

  await test('denied direct Workspace writes from knowledge API', () => {
    const handle = createKnowledgeHandle(sealWithChecksum(emptyBundle()));
    let threw = false;
    try {
      handle.writeWorkspace();
    } catch (e) {
      threw = e.kind === KnowledgeErrorKind.CAPABILITY_DENIED;
    }
    assert(threw, 'ws');
    threw = false;
    try {
      handle.putDecision();
    } catch (e) {
      threw = e.kind === KnowledgeErrorKind.CAPABILITY_DENIED;
    }
    assert(threw, 'dec');
  });

  await test('read-only handle — returned entries frozen', () => {
    const reg = createKnowledgeRegistry();
    reg.loadAndRegister(path.join(BUNDLE_DIR, 'compiler-ui-ontology.1.0.0.json'));
    const { handle } = reg.pin('compiler-ui-ontology', '1.0.0');
    const e = handle.get('pattern:block.generic');
    assert(Object.isFrozen(e), 'frozen');
    let mut = false;
    try {
      e.kind = 'hacked';
    } catch (_) {
      mut = true;
    }
    assert(e.kind === 'pattern', 'unchanged');
  });

  await test('plugin without knowledge capability cannot require it', () => {
    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    let threw = false;
    try {
      createPluginContext({
        workspace: ws,
        declaration: baseDeclaration({
          id: 'engine.fake.needk',
          requiredCapabilities: ['knowledge:read'],
        }),
        policy: { profileId: 'x' },
        knowledge: null,
      });
    } catch (e) {
      threw = e.kind === PluginErrorKind.CAPABILITY_DENIED;
    }
    assert(threw, 'denied');
  });

  await test('Kernel pin + fingerprint + plugin injection', async () => {
    const k = createKernel();
    k.loadKnowledge(path.join(BUNDLE_DIR, 'compiler-ui-ontology.1.0.0.json'));
    const job = k.createJob({
      policyProfileId: 'pixel-faithful',
      knowledgeBundleId: 'compiler-ui-ontology',
      knowledgeBundleVersion: '1.0.0',
      seed: 'k1',
      jobId: 'job-know',
    });
    const fp = job.getFingerprint();
    assert(fp.knowledgeBundleId === 'compiler-ui-ontology', 'id');
    assert(fp.knowledgeBundleVersion === '1.0.0', 'ver');
    assert(fp.knowledgeChecksum, 'sum');
    assert(job.getKnowledgeHandle().get('motif:repeated-peer') != null, 'handle');

    k.registerPlugin(baseDeclaration({
      id: 'engine.fake.kread',
      requiredCapabilities: ['knowledge:read'],
      writes: [StoreKind.HYPOTHESIS],
      creates: [StoreKind.HYPOTHESIS],
    }));
    // plugin registered after job — execute still works if plugin on kernel
    const job2 = k.createJob({
      policyProfileId: 'pixel-faithful',
      knowledgeBundleId: 'compiler-ui-ontology',
      knowledgeBundleVersion: '1.0.0',
      jobId: 'job-know-2',
    });
    const out = await job2.executePlugin('engine.fake.kread', (ctx) => {
      return ctx.knowledge.get('feature:equalGap').entryId;
    }, { onFailure: 'continue' });
    assert(out.ok && out.result === 'feature:equalGap', 'inject');
  });

  await test('broken relation rejected', () => {
    let threw = false;
    try {
      validateBundle(sealWithChecksum({
        contractId: 'KnowledgeBundle',
        bundleId: 'bad-rel',
        version: '1.0.0',
        suiteVersion: '1.0.0',
        layers: [],
        dependencies: [],
        entries: [{ entryId: 'pattern:a', kind: 'pattern' }],
        relations: [{ from: 'pattern:a', to: 'pattern:missing', type: 'conflicts' }],
        packs: [],
        priors: [],
      }), { verifyChecksum: false });
    } catch (e) {
      // sealWithChecksum then validate — need validate before seal or verifyChecksum false on object without matching sum
      threw = e.kind === KnowledgeErrorKind.RELATION_BROKEN;
    }
    // seal first then tamper relation — simpler:
    try {
      validateBundle({
        contractId: 'KnowledgeBundle',
        bundleId: 'bad-rel',
        version: '1.0.0',
        suiteVersion: '1.0.0',
        layers: [],
        dependencies: [],
        entries: [{ entryId: 'pattern:a', kind: 'pattern' }],
        relations: [{ from: 'pattern:a', to: 'pattern:missing', type: 'conflicts' }],
        packs: [],
        priors: [],
      }, { verifyChecksum: false });
    } catch (e) {
      threw = e.kind === KnowledgeErrorKind.RELATION_BROKEN;
    }
    assert(threw, 'relation');
  });

  await test('knowledge invariants', () => {
    const reg = createKnowledgeRegistry();
    assert(reg.invariants.ranks === false, 'no rank');
    assert(reg.invariants.writesWorkspace === false, 'no ws');
    assert(reg.invariants.isImmutable === true, 'imm');
  });

  console.log('\n---');
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed) process.exitCode = 1;
  else console.log('Phase 7 knowledge bundle validation: OK');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
