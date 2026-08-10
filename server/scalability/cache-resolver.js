'use strict';
/**
 * Cache Resolver — Exact → Subtree → MISS.
 * Phase 1: subtree extract from covering snapshots (0 REST).
 * Executor must not know Exact vs Subtree (opaque snap shape).
 */

const {
  loadSnapshot,
  loadSubtreeSnapshot,
  probeMissReason,
} = require('../figma-snapshot');

/**
 * @param {{ fileKey: string, nodeId: string|null, refresh: boolean }} input
 * @returns {{
 *   hit: boolean,
 *   cachePath: 'exact'|'subtree'|'none',
 *   cacheStatus: 'HIT'|'SUBTREE'|'MISS',
 *   cacheReason: string,
 *   snap: object|null
 * }}
 */
function resolve({ fileKey, nodeId, refresh }) {
  if (refresh) {
    return {
      hit: false,
      cachePath: 'none',
      cacheStatus: 'MISS',
      cacheReason: probeMissReason(fileKey, nodeId, true),
      snap: null,
    };
  }

  // 1. Exact
  const exact = loadSnapshot(fileKey, nodeId);
  if (exact) {
    return {
      hit: true,
      cachePath: 'exact',
      cacheStatus: 'HIT',
      cacheReason: exact.validateReason || 'validated_snapshot',
      snap: exact,
    };
  }

  // 2. Subtree (covering ancestor document contains nodeId)
  if (nodeId) {
    const sub = loadSubtreeSnapshot(fileKey, nodeId);
    if (sub) {
      return {
        hit: true,
        cachePath: 'subtree',
        cacheStatus: 'SUBTREE',
        cacheReason: sub.validateReason || 'subtree_extract',
        snap: sub,
      };
    }
  }

  // 3. MISS
  return {
    hit: false,
    cachePath: 'none',
    cacheStatus: 'MISS',
    cacheReason: probeMissReason(fileKey, nodeId, false),
    snap: null,
  };
}

/** @deprecated Phase 0 name — delegates to resolve() */
function resolveExact(opts) {
  return resolve(opts);
}

module.exports = { resolve, resolveExact };
