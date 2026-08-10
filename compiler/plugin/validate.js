'use strict';

const fs = require('fs');
const path = require('path');
const { PluginError, PluginErrorKind } = require('./errors');
const {
  REQUIRED_FIELDS,
  ENGINE_TYPES,
  PHASE_AFFINITY,
  DETERMINISM,
  CRASH_ISOLATION,
  ROLLBACK_SUPPORT,
  RUNTIME_ONLY_KINDS,
  STORE_KIND_SET,
  SEMVER_RE,
} = require('./constants');
const { isKnownIrStage } = require('../ir-stage-registry');

const FORBIDDEN_ONTOLOGY = Object.freeze([
  'navbar', 'hero', 'pricing', 'carousel', 'accordion', 'sidebar', 'megamenu',
]);

function assertNoOntologyString(label, value) {
  if (value == null) return;
  const s = String(value).toLowerCase();
  for (const bad of FORBIDDEN_ONTOLOGY) {
    if (s.includes(bad)) {
      throw new PluginError(
        PluginErrorKind.INVALID_DECLARATION,
        `forbidden UI ontology in ${label}`,
        { token: bad, value }
      );
    }
  }
}

let questionIdsCache = null;

function loadQuestionIds() {
  if (!questionIdsCache) {
    const p = path.join(__dirname, '..', '..', 'contracts', 'registries', 'question-types.json');
    const reg = JSON.parse(fs.readFileSync(p, 'utf8'));
    questionIdsCache = new Set((reg.questions || []).map((q) => q.id));
  }
  return questionIdsCache;
}

function requireArray(decl, field) {
  if (!Array.isArray(decl[field])) {
    throw new PluginError(
      PluginErrorKind.INVALID_DECLARATION,
      `${field} must be an array`,
      { field }
    );
  }
}

function assertStoreKinds(list, field) {
  for (const k of list) {
    if (!STORE_KIND_SET.has(k)) {
      throw new PluginError(
        PluginErrorKind.UNKNOWN_STORE_KIND,
        `unknown StoreKind in ${field}: ${k}`,
        { field, kind: k }
      );
    }
  }
}

/**
 * Validate full Phase 6 plugin declaration. Rejects Decision/Trace writes.
 */
function validateDeclaration(decl, opts = {}) {
  if (!decl || typeof decl !== 'object') {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, 'declaration object required');
  }

  for (const field of REQUIRED_FIELDS) {
    if (decl[field] === undefined || decl[field] === null) {
      throw new PluginError(
        PluginErrorKind.INVALID_DECLARATION,
        `missing required field: ${field}`,
        { field }
      );
    }
  }

  if (typeof decl.id !== 'string' || !decl.id) {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, 'id must be non-empty string');
  }
  assertNoOntologyString('plugin.id', decl.id);

  if (typeof decl.version !== 'string' || !SEMVER_RE.test(decl.version)) {
    throw new PluginError(PluginErrorKind.BAD_SEMVER, `bad semver: ${decl.version}`, {
      version: decl.version,
    });
  }

  if (!ENGINE_TYPES.includes(decl.engineType)) {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, `invalid engineType: ${decl.engineType}`);
  }
  if (!PHASE_AFFINITY.includes(decl.phaseAffinity)) {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, `invalid phaseAffinity: ${decl.phaseAffinity}`);
  }
  if (!DETERMINISM.includes(decl.determinism)) {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, `invalid determinism: ${decl.determinism}`);
  }
  if (!CRASH_ISOLATION.includes(decl.crashIsolation)) {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, `invalid crashIsolation: ${decl.crashIsolation}`);
  }
  if (!ROLLBACK_SUPPORT.includes(decl.rollbackSupport)) {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, `invalid rollbackSupport: ${decl.rollbackSupport}`);
  }

  for (const field of [
    'reads', 'writes', 'creates', 'destroys', 'consumes', 'produces',
    'requiredFacts', 'optionalFacts', 'emittedIR', 'acceptedQuestions',
    'allowedPolicies', 'requiredCapabilities', 'incompatiblePlugins',
  ]) {
    requireArray(decl, field);
  }

  assertStoreKinds(decl.reads, 'reads');
  assertStoreKinds(decl.writes, 'writes');
  assertStoreKinds(decl.creates, 'creates');
  assertStoreKinds(decl.destroys, 'destroys');

  for (const kind of [...decl.writes, ...decl.creates, ...decl.destroys]) {
    if (RUNTIME_ONLY_KINDS.includes(kind)) {
      throw new PluginError(
        PluginErrorKind.FORBIDDEN_WRITE,
        `plugins must not declare ${kind} (Decision Runtime monopoly)`,
        { kind }
      );
    }
  }

  const writeSet = new Set(decl.writes);
  for (const c of decl.creates) {
    if (!writeSet.has(c)) {
      throw new PluginError(
        PluginErrorKind.CREATES_NOT_SUBSET,
        `creates must be ⊆ writes; missing ${c} in writes`,
        { creates: decl.creates, writes: decl.writes }
      );
    }
  }

  for (const stageId of decl.emittedIR) {
    if (!isKnownIrStage(stageId)) {
      throw new PluginError(
        PluginErrorKind.UNKNOWN_IR_STAGE,
        `unknown IR stageId: ${stageId}`,
        { stageId }
      );
    }
  }

  if (opts.validateQuestions !== false) {
    const qids = loadQuestionIds();
    for (const q of decl.acceptedQuestions) {
      if (!qids.has(q)) {
        throw new PluginError(
          PluginErrorKind.UNKNOWN_QUESTION,
          `unknown question id: ${q}`,
          { question: q }
        );
      }
    }
  }

  if (typeof decl.estimatedCost !== 'number' || decl.estimatedCost < 0) {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, 'estimatedCost must be number ≥ 0');
  }
  if (typeof decl.estimatedMemory !== 'number' || decl.estimatedMemory < 0) {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, 'estimatedMemory must be number ≥ 0');
  }
  if (typeof decl.timeout !== 'number' || decl.timeout <= 0) {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, 'timeout must be number > 0 (ms)');
  }
  if (!Number.isInteger(decl.retries) || decl.retries < 0) {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, 'retries must be integer ≥ 0');
  }

  if (opts.expectedSuiteVersion != null && decl.contractSuiteVersion != null
      && decl.contractSuiteVersion !== opts.expectedSuiteVersion) {
    throw new PluginError(
      PluginErrorKind.INCOMPATIBLE,
      `plugin contractSuiteVersion mismatch`,
      {
        plugin: decl.contractSuiteVersion,
        expected: opts.expectedSuiteVersion,
      }
    );
  }

  return true;
}

/**
 * Freeze a normalized declaration copy.
 */
function normalizeDeclaration(decl) {
  validateDeclaration(decl);
  return Object.freeze({
    id: decl.id,
    version: decl.version,
    engineType: decl.engineType,
    phaseAffinity: decl.phaseAffinity,
    determinism: decl.determinism,
    reads: Object.freeze([...decl.reads]),
    writes: Object.freeze([...decl.writes]),
    creates: Object.freeze([...decl.creates]),
    destroys: Object.freeze([...decl.destroys]),
    consumes: Object.freeze([...decl.consumes]),
    produces: Object.freeze([...decl.produces]),
    requiredFacts: Object.freeze([...decl.requiredFacts]),
    optionalFacts: Object.freeze([...decl.optionalFacts]),
    emittedIR: Object.freeze([...decl.emittedIR]),
    acceptedQuestions: Object.freeze([...decl.acceptedQuestions]),
    allowedPolicies: Object.freeze([...decl.allowedPolicies]),
    requiredCapabilities: Object.freeze([...decl.requiredCapabilities]),
    incompatiblePlugins: Object.freeze([...decl.incompatiblePlugins]),
    estimatedCost: decl.estimatedCost,
    estimatedMemory: decl.estimatedMemory,
    timeout: decl.timeout,
    retries: decl.retries,
    crashIsolation: decl.crashIsolation,
    rollbackSupport: decl.rollbackSupport,
    contractSuiteVersion: decl.contractSuiteVersion ?? null,
    minCompilerVersion: decl.minCompilerVersion ?? null,
    maxCompilerVersion: decl.maxCompilerVersion ?? null,
  });
}

module.exports = {
  validateDeclaration,
  normalizeDeclaration,
  loadQuestionIds,
};
