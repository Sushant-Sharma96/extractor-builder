'use strict';

/**
 * collect — read NDG (+ optional Layout, SemanticIR, Decisions). Never mutate.
 * SemanticIR is Evidence only — never written here.
 */

const { loadNdgFromWorkspace, deepFreeze } = require('../layout/collect');
const { loadLayoutIrFromWorkspace } = require('../layout/constraint/load');
const { AccessibilityError, AccessibilityErrorKind } = require('./errors');

function collectDecisions(workspace) {
  if (!workspace || typeof workspace.listIds !== 'function') return [];
  return workspace.listIds('DecisionRecord')
    .map((id) => workspace.getDecision(id))
    .filter(Boolean);
}

function loadSemanticIrFromWorkspace(workspace, opts = {}) {
  if (!workspace || typeof workspace.getIrSlice !== 'function') return null;
  if (opts.semanticSliceId) {
    const slice = workspace.getIrSlice(opts.semanticSliceId);
    if (slice && slice.stageId === 'semantic-ir') return slice;
    return null;
  }
  const ids = workspace.listIds('IrSlice').slice().sort();
  let match = null;
  for (const id of ids) {
    const slice = workspace.getIrSlice(id);
    if (!slice || slice.stageId !== 'semantic-ir') continue;
    if (opts.graphId && slice.graphId && slice.graphId !== opts.graphId) continue;
    match = slice;
  }
  return match;
}

/**
 * @returns {{
 *   graph: object,
 *   layoutIr: object|null,
 *   layoutDegraded: boolean,
 *   semanticIr: object|null,
 *   semanticDegraded: boolean,
 *   decisions: object[],
 * }}
 */
function collectAccessibilityInputs(workspace, opts = {}) {
  if (!workspace) {
    throw new AccessibilityError(AccessibilityErrorKind.MISSING_NDG, 'workspace required');
  }
  const { graph } = loadNdgFromWorkspace(workspace);
  if (!graph || !graph.graphId) {
    throw new AccessibilityError(AccessibilityErrorKind.MISSING_NDG, 'NDG required');
  }

  let layoutIr = null;
  let layoutDegraded = false;
  if (opts.layoutIr) {
    layoutIr = opts.layoutIr;
  } else if (opts.skipLayout !== true) {
    try {
      layoutIr = loadLayoutIrFromWorkspace(workspace, {
        prefer: 'active',
        graphId: graph.graphId,
        sliceId: opts.layoutSliceId,
      });
    } catch (_) {
      layoutDegraded = true;
      layoutIr = null;
    }
  }

  let semanticIr = null;
  let semanticDegraded = false;
  if (opts.semanticIr) {
    semanticIr = opts.semanticIr;
  } else if (opts.skipSemantic !== true) {
    semanticIr = loadSemanticIrFromWorkspace(workspace, {
      graphId: graph.graphId,
      semanticSliceId: opts.semanticSliceId,
    });
    if (!semanticIr) semanticDegraded = true;
  }

  return {
    graph,
    layoutIr,
    layoutDegraded,
    semanticIr,
    semanticDegraded,
    decisions: opts.decisions || collectDecisions(workspace),
  };
}

module.exports = {
  collectAccessibilityInputs,
  collectDecisions,
  loadSemanticIrFromWorkspace,
  deepFreeze,
  loadNdgFromWorkspace,
};
