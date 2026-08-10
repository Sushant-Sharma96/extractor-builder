'use strict';

const { FailureKind, KernelError } = require('./failures');

/** Substrings that must never appear as kernel-owned ontology (RFC-002 §1.3). */
const FORBIDDEN_ONTOLOGY = Object.freeze([
  'navbar', 'hero', 'pricing', 'carousel', 'accordion', 'sidebar', 'megamenu',
]);

function assertNoOntologyString(label, value) {
  if (value == null) return;
  const s = String(value).toLowerCase();
  for (const bad of FORBIDDEN_ONTOLOGY) {
    if (s.includes(bad)) {
      throw new KernelError(
        FailureKind.INVARIANT_VIOLATION,
        `Kernel invariant: forbidden UI ontology in ${label}`,
        { token: bad, value }
      );
    }
  }
}

/**
 * Bind a PolicyProfile-shaped object (Phase 1 contract).
 * Threshold values remain non-authoritative until Phase 5 unless valuesAuthoritative===true.
 */
function bindPolicy(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new KernelError(FailureKind.POLICY_VIOLATION, 'policy profile required');
  }
  if (profile.contractId && profile.contractId !== 'PolicyProfile') {
    throw new KernelError(FailureKind.POLICY_VIOLATION, 'contractId must be PolicyProfile');
  }
  if (!profile.profileId || typeof profile.profileId !== 'string') {
    throw new KernelError(FailureKind.POLICY_VIOLATION, 'profileId required');
  }
  assertNoOntologyString('profileId', profile.profileId);
  assertNoOntologyString('description', profile.description);

  return Object.freeze({
    contractId: 'PolicyProfile',
    suiteVersion: profile.suiteVersion || null,
    profileId: profile.profileId,
    profileVersion: profile.profileVersion ?? null,
    description: profile.description ?? null,
    thresholds: profile.thresholds ? { ...profile.thresholds } : null,
    budgets: profile.budgets ? { ...profile.budgets } : null,
    allowedEngineIds: Array.isArray(profile.allowedEngineIds) ? [...profile.allowedEngineIds] : [],
    allowedPackIds: Array.isArray(profile.allowedPackIds) ? [...profile.allowedPackIds] : [],
    valuesAuthoritative: profile.valuesAuthoritative === true,
    gateMode: profile.gateMode === 'best_effort' ? 'best_effort' : (profile.gateMode === 'fail_closed' ? 'fail_closed' : null),
    flags: profile.flags && typeof profile.flags === 'object' ? { ...profile.flags } : {},
    resolvedFrom: Array.isArray(profile.resolvedFrom) ? [...profile.resolvedFrom] : [profile.profileId],
  });
}

module.exports = { bindPolicy, assertNoOntologyString, FORBIDDEN_ONTOLOGY };
