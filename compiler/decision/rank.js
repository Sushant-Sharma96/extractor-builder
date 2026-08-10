'use strict';

const { compareBands } = require('./bands');
const { scoreCandidate } = require('./confidence');

/**
 * Rank candidates: higher priority band first, then higher score.
 * Returns { ranking: string[], scored: [{ candidateId, band, value, ... }] }
 */
function rankCandidates(candidates, scoresById = {}) {
  const scored = (candidates || []).map((c) => {
    const scoredPart = scoreCandidate(c, scoresById[c.candidateId]);
    return {
      candidateId: c.candidateId,
      band: c.priorityBand || 'P5',
      value: scoredPart.value,
      breakdown: scoredPart.breakdown,
      source: scoredPart.source,
      veto: c.veto === true,
      safeGeneric: c.safeGeneric === true,
      candidate: c,
    };
  });

  scored.sort((a, b) => {
    const bandCmp = compareBands(a.band, b.band);
    if (bandCmp !== 0) return bandCmp;
    return b.value - a.value;
  });

  return {
    ranking: scored.map((s) => s.candidateId),
    scored,
  };
}

module.exports = { rankCandidates };
