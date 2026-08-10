'use strict';

/**
 * Freeze an enforceable PolicyProfile for Kernel / Decision Runtime consumption.
 * Serialization is JSON-stable (no functions).
 */

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
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

/**
 * Normalize resolved raw object into enforceable bound profile.
 */
function toEnforceable(resolved) {
  const thresholds = resolved.thresholds ? { ...resolved.thresholds } : {};
  const budgets = resolved.budgets ? { ...resolved.budgets } : null;
  const flags = resolved.flags ? { ...resolved.flags } : {};

  const profile = {
    contractId: 'PolicyProfile',
    suiteVersion: resolved.suiteVersion || null,
    profileId: resolved.profileId,
    profileVersion: resolved.profileVersion ?? null,
    description: resolved.description ?? null,
    thresholds,
    budgets,
    allowedEngineIds: Array.isArray(resolved.allowedEngineIds)
      ? [...resolved.allowedEngineIds]
      : [],
    allowedPackIds: Array.isArray(resolved.allowedPackIds)
      ? [...resolved.allowedPackIds]
      : [],
    valuesAuthoritative: resolved.valuesAuthoritative === true,
    gateMode: resolved.gateMode === 'best_effort' ? 'best_effort' : 'fail_closed',
    flags,
    resolvedFrom: Array.isArray(resolved.resolvedFrom)
      ? [...resolved.resolvedFrom]
      : [resolved.profileId],
  };

  return deepFreeze(clone(profile));
}

function serializeProfile(profile) {
  return JSON.stringify(clone(profile), null, 2);
}

function deserializeProfile(json) {
  if (typeof json === 'object' && json !== null) return clone(json);
  return JSON.parse(json);
}

module.exports = {
  toEnforceable,
  serializeProfile,
  deserializeProfile,
  clone,
  deepFreeze,
};
