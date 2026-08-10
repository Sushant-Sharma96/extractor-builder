'use strict';

const fs = require('fs');
const path = require('path');
const { PolicyError, PolicyErrorKind } = require('./errors');
const { validateProfile } = require('./validate');
const { resolveInheritance } = require('./resolve');
const { toEnforceable, deserializeProfile } = require('./serialize');
const { checkCompatibility } = require('./compatibility');

const DEFAULT_PROFILES_DIR = path.join(__dirname, 'profiles');

/**
 * Load raw JSON profile from path or object.
 */
function loadProfileSource(source) {
  if (source && typeof source === 'object' && !Buffer.isBuffer(source)) {
    return deserializeProfile(source);
  }
  const filePath = typeof source === 'string' ? source : null;
  if (!filePath) {
    throw new PolicyError(PolicyErrorKind.LOAD_FAILED, 'load source required');
  }
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return deserializeProfile(text);
  } catch (e) {
    throw new PolicyError(
      PolicyErrorKind.LOAD_FAILED,
      `failed to load profile: ${filePath}`,
      { cause: e.message }
    );
  }
}

/**
 * Create an in-memory profile registry.
 * Loads all *.json from profilesDir by default.
 */
function createPolicyRegistry(options = {}) {
  const profilesDir = options.profilesDir || DEFAULT_PROFILES_DIR;
  const expectedSuiteVersion = options.expectedSuiteVersion || '1.0.0';
  const rawById = new Map();

  function registerRaw(raw, { skipValidate } = {}) {
    if (!skipValidate) {
      validateProfile(raw, { expectedSuiteVersion });
    }
    if (!raw.profileId) {
      throw new PolicyError(PolicyErrorKind.INVALID_PROFILE, 'profileId required to register');
    }
    rawById.set(raw.profileId, deserializeProfile(raw));
    return raw.profileId;
  }

  function loadDirectory(dir = profilesDir) {
    if (!fs.existsSync(dir)) {
      throw new PolicyError(PolicyErrorKind.LOAD_FAILED, `profiles directory missing: ${dir}`);
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const raw = loadProfileSource(path.join(dir, f));
      registerRaw(raw);
    }
    return listIds();
  }

  function getRaw(profileId) {
    return rawById.get(profileId) || null;
  }

  function listIds() {
    return [...rawById.keys()].sort();
  }

  /**
   * Resolve inheritance + validate + freeze enforceable profile.
   */
  function resolve(profileId, opts = {}) {
    const raw = getRaw(profileId);
    if (!raw) {
      throw new PolicyError(
        PolicyErrorKind.UNKNOWN_PROFILE,
        `unknown profileId: ${profileId}`,
        { profileId }
      );
    }
    const merged = resolveInheritance(raw, (id) => getRaw(id));
    validateProfile(merged, {
      expectedSuiteVersion: opts.expectedSuiteVersion || expectedSuiteVersion,
      requireAuthoritative: opts.requireAuthoritative !== false,
      afterResolve: true,
    });
    const enforceable = toEnforceable(merged);
    if (opts.compatibility) {
      checkCompatibility(enforceable, opts.compatibility);
    }
    return enforceable;
  }

  /**
   * Resolve an inline profile object (may extend registry parents).
   */
  function resolveObject(profile, opts = {}) {
    validateProfile(profile, {
      expectedSuiteVersion: opts.expectedSuiteVersion || expectedSuiteVersion,
    });
    const merged = resolveInheritance(profile, (id) => getRaw(id));
    validateProfile(merged, {
      expectedSuiteVersion: opts.expectedSuiteVersion || expectedSuiteVersion,
      requireAuthoritative: opts.requireAuthoritative === true,
      afterResolve: true,
    });
    return toEnforceable(merged);
  }

  function has(profileId) {
    return rawById.has(profileId);
  }

  return {
    profilesDir,
    expectedSuiteVersion,
    registerRaw,
    loadDirectory,
    loadProfileSource,
    getRaw,
    listIds,
    resolve,
    resolveObject,
    has,
    invariants: Object.freeze({
      executesLogic: false,
      ranks: false,
      scores: false,
      choosesWinners: false,
      emitsArtifacts: false,
      providesConfigurationOnly: true,
    }),
  };
}

/** Default registry with built-in Phase 5 corpus. */
function createDefaultPolicyRegistry(options = {}) {
  const registry = createPolicyRegistry(options);
  registry.loadDirectory();
  return registry;
}

module.exports = {
  DEFAULT_PROFILES_DIR,
  loadProfileSource,
  createPolicyRegistry,
  createDefaultPolicyRegistry,
};
