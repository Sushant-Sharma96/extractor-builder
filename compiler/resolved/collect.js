'use strict';

/**
 * collect — gather published IrSlices + Decisions. Never mutate slices.
 */

const { loadNdgFromWorkspace, deepFreeze } = require('../layout/collect');
const { COMPOSABLE_STAGES } = require('./constants');
const { ResolvedError, ResolvedErrorKind } = require('./errors');

function collectDecisions(workspace) {
  if (!workspace || typeof workspace.listIds !== 'function') return [];
  return workspace.listIds('DecisionRecord')
    .map((id) => workspace.getDecision(id))
    .filter(Boolean);
}

function listIrSlices(workspace) {
  if (!workspace || typeof workspace.listIds !== 'function') return [];
  return workspace.listIds('IrSlice')
    .map((id) => workspace.getIrSlice(id))
    .filter(Boolean);
}

/**
 * Prefer LayoutIR active pin when multiple layout-ir slices exist.
 */
function pickLayoutSlice(workspace, graphId, candidates) {
  if (!candidates.length) return null;
  if (workspace && typeof workspace.getLayoutIrPin === 'function' && graphId) {
    const pin = workspace.getLayoutIrPin(graphId);
    if (pin && pin.activeLayoutIrSliceId) {
      const hit = candidates.find((s) => s.sliceId === pin.activeLayoutIrSliceId);
      if (hit) return { chosen: hit, conflict: candidates.length > 1 };
    }
    if (pin && pin.baselineLayoutIrSliceId) {
      const hit = candidates.find((s) => s.sliceId === pin.baselineLayoutIrSliceId);
      if (hit) return { chosen: hit, conflict: candidates.length > 1 };
    }
  }
  const sorted = [...candidates].sort((a, b) => (a.sliceId < b.sliceId ? -1 : 1));
  return { chosen: sorted[sorted.length - 1], conflict: candidates.length > 1 };
}

function collectResolvedInputs(workspace, opts = {}) {
  if (!workspace) {
    throw new ResolvedError(ResolvedErrorKind.MISSING_NDG, 'workspace required');
  }

  let graph = null;
  try {
    const loaded = loadNdgFromWorkspace(workspace);
    graph = loaded.graph;
  } catch (_) {
    graph = null;
  }
  if (!graph || !graph.graphId) {
    throw new ResolvedError(ResolvedErrorKind.MISSING_NDG, 'NDG required before ResolvedIR');
  }

  const allSlices = listIrSlices(workspace);
  const byStage = new Map();
  for (const stageId of COMPOSABLE_STAGES) {
    byStage.set(stageId, []);
  }
  for (const slice of allSlices) {
    if (!slice || !COMPOSABLE_STAGES.includes(slice.stageId)) continue;
    if (opts.graphId && slice.graphId && slice.graphId !== opts.graphId) continue;
    if (graph.graphId && slice.graphId && slice.graphId !== graph.graphId) continue;
    byStage.get(slice.stageId).push(slice);
  }

  const selected = [];
  const conflicts = [];
  const missingStages = [];

  for (const stageId of COMPOSABLE_STAGES) {
    const cands = byStage.get(stageId) || [];
    if (cands.length === 0) {
      if (stageId === 'asset-ir' || stageId === 'behavior-ir') {
        missingStages.push({ stageId, optional: true });
      } else {
        missingStages.push({ stageId, optional: true });
      }
      continue;
    }
    let chosen;
    let conflict = false;
    if (stageId === 'layout-ir') {
      const pick = pickLayoutSlice(workspace, graph.graphId, cands);
      chosen = pick.chosen;
      conflict = pick.conflict;
    } else {
      const sorted = [...cands].sort((a, b) => (a.sliceId < b.sliceId ? -1 : 1));
      chosen = sorted[sorted.length - 1];
      conflict = cands.length > 1;
    }
    selected.push(chosen);
    if (conflict) {
      conflicts.push({
        stageId,
        chosenSliceId: chosen.sliceId,
        discardedSliceIds: cands.map((s) => s.sliceId).filter((id) => id !== chosen.sliceId).sort(),
      });
    }
  }

  if (selected.length === 0) {
    throw new ResolvedError(
      ResolvedErrorKind.NO_SLICES,
      'ResolvedIR requires at least one specialized IrSlice'
    );
  }

  const decisions = opts.decisions || collectDecisions(workspace);
  const committedDecisions = decisions.filter((d) => {
    const st = d && d.status;
    return st === 'arbitrated' || st === 'fallen-back' || st === 'overridden';
  });

  return {
    graph,
    selectedSlices: selected,
    conflicts,
    missingStages,
    decisions: committedDecisions,
    allDecisions: decisions,
  };
}

module.exports = {
  collectResolvedInputs,
  collectDecisions,
  deepFreeze,
  loadNdgFromWorkspace,
  COMPOSABLE_STAGES,
};
