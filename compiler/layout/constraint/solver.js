'use strict';

/**
 * Deterministic constraint evaluation + policy-ordered relaxation.
 * Never commits Decisions. Never mutates NDG / LayoutIR₀.
 */

const { SOLVER_VERSION, STRENGTH, DEFAULT_RELAX_ORDER } = require('./constants');
const { num, boxOf } = require('./network');
const { indexGraph } = require('../collect');

function profileId(policy) {
  return (policy && policy.profileId) || 'default';
}

function relaxOrder(policy) {
  const custom = policy && policy.constraintRelaxOrder;
  if (Array.isArray(custom) && custom.length) return custom.slice();
  // pixel-faithful: same order but required never auto-dropped
  return DEFAULT_RELAX_ORDER.slice();
}

function evalGap(c) {
  const g = num(c.meta && c.meta.gap);
  if (g == null) return { ok: true };
  if (g < 0) return { ok: false, reason: 'negative_gap', severity: 'error' };
  return { ok: true };
}

function evalPadding(c) {
  const pads = (c.meta && c.meta.pads) || [];
  for (const p of pads) {
    if (p != null && p < 0) return { ok: false, reason: 'negative_padding', severity: 'error' };
  }
  return { ok: true };
}

function sumFlowExtent(graphIndex, childIds, axis, gap) {
  let sum = 0;
  let counted = 0;
  for (const id of childIds) {
    const n = graphIndex.byId.get(id);
    const box = boxOf(n);
    if (!box) continue;
    const dim = axis === 'vertical' ? num(box.height) : num(box.width);
    if (dim == null) continue;
    sum += dim;
    counted += 1;
  }
  if (counted > 1) sum += (gap || 0) * (counted - 1);
  return { sum, counted };
}

function evalParentFit(c, graphIndex) {
  const parentId = c.nodes[0];
  const parent = graphIndex.byId.get(parentId);
  const box = boxOf(parent);
  if (!box) return { ok: true, skipped: true };
  const axis = c.meta.axis;
  const parentDim = axis === 'vertical' ? num(box.height) : num(box.width);
  if (parentDim == null) return { ok: true, skipped: true };
  const { sum, counted } = sumFlowExtent(graphIndex, c.meta.childIds || [], axis, c.meta.gap || 0);
  if (counted === 0) return { ok: true, skipped: true };
  // allow 1px epsilon
  if (sum > parentDim + 1) {
    return {
      ok: false,
      reason: 'children_exceed_parent',
      severity: 'error',
      detail: { sum, parentDim, axis },
    };
  }
  return { ok: true, detail: { sum, parentDim } };
}

function evalOverflow(c, graphIndex) {
  // Same geometry as parent_fit but medium strength — soft overflow signal
  const r = evalParentFit(c, graphIndex);
  if (r.ok || r.skipped) return r;
  return { ...r, reason: 'overflow', severity: 'warn' };
}

function evalSizing(c) {
  const sizing = c.meta && c.meta.sizing;
  const box = c.meta && c.meta.box;
  if (!sizing) return { ok: true };
  // unknown sizing with missing box → weak inconsistency signal
  if ((sizing.horizontal === 'unknown' || sizing.vertical === 'unknown') && !box) {
    return { ok: false, reason: 'sizing_unknown_no_box', severity: 'warn' };
  }
  return { ok: true };
}

function evalAbsolute(c, graphIndex, layoutNodeMap) {
  const childId = c.meta.childId;
  const ln = layoutNodeMap.get(childId);
  if (!ln) return { ok: true, skipped: true };
  if (ln.positioning !== 'absolute' && ln.mode !== 'absolute') {
    return {
      ok: false,
      reason: 'outOfFlow_not_absolute',
      severity: 'error',
      detail: { childId, positioning: ln.positioning, mode: ln.mode },
    };
  }
  const n = graphIndex.byId.get(childId);
  if (!boxOf(n)) {
    return { ok: false, reason: 'absolute_missing_box', severity: 'warn', detail: { childId } };
  }
  return { ok: true };
}

function evaluateConstraint(c, graphIndex, layoutNodeMap) {
  switch (c.kind) {
    case 'gap_nonneg': return evalGap(c);
    case 'padding_nonneg': return evalPadding(c);
    case 'parent_fit': return evalParentFit(c, graphIndex);
    case 'overflow': return evalOverflow(c, graphIndex);
    case 'sizing_axis': return evalSizing(c);
    case 'absolute_bounds': return evalAbsolute(c, graphIndex, layoutNodeMap);
    default: return { ok: true, skipped: true };
  }
}

function committedRelaxIds(decisions) {
  const set = new Set();
  if (!Array.isArray(decisions)) return set;
  for (const d of decisions) {
    if (!d || d.question !== 'layout.constraint.relax') continue;
    const st = d.status;
    if (st !== 'arbitrated' && st !== 'fallen-back' && st !== 'overridden') continue;
    const w = d.winner;
    let answer = null;
    if (w && w.kind === 'candidate' && Array.isArray(d.candidates)) {
      const cand = d.candidates.find((x) => x.candidateId === w.candidateId);
      answer = cand && cand.answer;
    } else if (w && w.answer) {
      answer = w.answer;
    }
    if (answer && answer.constraintId) set.add(answer.constraintId);
    if (answer && answer.relax === 'none') set.add(`__none__:${d.subject}`);
  }
  return set;
}

/**
 * @param {object} network
 * @param {object} graph
 * @param {object} layoutIr
 * @param {{ policy?: object, decisions?: object[], maxRelaxations?: number }} [opts]
 */
function solveConstraints(network, graph, layoutIr, opts = {}) {
  const policy = opts.policy || {};
  const graphIndex = indexGraph(graph);
  const layoutNodeMap = new Map(
    ((layoutIr.payload && layoutIr.payload.nodes) || []).map((n) => [n.nodeId, n])
  );
  const decidedRelax = committedRelaxIds(opts.decisions);

  const results = [];
  for (const c of network.constraints) {
    const ev = evaluateConstraint(c, graphIndex, layoutNodeMap);
    results.push({
      constraintId: c.id,
      kind: c.kind,
      strength: c.strength,
      nodes: c.nodes,
      ok: ev.ok === true,
      skipped: ev.skipped === true,
      reason: ev.reason || null,
      severity: ev.severity || null,
      detail: ev.detail || null,
    });
  }

  let violations = results.filter((r) => !r.ok && !r.skipped);
  const relaxations = [];
  const evidence = [];
  const hypotheses = [];

  // Apply Decision-committed relaxations first
  for (const v of violations.slice()) {
    if (decidedRelax.has(v.constraintId)) {
      relaxations.push({
        constraintId: v.constraintId,
        action: 'drop',
        source: 'decision',
        strength: v.strength,
      });
      evidence.push({
        kind: 'other',
        ref: 'layout.constraint.relaxed',
        detail: {
          constraintId: v.constraintId,
          action: 'drop',
          via: 'decision',
          nodes: v.nodes,
        },
      });
      violations = violations.filter((x) => x.constraintId !== v.constraintId);
    }
  }

  // Deterministic auto-relax: weak → medium (never required without Decision)
  const order = relaxOrder(policy);
  const maxRelax = typeof opts.maxRelaxations === 'number' ? opts.maxRelaxations : 50;
  let relaxCount = 0;

  for (const strength of order) {
    if (strength === STRENGTH.REQUIRED) continue;
    const batch = violations
      .filter((v) => v.strength === strength)
      .sort((a, b) => (a.constraintId < b.constraintId ? -1 : 1));
    for (const v of batch) {
      if (relaxCount >= maxRelax) break;
      // Interpretive for medium/strong: propose Hypothesis instead of silent drop
      // unless pixel-faithful and strength is weak
      const autoDrop = strength === STRENGTH.WEAK
        || (profileId(policy) === 'pixel-faithful' && strength === STRENGTH.MEDIUM && v.kind === 'overflow');

      if (autoDrop) {
        relaxations.push({
          constraintId: v.constraintId,
          action: 'drop',
          source: 'policy-auto',
          strength,
        });
        evidence.push({
          kind: 'other',
          ref: 'layout.constraint.relaxed',
          detail: {
            constraintId: v.constraintId,
            action: 'drop',
            via: 'policy-auto',
            strength,
            reason: v.reason,
            nodes: v.nodes,
          },
        });
        violations = violations.filter((x) => x.constraintId !== v.constraintId);
        relaxCount += 1;
      } else {
        // Propose relax Hypothesis (Decision Runtime must commit)
        hypotheses.push({
          question: 'layout.constraint.relax',
          subject: v.nodes[0],
          constraintId: v.constraintId,
          candidates: [
            {
              candidateId: `cand:relax:${v.constraintId}:drop`,
              answer: { relax: 'drop', constraintId: v.constraintId, kind: v.kind },
              localScore: 0.55,
            },
            {
              candidateId: `cand:relax:${v.constraintId}:keep`,
              answer: { relax: 'none', constraintId: v.constraintId, kind: v.kind },
              localScore: 0.45,
              safeGeneric: true,
            },
          ],
          reason: v.reason,
          strength: v.strength,
        });
        evidence.push({
          kind: 'other',
          ref: 'layout.constraint.conflict',
          detail: {
            constraintId: v.constraintId,
            reason: v.reason,
            strength: v.strength,
            nodes: v.nodes,
            needsDecision: true,
          },
        });
      }
    }
  }

  // Remaining required / unresolved → unsat
  const unsat = violations
    .slice()
    .sort((a, b) => (a.constraintId < b.constraintId ? -1 : 1))
    .map((v) => ({
      nodeId: v.nodes[0],
      constraintId: v.constraintId,
      reason: v.reason || 'unsatisfied',
      severity: v.strength === STRENGTH.REQUIRED ? 'error' : 'warn',
      kind: v.kind,
      nodes: v.nodes,
    }));

  for (const u of unsat) {
    evidence.push({
      kind: 'other',
      ref: 'layout.constraint.unsat',
      detail: { ...u },
    });
  }

  let status = 'satisfied';
  if (hypotheses.length) status = 'needs_decision';
  else if (relaxations.length && unsat.length === 0) status = 'relaxed';
  else if (unsat.length) status = 'unsat';

  // Absolute-box fallback annotation when unsat remains under pixel-faithful
  const fallbackNodes = [];
  if (unsat.length && (profileId(policy) === 'pixel-faithful' || policy.absoluteFallback === true)) {
    for (const u of unsat) {
      for (const nid of u.nodes) {
        if (!fallbackNodes.includes(nid)) fallbackNodes.push(nid);
      }
    }
    fallbackNodes.sort();
    evidence.push({
      kind: 'other',
      ref: 'layout.constraint.fallback',
      detail: {
        action: 'absolute-box',
        nodes: fallbackNodes,
        via: 'policy',
      },
    });
    if (status === 'unsat') status = 'unsat'; // still unsat but with fallback plan
  }

  return {
    solverVersion: SOLVER_VERSION,
    status,
    results: results.sort((a, b) => (a.constraintId < b.constraintId ? -1 : 1)),
    violations: violations.slice(),
    relaxations: relaxations.sort((a, b) => (a.constraintId < b.constraintId ? -1 : 1)),
    unsat,
    hypotheses: hypotheses.sort((a, b) => (a.constraintId < b.constraintId ? -1 : 1)),
    evidence,
    fallbackNodes,
    policyProfileId: profileId(policy),
    networkSummary: {
      variableCount: network.variables.length,
      constraintCount: network.constraints.length,
    },
  };
}

module.exports = {
  solveConstraints,
  evaluateConstraint,
  committedRelaxIds,
  relaxOrder,
};
