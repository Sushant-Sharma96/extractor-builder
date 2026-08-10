'use strict';
/**
 * Structured logging with levels + secret masking.
 */

const crypto = require('crypto');
const { getConfig } = require('../config');

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

function newRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

const SECRET_KEYS = /^(token|authorization|password|secret|api[_-]?key|figma[_-]?token|client[_-]?secret|access[_-]?token|refresh[_-]?token)$/i;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._\-]+/gi;
const FIGD_RE = /figd_[A-Za-z0-9_\-]+/g;

function maskString(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(BEARER_RE, '$1***')
    .replace(FIGD_RE, 'figd_***');
}

function redactValue(key, value) {
  if (SECRET_KEYS.test(String(key || ''))) return '***';
  if (typeof value === 'string') return maskString(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return redactFields(value);
  }
  if (Array.isArray(value)) return value.map((v, i) => redactValue(String(i), v));
  return value;
}

function redactFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactValue(k, v);
  }
  return out;
}

function shouldLog(level) {
  const cfgLevel = (getConfig().logLevel || 'INFO').toUpperCase();
  return (LEVELS[level] || 20) >= (LEVELS[cfgLevel] || 20);
}

/**
 * @param {string} level DEBUG|INFO|WARN|ERROR
 * @param {string} event
 * @param {object} fields
 */
function logAt(level, event, fields = {}) {
  const lv = String(level || 'INFO').toUpperCase();
  if (!shouldLog(lv)) return;
  const safe = redactFields(fields);
  const line = {
    ts: new Date().toISOString(),
    level: lv,
    component: 'figma-convert',
    event,
    ...safe,
  };
  try {
    const text = JSON.stringify(line);
    if (lv === 'ERROR') console.error(text);
    else if (lv === 'WARN') console.warn(text);
    else console.log(text);
  } catch {
    console.log(`[figma-convert] ${lv} ${event}`);
  }
}

function logConvert(event, fields = {}) {
  logAt('INFO', event, fields);
}

function logDebug(event, fields) { logAt('DEBUG', event, fields); }
function logInfo(event, fields) { logAt('INFO', event, fields); }
function logWarn(event, fields) { logAt('WARN', event, fields); }
function logError(event, fields) { logAt('ERROR', event, fields); }

module.exports = {
  newRequestId,
  logConvert,
  logAt,
  logDebug,
  logInfo,
  logWarn,
  logError,
  redactFields,
  maskString,
  LEVELS,
};
