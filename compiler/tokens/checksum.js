'use strict';

const crypto = require('crypto');

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

function tokenIrChecksum(payload) {
  return crypto.createHash('sha256').update(canonicalStringify(payload), 'utf8').digest('hex');
}

module.exports = { canonicalStringify, tokenIrChecksum };
