'use strict';

/**
 * collect — read NDG (+ Decisions). Never mutate.
 */

const { loadNdgFromWorkspace, deepFreeze } = require('../layout/collect');
const { GeometryError, GeometryErrorKind } = require('./errors');

function collectDecisions(workspace) {
  if (!workspace || typeof workspace.listIds !== 'function') return [];
  return workspace.listIds('DecisionRecord')
    .map((id) => workspace.getDecision(id))
    .filter(Boolean);
}

function collectGeometryInputs(workspace, opts = {}) {
  if (!workspace) {
    throw new GeometryError(GeometryErrorKind.MISSING_NDG, 'workspace required');
  }
  const { graph } = loadNdgFromWorkspace(workspace);
  if (!graph || !graph.graphId) {
    throw new GeometryError(GeometryErrorKind.MISSING_NDG, 'NDG required');
  }
  return {
    graph,
    decisions: opts.decisions || collectDecisions(workspace),
  };
}

module.exports = {
  collectGeometryInputs,
  collectDecisions,
  deepFreeze,
  loadNdgFromWorkspace,
};
