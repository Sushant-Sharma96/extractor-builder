'use strict';

const WAVE_ORDER = ['early', 'mid', 'late', 'lowering'];

/**
 * Generic plugin scheduler — no domain reasoning.
 * Respects phaseAffinity, estimatedCost, estimatedMemory, timeout, allowlists (pre-filtered list).
 */
function buildPluginSchedule(pluginList, options = {}) {
  const maxMemory = options.maxMemory != null ? options.maxMemory : Infinity;
  const waves = WAVE_ORDER.map((affinity) => ({
    affinity,
    entries: [],
  }));
  const byAffinity = Object.fromEntries(waves.map((w) => [w.affinity, w]));

  const sorted = [...(pluginList || [])].sort((a, b) => {
    const ca = a.estimatedCost != null ? a.estimatedCost : 0;
    const cb = b.estimatedCost != null ? b.estimatedCost : 0;
    if (ca !== cb) return ca - cb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let memoryUsed = 0;
  const deferred = [];

  for (const p of sorted) {
    const a = p.phaseAffinity || 'mid';
    const wave = byAffinity[a] || byAffinity.mid;
    const mem = p.estimatedMemory || 0;
    if (memoryUsed + mem > maxMemory) {
      deferred.push(p.id);
      continue;
    }
    memoryUsed += mem;
    wave.entries.push({
      id: p.id,
      version: p.version,
      estimatedCost: p.estimatedCost,
      estimatedMemory: p.estimatedMemory,
      timeout: p.timeout,
      determinism: p.determinism,
    });
  }

  return {
    kind: 'plugin-capability-schedule',
    note: 'Phase 6 generic schedule — no domain engines',
    waves: waves.map((w) => ({
      affinity: w.affinity,
      // stable order already by cost then id
      engineIds: w.entries.map((e) => e.id),
      entries: w.entries,
    })),
    deferredMemory: deferred,
    memoryUsed,
  };
}

module.exports = { buildPluginSchedule, WAVE_ORDER };
