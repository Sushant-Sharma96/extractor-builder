'use strict';
/**
 * Phase 0 dual-path classifier + Path B composition + structural demote oracle.
 * See docs/STAKEHOLDER_FIGMA_SCALE_MODEL.md and engine strategy plan.
 */

/** Calibrated config — safety is the demote gate, not this number. */
const AL_COVERAGE_THRESHOLD = Number(process.env.FIGMA_AL_COVERAGE_THRESHOLD);
const AL_COVERAGE = Number.isFinite(AL_COVERAGE_THRESHOLD) && AL_COVERAGE_THRESHOLD > 0
  ? AL_COVERAGE_THRESHOLD
  : 0.8;

const STRUCTURAL_BOX_TOL_PX = Number(process.env.FIGMA_STRUCTURAL_BOX_TOL_PX);
const BOX_TOL = Number.isFinite(STRUCTURAL_BOX_TOL_PX) && STRUCTURAL_BOX_TOL_PX >= 0
  ? STRUCTURAL_BOX_TOL_PX
  : 4;

const px = (n) => `${Math.round((n + 1e-9) * 100) / 100}px`;

function mergeClass(existing, add) {
  const parts = String(existing || '').split(/\s+/).filter(Boolean);
  String(add || '').split(/\s+/).filter(Boolean).forEach((c) => {
    if (!parts.includes(c)) parts.push(c);
  });
  return parts.join(' ');
}

function isContainerEl(el) {
  if (!el || el.kind === 'img' || el.kind === 'svg') return false;
  if (el.text != null || el.runs) return false;
  return Array.isArray(el.children);
}

/** Layout-participating = visible walked node (analyze already drops visible:false). */
function isLayoutParticipating(el) {
  return !!(el && el.decls);
}

/**
 * Layout-bearing container = visible container with ≥2 layout-participating children.
 */
function isLayoutBearingContainer(el) {
  if (!isContainerEl(el)) return false;
  const kids = (el.children || []).filter(isLayoutParticipating);
  return kids.length >= 2;
}

function countAbsPlaced(el, acc = { n: 0 }) {
  if (!el) return acc;
  if (el.decls && el.decls.get('position') === 'absolute') acc.n += 1;
  (el.children || []).forEach((c) => countAbsPlaced(c, acc));
  return acc;
}

/**
 * alCoverage(subtree) = (# layout-bearing with AL) / (# layout-bearing)
 * Denominator 0 → 0 (Path B).
 */
function computeAlCoverage(el) {
  let bearing = 0;
  let al = 0;
  function walk(n) {
    if (!n) return;
    if (isLayoutBearingContainer(n)) {
      bearing += 1;
      if (n._sourceAutoLayout) al += 1;
    }
    (n.children || []).forEach(walk);
  }
  walk(el);
  if (bearing === 0) return 0;
  return al / bearing;
}

/**
 * Per-subtree route. Assigns _route, _alCoverage on every layout-bearing container + root.
 */
function classifySubtreeRoutes(root, threshold = AL_COVERAGE) {
  const summary = { routeA: 0, routeB: 0, demoted: 0, nodes: [] };
  if (!root) return summary;

  function walk(el, isRoot) {
    if (!el) return;
    (el.children || []).forEach((c) => walk(c, false));
    if (!isRoot && !isLayoutBearingContainer(el)) return;

    const cov = computeAlCoverage(el);
    el._alCoverage = cov;
    el._route = cov >= threshold ? 'A' : 'B';
    el._demoteReason = null;
    if (el._route === 'A') summary.routeA += 1;
    else summary.routeB += 1;
    summary.nodes.push({
      name: el.name,
      nodeId: el.nodeId,
      route: el._route,
      alCoverage: Math.round(cov * 1000) / 1000,
    });
  }

  walk(root, true);
  inheritRoutes(root, root._route || 'B');
  root._dualPath = {
    threshold,
    boxTolPx: BOX_TOL,
    routeA: summary.routeA,
    routeB: summary.routeB,
  };
  return summary;
}

function effectiveRoute(el) {
  if (!el) return 'B';
  if (el._pathB) return 'B';
  if (el._route === 'A' || el._route === 'B') return el._route;
  return 'B'; // unclassified → no Path A heuristics (safe default)
}

function shouldRunPathAHeuristics(el) {
  return effectiveRoute(el) === 'A';
}

/**
 * Unlock Path B freeform for Standards Promotion (flex/grid QA bar).
 * Saves classifier route on `_alRoute`. Used by product `auto` + explicit `standard`.
 * Eng `pixel` never unlocks — keeps absolute fidelity oracle.
 */
function unlockForFlexAttempt(root) {
  if (!root) return;
  function walk(el) {
    if (!el) return;
    if (el._route === 'A' || el._route === 'B') {
      el._alRoute = el._route;
    }
    if (el._route === 'B') el._route = 'A';
    (el.children || []).forEach(walk);
  }
  walk(root);
}

/** True when a flex/grid recovery stamp exists (not Path B seal). */
function subtreeHasRecovery(el) {
  if (!el) return false;
  if (el._etCard || el._etBanner || el._etCardGrid || el._standardsFlow || el._standardsPromoted) return true;
  return (el.children || []).some(subtreeHasRecovery);
}

function isInsideBanner(el, root) {
  // Walk not available — use flag stamped during polish/collapse
  return !!(el && (el._etBanner || el._bannerChild));
}

function stampBannerDescendants(el) {
  if (!el) return;
  const mark = !!(el._etBanner || el._bannerChild);
  (el.children || []).forEach((c) => {
    if (!c) return;
    if (mark || el._etBanner) c._bannerChild = true;
    stampBannerDescendants(c);
  });
}

/**
 * Seal only freeform shells that never recovered to flex (and were classified B).
 * Does not blanket-absolute a page that already has et-card / et-banner recovery.
 * Never seals *inside* a recovered flex subtree (would re-introduce absolute artboard).
 */
function sealUnresolvedFreeform(root) {
  if (!root) return;
  function walk(el, isRoot, insideSealed, insideRecovered, insideBanner) {
    if (!el || insideSealed) return;
    const bannerHere = !!(el._etBanner || el._bannerChild || insideBanner);
    const recoveredHere = !!(
      el._etCard || el._etBanner || el._etCardGrid || el._standardsFlow
      || el._constraintTranscribed || el._constraintImageTop || el._constraintVerified
    );
    const inRecovered = insideRecovered || recoveredHere || bannerHere;
    const bearing = isRoot || isLayoutBearingContainer(el);
    const classifiedB = el._alRoute === 'B' || (el._alRoute == null && el._route === 'B');
    if (bearing && classifiedB && el.box && !el._pathB) {
      if (inRecovered || subtreeHasRecovery(el) || bannerHere) {
        el._route = 'A';
        (el.children || []).forEach((c) => walk(c, false, false, true, bannerHere));
        return;
      }
      sortChildrenVisualY(el);
      sealPathB(el);
      return;
    }
    (el.children || []).forEach((c) => walk(c, false, !!el._pathB, inRecovered, bannerHere));
  }
  walk(root, true, false, false, false);
}

/**
 * Top-down: non-bearing nodes inherit nearest ancestor route so heuristics
 * cannot mutate inside a Path B subtree.
 */
function inheritRoutes(el, inherited) {
  if (!el) return;
  if (!el._route) el._route = inherited || 'B';
  (el.children || []).forEach((c) => inheritRoutes(c, el._route));
}

function overlapsBox(a, b, tol = BOX_TOL) {
  return a.x < b.x + b.width - tol && a.x + a.width > b.x + tol
    && a.y < b.y + b.height - tol && a.y + a.height > b.y + tol;
}

function figmaOverlapped(a, b) {
  if (!a.box || !b.box) return false;
  return overlapsBox(a.box, b.box, BOX_TOL);
}

function domOrderMatchesVisualY(el) {
  const kids = (el.children || []).filter((c) => c && c.box);
  if (kids.length < 2) return true;
  for (let i = 1; i < kids.length; i++) {
    const prev = kids[i - 1].box;
    const cur = kids[i].box;
    if (cur.y + BOX_TOL < prev.y) return false;
    if (Math.abs(cur.y - prev.y) <= BOX_TOL && cur.x + BOX_TOL < prev.x) return false;
  }
  return true;
}

function sortChildrenVisualY(el) {
  if (!el || !el.children || el.children.length < 2) return;
  const withBox = el.children.filter((c) => c && c.box);
  const without = el.children.filter((c) => !c || !c.box);
  withBox.sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));
  el.children = [...withBox, ...without];
}

function hasNewOverlaps(el) {
  const kids = (el.children || []).filter((c) => c && c.box && c.decls);
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i];
      const b = kids[j];
      if (figmaOverlapped(a, b)) continue;
      const ab = laidOutBox(a, el.box);
      const bb = laidOutBox(b, el.box);
      if (ab && bb && overlapsBox(ab, bb, BOX_TOL)) return true;
    }
  }
  return false;
}

function laidOutBox(el, parentBox) {
  if (!el || !el.box) return null;
  if (!el.decls || el.decls.get('position') === 'absolute') {
    const left = parseFloat(el.decls && el.decls.get('left')) || 0;
    const top = parseFloat(el.decls && el.decls.get('top')) || 0;
    const w = parseFloat(el.decls && el.decls.get('width')) || el.box.width;
    const h = parseFloat(el.decls && el.decls.get('height')) || el.box.height;
    if (parentBox) {
      return { x: parentBox.x + left, y: parentBox.y + top, width: w, height: h };
    }
  }
  return el.box;
}

function boxesWithinTolerance(el) {
  if (!el.box) return true;
  for (const c of el.children || []) {
    if (!c || !c.box || !c.decls) continue;
    if (c.decls.get('position') !== 'absolute') continue;
    const left = parseFloat(c.decls.get('left'));
    const top = parseFloat(c.decls.get('top'));
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
    const expectL = c.box.x - el.box.x;
    const expectT = c.box.y - el.box.y;
    if (Math.abs(left - expectL) > BOX_TOL || Math.abs(top - expectT) > BOX_TOL) return false;
  }
  return true;
}

function sealPathB(el) {
  if (!el || !el.box || !el.decls) return;
  // Idempotent — never double-wrap
  if (el._pathB && el.children && el.children.length === 1 && el.children[0]._pathBStage) {
    return;
  }
  // If children already contain nested path-b shells (from older runs), flatten first
  flattenNestedPathB(el);

  el._route = 'B';
  el._pathB = true;
  el._standardsFlow = false;
  el._etCard = false;
  el._etBanner = false;
  el._etCardGrid = false;

  const w = Math.max(1, el.box.width);
  const h = Math.max(1, el.box.height);
  el.decls.set('position', 'relative');
  el.decls.set('width', '100%');
  el.decls.set('max-width', px(w));
  el.decls.set('aspect-ratio', `${Math.round(w * 100) / 100} / ${Math.round(h * 100) / 100}`);
  el.decls.set('overflow', 'hidden');
  el.decls.set('box-sizing', 'border-box');
  el.decls.set('flex', '0 1 auto');
  el.decls.set('min-width', '0');
  el.decls.delete('display');
  el.decls.delete('flex-direction');
  el.decls.delete('gap');
  el.decls.delete('padding');
  el.decls.delete('height');
  el.decls.delete('min-height');

  el.extraClass = mergeClass(
    String(el.extraClass || '')
      .split(/\s+/)
      .filter((c) => c && !/^et-(card|banner|flow|content|section|path-b)/.test(c))
      .join(' '),
    'et-path-b',
  );

  const stageDecls = new Map();
  stageDecls.set('position', 'absolute');
  stageDecls.set('left', '0');
  stageDecls.set('top', '0');
  stageDecls.set('width', px(w));
  stageDecls.set('height', px(h));
  stageDecls.set('transform-origin', 'top left');
  stageDecls.set('--path-b-native-w', String(Math.round(w * 100) / 100));

  const kids = (el.children || []).filter(Boolean);
  sortChildrenVisualY({ children: kids });
  kids.forEach((c) => {
    stripPathBMarks(c);
    forceAbsoluteChild(c, el.box);
  });

  const stage = {
    kind: 'el',
    type: 'FRAME',
    name: `${el.name || 'stage'}__stage`,
    tag: 'div',
    decls: stageDecls,
    children: kids,
    box: { x: el.box.x, y: el.box.y, width: w, height: h },
    nodeId: null,
    extraClass: 'et-path-b__stage',
    _pathBStage: true,
  };
  el.children = [stage];
  el._pathBNative = { width: w, height: h };
  el.decls.set('--path-b-native-w', String(Math.round(w * 100) / 100));
}

/** Unwrap nested path-b shells so we have a flat absolute tree under one stage. */
function flattenNestedPathB(el) {
  if (!el || !el.children) return;
  const flat = [];
  function absorb(nodes) {
    for (const n of nodes || []) {
      if (!n) continue;
      if (n._pathBStage && n.children) {
        absorb(n.children);
        continue;
      }
      if (n._pathB && n.children && n.children.length === 1 && n.children[0]._pathBStage) {
        absorb(n.children[0].children);
        continue;
      }
      flat.push(n);
    }
  }
  absorb(el.children);
  el.children = flat;
}

function stripPathBMarks(el) {
  if (!el) return;
  el._pathB = false;
  el._pathBStage = false;
  el._pathBNative = null;
  if (el.extraClass) {
    el.extraClass = String(el.extraClass)
      .split(/\s+/)
      .filter((c) => c && c !== 'et-path-b' && c !== 'et-path-b__stage')
      .join(' ');
  }
  (el.children || []).forEach(stripPathBMarks);
}

function forceAbsoluteChild(c, parentBox) {
  if (!c || !c.decls || !c.box || !parentBox) return;
  c.decls.set('position', 'absolute');
  c.decls.set('left', px(c.box.x - parentBox.x));
  c.decls.set('top', px(c.box.y - parentBox.y));
  c.decls.set('width', px(c.box.width));
  if (c.kind === 'img' || c.kind === 'svg' || c.text != null || c.runs) {
    c.decls.set('height', px(c.box.height));
  } else if (c.box.height) {
    c.decls.set('height', px(c.box.height));
  }
  c.decls.delete('margin-top');
  c.decls.delete('flex');
  c.decls.delete('display'); // Path B: absolute artboard, not flex AL
  c.decls.delete('flex-direction');
  c.decls.delete('gap');
  c.decls.delete('padding');
  // Always flatten into absolute coords — including former Auto Layout frames
  if (c.children && c.children.length && c.kind === 'el') {
    sortChildrenVisualY(c);
    c.children.forEach((ch) => {
      if (ch && ch.box) forceAbsoluteChild(ch, c.box);
    });
  }
}

function evaluateStructuralDemote(el, beforeAbsCount) {
  if (!el || effectiveRoute(el) !== 'A') return null;
  const afterAbs = countAbsPlaced(el).n;
  if (beforeAbsCount > 0 && !(afterAbs < beforeAbsCount)) {
    return {
      code: 'ABS_COUNT',
      message: `Absolute count did not drop (${beforeAbsCount} → ${afterAbs}).`,
    };
  }
  if (!domOrderMatchesVisualY(el)) {
    return {
      code: 'DOM_ORDER',
      message: 'DOM order does not match visual-Y order.',
    };
  }
  if (hasNewOverlaps(el)) {
    return {
      code: 'NEW_OVERLAP',
      message: 'Recovery introduced overlaps not present in Figma.',
    };
  }
  if (!boxesWithinTolerance(el)) {
    return {
      code: 'BOX_DIFF',
      message: `Layout boxes diverge from Figma coords beyond ${BOX_TOL}px.`,
    };
  }
  return null;
}

function applyStructuralDemote(root, stats = { demoted: 0, reasons: [] }) {
  if (!root) return stats;

  function walk(el) {
    if (!el) return;
    (el.children || []).forEach(walk);
    if (!isLayoutBearingContainer(el) && el !== root) return;
    if (effectiveRoute(el) !== 'A') return;
    if (el._pathB) return;
    // Don't undo successful flex recovery (cards/banners/grids) or banner chrome
    if (subtreeHasRecovery(el) || el._bannerChild || el._etBanner) return;

    const before = el._absCountBefore != null ? el._absCountBefore : 0;
    const reason = evaluateStructuralDemote(el, before);
    if (!reason) return;

    el._demoteReason = reason;
    stats.demoted += 1;
    stats.reasons.push({
      name: el.name,
      nodeId: el.nodeId,
      ...reason,
    });
    sealPathB(el);
  }

  walk(root);
  return stats;
}

function snapshotAbsCounts(el) {
  if (!el) return;
  if (isLayoutBearingContainer(el) || el._route) {
    el._absCountBefore = countAbsPlaced(el).n;
  }
  (el.children || []).forEach(snapshotAbsCounts);
}

/**
 * Seal remaining Path B subtrees. Only the outermost Path B shell per branch —
 * nested layout-bearing nodes stay absolute inside one stage (no nested scale).
 */
function sealAllPathB(root) {
  if (!root) return;

  function walk(el, isRoot, insidePathB) {
    if (!el) return;
    if (insidePathB) {
      // Already inside a sealed artboard — never wrap again
      return;
    }
    const canSeal = (isRoot || isLayoutBearingContainer(el))
      && effectiveRoute(el) === 'B'
      && !el._pathB
      && el.box;
    if (canSeal) {
      sortChildrenVisualY(el);
      sealPathB(el);
      return; // descendants live under stage; do not seal them
    }
    (el.children || []).forEach((c) => walk(c, false, !!(el._pathB)));
  }

  walk(root, true, false);
}

function clampMediaToFigmaBox(el) {
  if (!el) return;
  if ((el.kind === 'img' || el.kind === 'svg') && el.box && el.decls) {
    el.decls.set('width', px(el.box.width));
    el.decls.set('height', px(el.box.height));
    el.decls.set('max-width', '100%');
    el.decls.set('max-height', '100%');
    if (!el.decls.has('object-fit') && el.kind === 'img') {
      el.decls.set('object-fit', 'cover');
    }
  }
  (el.children || []).forEach(clampMediaToFigmaBox);
}

function dualPathStandardsCss() {
  return `/* --- dual-path Phase 0 (Path B composition contract) --- */
.et-path-b {
  position: relative !important;
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  flex: 0 1 auto !important;
  min-width: 0 !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
  container-type: inline-size;
  height: auto !important;
}
.et-path-b__stage {
  position: absolute !important;
  left: 0 !important;
  top: 0 !important;
  transform-origin: top left !important;
  transform: scale(calc(100cqw / var(--path-b-native-w, 100cqw))) !important;
}
.et-path-b__stage img,
.et-path-b__stage svg {
  max-width: none !important;
}`;
}

function collectDemoteReasons(root, acc = []) {
  if (!root) return acc;
  if (root._demoteReason) {
    acc.push({
      name: root.name,
      nodeId: root.nodeId,
      code: root._demoteReason.code,
      message: root._demoteReason.message,
      alCoverage: root._alCoverage,
    });
  }
  (root.children || []).forEach((c) => collectDemoteReasons(c, acc));
  return acc;
}

function summarizeRoutes(root) {
  let routeA = 0;
  let routeB = 0;
  let sumCov = 0;
  let n = 0;
  function walk(el, isRoot) {
    if (!el) return;
    if (isRoot || isLayoutBearingContainer(el)) {
      if (el._route === 'A') routeA += 1;
      if (el._route === 'B' || el._pathB) routeB += 1;
      if (typeof el._alCoverage === 'number') {
        sumCov += el._alCoverage;
        n += 1;
      }
    }
    (el.children || []).forEach((c) => walk(c, false));
  }
  walk(root, true);
  return {
    routeA,
    routeB,
    alCoverageAvg: n ? Math.round((sumCov / n) * 1000) / 1000 : 0,
    threshold: AL_COVERAGE,
  };
}

module.exports = {
  AL_COVERAGE,
  BOX_TOL,
  computeAlCoverage,
  classifySubtreeRoutes,
  shouldRunPathAHeuristics,
  effectiveRoute,
  unlockForFlexAttempt,
  sealUnresolvedFreeform,
  snapshotAbsCounts,
  applyStructuralDemote,
  sealAllPathB,
  sealPathB,
  stampBannerDescendants,
  clampMediaToFigmaBox,
  dualPathStandardsCss,
  collectDemoteReasons,
  summarizeRoutes,
  isLayoutBearingContainer,
  sortChildrenVisualY,
};
