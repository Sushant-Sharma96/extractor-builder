'use strict';

const { RulePackError, RulePackErrorKind } = require('./errors');
const {
  SEMVER_RE,
  REQUIRED_PACK_FIELDS,
  FORBIDDEN_WRITES,
  REQUIRED_WRITES,
  StoreKind,
} = require('./constants');
const { validateDeclaration, normalizeDeclaration } = require('../plugin/validate');

/**
 * Validate RulePack metadata + embedded Phase 6 plugin declaration.
 */
function validateRulePack(pack, opts = {}) {
  if (!pack || typeof pack !== 'object') {
    throw new RulePackError(RulePackErrorKind.INVALID_PACK, 'pack object required');
  }

  for (const field of REQUIRED_PACK_FIELDS) {
    if (pack[field] === undefined || pack[field] === null) {
      throw new RulePackError(
        RulePackErrorKind.INVALID_PACK,
        `missing required field: ${field}`,
        { field }
      );
    }
  }

  if (typeof pack.packId !== 'string' || !pack.packId) {
    throw new RulePackError(RulePackErrorKind.INVALID_PACK, 'packId required');
  }
  if (!SEMVER_RE.test(pack.version)) {
    throw new RulePackError(RulePackErrorKind.BAD_SEMVER, `bad pack version: ${pack.version}`);
  }
  if (opts.expectedSuiteVersion != null && pack.suiteVersion !== opts.expectedSuiteVersion) {
    throw new RulePackError(
      RulePackErrorKind.INCOMPATIBLE,
      `suiteVersion mismatch: pack=${pack.suiteVersion} expected=${opts.expectedSuiteVersion}`,
      { pack: pack.suiteVersion, expected: opts.expectedSuiteVersion }
    );
  }

  if (!Array.isArray(pack.rules) || pack.rules.length < 1) {
    throw new RulePackError(RulePackErrorKind.INVALID_PACK, 'rules must be a non-empty array');
  }
  if (!Array.isArray(pack.dependencies)) {
    throw new RulePackError(RulePackErrorKind.INVALID_PACK, 'dependencies must be an array');
  }
  if (!Array.isArray(pack.knowledgeRefs)) {
    throw new RulePackError(RulePackErrorKind.INVALID_PACK, 'knowledgeRefs must be an array');
  }
  if (!Array.isArray(pack.allowedPolicies)) {
    throw new RulePackError(RulePackErrorKind.INVALID_PACK, 'allowedPolicies must be an array');
  }

  const ruleIds = new Set();
  for (const rule of pack.rules) {
    if (!rule || !rule.ruleId || typeof rule.ruleId !== 'string') {
      throw new RulePackError(RulePackErrorKind.INVALID_PACK, 'each rule needs ruleId');
    }
    if (ruleIds.has(rule.ruleId)) {
      throw new RulePackError(
        RulePackErrorKind.INVALID_PACK,
        `duplicate ruleId: ${rule.ruleId}`,
        { ruleId: rule.ruleId }
      );
    }
    ruleIds.add(rule.ruleId);
    if (!rule.question || typeof rule.question !== 'string') {
      throw new RulePackError(RulePackErrorKind.INVALID_PACK, `rule ${rule.ruleId} needs question`);
    }
  }

  for (const dep of pack.dependencies) {
    if (!dep.packId || typeof dep.versionRange !== 'string') {
      throw new RulePackError(RulePackErrorKind.DEPENDENCY, 'dependency needs packId + versionRange');
    }
  }

  // Plugin must be a full Phase 6 declaration
  const plugin = { ...pack.plugin };
  if (!plugin.id) plugin.id = `rulepack.${pack.packId}`;
  if (!plugin.version) plugin.version = pack.version;
  if (plugin.contractSuiteVersion == null) plugin.contractSuiteVersion = pack.suiteVersion;

  validateDeclaration(plugin, { expectedSuiteVersion: opts.expectedSuiteVersion });

  for (const kind of FORBIDDEN_WRITES) {
    if ((plugin.writes || []).includes(kind) || (plugin.creates || []).includes(kind)) {
      throw new RulePackError(
        RulePackErrorKind.FORBIDDEN,
        `rule pack must not write ${kind}`,
        { kind }
      );
    }
  }

  for (const kind of REQUIRED_WRITES) {
    if (!(plugin.writes || []).includes(kind)) {
      throw new RulePackError(
        RulePackErrorKind.INVALID_PACK,
        `rule pack plugin.writes must include ${kind}`,
        { kind }
      );
    }
  }

  // Must not destroy Facts
  if ((plugin.destroys || []).includes(StoreKind.FACT)) {
    throw new RulePackError(
      RulePackErrorKind.FORBIDDEN,
      'rule pack must not destroy Facts'
    );
  }

  if (plugin.determinism === 'nondeterministic') {
    throw new RulePackError(
      RulePackErrorKind.INVALID_PACK,
      'rule packs must be pure or seeded (not nondeterministic)'
    );
  }

  const normalizedPlugin = normalizeDeclaration(plugin);

  return {
    packId: pack.packId,
    version: pack.version,
    suiteVersion: pack.suiteVersion,
    description: pack.description || null,
    plugin: normalizedPlugin,
    rules: pack.rules.map((r) => Object.freeze({
      ruleId: r.ruleId,
      question: r.question,
      matcherRef: r.matcherRef || null,
      priorityBand: r.priorityBand || 'P5',
      description: r.description || null,
    })),
    dependencies: Object.freeze([...(pack.dependencies || [])].map((d) => Object.freeze({ ...d }))),
    knowledgeRefs: Object.freeze([...(pack.knowledgeRefs || [])]),
    allowedPolicies: Object.freeze([...(pack.allowedPolicies || [])]),
    priority: pack.priority != null ? pack.priority : 100,
  };
}

function normalizeRulePack(pack, opts) {
  const n = validateRulePack(pack, opts);
  return Object.freeze({
    ...n,
    rules: Object.freeze(n.rules),
  });
}

module.exports = { validateRulePack, normalizeRulePack };
