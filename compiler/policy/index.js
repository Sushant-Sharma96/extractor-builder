'use strict';

/**
 * Phase 5 — Policy Profiles.
 * Authoritative configuration only. No reasoning, ranking, emit, or domain engines.
 */

const { PolicyError, PolicyErrorKind } = require('./errors');
const {
  validateProfile,
  REQUIRED_THRESHOLD_KEYS,
  OPTIONAL_THRESHOLD_KEYS,
  GATE_MODES,
} = require('./validate');
const { resolveInheritance, mergeLayer } = require('./resolve');
const {
  toEnforceable,
  serializeProfile,
  deserializeProfile,
} = require('./serialize');
const { checkCompatibility, gateOptionsFromProfile } = require('./compatibility');
const {
  DEFAULT_PROFILES_DIR,
  loadProfileSource,
  createPolicyRegistry,
  createDefaultPolicyRegistry,
} = require('./load');

/** Lazy singleton for built-in corpus. */
let _defaultRegistry = null;

function getDefaultRegistry() {
  if (!_defaultRegistry) {
    _defaultRegistry = createDefaultPolicyRegistry();
  }
  return _defaultRegistry;
}

/**
 * Resolve a shipping profile by id from the default corpus.
 */
function resolveProfile(profileId, opts = {}) {
  return getDefaultRegistry().resolve(profileId, opts);
}

/**
 * List built-in profile ids.
 */
function listProfiles() {
  return getDefaultRegistry().listIds();
}

module.exports = {
  PolicyError,
  PolicyErrorKind,
  validateProfile,
  REQUIRED_THRESHOLD_KEYS,
  OPTIONAL_THRESHOLD_KEYS,
  GATE_MODES,
  resolveInheritance,
  mergeLayer,
  toEnforceable,
  serializeProfile,
  deserializeProfile,
  checkCompatibility,
  gateOptionsFromProfile,
  DEFAULT_PROFILES_DIR,
  loadProfileSource,
  createPolicyRegistry,
  createDefaultPolicyRegistry,
  getDefaultRegistry,
  resolveProfile,
  listProfiles,
};
