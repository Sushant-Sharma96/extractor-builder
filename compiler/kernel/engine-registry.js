'use strict';

const { FailureKind, KernelError } = require('./failures');
const { assertNoOntologyString } = require('./policy');

const PHASE_AFFINITY = new Set(['early', 'mid', 'late', 'lowering']);
const DETERMINISM = new Set(['pure', 'seeded', 'nondeterministic']);

/**
 * Engine registry — capability declarations only (RFC-002 §11 skeleton for Phase 6 expands).
 */
function createEngineRegistry() {
  const engines = new Map();

  function register(declaration) {
    if (!declaration || typeof declaration !== 'object') {
      throw new KernelError(FailureKind.POLICY_VIOLATION, 'engine declaration required');
    }
    const { id, semver, capabilities, questions, packs, phaseAffinity, determinism } = declaration;
    if (!id || typeof id !== 'string') {
      throw new KernelError(FailureKind.POLICY_VIOLATION, 'engine id required');
    }
    assertNoOntologyString('engine.id', id);
    if (engines.has(id)) {
      throw new KernelError(FailureKind.POLICY_VIOLATION, `engine already registered: ${id}`);
    }
    const affinity = phaseAffinity || 'mid';
    if (!PHASE_AFFINITY.has(affinity)) {
      throw new KernelError(FailureKind.POLICY_VIOLATION, `invalid phaseAffinity: ${affinity}`);
    }
    const det = determinism || 'pure';
    if (!DETERMINISM.has(det)) {
      throw new KernelError(FailureKind.POLICY_VIOLATION, `invalid determinism: ${det}`);
    }

    const entry = Object.freeze({
      id,
      semver: semver || '0.0.0',
      capabilities: Object.freeze({
        reads: Object.freeze([...(capabilities && capabilities.reads ? capabilities.reads : [])]),
        writes: Object.freeze([...(capabilities && capabilities.writes ? capabilities.writes : [])]),
      }),
      questions: Object.freeze([...(questions || [])]),
      packs: Object.freeze([...(packs || [])]),
      phaseAffinity: affinity,
      determinism: det,
    });
    engines.set(id, entry);
    return entry;
  }

  function list() {
    return [...engines.values()];
  }

  function get(id) {
    return engines.get(id) || null;
  }

  function clear() {
    engines.clear();
  }

  return { register, list, get, clear };
}

module.exports = { createEngineRegistry, PHASE_AFFINITY, DETERMINISM };
