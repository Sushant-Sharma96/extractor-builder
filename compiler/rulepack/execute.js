'use strict';

const { RulePackError, RulePackErrorKind } = require('./errors');
const { createRuleContext } = require('./context');
const { createPluginContext } = require('../plugin/context');
const { StoreKind } = require('./constants');

/**
 * Persist collected rule outputs through plugin staged writes, then commit.
 */
function persistRuleOutputs(pluginCtx, snapshot, suiteVersion) {
  for (const ev of snapshot.evidence) {
    pluginCtx.putEvidence({
      evidenceId: ev.evidenceId,
      kind: ev.kind,
      ref: ev.ref,
      detail: ev.detail,
    });
  }
  for (const hyp of snapshot.hypotheses) {
    pluginCtx.putHypothesis({
      contractId: 'Hypothesis',
      suiteVersion: hyp.suiteVersion || suiteVersion || '1.0.0',
      hypothesisId: hyp.hypothesisId,
      question: hyp.question,
      subject: hyp.subject,
      candidates: hyp.candidates,
      evidence: hyp.evidence.length
        ? hyp.evidence
        : snapshot.evidence
          .filter((e) => e.ruleId === hyp.ruleId)
          .map((e) => ({ evidenceId: e.evidenceId, kind: e.kind, ref: e.ref })),
      localScores: hyp.localScores.length
        ? hyp.localScores
        : hyp.candidates
          .filter((c) => c.localScore != null)
          .map((c) => ({ candidateId: c.candidateId, value: c.localScore })),
    });
  }
  return pluginCtx.commit();
}

/**
 * Execute a normalized RulePack with registered rule handlers.
 *
 * @param {object} pack — normalized pack
 * @param {object} handlers — { [ruleId]: (ruleCtx, ruleMeta) => void|Promise }
 * @param {object} env — { workspace, policy, knowledge, fingerprint, config, clock }
 */
async function executeRulePack(pack, handlers, env = {}) {
  if (!pack || !pack.plugin) {
    throw new RulePackError(RulePackErrorKind.INVALID_PACK, 'normalized pack required');
  }
  if (!env.workspace) {
    throw new RulePackError(RulePackErrorKind.EXECUTION, 'workspace required');
  }

  const startedAt = (env.clock || Date.now)();
  const pluginCtx = createPluginContext({
    workspace: env.workspace,
    declaration: pack.plugin,
    policy: env.policy,
    knowledge: env.knowledge || null,
  });

  const ruleCtx = createRuleContext(pluginCtx, {
    policy: env.policy,
    fingerprint: env.fingerprint,
    config: env.config,
    pack,
    clock: env.clock || (() => Date.now()),
  });

  const ruleResults = [];

  try {
    for (const rule of pack.rules) {
      const handler = handlers && handlers[rule.ruleId];
      if (typeof handler !== 'function') {
        ruleCtx.warn(`no handler for rule ${rule.ruleId}`);
        ruleResults.push({ ruleId: rule.ruleId, status: 'skipped', reason: 'no_handler' });
        continue;
      }
      const ruleStart = ruleCtx.now();
      try {
        await Promise.resolve(handler(ruleCtx, rule));
        ruleResults.push({
          ruleId: rule.ruleId,
          status: 'ok',
          ms: ruleCtx.now() - ruleStart,
        });
      } catch (err) {
        if (err instanceof RulePackError && err.kind === RulePackErrorKind.FORBIDDEN) {
          pluginCtx.rollback();
          pluginCtx.dispose();
          throw err;
        }
        ruleCtx.warn(`rule ${rule.ruleId} failed: ${err.message}`);
        ruleResults.push({
          ruleId: rule.ruleId,
          status: 'error',
          message: err.message,
          ms: ruleCtx.now() - ruleStart,
        });
        // continue other rules unless failFast
        if (env.failFast) {
          pluginCtx.rollback();
          pluginCtx.dispose();
          throw new RulePackError(
            RulePackErrorKind.EXECUTION,
            `rule failed: ${rule.ruleId}`,
            { cause: err.message }
          );
        }
      }
    }

    const snapshot = ruleCtx._snapshot();
    ruleCtx._close();
    persistRuleOutputs(pluginCtx, snapshot, pack.suiteVersion);
    pluginCtx.dispose();

    const endedAt = (env.clock || Date.now)();
    return {
      packId: pack.packId,
      version: pack.version,
      evidence: snapshot.evidence,
      hypotheses: snapshot.hypotheses,
      candidates: snapshot.candidates,
      diagnostics: snapshot.diagnostics,
      executionTrace: snapshot.executionTrace,
      ruleResults,
      timing: {
        startedAt,
        endedAt,
        ms: endedAt - startedAt,
      },
    };
  } catch (err) {
    try {
      pluginCtx.rollback();
      pluginCtx.dispose();
    } catch (_) { /* ignore */ }
    throw err;
  }
}

module.exports = { executeRulePack, persistRuleOutputs };
