'use strict';

/**
 * detect — pure responsive signals from NDG (+ optional LayoutIR).
 * Never mutates. Never commits Decisions.
 * Vocabulary is exporter-neutral (strategies / breakpoints — not CSS media queries).
 */

const {
  STRATEGY,
  DEFAULT_BREAKPOINTS,
  EVIDENCE_SIGNAL,
  EVIDENCE_BREAKPOINT,
  EVIDENCE_ADAPT,
  EVIDENCE_AMBIGUOUS,
  EVIDENCE_GROUP,
} = require('./constants');

function attrs(node) {
  return (node && node.attributes) || {};
}

function boxOf(node) {
  const a = attrs(node);
  const b = node.box || a.absoluteBoundingBox || a.bounds || null;
  if (!b || typeof b !== 'object') return null;
  return {
    x: Number(b.x) || 0,
    y: Number(b.y) || 0,
    width: Number(b.width != null ? b.width : b.w) || 0,
    height: Number(b.height != null ? b.height : b.h) || 0,
  };
}

function childrenOf(graph, nodeId) {
  const edges = (graph.edges || []).filter(
    (e) => e && e.kind === 'parent' && e.from === nodeId
  );
  if (edges.length) {
    return edges
      .slice()
      .sort((a, b) => (a.index != null && b.index != null ? a.index - b.index : 0))
      .map((e) => e.to)
      .filter(Boolean);
  }
  return [];
}

function layoutModeFor(nodeId, layoutIr, node) {
  if (layoutIr && layoutIr.payload && Array.isArray(layoutIr.payload.nodes)) {
    const n = layoutIr.payload.nodes.find((x) => x.nodeId === nodeId);
    if (n && n.mode) return String(n.mode);
  }
  const lm = String(attrs(node).layoutMode || '').toUpperCase();
  if (lm === 'HORIZONTAL') return 'flow-row';
  if (lm === 'VERTICAL') return 'flow-column';
  return null;
}

function decisionAnswer(d) {
  const st = d.status;
  if (st !== 'arbitrated' && st !== 'fallen-back' && st !== 'overridden') return null;
  const w = d.winner;
  if (w && w.kind === 'candidate' && Array.isArray(d.candidates)) {
    const cand = d.candidates.find((c) => c.candidateId === w.candidateId);
    return cand && cand.answer;
  }
  if (w && w.answer) return w.answer;
  return null;
}

/**
 * @param {object} graph
 * @param {{ layoutIr?: object|null, layoutDegraded?: boolean, decisions?: object[], policy?: object }} [opts]
 */
function detectResponsive(graph, opts = {}) {
  const nodes = [...(graph.nodes || [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const profile = (opts.policy && opts.policy.profileId) || 'default';
  const conservative = profile === 'pixel-faithful';

  const breakpoints = DEFAULT_BREAKPOINTS.map((bp) => ({
    ...bp,
    source: 'default',
    confidence: 'medium',
  }));

  const adaptations = [];
  const groups = [];
  const ambiguous = [];
  const evidence = [];

  for (const bp of breakpoints) {
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_BREAKPOINT,
      detail: {
        breakpointId: bp.breakpointId,
        kind: bp.kind,
        widthHint: bp.widthHint,
      },
    });
  }

  const narrowId = 'bp:narrow';
  const rowCandidates = [];

  for (const node of nodes) {
    const kids = childrenOf(graph, node.id).map((id) => byId.get(id)).filter(Boolean);
    const mode = layoutModeFor(node.id, opts.layoutIr, node);
    const box = boxOf(node);
    const a = attrs(node);
    const candidates = [];

    if (mode === 'flow-row' && kids.length >= 2) {
      candidates.push({ strategy: STRATEGY.STACK, score: 0.75, at: [narrowId] });
      candidates.push({ strategy: STRATEGY.WRAP, score: 0.65, at: [narrowId] });
      candidates.push({ strategy: STRATEGY.ROW, score: conservative ? 0.7 : 0.4, at: ['bp:wide'] });
      rowCandidates.push(node.id);
    }

    if (mode === 'flow-column' && kids.length >= 2) {
      candidates.push({ strategy: STRATEGY.SPACE_TIGHTEN, score: 0.55, at: [narrowId] });
      candidates.push({ strategy: STRATEGY.SPACE_PRESERVE, score: conservative ? 0.65 : 0.45, at: [narrowId] });
    }

    if (box && box.width >= 900 && kids.length >= 3 && (mode === 'flow-row' || !mode)) {
      candidates.push({ strategy: STRATEGY.STACK, score: 0.7, at: [narrowId] });
      candidates.push({ strategy: STRATEGY.WRAP, score: 0.6, at: [narrowId] });
    }

    const overflow = String(a.overflow || a.overflowDirection || '').toUpperCase();
    if (overflow.includes('SCROLL') || overflow === 'VERTICAL' || overflow === 'HORIZONTAL') {
      candidates.push({ strategy: STRATEGY.FIXED, score: 0.55, at: [narrowId, 'bp:medium'] });
      candidates.push({ strategy: STRATEGY.STACK, score: 0.5, at: [narrowId] });
    }

    // Absolute / out-of-flow: prefer fixed or hide at narrow
    if (String(a.layoutPositioning || '').toUpperCase() === 'ABSOLUTE'
      || String(a.constraints && a.constraints.horizontal || '').toLowerCase() === 'scale') {
      candidates.push({ strategy: STRATEGY.FIXED, score: 0.6, at: [narrowId] });
      candidates.push({ strategy: STRATEGY.HIDE, score: 0.45, at: [narrowId] });
    }

    if (candidates.length === 0) continue;

    // Merge by strategy (keep best score)
    const byStrat = new Map();
    for (const c of candidates) {
      const prev = byStrat.get(c.strategy);
      if (!prev || c.score > prev.score) byStrat.set(c.strategy, c);
    }
    const merged = [...byStrat.values()].sort((x, y) => y.score - x.score || (x.strategy < y.strategy ? -1 : 1));
    const top = merged[0];
    const second = merged[1];
    const isAmbiguous = second
      && (top.score - second.score) < 0.15
      && second.score >= 0.45;

    if (isAmbiguous) {
      ambiguous.push({
        nodeId: node.id,
        strategies: merged.slice(0, 3).map((c) => ({
          strategy: c.strategy,
          score: Number(c.score.toFixed(4)),
          atBreakpointIds: [...(c.at || [])],
        })),
      });
      evidence.push({
        kind: 'other',
        ref: EVIDENCE_AMBIGUOUS,
        detail: { nodeId: node.id, strategies: merged.slice(0, 3).map((c) => c.strategy) },
      });
    }

    if (isAmbiguous && conservative) {
      adaptations.push({
        nodeId: node.id,
        strategy: STRATEGY.ABSTAIN,
        atBreakpointIds: [narrowId],
        confidence: 'ambiguous',
        source: 'abstain',
        candidateStrategies: merged.slice(0, 3).map((c) => c.strategy),
      });
      continue;
    }

    const minScore = conservative ? 0.65 : 0.5;
    if (top.score < minScore && !isAmbiguous) {
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_SIGNAL,
        detail: { nodeId: node.id, strategy: top.strategy, score: top.score, weak: true },
      });
      continue;
    }

    adaptations.push({
      nodeId: node.id,
      strategy: top.strategy,
      atBreakpointIds: [...(top.at || [narrowId])].sort(),
      confidence: top.score >= 0.75 ? 'high' : top.score >= 0.6 ? 'medium' : 'low',
      source: 'heuristic',
      layoutMode: mode,
    });

    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_ADAPT,
      detail: {
        nodeId: node.id,
        strategy: top.strategy,
        atBreakpointIds: top.at || [narrowId],
        score: top.score,
      },
    });
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_SIGNAL,
      detail: { nodeId: node.id, strategy: top.strategy, layoutMode: mode },
    });
  }

  if (rowCandidates.length >= 2) {
    const members = [...rowCandidates].sort();
    groups.push({
      groupId: `group:responsive-row:${members[0]}`,
      kind: 'responsive-cluster',
      memberNodeIds: members,
    });
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_GROUP,
      detail: { groupId: `group:responsive-row:${members[0]}`, count: members.length },
    });
  }

  // Apply Decisions for responsive.strategy
  const decisions = opts.decisions || [];
  for (const d of decisions) {
    if (!d || d.question !== 'responsive.strategy') continue;
    const answer = decisionAnswer(d);
    if (!answer || !answer.strategy) continue;
    const subject = answer.nodeId || d.subject;
    if (!subject) continue;
    const existing = adaptations.find((a) => a.nodeId === subject);
    if (existing) {
      existing.strategy = answer.strategy;
      existing.atBreakpointIds = Array.isArray(answer.atBreakpointIds)
        ? [...answer.atBreakpointIds].sort()
        : existing.atBreakpointIds;
      existing.confidence = 'decision';
      existing.source = 'decision';
      existing.decisionIds = [d.decisionId || d.id].filter(Boolean);
      delete existing.candidateStrategies;
    } else {
      adaptations.push({
        nodeId: subject,
        strategy: answer.strategy,
        atBreakpointIds: Array.isArray(answer.atBreakpointIds)
          ? [...answer.atBreakpointIds].sort()
          : [narrowId],
        confidence: 'decision',
        source: 'decision',
        decisionIds: [d.decisionId || d.id].filter(Boolean),
      });
    }
    const ambIdx = ambiguous.findIndex((a) => a.nodeId === subject);
    if (ambIdx >= 0) ambiguous.splice(ambIdx, 1);
  }

  // Breakpoint honor/abstain decisions (optional)
  for (const d of decisions) {
    if (!d || d.question !== 'responsive.breakpoint') continue;
    const answer = decisionAnswer(d);
    if (!answer || !answer.breakpointId) continue;
    const bp = breakpoints.find((b) => b.breakpointId === answer.breakpointId);
    if (!bp) continue;
    if (answer.honor === false) {
      bp.source = 'decision-abstain';
      bp.confidence = 'decision';
      bp.honored = false;
    } else {
      bp.source = 'decision';
      bp.confidence = 'decision';
      bp.honored = true;
      if (answer.widthHint != null) bp.widthHint = Number(answer.widthHint);
    }
    bp.decisionIds = [d.decisionId || d.id].filter(Boolean);
  }

  adaptations.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  groups.sort((a, b) => (a.groupId < b.groupId ? -1 : 1));
  ambiguous.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  evidence.sort((a, b) => {
    const ka = `${a.ref}:${JSON.stringify(a.detail)}`;
    const kb = `${b.ref}:${JSON.stringify(b.detail)}`;
    return ka < kb ? -1 : 1;
  });

  const adaptable = adaptations.filter((a) => a.strategy !== STRATEGY.ABSTAIN).length;
  const metrics = {
    breakpointCount: breakpoints.length,
    adaptationCount: adaptations.length,
    activeAdaptationCount: adaptable,
    groupCount: groups.length,
    ambiguousCount: ambiguous.length,
    coverageRate: nodes.length === 0
      ? 1
      : Number((adaptations.length / nodes.length).toFixed(4)),
  };

  return {
    breakpoints,
    adaptations,
    groups,
    ambiguous,
    metrics,
    evidence,
  };
}

module.exports = { detectResponsive, STRATEGY };
