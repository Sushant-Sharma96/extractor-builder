'use strict';

/**
 * Confidence combine API — Phase 4 framework only (calibration is Phase 27).
 * Engines supply local scores; runtime normalizes into [0,1].
 */

function clamp01(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Combine named breakdown parts with equal weight (framework default). */
function combineBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return null;
  const vals = Object.values(breakdown).filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  return clamp01(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/**
 * Resolve a candidate's global score from localScore / scores entry / breakdown.
 */
function scoreCandidate(candidate, scoreEntry) {
  if (scoreEntry && typeof scoreEntry.value === 'number') {
    return {
      value: clamp01(scoreEntry.value),
      breakdown: scoreEntry.breakdown || null,
      source: 'score_entry',
    };
  }
  if (candidate.localScore != null) {
    return { value: clamp01(candidate.localScore), breakdown: null, source: 'localScore' };
  }
  const fromBreak = combineBreakdown(candidate.breakdown);
  if (fromBreak != null) {
    return { value: fromBreak, breakdown: candidate.breakdown, source: 'breakdown' };
  }
  return { value: 0, breakdown: null, source: 'default' };
}

module.exports = { clamp01, combineBreakdown, scoreCandidate };
