'use strict';

const { RulePackError, RulePackErrorKind } = require('./errors');
const { StoreKind } = require('./constants');

/**
 * Restricted rule execution context.
 * Collects Evidence / Hypotheses / Candidates; never Decisions / Fact mutation / Knowledge mutation.
 *
 * @param {object} pluginCtx — Phase 6 scoped plugin context (for reads + staged writes on commit)
 * @param {object} opts — { policy, fingerprint, config, pack, clock }
 */
function createRuleContext(pluginCtx, opts = {}) {
  if (!pluginCtx) {
    throw new RulePackError(RulePackErrorKind.EXECUTION, 'plugin context required');
  }

  const evidence = [];
  const hypotheses = [];
  const candidates = [];
  const diagnostics = [];
  const traces = [];
  const policy = opts.policy ? Object.freeze({
    profileId: opts.policy.profileId,
    profileVersion: opts.policy.profileVersion ?? null,
    valuesAuthoritative: opts.policy.valuesAuthoritative === true,
    gateMode: opts.policy.gateMode || null,
    // thresholds readable but not owned
    thresholds: opts.policy.thresholds
      ? Object.freeze({ ...opts.policy.thresholds })
      : null,
  }) : Object.freeze({});
  const fingerprint = opts.fingerprint
    ? Object.freeze({ ...opts.fingerprint })
    : Object.freeze({});
  const config = opts.config ? Object.freeze({ ...opts.config }) : Object.freeze({});
  const clock = typeof opts.clock === 'function' ? opts.clock : () => Date.now();
  const pack = opts.pack || null;

  let closed = false;

  function assertOpen() {
    if (closed) {
      throw new RulePackError(RulePackErrorKind.EXECUTION, 'rule context closed');
    }
  }

  function deny(name) {
    throw new RulePackError(
      RulePackErrorKind.FORBIDDEN,
      `rule context forbids ${name}`
    );
  }

  const ctx = {
    packId: pack && pack.packId,
    packVersion: pack && pack.version,

    /** Read-only policy snapshot */
    policy,
    /** Read-only fingerprint snapshot */
    fingerprint,
    /** Pack/runtime configuration */
    config,
    /** Deterministic-friendly clock (injectable for tests) */
    now: () => clock(),

    log(message, detail) {
      assertOpen();
      diagnostics.push({
        level: 'info',
        message,
        detail: detail || null,
        at: clock(),
      });
      if (typeof pluginCtx.log === 'function') {
        pluginCtx.log(message, detail);
      }
    },

    warn(message, detail) {
      assertOpen();
      diagnostics.push({
        level: 'warn',
        message,
        detail: detail || null,
        at: clock(),
      });
    },

    // --- Workspace reads (via plugin capability) ---
    getFact(id) {
      assertOpen();
      return pluginCtx.getFact(id);
    },
    listFactIds() {
      assertOpen();
      return pluginCtx.listIds(StoreKind.FACT);
    },

    // --- Knowledge reads ---
    getKnowledge() {
      assertOpen();
      if (typeof pluginCtx.getKnowledge !== 'function') {
        throw new RulePackError(RulePackErrorKind.FORBIDDEN, 'knowledge not available');
      }
      return pluginCtx.getKnowledge();
    },
    knowledgeGet(entryId) {
      assertOpen();
      const kh = ctx.getKnowledge();
      return kh.get(entryId);
    },

    // --- Emit results (collected; persisted on pack commit via pluginCtx) ---
    addEvidence(record) {
      assertOpen();
      if (!record || !record.evidenceId || !record.kind) {
        throw new RulePackError(RulePackErrorKind.EXECUTION, 'evidence needs evidenceId + kind');
      }
      const ev = {
        evidenceId: record.evidenceId,
        kind: record.kind,
        ref: record.ref || null,
        detail: record.detail || null,
        ruleId: record.ruleId || null,
      };
      evidence.push(ev);
      traces.push({ type: 'evidence', id: ev.evidenceId, ruleId: ev.ruleId, at: clock() });
      return ev.evidenceId;
    },

    addHypothesis(record) {
      assertOpen();
      if (!record || !record.hypothesisId || !record.question) {
        throw new RulePackError(
          RulePackErrorKind.EXECUTION,
          'hypothesis needs hypothesisId + question'
        );
      }
      const hyp = {
        contractId: 'Hypothesis',
        suiteVersion: (pack && pack.suiteVersion) || '1.0.0',
        hypothesisId: record.hypothesisId,
        question: record.question,
        subject: record.subject != null ? record.subject : null,
        candidates: Array.isArray(record.candidates) ? record.candidates.map((c) => ({ ...c })) : [],
        evidence: Array.isArray(record.evidence) ? record.evidence.map((e) => ({ ...e })) : [],
        localScores: Array.isArray(record.localScores) ? record.localScores.map((s) => ({ ...s })) : [],
        ruleId: record.ruleId || null,
      };
      hypotheses.push(hyp);
      for (const c of hyp.candidates) {
        candidates.push({
          ...c,
          hypothesisId: hyp.hypothesisId,
          question: hyp.question,
          ruleId: hyp.ruleId,
        });
      }
      traces.push({
        type: 'hypothesis',
        id: hyp.hypothesisId,
        ruleId: hyp.ruleId,
        candidateCount: hyp.candidates.length,
        at: clock(),
      });
      return hyp.hypothesisId;
    },

    addCandidate(record) {
      assertOpen();
      if (!record || !record.candidateId || record.answer == null) {
        throw new RulePackError(
          RulePackErrorKind.EXECUTION,
          'candidate needs candidateId + answer'
        );
      }
      const c = {
        candidateId: record.candidateId,
        answer: record.answer,
        localScore: record.localScore,
        priorityBand: record.priorityBand || 'P5',
        hypothesisId: record.hypothesisId || null,
        question: record.question || null,
        ruleId: record.ruleId || null,
        safeGeneric: record.safeGeneric === true,
      };
      candidates.push(c);
      traces.push({ type: 'candidate', id: c.candidateId, ruleId: c.ruleId, at: clock() });
      return c.candidateId;
    },

    // --- Forbidden ---
    putDecision: () => deny('putDecision'),
    putTrace: () => deny('putTrace'),
    commit: () => deny('commit'),
    arbitrate: () => deny('arbitrate'),
    emit: () => deny('emit'),
    putFact: () => deny('putFact'),
    mutateFact: () => deny('mutateFact'),
    mutateKnowledge: () => deny('mutateKnowledge'),
    putKnowledge: () => deny('putKnowledge'),
    getWorkspace: () => deny('getWorkspace'),
    invokeDecisionRuntime: () => deny('invokeDecisionRuntime'),

    /** Internal: seal collections */
    _close() {
      closed = true;
    },

    _snapshot() {
      return {
        evidence: evidence.map((e) => ({ ...e })),
        hypotheses: hypotheses.map((h) => ({
          ...h,
          candidates: h.candidates.map((c) => ({ ...c })),
          evidence: h.evidence.map((e) => ({ ...e })),
          localScores: h.localScores.map((s) => ({ ...s })),
        })),
        candidates: candidates.map((c) => ({ ...c })),
        diagnostics: diagnostics.map((d) => ({ ...d })),
        executionTrace: traces.map((t) => ({ ...t })),
      };
    },
  };

  return ctx;
}

module.exports = { createRuleContext };
