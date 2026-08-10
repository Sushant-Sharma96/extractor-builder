/**
 * Phase 1 contract validation harness.
 * Validates fixtures against JSON Schema (draft-07 subset) without external deps.
 * Spec: contracts/validation/HARNESS_SPEC.md
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEMA_DIR = path.join(ROOT, 'schemas');
const FIXTURE_DIR = path.join(ROOT, 'fixtures');
const REG_DIR = path.join(ROOT, 'registries');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function matchesType(value, schemaType) {
  const types = Array.isArray(schemaType) ? schemaType : [schemaType];
  const t = typeOf(value);
  return types.some((st) => {
    if (st === 'integer') return t === 'number' && Number.isInteger(value);
    if (st === 'number') return t === 'number';
    return t === st;
  });
}

/** Draft-07 subset: type, const, enum, required, properties, additionalProperties, oneOf, items, minItems, minLength, minimum, maximum, $ref (same-dir filename only). */
function validate(schema, data, schemasByFile, pathStr, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.$ref) {
    const refFile = schema.$ref.replace(/^\.\//, '');
    const target = schemasByFile[refFile] || schemasByFile[path.basename(refFile)];
    if (!target) {
      errors.push(`${pathStr}: unresolved $ref ${schema.$ref}`);
      return;
    }
    validate(target, data, schemasByFile, pathStr, errors);
    return;
  }

  if (schema.oneOf) {
    const ok = schema.oneOf.some((branch) => {
      const local = [];
      validate(branch, data, schemasByFile, pathStr, local);
      return local.length === 0;
    });
    if (!ok) errors.push(`${pathStr}: matches no oneOf branch`);
    return;
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    if (data !== schema.const) errors.push(`${pathStr}: expected const ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum) {
    if (!schema.enum.includes(data)) errors.push(`${pathStr}: value not in enum`);
  }

  if (schema.type && !matchesType(data, schema.type)) {
    errors.push(`${pathStr}: expected type ${schema.type}, got ${typeOf(data)}`);
    return;
  }

  if (schema.type === 'string' || (Array.isArray(schema.type) && schema.type.includes('string'))) {
    if (typeof data === 'string') {
      if (schema.minLength != null && data.length < schema.minLength) {
        errors.push(`${pathStr}: minLength ${schema.minLength}`);
      }
    }
  }

  if (typeof data === 'number') {
    if (schema.minimum != null && data < schema.minimum) errors.push(`${pathStr}: below minimum`);
    if (schema.maximum != null && data > schema.maximum) errors.push(`${pathStr}: above maximum`);
  }

  if (schema.type === 'array' || typeOf(data) === 'array') {
    if (Array.isArray(data)) {
      if (schema.minItems != null && data.length < schema.minItems) {
        errors.push(`${pathStr}: minItems ${schema.minItems}`);
      }
      if (schema.items) {
        data.forEach((item, i) => validate(schema.items, item, schemasByFile, `${pathStr}[${i}]`, errors));
      }
    }
  }

  if (schema.type === 'object' || (schema.properties && typeOf(data) === 'object')) {
    if (typeOf(data) !== 'object') return;
    const required = schema.required || [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) {
        errors.push(`${pathStr}: missing required "${key}"`);
      }
    }
    const props = schema.properties || {};
    for (const key of Object.keys(data)) {
      if (props[key]) {
        validate(props[key], data[key], schemasByFile, `${pathStr}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${pathStr}: additional property "${key}" not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validate(schema.additionalProperties, data[key], schemasByFile, `${pathStr}.${key}`, errors);
      }
    }
  }
}

function loadSchemas() {
  const map = {};
  for (const name of fs.readdirSync(SCHEMA_DIR)) {
    if (!name.endsWith('.json')) continue;
    map[name] = readJson(path.join(SCHEMA_DIR, name));
  }
  return map;
}

function roundTrip(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  const suite = readJson(path.join(ROOT, 'suite.json'));
  const manifest = readJson(path.join(FIXTURE_DIR, 'manifest.json'));
  const schemas = loadSchemas();
  const irReg = readJson(path.join(REG_DIR, 'ir-stages.json'));
  const qReg = readJson(path.join(REG_DIR, 'question-types.json'));

  const results = [];
  let failed = 0;

  function pass(name, detail) {
    results.push({ ok: true, name, detail });
    console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`);
  }
  function fail(name, detail) {
    failed += 1;
    results.push({ ok: false, name, detail });
    console.error(`FAIL  ${name} — ${detail}`);
  }

  // Suite version consistency
  if (suite.suiteVersion !== '1.0.0') fail('suite.version', `expected 1.0.0 got ${suite.suiteVersion}`);
  else pass('suite.version', suite.suiteVersion);

  // IR stages enumerable
  if (!Array.isArray(irReg.stages) || irReg.stages.length < 2) fail('ir-stages.enumerable', 'stages missing');
  else pass('ir-stages.enumerable', `${irReg.stages.length} stages`);

  const stageIds = new Set(irReg.stages.map((s) => s.stageId));
  let predOk = true;
  for (const s of irReg.stages) {
    for (const p of s.predecessors || []) {
      if (!stageIds.has(p)) {
        predOk = false;
        fail('ir-stages.predecessors', `${s.stageId} refs unknown ${p}`);
      }
    }
  }
  if (predOk) pass('ir-stages.predecessors', 'all predecessors known');

  // Question registry extensible
  if (!qReg.extensionPolicy || !Array.isArray(qReg.questions) || qReg.questions.length < 1) {
    fail('question-registry', 'missing extensionPolicy or questions');
  } else pass('question-registry', `${qReg.questions.length} questions`);

  // Required schema files
  const requiredSchemas = [
    'raw-design-document.json',
    'normalized-design-graph.json',
    'fact.json',
    'hypothesis.json',
    'candidate.json',
    'evidence.json',
    'decision-record.json',
    'specialized-ir-envelope.json',
    'resolved-ir.json',
    'emit-plan.json',
    'artifact-set.json',
    'policy-profile.json',
    'job-fingerprint.json',
    'quality-report.json',
    'provenance-bundle.json',
  ];
  for (const s of requiredSchemas) {
    if (!schemas[s]) fail('schema.present', s);
  }
  if (!results.some((r) => r.name === 'schema.present' && !r.ok)) pass('schema.present', `${requiredSchemas.length} schemas`);

  // Decision Record RFC-002 field check on schema required list
  const dr = schemas['decision-record.json'];
  const need = [
    'id', 'subject', 'question', 'candidates', 'evidence', 'scores', 'ranking',
    'winner', 'policy', 'status', 'alternatives_kept', 'trace_refs',
  ];
  const missing = need.filter((k) => !(dr.required || []).includes(k));
  if (missing.length) fail('decision-record.rfc002-fields', `missing required: ${missing.join(',')}`);
  else pass('decision-record.rfc002-fields', 'all §2.2 fields required');

  const statusEnum = dr.properties.status.enum;
  for (const st of ['proposed', 'arbitrated', 'overridden', 'fallen-back', 'rejected']) {
    if (!statusEnum.includes(st)) fail('decision-record.status-enum', `missing ${st}`);
  }
  if (!results.some((r) => r.name === 'decision-record.status-enum' && !r.ok)) {
    pass('decision-record.status-enum', 'complete');
  }

  // Positive fixtures
  const decisionCases = new Set();
  for (const entry of manifest.fixtures) {
    const data = readJson(path.join(FIXTURE_DIR, entry.file));
    const schema = schemas[entry.schema];
    const errors = [];
    validate(schema, data, schemas, '$', errors);
    if (errors.length) fail(`fixture:${entry.file}`, errors.join('; '));
    else pass(`fixture:${entry.file}`, entry.contractId);

    if (entry.decisionCase) decisionCases.add(entry.decisionCase);

    // suiteVersion pin
    if (data.suiteVersion && data.suiteVersion !== suite.suiteVersion) {
      fail(`fixture.suiteVersion:${entry.file}`, data.suiteVersion);
    }
  }

  for (const c of ['winner', 'abstain', 'overridden']) {
    if (!decisionCases.has(c)) fail('decision-cases', `missing fixture for ${c}`);
  }
  if (!results.some((r) => r.name === 'decision-cases' && !r.ok)) pass('decision-cases', 'winner/abstain/overridden');

  // Decision round-trip
  for (const entry of manifest.fixtures.filter((e) => e.contractId === 'DecisionRecord')) {
    const data = readJson(path.join(FIXTURE_DIR, entry.file));
    const rt = roundTrip(data);
    if (!deepEqual(data, rt)) fail(`roundtrip:${entry.file}`, 'mismatch');
    else pass(`roundtrip:${entry.file}`, 'ok');
  }

  // Fingerprint schema ↔ implementation named fields (Phase 11b.1)
  try {
    const { FINGERPRINT_NAMED_FIELDS, buildFingerprint, assertNoHiddenFingerprintFields } =
      // eslint-disable-next-line global-require, import/no-dynamic-require
      require(path.join(ROOT, '..', 'compiler', 'kernel', 'fingerprint'));
    const fpSchema = schemas['job-fingerprint.json'];
    const schemaProps = Object.keys(fpSchema.properties || {}).filter((k) => k !== 'extra');
    const missingInSchema = FINGERPRINT_NAMED_FIELDS.filter((k) => !schemaProps.includes(k));
    const extraInSchema = schemaProps.filter((k) => !FINGERPRINT_NAMED_FIELDS.includes(k));
    if (missingInSchema.length) {
      fail('fingerprint.schema-sync', `schema missing: ${missingInSchema.join(',')}`);
    } else if (extraInSchema.length) {
      fail('fingerprint.schema-sync', `schema extra (not in impl): ${extraInSchema.join(',')}`);
    } else {
      pass('fingerprint.schema-sync', `${FINGERPRINT_NAMED_FIELDS.length} named fields`);
    }
    const live = buildFingerprint({ policyProfileId: 'pixel-faithful' });
    assertNoHiddenFingerprintFields(live);
    const liveErrors = [];
    validate(fpSchema, live, schemas, '$', liveErrors);
    if (liveErrors.length) fail('fingerprint.live-validate', liveErrors.join('; '));
    else pass('fingerprint.live-validate', 'buildFingerprint ∊ schema');
  } catch (e) {
    fail('fingerprint.schema-sync', e.message);
  }

  // Cross-contract: EmitPlan decisionId + Provenance decisionId
  const emit = readJson(path.join(FIXTURE_DIR, 'emit-plan.valid.json'));
  const winner = readJson(path.join(FIXTURE_DIR, 'decision-record.winner.json'));
  const prov = readJson(path.join(FIXTURE_DIR, 'provenance-bundle.valid.json'));
  const emitDec = emit.tagChoices[0].decisionId;
  if (emitDec !== winner.id) fail('consistency.emit-decision', `${emitDec} !== ${winner.id}`);
  else pass('consistency.emit-decision', emitDec);
  if (prov.bindings[0].decisionId !== winner.id) fail('consistency.prov-decision', 'mismatch');
  else pass('consistency.prov-decision', winner.id);

  // Policy non-authoritative
  const policy = readJson(path.join(FIXTURE_DIR, 'policy-profile.valid.json'));
  if (policy.valuesAuthoritative !== false) fail('policy.non-authoritative', 'must be false in Phase 1');
  else pass('policy.non-authoritative', 'valuesAuthoritative=false');

  // Negative fixtures must fail
  for (const entry of manifest.negativeFixtures || []) {
    const data = readJson(path.join(FIXTURE_DIR, entry.file));
    const schema = schemas[entry.schema];
    const errors = [];
    validate(schema, data, schemas, '$', errors);
    if (errors.length === 0) fail(`negative:${entry.file}`, 'expected validation failure');
    else pass(`negative:${entry.file}`, errors[0]);
  }

  // Fact vs Hypothesis: hypothesis must not use Fact contractId
  const hyp = readJson(path.join(FIXTURE_DIR, 'hypothesis.valid.json'));
  if (hyp.contractId === 'Fact') fail('fact-vs-hypothesis', 'collapsed');
  else pass('fact-vs-hypothesis', 'distinct contractIds');

  console.log('\n---');
  console.log(`Passed: ${results.filter((r) => r.ok).length}  Failed: ${failed}`);
  if (failed) {
    process.exitCode = 1;
  } else {
    console.log('Phase 1 contract validation: OK');
  }
}

main();
