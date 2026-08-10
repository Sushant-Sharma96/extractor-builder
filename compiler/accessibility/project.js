'use strict';

const { BUILDER_VERSION, STAGE_ID } = require('./constants');
const { accessibilityIrChecksum } = require('./checksum');
const { deepFreeze } = require('./collect');
const { detectAccessibility } = require('./detect');
const { AccessibilityError, AccessibilityErrorKind } = require('./errors');

function projectAccessibilityIR(graph, opts = {}) {
  if (!graph || !graph.graphId) {
    throw new AccessibilityError(AccessibilityErrorKind.INVALID_INPUT, 'graph required');
  }

  const detected = opts.detected || detectAccessibility(graph, {
    decisions: opts.decisions || [],
    policy: opts.policy || {},
    layoutIr: opts.layoutIr || null,
    layoutDegraded: opts.layoutDegraded === true,
    semanticIr: opts.semanticIr || null,
    semanticDegraded: opts.semanticDegraded === true,
  });

  const payload = {
    graphId: graph.graphId,
    builderVersion: BUILDER_VERSION,
    names: detected.names.map((n) => {
      const copy = {
        nodeId: n.nodeId,
        candidateName: n.candidateName,
        source: n.source,
        confidence: n.confidence,
      };
      if (n.decisionIds) copy.decisionIds = [...n.decisionIds];
      return copy;
    }),
    focusOrder: detected.focusOrder.map((f) => ({ ...f })),
    focusGroups: detected.focusGroups.map((g) => ({
      ...g,
      memberNodeIds: [...g.memberNodeIds],
    })),
    labelLinks: detected.labelLinks.map((l) => ({ ...l })),
    imageAccess: detected.imageAccess.map((i) => ({ ...i })),
    validations: detected.validations.map((v) => ({
      ...v,
      detail: v.detail ? { ...v.detail } : null,
    })),
    warnings: detected.warnings.map((w) => ({ ...w })),
    ambiguous: detected.ambiguous.map((a) => ({
      nodeId: a.nodeId,
      question: a.question,
      candidates: (a.candidates || []).map((c) => ({ ...c })),
    })),
    keyboardHints: detected.keyboardHints.map((k) => {
      const copy = {
        nodeId: k.nodeId,
        hint: k.hint,
        accessRole: k.accessRole,
      };
      if (k.source) copy.source = k.source;
      if (k.decisionIds) copy.decisionIds = [...k.decisionIds];
      return copy;
    }),
    metrics: { ...detected.metrics },
    semanticEvidence: detected.semanticEvidence
      ? { ...detected.semanticEvidence }
      : null,
  };

  const checksum = accessibilityIrChecksum(payload);
  const sliceId = opts.sliceId || `slice:a11y:${graph.graphId}`;
  const nodeIds = [
    ...payload.names.map((n) => n.nodeId),
    ...payload.focusOrder.map((f) => f.nodeId),
    ...payload.imageAccess.map((i) => i.nodeId),
  ].sort();

  const frozen = deepFreeze({
    contractId: 'SpecializedIrEnvelope',
    suiteVersion: opts.suiteVersion || graph.suiteVersion || '1.0.0',
    stageId: STAGE_ID,
    sliceId,
    nodeIds: [...new Set(nodeIds)],
    graphId: graph.graphId,
    checksum,
    builderVersion: BUILDER_VERSION,
    payload,
  });

  return {
    slice: frozen,
    checksum,
    detected,
    builderVersion: BUILDER_VERSION,
  };
}

module.exports = { projectAccessibilityIR };
