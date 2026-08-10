'use strict';

const { KnowledgeError, KnowledgeErrorKind } = require('./errors');
const {
  ENTRY_KINDS,
  RELATION_TYPES,
  SEMVER_RE,
  computeChecksum,
} = require('./checksum');

/**
 * Structural validation of a KnowledgeBundle (no reasoning).
 * @param {object} bundle
 * @param {{ expectedSuiteVersion?: string, verifyChecksum?: boolean }} [opts]
 */
function validateBundle(bundle, opts = {}) {
  if (!bundle || typeof bundle !== 'object') {
    throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'bundle object required');
  }
  if (bundle.contractId !== 'KnowledgeBundle') {
    throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'contractId must be KnowledgeBundle');
  }
  if (!bundle.bundleId || typeof bundle.bundleId !== 'string') {
    throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'bundleId required');
  }
  if (!bundle.version || !SEMVER_RE.test(bundle.version)) {
    throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, `bad bundle version: ${bundle.version}`);
  }
  if (!bundle.suiteVersion || typeof bundle.suiteVersion !== 'string') {
    throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'suiteVersion required');
  }
  if (opts.expectedSuiteVersion != null && bundle.suiteVersion !== opts.expectedSuiteVersion) {
    throw new KnowledgeError(
      KnowledgeErrorKind.VERSION_MISMATCH,
      `suiteVersion mismatch: bundle=${bundle.suiteVersion} expected=${opts.expectedSuiteVersion}`,
      { bundle: bundle.suiteVersion, expected: opts.expectedSuiteVersion }
    );
  }

  const entries = Array.isArray(bundle.entries) ? bundle.entries : null;
  if (!entries) {
    throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'entries must be an array');
  }
  const relations = Array.isArray(bundle.relations) ? bundle.relations : null;
  if (!relations) {
    throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'relations must be an array');
  }
  if (!Array.isArray(bundle.dependencies)) {
    throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'dependencies must be an array');
  }
  if (!Array.isArray(bundle.layers)) {
    throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'layers must be an array');
  }
  if (!Array.isArray(bundle.packs)) {
    throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'packs must be an array');
  }
  if (!Array.isArray(bundle.priors)) {
    throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'priors must be an array');
  }

  const ids = new Set();
  for (const e of entries) {
    if (!e || !e.entryId || typeof e.entryId !== 'string') {
      throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'entry missing entryId');
    }
    if (ids.has(e.entryId)) {
      throw new KnowledgeError(
        KnowledgeErrorKind.DUPLICATE_ENTRY,
        `duplicate entryId: ${e.entryId}`,
        { entryId: e.entryId }
      );
    }
    ids.add(e.entryId);
    if (!ENTRY_KINDS.includes(e.kind)) {
      throw new KnowledgeError(
        KnowledgeErrorKind.INVALID_BUNDLE,
        `unknown entry kind: ${e.kind}`,
        { entryId: e.entryId, kind: e.kind }
      );
    }
  }

  for (const r of relations) {
    if (!r || !r.from || !r.to || !r.type) {
      throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'relation missing from/to/type');
    }
    if (!RELATION_TYPES.includes(r.type)) {
      throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, `unknown relation type: ${r.type}`);
    }
    if (!ids.has(r.from) || !ids.has(r.to)) {
      throw new KnowledgeError(
        KnowledgeErrorKind.RELATION_BROKEN,
        `relation endpoint missing: ${r.from} → ${r.to}`,
        { from: r.from, to: r.to }
      );
    }
  }

  for (const d of bundle.dependencies) {
    if (!d || !d.bundleId || typeof d.versionRange !== 'string') {
      throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'dependency needs bundleId + versionRange');
    }
  }

  if (opts.verifyChecksum !== false && bundle.checksum != null) {
    const expected = computeChecksum(bundle);
    if (bundle.checksum !== expected) {
      throw new KnowledgeError(
        KnowledgeErrorKind.CHECKSUM_MISMATCH,
        'bundle checksum mismatch',
        { declared: bundle.checksum, computed: expected }
      );
    }
  }

  return true;
}

module.exports = { validateBundle };
