'use strict';

const { RulePackError, RulePackErrorKind } = require('./errors');
const { normalizeRulePack } = require('./validate');
const { checkRulePackCompatibility } = require('./compatibility');
const { executeRulePack } = require('./execute');

/**
 * Rule Pack registry — stores pack metadata + rule handlers.
 * Plugins are registered into the provided Phase 6 plugin registry (no second framework).
 */
function createRulePackRegistry({ pluginRegistry, expectedSuiteVersion = '1.0.0' } = {}) {
  if (!pluginRegistry || typeof pluginRegistry.register !== 'function') {
    throw new RulePackError(
      RulePackErrorKind.INVALID_PACK,
      'Phase 6 pluginRegistry required'
    );
  }

  /** @type {Map<string, { pack, handlers }>} */
  const packs = new Map();

  function register(rawPack, handlers = {}) {
    const pack = normalizeRulePack(rawPack, { expectedSuiteVersion });

    if (packs.has(pack.packId)) {
      throw new RulePackError(
        RulePackErrorKind.DUPLICATE_PACK,
        `duplicate packId: ${pack.packId}`,
        { packId: pack.packId }
      );
    }

    // Register through existing Plugin system
    pluginRegistry.register(pack.plugin);

    const frozenHandlers = Object.freeze({ ...handlers });
    packs.set(pack.packId, Object.freeze({ pack, handlers: frozenHandlers }));
    return pack;
  }

  function get(packId) {
    const entry = packs.get(packId);
    return entry ? entry.pack : null;
  }

  function getHandlers(packId) {
    const entry = packs.get(packId);
    return entry ? entry.handlers : null;
  }

  function list() {
    return [...packs.values()]
      .map((e) => e.pack)
      .sort((a, b) => (a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0));
  }

  function has(packId) {
    return packs.has(packId);
  }

  function registeredVersions() {
    const out = {};
    for (const p of list()) out[p.packId] = p.version;
    return out;
  }

  function listEnabled(context = {}) {
    const registeredPackIds = list().map((p) => p.packId);
    const registeredPackVersions = registeredVersions();
    const enabled = [];
    for (const pack of list()) {
      try {
        checkRulePackCompatibility(pack, {
          ...context,
          registeredPackIds,
          registeredPackVersions,
        });
        enabled.push(pack);
      } catch (_) {
        // skip
      }
    }
    return enabled.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0;
    });
  }

  /** Stable fingerprint slice */
  function fingerprintSlice(packList) {
    return (packList || list())
      .map((p) => ({ packId: p.packId, version: p.version }))
      .sort((a, b) => (a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0));
  }

  async function execute(packId, env) {
    const entry = packs.get(packId);
    if (!entry) {
      throw new RulePackError(
        RulePackErrorKind.NOT_REGISTERED,
        `rule pack not registered: ${packId}`,
        { packId }
      );
    }
    checkRulePackCompatibility(entry.pack, {
      suiteVersion: env.suiteVersion,
      profileId: env.policy && env.policy.profileId,
      allowedEngineIds: env.allowedEngineIds,
      allowedPackIds: env.allowedPackIds,
      registeredPackIds: list().map((p) => p.packId),
      registeredPackVersions: registeredVersions(),
      determinismStrict: env.determinismStrict,
    });
    return executeRulePack(entry.pack, entry.handlers, env);
  }

  function clear() {
    packs.clear();
  }

  return {
    register,
    get,
    getHandlers,
    list,
    has,
    listEnabled,
    fingerprintSlice,
    execute,
    clear,
    registeredVersions,
    expectedSuiteVersion,
    invariants: Object.freeze({
      isPluginBased: true,
      createsDecisions: false,
      mutatesKnowledge: false,
      mutatesFacts: false,
      ownsArbitration: false,
    }),
  };
}

module.exports = { createRulePackRegistry };
