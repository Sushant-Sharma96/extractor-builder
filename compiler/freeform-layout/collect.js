'use strict';

/**
 * collect — read NDG (+ Decisions). Never mutate.
 *
 * freeform-layout-ir consumes Component IR's already-computed cardGridFacts /
 * rowSetFacts as its group-discovery seed set (see detect.js). Rather than
 * requiring a previously-published Component IR IrSlice to exist in the
 * workspace (fragile — depends on plugin execution order), this stage calls
 * compiler/components' pure detectComponents(graph) directly here, exactly
 * as compiler/semantic and other mid-phase domains call detectGeometry/
 * detectComponents directly rather than re-reading a workspace slice. This
 * is still "consuming Component IR's already-published facts" in the sense
 * that matters (the SAME pure function, SAME rules, SAME result Component IR
 * itself publishes) — just without a workspace round-trip dependency.
 */

const { loadNdgFromWorkspace, deepFreeze } = require('../layout/collect');
const { detectComponents } = require('../components');
const { detectGeometry } = require('../geometry');
const { FreeformLayoutError, FreeformLayoutErrorKind } = require('./errors');

function collectDecisions(workspace) {
  if (!workspace || typeof workspace.listIds !== 'function') return [];
  return workspace.listIds('DecisionRecord')
    .map((id) => workspace.getDecision(id))
    .filter(Boolean);
}

/**
 * @returns {{
 *   graph: object,
 *   componentDetected: object,
 *   geometryDetected: object,
 *   decisions: object[],
 * }}
 */
function collectFreeformLayoutInputs(workspace, opts = {}) {
  if (!workspace) {
    throw new FreeformLayoutError(FreeformLayoutErrorKind.MISSING_NDG, 'workspace required');
  }
  const { graph } = loadNdgFromWorkspace(workspace);
  if (!graph || !graph.graphId) {
    throw new FreeformLayoutError(FreeformLayoutErrorKind.MISSING_NDG, 'NDG required');
  }

  const decisions = opts.decisions || collectDecisions(workspace);

  const geometryDetected = opts.geometryDetected || detectGeometry(graph, {
    decisions,
    policy: opts.policy || {},
  });

  const componentDetected = opts.componentDetected || detectComponents(graph, {
    decisions,
    policy: opts.policy || {},
    geometryCandidatesByNode: opts.geometryCandidatesByNode || {},
  });

  return {
    graph,
    componentDetected,
    geometryDetected,
    decisions,
  };
}

module.exports = {
  collectFreeformLayoutInputs,
  collectDecisions,
  deepFreeze,
  loadNdgFromWorkspace,
};
