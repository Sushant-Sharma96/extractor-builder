'use strict';

/**
 * detect — accessibility signals from NDG (+ optional SemanticIR / LayoutIR).
 * Never mutates. Never commits Decisions. Never writes SemanticIR.
 * Vocabulary is exporter-neutral (no HTML/ARIA attribute strings).
 */

const {
  ACCESS_ROLE,
  KEYBOARD_HINT,
  VALIDATION_STATUS,
  EVIDENCE_SIGNAL,
  EVIDENCE_NAME,
  EVIDENCE_FOCUS,
  EVIDENCE_LABEL,
  EVIDENCE_IMAGE,
  EVIDENCE_VALIDATE,
  EVIDENCE_AMBIGUOUS,
  EVIDENCE_SEMANTIC,
} = require('./constants');

function attrs(node) {
  return (node && node.attributes) || {};
}

function nodeName(node) {
  return String((node && node.name) || '').trim();
}

function upperType(node) {
  return String((node && node.type) || '').toUpperCase();
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
  if (!edges.length) return [];
  return edges
    .slice()
    .sort((a, b) => (a.index != null && b.index != null ? a.index - b.index : 0))
    .map((e) => e.to)
    .filter(Boolean);
}

function textContent(node) {
  const a = attrs(node);
  if (a.characters != null) return String(a.characters).trim();
  return '';
}

function semanticIndex(semanticIr) {
  const byNode = new Map();
  if (!semanticIr || !semanticIr.payload) return byNode;
  for (const ann of semanticIr.payload.annotations || []) {
    byNode.set(ann.nodeId, ann);
  }
  return byNode;
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

function looksLikeImage(node) {
  const t = upperType(node);
  const n = nodeName(node).toLowerCase();
  if (t === 'RECTANGLE' || t === 'ELLIPSE' || t === 'VECTOR' || t === 'BOOLEAN_OPERATION') {
    const a = attrs(node);
    if (a.fills || (node.paints && node.paints.length)) return true;
  }
  return /image|img|photo|icon|logo|avatar/.test(n);
}

function looksInteractive(node, semAnn) {
  const n = nodeName(node).toLowerCase();
  if (/btn|button|cta|link|tab|toggle|checkbox|radio|input|field/.test(n)) return true;
  if (semAnn && (semAnn.role === 'button' || semAnn.role === 'navigation' || semAnn.role === 'form')) {
    return true;
  }
  return false;
}

/**
 * @param {object} graph
 * @param {{
 *   layoutIr?: object|null,
 *   semanticIr?: object|null,
 *   layoutDegraded?: boolean,
 *   semanticDegraded?: boolean,
 *   decisions?: object[],
 *   policy?: object,
 * }} [opts]
 */
function detectAccessibility(graph, opts = {}) {
  const nodes = [...(graph.nodes || [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const semByNode = semanticIndex(opts.semanticIr);
  const profile = (opts.policy && opts.policy.profileId) || 'default';
  const conservative = profile === 'pixel-faithful';

  const names = [];
  const focusOrder = [];
  const focusGroups = [];
  const labelLinks = [];
  const imageAccess = [];
  const validations = [];
  const warnings = [];
  const ambiguous = [];
  const keyboardHints = [];
  const evidence = [];

  if (opts.semanticIr) {
    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_SEMANTIC,
      detail: {
        sliceId: opts.semanticIr.sliceId || null,
        checksum: opts.semanticIr.checksum || null,
        graphId: opts.semanticIr.graphId || graph.graphId,
        readOnly: true,
      },
    });
  } else if (opts.semanticDegraded) {
    evidence.push({
      kind: 'other',
      ref: EVIDENCE_SIGNAL,
      detail: { semanticDegraded: true },
    });
  }

  const interactiveIds = [];

  for (const node of nodes) {
    const sem = semByNode.get(node.id) || null;
    const nameLayer = nodeName(node);
    const text = textContent(node);
    const interactive = looksInteractive(node, sem);
    const image = looksLikeImage(node);

    // Accessible name candidates (neutral — not aria-label)
    const nameCands = [];
    if (text) nameCands.push({ candidateName: text, source: 'text-content', score: 0.85 });
    if (nameLayer && !/^frame|group|rectangle|ellipse$/i.test(nameLayer)) {
      nameCands.push({ candidateName: nameLayer, source: 'layer-name', score: 0.55 });
    }
    if (sem && sem.role === 'heading' && text) {
      nameCands.push({ candidateName: text, source: 'heading-text', score: 0.9 });
    }

    if (nameCands.length > 1) {
      const top = nameCands.sort((a, b) => b.score - a.score)[0];
      const second = nameCands[1];
      if (second && Math.abs(top.score - second.score) < 0.2
        && top.candidateName !== second.candidateName) {
        ambiguous.push({
          nodeId: node.id,
          question: 'a11y.name',
          candidates: nameCands.slice(0, 3).map((c) => ({
            candidateName: c.candidateName,
            source: c.source,
            score: Number(c.score.toFixed(4)),
          })),
        });
        evidence.push({
          kind: 'other',
          ref: EVIDENCE_AMBIGUOUS,
          detail: { nodeId: node.id, question: 'a11y.name' },
        });
      }
    }

    if (nameCands.length) {
      const best = [...nameCands].sort((a, b) => b.score - a.score)[0];
      const needsName = interactive || (sem && ['button', 'navigation', 'form', 'heading'].includes(sem.role));
      if (needsName || best.score >= 0.7 || profile === 'semantic-lean') {
        names.push({
          nodeId: node.id,
          candidateName: best.candidateName,
          source: best.source,
          confidence: best.score >= 0.8 ? 'high' : best.score >= 0.6 ? 'medium' : 'low',
        });
        evidence.push({
          kind: 'feature',
          ref: EVIDENCE_NAME,
          detail: {
            nodeId: node.id,
            candidateName: best.candidateName,
            source: best.source,
          },
        });
      }
    } else if (interactive || (sem && sem.role === 'button')) {
      warnings.push({
        nodeId: node.id,
        code: 'missing-accessible-name',
        severity: 'warn',
        message: 'Interactive node lacks accessible name candidate',
      });
      validations.push({
        nodeId: node.id,
        kind: 'name',
        status: VALIDATION_STATUS.FAIL,
        detail: { reason: 'no-name-candidate' },
      });
      evidence.push({
        kind: 'other',
        ref: EVIDENCE_VALIDATE,
        detail: { nodeId: node.id, kind: 'name', status: 'fail' },
      });
      if (!conservative) {
        ambiguous.push({
          nodeId: node.id,
          question: 'a11y.name',
          candidates: [
            { candidateName: nameLayer || node.id, source: 'fallback-id', score: 0.2 },
          ],
        });
      }
    }

    // Keyboard / focus (neutral hints)
    if (interactive) {
      interactiveIds.push(node.id);
      keyboardHints.push({
        nodeId: node.id,
        hint: KEYBOARD_HINT.ACTIVATE,
        accessRole: ACCESS_ROLE.INTERACTIVE,
      });
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_FOCUS,
        detail: { nodeId: node.id, hint: KEYBOARD_HINT.ACTIVATE },
      });
    } else if (sem && ['navigation', 'main', 'banner', 'contentinfo', 'complementary', 'region'].includes(sem.role)) {
      keyboardHints.push({
        nodeId: node.id,
        hint: KEYBOARD_HINT.SKIP,
        accessRole: ACCESS_ROLE.LANDMARK,
      });
    } else if (sem && sem.role === 'heading') {
      keyboardHints.push({
        nodeId: node.id,
        hint: KEYBOARD_HINT.NONE,
        accessRole: ACCESS_ROLE.HEADING,
      });
    }

    // Image accessibility
    if (image) {
      const decorative = /decor|bg|background|ornament/.test(nameLayer.toLowerCase());
      imageAccess.push({
        nodeId: node.id,
        needsDescription: !decorative,
        candidateName: decorative ? null : (text || nameLayer || null),
        accessRole: decorative ? ACCESS_ROLE.DECORATIVE : ACCESS_ROLE.STATIC,
      });
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_IMAGE,
        detail: {
          nodeId: node.id,
          needsDescription: !decorative,
          decorative,
        },
      });
      if (!decorative && !text && !nameLayer) {
        warnings.push({
          nodeId: node.id,
          code: 'image-missing-description',
          severity: 'warn',
          message: 'Image-like node needs description candidate',
        });
        validations.push({
          nodeId: node.id,
          kind: 'image',
          status: VALIDATION_STATUS.WARN,
          detail: { reason: 'missing-description' },
        });
      }
    }

    // Landmark / heading validation from Semantic evidence (read-only)
    if (sem && ['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'region'].includes(sem.role)) {
      const hasName = names.some((n) => n.nodeId === node.id);
      validations.push({
        nodeId: node.id,
        kind: 'landmark',
        status: hasName || sem.role === 'main' ? VALIDATION_STATUS.PASS : VALIDATION_STATUS.WARN,
        detail: { semanticRole: sem.role, hasName },
      });
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_VALIDATE,
        detail: { nodeId: node.id, kind: 'landmark', semanticRole: sem.role },
      });
    }
    if (sem && sem.role === 'heading') {
      const level = sem.level || null;
      validations.push({
        nodeId: node.id,
        kind: 'heading',
        status: level != null ? VALIDATION_STATUS.PASS : VALIDATION_STATUS.WARN,
        detail: { level, hasText: !!text },
      });
      evidence.push({
        kind: 'feature',
        ref: EVIDENCE_VALIDATE,
        detail: { nodeId: node.id, kind: 'heading', level },
      });
    }

    evidence.push({
      kind: 'feature',
      ref: EVIDENCE_SIGNAL,
      detail: {
        nodeId: node.id,
        interactive,
        image,
        semanticRole: sem ? sem.role : null,
      },
    });
  }

  // Focus order: reading order by (y, x) among interactive nodes
  const focusables = interactiveIds
    .map((id) => {
      const n = byId.get(id);
      const box = n ? boxOf(n) : null;
      return {
        nodeId: id,
        y: box ? box.y : 0,
        x: box ? box.x : 0,
      };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.nodeId < b.nodeId ? -1 : 1));

  focusables.forEach((f, i) => {
    focusOrder.push({
      nodeId: f.nodeId,
      order: i + 1,
      groupId: 'focus:default',
    });
  });

  if (focusables.length >= 2) {
    focusGroups.push({
      groupId: 'focus:default',
      memberNodeIds: focusables.map((f) => f.nodeId),
      kind: 'tab-sequence',
    });
  }

  // Label associations: TEXT near interactive / form-like siblings
  for (const node of nodes) {
    const kids = childrenOf(graph, node.id).map((id) => byId.get(id)).filter(Boolean);
    const texts = kids.filter((k) => upperType(k) === 'TEXT' || textContent(k));
    const controls = kids.filter((k) => looksInteractive(k, semByNode.get(k.id)));
    if (texts.length && controls.length) {
      for (let i = 0; i < Math.min(texts.length, controls.length); i += 1) {
        const labelNode = texts[i];
        const control = controls[i];
        const labelText = textContent(labelNode) || nodeName(labelNode);
        labelLinks.push({
          controlNodeId: control.id,
          labelNodeId: labelNode.id,
          candidateName: labelText || null,
          confidence: 'medium',
          source: 'sibling-proximity',
        });
        evidence.push({
          kind: 'feature',
          ref: EVIDENCE_LABEL,
          detail: {
            controlNodeId: control.id,
            labelNodeId: labelNode.id,
          },
        });
        // Promote label text as name for control if missing
        if (!names.some((n) => n.nodeId === control.id) && labelText) {
          names.push({
            nodeId: control.id,
            candidateName: labelText,
            source: 'label-association',
            confidence: 'medium',
          });
        }
      }
    }
  }

  // Apply Decisions
  const decisions = opts.decisions || [];
  for (const d of decisions) {
    if (!d) continue;
    if (d.question === 'a11y.name') {
      const answer = decisionAnswer(d);
      if (!answer) continue;
      const subject = answer.nodeId || d.subject;
      if (!subject || !answer.candidateName) continue;
      const existing = names.find((n) => n.nodeId === subject);
      if (existing) {
        existing.candidateName = answer.candidateName;
        existing.source = 'decision';
        existing.confidence = 'decision';
        existing.decisionIds = [d.decisionId || d.id].filter(Boolean);
      } else {
        names.push({
          nodeId: subject,
          candidateName: answer.candidateName,
          source: 'decision',
          confidence: 'decision',
          decisionIds: [d.decisionId || d.id].filter(Boolean),
        });
      }
      const wi = warnings.findIndex((w) => w.nodeId === subject && w.code === 'missing-accessible-name');
      if (wi >= 0) warnings.splice(wi, 1);
      const ambIdx = ambiguous.findIndex((a) => a.nodeId === subject && a.question === 'a11y.name');
      if (ambIdx >= 0) ambiguous.splice(ambIdx, 1);
    }
    if (d.question === 'a11y.role') {
      const answer = decisionAnswer(d);
      if (!answer) continue;
      const subject = answer.nodeId || d.subject;
      if (!subject || !answer.accessRole) continue;
      const kh = keyboardHints.find((k) => k.nodeId === subject);
      if (kh) {
        kh.accessRole = answer.accessRole;
        kh.source = 'decision';
        kh.decisionIds = [d.decisionId || d.id].filter(Boolean);
      } else {
        keyboardHints.push({
          nodeId: subject,
          hint: answer.hint || KEYBOARD_HINT.NONE,
          accessRole: answer.accessRole,
          source: 'decision',
          decisionIds: [d.decisionId || d.id].filter(Boolean),
        });
      }
    }
  }

  names.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  focusOrder.sort((a, b) => a.order - b.order);
  focusGroups.sort((a, b) => (a.groupId < b.groupId ? -1 : 1));
  labelLinks.sort((a, b) => (a.controlNodeId < b.controlNodeId ? -1 : 1));
  imageAccess.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  validations.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1) || (a.kind < b.kind ? -1 : 1));
  warnings.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1) || (a.code < b.code ? -1 : 1));
  ambiguous.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  keyboardHints.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  evidence.sort((a, b) => {
    const ka = `${a.ref}:${JSON.stringify(a.detail)}`;
    const kb = `${b.ref}:${JSON.stringify(b.detail)}`;
    return ka < kb ? -1 : 1;
  });

  const metrics = {
    nameCount: names.length,
    focusableCount: focusOrder.length,
    labelLinkCount: labelLinks.length,
    imageCount: imageAccess.length,
    warningCount: warnings.length,
    validationFailCount: validations.filter((v) => v.status === VALIDATION_STATUS.FAIL).length,
    ambiguousCount: ambiguous.length,
    semanticConsumed: !!opts.semanticIr,
  };

  return {
    names,
    focusOrder,
    focusGroups,
    labelLinks,
    imageAccess,
    validations,
    warnings,
    ambiguous,
    keyboardHints,
    metrics,
    evidence,
    semanticEvidence: opts.semanticIr
      ? {
        sliceId: opts.semanticIr.sliceId || null,
        checksum: opts.semanticIr.checksum || null,
        readOnly: true,
      }
      : null,
  };
}

module.exports = { detectAccessibility, ACCESS_ROLE, KEYBOARD_HINT };
