'use strict';

/**
 * Phase 11a — project LayoutIR into Workspace (Facts plugin).
 * Does not propose Hypotheses (Rule Pack does) and does not commit Decisions.
 */

const { executePlugin } = require('../plugin');
const { loadNdgFromWorkspace, indexGraph } = require('./collect');
const { interpretGraph } = require('./interpret');
const { projectLayoutIR } = require('./project');
const { layoutPluginDeclaration } = require('./declaration');
const { publishLayoutIR } = require('./publish');
const { PLUGIN_ID, BUILDER_VERSION } = require('./constants');
const { LayoutError, LayoutErrorKind } = require('./errors');

function collectDecisions(workspace) {
  if (!workspace || typeof workspace.listIds !== 'function') return [];
  return workspace.listIds('DecisionRecord')
    .map((id) => workspace.getDecision(id))
    .filter(Boolean);
}

function collectLayoutEvidenceIds(workspace) {
  const map = {};
  if (!workspace) return map;
  for (const id of workspace.listIds('Evidence')) {
    const ev = workspace.getEvidence(id);
    if (!ev || !ev.detail || !ev.detail.nodeId) continue;
    if (ev.ref !== 'layout.signal' && !(ev.detail && ev.detail.layout === true)) continue;
    const nid = ev.detail.nodeId;
    if (!map[nid]) map[nid] = [];
    map[nid].push(ev.evidenceId);
  }
  return map;
}

async function materializeLayoutIR(env = {}) {
  if (!env.workspace) {
    throw new LayoutError(LayoutErrorKind.PUBLISH, 'workspace required');
  }

  const startedAt = (env.clock || Date.now)();
  const { graph } = loadNdgFromWorkspace(env.workspace);
  const index = indexGraph(graph);
  const interpretations = interpretGraph(graph, index, {
    recognitionHintsByNode: env.recognitionHintsByNode || {},
  });

  const projected = projectLayoutIR(graph, {
    interpretations,
    decisions: env.decisions || collectDecisions(env.workspace),
    evidenceIdMap: env.evidenceIdMap || collectLayoutEvidenceIds(env.workspace),
    suiteVersion: env.suiteVersion || '1.0.0',
    sliceId: env.sliceId,
  });

  const declaration = layoutPluginDeclaration();
  const result = await executePlugin({
    declaration,
    workspace: env.workspace,
    policy: env.policy || { profileId: 'default' },
    knowledge: env.knowledge || null,
    handler: async (ctx) => {
      // Decision read capability — ensure we don't write decisions
      if (typeof ctx.putDecision === 'function') {
        // deny surface exists on plugin ctx
      }
      const published = publishLayoutIR(ctx, projected, {
        fingerprint: env.fingerprint || null,
        timing: { startedAt, buildMs: (env.clock || Date.now)() - startedAt },
      });
      ctx.log('layout.ir.projected', {
        graphId: graph.graphId,
        checksum: projected.checksum,
      });
      return published;
    },
  });

  const endedAt = (env.clock || Date.now)();
  const published = result.result || {};
  const sliceId = published.sliceId || projected.slice.sliceId;

  // Phase 11b.1 — pin baseline + active (metadata only; never mutates slices)
  if (typeof env.workspace.setLayoutIrPin === 'function') {
    env.workspace.setLayoutIrPin(graph.graphId, {
      baselineLayoutIrSliceId: sliceId,
      activeLayoutIrSliceId: sliceId,
    }, { id: PLUGIN_ID });
  }

  return {
    pluginId: PLUGIN_ID,
    builderVersion: BUILDER_VERSION,
    graphId: graph.graphId,
    slice: projected.slice,
    checksum: projected.checksum,
    interpretations,
    report: published.report,
    sliceId,
    baselineLayoutIrSliceId: sliceId,
    activeLayoutIrSliceId: sliceId,
    timing: { startedAt, endedAt, ms: endedAt - startedAt },
    execute: result,
  };
}

module.exports = {
  materializeLayoutIR,
  collectDecisions,
  collectLayoutEvidenceIds,
};
