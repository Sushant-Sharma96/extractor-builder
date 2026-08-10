'use strict';

/**
 * Shared reader for Phase 1 IR stage registry (contracts/registries/ir-stages.json).
 * Single definition source — no duplicated stage lists.
 */
const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '..', 'contracts', 'registries', 'ir-stages.json');

let cached = null;

function loadIrStageRegistry() {
  if (!cached) {
    cached = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  }
  return cached;
}

function listIrStageIds() {
  return (loadIrStageRegistry().stages || []).map((s) => s.stageId);
}

function isKnownIrStage(stageId) {
  return listIrStageIds().includes(stageId);
}

/** Test helper — clear cache if registry file changes mid-process. */
function _resetIrStageRegistryCacheForTests() {
  cached = null;
}

module.exports = {
  loadIrStageRegistry,
  listIrStageIds,
  isKnownIrStage,
  _resetIrStageRegistryCacheForTests,
  REGISTRY_PATH,
};
