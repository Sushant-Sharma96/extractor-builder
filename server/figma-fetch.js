// figma-fetch.js
// The source adapter for Figma (analogous to capture.js for Lovable). Figma has
// no DOM to scrape — the source of truth is the REST API node tree (JSON). This
// module: parses a Figma URL, fetches the linked node subtree, and exports
// image fills (PNG) and vector nodes (SVG) so the generator can embed them.

const fs = require('fs');
const path = require('path');
const FIGMA_API = 'https://api.figma.com/v1';
const CACHE_DIR = process.env.FIGMA_CACHE_DIR
  || path.join(process.env.OUTPUT_DIR || '/tmp/output', 'figma-cache');

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

async function figmaGet(path, auth, tries = 4) {
  for (let attempt = 0; ; attempt++) {
    let res;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000); // don't hang forever on a stalled connection
    try {
      res = await fetch(`${FIGMA_API}${path}`, { headers: authHeaders(auth), signal: ctrl.signal });
    } catch (netErr) {
      clearTimeout(timer);
      if (attempt < tries) { await sleep(1000 * (attempt + 1)); continue; } // transient / timeout
      throw new Error('Figma request failed (network/timeout): ' + netErr.message);
    }
    clearTimeout(timer);
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    // Rate limited → retry only for SHORT waits; a long Retry-After means the
    // quota is exhausted, so fail fast with a clear message instead of hanging.
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '', 10) || 0;
      if (retryAfter && retryAfter <= 30 && attempt < tries) { await sleep(retryAfter * 1000); continue; }
      if (!retryAfter && attempt < tries) { await sleep(1500 * (attempt + 1)); continue; }
      const mins = Math.round(retryAfter / 60);
      const when = mins >= 90 ? `${Math.round(mins / 60)} hour(s)` : `${mins} minute(s)`;
      const e = new Error(`Figma rate limit exceeded (plan: ${res.headers.get('x-figma-plan-tier') || '?'}). File reads are locked for ~${when}. Cached designs still work; try a different token or wait.`);
      e.status = 429;
      throw e;
    }
    let msg = text;
    try { msg = JSON.parse(text).err || text; } catch { /* raw */ }
    const e = new Error(`Figma API ${res.status}: ${msg}`);
    e.status = res.status;
    throw e;
  }
}

// Fetch the linked node subtree. Figma's file-read API is strictly rate-limited,
// so we CACHE every successful fetch to disk and reuse it — a design is fetched
// at most once. Pass { refresh: true } to force a re-fetch.
async function fetchNode(fileKey, nodeId, auth, { refresh = false } = {}) {
  if (!fileKey) throw new Error('Could not read a Figma file key from that URL.');
  const cacheFile = path.join(CACHE_DIR, `${fileKey}__${(nodeId || 'root').replace(/[^\w.-]/g, '_')}.json`);
  if (!refresh && fs.existsSync(cacheFile)) {
    try {
      const snap = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      console.log(`[figma] CACHE HIT  ${fileKey}/${nodeId || 'root'} — reading local snapshot, 0 REST calls`);
      snap.cache = 'HIT';
      return snap;
    } catch { /* corrupt snapshot → fall through to a fresh fetch */ }
  }
  console.log(`[figma] CACHE ${refresh ? 'REFRESH' : 'MISS'} ${fileKey}/${nodeId || 'root'} — fetching from Figma REST (geometry=paths), then caching`);
  let result;
  if (nodeId) {
    // geometry=paths → vector path data travels in the JSON, so icons are
    // reconstructed locally (zero /images render calls, the endpoint that locks).
    const data = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&geometry=paths`, auth);
    const entry = data.nodes && data.nodes[nodeId];
    if (!entry || !entry.document) throw new Error('That node was not found in the file (check the node-id).');
    result = { document: entry.document, name: data.name || entry.document.name, fileName: data.name, version: entry.document.version || data.version || null };
  } else {
    const data = await figmaGet(`/files/${fileKey}?depth=100&geometry=paths`, auth);
    const page = data.document.children.find((c) => c.type === 'CANVAS') || data.document.children[0];
    const frame = (page.children || []).find((c) => c.type === 'FRAME') || page;
    result = { document: frame, name: data.name, fileName: data.name, version: data.version || null };
  }
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(result)); } catch { /* cache best-effort */ }
  console.log(`[figma] SNAPSHOT SAVED ${cacheFile} — subsequent Generate for this URL = 0 REST calls`);
  result.cache = 'MISS';
  return result;
}

// Export nodes as PNG (image fills) or SVG (vectors/icons). Returns { id: url }.
async function exportImages(fileKey, ids, format, auth, scale = 2) {
  ids = [...new Set(ids)].filter(Boolean);
  if (!ids.length) return {};
  const out = {};
  // Batch many ids per call (fewer requests = fewer rate-limit hits), pace them.
  for (let i = 0; i < ids.length; i += 60) {
    const chunk = ids.slice(i, i + 60);
    try {
      const data = await figmaGet(`/images/${fileKey}?ids=${chunk.map(encodeURIComponent).join(',')}&format=${format}${format === 'svg' ? '' : `&scale=${scale}`}`, auth);
      Object.assign(out, data.images || {});
    } catch (e) { if (e.status === 429) throw e; /* else skip unexportable */ }
    if (i + 60 < ids.length) await sleep(400);
  }
  return out;
}

// All image-fill URLs in ONE call, keyed by imageRef (no per-node rendering,
// so no /images rate-limit storm). Use this for photos; /images?format=svg
// stays for rendered icons only.
async function fetchImageFills(fileKey, auth) {
  try {
    const data = await figmaGet(`/files/${fileKey}/images`, auth);
    return (data.meta && data.meta.images) || {};
  } catch { return {}; }
}

// Fetch raw SVG markup for a set of node ids (to inline crisp icons).
async function fetchSvgMarkup(fileKey, ids, auth) {
  const urls = await exportImages(fileKey, ids, 'svg', auth);
  const out = {};
  await Promise.all(Object.entries(urls).map(async ([id, url]) => {
    if (!url) return;
    try { const r = await fetch(url); if (r.ok) out[id] = await r.text(); } catch { /* skip */ }
  }));
  return out;
}

module.exports = { parseFigmaUrl, fetchNode, exportImages, fetchSvgMarkup, fetchImageFills, authHeaders };
