'use strict';

const { StoreKind, ALL_KINDS } = require('../workspace/kinds');

const REQUIRED_FIELDS = Object.freeze([
  'id',
  'version',
  'engineType',
  'phaseAffinity',
  'determinism',
  'reads',
  'writes',
  'creates',
  'destroys',
  'consumes',
  'produces',
  'requiredFacts',
  'optionalFacts',
  'emittedIR',
  'acceptedQuestions',
  'allowedPolicies',
  'requiredCapabilities',
  'incompatiblePlugins',
  'estimatedCost',
  'estimatedMemory',
  'timeout',
  'retries',
  'crashIsolation',
  'rollbackSupport',
]);

const ENGINE_TYPES = Object.freeze([
  'facts', 'hypothesis', 'proposer', 'validator', 'feature', 'other',
]);

const PHASE_AFFINITY = Object.freeze(['early', 'mid', 'late', 'lowering']);
const DETERMINISM = Object.freeze(['pure', 'seeded', 'nondeterministic']);
const CRASH_ISOLATION = Object.freeze(['process', 'realm', 'try_catch', 'none']);
const ROLLBACK_SUPPORT = Object.freeze(['none', 'workspace_tx', 'invalidate_only']);

/** Decision monopoly — Runtime only. */
const RUNTIME_ONLY_KINDS = Object.freeze([
  StoreKind.DECISION,
  StoreKind.TRACE,
]);

const STORE_KIND_SET = new Set(ALL_KINDS);

const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

module.exports = {
  REQUIRED_FIELDS,
  ENGINE_TYPES,
  PHASE_AFFINITY,
  DETERMINISM,
  CRASH_ISOLATION,
  ROLLBACK_SUPPORT,
  RUNTIME_ONLY_KINDS,
  STORE_KIND_SET,
  SEMVER_RE,
  StoreKind,
};
