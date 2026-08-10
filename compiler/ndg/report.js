'use strict';

const { BUILDER_VERSION } = require('./constants');

/**
 * Graph Validation Report (diagnostic artifact — not a Decision).
 */
function buildGraphReport({
  graph,
  checksum,
  validation,
  events = [],
  edgeIds = [],
  builderVersion = BUILDER_VERSION,
  timing = null,
  fingerprint = null,
} = {}) {
  const invisible = (graph.nodes || []).filter((n) => n.visible === false).length;
  const dropped = events.filter((e) => e.type === 'dropped');
  const collapsed = events.filter((e) => e.type === 'collapsed');

  return Object.freeze({
    reportId: `ndg-report:${graph.graphId}`,
    graphId: graph.graphId,
    builderVersion,
    checksum,
    fingerprint: fingerprint || null,
    timing: timing || null,
    validationStatus: validation && validation.ok ? 'ok' : 'failed',
    nodeCount: (graph.nodes || []).length,
    edgeCount: (graph.edges || []).length,
    edgeIdCount: edgeIds.length,
    invisibleNodes: invisible,
    droppedNodes: dropped.length,
    collapsedNodes: collapsed.length,
    dropped: dropped.map((e) => ({
      sourceNodeId: e.sourceNodeId,
      reason: e.reason,
    })),
    collapsed: collapsed.map((e) => ({
      sourceNodeId: e.sourceNodeId,
      replacedBy: e.replacedBy,
      reason: e.reason,
    })),
    warnings: (validation && validation.warnings) || [],
    errors: (validation && validation.errors) || [],
    roots: (validation && validation.roots) || [],
  });
}

module.exports = { buildGraphReport };
