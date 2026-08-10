'use strict';
// figma-snapshot.js — Snapshot Manager for TRUE offline Figma converts.
// Owns snapshot I/O, validation, atomic writes, and cache logging.
// Does NOT change compiler analyze/emit logic — only stores/loads data.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const COMPILER_VERSION = (() => {
  try { return require('../package.json').version || '2.0.0'; } catch { return '2.0.0'; }
})();

const CACHE_DIR_DEFAULT = path.join(process.env.OUTPUT_DIR || path.join(__dirname, '..', 'output'), 'figma-cache');

function getCacheDir() {
  return process.env.FIGMA_CACHE_DIR || CACHE_DIR_DEFAULT;
}

/** Reject path injection into cache keys (defense in depth). */
function assertSafeCacheSegment(seg, label) {
  if (seg == null || seg === '') return;
  const s = String(seg);
  if (s.includes('..') || /[/\\]/.test(s) || path.isAbsolute(s)) {
    throw new Error(`Unsafe ${label}`);
  }
}

/** @deprecated use getCacheDir() — kept as live getter for callers */
function snapshotKey(fileKey, nodeId) {
  assertSafeCacheSegment(fileKey, 'fileKey');
  assertSafeCacheSegment(nodeId, 'nodeId');
  return `${fileKey}__${(nodeId || 'root').replace(/[^\w.-]/g, '_')}`;
}

function snapshotDir(fileKey, nodeId) {
  return path.join(getCacheDir(), snapshotKey(fileKey, nodeId));
}

/** Per-file index: output/figma-cache/{fileKey}/index.json */
function fileIndexDir(fileKey) {
  return path.join(getCacheDir(), String(fileKey));
}

function fileIndexPath(fileKey) {
  return path.join(fileIndexDir(fileKey), 'index.json');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, obj) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

function readJsonSafe(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function extForUrl(url, contentType) {
  const EXT = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/avif': '.avif',
  };
  if (contentType && EXT[contentType.split(';')[0].trim()]) return EXT[contentType.split(';')[0].trim()];
  try {
    const e = path.extname(new URL(url).pathname);
    if (e && e.length <= 5) return e;
  } catch { /* ignore */ }
  return '.img';
}

function hashName(url, ext) {
  const h = crypto.createHash('md5').update(url).digest('hex').slice(0, 10);
  let base = 'asset';
  try {
    base = (path.basename(new URL(url).pathname).replace(/\.[^.]*$/, '') || 'asset')
      .replace(/[^a-z0-9-]/gi, '-').slice(0, 40);
  } catch { /* ignore */ }
  return `${base}-${h}${ext}`;
}

/** Validate on-disk snapshot. HIT only when ok === true. */
function validateSnapshot(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { ok: false, reason: 'no_snapshot' };
  }
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) return { ok: false, reason: 'missing_metadata' };
  let meta;
  try { meta = readJson(metaPath); } catch { return { ok: false, reason: 'corrupt_metadata' }; }
  if (meta.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: 'schema_mismatch' };
  // compilerVersion mismatch does NOT invalidate snapshot JSON/assets (0 REST recompile).
  // Derived HTML is busted via EMIT_ADAPTER_VERSION / compile cache separately.

  const docPath = path.join(dir, 'document.json');
  if (!fs.existsSync(docPath)) return { ok: false, reason: 'missing_document' };
  let doc;
  try { doc = readJson(docPath); } catch { return { ok: false, reason: 'corrupt_document' }; }
  if (!doc || typeof doc.document !== 'object') return { ok: false, reason: 'missing_document' };

  const required = [
    'image-fills.json', 'image-fills.remote.json',
    'png-ids.json', 'png-remote.json',
    'svg-fallback.json', 'url-local.json',
  ];
  for (const name of required) {
    if (!fs.existsSync(path.join(dir, name))) {
      return { ok: false, reason: `missing_${name.replace(/\./g, '_')}` };
    }
  }

  let urlLocal;
  try { urlLocal = readJson(path.join(dir, 'url-local.json')); } catch {
    return { ok: false, reason: 'corrupt_url_local' };
  }
  for (const rel of Object.values(urlLocal || {})) {
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) return { ok: false, reason: `missing_asset:${rel}` };
  }
  // Structurally sound (document + every referenced asset present on disk) —
  // only the completeness FLAG can still fail it. Attach doc/meta even on
  // failure here so loadPartialSnapshot can read a structurally-valid partial
  // write back without re-parsing the directory itself.
  if (meta.complete !== true) return { ok: false, reason: 'incomplete_flag', meta, doc };
  return { ok: true, reason: 'validated_snapshot', meta, doc };
}

/**
 * Load a validated snapshot or null.
 * Emit still receives remote URL maps (same shapes as REST) for identical HTML/CSS.
 * urlToAbs lets packageSite copy from disk with zero network.
 */
function loadSnapshot(fileKey, nodeId) {
  const dir = snapshotDir(fileKey, nodeId);
  const v = validateSnapshot(dir);
  if (!v.ok) return null;

  const imageFillsRemote = readJson(path.join(dir, 'image-fills.remote.json'));
  const pngRemote = readJson(path.join(dir, 'png-remote.json'));
  const svgFallback = readJson(path.join(dir, 'svg-fallback.json'));
  const urlLocal = readJson(path.join(dir, 'url-local.json'));
  const urlToAbs = {};
  for (const [url, rel] of Object.entries(urlLocal || {})) {
    urlToAbs[url] = path.join(dir, rel);
  }
  return {
    dir,
    document: v.doc.document,
    name: v.doc.name || v.meta.name,
    fileName: v.doc.fileName,
    version: v.doc.version,
    imageFillsRemote,
    pngRemote,
    svgFallback,
    urlToAbs,
    meta: v.meta,
    validateReason: v.reason,
  };
}

/**
 * Load a persisted-but-incomplete snapshot (status:partial — structurally valid,
 * deferred some vector ids or hit a download failure) so a future top-up fetch
 * can reuse what's already on disk instead of re-fetching everything from
 * scratch. Returns null for anything structurally broken OR fully complete
 * (use loadSnapshot for the complete/HIT case). NOT yet wired into the MISS
 * executor path — this is the read-side enabler only; the executor/planner
 * change to actually fetch just `meta.deferred` and merge into the existing
 * dir is deferred past this slice (see snapshot-completeness slice item 4).
 */
function loadPartialSnapshot(fileKey, nodeId) {
  const dir = snapshotDir(fileKey, nodeId);
  const v = validateSnapshot(dir);
  if (v.ok) return null; // complete — caller should use loadSnapshot instead
  if (v.reason !== 'incomplete_flag') return null; // structurally broken, not a partial write
  return {
    dir,
    document: v.doc.document,
    name: v.doc.name || v.meta.name,
    fileName: v.doc.fileName,
    version: v.doc.version,
    imageFillsRemote: readJsonSafe(path.join(dir, 'image-fills.remote.json'), {}),
    pngRemote: readJsonSafe(path.join(dir, 'png-remote.json'), {}),
    svgFallback: readJsonSafe(path.join(dir, 'svg-fallback.json'), {}),
    deferred: v.meta.deferred || [],
    downloadFailures: v.meta.downloadFailures || 0,
    meta: v.meta,
  };
}

// ── Phase 1: subtree extract + file index ───────────────────────────────────

/** DFS: find node with id === nodeId inside a Figma document tree. */
function findNodeById(node, nodeId) {
  if (!node || nodeId == null || nodeId === '') return null;
  if (node.id === nodeId) return node;
  for (const c of node.children || []) {
    const found = findNodeById(c, nodeId);
    if (found) return found;
  }
  return null;
}

/**
 * Extract the subtree rooted at nodeId from a covering document.
 * Same shape as GET /nodes?ids=nodeId → document (the node itself + descendants).
 */
function extractSubtree(document, nodeId) {
  if (!document || nodeId == null || nodeId === '') return null;
  return findNodeById(document, nodeId);
}

function collectNodeIds(node, set = new Set()) {
  if (!node) return set;
  if (node.id) set.add(node.id);
  for (const c of node.children || []) collectNodeIds(c, set);
  return set;
}

/** imageRef values from raw Figma node fills (not analyzed element tree). */
function collectImageRefsFromFigmaNode(node, set = new Set()) {
  if (!node) return set;
  for (const f of node.fills || []) {
    if (f && f.visible !== false && f.type === 'IMAGE' && f.imageRef) set.add(f.imageRef);
  }
  for (const c of node.children || []) collectImageRefsFromFigmaNode(c, set);
  return set;
}

function filterMapByKeys(obj, keySet) {
  const out = {};
  if (!obj || !keySet) return out;
  for (const k of keySet) {
    if (obj[k]) out[k] = obj[k];
  }
  return out;
}

/**
 * Narrow parent asset maps to only what the extracted subtree needs.
 * urlToAbs keeps entries whose remote URL remains referenced.
 */
function filterAssetsForSubtree(parentSnap, extractedDoc) {
  const ids = collectNodeIds(extractedDoc);
  const refs = collectImageRefsFromFigmaNode(extractedDoc);
  const imageFillsRemote = filterMapByKeys(parentSnap.imageFillsRemote || {}, refs);
  const pngRemote = filterMapByKeys(parentSnap.pngRemote || {}, ids);
  const svgFallback = filterMapByKeys(parentSnap.svgFallback || {}, ids);
  const usedUrls = new Set(
    [...Object.values(imageFillsRemote), ...Object.values(pngRemote)].filter(Boolean)
  );
  const urlToAbs = {};
  for (const [url, abs] of Object.entries(parentSnap.urlToAbs || {})) {
    if (usedUrls.has(url)) urlToAbs[url] = abs;
  }
  return { imageFillsRemote, pngRemote, svgFallback, urlToAbs };
}

/**
 * Build a snap-shaped object for Executor.fromSnapshot (Exact vs Subtree opaque).
 */
function materializeSubtreeSnap(parentSnap, extractedDoc, nodeId) {
  const assets = filterAssetsForSubtree(parentSnap, extractedDoc);
  return {
    dir: parentSnap.dir,
    document: extractedDoc,
    name: extractedDoc.name || parentSnap.name,
    fileName: parentSnap.fileName,
    version: parentSnap.version,
    imageFillsRemote: assets.imageFillsRemote,
    pngRemote: assets.pngRemote,
    svgFallback: assets.svgFallback,
    urlToAbs: assets.urlToAbs,
    meta: parentSnap.meta,
    validateReason: 'subtree_extract',
    subtreeFromNodeId: (parentSnap.meta && parentSnap.meta.nodeId) || null,
    requestedNodeId: nodeId,
  };
}

/** Upsert covering-root entry after a successful exact snapshot save. */
function upsertFileIndex(fileKey, { nodeId, figmaVersion, kind, coverageType }) {
  if (!fileKey) return;
  const dir = fileIndexDir(fileKey);
  fs.mkdirSync(dir, { recursive: true });
  const idxPath = fileIndexPath(fileKey);
  let idx = { fileKey, roots: [], updatedAt: null };
  if (fs.existsSync(idxPath)) {
    try { idx = readJson(idxPath); } catch { /* rewrite */ }
  }
  if (!Array.isArray(idx.roots)) idx.roots = [];
  const record = {
    nodeId: nodeId || null,
    path: snapshotKey(fileKey, nodeId),
    containsHint: 'full-tree',
    figmaVersion: figmaVersion || null,
    kind: kind || 'exact',
    coverageType: coverageType || null,
    updatedAt: new Date().toISOString(),
  };
  const i = idx.roots.findIndex((r) => String(r.nodeId) === String(nodeId || null));
  if (i >= 0) idx.roots[i] = record;
  else idx.roots.push(record);
  idx.fileKey = fileKey;
  idx.updatedAt = record.updatedAt;
  writeJson(idxPath, idx);
}

/**
 * List validated snapshot roots for a fileKey (index first, else disk scan).
 * @returns {{ nodeId: string|null, dir: string, updatedAt: string|null }[]}
 */
function listValidatedRoots(fileKey) {
  if (!fileKey) return [];
  const fromIndex = [];
  const idxPath = fileIndexPath(fileKey);
  if (fs.existsSync(idxPath)) {
    try {
      const idx = readJson(idxPath);
      for (const r of idx.roots || []) {
        const dir = path.join(getCacheDir(), r.path || snapshotKey(fileKey, r.nodeId));
        const v = validateSnapshot(dir);
        if (v.ok) {
          fromIndex.push({
            nodeId: r.nodeId != null ? r.nodeId : (v.meta && v.meta.nodeId),
            dir,
            updatedAt: r.updatedAt || null,
          });
        }
      }
    } catch { /* fall through to scan */ }
  }
  if (fromIndex.length) {
    fromIndex.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return fromIndex;
  }

  // Fallback: scan exact snapshot dirs (supports pre-Phase-1 caches without index).
  const cacheDir = getCacheDir();
  if (!fs.existsSync(cacheDir)) return [];
  const prefix = `${fileKey}__`;
  const scanned = [];
  for (const name of fs.readdirSync(cacheDir)) {
    if (!name.startsWith(prefix)) continue;
    if (name.includes('.tmp-') || name.includes('.old-')) continue;
    const dir = path.join(cacheDir, name);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    const v = validateSnapshot(dir);
    if (!v.ok) continue;
    scanned.push({
      nodeId: v.meta.nodeId != null ? v.meta.nodeId : null,
      dir,
      updatedAt: (v.meta && v.meta.fetchedAt) || null,
    });
  }
  scanned.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return scanned;
}

/**
 * Find a covering validated snapshot that contains nodeId; return subtree snap or null.
 * 0 REST — disk only.
 */
function loadSubtreeSnapshot(fileKey, nodeId) {
  if (!fileKey || nodeId == null || nodeId === '') return null;
  const roots = listValidatedRoots(fileKey);
  for (const root of roots) {
    // Skip roots that are the exact node (exact path already failed or would be HIT).
    if (root.nodeId != null && String(root.nodeId) === String(nodeId)) continue;
    const parentSnap = loadSnapshot(fileKey, root.nodeId);
    if (!parentSnap || !parentSnap.document) continue;
    const extracted = extractSubtree(parentSnap.document, nodeId);
    if (!extracted) continue;
    // Require a true extract (covering ancestor), not identity with missing exact.
    if (parentSnap.document.id === nodeId) continue;
    return materializeSubtreeSnap(parentSnap, extracted, nodeId);
  }
  return null;
}

async function downloadToFile(url, destPath) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error(`download ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buf);
    return (res.headers.get('content-type') || '').split(';')[0].trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Run async work with a concurrency limit. */
async function mapPool(items, concurrency, fn) {
  const list = [...items];
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= list.length) return;
      out[i] = await fn(list[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, list.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * Atomically persist a complete offline snapshot.
 * Never leaves a partial final directory (temp → validate → rename).
 * Downloads only the provided remote maps (caller should filter to used assets).
 */
async function saveSnapshotAtomic(payload) {
  const {
    fileKey, nodeId, url, documentPayload,
    imageFillsRemote = {}, pngRemote = {}, svgFallback = {},
    // Coverage inputs (constraint #2): the full set of vector node ids that need a
    // baked asset, and the ids that were reconstructed locally (0-REST). A snapshot
    // is `complete` ONLY when every vector is covered (reconstructed inline, or in
    // svgFallback, or downloaded as png) AND no asset download failed — otherwise a
    // cache HIT would silently render empty icons.
    requiredVectorIds = [], reconstructedVectorIds = [],
  } = payload;
  const finalDir = snapshotDir(fileKey, nodeId);
  const tmpDir = `${finalDir}.tmp-${process.pid}-${Date.now()}`;
  rmrf(tmpDir);
  fs.mkdirSync(path.join(tmpDir, 'assets', 'fills'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'assets', 'png'), { recursive: true });

  try {
    writeJson(path.join(tmpDir, 'document.json'), {
      document: documentPayload.document,
      name: documentPayload.name,
      fileName: documentPayload.fileName,
      version: documentPayload.version || null,
    });

    let dlFailures = 0;
    const urlLocal = {};
    const imageFillsLocal = {};
    const fillEntries = Object.entries(imageFillsRemote || {}).filter(([, u]) => u && /^https?:/i.test(u));
    const pngEntries = Object.entries(pngRemote || {}).filter(([, u]) => u && /^https?:/i.test(u));
    console.log(`[figma-cache] snapshot download fills=${fillEntries.length} pngs=${pngEntries.length}`);

    await mapPool(fillEntries, 8, async ([ref, remoteUrl]) => {
      try {
        const dest = path.join(tmpDir, 'assets', 'fills', hashName(remoteUrl, '.img'));
        const ctype = await downloadToFile(remoteUrl, dest);
        const ext = extForUrl(remoteUrl, ctype);
        const rel = `assets/fills/${hashName(remoteUrl, ext)}`;
        const finalAbs = path.join(tmpDir, rel);
        if (finalAbs !== dest) {
          if (fs.existsSync(finalAbs)) fs.unlinkSync(dest);
          else fs.renameSync(dest, finalAbs);
        }
        urlLocal[remoteUrl] = rel;
        imageFillsLocal[ref] = rel;
      } catch { dlFailures++; /* a skipped fill makes the snapshot incomplete */ }
    });

    const pngLocal = {};
    await mapPool(pngEntries, 8, async ([id, remoteUrl]) => {
      try {
        const probeExt = extForUrl(remoteUrl, null) || '.png';
        const rel = `assets/png/${hashName(remoteUrl, probeExt === '.img' ? '.png' : probeExt)}`;
        const ctype = await downloadToFile(remoteUrl, path.join(tmpDir, rel));
        const ext = extForUrl(remoteUrl, ctype);
        const finalRel = ext && ext !== probeExt
          ? `assets/png/${hashName(remoteUrl, ext)}`
          : rel;
        if (finalRel !== rel) {
          const from = path.join(tmpDir, rel);
          const to = path.join(tmpDir, finalRel);
          if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
        }
        urlLocal[remoteUrl] = finalRel;
        pngLocal[id] = finalRel;
      } catch { dlFailures++; /* a skipped png/svg makes the snapshot incomplete */ }
    });

    writeJson(path.join(tmpDir, 'image-fills.remote.json'), imageFillsRemote || {});
    writeJson(path.join(tmpDir, 'image-fills.json'), imageFillsLocal);
    writeJson(path.join(tmpDir, 'png-remote.json'), pngRemote || {});
    writeJson(path.join(tmpDir, 'png-ids.json'), pngLocal);
    writeJson(path.join(tmpDir, 'svg-fallback.json'), svgFallback || {});
    writeJson(path.join(tmpDir, 'url-local.json'), urlLocal);

    // Vector coverage: every required vector must be reconstructed-inline, in the
    // svg fallback map, or downloaded as png. Uncovered vectors (or any failed
    // download) mean the snapshot is NOT complete → validateSnapshot rejects it →
    // no silent cache HIT with empty icons (constraint #2).
    const covered = new Set([
      ...reconstructedVectorIds,
      ...Object.keys(svgFallback || {}),
      ...Object.keys(pngLocal),
    ]);
    const deferred = (requiredVectorIds || []).filter((id) => !covered.has(id));
    const complete = dlFailures === 0 && deferred.length === 0;
    if (!complete) {
      console.log(`[figma-cache] snapshot INCOMPLETE — ${deferred.length} uncovered vector(s), ${dlFailures} failed download(s); will not serve as a HIT`);
    }

    writeJson(path.join(tmpDir, 'metadata.json'), {
      schemaVersion: SCHEMA_VERSION,
      compilerVersion: COMPILER_VERSION,
      fileKey,
      nodeId: nodeId || null,
      rootNodeId: nodeId || null,
      kind: payload.kind || 'exact',
      coverageType: payload.coverageType || null,
      url: url || null,
      name: documentPayload.name || null,
      figmaVersion: documentPayload.version || null,
      fetchedAt: new Date().toISOString(),
      complete,
      deferred,
      downloadFailures: dlFailures,
    });

    // An incomplete snapshot (missing vector coverage or a failed download) is
    // still a STRUCTURALLY VALID write — every file is well-formed, just not
    // eligible to serve as a HIT. Persisting it (status:partial) lets a later
    // request top-up only the deferred ids instead of re-fetching everything;
    // deleting it here would waste all the REST work this call just did for
    // zero benefit. Any OTHER validation failure (corrupt JSON, missing file)
    // means the write itself is broken — that must still be discarded.
    const v = validateSnapshot(tmpDir);
    if (!v.ok && v.reason !== 'incomplete_flag') {
      rmrf(tmpDir);
      throw new Error(`snapshot validation failed after write: ${v.reason}`);
    }

    fs.mkdirSync(getCacheDir(), { recursive: true });
    if (fs.existsSync(finalDir)) {
      const bak = `${finalDir}.old-${Date.now()}`;
      fs.renameSync(finalDir, bak);
      try {
        fs.renameSync(tmpDir, finalDir);
        rmrf(bak);
      } catch (e) {
        try { fs.renameSync(bak, finalDir); } catch { /* ignore */ }
        rmrf(tmpDir);
        throw e;
      }
    } else {
      fs.renameSync(tmpDir, finalDir);
    }

    try {
      upsertFileIndex(fileKey, {
        nodeId: nodeId || null,
        figmaVersion: documentPayload.version || null,
        kind: payload.kind || 'exact',
        coverageType: payload.coverageType || null,
      });
    } catch (e) {
      try {
        const { logWarn } = require('./scalability/request-log');
        logWarn('cache_index_update_failed', { message: e.message });
      } catch { /* ignore */ }
    }

    return finalDir;
  } catch (e) {
    rmrf(tmpDir);
    throw e;
  }
}

function logCacheEvent({ status, reason, restCalls, ms, fileKey, nodeId }) {
  try {
    const { logInfo } = require('./scalability/request-log');
    logInfo('cache_event', { status, reason, restCalls, ms, fileKey, nodeId });
  } catch {
    // Fallback if log module unavailable
  }
}

function probeMissReason(fileKey, nodeId, refresh) {
  if (refresh) return 'refresh_requested';
  return validateSnapshot(snapshotDir(fileKey, nodeId)).reason || 'no_snapshot';
}

module.exports = {
  SCHEMA_VERSION,
  COMPILER_VERSION,
  get CACHE_DIR() { return getCacheDir(); },
  getCacheDir,
  snapshotKey,
  snapshotDir,
  fileIndexPath,
  validateSnapshot,
  loadSnapshot,
  loadPartialSnapshot,
  saveSnapshotAtomic,
  logCacheEvent,
  probeMissReason,
  // Phase 1 subtree
  findNodeById,
  extractSubtree,
  collectNodeIds,
  collectImageRefsFromFigmaNode,
  filterAssetsForSubtree,
  materializeSubtreeSnap,
  upsertFileIndex,
  listValidatedRoots,
  loadSubtreeSnapshot,
  writeJson,
  readJsonSafe,
};
