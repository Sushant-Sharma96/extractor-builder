'use strict';

/**
 * Publish built NDG into Workspace via capability-scoped plugin context.
 */

const {
  STAGE_ID,
  BUILDER_VERSION,
  FACT_KIND_GRAPH,
  FACT_KIND_NODE,
} = require('./constants');
const { edgeKey } = require('./ids');
const { buildGraphReport } = require('./report');
const { NdgError, NdgErrorKind } = require('./errors');

function publishBuiltGraph(ctx, built, opts = {}) {
  if (!ctx || typeof ctx.putFact !== 'function') {
    throw new NdgError(NdgErrorKind.PUBLISH, 'plugin context required');
  }

  const { graph, checksum, events, edgeIds, builderVersion, validation } = built;
  const suiteVersion = graph.suiteVersion || '1.0.0';
  const sliceId = opts.sliceId || `slice:ndg:${graph.graphId}`;

  // Evidence for structural policy events
  events.forEach((ev, i) => {
    ctx.putEvidence({
      evidenceId: `ev:ndg:${graph.graphId}:${i}`,
      kind: 'other',
      ref: ev.reason,
      detail: {
        type: ev.type,
        sourceNodeId: ev.sourceNodeId,
        replacedBy: ev.replacedBy || null,
        parentSourceId: ev.parentSourceId || null,
        childSourceIds: ev.childSourceIds || null,
        transitional: false,
      },
    });
  });

  // Per-node Facts (structural SSOT projections)
  const childrenOf = new Map();
  const parentOf = new Map();
  for (const e of graph.edges) {
    if (e.kind !== 'parent') continue;
    parentOf.set(e.to, e.from);
    if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
    childrenOf.get(e.from).push({ id: e.to, index: e.index == null ? 0 : e.index });
  }
  for (const [, kids] of childrenOf) {
    kids.sort((a, b) => a.index - b.index);
  }

  for (const node of graph.nodes) {
    const kids = (childrenOf.get(node.id) || []).map((k) => k.id);
    ctx.putFact({
      contractId: 'Fact',
      suiteVersion,
      factId: `fact:ndg.node:${node.id}`,
      kind: FACT_KIND_NODE,
      subject: node.id,
      assertion: {
        ...node,
        graphId: graph.graphId,
        parentId: parentOf.get(node.id) || null,
        childIds: kids,
      },
      producer: {
        engineId: 'facts.ndg.materialize',
        packId: null,
        ruleId: null,
      },
    });
  }

  const report = buildGraphReport({
    graph,
    checksum,
    validation,
    events,
    edgeIds,
    builderVersion: builderVersion || BUILDER_VERSION,
    timing: opts.timing || null,
    fingerprint: opts.fingerprint || null,
  });

  ctx.putFact({
    contractId: 'Fact',
    suiteVersion,
    factId: `fact:ndg.graph:${graph.graphId}`,
    kind: FACT_KIND_GRAPH,
    subject: graph.graphId,
    assertion: {
      graphId: graph.graphId,
      rawDocumentId: graph.rawDocumentId,
      checksum,
      builderVersion: builderVersion || BUILDER_VERSION,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      edgeIds,
      roots: validation.roots || [],
      report,
      structuralTruth: true,
    },
    producer: {
      engineId: 'facts.ndg.materialize',
      packId: null,
      ruleId: null,
    },
  });

  ctx.putIrSlice({
    suiteVersion,
    stageId: STAGE_ID,
    sliceId,
    nodeIds: graph.nodes.map((n) => n.id),
    graphId: graph.graphId,
    checksum,
    builderVersion: builderVersion || BUILDER_VERSION,
    graph,
  });

  return { sliceId, report, checksum };
}

module.exports = { publishBuiltGraph, edgeKey };
