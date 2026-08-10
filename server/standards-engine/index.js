'use strict';
/**
 * Standards Promotion Engine
 * Path B fidelity = internal oracle. Shippable QA artifact = flex/grid regions.
 * Absolute allowed only for overlays/badges inside promoted shells.
 */

function mergeClass(existing, add) {
  const parts = String(existing || '').split(/\s+/).filter(Boolean);
  String(add || '').split(/\s+/).filter(Boolean).forEach((c) => {
    if (!parts.includes(c)) parts.push(c);
  });
  return parts.join(' ');
}

function walk(el, fn) {
  if (!el) return;
  fn(el);
  (el.children || []).forEach((c) => walk(c, fn));
}

/** Detect layout regions already stamped by figma-build heuristics. */
function detectRegions(tree) {
  const regions = [];
  walk(tree, (el) => {
    if (el._etCard) {
      regions.push({ type: 'featureCard', nodeId: el.nodeId, name: el.name, confidence: 0.9 });
    }
    if (el._etCardGrid) {
      regions.push({ type: 'featureCardGrid', nodeId: el.nodeId, name: el.name, confidence: 0.92 });
    }
    if (el._etBanner) {
      regions.push({ type: 'quoteBanner', nodeId: el.nodeId, name: el.name, confidence: 0.9 });
    }
    if (/\bet-section-header\b/.test(el.extraClass || '')) {
      regions.push({ type: 'sectionHeader', nodeId: el.nodeId, name: el.name, confidence: 0.88 });
    }
  });
  return regions;
}

function countPathBShells(tree) {
  let n = 0;
  walk(tree, (el) => {
    if (el._pathB || /\bet-path-b\b/.test(el.extraClass || '')) n += 1;
  });
  return n;
}

function countAbs(tree) {
  let n = 0;
  walk(tree, (el) => {
    if (el.decls && el.decls.get('position') === 'absolute') n += 1;
  });
  return n;
}

/**
 * Ensure promoted cards/banners keep interactive stamps for :hover CSS.
 */
function ensureHoverStamps(tree, stats = { cards: 0, banners: 0 }) {
  walk(tree, (el) => {
    if (el._etCard) {
      el.extraClass = mergeClass(el.extraClass, 'et-card');
      stats.cards += 1;
    }
    if (el._etBanner) {
      el.extraClass = mergeClass(el.extraClass, 'et-banner');
      stats.banners += 1;
    }
  });
  return stats;
}

/**
 * Soft oracle: promoted layout should reduce page-level Path B and keep region stamps.
 * Does not rewrite the tree — reports pass/fail for scorecard.
 */
function evaluateOracle(tree, regions, fidelityAbs) {
  const pathB = countPathBShells(tree);
  const absNow = countAbs(tree);
  const hasCards = regions.some((r) => r.type === 'featureCard' || r.type === 'featureCardGrid');
  const hasBanner = regions.some((r) => r.type === 'quoteBanner');
  const hasHeader = regions.some((r) => r.type === 'sectionHeader');
  const layoutPromoted = hasCards || hasBanner || hasHeader;

  const failures = [];
  if (!layoutPromoted) {
    failures.push({ code: 'NO_REGIONS', message: 'No header/card/banner regions promoted to flex.' });
  }
  // Page-level Path B shell is QA-reject for the shippable artifact
  if (tree && tree._pathB) {
    failures.push({ code: 'PAGE_PATH_B', message: 'Root still sealed as Path B absolute artboard.' });
  }

  const absReduced = fidelityAbs == null || absNow <= fidelityAbs;
  if (!absReduced && layoutPromoted) {
    // Warning only — flex may keep badge absolute
  }

  return {
    pass: failures.length === 0,
    failures,
    pathBShells: pathB,
    absoluteCount: absNow,
    fidelityAbsCount: fidelityAbs,
    layoutPromoted,
    hasCards,
    hasBanner,
    hasHeader,
  };
}

/**
 * Mark root as standards section shell when promotion succeeded (no Path B host).
 */
function stampQaShell(tree, oracle) {
  if (!tree || !tree.decls || !oracle.layoutPromoted || tree._pathB) return;
  tree.extraClass = mergeClass(tree.extraClass, 'et-section-shell et-standards-promoted');
  if (tree.decls.get('position') === 'absolute') tree.decls.delete('position');
  if (!tree.decls.has('display')) {
    tree.decls.set('display', 'flex');
    tree.decls.set('flex-direction', 'column');
    tree.decls.set('align-items', 'stretch');
    tree.decls.set('width', '100%');
    tree.decls.set('max-width', '100%');
  }
  tree._standardsPromoted = true;
}

/**
 * Finalize after figma-build heuristics ran under unlock.
 * @param {object} tree
 * @param {{ fidelityAbsCount?: number }} opts
 */
function promote(tree, opts = {}) {
  const fidelityAbs = opts.fidelityAbsCount != null ? opts.fidelityAbsCount : countAbs(tree);
  const regions = detectRegions(tree);
  const hover = ensureHoverStamps(tree);
  const oracle = evaluateOracle(tree, regions, fidelityAbs);
  stampQaShell(tree, oracle);

  const promotedPct = regions.length
    ? Math.round((regions.filter((r) => r.confidence >= 0.85).length / Math.max(regions.length, 1)) * 100)
    : 0;

  const report = {
    engine: 'standards-promotion-v1',
    regions,
    hoverStamped: hover,
    oracle,
    promotedPct,
    qaReady: oracle.pass,
    pathBShells: oracle.pathBShells,
  };
  if (tree) tree._standardsReport = report;
  return report;
}

module.exports = {
  promote,
  detectRegions,
  ensureHoverStamps,
  evaluateOracle,
  countPathBShells,
  countAbs,
};
