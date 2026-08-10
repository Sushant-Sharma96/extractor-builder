// figma-fetch.js
// The source adapter for Figma (analogous to capture.js for Lovable). Figma has
// no DOM to scrape — the source of truth is the REST API node tree (JSON). This
// module: parses a Figma URL, fetches the linked node subtree, and exports
// image fills (PNG) and vector nodes (SVG) so the generator can embed them.
// Disk snapshot cache lives in figma-snapshot.js (HIT/MISS orchestration in index.js).

const FIGMA_API = 'https://api.figma.com/v1';

// https://www.figma.com/design/{fileKey}/{name}?node-id=1-133  →  {fileKey, nodeId:'1:133'}
function parseFigmaUrl(url) {
  const m = String(url || '').match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9_-]+)/);
  const fileKey = m ? m[1] : null;
  let nodeId = null;
  const nm = String(url || '').match(/[?&]node-id=([^&]+)/);
  if (nm) nodeId = decodeURIComponent(nm[1]).replace(/-/g, ':'); // 1-133 → 1:133
  return { fileKey, nodeId };
}

// auth = { token, oauth } — PAT uses X-Figma-Token, OAuth uses Bearer.
function authHeaders(auth) {
  if (!auth || !auth.token) throw new Error('A Figma token is required (Personal Access Token or OAuth).');
  return auth.oauth ? { Authorization: `Bearer ${auth.token}` } : { 'X-Figma-Token': auth.token };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Optional counter: { n: 0 } — incremented on each successful api.figma.com call.
async function figmaGet(apiPath, auth, tries = 4, counter = null) {
  const timeoutMs = parseInt(process.env.FIGMA_REQUEST_TIMEOUT_MS || process.env.REQUEST_TIMEOUT || '30000', 10) || 30000;
  for (let attempt = 0; ; attempt++) {
    let res;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      res = await fetch(`${FIGMA_API}${apiPath}`, { headers: authHeaders(auth), signal: ctrl.signal });
    } catch (netErr) {
      clearTimeout(timer);
      if (attempt < tries) { await sleep(1000 * (attempt + 1)); continue; }
      throw new Error('Figma request failed (network/timeout): ' + netErr.message);
    }
    clearTimeout(timer);
    const text = await res.text();
    if (res.ok) {
      if (counter) counter.n = (counter.n || 0) + 1;
      return JSON.parse(text);
    }
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '', 10) || 0;
      if (retryAfter && retryAfter <= 30 && attempt < tries) { await sleep(retryAfter * 1000); continue; }
      if (!retryAfter && attempt < tries) { await sleep(1500 * (attempt + 1)); continue; }
      const mins = Math.round(retryAfter / 60);
      const when = mins >= 90 ? `${Math.round(mins / 60)} hour(s)` : `${mins} minute(s)`;
      const planTier = res.headers.get('x-figma-plan-tier') || '?';
      const e = new Error(`Figma rate limit exceeded (plan: ${planTier}). File reads are locked for ~${when}. Cached designs still work; try a different token or wait.`);
      e.status = 429;
      e.retryAfter = retryAfter;
      e.planTier = planTier === '?' ? null : planTier;
      e.rateLimitType = res.headers.get('x-figma-rate-limit-type') || null;
      e.upgradeLink = res.headers.get('x-figma-upgrade-link') || null;
      throw e;
    }
    let msg = text;
    try { msg = JSON.parse(text).err || text; } catch { /* raw */ }
    const e = new Error(`Figma API ${res.status}: ${msg}`);
    e.status = res.status;
    throw e;
  }
}

// Always hits Figma REST (no disk cache here). Snapshot HIT is handled by figma-snapshot + index.
async function fetchNode(fileKey, nodeId, auth, { counter = null } = {}) {
  if (!fileKey) throw new Error('Could not read a Figma file key from that URL.');
  let result;
  if (nodeId) {
    const data = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&geometry=paths`, auth, 4, counter);
    const entry = data.nodes && data.nodes[nodeId];
    if (!entry || !entry.document) throw new Error('That node was not found in the file (check the node-id).');
    result = { document: entry.document, name: data.name || entry.document.name, fileName: data.name, version: entry.document.version || data.version || null };
  } else {
    const data = await figmaGet(`/files/${fileKey}?depth=100&geometry=paths`, auth, 4, counter);
    const page = data.document.children.find((c) => c.type === 'CANVAS') || data.document.children[0];
    const frame = (page.children || []).find((c) => c.type === 'FRAME') || page;
    result = { document: frame, name: data.name, fileName: data.name, version: data.version || null };
  }
  return result;
}

/**
 * Lightweight file tree for covering discovery — NO geometry=paths (structure only).
 * Tier 1 GET file. Never used as the compile/snapshot geometry source.
 */
async function fetchFileStructure(fileKey, auth, counter = null) {
  if (!fileKey) throw new Error('Could not read a Figma file key from that URL.');
  const data = await figmaGet(`/files/${fileKey}?depth=100`, auth, 4, counter);
  if (!data || !data.document) throw new Error('Figma file structure had no document.');
  return {
    document: data.document,
    name: data.name || null,
    version: data.version || null,
  };
}

async function exportImages(fileKey, ids, format, auth, scale = 2, counter = null) {
  ids = [...new Set(ids)].filter(Boolean);
  if (!ids.length) return {};
  const out = {};
  for (let i = 0; i < ids.length; i += 60) {
    const chunk = ids.slice(i, i + 60);
    try {
      const data = await figmaGet(
        `/images/${fileKey}?ids=${chunk.map(encodeURIComponent).join(',')}&format=${format}${format === 'svg' ? '' : `&scale=${scale}`}`,
        auth, 4, counter
      );
      Object.assign(out, data.images || {});
    } catch (e) { if (e.status === 429) throw e; }
    if (i + 60 < ids.length) await sleep(400);
  }
  return out;
}

async function fetchImageFills(fileKey, auth, counter = null) {
  try {
    const data = await figmaGet(`/files/${fileKey}/images`, auth, 4, counter);
    return (data.meta && data.meta.images) || {};
  } catch { return {}; }
}

async function fetchSvgMarkup(fileKey, ids, auth, counter = null) {
  const urls = await exportImages(fileKey, ids, 'svg', auth, 2, counter);
  const out = {};
  await Promise.all(Object.entries(urls).map(async ([id, url]) => {
    if (!url) return;
    try { const r = await fetch(url); if (r.ok) out[id] = await r.text(); } catch { /* skip */ }
  }));
  return out;
}

module.exports = { parseFigmaUrl, fetchNode, fetchFileStructure, exportImages, fetchSvgMarkup, fetchImageFills, authHeaders, FIGMA_API };
