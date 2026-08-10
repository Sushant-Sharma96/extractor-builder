'use strict';
/**
 * Input validation for Figma convert (and related) — reject early.
 */

const FILE_KEY_RE = /^[A-Za-z0-9]{10,128}$/;
const NODE_ID_RE = /^(\d+:\d+)(:\d+)*$/;

function isValidHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidFigmaUrl(str) {
  if (!isValidHttpUrl(str)) return false;
  try {
    const u = new URL(str);
    return /(^|\.)figma\.com$/i.test(u.hostname)
      && /\/(design|file|proto)\//i.test(u.pathname);
  } catch {
    return false;
  }
}

function isValidFileKey(fileKey) {
  return typeof fileKey === 'string' && FILE_KEY_RE.test(fileKey);
}

function isValidNodeId(nodeId) {
  if (nodeId == null || nodeId === '') return true; // optional
  if (typeof nodeId !== 'string') return false;
  // Accept URL form 1-2 as well as 1:2
  const normalized = nodeId.replace(/-/g, ':');
  return NODE_ID_RE.test(normalized) && normalized.length <= 64;
}

/**
 * Validate convert body. Returns { ok, errorCode, message, fileKey?, nodeId? }.
 */
function validateFigmaConvertBody(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, errorCode: 'INVALID_BODY', message: 'Request body must be a JSON object.' };
  }
  const { url, token, refresh, force } = body;
  if (!url || typeof url !== 'string') {
    return { ok: false, errorCode: 'INVALID_URL', message: 'Please provide a valid Figma design URL.' };
  }
  if (url.length > 2048) {
    return { ok: false, errorCode: 'INVALID_URL', message: 'URL is too long.' };
  }
  if (!isValidFigmaUrl(url)) {
    return { ok: false, errorCode: 'INVALID_URL', message: 'Please provide a valid Figma design URL.' };
  }
  if (token !== undefined && token !== null && typeof token !== 'string') {
    return { ok: false, errorCode: 'INVALID_TOKEN', message: 'token must be a string when provided.' };
  }
  if (token && token.length > 512) {
    return { ok: false, errorCode: 'INVALID_TOKEN', message: 'token is too long.' };
  }
  if (refresh !== undefined && refresh !== null
    && refresh !== true && refresh !== false && refresh !== '1' && refresh !== 1 && refresh !== '0' && refresh !== 0) {
    return { ok: false, errorCode: 'INVALID_REFRESH', message: 'refresh must be boolean or 0/1.' };
  }
  if (force !== undefined && force !== null
    && force !== true && force !== false && force !== '1' && force !== 1) {
    return { ok: false, errorCode: 'INVALID_FORCE', message: 'force must be boolean or 1.' };
  }
  if (body.emitMode !== undefined && body.emitMode !== null) {
    const m = String(body.emitMode).toLowerCase().trim();
    if (m !== '' && m !== 'auto' && m !== 'pixel' && m !== 'standard'
      && m !== 'preview' && m !== 'pixel-preview' && m !== 'production' && m !== 'layout-standard') {
      return {
        ok: false,
        errorCode: 'INVALID_EMIT_MODE',
        message: 'emitMode must be "auto", "pixel", or "standard".',
      };
    }
  }
  if (body.renderer !== undefined && body.renderer !== null) {
    const r = String(body.renderer).toLowerCase().trim();
    if (r !== '' && r !== 'legacy' && r !== 'ir-experimental') {
      return {
        ok: false,
        errorCode: 'INVALID_RENDERER',
        message: 'renderer must be "legacy" or "ir-experimental".',
      };
    }
  }

  const m = String(url).match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9_-]+)/);
  const fileKey = m ? m[1] : null;
  if (!fileKey || !/^[A-Za-z0-9_-]{10,128}$/.test(fileKey)) {
    return { ok: false, errorCode: 'INVALID_FILE_KEY', message: 'Could not parse a valid Figma file key from the URL.' };
  }
  let nodeId = null;
  const nm = String(url).match(/[?&]node-id=([^&]+)/);
  if (nm) {
    try {
      nodeId = decodeURIComponent(nm[1]).replace(/-/g, ':');
    } catch {
      return { ok: false, errorCode: 'INVALID_NODE_ID', message: 'Invalid node-id in URL.' };
    }
    if (!isValidNodeId(nodeId)) {
      return { ok: false, errorCode: 'INVALID_NODE_ID', message: 'Invalid node-id in URL.' };
    }
  }

  return { ok: true, fileKey, nodeId };
}

/** Prevent path traversal in slug/output names. */
function safeSlug(name, fallback = 'figma-design') {
  const s = String(name || fallback)
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
  if (!s || s.includes('..')) return fallback;
  return s;
}

module.exports = {
  isValidHttpUrl,
  isValidFigmaUrl,
  isValidFileKey,
  isValidNodeId,
  validateFigmaConvertBody,
  safeSlug,
};
