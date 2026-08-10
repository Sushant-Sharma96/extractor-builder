'use strict';

const { isHardBand } = require('./bands');

/**
 * Arbitration protocol (RFC-002 §5.3 logical steps) — no domain knowledge.
 *
 * @param {{ scored: Array, thresholds: object, safeGenericId?: string|null }}
 * @returns {{ winner, status, reason, alternatives_kept }}
 */
function arbitrate({ scored, thresholds, safeGenericId = null }) {
  const viable = (scored || []).filter((s) => !s.veto);
  if (!viable.length) {
    return {
      winner: { kind: 'abstain', reason: 'no_viable_candidates' },
      status: 'arbitrated',
      reason: 'no_viable_candidates',
      alternatives_kept: [],
    };
  }

  // Drop hard-band violators already marked veto; P0/P1 without veto stay
  const ranked = [...viable];
  const top = ranked[0];
  const second = ranked[1] || null;

  const alternatives = ranked.slice(1).map((s) => s.candidateId);

  // Override is handled outside this function

  // Accept minimum
  if (top.value < thresholds.accept_min) {
    const safe = findSafeGeneric(ranked, safeGenericId);
    if (safe && top.value < thresholds.fallback_below) {
      return {
        winner: { kind: 'candidate', candidateId: safe.candidateId },
        status: 'fallen-back',
        reason: 'below_accept_min_fallback_generic',
        alternatives_kept: ranked.map((s) => s.candidateId).filter((id) => id !== safe.candidateId),
      };
    }
    return {
      winner: { kind: 'abstain', reason: 'below_accept_min' },
      status: 'arbitrated',
      reason: 'below_accept_min',
      alternatives_kept: ranked.map((s) => s.candidateId),
    };
  }

  // Margin vs runner-up (same or adjacent consideration)
  if (second) {
    const margin = top.value - second.value;
    const sameBand = top.band === second.band;
    if (sameBand && margin < thresholds.margin_min) {
      const safe = findSafeGeneric(ranked, safeGenericId);
      if (safe) {
        return {
          winner: { kind: 'candidate', candidateId: safe.candidateId },
          status: 'fallen-back',
          reason: 'margin_tie_safe_generic',
          alternatives_kept: ranked.map((s) => s.candidateId).filter((id) => id !== safe.candidateId),
        };
      }
      return {
        winner: { kind: 'abstain', reason: 'margin_below_threshold' },
        status: 'arbitrated',
        reason: 'margin_below_threshold',
        alternatives_kept: ranked.map((s) => s.candidateId),
      };
    }
    // Higher band always wins even with lower score — already sorted by band
    if (!sameBand && isHardBand(second.band) && !isHardBand(top.band)) {
      // Should not happen if sort is correct
    }
  }

  return {
    winner: { kind: 'candidate', candidateId: top.candidateId },
    status: 'arbitrated',
    reason: 'winner_selected',
    alternatives_kept: alternatives,
  };
}

function findSafeGeneric(ranked, safeGenericId) {
  if (safeGenericId) {
    return ranked.find((s) => s.candidateId === safeGenericId) || null;
  }
  return ranked.find((s) => s.safeGeneric) || null;
}

module.exports = { arbitrate };
