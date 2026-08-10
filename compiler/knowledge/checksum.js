'use strict';

const crypto = require('crypto');

const ENTRY_KINDS = Object.freeze([
  'pattern', 'motif', 'obligation', 'emit_hint', 'negative_pattern', 'prior', 'feature_def',
]);

const RELATION_TYPES = Object.freeze([
  'specializes', 'contains', 'requires', 'conflicts', 'suggests',
]);

const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** Deterministic JSON for checksums — sorted keys recursively. */
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
}

/**
 * Compute checksum excluding the checksum field itself.
 */
function computeChecksum(bundle) {
  const copy = { ...bundle };
  delete copy.checksum;
  const payload = canonicalStringify(copy);
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return obj;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = {
  ENTRY_KINDS,
  RELATION_TYPES,
  SEMVER_RE,
  canonicalStringify,
  computeChecksum,
  deepFreeze,
  clone,
};
