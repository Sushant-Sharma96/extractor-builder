'use strict';

/**
 * collect — read NDG (+ optional Layout pin). Never mutate.
 */

const { loadNdgFromWorkspace, deepFreeze } = require('../layout/collect');
const { loadLayoutIrFromWorkspace } = require('../layout/constraint/load');
const { ComponentError, ComponentErrorKind } = require('./errors');

function collectDecisions(workspace) {
  if (!workspace || typeof workspace.listIds !== 'function') return [];
  return workspace.listIds('DecisionRecord')
    .map((id) => workspace.getDecision(id))
    .filter(Boolean);
}

/**
 * @returns {{
 *   graph: object,
 *   layoutIr: object|null,
 *   layoutDegraded: boolean,
 *   decisions: object[],
 * }}
 */
function collectComponentInputs(workspace, opts = {}) {
  if (!workspace) {
    throw new ComponentError(ComponentErrorKind.MISSING_NDG, 'workspace required');
  }
  const { graph } = loadNdgFromWorkspace(workspace);
  if (!graph || !graph.graphId) {
    throw new ComponentError(ComponentErrorKind.MISSING_NDG, 'NDG required');
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

  return {
    graph,
    layoutIr,
    layoutDegraded,
    decisions: opts.decisions || collectDecisions(workspace),
  };
}

module.exports = {
  collectComponentInputs,
  collectDecisions,
  deepFreeze,
  loadNdgFromWorkspace,
};
