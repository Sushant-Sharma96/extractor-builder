'use strict';

/**
 * materialize — collect → detect → project → publish
 * Never mutates SemanticIR.
 */

const { executePlugin } = require('../plugin');
const { collectAccessibilityInputs } = require('./collect');
const { detectAccessibility } = require('./detect');
const { projectAccessibilityIR } = require('./project');
const { publishAccessibilityIR } = require('./publish');
const { accessibilityPluginDeclaration } = require('./declaration');
const { PLUGIN_ID, BUILDER_VERSION } = require('./constants');
const { AccessibilityError, AccessibilityErrorKind } = require('./errors');

async function materializeAccessibilityIR(env = {}) {
  if (!env.workspace) {
    throw new AccessibilityError(AccessibilityErrorKind.PUBLISH, 'workspace required');
  }

  const startedAt = (env.clock || Date.now)();
  const collected = collectAccessibilityInputs(env.workspace, {
    decisions: env.decisions,
    layoutIr: env.layoutIr,
    layoutSliceId: env.layoutSliceId,
    skipLayout: env.skipLayout,
    semanticIr: env.semanticIr,
    semanticSliceId: env.semanticSliceId,
    skipSemantic: env.skipSemantic,
  });

  // Capture SemanticIR checksum before project for immutability check in tests
  const semanticChecksumBefore = collected.semanticIr
    ? collected.semanticIr.checksum
    : null;

  const detected = detectAccessibility(collected.graph, {
    decisions: collected.decisions,
    policy: env.policy || {},
    layoutIr: collected.layoutIr,
    layoutDegraded: collected.layoutDegraded,
    semanticIr: collected.semanticIr,
    semanticDegraded: collected.semanticDegraded,
  });

  const projected = projectAccessibilityIR(collected.graph, {
    detected,
    decisions: collected.decisions,
    policy: env.policy || {},
    layoutIr: collected.layoutIr,
    layoutDegraded: collected.layoutDegraded,
    semanticIr: collected.semanticIr,
    semanticDegraded: collected.semanticDegraded,
    suiteVersion: env.suiteVersion || '1.0.0',
    sliceId: env.sliceId,
  });

  const declaration = accessibilityPluginDeclaration();
  const result = await executePlugin({
    declaration,
    workspace: env.workspace,
    policy: env.policy || { profileId: 'default' },
    knowledge: env.knowledge || null,
    handler: async (ctx) => {
      const published = publishAccessibilityIR(ctx, projected, {
        fingerprint: env.fingerprint || null,
        timing: { startedAt, buildMs: (env.clock || Date.now)() - startedAt },
      });
      ctx.log('accessibility.ir.projected', {
        graphId: collected.graph.graphId,
        checksum: projected.checksum,
      });
      return published;
    },
  });

  const endedAt = (env.clock || Date.now)();
  const published = result.result || {};

  // Re-read SemanticIR — must be unchanged
  let semanticUnchanged = true;
  if (semanticChecksumBefore && collected.semanticIr && collected.semanticIr.sliceId) {
    const after = env.workspace.getIrSlice(collected.semanticIr.sliceId);
    if (after && after.checksum !== semanticChecksumBefore) {
      semanticUnchanged = false;
    }
  }

  return {
    pluginId: PLUGIN_ID,
    builderVersion: BUILDER_VERSION,
    graphId: collected.graph.graphId,
    slice: projected.slice,
    checksum: projected.checksum,
    detected,
    report: published.report,
    sliceId: published.sliceId || projected.slice.sliceId,
    semanticUnchanged,
    timing: { startedAt, endedAt, ms: endedAt - startedAt },
    execute: result,
  };
}

module.exports = { materializeAccessibilityIR };
