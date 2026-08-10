'use strict';

function createTraceId(decisionId) {
  return `trace:${decisionId}`;
}

/**
 * Structured decision trace (RFC-002 §12) — explainability data, not essays.
 */
function buildTrace({
  decisionId,
  question,
  subject,
  candidates,
  evidence,
  ranking,
  scored,
  thresholds,
  arbitration,
  policy,
  override,
}) {
  return {
    traceId: createTraceId(decisionId),
    decisionId,
    question,
    subject,
    candidates: (candidates || []).map((c) => ({
      candidateId: c.candidateId,
      priorityBand: c.priorityBand || null,
      answer: c.answer,
    })),
    evidence: (evidence || []).map((e) => ({
      evidenceId: e.evidenceId,
      kind: e.kind,
      ref: e.ref || null,
    })),
    scored: (scored || []).map((s) => ({
      candidateId: s.candidateId,
      band: s.band,
      value: s.value,
      source: s.source,
    })),
    ranking: ranking || [],
    thresholds,
    arbitration: {
      reason: arbitration.reason,
      status: arbitration.status,
      winner: arbitration.winner,
    },
    policy: {
      profileId: policy && policy.profileId,
      valuesAuthoritative: policy && policy.valuesAuthoritative === true,
    },
    override: override || null,
    at: new Date().toISOString(),
  };
}

module.exports = { buildTrace, createTraceId };
