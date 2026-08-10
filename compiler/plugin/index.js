'use strict';

/**
 * Phase 6 — Plugin Capability Contract implementation.
 * Infrastructure only. No Layout/Semantic/Knowledge/Rules/AI engines.
 */

const { PluginError, PluginErrorKind } = require('./errors');
const {
  REQUIRED_FIELDS,
  ENGINE_TYPES,
  PHASE_AFFINITY,
  DETERMINISM,
  CRASH_ISOLATION,
  ROLLBACK_SUPPORT,
  RUNTIME_ONLY_KINDS,
  StoreKind,
} = require('./constants');
const { validateDeclaration, normalizeDeclaration } = require('./validate');
const { checkPluginCompatibility, compareSemver } = require('./compatibility');
const { createPluginRegistry } = require('./registry');
const { createPluginContext } = require('./context');
const { executePlugin, Lifecycle } = require('./execute');
const { buildPluginSchedule } = require('./scheduler');

/** Helper: minimal valid declaration skeleton for tests (caller fills rest). */
function baseDeclaration(over = {}) {
  return {
    id: 'engine.fake.base',
    version: '1.0.0',
    engineType: 'feature',
    phaseAffinity: 'mid',
    determinism: 'pure',
    reads: [StoreKind.FACT],
    writes: [StoreKind.HYPOTHESIS],
    creates: [StoreKind.HYPOTHESIS],
    destroys: [],
    consumes: [],
    produces: ['Hypothesis'],
    requiredFacts: [],
    optionalFacts: [],
    emittedIR: [],
    acceptedQuestions: ['html.tag'],
    allowedPolicies: ['*'],
    requiredCapabilities: [],
    incompatiblePlugins: [],
    estimatedCost: 1,
    estimatedMemory: 1024,
    timeout: 5000,
    retries: 0,
    crashIsolation: 'try_catch',
    rollbackSupport: 'workspace_tx',
    contractSuiteVersion: '1.0.0',
    ...over,
  };
}

module.exports = {
  PluginError,
  PluginErrorKind,
  REQUIRED_FIELDS,
  ENGINE_TYPES,
  PHASE_AFFINITY,
  DETERMINISM,
  CRASH_ISOLATION,
  ROLLBACK_SUPPORT,
  RUNTIME_ONLY_KINDS,
  StoreKind,
  validateDeclaration,
  normalizeDeclaration,
  checkPluginCompatibility,
  compareSemver,
  createPluginRegistry,
  createPluginContext,
  executePlugin,
  Lifecycle,
  buildPluginSchedule,
  baseDeclaration,
};
