'use strict';

const path = require('path');
const fs = require('fs');

const SUITE_PATH = path.join(__dirname, '..', '..', 'contracts', 'suite.json');
const FINGERPRINT_SCHEMA_PATH = path.join(
  __dirname,
  '..',
  '..',
  'contracts',
  'schemas',
  'job-fingerprint.json'
);

/** Named fields emitted by buildFingerprint (excluding optional `extra`). */
const FINGERPRINT_NAMED_FIELDS = Object.freeze([
  'contractId',
  'suiteVersion',
  'contractSuiteVersion',
  'policyProfileId',
  'policyProfileVersion',
  'knowledgeBundleId',
  'knowledgeBundleVersion',
  'knowledgeChecksum',
  'ruleSetVersion',
  'rulePacks',
  'seed',
  'plugins',
  'ndgChecksum',
  'ndgBuilderVersion',
  'ndgGraphId',
  'layoutIrChecksum',
  'layoutBuilderVersion',
  'layoutSliceId',
  'baselineLayoutIrSliceId',
  'activeLayoutIrSliceId',
  'constraintSolverVersion',
  'solvedLayoutIrChecksum',
  'solvedLayoutSliceId',
  'solverFingerprint',
  'componentIrChecksum',
  'componentBuilderVersion',
  'componentSliceId',
  'tokenIrChecksum',
  'tokenBuilderVersion',
  'tokenSliceId',
  'semanticIrChecksum',
  'semanticBuilderVersion',
  'semanticSliceId',
  'responsiveIrChecksum',
  'responsiveBuilderVersion',
  'responsiveSliceId',
  'accessibilityIrChecksum',
  'accessibilityBuilderVersion',
  'accessibilitySliceId',
  'resolvedIrChecksum',
  'resolvedBuilderVersion',
  'resolvedSliceId',
  'emitPlanChecksum',
  'emitBuilderVersion',
  'emitPlanSliceId',
]);

function loadSuiteVersion() {
  const suite = JSON.parse(fs.readFileSync(SUITE_PATH, 'utf8'));
  return suite.suiteVersion;
}

/**
 * Build CompileJobFingerprint-shaped object (Phase 1 contract fields).
 * Must stay in sync with contracts/schemas/job-fingerprint.json.
 */
function buildFingerprint({
  policyProfileId,
  policyProfileVersion = null,
  knowledgeBundleVersion = null,
  knowledgeBundleId = null,
  knowledgeChecksum = null,
  ruleSetVersion = null,
  rulePacks = [],
  seed = null,
  contractSuiteVersion = null,
  plugins = [],
  ndgChecksum = null,
  ndgBuilderVersion = null,
  ndgGraphId = null,
  layoutIrChecksum = null,
  layoutBuilderVersion = null,
  layoutSliceId = null,
  baselineLayoutIrSliceId = null,
  activeLayoutIrSliceId = null,
  constraintSolverVersion = null,
  solvedLayoutIrChecksum = null,
  solvedLayoutSliceId = null,
  solverFingerprint = null,
  componentIrChecksum = null,
  componentBuilderVersion = null,
  componentSliceId = null,
  tokenIrChecksum = null,
  tokenBuilderVersion = null,
  tokenSliceId = null,
  semanticIrChecksum = null,
  semanticBuilderVersion = null,
  semanticSliceId = null,
  responsiveIrChecksum = null,
  responsiveBuilderVersion = null,
  responsiveSliceId = null,
  accessibilityIrChecksum = null,
  accessibilityBuilderVersion = null,
  accessibilitySliceId = null,
  resolvedIrChecksum = null,
  resolvedBuilderVersion = null,
  resolvedSliceId = null,
  emitPlanChecksum = null,
  emitBuilderVersion = null,
  emitPlanSliceId = null,
  extra = undefined,
}) {
  if (!policyProfileId || typeof policyProfileId !== 'string') {
    throw new Error('fingerprint requires policyProfileId');
  }
  const pluginSlice = [...(plugins || [])]
    .map((p) => ({ id: p.id, version: p.version }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const rulePackSlice = [...(rulePacks || [])]
    .map((p) => ({ packId: p.packId, version: p.version }))
    .sort((a, b) => (a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0));

  const baselineId = baselineLayoutIrSliceId ?? layoutSliceId ?? null;
  const activeId = activeLayoutIrSliceId
    ?? solvedLayoutSliceId
    ?? baselineId
    ?? null;

  const fp = {
    contractId: 'CompileJobFingerprint',
    suiteVersion: contractSuiteVersion || loadSuiteVersion(),
    contractSuiteVersion: contractSuiteVersion || loadSuiteVersion(),
    policyProfileId,
    policyProfileVersion,
    knowledgeBundleId: knowledgeBundleId ?? null,
    knowledgeBundleVersion,
    knowledgeChecksum: knowledgeChecksum ?? null,
    ruleSetVersion,
    rulePacks: rulePackSlice,
    seed,
    plugins: pluginSlice,
    ndgChecksum: ndgChecksum ?? null,
    ndgBuilderVersion: ndgBuilderVersion ?? null,
    ndgGraphId: ndgGraphId ?? null,
    layoutIrChecksum: layoutIrChecksum ?? null,
    layoutBuilderVersion: layoutBuilderVersion ?? null,
    layoutSliceId: layoutSliceId ?? baselineId,
    baselineLayoutIrSliceId: baselineId,
    activeLayoutIrSliceId: activeId,
    constraintSolverVersion: constraintSolverVersion ?? null,
    solvedLayoutIrChecksum: solvedLayoutIrChecksum ?? null,
    solvedLayoutSliceId: solvedLayoutSliceId ?? null,
    solverFingerprint: solverFingerprint ?? null,
    componentIrChecksum: componentIrChecksum ?? null,
    componentBuilderVersion: componentBuilderVersion ?? null,
    componentSliceId: componentSliceId ?? null,
    tokenIrChecksum: tokenIrChecksum ?? null,
    tokenBuilderVersion: tokenBuilderVersion ?? null,
    tokenSliceId: tokenSliceId ?? null,
    semanticIrChecksum: semanticIrChecksum ?? null,
    semanticBuilderVersion: semanticBuilderVersion ?? null,
    semanticSliceId: semanticSliceId ?? null,
    responsiveIrChecksum: responsiveIrChecksum ?? null,
    responsiveBuilderVersion: responsiveBuilderVersion ?? null,
    responsiveSliceId: responsiveSliceId ?? null,
    accessibilityIrChecksum: accessibilityIrChecksum ?? null,
    accessibilityBuilderVersion: accessibilityBuilderVersion ?? null,
    accessibilitySliceId: accessibilitySliceId ?? null,
    resolvedIrChecksum: resolvedIrChecksum ?? null,
    resolvedBuilderVersion: resolvedBuilderVersion ?? null,
    resolvedSliceId: resolvedSliceId ?? null,
    emitPlanChecksum: emitPlanChecksum ?? null,
    emitBuilderVersion: emitBuilderVersion ?? null,
    emitPlanSliceId: emitPlanSliceId ?? null,
  };
  if (extra !== undefined) fp.extra = extra;
  return fp;
}

function fingerprintKey(fp) {
  return JSON.stringify({
    contractSuiteVersion: fp.contractSuiteVersion,
    policyProfileId: fp.policyProfileId,
    policyProfileVersion: fp.policyProfileVersion ?? null,
    knowledgeBundleId: fp.knowledgeBundleId ?? null,
    knowledgeBundleVersion: fp.knowledgeBundleVersion ?? null,
    knowledgeChecksum: fp.knowledgeChecksum ?? null,
    ruleSetVersion: fp.ruleSetVersion ?? null,
    rulePacks: fp.rulePacks || [],
    seed: fp.seed ?? null,
    plugins: fp.plugins || [],
    ndgChecksum: fp.ndgChecksum ?? null,
    ndgBuilderVersion: fp.ndgBuilderVersion ?? null,
    ndgGraphId: fp.ndgGraphId ?? null,
    layoutIrChecksum: fp.layoutIrChecksum ?? null,
    layoutBuilderVersion: fp.layoutBuilderVersion ?? null,
    layoutSliceId: fp.layoutSliceId ?? null,
    baselineLayoutIrSliceId: fp.baselineLayoutIrSliceId ?? null,
    activeLayoutIrSliceId: fp.activeLayoutIrSliceId ?? null,
    constraintSolverVersion: fp.constraintSolverVersion ?? null,
    solvedLayoutIrChecksum: fp.solvedLayoutIrChecksum ?? null,
    solvedLayoutSliceId: fp.solvedLayoutSliceId ?? null,
    solverFingerprint: fp.solverFingerprint ?? null,
    componentIrChecksum: fp.componentIrChecksum ?? null,
    componentBuilderVersion: fp.componentBuilderVersion ?? null,
    componentSliceId: fp.componentSliceId ?? null,
    tokenIrChecksum: fp.tokenIrChecksum ?? null,
    tokenBuilderVersion: fp.tokenBuilderVersion ?? null,
    tokenSliceId: fp.tokenSliceId ?? null,
    semanticIrChecksum: fp.semanticIrChecksum ?? null,
    semanticBuilderVersion: fp.semanticBuilderVersion ?? null,
    semanticSliceId: fp.semanticSliceId ?? null,
    responsiveIrChecksum: fp.responsiveIrChecksum ?? null,
    responsiveBuilderVersion: fp.responsiveBuilderVersion ?? null,
    responsiveSliceId: fp.responsiveSliceId ?? null,
    accessibilityIrChecksum: fp.accessibilityIrChecksum ?? null,
    accessibilityBuilderVersion: fp.accessibilityBuilderVersion ?? null,
    accessibilitySliceId: fp.accessibilitySliceId ?? null,
    resolvedIrChecksum: fp.resolvedIrChecksum ?? null,
    resolvedBuilderVersion: fp.resolvedBuilderVersion ?? null,
    resolvedSliceId: fp.resolvedSliceId ?? null,
    emitPlanChecksum: fp.emitPlanChecksum ?? null,
    emitBuilderVersion: fp.emitBuilderVersion ?? null,
    emitPlanSliceId: fp.emitPlanSliceId ?? null,
  });
}

function assertNoHiddenFingerprintFields(fp) {
  if (!fp || typeof fp !== 'object') {
    throw new Error('fingerprint object required');
  }
  const allowed = new Set(FINGERPRINT_NAMED_FIELDS);
  allowed.add('extra');
  for (const k of Object.keys(fp)) {
    if (!allowed.has(k)) {
      throw new Error(`undocumented fingerprint field: ${k}`);
    }
  }
  return true;
}

function loadFingerprintSchema() {
  return JSON.parse(fs.readFileSync(FINGERPRINT_SCHEMA_PATH, 'utf8'));
}

module.exports = {
  buildFingerprint,
  fingerprintKey,
  loadSuiteVersion,
  assertNoHiddenFingerprintFields,
  loadFingerprintSchema,
  FINGERPRINT_NAMED_FIELDS,
  FINGERPRINT_SCHEMA_PATH,
};
