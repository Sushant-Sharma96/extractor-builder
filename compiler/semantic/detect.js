'use strict';

/**
 * detect — pure semantic signals from NDG (+ optional layout).
 * Never mutates. Never commits Decisions.
 * Vocabulary is exporter-neutral (roles, not HTML tags).
 */

const {
  ROLE,
  LANDMARK_ROLES,
  EVIDENCE_SIGNAL,
  EVIDENCE_LANDMARK,
  EVIDENCE_HEADING,
  EVIDENCE_AMBIGUOUS,
  EVIDENCE_GROUP,
  EVIDENCE_SHAPE_HINT,
} = require('./constants');
// Phase 2 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — banner/divider role hints,
// sourced from the SAME geometric shape recognition Component IR consumes
// (compiler/rulepack/packs/component-detect/geometry-rules.js), not
// re-derived here — a recognized banner/divider shape is one structural
// fact, read by two IR domains.
const { detectComponentGeometry } = require('../rulepack/packs/component-detect/geometry-rules');

function attrs(node) {
  return (node && node.attributes) || {};
}

function upperType(node) {
  return String((node && node.type) || '').toUpperCase();
}

function nodeName(node) {
  return String((node && node.name) || '').trim();
}

/** Name → role hints (semantic labels, not tags). */
const NAME_PATTERNS = [
  { re: /^(nav|navbar|navigation|menu|menubar)$/i, role: ROLE.NAVIGATION, score: 0.85 },
  { re: /^(header|masthead|top.?bar|banner|site.?header)$/i, role: ROLE.BANNER, score: 0.85 },
  { re: /^(footer|site.?footer|colophon)$/i, role: ROLE.CONTENTINFO, score: 0.85 },
  { re: /^(main|content|primary|page.?content)$/i, role: ROLE.MAIN, score: 0.8 },
  { re: /^(aside|sidebar|side.?nav|rail)$/i, role: ROLE.COMPLEMENTARY, score: 0.8 },
  { re: /^(section|block|region|panel)$/i, role: ROLE.REGION, score: 0.7 },
  { re: /^(article|post|story)$/i, role: ROLE.ARTICLE, score: 0.75 },
  { re: /^(form|login|sign.?up|signup|contact.?form)$/i, role: ROLE.FORM, score: 0.8 },
  { re: /^(btn|button|cta|call.?to.?action)$/i, role: ROLE.BUTTON, score: 0.8 },
  { re: /^(ul|ol|list|item.?list|menu.?list)$/i, role: ROLE.LIST, score: 0.75 },
  { re: /^(li|list.?item|item)$/i, role: ROLE.LISTITEM, score: 0.7 },
];

function headingFromName(name) {
  const m = String(name || '').match(/^h([1-6])$/i)
    || String(name || '').match(/^heading\s*([1-6])$/i)
    || String(name || '').match(/^title\s*([1-6])$/i);
  if (!m) return null;
  return { role: ROLE.HEADING, level: Number(m[1]), score: 0.9 };
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
  const n = (graph.nodes || []).find((x) => x.id === nodeId);
  if (n && Array.isArray(n.childIds)) return [...n.childIds];
  return [];
}

function nameHints(name) {
  const out = [];
  const h = headingFromName(name);
  if (h) out.push(h);
  for (const p of NAME_PATTERNS) {
    if (p.re.test(name)) out.push({ role: p.role, level: null, score: p.score });
  }
  return out;
}

function structuralHints(graph, node, byId) {
  const out = [];
  const t = upperType(node);
  const name = nodeName(node).toLowerCase();
  const kids = childrenOf(graph, node.id).map((id) => byId.get(id)).filter(Boolean);

  if (t === 'TEXT' || name.includes('title') || name.includes('heading')) {
    const a = attrs(node);
    let level = 2;
    if (a.fontSize != null) {
      const fs = Number(a.fontSize);
      if (fs >= 32) level = 1;
      else if (fs >= 24) level = 2;
      else if (fs >= 18) level = 3;
      else level = 4;
    }
    out.push({ role: ROLE.HEADING, level, score: t === 'TEXT' ? 0.55 : 0.45 });
  }

  if (kids.length >= 3) {
    const types = kids.map(upperType);
    const same = types.every((x) => x === types[0]);
    if (same && (types[0] === 'FRAME' || types[0] === 'INSTANCE' || types[0] === 'TEXT')) {
      out.push({ role: ROLE.LIST, level: null, score: 0.6 });
    }
  }

  const inputish = kids.filter((k) => {
    const n = nodeName(k).toLowerCase();
    const ty = upperType(k);
    return /input|field|textarea|select|checkbox|radio/.test(n)
      || ty === 'INSTANCE' && /input|field/.test(n);
  });
  if (inputish.length >= 2 || (inputish.length >= 1 && /form/.test(name))) {
    out.push({ role: ROLE.FORM, level: null, score: 0.65 });
  }

  if (/btn|button|cta/.test(name) || (t === 'INSTANCE' && /button/.test(name))) {
    out.push({ role: ROLE.BUTTON, level: null, score: 0.7 });
  }

  return out;
}

function geometryHints(node, rootBox) {
  const out = [];
  const box = boxOf(node);
  if (!box || !rootBox || rootBox.height <= 0) return out;
  const relY = box.y / rootBox.height;
  const relH = box.height / rootBox.height;
  if (relY < 0.12 && relH < 0.25) {
    out.push({ role: ROLE.BANNER, level: null, score: 0.45 });
  }
  if (relY > 0.85) {
    out.push({ role: ROLE.CONTENTINFO, level: null, score: 0.45 });
  }
  if (box.width / Math.max(rootBox.width, 1) < 0.35 && relY > 0.1 && relY < 0.8) {
    out.push({ role: ROLE.COMPLEMENTARY, level: null, score: 0.4 });
  }
  return out;
}

/**
 * shapeHints — Phase 2 structural hints from recognized banner/divider
 * shapes (compiler/rulepack/packs/component-detect/geometry-rules.js).
 * Scored above geometryHints' weak positional BANNER guess (0.45) because a
 * recognized shape (dark chrome strip + text content, or a thin vertical
 * hairline between column-flex clusters) is a much stronger signal than raw
 * position-in-page.
 */
function shapeHints(nodeId, bannerNodeIds, dividerNodeIds) {
  const out = [];
  if (bannerNodeIds.has(nodeId)) out.push({ role: ROLE.BANNER, level: null, score: 0.75 });
  if (dividerNodeIds.has(nodeId)) out.push({ role: ROLE.SEPARATOR, level: null, score: 0.75 });
  return out;
}

function mergeCandidates(hintLists) {
  const byRole = new Map();
  for (const list of hintLists) {
    for (const h of list) {
      const prev = byRole.get(h.role);
      if (!prev || h.score > prev.score) {
        byRole.set(h.role, { role: h.role, level: h.level != null ? h.level : prev && prev.level, score: h.score });
      } else if (prev && h.level != null && prev.level == null) {
        prev.level = h.level;
      }
    }
  }
  return [...byRole.values()].sort((a, b) => b.score - a.score || (a.role < b.role ? -1 : 1));
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
function detectSemantics(graph, opts = {}) {
  const nodes = [...(graph.nodes || [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childIds = new Set(
    (graph.edges || []).filter((e) => e && e.kind === 'parent').map((e) => e.to)
  );
  const root = nodes.find((n) => !childIds.has(n.id)) || nodes[0];
  const rootBox = root ? boxOf(root) : null;

  const annotations = [];
  const landmarks = [];
  const headings = [];
  const groups = [];
  const ambiguous = [];
  const evidence = [];

  const profile = (opts.policy && opts.policy.profileId) || 'default';
  const conservative = profile === 'pixel-faithful';
  const minScore = conservative ? 0.7 : 0.55;

  // Phase 2 — recognized banner/divider shapes (see this file's imports),
  // computed once up front; consumed per-node below via shapeHints().
  // geometryCandidatesByNode (Phase 1's compiler/geometry candidates) is
  // optional — divider assignment safely degrades to "none" without it,
  // same documented degrade as compiler/components/detect.js.
  const geo = detectComponentGeometry(graph, {
    geometryCandidatesByNode: opts.geometryCandidatesByNode || {},
  });
  const bannerNodeIds = new Set(geo.bannerFacts.map((b) => b.nodeId));
  const dividerNodeIds = new Set(geo.dividerFacts.map((d) => d.nodeId));
  for (const b of geo.bannerFacts) {
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_SHAPE_HINT,
      detail: { nodeId: b.nodeId, role: ROLE.BANNER, source: 'geometry-rules' },
    });
  }
  for (const d of geo.dividerFacts) {
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_SHAPE_HINT,
      detail: { nodeId: d.nodeId, role: ROLE.SEPARATOR, source: 'geometry-rules' },
    });
  }

  for (const node of nodes) {
    const name = nodeName(node);
    const candidates = mergeCandidates([
      nameHints(name),
      structuralHints(graph, node, byId),
      geometryHints(node, rootBox),
      shapeHints(node.id, bannerNodeIds, dividerNodeIds),
    ]);

    if (candidates.length === 0) continue;

    const top = candidates[0];
    const second = candidates[1];
    const isAmbiguous = second
      && second.role !== top.role
      && (top.score - second.score) < 0.15
      && second.score >= 0.4;

    if (isAmbiguous) {
      ambiguous.push({
        nodeId: node.id,
        roles: candidates.slice(0, 3).map((c) => ({
          role: c.role,
          level: c.level != null ? c.level : null,
          score: Number(c.score.toFixed(4)),
        })),
      });
      evidence.push({
        kind: 'other',
        ref: EVIDENCE_AMBIGUOUS,
        detail: { nodeId: node.id, roles: candidates.slice(0, 3).map((c) => c.role) },
      });
    }

    if (top.score < minScore && !isAmbiguous) {
      // weak signal — record evidence only, annotate as generic if semantic-lean wants coverage
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_SIGNAL,
        detail: { nodeId: node.id, role: top.role, score: top.score, weak: true },
      });
      if (profile === 'semantic-lean' && top.score >= 0.45) {
        annotations.push({
          nodeId: node.id,
          role: top.role,
          level: top.level != null ? top.level : null,
          confidence: 'low',
          source: 'heuristic',
        });
      }
      continue;
    }

    if (isAmbiguous && conservative) {
      annotations.push({
        nodeId: node.id,
        role: ROLE.GENERIC,
        level: null,
        confidence: 'ambiguous',
        source: 'abstain',
        candidateRoles: candidates.slice(0, 3).map((c) => c.role),
      });
      continue;
    }

    const ann = {
      nodeId: node.id,
      role: top.role,
      level: top.role === ROLE.HEADING ? (top.level || 2) : null,
      confidence: top.score >= 0.8 ? 'high' : top.score >= 0.65 ? 'medium' : 'low',
      source: 'heuristic',
    };
    annotations.push(ann);

    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_SIGNAL,
      detail: { nodeId: node.id, role: ann.role, level: ann.level, score: top.score },
    });

    if (LANDMARK_ROLES.includes(ann.role)) {
      landmarks.push({ nodeId: node.id, role: ann.role });
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_LANDMARK,
        detail: { nodeId: node.id, role: ann.role },
      });
    }
    if (ann.role === ROLE.HEADING) {
      headings.push({ nodeId: node.id, level: ann.level || 2 });
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_HEADING,
        detail: { nodeId: node.id, level: ann.level || 2 },
      });
    }
  }

  // List groups: parents annotated as list → member children as listitem group
  for (const ann of annotations) {
    if (ann.role !== ROLE.LIST) continue;
    const members = childrenOf(graph, ann.nodeId);
    if (members.length < 2) continue;
    groups.push({
      groupId: `group:list:${ann.nodeId}`,
      kind: 'list',
      memberNodeIds: [...members].sort(),
      parentNodeId: ann.nodeId,
    });
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_GROUP,
      detail: { groupId: `group:list:${ann.nodeId}`, kind: 'list', count: members.length },
    });
    for (const mid of members) {
      if (annotations.some((a) => a.nodeId === mid)) continue;
      annotations.push({
        nodeId: mid,
        role: ROLE.LISTITEM,
        level: null,
        confidence: 'medium',
        source: 'group',
      });
    }
  }

  // Apply Decisions for semantic.role
  const decisions = opts.decisions || [];
  for (const d of decisions) {
    if (!d || d.question !== 'semantic.role') continue;
    const answer = decisionAnswer(d);
    if (!answer || !answer.role) continue;
    const subject = answer.nodeId || d.subject;
    if (!subject) continue;
    const existing = annotations.find((a) => a.nodeId === subject);
    if (existing) {
      existing.role = answer.role;
      existing.level = answer.level != null ? answer.level : (answer.role === ROLE.HEADING ? existing.level : null);
      existing.confidence = 'decision';
      existing.source = 'decision';
      existing.decisionIds = [d.decisionId || d.id].filter(Boolean);
      delete existing.candidateRoles;
    } else {
      annotations.push({
        nodeId: subject,
        role: answer.role,
        level: answer.level != null ? answer.level : null,
        confidence: 'decision',
        source: 'decision',
        decisionIds: [d.decisionId || d.id].filter(Boolean),
      });
    }
    // refresh landmarks/headings
    const ambIdx = ambiguous.findIndex((a) => a.nodeId === subject);
    if (ambIdx >= 0) ambiguous.splice(ambIdx, 1);
  }

  // Rebuild landmark/heading lists from final annotations
  landmarks.length = 0;
  headings.length = 0;
  for (const ann of annotations) {
    if (LANDMARK_ROLES.includes(ann.role) && ann.role !== ROLE.GENERIC) {
      landmarks.push({ nodeId: ann.nodeId, role: ann.role });
    }
    if (ann.role === ROLE.HEADING) {
      headings.push({ nodeId: ann.nodeId, level: ann.level || 2 });
    }
  }

  annotations.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  landmarks.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  headings.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1) || (a.level - b.level));
  groups.sort((a, b) => (a.groupId < b.groupId ? -1 : 1));
  ambiguous.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  evidence.sort((a, b) => {
    const ka = `${a.ref}:${JSON.stringify(a.detail)}`;
    const kb = `${b.ref}:${JSON.stringify(b.detail)}`;
    return ka < kb ? -1 : 1;
  });

  const metrics = {
    annotatedCount: annotations.length,
    landmarkCount: landmarks.length,
    headingCount: headings.length,
    groupCount: groups.length,
    ambiguousCount: ambiguous.length,
    coverageRate: nodes.length === 0
      ? 1
      : Number((annotations.length / nodes.length).toFixed(4)),
  };

  return {
    annotations,
    landmarks,
    headings,
    groups,
    ambiguous,
    metrics,
    evidence,
  };
}

module.exports = { detectSemantics, ROLE };
