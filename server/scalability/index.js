'use strict';
/**
 * Scalability shell — convert orchestration around frozen compile().
 * Budget Manager gates Executor (Deny/Queue skip REST).
 */

const planner = require('./planner');
const budget = require('./budget');
const cacheResolver = require('./cache-resolver');
const executor = require('./executor');
const { logConvert } = require('./request-log');

/**
 * @param {{
 *   fileKey: string,
 *   nodeId: string|null,
 *   auth: object,
 *   refresh: boolean,
 *   restCounter: { n: number },
 *   t0: number,
 *   userKey?: string,
 *   force?: boolean,
 *   requestId?: string
 * }} opts
 */
async function prepareFigmaSources(opts) {
  const {
    fileKey,
    nodeId,
    auth,
    refresh,
    restCounter,
    t0,
    userKey = 'local',
    force = false,
    requestId = null,
  } = opts;

  const executorSteps = [];
  const resolved = cacheResolver.resolve({ fileKey, nodeId, refresh });
  executorSteps.push(`resolve:${resolved.cacheStatus}`);

  const plan = planner.plan({
    refresh,
    cacheHit: resolved.hit,
    cachePath: resolved.cachePath,
    nodeId,
  });
  executorSteps.push(`plan:${plan.action}:${plan.coveringStrategy || 'none'}`);

  let authz = budget.authorize({
    plan,
    cacheStatus: resolved.cacheStatus,
    cachePath: resolved.cachePath,
    fileKey,
    userKey,
    refresh,
  });
  executorSteps.push(`budget:${authz.outcome}`);

  // force=true overrides Deny including rate_limit_lock (demo / explicit user Force refresh).
  // Figma may still 429 — caller must handle that; we do not silently skip REST forever.
  if (force && authz.outcome === 'Deny') {
    authz = {
      ...authz,
      outcome: 'Warn',
      reason: 'force_override_' + authz.reason,
      warnings: [...(authz.warnings || []), 'Budget Deny overridden by force=true.'],
    };
    executorSteps.push('budget:force_override_deny');
  }
  if (force && authz.outcome === 'Queue') {
    authz = {
      ...authz,
      outcome: 'Warn',
      reason: 'force_override_queue',
      warnings: [...(authz.warnings || []), 'Budget Queue overridden by force=true.'],
    };
    executorSteps.push('budget:force_override_queue');
  }

  logConvert('prepare', {
    requestId,
    fileKey,
    nodeId,
    cacheStrategy: plan.cacheStrategy,
    cacheStatus: resolved.cacheStatus,
    plannerDecision: plan.reason,
    coveringStrategy: plan.coveringStrategy,
    budgetDecision: authz.outcome,
    predictedTier1: authz.predictedTier1,
    predictedTier2: authz.predictedTier2,
    refresh: !!refresh,
  });

  if (authz.outcome === 'Deny' || authz.outcome === 'Queue') {
    logConvert('budget_blocked', {
      requestId,
      fileKey,
      nodeId,
      budgetDecision: authz.outcome,
      reason: authz.reason,
      restCalls: 0,
      executorSteps,
    });
    return {
      denied: true,
      budgetBlocked: true,
      document: null,
      name: null,
      imageFillUrls: {},
      imageUrls: {},
      svgFallback: {},
      localByUrl: null,
      analyzed: null,
      fetchedMeta: null,
      cacheStatus: resolved.cacheStatus,
      cacheReason: resolved.cacheReason,
      plan,
      authz,
      executorSteps,
    };
  }

  if (plan.action === 'offline_compile' && resolved.hit) {
    executorSteps.push('offline:fromSnapshot');
    logConvert('cache_hit', {
      requestId,
      fileKey,
      nodeId,
      cacheStatus: resolved.cacheStatus,
      cacheStrategy: plan.cacheStrategy,
      plannerDecision: plan.reason,
      budgetDecision: authz.outcome,
      restCalls: 0,
      prepareMs: Date.now() - t0,
      executorSteps,
    });
    return {
      ...executor.fromSnapshot(resolved.snap),
      cacheStatus: resolved.cacheStatus,
      cacheReason: resolved.cacheReason,
      plan,
      authz,
      denied: false,
      executorSteps,
    };
  }

  logConvert('cache_miss_start', {
    requestId,
    fileKey,
    nodeId,
    cacheReason: resolved.cacheReason,
    coveringStrategy: plan.coveringStrategy,
    budgetDecision: authz.outcome,
  });
  executorSteps.push('executeMiss:start');
  const sources = await executor.executeMiss({
    plan,
    fileKey,
    nodeId,
    auth,
    restCounter,
    t0,
  });
  executorSteps.push('executeMiss:done');

  const split = budget.splitRestCalls(restCounter.n);
  budget.recordUsage({
    userKey,
    fileKey,
    t1: split.t1,
    t2: split.t2,
  });

  logConvert('cache_miss_done', {
    requestId,
    fileKey,
    nodeId,
    cacheStrategy: (sources.plan || plan).cacheStrategy,
    coveringStrategy: (sources.plan || plan).coveringStrategy,
    plannerDecision: (sources.plan || plan).reason,
    budgetDecision: authz.outcome,
    restCalls: restCounter.n,
    prepareMs: Date.now() - t0,
    executorSteps,
  });

  return {
    ...sources,
    cacheStatus: 'MISS',
    cacheReason: resolved.cacheReason,
    plan: sources.plan || plan,
    authz,
    denied: false,
    executorSteps,
  };
}

module.exports = {
  prepareFigmaSources,
  planner,
  budget,
  cacheResolver,
  executor,
  covering: require('./covering'),
};
