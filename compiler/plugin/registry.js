'use strict';

const { PluginError, PluginErrorKind } = require('./errors');
const { normalizeDeclaration, validateDeclaration } = require('./validate');
const { checkPluginCompatibility } = require('./compatibility');

/**
 * Phase 6 Plugin Registry — full declaration + versioning.
 * Keyed by plugin id (one active version per id).
 */
function createPluginRegistry(options = {}) {
  const byId = new Map();
  const versionIndex = new Set(); // `${id}@${version}`
  const expectedSuiteVersion = options.expectedSuiteVersion || '1.0.0';

  function register(raw) {
    validateDeclaration(raw, { expectedSuiteVersion });
    const decl = normalizeDeclaration(raw);

    if (byId.has(decl.id)) {
      throw new PluginError(
        PluginErrorKind.DUPLICATE_ID,
        `duplicate plugin id: ${decl.id}`,
        { id: decl.id }
      );
    }
    const verKey = `${decl.id}@${decl.version}`;
    if (versionIndex.has(verKey)) {
      throw new PluginError(
        PluginErrorKind.DUPLICATE_VERSION,
        `duplicate plugin version: ${verKey}`,
        { id: decl.id, version: decl.version }
      );
    }

    byId.set(decl.id, decl);
    versionIndex.add(verKey);
    return decl;
  }

  function get(id) {
    return byId.get(id) || null;
  }

  function list() {
    return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  function has(id) {
    return byId.has(id);
  }

  function clear() {
    byId.clear();
    versionIndex.clear();
  }

  /**
   * Plugins enabled for a job under policy + compatibility.
   */
  function listEnabled(context = {}) {
    const enabled = [];
    const ids = list().map((p) => p.id);
    for (const p of list()) {
      try {
        checkPluginCompatibility(p, {
          ...context,
          enabledPluginIds: ids.filter((id) => id !== p.id).concat(
            // check against others that would also pass — two-pass
            []
          ),
        });
        enabled.push(p);
      } catch (_) {
        // skip incompatible
      }
    }
    // Second pass: incompatiblePlugins among enabled set
    const enabledIds = new Set(enabled.map((p) => p.id));
    return enabled.filter((p) => {
      for (const other of p.incompatiblePlugins || []) {
        if (enabledIds.has(other)) return false;
      }
      return true;
    }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Stable fingerprint slice: [{ id, version }, ...] sorted by id. */
  function fingerprintSlice(pluginList) {
    const list_ = (pluginList || list())
      .map((p) => ({ id: p.id, version: p.version }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return list_;
  }

  return {
    register,
    get,
    list,
    has,
    clear,
    listEnabled,
    fingerprintSlice,
    expectedSuiteVersion,
  };
}

module.exports = { createPluginRegistry };
