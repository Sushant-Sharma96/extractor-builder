'use strict';

const { KnowledgeError, KnowledgeErrorKind } = require('./errors');
const { deepFreeze, clone } = require('./checksum');

/**
 * Job-scoped read-only KnowledgeHandle.
 * No Workspace, no mutation, no ranking.
 */
function createKnowledgeHandle(composedBundle, provenance = {}) {
  if (!composedBundle) {
    throw new KnowledgeError(KnowledgeErrorKind.NOT_REGISTERED, 'composed bundle required');
  }

  const entriesById = new Map((composedBundle.entries || []).map((e) => [e.entryId, e]));
  const disposed = { value: false };

  function assertLive() {
    if (disposed.value) {
      throw new KnowledgeError(KnowledgeErrorKind.IMMUTABLE, 'knowledge handle disposed');
    }
  }

  const handle = {
    bundleId: composedBundle.bundleId,
    version: composedBundle.version,
    checksum: composedBundle.checksum || null,
    suiteVersion: composedBundle.suiteVersion,
    provenance: Object.freeze({ ...provenance }),

    get(entryId) {
      assertLive();
      const e = entriesById.get(entryId);
      return e ? deepFreeze(clone(e)) : null;
    },

    query(kind, filterFn) {
      assertLive();
      let list = [...entriesById.values()];
      if (kind) list = list.filter((e) => e.kind === kind);
      if (typeof filterFn === 'function') list = list.filter(filterFn);
      return list
        .sort((a, b) => (a.entryId < b.entryId ? -1 : 1))
        .map((e) => deepFreeze(clone(e)));
    },

    listIds(kind) {
      assertLive();
      return this.query(kind).map((e) => e.entryId);
    },

    relations(entryId) {
      assertLive();
      return (composedBundle.relations || [])
        .filter((r) => r.from === entryId || r.to === entryId)
        .map((r) => deepFreeze(clone(r)));
    },

    getChecksum() {
      assertLive();
      return composedBundle.checksum || null;
    },

    /** Explicit denies — Knowledge is not an engine */
    put() {
      throw new KnowledgeError(KnowledgeErrorKind.IMMUTABLE, 'knowledge is immutable — put denied');
    },
    mutate() {
      throw new KnowledgeError(KnowledgeErrorKind.IMMUTABLE, 'knowledge is immutable — mutate denied');
    },
    writeWorkspace() {
      throw new KnowledgeError(
        KnowledgeErrorKind.CAPABILITY_DENIED,
        'knowledge cannot write Workspace'
      );
    },
    putDecision() {
      throw new KnowledgeError(
        KnowledgeErrorKind.CAPABILITY_DENIED,
        'knowledge cannot commit Decisions'
      );
    },
    rank() {
      throw new KnowledgeError(KnowledgeErrorKind.CAPABILITY_DENIED, 'knowledge cannot rank');
    },
    score() {
      throw new KnowledgeError(KnowledgeErrorKind.CAPABILITY_DENIED, 'knowledge cannot score');
    },
    arbitrate() {
      throw new KnowledgeError(KnowledgeErrorKind.CAPABILITY_DENIED, 'knowledge cannot arbitrate');
    },

    dispose() {
      disposed.value = true;
    },

    _isDisposed: () => disposed.value,
  };

  return Object.freeze(handle);
}

module.exports = { createKnowledgeHandle };
