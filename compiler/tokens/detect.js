'use strict';

/**
 * detect — extract token candidates + bindings from NDG.
 * Never mutates. Never commits Decisions.
 */

const {
  EVIDENCE_SIGNAL,
  EVIDENCE_BIND,
  EVIDENCE_LITERAL,
  EVIDENCE_AMBIGUOUS,
} = require('./constants');

function attrs(node) {
  return (node && node.attributes) || {};
}

function colorKeyFromPaint(paint) {
  if (!paint || typeof paint !== 'object') return null;
  if (paint.type && String(paint.type).toUpperCase() !== 'SOLID') return null;
  const c = paint.color || paint;
  if (c == null) return null;
  if (typeof c === 'string') return c.toLowerCase();
  const r = c.r != null ? Math.round(Number(c.r) * (c.r <= 1 ? 255 : 1)) : null;
  const g = c.g != null ? Math.round(Number(c.g) * (c.g <= 1 ? 255 : 1)) : null;
  const b = c.b != null ? Math.round(Number(c.b) * (c.b <= 1 ? 255 : 1)) : null;
  if (r == null || g == null || b == null) return null;
  // Figma often stores transparency on paint.opacity, not only color.a
  const aColor = c.a != null ? Number(c.a) : 1;
  const aPaint = paint.opacity != null ? Number(paint.opacity) : 1;
  const a = Math.max(0, Math.min(1, aColor * aPaint));
  return a < 0.999 ? `rgba(${r},${g},${b},${+a.toFixed(3)})` : `rgb(${r},${g},${b})`;
}

function spacingValues(node) {
  const a = attrs(node);
  const out = [];
  for (const key of ['itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
    if (a[key] != null && Number.isFinite(Number(a[key]))) {
      out.push({ property: key, value: Number(a[key]) });
    }
  }
  return out;
}

function typographyFrom(node) {
  const a = attrs(node);
  if (a.fontSize == null && !a.fontName && a.fontWeight == null) return null;
  return {
    fontSize: a.fontSize != null ? Number(a.fontSize) : null,
    fontWeight: a.fontWeight != null ? a.fontWeight : null,
    fontName: a.fontName || null,
  };
}

/**
 * @param {object} graph
 * @param {{ decisions?: object[], policy?: object }} [opts]
 */
function detectTokens(graph, opts = {}) {
  const nodes = [...(graph.nodes || [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  const colorFreq = new Map(); // value → [{nodeId, property}]
  const spacingFreq = new Map();
  const namedStyles = [];
  const evidence = [];
  const unboundLiterals = [];
  const ambiguous = [];

  for (const node of nodes) {
    const a = attrs(node);

    // Named styles / variables from source
    if (a.styles && typeof a.styles === 'object') {
      for (const [prop, styleId] of Object.entries(a.styles).sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        namedStyles.push({
          styleId: String(styleId),
          nodeId: node.id,
          property: prop,
        });
      }
    }
    if (a.boundVariables && typeof a.boundVariables === 'object') {
      for (const [prop, binding] of Object.entries(a.boundVariables).sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        const varId = binding && (binding.id || binding.variableId || binding);
        if (varId) {
          namedStyles.push({
            styleId: String(varId),
            nodeId: node.id,
            property: prop,
            kind: 'variable',
          });
        }
      }
    }

    const paints = Array.isArray(node.paints) ? node.paints : [];
    paints.forEach((paint, i) => {
      const key = colorKeyFromPaint(paint);
      if (!key) return;
      const property = i === 0 ? 'fill' : `fill[${i}]`;
      if (!colorFreq.has(key)) colorFreq.set(key, []);
      colorFreq.get(key).push({ nodeId: node.id, property });
    });

    for (const s of spacingValues(node)) {
      const key = String(s.value);
      if (!spacingFreq.has(key)) spacingFreq.set(key, []);
      spacingFreq.get(key).push({ nodeId: node.id, property: s.property });
    }

    const typo = typographyFrom(node);
    if (typo && typo.fontSize != null) {
      const key = `fs:${typo.fontSize}`;
      if (!spacingFreq.has(key)) {
        // reuse map as generic numeric — better separate; use typography map
      }
    }
  }

  // Build tokens: shared colors (2+ uses) + named styles + shared spacing (2+)
  const tokens = [];
  const tokenByValue = new Map();

  function ensureToken(tokenId, name, kind, value, source) {
    if (tokenByValue.has(tokenId)) return tokenByValue.get(tokenId);
    const t = { tokenId, name, kind, value, source };
    tokens.push(t);
    tokenByValue.set(tokenId, t);
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_SIGNAL,
      detail: { tokenId, kind, value, source },
    });
    return t;
  }

  for (const ns of namedStyles.sort((a, b) => (a.styleId < b.styleId ? -1 : 1))) {
    const tokenId = `tok:style:${ns.styleId}`;
    ensureToken(tokenId, ns.styleId, ns.kind === 'variable' ? 'variable' : 'style', ns.styleId, 'named');
  }

  for (const [value, refs] of [...colorFreq.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (refs.length >= 2) {
      const tokenId = `tok:color:${value}`;
      ensureToken(tokenId, value, 'color', value, 'shared-literal');
    }
  }

  for (const [value, refs] of [...spacingFreq.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (refs.length >= 2 && !value.startsWith('fs:')) {
      const tokenId = `tok:space:${value}`;
      ensureToken(tokenId, `space-${value}`, 'spacing', Number(value), 'shared-literal');
    }
  }

  // Bindings
  const bindings = [];

  for (const ns of namedStyles) {
    const tokenId = `tok:style:${ns.styleId}`;
    bindings.push({
      nodeId: ns.nodeId,
      property: ns.property,
      tokenId,
      confidence: 'high',
      source: 'named',
    });
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_BIND,
      detail: { nodeId: ns.nodeId, property: ns.property, tokenId, confidence: 'high' },
    });
  }

  for (const [value, refs] of colorFreq.entries()) {
    const tokenId = `tok:color:${value}`;
    if (!tokenByValue.has(tokenId)) {
      for (const r of refs) {
        unboundLiterals.push({ nodeId: r.nodeId, property: r.property, value, kind: 'color' });
        evidence.push({
          kind: 'other',
          ref: EVIDENCE_LITERAL,
          detail: { nodeId: r.nodeId, property: r.property, value, kind: 'color' },
        });
      }
      continue;
    }
    for (const r of refs) {
      bindings.push({
        nodeId: r.nodeId,
        property: r.property,
        tokenId,
        confidence: 'medium',
        source: 'shared-literal',
      });
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_BIND,
        detail: { nodeId: r.nodeId, property: r.property, tokenId, confidence: 'medium' },
      });
    }
  }

  for (const [value, refs] of spacingFreq.entries()) {
    if (value.startsWith('fs:')) continue;
    const tokenId = `tok:space:${value}`;
    if (!tokenByValue.has(tokenId)) {
      for (const r of refs) {
        unboundLiterals.push({
          nodeId: r.nodeId,
          property: r.property,
          value: Number(value),
          kind: 'spacing',
        });
        evidence.push({
          kind: 'other',
          ref: EVIDENCE_LITERAL,
          detail: { nodeId: r.nodeId, property: r.property, value: Number(value), kind: 'spacing' },
        });
      }
      continue;
    }
    for (const r of refs) {
      bindings.push({
        nodeId: r.nodeId,
        property: r.property,
        tokenId,
        confidence: 'medium',
        source: 'shared-literal',
      });
    }
  }

  // Ambiguous: same node property could map to two tokens (rare) — mark when duplicate bindings
  const bindKey = new Map();
  for (const b of bindings) {
    const k = `${b.nodeId}|${b.property}`;
    if (bindKey.has(k) && bindKey.get(k) !== b.tokenId) {
      ambiguous.push({
        nodeId: b.nodeId,
        property: b.property,
        tokenIds: [bindKey.get(k), b.tokenId].sort(),
      });
      evidence.push({
        kind: 'other',
        ref: EVIDENCE_AMBIGUOUS,
        detail: { nodeId: b.nodeId, property: b.property },
      });
    } else {
      bindKey.set(k, b.tokenId);
    }
  }

  // Apply Decisions for token.bind
  const decisions = opts.decisions || [];
  for (const d of decisions) {
    if (!d || d.question !== 'token.bind') continue;
    const st = d.status;
    if (st !== 'arbitrated' && st !== 'fallen-back' && st !== 'overridden') continue;
    let answer = null;
    const w = d.winner;
    if (w && w.kind === 'candidate' && Array.isArray(d.candidates)) {
      const cand = d.candidates.find((c) => c.candidateId === w.candidateId);
      answer = cand && cand.answer;
    } else if (w && w.answer) {
      answer = w.answer;
    }
    if (!answer || !answer.tokenId || !answer.nodeId || !answer.property) continue;
    const existing = bindings.find(
      (b) => b.nodeId === answer.nodeId && b.property === answer.property
    );
    if (existing) {
      existing.tokenId = answer.tokenId;
      existing.confidence = 'decision';
      existing.decisionIds = [d.decisionId || d.id].filter(Boolean);
    } else {
      bindings.push({
        nodeId: answer.nodeId,
        property: answer.property,
        tokenId: answer.tokenId,
        confidence: 'decision',
        source: 'decision',
        decisionIds: [d.decisionId || d.id].filter(Boolean),
      });
    }
    // remove from unbound if present
    const ui = unboundLiterals.findIndex(
      (u) => u.nodeId === answer.nodeId && u.property === answer.property
    );
    if (ui >= 0) unboundLiterals.splice(ui, 1);
  }

  tokens.sort((a, b) => (a.tokenId < b.tokenId ? -1 : 1));
  bindings.sort((a, b) => {
    const ka = `${a.nodeId}:${a.property}:${a.tokenId}`;
    const kb = `${b.nodeId}:${b.property}:${b.tokenId}`;
    return ka < kb ? -1 : 1;
  });
  unboundLiterals.sort((a, b) => {
    const ka = `${a.nodeId}:${a.property}`;
    const kb = `${b.nodeId}:${b.property}`;
    return ka < kb ? -1 : 1;
  });
  ambiguous.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  evidence.sort((a, b) => {
    const ka = `${a.ref}:${JSON.stringify(a.detail)}`;
    const kb = `${b.ref}:${JSON.stringify(b.detail)}`;
    return ka < kb ? -1 : 1;
  });

  const bindableSlots = bindings.length + unboundLiterals.length;
  const metrics = {
    tokenCount: tokens.length,
    bindingCount: bindings.length,
    unboundCount: unboundLiterals.length,
    ambiguousCount: ambiguous.length,
    tokenRate: bindableSlots === 0 ? 1 : Number((bindings.length / bindableSlots).toFixed(4)),
  };

  return {
    tokens,
    bindings,
    unboundLiterals,
    ambiguous,
    metrics,
    evidence,
  };
}

module.exports = { detectTokens, colorKeyFromPaint };
