'use strict';

const WAVE_ORDER = ['early', 'mid', 'late', 'lowering'];

/**
 * Scheduling skeleton: group registered engines by phaseAffinity.
 * Does not execute engines (no domain logic).
 */
function buildSchedule(engineList) {
  const waves = WAVE_ORDER.map((affinity) => ({
    affinity,
    engineIds: [],
  }));
  const byAffinity = Object.fromEntries(waves.map((w) => [w.affinity, w]));

  for (const eng of engineList || []) {
    const a = eng.phaseAffinity || 'mid';
    if (byAffinity[a]) byAffinity[a].engineIds.push(eng.id);
  }

  return {
    kind: 'capability-dag-skeleton',
    note: 'Phase 2 skeleton only — no engine execution, no workspace I/O',
    waves: waves.map((w) => ({
      affinity: w.affinity,
      engineIds: [...w.engineIds],
    })),
  };
}

module.exports = { buildSchedule, WAVE_ORDER };
