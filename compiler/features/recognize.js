'use strict';

/**
 * Phase 9 — probabilistic low-level recognition candidates from features.
 * Produces scored candidates only — no Decisions.
 */

const { BLOCK_KINDS } = require('./kinds');
const { extractFeatures } = require('./extract');

function nameHints(name) {
  if (!name) return Object.freeze([]);
  const n = String(name).toLowerCase();
  const hits = [];
  if (/\bbtn\b|button|cta|submit/.test(n)) hits.push('button-like');
  if (/\bcard\b|tile|panel/.test(n)) hits.push('card-like');
  if (/\bsection\b|band|region/.test(n)) hits.push('section');
  if (/\bdivider\b|separator|hr\b/.test(n)) hits.push('divider');
  if (/\blist\b|items?/.test(n)) hits.push('list');
  if (/\bgrid\b/.test(n)) hits.push('grid');
  if (/\bstack\b|row\b|column\b/.test(n)) hits.push('stack');
  if (/\bimage\b|img\b|photo|thumb/.test(n)) hits.push('image-block');
  if (/\btext\b|label|title|heading|paragraph/.test(n)) hits.push('text-block');
  if (/\bcontainer\b|wrapper|group/.test(n)) hits.push('container-like');
  return Object.freeze(hits);
}

function patternIdFor(kind) {
  return `pattern:block.${kind}`;
}

/**
 * @param {object} featuresOrRaw
 * @param {{ patternNameCap?: number|null }} [opts]
 * @returns {{ candidates: object[], evidence: object[], nearMisses: object[] }}
 */
function recognizeBlockKinds(featuresOrRaw, opts = {}) {
  const extracted = featuresOrRaw.features
    ? featuresOrRaw
    : extractFeatures(featuresOrRaw);
  const f = extracted.features;
  const meta = extracted.meta;
  const cap = typeof opts.patternNameCap === 'number' ? opts.patternNameCap : 0.4;

  /** @type {Map<string, { kind: string, localScore: number, cues: string[], nameOnly: boolean }>} */
  const scores = new Map();

  function bump(kind, score, cue, nameOnly = false) {
    if (!BLOCK_KINDS.includes(kind)) return;
    const prev = scores.get(kind) || { kind, localScore: 0, cues: [], nameOnly: true };
    const next = {
      kind,
      localScore: Math.max(prev.localScore, score),
      cues: prev.cues.includes(cue) ? prev.cues : [...prev.cues, cue],
      nameOnly: prev.nameOnly && nameOnly,
    };
    if (!nameOnly) next.nameOnly = false;
    scores.set(kind, next);
  }

  const nearMisses = [];

  // Structural cues
  if (f.nodeType === 'TEXT') {
    bump('text-block', 0.85, 'nodeType:TEXT', false);
  }
  if (meta.imageLike || f.nodeType === 'IMAGE') {
    bump('image-block', 0.85, 'imageLike', false);
  }

  const h = f.dimensions && f.dimensions.height;
  const w = f.dimensions && f.dimensions.width;
  if (h != null && h > 0 && h <= 4 && w != null && w >= 40) {
    bump('divider', 0.8, 'thin-horizontal', false);
  } else if (h != null && h > 4 && h <= 8 && w != null && w >= 40) {
    nearMisses.push({ target: 'divider', reason: 'height-near-thin', height: h });
  }

  if (meta.hasAutoLayout && (f.autoLayout.mode === 'HORIZONTAL' || f.autoLayout.mode === 'VERTICAL')) {
    bump('stack', 0.75, `autoLayout:${f.autoLayout.mode}`, false);
  }

  const childCount = meta.childCount || 0;
  if (meta.hasAutoLayout && childCount >= 4 && f.autoLayout && f.autoLayout.gap != null) {
    bump('grid', 0.55, 'autoLayout+manyChildren', false);
  } else if (childCount >= 4 && !meta.hasAutoLayout) {
    nearMisses.push({ target: 'grid', reason: 'many-children-without-autoLayout', childCount });
  }

  if (meta.hasAutoLayout && f.autoLayout && f.autoLayout.mode === 'VERTICAL' && childCount >= 3) {
    bump('list', 0.6, 'vertical-stack-children', false);
  }

  if (
    (f.nodeType === 'FRAME' || f.nodeType === 'COMPONENT' || f.nodeType === 'INSTANCE' || f.nodeType === 'GROUP')
    && childCount >= 1
  ) {
    bump('container-like', 0.5, 'frame-with-children', false);
  }

  if (
    (f.nodeType === 'FRAME' || f.nodeType === 'COMPONENT' || f.nodeType === 'INSTANCE')
    && f.fill
    && f.radius != null
    && f.padding
  ) {
    bump('card-like', 0.7, 'fill+radius+padding', false);
  } else if (f.fill && f.radius != null && !f.padding) {
    nearMisses.push({ target: 'card-like', reason: 'fill+radius-missing-padding' });
  }

  if (
    (f.nodeType === 'FRAME' || f.nodeType === 'COMPONENT' || f.nodeType === 'INSTANCE')
    && w != null && h != null
    && w <= 320 && h <= 72
    && (f.fill || f.stroke || f.radius != null)
  ) {
    bump('button-like', 0.65, 'compact-interactive-shape', false);
  }

  if (
    (f.nodeType === 'FRAME' || f.nodeType === 'GROUP')
    && ((w != null && w >= 600) || childCount >= 2)
  ) {
    bump('section', 0.45, 'wide-or-multi-child-frame', false);
  }

  // Name-only cues (capped later)
  for (const hint of nameHints(f.name)) {
    bump(hint, 0.55, `name:${hint}`, true);
  }

  // Always retain generic-block
  bump('generic-block', 0.4, 'fallback', false);

  const candidates = [...scores.values()]
    .map((c) => {
      let localScore = Math.min(1, Math.max(0, c.localScore));
      if (c.nameOnly) {
        localScore = Math.min(localScore, cap);
      }
      return Object.freeze({
        candidateId: `cand:${c.kind}`,
        answer: Object.freeze({
          blockKind: c.kind,
          patternRef: patternIdFor(c.kind),
        }),
        localScore,
        priorityBand: 'P5',
        patternRef: patternIdFor(c.kind),
        safeGeneric: c.kind === 'generic-block',
        nameOnly: c.nameOnly,
        cues: Object.freeze([...c.cues].sort()),
      });
    })
    .sort((a, b) => {
      if (b.localScore !== a.localScore) return b.localScore - a.localScore;
      return a.answer.blockKind.localeCompare(b.answer.blockKind);
    });

  const evidence = [
    Object.freeze({
      kind: 'feature',
      ref: 'feature:recognition.signals',
      detail: Object.freeze({
        presentKeys: extracted.presentKeys,
        nodeType: f.nodeType,
        childCount,
        nameHints: nameHints(f.name),
      }),
    }),
  ];

  for (const nm of nearMisses) {
    evidence.push(Object.freeze({
      kind: 'other',
      ref: 'near_miss',
      detail: Object.freeze({ ...nm }),
    }));
  }

  return Object.freeze({
    candidates: Object.freeze(candidates),
    evidence: Object.freeze(evidence),
    nearMisses: Object.freeze(nearMisses.slice()),
    extracted,
  });
}

module.exports = {
  recognizeBlockKinds,
  nameHints,
  patternIdFor,
};
