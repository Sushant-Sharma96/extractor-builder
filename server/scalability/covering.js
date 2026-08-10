'use strict';
/**
 * Covering-container selection for Page/Frame-first ingest.
 * Discovers FRAME → SECTION → PAGE without caching the full file geometry.
 */

const COVERING_FRAME = 'FRAME';
const COVERING_SECTION = 'SECTION';
const COVERING_PAGE = 'PAGE';
const COVERING_NODE = 'NODE';

/**
 * DFS path from document root → node (inclusive), or null if not found.
 * @returns {object[]|null}
 */
function findPathToNode(root, nodeId, path = []) {
  if (!root || nodeId == null || nodeId === '') return null;
  const next = path.concat(root);
  if (root.id === nodeId) return next;
  for (const c of root.children || []) {
    const found = findPathToNode(c, nodeId, next);
    if (found) return found;
  }
  return null;
}

/**
 * Select covering container from ancestor path (root → leaf).
 *
 * Preference (unlocks multi-section Subtree reuse):
 *  1. Top-level FRAME under CANVAS (page desktop frame containing sections)
 *  2. Else nearest FRAME walking leaf → root (including self)
 *  3. Else nearest SECTION
 *  4. Else PAGE (CANVAS)
 *  5. Else the node itself
 *
 * Never returns DOCUMENT / full file.
 */
function selectCoveringFromPath(path) {
  if (!path || !path.length) return null;
  const leaf = path[path.length - 1];

  // 1. Top-level frame on the page (direct child of CANVAS) — preferred commercial cover
  for (let i = 0; i < path.length; i++) {
    const n = path[i];
    const parent = i > 0 ? path[i - 1] : null;
    if (n.type === 'FRAME' && parent && parent.type === 'CANVAS') {
      return {
        coveringId: n.id,
        coverageType: COVERING_FRAME,
        kind: 'page',
        coveringName: n.name || null,
      };
    }
  }

  // 2. Nearest FRAME (leaf → root)
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].type === 'FRAME') {
      return {
        coveringId: path[i].id,
        coverageType: COVERING_FRAME,
        kind: path[i].id === leaf.id ? 'exact' : 'exact',
        coveringName: path[i].name || null,
      };
    }
  }

  // 3. Nearest SECTION
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].type === 'SECTION') {
      return {
        coveringId: path[i].id,
        coverageType: COVERING_SECTION,
        kind: 'page',
        coveringName: path[i].name || null,
      };
    }
  }

  // 4. PAGE (CANVAS) — never DOCUMENT
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].type === 'CANVAS') {
      return {
        coveringId: path[i].id,
        coverageType: COVERING_PAGE,
        kind: 'page',
        coveringName: path[i].name || null,
      };
    }
  }

  return {
    coveringId: leaf.id,
    coverageType: COVERING_NODE,
    kind: 'exact',
    coveringName: leaf.name || null,
  };
}

function isSelfCoveringType(type) {
  return type === 'FRAME' || type === 'SECTION' || type === 'CANVAS';
}

function coverageTypeForNodeType(type) {
  if (type === 'FRAME') return COVERING_FRAME;
  if (type === 'SECTION') return COVERING_SECTION;
  if (type === 'CANVAS') return COVERING_PAGE;
  return COVERING_NODE;
}

module.exports = {
  findPathToNode,
  selectCoveringFromPath,
  isSelfCoveringType,
  coverageTypeForNodeType,
  COVERING_FRAME,
  COVERING_SECTION,
  COVERING_PAGE,
  COVERING_NODE,
};
