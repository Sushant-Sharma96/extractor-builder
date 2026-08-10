'use strict';

const { FailureKind, KernelError } = require('./failures');

/**
 * Budget tracker — slots from PolicyProfile.budgets.
 * Phase 2: record usage and detect exceed.
 */
function createBudgetTracker(budgets) {
  const limits = {
    maxTimeMs: budgets && budgets.maxTimeMs != null ? budgets.maxTimeMs : null,
    maxMemoryBytes: budgets && budgets.maxMemoryBytes != null ? budgets.maxMemoryBytes : null,
    maxAssetBytes: budgets && budgets.maxAssetBytes != null ? budgets.maxAssetBytes : null,
    maxDomNodes: budgets && budgets.maxDomNodes != null ? budgets.maxDomNodes : null,
  };

  const usage = {
    timeMs: 0,
    memoryBytes: 0,
    assetBytes: 0,
    domNodes: 0,
  };

  function snapshot() {
    return { limits: { ...limits }, usage: { ...usage } };
  }

  function record(partial) {
    if (!partial) return snapshot();
    if (partial.timeMs != null) usage.timeMs = partial.timeMs;
    if (partial.memoryBytes != null) usage.memoryBytes = partial.memoryBytes;
    if (partial.assetBytes != null) usage.assetBytes = partial.assetBytes;
    if (partial.domNodes != null) usage.domNodes = partial.domNodes;
    return snapshot();
  }

  function check() {
    const breaches = [];
    if (limits.maxTimeMs != null && usage.timeMs > limits.maxTimeMs) {
      breaches.push({ dimension: 'maxTimeMs', limit: limits.maxTimeMs, usage: usage.timeMs });
    }
    if (limits.maxMemoryBytes != null && usage.memoryBytes > limits.maxMemoryBytes) {
      breaches.push({ dimension: 'maxMemoryBytes', limit: limits.maxMemoryBytes, usage: usage.memoryBytes });
    }
    if (limits.maxAssetBytes != null && usage.assetBytes > limits.maxAssetBytes) {
      breaches.push({ dimension: 'maxAssetBytes', limit: limits.maxAssetBytes, usage: usage.assetBytes });
    }
    if (limits.maxDomNodes != null && usage.domNodes > limits.maxDomNodes) {
      breaches.push({ dimension: 'maxDomNodes', limit: limits.maxDomNodes, usage: usage.domNodes });
    }
    if (breaches.length) {
      throw new KernelError(FailureKind.BUDGET_EXCEEDED, 'budget exceeded', { breaches });
    }
    return snapshot();
  }

  return { record, check, snapshot };
}

module.exports = { createBudgetTracker };
