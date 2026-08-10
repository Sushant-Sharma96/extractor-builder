'use strict';

/**
 * Deep-ish merge for PolicyProfile layers (child overrides parent).
 * Arrays replace; objects merge; scalars replace.
 */
function mergeLayer(parent, child) {
  const out = { ...parent, ...child };
  if (parent.thresholds || child.thresholds) {
    out.thresholds = { ...(parent.thresholds || {}), ...(child.thresholds || {}) };
  }
  if (parent.budgets || child.budgets) {
    out.budgets = { ...(parent.budgets || {}), ...(child.budgets || {}) };
  }
  if (parent.flags || child.flags) {
    out.flags = { ...(parent.flags || {}), ...(child.flags || {}) };
  }
  if (child.allowedEngineIds != null) {
    out.allowedEngineIds = [...child.allowedEngineIds];
  } else if (parent.allowedEngineIds) {
    out.allowedEngineIds = [...parent.allowedEngineIds];
  }
  if (child.allowedPackIds != null) {
    out.allowedPackIds = [...child.allowedPackIds];
  } else if (parent.allowedPackIds) {
    out.allowedPackIds = [...parent.allowedPackIds];
  }
  return out;
}

/**
 * Resolve inheritance chain. `lookup(id)` returns raw profile or null.
 * Does not execute logic — structural merge only.
 */
function resolveInheritance(profile, lookup, opts = {}) {
  const { PolicyError, PolicyErrorKind } = require('./errors');
  const maxDepth = opts.maxDepth || 8;
  const chain = [];
  let current = profile;
  const seen = new Set();

  while (current && current.extends) {
    const parentId = current.extends;
    if (seen.has(parentId)) {
      throw new PolicyError(
        PolicyErrorKind.INHERITANCE,
        `circular profile inheritance involving ${parentId}`,
        { profileId: profile.profileId, parentId }
      );
    }
    seen.add(parentId);
    if (chain.length >= maxDepth) {
      throw new PolicyError(
        PolicyErrorKind.INHERITANCE,
        `inheritance depth exceeded (${maxDepth})`,
        { profileId: profile.profileId }
      );
    }
    const parent = lookup(parentId);
    if (!parent) {
      throw new PolicyError(
        PolicyErrorKind.INHERITANCE,
        `extends unknown profile: ${parentId}`,
        { profileId: profile.profileId, extends: parentId }
      );
    }
    chain.unshift(parent);
    current = parent;
  }

  let merged = {};
  for (const layer of chain) {
    merged = mergeLayer(merged, layer);
  }
  merged = mergeLayer(merged, profile);
  // Resolved profile identity stays on the leaf
  merged.profileId = profile.profileId;
  merged.profileVersion = profile.profileVersion ?? merged.profileVersion;
  delete merged.extends;
  merged.resolvedFrom = chain.map((p) => p.profileId).concat([profile.profileId]);
  return merged;
}

module.exports = { mergeLayer, resolveInheritance };
