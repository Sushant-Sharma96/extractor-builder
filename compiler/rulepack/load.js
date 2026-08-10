'use strict';

const fs = require('fs');
const path = require('path');
const { RulePackError, RulePackErrorKind } = require('./errors');
const { normalizeRulePack } = require('./validate');

/**
 * Load RulePack JSON from path or object.
 * Handlers are not loaded from JSON — supplied at register time (or via handlers module path in opts).
 */
function loadRulePack(source, opts = {}) {
  let raw;
  if (typeof source === 'string') {
    try {
      const text = fs.readFileSync(path.resolve(source), 'utf8');
      raw = JSON.parse(text);
    } catch (e) {
      throw new RulePackError(
        RulePackErrorKind.LOAD_FAILED,
        `failed to load rule pack: ${source}`,
        { cause: e.message }
      );
    }
  } else if (source && typeof source === 'object') {
    raw = JSON.parse(JSON.stringify(source));
  } else {
    throw new RulePackError(RulePackErrorKind.LOAD_FAILED, 'load source required');
  }

  return normalizeRulePack(raw, {
    expectedSuiteVersion: opts.expectedSuiteVersion,
  });
}

/**
 * Load pack JSON + optional handlers.js from a directory.
 * Returns raw pack object (not yet normalized) + handlers.
 */
function loadRulePackDirectory(dir, opts = {}) {
  const packPath = path.join(dir, 'pack.json');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.resolve(packPath), 'utf8'));
  } catch (e) {
    throw new RulePackError(
      RulePackErrorKind.LOAD_FAILED,
      `failed to load rule pack directory: ${dir}`,
      { cause: e.message }
    );
  }
  // Validate early so callers get clear errors
  normalizeRulePack(raw, { expectedSuiteVersion: opts.expectedSuiteVersion });
  let handlers = {};
  const handlersPath = path.join(dir, 'handlers.js');
  if (fs.existsSync(handlersPath)) {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    handlers = require(handlersPath);
  }
  return { pack: raw, handlers };
}

module.exports = { loadRulePack, loadRulePackDirectory };
