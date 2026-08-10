'use strict';

/**
 * collect — read NDG (+ Decisions). Never mutate.
 */

const { loadNdgFromWorkspace, deepFreeze } = require('../layout/collect');
const { TokenError, TokenErrorKind } = require('./errors');

function collectDecisions(workspace) {
  if (!workspace || typeof workspace.listIds !== 'function') return [];
  return workspace.listIds('DecisionRecord')
    .map((id) => workspace.getDecision(id))
    .filter(Boolean);
}

function collectTokenInputs(workspace, opts = {}) {
  if (!workspace) {
    throw new TokenError(TokenErrorKind.MISSING_NDG, 'workspace required');
  }
  const { graph } = loadNdgFromWorkspace(workspace);
  if (!graph || !graph.graphId) {
    throw new TokenError(TokenErrorKind.MISSING_NDG, 'NDG required');
  }
  return {
    graph,
    decisions: opts.decisions || collectDecisions(workspace),
  };
}

module.exports = {
  collectTokenInputs,
  collectDecisions,
  deepFreeze,
  loadNdgFromWorkspace,
};
