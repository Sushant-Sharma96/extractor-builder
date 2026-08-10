'use strict';

/**
 * Phase 7 — Knowledge Bundle infrastructure.
 * Immutable ontology only. No rules, ranking, or Workspace writes.
 */

const { KnowledgeError, KnowledgeErrorKind } = require('./errors');
const {
  ENTRY_KINDS,
  RELATION_TYPES,
  SEMVER_RE,
  canonicalStringify,
  computeChecksum,
  deepFreeze,
  clone,
} = require('./checksum');
const { validateBundle } = require('./validate');
const { loadBundle, sealWithChecksum } = require('./load');
const { resolveDependencies, satisfies, cmpSemver } = require('./resolve-deps');
const { composeLayers, composeFromManifest } = require('./compose');
const { createKnowledgeHandle } = require('./handle');
const { createKnowledgeRegistry } = require('./registry');

function emptyBundle(over = {}) {
  return sealWithChecksum({
    contractId: 'KnowledgeBundle',
    bundleId: 'compiler-ui-ontology',
    version: '0.0.0',
    suiteVersion: '1.0.0',
    createdAt: '2026-07-18T00:00:00.000Z',
    description: 'Empty Phase 7 knowledge spine',
    layers: [],
    dependencies: [],
    entries: [],
    relations: [],
    packs: [],
    priors: [],
    ...over,
  });
}

module.exports = {
  KnowledgeError,
  KnowledgeErrorKind,
  ENTRY_KINDS,
  RELATION_TYPES,
  SEMVER_RE,
  canonicalStringify,
  computeChecksum,
  deepFreeze,
  clone,
  validateBundle,
  loadBundle,
  sealWithChecksum,
  resolveDependencies,
  satisfies,
  cmpSemver,
  composeLayers,
  composeFromManifest,
  createKnowledgeHandle,
  createKnowledgeRegistry,
  emptyBundle,
};
