'use strict';
/**
 * Constraint Transcriber — re-express absolute oracle boxes as flex/grid.
 * General walk: A0–A5 on every freeform container; card-grid / banner / media-overlay
 * specializations when patterns match. Spec: docs/CONSTRAINT_TRANSCRIBER_SPEC.md
 */

const { detectTargets, isCardLikeFrame, isDarkBanner, findCardGridAt } = require('./detect');
const {
  transcribeCardGrid,
  transcribeBanner,
  transcribeCard,
  transcribeContainer,
  transcribeMediaOverlay,
  transcribeImageTopCard,
  promoteFlowSubtree,
} = require('./transcribe');
const { verifyAndDemote, verifyContainer } = require('./verify');
const { absBox, mergeClass, px, isVisible, unionBoxes } = require('./geometry');
const config = require('./config');

function repairImageTopCards(el) {
  if (!el) return;
  if (el._constraintImageTop) {
    (el.children || []).forEach((c) => {
      if (!c) return;
      if (/\bet-card__media\b/.test(c.extraClass || '')) return;
      if (/\bet-card__badge\b|\bet-badge\b/.test(c.extraClass || '')) {
        if (c.decls && c._oracleBox) {
          c.decls.set('position', 'absolute');
          c.decls.set('left', px(c._oracleBox.x));
          c.decls.set('top', px(c._oracleBox.y));
          c.decls.set('--et-badge-left', px(c._oracleBox.x));
          c.decls.set('--et-badge-top', px(c._oracleBox.y));
          c.decls.delete('right');
        }
        return;
      }
      promoteFlowSubtree(c);
    });
  }
  (el.children || []).forEach(repairImageTopCards);
}

function attachParents(el, parent) {
  if (!el) return;
  el._parent = parent || null;
  (el.children || []).forEach((c) => attachParents(c, el));
}

/**
 * Wrap a horizontal card band into a synthetic grid container when the parent
 * also holds header/chrome siblings (Articles pattern).
 */
function wrapCardBand(parent, cards) {
  if (!parent || !cards || cards.length < 2) return null;
  const kids = parent.children || [];
  const firstIdx = Math.min(...cards.map((c) => kids.indexOf(c)).filter((i) => i >= 0));
  if (firstIdx < 0) return null;
  const ub = unionBoxes(cards);
  if (!ub) return null;
  const wrapper = {
    kind: 'el',
    name: 'et-card-band',
    nodeId: `synthetic:card-band:${parent.nodeId || 'root'}`,
    tag: 'div',
    decls: new Map(),
    box: ub,
    children: [...cards],
    extraClass: '',
    _synthetic: true,
    _parent: parent,
  };
  cards.forEach((c) => { c._parent = wrapper; });
  parent.children = kids.filter((c) => !cards.includes(c));
  parent.children.splice(Math.min(firstIdx, parent.children.length), 0, wrapper);
  return wrapper;
}

/**
 * Title + "Read all" link on one row (Articles header): title left, link right.
 */
function wrapTitleLinkBand(parent) {
  if (!parent || !parent.children) return null;
  const kids = parent.children.filter(isVisible);
  const title = kids.find((c) => {
    if (!c || !absBox(c)) return false;
    if (c.tag === 'h1' || c.tag === 'h2') return true;
    const b = absBox(c);
    const t = String(c.text || c.name || '');
    return b.w >= 280 && b.h >= 36 && (c.text != null || c.runs || /look|article|latest/i.test(t));
  });
  if (!title) return null;
  const tb = absBox(title);
  const link = kids.find((c) => {
    if (!c || c === title || !absBox(c)) return false;
    const b = absBox(c);
    if (Math.abs(b.y - tb.y) > 48) return false;
    if (b.x < tb.x + tb.w * 0.5) return false;
    if (b.w > 280 || b.h > 48) return false;
    const label = String(c.text || c.name || '');
    return /read|log|all|view|more|→|->/i.test(label)
      || (c.children || []).some((x) => /read|log|arrow/i.test(String(x.text || x.name || '')));
  });
  if (!link) return null;

  const ub = unionBoxes([title, link]);
  if (!ub) return null;
  const wrapper = {
    kind: 'el',
    name: 'et-title-link-row',
    nodeId: `synthetic:title-link:${parent.nodeId || 'root'}`,
    tag: 'div',
    decls: new Map([
      ['display', 'flex'],
      ['flex-direction', 'row'],
      ['align-items', 'flex-end'],
      ['justify-content', 'space-between'],
      ['gap', '24px'],
      ['width', '100%'],
      ['max-width', '100%'],
      ['box-sizing', 'border-box'],
      ['position', 'relative'],
      ['flex', '0 0 auto'],
    ]),
    box: ub,
    children: [title, link],
    extraClass: 'et-title-link-row et-measured-flow',
    _synthetic: true,
    _constraintTranscribed: true,
    _constraintVerified: true,
    _standardsFlow: true,
    _parent: parent,
  };
  title._parent = wrapper;
  link._parent = wrapper;
  if (title.decls) {
    clearTitleAbs(title);
    title.decls.set('flex', '1 1 auto');
    title.decls.set('min-width', '0');
    title.decls.set('margin-top', '0');
    title.decls.set('width', 'auto');
    title.decls.set('max-width', 'none');
    title.decls.delete('height');
  }
  if (link.decls) {
    clearTitleAbs(link);
    link.decls.set('flex', '0 0 auto');
    link.decls.set('margin-left', 'auto');
    link.decls.set('margin-top', '0');
    link.decls.set('width', 'auto');
    link.decls.set('max-width', 'none');
    link.decls.delete('height');
    // Strip flow-row/stack so responsive CSS cannot force width:100%
    if (link.extraClass) {
      link.extraClass = String(link.extraClass)
        .split(/\s+/)
        .filter((c) => c && c !== 'et-flow-row' && c !== 'et-flow-stack' && c !== 'et-measured-flow')
        .join(' ');
    }
    link.extraClass = mergeClass(link.extraClass, 'et-title-link-row__cta et-hug');
  }
  const order = parent.children.filter((c) => c && c !== title && c !== link);
  const insertAt = Math.min(
    ...[title, link].map((c) => parent.children.indexOf(c)).filter((i) => i >= 0),
  );
  parent.children = order;
  parent.children.splice(Math.max(0, insertAt), 0, wrapper);
  return wrapper;
}

function clearTitleAbs(el) {
  if (!el || !el.decls) return;
  el.decls.delete('left');
  el.decls.delete('top');
  if (el.decls.get('position') === 'absolute') el.decls.delete('position');
  el.decls.set('position', 'relative');
}

function findParent(root, target) {
  let found = null;
  (function walk(n, p) {
    if (!n || found) return;
    if (n === target) { found = p; return; }
    (n.children || []).forEach((c) => walk(c, n));
  })(root, null);
  return found;
}

/**
 * Pin section to measured Figma content width (outer side gaps match artboard inset).
 * Prefer the nearest parent that already holds the card grid / banner — do not
 * walk up to the artboard (that left-aligns 1196 inside 1440).
 */
function applyMeasuredContentWidth(tree, anchors) {
  const list = (anchors || []).filter(Boolean);
  if (!list.length || !tree) return;

  const widths = list.map((a) => absBox(a) && absBox(a).w).filter(Boolean);
  if (!widths.length) return;
  const contentW = Math.round(Math.max(...widths));

  let shell = findParent(tree, list[0]);
  if (list.length > 1) {
    const parents = new Set();
    let p = list[0];
    while (p) {
      parents.add(p);
      p = findParent(tree, p);
    }
    let q = findParent(tree, list[1]);
    while (q && !parents.has(q)) q = findParent(tree, q);
    if (q) shell = q;
  }
  // Stay on the content column that owns the grid/cards — stop climbing to artboard
  while (shell && shell !== tree) {
    const cls = shell.extraClass || '';
    if (shell._etSectionShell || /\bet-section-shell\b/.test(cls)) break;
    const kids = shell.children || [];
    const ownsLayout = kids.some((c) => c && (
      c._etCardGrid || c._etBanner || c._etCard || c._constraintImageTop
      || /\bet-card-band\b/.test(c.extraClass || '')
    ));
    if (ownsLayout) break;
    const next = findParent(tree, shell);
    if (!next || next === tree) break;
    shell = next;
  }
  if (!shell || !shell.decls) shell = tree;
  if (!shell.decls) return;

  shell.decls.set('width', '100%');
  shell.decls.set('max-width', px(contentW));
  shell.decls.set('--et-content-max', px(contentW));
  shell.decls.set('margin-left', 'auto');
  shell.decls.set('margin-right', 'auto');
  shell.decls.set('box-sizing', 'border-box');
  shell.decls.set('align-self', 'center');
  shell.extraClass = mergeClass(shell.extraClass, 'et-measured-content');
  shell._constraintContentWidth = contentW;

  // Vertical center in artboard when Figma top/bottom insets are roughly equal
  const pageBox = absBox(tree);
  const shellBox = absBox(shell);
  if (pageBox && shellBox && pageBox.h > shellBox.h + 16) {
    const top = shellBox.y - pageBox.y;
    const bottom = (pageBox.y + pageBox.h) - (shellBox.y + shellBox.h);
    const balanced = Math.abs(top - bottom) <= Math.max(12, pageBox.h * 0.04);
    if (balanced || (top > 24 && bottom > 24)) {
      shell.decls.set('margin-top', 'auto');
      shell.decls.set('margin-bottom', 'auto');
      shell._constraintContentCentered = true;
      if (tree.decls) {
        tree.decls.set('display', 'flex');
        tree.decls.set('flex-direction', 'column');
        tree.decls.set('justify-content', 'center');
        tree.decls.set('align-items', 'stretch');
        tree.decls.set('--et-content-pad-y', px(Math.round((top + bottom) / 2)));
      }
    }
  }

  if (tree) {
    tree._constraintContentWidth = contentW;
    if (tree.decls) {
      tree.decls.set('--et-content-max', px(contentW));
    }
  }
}

function stampMeasured(el) {
  if (!el || !el.decls) return;
  const display = el.decls.get('display');
  if (display === 'grid') {
    el.extraClass = mergeClass(el.extraClass, 'et-measured-grid et-flow-row');
  } else if (display === 'flex') {
    const dir = el.decls.get('flex-direction') || 'row';
    el.extraClass = mergeClass(
      el.extraClass,
      dir === 'column' ? 'et-measured-flow et-flow-stack' : 'et-measured-flow et-flow-row',
    );
  } else {
    el.extraClass = mergeClass(el.extraClass, 'et-measured-shell');
  }
}

/**
 * Depth-first A5 walk: interiors first, then parent axis detection.
 * @returns {object[]} successfully transcribed containers (anchors)
 */
function walkFreeform(el, report, anchors) {
  if (!el) return;
  (el.children || []).forEach((c) => walkFreeform(c, report, anchors));

  if (el._sourceAutoLayout) return;
  if (el._constraintTranscribed) return;
  if (!el.box || !el.decls) return;

  const kids = (el.children || []).filter(isVisible);
  if (kids.length < 1) return;

  // Specialized: equal card grid at this node (or mixed-parent card band)
  const grid = findCardGridAt(el);
  if (grid) {
    let target = grid;
    if (grid.band) {
      const wrapper = wrapCardBand(el, grid.cards);
      if (wrapper) {
        target = { container: wrapper, cards: grid.cards };
      } else {
        target = null;
      }
    }
    if (target && transcribeCardGrid(target)) {
      report.grids += 1;
      report.cards += (target.cards || []).length;
      stampMeasured(target.container);
      anchors.push(target.container);
      // Same parent often has title + link that should sit on one row
      if (wrapTitleLinkBand(el)) report.containers += 1;
      return;
    }
  }

  // Title + CTA link row (even without a card grid on this node)
  if (wrapTitleLinkBand(el)) {
    report.containers += 1;
    anchors.push(el);
    // continue — parent may still need column transcription for badge/cards
  }

  // Specialized: dark quote banner
  if (isDarkBanner(el)) {
    if (transcribeBanner(el)) {
      report.banners += 1;
      stampMeasured(el);
      anchors.push(el);
      return;
    }
  }

  // Specialized: image-top article card (photo in-flow, content below, pill overlay)
  if (transcribeImageTopCard(el)) {
    report.cards += 1;
    stampMeasured(el);
    anchors.push(el);
    return;
  }

  // Specialized: card-like chrome frame (IBM-style icon/title/media-bottom)
  if (isCardLikeFrame(el)) {
    if (transcribeCard(el)) {
      report.cards += 1;
      stampMeasured(el);
      anchors.push(el);
      return;
    }
  }

  // Specialized: full-bleed caption-on-image (only when content overlaps media)
  if (transcribeMediaOverlay(el)) {
    report.overlays += 1;
    stampMeasured(el);
    anchors.push(el);
    return;
  }

  // General A0–A5
  if (kids.length >= 2 && transcribeContainer(el, { parent: el._parent })) {
    report.containers += 1;
    stampMeasured(el);
    anchors.push(el);
  }
}

/**
 * Run after Pass-1 oracle boxes exist (post unlock + snapshotAbs).
 * @param {object} tree
 */
function run(tree) {
  const report = {
    engine: 'constraint-transcriber-v2-general',
    grids: 0,
    banners: 0,
    cards: 0,
    containers: 0,
    overlays: 0,
    verified: 0,
    demoted: 0,
    reasons: [],
    contentWidth: null,
  };
  if (!tree) return report;

  attachParents(tree, null);
  const anchors = [];
  walkFreeform(tree, report, anchors);

  // Content width from card grids / banners / widest non-card measured region
  const grids = [];
  (function collect(el) {
    if (!el) return;
    if (el._etCardGrid || el._etBanner) grids.push(el);
    (el.children || []).forEach(collect);
  })(tree);
  const widthAnchors = grids.length
    ? grids
    : anchors.filter((a) => (
      a._constraintTranscribed && !a._etCard && !a._constraintMediaOverlay
    ));
  if (widthAnchors.length) {
    applyMeasuredContentWidth(tree, widthAnchors.slice(0, 4));
    report.contentWidth = tree._constraintContentWidth || null;
  }

  const v = verifyAndDemote(tree);
  report.demoted = v.demoted;
  report.reasons = v.reasons || [];

  function countVerified(el) {
    if (!el) return;
    if (el._constraintVerified) report.verified += 1;
    (el.children || []).forEach(countVerified);
  }
  countVerified(tree);

  report.promoted = report.grids + report.banners + report.cards + report.containers + report.overlays;
  if (tree) tree._constraintReport = report;
  return report;
}

function isTranscribedSubtree(el) {
  let n = el;
  while (n) {
    if (n._constraintDemoted) return false;
    if (n._constraintTranscribed && n._constraintVerified) return true;
    n = n._parent || null;
  }
  return !!(el && el._constraintTranscribed && el._constraintVerified);
}

function skipHeuristics(el) {
  if (!el) return false;
  if (el._constraintTranscribed) return true;
  let n = el._parent;
  while (n) {
    if (n._constraintTranscribed && !n._constraintDemoted) return true;
    if (n._constraintDemoted) return false;
    n = n._parent;
  }
  return false;
}

module.exports = {
  run,
  detectTargets,
  verifyContainer,
  verifyAndDemote,
  isTranscribedSubtree,
  skipHeuristics,
  applyMeasuredContentWidth,
  walkFreeform,
  repairImageTopCards,
  config,
};
