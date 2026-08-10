'use strict';
/**
 * Budget Manager — evaluate only; never calls Figma.
 * Single authority for Allow | Warn | Queue | Degrade | Deny before Executor.
 */

const {
  loadState,
  updateState,
  getBucket,
  sessionCounters,
  monthKey,
} = require('./budget-state');

/** Soft advisory limits (not Figma-authoritative). */
const SOFT_LIMITS = {
  starter: { t1Month: 6, t2Minute: 5, t1Minute: 6 },
  student: { t1Month: 6, t2Minute: 5, t1Minute: 6 },
  pro: { t1Month: 10000, t2Minute: 25, t1Minute: 8 },
  org: { t1Month: 20000, t2Minute: 50, t1Minute: 12 },
  enterprise: { t1Month: 50000, t2Minute: 100, t1Minute: 16 },
  unknown: { t1Month: 6, t2Minute: 5, t1Minute: 6 },
};

/**
 * Soft monthly caps are advisory by default in local/dev.
 * Set FIGMA_BUDGET_ENFORCE_SOFT=1 (or run NODE_ENV=production) to hard-Deny.
 */
function enforceSoftMonthly() {
  if (process.env.FIGMA_BUDGET_ENFORCE_SOFT !== undefined
    && process.env.FIGMA_BUDGET_ENFORCE_SOFT !== '') {
    return /^(1|true|yes|on)$/i.test(String(process.env.FIGMA_BUDGET_ENFORCE_SOFT));
  }
  return process.env.NODE_ENV === 'production';
}

function softLimitsFor(planTier) {
  const key = String(planTier || 'unknown').toLowerCase();
  return SOFT_LIMITS[key] || SOFT_LIMITS.unknown;
}

function lockKey(userKey, fileKey) {
  // Prefer user-scoped lock; also check global from last 429.
  return {
    user: `user:${userKey || 'local'}`,
    file: fileKey ? `file:${fileKey}` : null,
    global: 'global',
  };
}

function readActiveLock(state, userKey, fileKey) {
  const now = Date.now();
  const keys = lockKey(userKey, fileKey);
  const candidates = [keys.global, keys.user, keys.file].filter(Boolean);
  let best = null;
  for (const k of candidates) {
    const lock = state.locks[k];
    if (!lock || !lock.retryAfterUntil) continue;
    if (lock.retryAfterUntil > now) {
      if (!best || lock.retryAfterUntil > best.retryAfterUntil) {
        best = { ...lock, lockScope: k };
      }
    }
  }
  return best;
}

/**
 * Prefer Planner.prediction when present; else conservative fallbacks.
 */
function predictCost({ plan, cacheStatus, refresh }) {
  if (
    plan
    && plan.action === 'offline_compile'
    && (cacheStatus === 'HIT' || cacheStatus === 'SUBTREE')
  ) {
    return {
      predictedTier1: 0,
      predictedTier2: 0,
      predictionReason: cacheStatus === 'SUBTREE' ? 'subtree_hit' : 'exact_hit',
    };
  }

  if (plan && plan.prediction && typeof plan.prediction.t1 === 'number') {
    return {
      predictedTier1: plan.prediction.t1,
      predictedTier2: plan.prediction.t2 || 0,
      predictionReason: plan.reason || plan.predictionReason || 'planner_prediction',
    };
  }

  if (plan && plan.estimate && plan.estimate.t1 === 0 && plan.estimate.t2 === 0) {
    return {
      predictedTier1: 0,
      predictedTier2: 0,
      predictionReason: 'planner_zero',
    };
  }

  if (refresh) {
    return {
      predictedTier1: 4,
      predictedTier2: 1,
      predictionReason: 'refresh_full_miss',
    };
  }

  return {
    predictedTier1: 4,
    predictedTier2: 1,
    predictionReason: 'covering_miss',
  };
}

function remainingEstimate(state, userKey, fileKey, planTier) {
  const limits = softLimitsFor(planTier || state.lastPlanTier);
  const user = getBucket(state.counters.users, userKey || 'local');
  const file = fileKey ? getBucket(state.counters.files, fileKey) : null;
  const workspace = getBucket(state.counters.workspaces, 'default');

  // Advisory remaining: tightest of user monthly vs soft limit (file counters informational).
  const usedMonthT1 = Math.max(user.t1, workspace.t1, file ? file.t1 : 0);
  const usedMinuteT1 = Math.max(user.minuteT1, workspace.minuteT1);

  return {
    planTier: planTier || state.lastPlanTier || 'unknown',
    t1MonthRemaining: Math.max(0, limits.t1Month - usedMonthT1),
    t1MinuteRemaining: Math.max(0, limits.t1Minute - usedMinuteT1),
    t2MinuteRemaining: Math.max(0, limits.t2Minute - Math.max(user.minuteT2, workspace.minuteT2)),
    used: {
      user: { t1: user.t1, t2: user.t2, minuteT1: user.minuteT1 },
      file: file ? { t1: file.t1, t2: file.t2 } : null,
      workspace: { t1: workspace.t1, t2: workspace.t2 },
      session: { t1: sessionCounters.t1, t2: sessionCounters.t2 },
    },
    limits,
  };
}

function buildDecision(partial) {
  return {
    outcome: partial.outcome || 'Allow',
    reason: partial.reason || 'ok',
    predictedTier1: partial.predictedTier1 ?? 0,
    predictedTier2: partial.predictedTier2 ?? 0,
    remainingEstimate: partial.remainingEstimate ?? null,
    retryAfterUntil: partial.retryAfterUntil ?? null,
    warnings: partial.warnings || [],
    degrade: partial.degrade || null,
    predictionReason: partial.predictionReason || null,
    planTier: partial.planTier || null,
  };
}

/**
 * Evaluate whether Executor may run. Never performs network I/O.
 *
 * @param {{
 *   plan: object,
 *   cacheStatus: string,
 *   cachePath?: string,
 *   fileKey?: string,
 *   userKey?: string,
 *   workspaceKey?: string,
 *   refresh?: boolean,
 *   planTierHint?: string|null
 * }} input
 */
function authorize(input) {
  const {
    plan,
    cacheStatus,
    fileKey,
    userKey = 'local',
    refresh = false,
    planTierHint = null,
  } = input || {};

  const state = loadState();
  const planTier = planTierHint || state.lastPlanTier || 'unknown';
  const pred = predictCost({ plan, cacheStatus, refresh });
  const remaining = remainingEstimate(state, userKey, fileKey, planTier);

  // Cache HIT / Subtree — always Allow (0 REST); lock only blocks network paths.
  if (pred.predictedTier1 === 0 && pred.predictedTier2 === 0) {
    return buildDecision({
      outcome: 'Allow',
      reason: pred.predictionReason || 'zero_cost',
      predictedTier1: 0,
      predictedTier2: 0,
      remainingEstimate: remaining,
      predictionReason: pred.predictionReason,
      planTier,
      warnings: readActiveLock(state, userKey, fileKey)
        ? ['Rate-limit lock is active but this request is offline (0 REST) — allowed.']
        : [],
    });
  }

  // Authoritative lock from prior 429 — block REST before Executor
  const lock = readActiveLock(state, userKey, fileKey);
  if (lock) {
    return buildDecision({
      outcome: 'Deny',
      reason: 'rate_limit_lock_active',
      predictedTier1: pred.predictedTier1,
      predictedTier2: pred.predictedTier2,
      remainingEstimate: remaining,
      retryAfterUntil: lock.retryAfterUntil,
      warnings: [
        `Figma rate limit lock active until ${new Date(lock.retryAfterUntil).toISOString()} (plan: ${lock.planTier || planTier}).`,
      ],
      predictionReason: pred.predictionReason,
      planTier: lock.planTier || planTier,
    });
  }

  // 3) Insufficient advisory monthly budget
  if (remaining.t1MonthRemaining < pred.predictedTier1) {
    const msg = `Estimated Tier-1 cost (${pred.predictedTier1}) exceeds advisory remaining (${remaining.t1MonthRemaining}) for plan soft-limit ${remaining.limits.t1Month}/month.`;
    if (enforceSoftMonthly()) {
      return buildDecision({
        outcome: 'Deny',
        reason: 'insufficient_estimated_tier1',
        predictedTier1: pred.predictedTier1,
        predictedTier2: pred.predictedTier2,
        remainingEstimate: remaining,
        warnings: [msg],
        predictionReason: pred.predictionReason,
        planTier,
        degrade: {
          preferCache: true,
          skipPng: true,
          skipSvg: true,
          queueRequest: false,
        },
      });
    }
    // Local/dev: warn + prefer cache, but do not hard-block converts
    return buildDecision({
      outcome: 'Warn',
      reason: 'insufficient_estimated_tier1_advisory',
      predictedTier1: pred.predictedTier1,
      predictedTier2: pred.predictedTier2,
      remainingEstimate: remaining,
      warnings: [
        msg,
        'Soft limit not enforced (dev). Prefer cached snapshots; avoid Force refresh. Set FIGMA_BUDGET_ENFORCE_SOFT=1 to hard-block.',
      ],
      predictionReason: pred.predictionReason,
      planTier,
      degrade: {
        preferCache: true,
        skipPng: false,
        skipSvg: false,
        queueRequest: false,
      },
    });
  }

  // 4) Per-minute soft cap → Queue (short wait)
  if (remaining.t1MinuteRemaining < pred.predictedTier1) {
    const retryAfterUntil = Date.now() + 60 * 1000;
    return buildDecision({
      outcome: 'Queue',
      reason: 'per_minute_soft_cap',
      predictedTier1: pred.predictedTier1,
      predictedTier2: pred.predictedTier2,
      remainingEstimate: remaining,
      retryAfterUntil,
      warnings: [
        `Advisory per-minute Tier-1 headroom too low (${remaining.t1MinuteRemaining} < ${pred.predictedTier1}). Retry after ~60s.`,
      ],
      predictionReason: pred.predictionReason,
      planTier,
      degrade: {
        preferCache: true,
        skipPng: true,
        skipSvg: false,
        queueRequest: true,
      },
    });
  }

  // 5) Low remaining → Degrade recommendations (Executor ignores for now)
  if (remaining.t1MonthRemaining <= pred.predictedTier1 + 1) {
    return buildDecision({
      outcome: 'Degrade',
      reason: 'low_tier1_remaining',
      predictedTier1: pred.predictedTier1,
      predictedTier2: pred.predictedTier2,
      remainingEstimate: remaining,
      warnings: [
        'Advisory Tier-1 budget nearly exhausted. Prefer cache; skip PNG/SVG exports recommended (not enforced yet).',
      ],
      predictionReason: pred.predictionReason,
      planTier,
      degrade: {
        preferCache: true,
        skipPng: true,
        skipSvg: true,
        queueRequest: false,
      },
    });
  }

  // 6) Warn when half of soft monthly budget used after this call
  const warnings = [];
  if (remaining.t1MonthRemaining <= Math.ceil(remaining.limits.t1Month / 2)) {
    warnings.push(
      `Advisory Tier-1 remaining this month ≈ ${remaining.t1MonthRemaining} (soft limit ${remaining.limits.t1Month}).`
    );
  }

  if (warnings.length) {
    return buildDecision({
      outcome: 'Warn',
      reason: 'approaching_soft_limit',
      predictedTier1: pred.predictedTier1,
      predictedTier2: pred.predictedTier2,
      remainingEstimate: remaining,
      warnings,
      predictionReason: pred.predictionReason,
      planTier,
    });
  }

  return buildDecision({
    outcome: 'Allow',
    reason: 'within_soft_budget',
    predictedTier1: pred.predictedTier1,
    predictedTier2: pred.predictedTier2,
    remainingEstimate: remaining,
    predictionReason: pred.predictionReason,
    planTier,
  });
}

/**
 * Persist 429 lock. Called from convert error path — still no Figma call here.
 */
function recordRateLimit({
  retryAfterSec,
  planTier,
  upgradeLink,
  userKey = 'local',
  fileKey = null,
} = {}) {
  const sec = Math.max(1, Number(retryAfterSec) || 60);
  const retryAfterUntil = Date.now() + sec * 1000;
  let lockOut = null;
  updateState((state) => {
    const lock = {
      retryAfterUntil,
      planTier: planTier || state.lastPlanTier || 'unknown',
      upgradeLink: upgradeLink || null,
      recordedAt: new Date().toISOString(),
      retryAfterSec: sec,
    };
    if (planTier) state.lastPlanTier = String(planTier).toLowerCase();
    state.locks.global = lock;
    state.locks[`user:${userKey || 'local'}`] = lock;
    if (fileKey) state.locks[`file:${fileKey}`] = { ...lock };
    lockOut = lock;
    return state;
  });
  return lockOut;
}

/**
 * Record successful REST usage (advisory). t1/t2 are estimates from convert.
 */
function recordUsage({
  userKey = 'local',
  fileKey = null,
  workspaceKey = 'default',
  t1 = 0,
  t2 = 0,
} = {}) {
  const add = (bucket, a, b) => {
    bucket.t1 += a;
    bucket.t2 += b;
    bucket.minuteT1 += a;
    bucket.minuteT2 += b;
  };
  updateState((state) => {
    add(getBucket(state.counters.users, userKey || 'local'), t1, t2);
    add(getBucket(state.counters.workspaces, workspaceKey || 'default'), t1, t2);
    if (fileKey) add(getBucket(state.counters.files, fileKey), t1, t2);
    return state;
  });
  sessionCounters.t1 += t1;
  sessionCounters.t2 += t2;
}

/** Shape for API response extension (stable contract). */
function toApiBudget(decision) {
  if (!decision) return null;
  const rem = decision.remainingEstimate;
  return {
    outcome: decision.outcome,
    reason: decision.reason,
    predictedTier1: decision.predictedTier1,
    predictedTier2: decision.predictedTier2,
    warnings: decision.warnings || [],
    retryAfter: decision.retryAfterUntil
      ? Math.max(0, Math.ceil((decision.retryAfterUntil - Date.now()) / 1000))
      : null,
    retryAfterUntil: decision.retryAfterUntil || null,
    estimatedRemaining: rem
      ? {
        t1Month: rem.t1MonthRemaining,
        t1Minute: rem.t1MinuteRemaining,
        t2Minute: rem.t2MinuteRemaining,
        planTier: rem.planTier,
      }
      : null,
    degrade: decision.degrade || null,
    predictionReason: decision.predictionReason || null,
  };
}

/** Split restCounter into advisory t1/t2 (fills usually 1× t2 when n>=2). */
function splitRestCalls(restCalls) {
  const n = Math.max(0, Number(restCalls) || 0);
  if (n <= 0) return { t1: 0, t2: 0 };
  if (n === 1) return { t1: 1, t2: 0 };
  // Conservative: one call attributed to Tier-2 (image fills), rest Tier-1
  return { t1: n - 1, t2: 1 };
}

module.exports = {
  authorize,
  predictCost,
  recordRateLimit,
  recordUsage,
  toApiBudget,
  splitRestCalls,
  softLimitsFor,
  readActiveLock,
  monthKey,
};
