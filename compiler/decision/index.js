'use strict';

const { DecisionError, DecisionErrorKind } = require('./errors');
const { rankCandidates } = require('./rank');
const { arbitrate } = require('./arbitrate');
const { resolveThresholds } = require('./thresholds');
const { buildTrace, createTraceId } = require('./trace');
const { StoreKind } = require('../workspace');

const SessionState = Object.freeze({
  OPEN: 'open',
  COLLECTED: 'collected',
  RANKED: 'ranked',
  ARBITRATED: 'arbitrated',
  COMMITTED: 'committed',
  CLOSED: 'closed',
});

function subjectsMatch(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Create Decision Runtime bound to a Workspace + Policy (Phase 4).
 * No domain intelligence — orchestration only.
 *
 * Trace ownership: Runtime authors traces; after commit, Workspace is the
 * durable store (passive). Runtime memory is a write-through cache only.
 */
function createDecisionRuntime({ workspace, policy, contractSuiteVersion = '1.0.0' } = {}) {
  if (!workspace) {
    throw new DecisionError(DecisionErrorKind.INVALID_INPUT, 'workspace required');
  }
  if (!policy || !policy.profileId) {
    throw new DecisionError(DecisionErrorKind.POLICY, 'policy with profileId required');
  }

  let thresholds;
  try {
    thresholds = resolveThresholds(policy);
  } catch (e) {
    if (e.code === 'AUTHORITATIVE_THRESHOLDS_MISSING') {
      throw new DecisionError(DecisionErrorKind.POLICY, e.message, { missing: e.missing });
    }
    throw e;
  }

  const traces = new Map(); // write-through cache; durable copy in Workspace after commit

  function readTrace(traceId) {
    if (traces.has(traceId)) return traces.get(traceId);
    if (typeof workspace.getTrace === 'function') {
      return workspace.getTrace(traceId);
    }
    return null;
  }

  function createSession(opts = {}) {
    const question = opts.question;
    const subject = opts.subject;
    if (!question || subject == null) {
      throw new DecisionError(DecisionErrorKind.INVALID_INPUT, 'question and subject required');
    }

    const decisionId = opts.decisionId || `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let state = SessionState.OPEN;
    const candidates = [];
    const evidence = [];
    const scoresById = {};
    let rankingResult = null;
    let arbitrationResult = null;
    let overrideMeta = null;
    let committedRecord = null;

    function assertState(...allowed) {
      if (!allowed.includes(state)) {
        throw new DecisionError(
          DecisionErrorKind.INVALID_STATE,
          `invalid session state ${state}; expected ${allowed.join('|')}`
        );
      }
    }

    function registerCandidate(candidate) {
      assertState(SessionState.OPEN, SessionState.COLLECTED);
      if (!candidate || !candidate.candidateId || !candidate.answer) {
        throw new DecisionError(DecisionErrorKind.INVALID_INPUT, 'candidate requires candidateId and answer');
      }
      if (candidates.some((c) => c.candidateId === candidate.candidateId)) {
        throw new DecisionError(DecisionErrorKind.INVALID_INPUT, `duplicate candidate ${candidate.candidateId}`);
      }
      candidates.push({ ...candidate });
      if (candidate.localScore != null) {
        scoresById[candidate.candidateId] = { candidateId: candidate.candidateId, value: candidate.localScore };
      }
      state = SessionState.COLLECTED;
      return candidate.candidateId;
    }

    function registerEvidence(ev) {
      assertState(SessionState.OPEN, SessionState.COLLECTED, SessionState.RANKED);
      if (!ev || !ev.evidenceId || !ev.kind) {
        throw new DecisionError(DecisionErrorKind.INVALID_INPUT, 'evidence requires evidenceId and kind');
      }
      evidence.push({ ...ev });
      return ev.evidenceId;
    }

    function registerScore(entry) {
      assertState(SessionState.OPEN, SessionState.COLLECTED, SessionState.RANKED);
      if (!entry || !entry.candidateId || typeof entry.value !== 'number') {
        throw new DecisionError(DecisionErrorKind.INVALID_INPUT, 'score requires candidateId and value');
      }
      scoresById[entry.candidateId] = { ...entry };
    }

    /** Pull matching Hypotheses from Workspace (passive read). */
    function collectFromWorkspace() {
      assertState(SessionState.OPEN, SessionState.COLLECTED);
      const ids = workspace.listIds(StoreKind.HYPOTHESIS);
      for (const id of ids) {
        const h = workspace.getHypothesis(id);
        if (!h) continue;
        if (h.question !== question) continue;
        if (!subjectsMatch(h.subject, subject)) continue;
        for (const c of h.candidates || []) {
          if (!candidates.some((x) => x.candidateId === c.candidateId)) {
            registerCandidate(c);
          }
        }
        for (const e of h.evidence || []) {
          if (!evidence.some((x) => x.evidenceId === e.evidenceId)) {
            registerEvidence(e);
          }
        }
        for (const s of h.localScores || []) {
          registerScore(s);
        }
      }
      state = SessionState.COLLECTED;
      return { candidateCount: candidates.length, evidenceCount: evidence.length };
    }

    function rank() {
      assertState(SessionState.COLLECTED, SessionState.RANKED);
      if (!candidates.length) {
        throw new DecisionError(DecisionErrorKind.NO_CANDIDATES, 'no candidates to rank');
      }
      rankingResult = rankCandidates(candidates, scoresById);
      state = SessionState.RANKED;
      return {
        ranking: [...rankingResult.ranking],
        scored: rankingResult.scored.map((s) => ({
          candidateId: s.candidateId,
          band: s.band,
          value: s.value,
        })),
      };
    }

    function runArbitration(opts = {}) {
      assertState(SessionState.RANKED);
      if (!rankingResult) rank();
      arbitrationResult = arbitrate({
        scored: rankingResult.scored,
        thresholds,
        safeGenericId: opts.safeGenericId || null,
      });
      state = SessionState.ARBITRATED;
      return { ...arbitrationResult };
    }

    /**
     * Apply human/corpus override (RFC-002 §7.5).
     * Cannot silently invent candidates — forcedCandidateId must exist unless dangerous+answer provided.
     */
    function applyOverride({ forcedCandidateId, actor, reason, dangerous = false } = {}) {
      assertState(SessionState.COLLECTED, SessionState.RANKED, SessionState.ARBITRATED);
      if (!forcedCandidateId) {
        throw new DecisionError(DecisionErrorKind.INVALID_INPUT, 'forcedCandidateId required');
      }
      const exists = candidates.some((c) => c.candidateId === forcedCandidateId);
      if (!exists && !dangerous) {
        throw new DecisionError(
          DecisionErrorKind.INVALID_INPUT,
          'override candidate must be registered (or dangerous=true with prior registration)'
        );
      }
      if (!rankingResult && candidates.length) {
        rankingResult = rankCandidates(candidates, scoresById);
      }
      overrideMeta = {
        actor: actor || 'unknown',
        reason: reason || 'override',
        forcedCandidateId,
        dangerous: !!dangerous,
      };
      arbitrationResult = {
        winner: { kind: 'candidate', candidateId: forcedCandidateId },
        status: 'overridden',
        reason: 'manual_override',
        alternatives_kept: (rankingResult ? rankingResult.ranking : candidates.map((c) => c.candidateId))
          .filter((id) => id !== forcedCandidateId),
      };
      state = SessionState.ARBITRATED;
      return { ...arbitrationResult, override: { ...overrideMeta } };
    }

    function buildDecisionRecord() {
      if (!arbitrationResult) {
        throw new DecisionError(DecisionErrorKind.INVALID_STATE, 'arbitrate or override before commit');
      }
      const scores = (rankingResult ? rankingResult.scored : []).map((s) => ({
        candidateId: s.candidateId,
        value: s.value,
        breakdown: s.breakdown || undefined,
      }));
      const record = {
        contractId: 'DecisionRecord',
        suiteVersion: contractSuiteVersion,
        id: decisionId,
        subject,
        question,
        candidates: candidates.map((c) => ({
          candidateId: c.candidateId,
          answer: c.answer,
          priorityBand: c.priorityBand,
          patternRef: c.patternRef,
          localScore: c.localScore,
        })),
        evidence: evidence.map((e) => ({
          evidenceId: e.evidenceId,
          kind: e.kind,
          ref: e.ref,
          detail: e.detail,
        })),
        scores,
        ranking: rankingResult ? [...rankingResult.ranking] : [],
        winner: arbitrationResult.winner,
        policy: {
          profileId: policy.profileId,
          profileVersion: policy.profileVersion ?? null,
          thresholdsApplied: { ...thresholds },
        },
        status: arbitrationResult.status,
        alternatives_kept: arbitrationResult.alternatives_kept || [],
        trace_refs: [createTraceId(decisionId)],
      };
      if (overrideMeta) {
        record.override = { ...overrideMeta };
      }
      return record;
    }

    function commit() {
      assertState(SessionState.ARBITRATED);
      const record = buildDecisionRecord();
      const writer = {
        id: 'decision-runtime',
        capabilities: { writes: [StoreKind.DECISION, StoreKind.TRACE] },
      };
      try {
        committedRecord = workspace.putDecision(record, writer);
      } catch (e) {
        throw new DecisionError(DecisionErrorKind.COMMIT_FAILED, e.message, { cause: e.kind });
      }

      const trace = buildTrace({
        decisionId,
        question,
        subject,
        candidates,
        evidence,
        ranking: rankingResult ? rankingResult.ranking : [],
        scored: rankingResult ? rankingResult.scored : [],
        thresholds,
        arbitration: arbitrationResult,
        policy,
        override: overrideMeta,
      });
      traces.set(trace.traceId, trace);
      try {
        workspace.putTrace(trace, writer);
      } catch (e) {
        throw new DecisionError(
          DecisionErrorKind.COMMIT_FAILED,
          `Decision committed but trace persist failed: ${e.message}`,
          { cause: e.kind }
        );
      }

      state = SessionState.COMMITTED;
      return {
        decision: committedRecord,
        trace,
      };
    }

    /** Full pipeline helper for synthetic tests. */
    function run(opts = {}) {
      if (opts.fromWorkspace) collectFromWorkspace();
      if (opts.candidates) {
        for (const c of opts.candidates) registerCandidate(c);
      }
      if (opts.evidence) {
        for (const e of opts.evidence) registerEvidence(e);
      }
      if (opts.scores) {
        for (const s of opts.scores) registerScore(s);
      }
      rank();
      if (opts.override) {
        applyOverride(opts.override);
      } else {
        runArbitration({ safeGenericId: opts.safeGenericId });
      }
      return commit();
    }

    function close() {
      state = SessionState.CLOSED;
      return { decisionId, state };
    }

    function getStatus() {
      return {
        decisionId,
        question,
        subject,
        state,
        candidateCount: candidates.length,
        evidenceCount: evidence.length,
        ranking: rankingResult ? rankingResult.ranking : null,
        arbitration: arbitrationResult,
        committed: !!committedRecord,
      };
    }

    return {
      decisionId,
      SessionState,
      registerCandidate,
      registerEvidence,
      registerScore,
      collectFromWorkspace,
      rank,
      runArbitration,
      applyOverride,
      commit,
      run,
      close,
      getStatus,
      getTrace: () => readTrace(createTraceId(decisionId)) || null,
    };
  }

  /**
   * Recovery hook surface — bounded placeholder (full recovery Phase 4 hooks / later).
   * Does not loop unbounded; callers may re-open a session.
   */
  function recoveryHook(kind, detail) {
    return {
      acknowledged: true,
      kind,
      detail: detail || null,
      action: 'reopen_session_bounded',
      note: 'Phase 4 recovery surface only — no automatic engine re-entry',
    };
  }

  return {
    createSession,
    /** Prefer Workspace durable store; fall back to Runtime write-through cache. */
    getTrace: (traceId) => readTrace(traceId),
    listTraces: () => {
      const fromWs = typeof workspace.listIds === 'function'
        ? workspace.listIds(StoreKind.TRACE)
        : [];
      return [...new Set([...traces.keys(), ...fromWs])];
    },
    recoveryHook,
    thresholds,
    policy: {
      profileId: policy.profileId,
      valuesAuthoritative: policy.valuesAuthoritative === true,
    },
    invariants: Object.freeze({
      ownsArbitration: true,
      mutatesFacts: false,
      emitsHtml: false,
      hasDomainIntelligence: false,
      authorsTraces: true,
      workspacePersistsTraces: true,
    }),
  };
}

module.exports = {
  createDecisionRuntime,
  SessionState,
  DecisionError,
  DecisionErrorKind,
  resolveThresholds,
  rankCandidates,
  arbitrate,
};
