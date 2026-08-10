'use strict';

/**
 * collect — load ResolvedIR only. Never touch domain engines.
 */

const { deepFreeze } = require('../layout/collect');
const { EmitError, EmitErrorKind } = require('./errors');

function loadResolvedFromWorkspace(workspace, opts = {}) {
  if (!workspace) {
    throw new EmitError(EmitErrorKind.MISSING_RESOLVED, 'workspace required');
  }
  if (opts.resolvedSliceId) {
    const slice = workspace.getIrSlice(opts.resolvedSliceId);
    if (!slice || slice.stageId !== 'resolved-ir') {
      throw new EmitError(
        EmitErrorKind.MISSING_RESOLVED,
        `ResolvedIR slice not found: ${opts.resolvedSliceId}`
      );
    }
    return slice;
  }
  const ids = workspace.listIds('IrSlice').slice().sort();
  let found = null;
  for (const id of ids) {
    const slice = workspace.getIrSlice(id);
    if (slice && slice.stageId === 'resolved-ir') {
      if (opts.graphId && slice.graphId && slice.graphId !== opts.graphId) continue;
      found = slice;
    }
  }
  if (!found) {
    throw new EmitError(EmitErrorKind.MISSING_RESOLVED, 'ResolvedIR required');
  }
  return found;
}

function collectDecisions(workspace) {
  if (!workspace || typeof workspace.listIds !== 'function') return [];
  return workspace.listIds('DecisionRecord')
    .map((id) => workspace.getDecision(id))
    .filter(Boolean);
}

function collectEmitInputs(workspace, opts = {}) {
  const resolvedSlice = opts.resolvedSlice || loadResolvedFromWorkspace(workspace, opts);
  const payload = resolvedSlice.payload;
  if (!payload || payload.contractId !== 'ResolvedIR') {
    throw new EmitError(EmitErrorKind.INVALID_INPUT, 'ResolvedIR payload invalid');
  }
  return {
    resolvedSlice,
    resolved: payload,
    decisions: opts.decisions || collectDecisions(workspace),
    policyProfileId: (opts.policy && opts.policy.profileId) || opts.policyProfileId || 'default',
  };
}

module.exports = {
  collectEmitInputs,
  loadResolvedFromWorkspace,
  collectDecisions,
  deepFreeze,
};
