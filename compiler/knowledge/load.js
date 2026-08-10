'use strict';

const fs = require('fs');
const path = require('path');
const { KnowledgeError, KnowledgeErrorKind } = require('./errors');
const { clone, computeChecksum, deepFreeze } = require('./checksum');
const { validateBundle } = require('./validate');

/**
 * Load a KnowledgeBundle from object or JSON file path.
 * Does not execute matchers or write Workspace.
 */
function loadBundle(source, opts = {}) {
  let raw;
  if (typeof source === 'string') {
    try {
      const text = fs.readFileSync(path.resolve(source), 'utf8');
      raw = JSON.parse(text);
    } catch (e) {
      throw new KnowledgeError(
        KnowledgeErrorKind.LOAD_FAILED,
        `failed to load bundle: ${source}`,
        { cause: e.message }
      );
    }
  } else if (source && typeof source === 'object') {
    raw = clone(source);
  } else {
    throw new KnowledgeError(KnowledgeErrorKind.LOAD_FAILED, 'load source required');
  }

  validateBundle(raw, {
    expectedSuiteVersion: opts.expectedSuiteVersion,
    verifyChecksum: opts.verifyChecksum,
  });

  if (!raw.checksum) {
    raw.checksum = computeChecksum(raw);
  } else if (opts.verifyChecksum !== false) {
    // already verified in validateBundle
  }

  return deepFreeze(raw);
}

function sealWithChecksum(bundle) {
  const copy = clone(bundle);
  delete copy.checksum;
  copy.checksum = computeChecksum(copy);
  return deepFreeze(copy);
}

module.exports = { loadBundle, sealWithChecksum };
