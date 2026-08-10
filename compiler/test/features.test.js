'use strict';

/**
 * Phase 9 — Feature Extraction & Recognition tests.
 */
const path = require('path');
const {
  normalizeNode,
  extractFeatures,
  featuresCanonicalJson,
  recognizeBlockKinds,
  isSourceNodeFact,
  SOURCE_NODE_KIND,
  BLOCK_KINDS,
} = require('../features');
const {
  createRulePackRegistry,
  loadFeatureExtractPack,
  loadRecognitionBasicPack,
  validateRulePack,
  RulePackErrorKind,
  FORBIDDEN_WRITES,
  StoreKind,
} = require('../rulepack');
const { createPluginRegistry } = require('../plugin');
const { createWorkspace } = require('../workspace');
const { createKnowledgeRegistry } = require('../knowledge');
const { createKernel } = require('../kernel');
const { buildFingerprint, fingerprintKey } = require('../kernel/fingerprint');

const RECOG_BUNDLE = path.join(__dirname, '..', 'knowledge', 'bundles', 'recognition-ontology.1.0.0.json');
const BASE_BUNDLE = path.join(__dirname, '..', 'knowledge', 'bundles', 'compiler-ui-ontology.1.0.0.json');
const COMPOSED = path.join(__dirname, '..', 'knowledge', 'bundles', 'recognition-composed.1.0.0.json');
const FEATURE_DIR = path.join(__dirname, '..', 'rulepack', 'packs', 'feature-extract');
const RECOG_DIR = path.join(__dirname, '..', 'rulepack', 'packs', 'recognition-basic');

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

function nodeFact(id, assertion) {
  return {
    contractId: 'Fact',
    suiteVersion: '1.0.0',
    factId: id,
    kind: SOURCE_NODE_KIND,
    subject: `src:${id}`,
    assertion,
  };
}

function pinRecognition() {
  const know = createKnowledgeRegistry();
  know.loadAndRegister(RECOG_BUNDLE);
  return know.pin('recognition-ontology', '1.0.0');
}

async function main() {
  await test('feature extraction — node types', () => {
    for (const t of ['FRAME', 'TEXT', 'RECTANGLE', 'IMAGE', 'VECTOR']) {
      const ex = extractFeatures({ type: t, name: t });
      assert(ex.features.nodeType === t, t);
    }
  });

  await test('feature normalization — aliases + sorting children', () => {
    const a = normalizeNode({
      type: 'frame',
      gap: 8,
      paddingLeft: 4,
      children: [{ id: 'b' }, { id: 'a' }],
    });
    assert(a.nodeType === 'FRAME', 'type');
    assert(a.itemSpacing === 8, 'gap→spacing');
    assert(a.padding.left === 4, 'pad');
    assert(JSON.stringify(a.childIds) === JSON.stringify(['a', 'b']), 'sorted children');
  });

  await test('feature bag keys present', () => {
    const ex = extractFeatures({
      type: 'FRAME',
      name: 'Box',
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      paddingTop: 8,
      fills: [{ type: 'SOLID' }],
      strokes: [{ type: 'SOLID' }],
      effects: [{ type: 'DROP_SHADOW' }],
      cornerRadius: 6,
      opacity: 0.9,
      absoluteBoundingBox: { x: 1, y: 2, width: 100, height: 50 },
      layoutPositioning: 'ABSOLUTE',
      parentId: 'p',
      childIds: ['c1'],
      visible: true,
    });
    assert(ex.features.autoLayout.mode === 'VERTICAL', 'al');
    assert(ex.features.fill === true, 'fill');
    assert(ex.features.stroke === true, 'stroke');
    assert(ex.features.shadow === true, 'shadow');
    assert(ex.features.positioning === 'absolute', 'pos');
    assert(ex.features.hierarchy.childCount === 1, 'hier');
    assert(ex.presentKeys.includes('nodeType'), 'keys');
  });

  await test('recognition — text / image / stack / multi-candidate', () => {
    const text = recognizeBlockKinds({ type: 'TEXT', characters: 'Hi' });
    assert(text.candidates.some((c) => c.answer.blockKind === 'text-block'), 'text');
    assert(text.candidates.some((c) => c.answer.blockKind === 'generic-block'), 'generic');

    const img = recognizeBlockKinds({ type: 'RECTANGLE', fills: [{ type: 'IMAGE' }] });
    assert(img.candidates.some((c) => c.answer.blockKind === 'image-block'), 'img');

    const stack = recognizeBlockKinds({
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      childIds: ['a', 'b'],
    });
    assert(stack.candidates.some((c) => c.answer.blockKind === 'stack'), 'stack');
    assert(stack.candidates.length >= 2, 'ambiguity');
  });

  await test('name-only confidence capped by pattern_name_cap', () => {
    const r = recognizeBlockKinds({ type: 'FRAME', name: 'Primary Button' }, { patternNameCap: 0.35 });
    const btn = r.candidates.find((c) => c.answer.blockKind === 'button-like');
    assert(btn, 'btn cand');
    assert(btn.nameOnly === true, 'name only');
    assert(btn.localScore <= 0.35, `capped ${btn.localScore}`);
  });

  await test('near-miss evidence generation', () => {
    const r = recognizeBlockKinds({
      type: 'FRAME',
      fills: [{ type: 'SOLID' }],
      cornerRadius: 8,
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    });
    assert(r.nearMisses.some((n) => n.target === 'card-like'), 'near card');
    assert(r.evidence.some((e) => e.ref === 'near_miss'), 'ev');
  });

  await test('isSourceNodeFact', () => {
    assert(isSourceNodeFact(nodeFact('n1', { type: 'FRAME' })), 'kind');
    assert(isSourceNodeFact({ kind: 'other', assertion: { nodeType: 'TEXT' } }), 'assert');
    assert(!isSourceNodeFact({ kind: 'source.x', assertion: { v: 1 } }), 'reject');
  });

  await test('knowledge lookup — recognition ontology', () => {
    const { handle } = pinRecognition();
    assert(handle.get('feature:recognition.signals') != null, 'signal');
    assert(handle.get('pattern:block.button-like') != null, 'btn');
    assert(handle.get('pattern:block.generic-block') != null, 'generic');
    let threw = false;
    try {
      handle.put({});
    } catch (_) {
      threw = true;
    }
    assert(threw, 'immutable');
  });

  await test('composed knowledge includes base + recognition', () => {
    const know = createKnowledgeRegistry();
    know.loadAndRegister(BASE_BUNDLE);
    know.loadAndRegister(RECOG_BUNDLE);
    know.loadAndRegister(COMPOSED);
    const { handle } = know.pin('recognition-composed', '1.0.0');
    assert(handle.get('pattern:block.generic') != null, 'base');
    assert(handle.get('pattern:block.card-like') != null, 'recog');
  });

  await test('feature extract pack — evidence + hypothesis + workspace', async () => {
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const { pack, handlers } = loadFeatureExtractPack();
    reg.register(pack, handlers);

    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    ws.putFact(nodeFact('n1', {
      type: 'FRAME',
      name: 'Card',
      layoutMode: 'VERTICAL',
      paddingTop: 16,
      fills: [{ type: 'SOLID' }],
      cornerRadius: 8,
      childIds: ['t1'],
    }));
    const { handle } = pinRecognition();
    const out = await reg.execute('feature.extract', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful', thresholds: { pattern_name_cap: 0.35 } },
      knowledge: handle,
      suiteVersion: '1.0.0',
      clock: (() => {
        let t = 0;
        return () => { t += 1; return t; };
      })(),
    });

    assert(out.evidence.length >= 1, 'ev');
    assert(out.hypotheses.length >= 1, 'hyp');
    assert(out.hypotheses[0].question === 'recognition.features', 'q');
    assert(out.evidence[0].detail.features.nodeType === 'FRAME', 'feat');
    assert(ws.getEvidence(out.evidence[0].evidenceId) != null, 'ws ev');
    assert(ws.listIds('DecisionRecord').length === 0, 'no dec');
  });

  await test('recognition pack — candidates + evidence kinds', async () => {
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const fe = loadFeatureExtractPack();
    const rb = loadRecognitionBasicPack();
    reg.register(fe.pack, fe.handlers);
    reg.register(rb.pack, rb.handlers);

    const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
    ws.putFact(nodeFact('btn', {
      type: 'FRAME',
      name: 'Submit Button',
      absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 40 },
      fills: [{ type: 'SOLID' }],
      cornerRadius: 4,
    }));
    const { handle } = pinRecognition();

    await reg.execute('feature.extract', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful', thresholds: { pattern_name_cap: 0.35 } },
      knowledge: handle,
      suiteVersion: '1.0.0',
    });
    const out = await reg.execute('recognition.basic', {
      workspace: ws,
      policy: { profileId: 'pixel-faithful', thresholds: { pattern_name_cap: 0.35 } },
      knowledge: handle,
      suiteVersion: '1.0.0',
    });

    assert(out.candidates.length >= 2, 'multi cand');
    assert(out.hypotheses[0].question === 'recognition.blockKind', 'q');
    assert(out.evidence.some((e) => e.kind === 'feature'), 'feature ev');
    const kinds = new Set(out.candidates.map((c) => c.answer.blockKind));
    assert(kinds.has('generic-block'), 'generic');
    assert(BLOCK_KINDS.every((k) => typeof k === 'string'), 'catalog');
  });

  await test('plugin integration — packs register as plugins', () => {
    const plugins = createPluginRegistry();
    const reg = createRulePackRegistry({ pluginRegistry: plugins });
    const fe = loadFeatureExtractPack();
    const rb = loadRecognitionBasicPack();
    reg.register(fe.pack, fe.handlers);
    reg.register(rb.pack, rb.handlers);
    assert(plugins.has('rulepack.feature.extract'), 'fe plugin');
    assert(plugins.has('rulepack.recognition.basic'), 'rb plugin');
  });

  await test('capability enforcement — Fact write forbidden', () => {
    const { pack } = loadFeatureExtractPack();
    pack.plugin.writes = ['Hypothesis', 'Evidence', 'Fact'];
    let threw = false;
    try {
      validateRulePack(pack);
    } catch (e) {
      threw = e.kind === RulePackErrorKind.FORBIDDEN;
    }
    assert(threw, 'forbidden');
    assert(FORBIDDEN_WRITES.includes(StoreKind.FACT), 'const');
  });

  await test('fingerprint stability for phase9 packs', () => {
    const a = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      rulePacks: [
        { packId: 'recognition.basic', version: '1.0.0' },
        { packId: 'feature.extract', version: '1.0.0' },
      ],
    }));
    const b = fingerprintKey(buildFingerprint({
      policyProfileId: 'p',
      contractSuiteVersion: '1.0.0',
      rulePacks: [
        { packId: 'feature.extract', version: '1.0.0' },
        { packId: 'recognition.basic', version: '1.0.0' },
      ],
    }));
    assert(a === b, 'stable');
  });

  await test('deterministic + repeated execution', async () => {
    const run = async () => {
      const plugins = createPluginRegistry();
      const reg = createRulePackRegistry({ pluginRegistry: plugins });
      const fe = loadFeatureExtractPack();
      const rb = loadRecognitionBasicPack();
      reg.register(fe.pack, fe.handlers);
      reg.register(rb.pack, rb.handlers);
      const ws = createWorkspace({ contractSuiteVersion: '1.0.0' });
      ws.putFact(nodeFact('n1', {
        type: 'TEXT',
        name: 'Title',
        characters: 'Hello',
        fontSize: 24,
      }));
      const { handle } = pinRecognition();
      let t = 0;
      const clock = () => { t += 1; return t; };
      await reg.execute('feature.extract', {
        workspace: ws,
        policy: { profileId: 'pixel-faithful', thresholds: { pattern_name_cap: 0.4 } },
        knowledge: handle,
        suiteVersion: '1.0.0',
        clock,
      });
      return reg.execute('recognition.basic', {
        workspace: ws,
        policy: { profileId: 'pixel-faithful', thresholds: { pattern_name_cap: 0.4 } },
        knowledge: handle,
        suiteVersion: '1.0.0',
        clock,
      });
    };
    const a = await run();
    const b = await run();
    assert(JSON.stringify(a.candidates.map((c) => ({ id: c.candidateId, s: c.localScore, k: c.answer.blockKind })))
      === JSON.stringify(b.candidates.map((c) => ({ id: c.candidateId, s: c.localScore, k: c.answer.blockKind }))),
    'repeat');
    const ex1 = extractFeatures({ type: 'FRAME', name: 'X', childIds: ['2', '1'] });
    const ex2 = extractFeatures({ type: 'FRAME', name: 'X', childIds: ['1', '2'] });
    assert(featuresCanonicalJson(ex1) === featuresCanonicalJson(ex2), 'feat stable');
  });

  await test('Kernel load + execute feature + recognition packs', async () => {
    const k = createKernel();
    k.loadKnowledge(RECOG_BUNDLE);
    k.loadRulePackDirectory(FEATURE_DIR);
    k.loadRulePackDirectory(RECOG_DIR);
    const job = k.createJob({
      policyProfileId: 'pixel-faithful',
      knowledgeBundleId: 'recognition-ontology',
      knowledgeBundleVersion: '1.0.0',
      seed: 'p9',
      jobId: 'job-p9',
    });
    const fp = job.getFingerprint();
    assert(fp.rulePacks.some((p) => p.packId === 'feature.extract'), 'fe fp');
    assert(fp.rulePacks.some((p) => p.packId === 'recognition.basic'), 'rb fp');
    job.attachWorkspace().putFact(nodeFact('k1', {
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      childIds: ['a', 'b', 'c'],
      absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 400 },
    }));
    await job.executeRulePack('feature.extract');
    const out = await job.executeRulePack('recognition.basic');
    assert(out.hypotheses.length >= 1, 'hyp');
    assert(out.executionTrace.length >= 1, 'trace');
    assert(job.getWorkspace().listIds('DecisionRecord').length === 0, 'no dec');
  });

  console.log('\n---');
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed) process.exitCode = 1;
  else console.log('Phase 9 feature extraction & recognition: OK');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
