'use strict';

const { KnowledgeError, KnowledgeErrorKind } = require('./errors');
const { loadBundle, sealWithChecksum } = require('./load');
const { validateBundle } = require('./validate');
const { resolveDependencies } = require('./resolve-deps');
const { composeFromManifest, composeLayers } = require('./compose');
const { createKnowledgeHandle } = require('./handle');
const { deepFreeze, clone } = require('./checksum');

/**
 * Knowledge Registry — immutable bundles + pin/serve handles.
 */
function createKnowledgeRegistry(options = {}) {
  const expectedSuiteVersion = options.expectedSuiteVersion || '1.0.0';
  /** @type {Map<string, Map<string, object>>} bundleId -> version -> frozen bundle */
  const store = new Map();

  function key(bundleId, version) {
    return `${bundleId}@${version}`;
  }

  function register(bundle, opts = {}) {
    const frozen = typeof bundle.checksum === 'string' && Object.isFrozen(bundle)
      ? bundle
      : loadBundle(bundle, {
        expectedSuiteVersion: opts.expectedSuiteVersion || expectedSuiteVersion,
        verifyChecksum: opts.verifyChecksum,
      });

    if (!store.has(frozen.bundleId)) store.set(frozen.bundleId, new Map());
    const versions = store.get(frozen.bundleId);
    if (versions.has(frozen.version)) {
      const existing = versions.get(frozen.version);
      if (existing.checksum !== frozen.checksum) {
        throw new KnowledgeError(
          KnowledgeErrorKind.IMMUTABLE,
          `cannot replace published ${key(frozen.bundleId, frozen.version)} with different checksum`,
          { bundleId: frozen.bundleId, version: frozen.version }
        );
      }
      return existing; // idempotent
    }
    versions.set(frozen.version, frozen);
    return frozen;
  }

  function get(bundleId, version) {
    const versions = store.get(bundleId);
    return versions ? versions.get(version) || null : null;
  }

  function catalogById(bundleId) {
    const versions = store.get(bundleId);
    if (!versions) return [];
    return [...versions.entries()].map(([version, bundle]) => ({ version, bundle }));
  }

  function list() {
    const out = [];
    for (const [bundleId, versions] of store) {
      for (const version of versions.keys()) {
        out.push({ bundleId, version });
      }
    }
    return out.sort((a, b) => key(a.bundleId, a.version).localeCompare(key(b.bundleId, b.version)));
  }

  /**
   * Pin exact bundle: resolve deps, compose layers, return handle.
   */
  function pin(bundleId, version, pinOpts = {}) {
    const root = get(bundleId, version);
    if (!root) {
      throw new KnowledgeError(
        KnowledgeErrorKind.NOT_REGISTERED,
        `bundle not registered: ${bundleId}@${version}`,
        { bundleId, version }
      );
    }

    if (pinOpts.expectedSuiteVersion
        && root.suiteVersion !== pinOpts.expectedSuiteVersion) {
      throw new KnowledgeError(
        KnowledgeErrorKind.VERSION_MISMATCH,
        'pinned bundle suiteVersion mismatch',
        {
          bundle: root.suiteVersion,
          expected: pinOpts.expectedSuiteVersion,
        }
      );
    }

    resolveDependencies(root, catalogById);

    const composed = composeFromManifest(root, (id, ver) => get(id, ver));
    validateBundle(composed, {
      expectedSuiteVersion: pinOpts.expectedSuiteVersion || expectedSuiteVersion,
      verifyChecksum: false, // composed checksum freshly computed
    });

    const handle = createKnowledgeHandle(composed, {
      bundleId: composed.bundleId,
      version: composed.version,
      checksum: composed.checksum,
      composedFrom: composed.composedFrom || [
        { bundleId: root.bundleId, version: root.version, checksum: root.checksum },
      ],
      jobId: pinOpts.jobId || null,
      policyProfileId: pinOpts.policyProfileId || null,
    });

    return {
      handle,
      pin: {
        knowledgeBundleId: composed.bundleId,
        knowledgeBundleVersion: composed.version,
        knowledgeChecksum: composed.checksum,
      },
      composed,
    };
  }

  function clear() {
    store.clear();
  }

  return {
    register,
    get,
    list,
    catalogById,
    pin,
    clear,
    loadAndRegister: (source, opts) => register(loadBundle(source, {
      expectedSuiteVersion: opts && opts.expectedSuiteVersion || expectedSuiteVersion,
      verifyChecksum: opts && opts.verifyChecksum,
    }), opts),
    composeLayers,
    sealWithChecksum,
    expectedSuiteVersion,
    invariants: Object.freeze({
      isImmutable: true,
      ranks: false,
      scores: false,
      arbitrates: false,
      writesWorkspace: false,
      commitsDecisions: false,
    }),
  };
}

module.exports = { createKnowledgeRegistry };
