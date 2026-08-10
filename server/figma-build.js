// figma-build.js
// Walks a Figma node subtree into a clean element tree, dedupes styles into
// semantic reusable classes (named from the Figma layer names), and emits
// index.html + styles.css + script.js matching the Lovable converter's output.
//   analyze(root, { emitMode }) -> { tree, imageNodeIds, svgNodeIds, fonts, layoutReport }
//   emit(tree, { imageUrls, svgMarkup, title }) -> { html, css, js, sections, ... }
//
// emitMode (see docs/STAKEHOLDER_FIGMA_SCALE_MODEL.md):
//   'auto'     — default; pick standard vs pixel from file structure (URL→HTML always)
//   'pixel'    — artboard-faithful; absolute freeform stays absolute (preview QA)
//   'standard' — Auto Layout → flex; freeform column recovery only when score ≥ threshold

const { nodeDecls, figmaColor, isBBoxRectPath, canBuildSvgLocally } = require('./figma-generate');
const { emitPromotedEventCard } = require('./figma-event-card-emit');
const { demoteFalseButtons } = require('../compiler/artifacts/apply-plan');
const dualPath = require('./dual-path');
const standardsEngine = require('./standards-engine');
const constraintTranscriber = require('./constraint-transcriber');

const VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'LINE', 'STAR', 'REGULAR_POLYGON']);
// CANVAS/DOCUMENT must recurse — otherwise Page roots emit empty shells (standards: nested trees).
const CONTAINER_TYPES = new Set([
  'FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION', 'CANVAS', 'DOCUMENT',
]);
const px = (n) => `${Math.round((n + 1e-9) * 100) / 100}px`;
/** Internal a11y intents that must never be written as ARIA role=… */
const NON_ARIA_ROLES = new Set(['interactive', 'static', 'decorative', 'landmark', 'heading', 'unknown']);

/** Minimum confidence to invent flex columns from freeform Groups (standard mode). */
const COLUMN_FLEX_MIN_SCORE = 0.75;

/**
 * Normalize requested emit mode.
 * Default `auto` — product UX is URL→HTML/CSS; pipeline picks the best path.
 */
function normalizeEmitMode(mode) {
  const m = String(mode == null || mode === '' ? 'auto' : mode).toLowerCase().trim();
  if (m === 'pixel' || m === 'preview' || m === 'pixel-preview') return 'pixel';
  if (m === 'standard' || m === 'production' || m === 'layout-standard') return 'standard';
  return 'auto';
}

/**
 * Resolve auto → concrete pixel|standard.
 * Product default `auto` → standard analyze with **per-subtree dual-path**
 * (Path A AL flex / Path B scaled absolute). Explicit `pixel` forces Path B.
 */
function resolveEmitMode(requested, freeformCounts) {
  const req = normalizeEmitMode(requested);
  if (req === 'pixel' || req === 'standard') {
    return { emitMode: req, emitModeRequested: req };
  }
  return { emitMode: 'standard', emitModeRequested: 'auto' };
}

function isAutoLayout(node) {
  return !!(node && (node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL'));
}

// Flow inference (generator-only, deterministic). A freeform container whose
// children form a clean, non-overlapping, evenly-spaced vertical/horizontal stack
// is really a normal flow layout drawn with coordinates — emit it as
// flex-direction:column|row + gap and drop the children's absolute placement.
// This is CONSERVATIVE by design: it only fires when the flexed result reproduces
// the exact same box positions (aligned edges + uniform gaps), so visual output
// never changes. Anything with overlap or freeform placement stays absolute.
const ALIGN_TOL = 2; // px — sibling edges within this count as aligned
const GAP_TOL = 2;   // px — inter-item gaps within this count as uniform
function overlaps(a, b) {
  return a.x < b.x + b.width - ALIGN_TOL && a.x + a.width > b.x + ALIGN_TOL
    && a.y < b.y + b.height - ALIGN_TOL && a.y + a.height > b.y + ALIGN_TOL;
}
function isAbsPlaced(c) {
  if (!c || !c.decls) return false;
  if (c.decls.get('position') === 'absolute') return true;
  // Icons/vectors sometimes only have left/top — still treat as freeform-placed
  return c.decls.has('left') && c.decls.has('top');
}

function applyFlexColumnFromBoxes(el, items) {
  const byY = [...items].sort((a, b) => a.box.y - b.box.y);
  const padTop = Math.max(0, byY[0].box.y - el.box.y);
  const padLeft = Math.max(0, Math.min(...byY.map((k) => k.box.x)) - el.box.x);

  const stackIds = new Set(byY.map((c) => c.nodeId || c));
  const rest = (el.children || []).filter((c) => !stackIds.has(c.nodeId || c));
  el.children = [...byY, ...rest];

  if (!el.decls) el.decls = new Map();
  el.decls.set('display', 'flex');
  el.decls.set('flex-direction', 'column');
  el.decls.set('align-items', 'flex-start');
  el.decls.delete('gap'); // per-item margin-top preserves Figma spacing better than averaged gap
  // Flex recovery must leave absolute artboard coords — market-standard flow
  el.decls.delete('position');
  el.decls.delete('left');
  el.decls.delete('top');
  if (padTop >= 0.5 || padLeft >= 0.5) {
    el.decls.set('padding', `${px(padTop)} 0 0 ${px(padLeft)}`);
  } else {
    el.decls.delete('padding');
  }

  for (let i = 0; i < byY.length; i++) {
    const c = byY[i];
    c.decls.delete('left');
    c.decls.delete('top');
    if (c.decls.get('position') === 'absolute') c.decls.delete('position');
    c.decls.delete('margin-top');
    if (i > 0) {
      const prev = byY[i - 1];
      const mt = Math.max(0, c.box.y - (prev.box.y + prev.box.height));
      if (mt >= 0.5) c.decls.set('margin-top', px(mt));
    }
    const hostsAbs = (c.children || []).some((ch) => ch.decls && isAbsPlaced(ch));
    if (hostsAbs) c.decls.set('position', 'relative');
  }
  el._standardsFlow = true;
  // Column stacks must not carry et-flow-row (tablet rules stretch children to 100%)
  if (el.extraClass) {
    el.extraClass = String(el.extraClass).split(/\s+/).filter((c) => c && c !== 'et-flow-row').join(' ');
  }
  el.extraClass = mergeClass(el.extraClass, 'et-flow-col');
}

/** True when fillGeometry/strokeGeometry can build a real icon SVG locally. */
function canReconstructVectorLocally(node) {
  // Prefer shared helper: handles fillGeometry alias + icon-frame child composition
  if (typeof canBuildSvgLocally === 'function') return canBuildSvgLocally(node);
  const fillG = node.fillGeometry || node.fillsGeometry || [];
  const strokeG = node.strokeGeometry || [];
  if (!fillG.length && !strokeG.length) return false;
  const b = node.absoluteBoundingBox || {};
  const onlyBBox = fillG.length === 1 && !strokeG.length
    && isBBoxRectPath(fillG[0].path, b.width || 0, b.height || 0);
  if (onlyBBox) return false;
  const pathLen = fillG.reduce((n, g) => n + String(g.path || '').length, 0)
    + strokeG.reduce((n, g) => n + String(g.path || '').length, 0);
  return pathLen >= 24;
}

/** Solid fill colour for a single-SOLID paint node (banner/card chrome). */
function solidFillCss(node) {
  const fills = (node.fills || []).filter((f) => f.visible !== false && (f.opacity == null || f.opacity > 0));
  if (fills.length !== 1 || fills[0].type !== 'SOLID') return null;
  return figmaColor(fills[0].color, fills[0].opacity);
}

/**
 * Decorative VECTOR that is really a CSS rectangle (Figma often draws fills as
 * VECTOR "Rectangle N"). Emitting these as SVG/PNG leaves missing-asset pink
 * placeholders that *override* background-color and wipe quote banners.
 */
function isSolidRectVectorChrome(node) {
  if (!node || node.type !== 'VECTOR') return false;
  if (hasImageFill(node)) return false;
  if (!solidFillCss(node)) return false;
  const fillG = node.fillGeometry || [];
  const strokeG = node.strokeGeometry || [];
  const b = node.absoluteBoundingBox || {};
  const w = b.width || 0;
  const h = b.height || 0;
  if (fillG.length === 1 && !strokeG.length && isBBoxRectPath(fillG[0].path, w, h)) return true;
  // Named rectangle layers without complex stroke geometry
  if (/^rectangle(\s|$)/i.test(node.name || '') && strokeG.length === 0) return true;
  return false;
}

function solidRectVectorAsEl(node, parent, ctx) {
  const decls = nodeDecls(node, parent, ctx);
  const color = solidFillCss(node);
  if (color && !decls.has('background-color')) decls.set('background-color', color);
  // Never keep image-fill sentinels on a flat chrome rect
  decls.delete('background-image');
  decls.delete('background-size');
  decls.delete('background-position');
  decls.delete('background-repeat');
  return {
    kind: 'el',
    type: node.type,
    name: node.name || 'rect',
    tag: 'div',
    decls,
    children: [],
    nodeId: node.id,
    box: node.absoluteBoundingBox,
    _chromeRect: true,
  };
}

function hasTextDescendant(el) {
  if (!el) return false;
  if (el.text != null || el.runs) return true;
  return (el.children || []).some(hasTextDescendant);
}

/** Luminance gate for quote/CTA banners (dark strip + light type). */
function isDarkCssColor(css) {
  if (!css || typeof css !== 'string') return false;
  const hex = css.match(/#([0-9a-f]{3,8})\b/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length < 6) return false;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 110;
  }
  const rgb = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    const r = +rgb[1];
    const g = +rgb[2];
    const b = +rgb[3];
    return (0.299 * r + 0.587 * g + 0.114 * b) < 110;
  }
  return false;
}

function vectorAsImageEl(node, parent, ctx, imageNodeIds) {
  const decls = nodeDecls(node, parent, ctx);
  const elImg = {
    kind: 'img',
    type: node.type,
    name: node.name || 'icon',
    tag: 'img',
    decls,
    children: [],
    nodeId: node.id,
    box: node.absoluteBoundingBox,
    imageRef: imageRefOf(node),
  };
  if (!elImg.imageRef) imageNodeIds.add(node.id);
  elImg.decls.delete('background-image');
  elImg.decls.delete('background-size');
  elImg.decls.delete('background-position');
  elImg.decls.delete('background-repeat');
  const paint = (node.fills || []).find((f) => f.visible !== false && f.type === 'IMAGE');
  elImg.decls.set('object-fit', paint && paint.scaleMode === 'FIT' ? 'contain' : 'contain');
  if (!elImg.decls.has('width') && node.absoluteBoundingBox) {
    elImg.decls.set('width', px(node.absoluteBoundingBox.width));
  }
  if (!elImg.decls.has('height') && node.absoluteBoundingBox) {
    elImg.decls.set('height', px(node.absoluteBoundingBox.height));
  }
  return elImg;
}

/**
 * Standard/auto: convert freeform content stacks (icon + title + body) to flex column.
 * Card pattern: chrome rect + content group → flex the content group.
 */
function forceContentFlexStacks(el) {
  if (!el || !el.children || !el.children.length) return;
  el.children.forEach(forceContentFlexStacks);
  if (el._constraintTranscribed || el._constraintDemoted) return;
  if (constraintTranscriber.skipHeuristics(el)) return;
  if (!dualPath.shouldRunPathAHeuristics(el)) return;
  if (!el.box || el._sourceAutoLayout) return;
  if (el.decls && el.decls.get('display') === 'flex') return;

  const kids = el.children.filter((c) => c && c.box && c.decls);
  if (kids.length < 2) return;
  const placed = kids.filter(isAbsPlaced);
  if (placed.length < 2) return;

  const chrome = placed.filter((c) => isChromeBg(c, el.box));
  const content = placed.filter((c) => !isChromeBg(c, el.box) && !isThinOverlay(c));

  // Tiny Y overlaps (icon/title drift in Figma) should not block flex recovery
  function softOverlap(a, b) {
    if (!overlaps(a, b)) return false;
    const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    return yOverlap > 4 && xOverlap > 4;
  }

  // Content-only vertical stack
  if (chrome.length === 0 && content.length >= 2) {
    const byY = [...content].sort((a, b) => a.box.y - b.box.y);
    const xs = byY.map((k) => k.box.x);
    if (Math.max(...xs) - Math.min(...xs) > 48) return;
    for (let i = 0; i < byY.length; i++) {
      for (let j = i + 1; j < byY.length; j++) {
        if (softOverlap(byY[i].box, byY[j].box)) return;
      }
    }
    applyFlexColumnFromBoxes(el, byY);
    return;
  }

  // Card: full-bleed chrome + one content wrapper → flex inside the wrapper
  if (chrome.length >= 1 && content.length === 1) {
    const wrap = content[0];
    if (!wrap.children || wrap.children.length < 2) return;
    const inner = wrap.children.filter((c) => c && c.box && c.decls && isAbsPlaced(c));
    if (inner.length < 2) return;
    const byY = [...inner].sort((a, b) => a.box.y - b.box.y);
    for (let i = 0; i < byY.length; i++) {
      for (let j = i + 1; j < byY.length; j++) {
        if (softOverlap(byY[i].box, byY[j].box)) return;
      }
    }
    if (!wrap.box) {
      const minX = Math.min(...byY.map((c) => c.box.x));
      const minY = Math.min(...byY.map((c) => c.box.y));
      const maxX = Math.max(...byY.map((c) => c.box.x + c.box.width));
      const maxY = Math.max(...byY.map((c) => c.box.y + c.box.height));
      wrap.box = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    applyFlexColumnFromBoxes(wrap, byY);
  }
}

/**
 * Principal-FE pass: collapse "chrome rect + absolute content" cards into one
 * relative flex card (bg + padding + column). Stops re-emitting artboard CSS
 * for simple Incentive-style box cards.
 */
function collapseCardShells(el, stats = { collapsed: 0 }) {
  if (!el || !el.children) return stats;
  el.children.forEach((c) => collapseCardShells(c, stats));
  if (el._constraintTranscribed || el._constraintDemoted || el._etCard) return stats;
  if (!dualPath.shouldRunPathAHeuristics(el)) return stats;

  if (!el.box || !el.decls) return stats;
  const kids = el.children.filter((c) => c && c.decls);
  if (kids.length < 2) return stats;

  const chrome = kids.filter((c) => isChromeBg(c, el.box));
  const content = kids.filter((c) => !isChromeBg(c, el.box) && !isThinOverlay(c));
  if (chrome.length < 1 || content.length !== 1) return stats;

  const wrap = content[0];
  const paint = chrome[0];
  // Content must be a stack (icon/title/body) — already flex or has ≥2 kids
  const innerKids = (wrap.children || []).filter((c) => c && c.decls);
  if (innerKids.length < 2 && wrap.decls.get('display') !== 'flex') return stats;

  // Lift chrome paints onto the card
  for (const key of [
    'background-color', 'background-image', 'background-size', 'background-position',
    'background-repeat', 'border-radius', 'box-shadow', 'outline', 'border', 'backdrop-filter',
    'opacity',
  ]) {
    if (paint.decls.has(key) && !el.decls.has(key)) el.decls.set(key, paint.decls.get(key));
  }

  const padTop = wrap.box ? Math.max(0, wrap.box.y - el.box.y) : 0;
  const padLeft = wrap.box ? Math.max(0, wrap.box.x - el.box.x) : 0;
  const padRight = wrap.box
    ? Math.max(0, (el.box.x + el.box.width) - (wrap.box.x + wrap.box.width))
    : padLeft;
  const padBottom = Math.max(padTop, 24);

  el.decls.set('display', 'flex');
  el.decls.set('flex-direction', 'column');
  el.decls.set('align-items', 'flex-start');
  el.decls.set('box-sizing', 'border-box');
  el.decls.set('padding', `${px(Math.round(padTop))} ${px(Math.round(padRight))} ${px(Math.round(padBottom))} ${px(Math.round(padLeft))}`);
  el.decls.delete('position');
  el.decls.delete('left');
  el.decls.delete('top');
  // Height follows content — fixed Figma card height fights responsive wrap
  el.decls.delete('height');
  el.decls.set('min-height', '0');
  if (el.decls.has('width')) {
    // Keep design width as flex basis hint; allow shrink
    const wRaw = el.decls.get('width');
    const wNum = parseFloat(wRaw);
    const w = Number.isFinite(wNum) ? `${Math.round(wNum)}px` : wRaw;
    el.decls.set('width', w);
    el.decls.set('flex', `1 1 ${w}`);
    el.decls.set('max-width', '100%');
  }

  // Flatten: card owns the stack
  const stack = innerKids.length >= 2 ? innerKids : [wrap];
  if (wrap.decls.get('display') === 'flex') {
    if (wrap.decls.has('gap') && !el.decls.has('gap')) el.decls.set('gap', wrap.decls.get('gap'));
    // Prefer explicit gap over uneven per-item margins for card bodies
    const margins = stack.map((c) => c.decls.get('margin-top')).filter(Boolean);
    if (!el.decls.has('gap') && margins.length) {
      const nums = margins.map((m) => parseFloat(m)).filter((n) => Number.isFinite(n));
      if (nums.length) {
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        el.decls.set('gap', px(Math.round(avg)));
      }
    }
    stack.forEach((c) => { c.decls.delete('margin-top'); });
  } else if (stack.length >= 2 && stack.every((c) => c.box)) {
    applyFlexColumnFromBoxes(el, stack);
    // Re-apply padding after applyFlexColumn (it may overwrite)
    el.decls.set('padding', `${px(Math.round(padTop))} ${px(Math.round(padRight))} ${px(Math.round(padBottom))} ${px(Math.round(padLeft))}`);
  }

  stack.forEach((c) => {
    c.decls.delete('left');
    c.decls.delete('top');
    if (c.decls.get('position') === 'absolute') c.decls.delete('position');
    // Text blocks: drop rigid Figma widths/heights so cards share a clean column
    if (c.text != null || c.runs || c.tag === 'h1' || c.tag === 'h2' || c.tag === 'h3' || c.tag === 'p') {
      c.decls.delete('width');
      c.decls.delete('height');
      c.decls.set('max-width', '100%');
    }
  });

  el.children = stack;
  el._standardsFlow = true;
  el._etCard = true;
  el.extraClass = mergeClass(el.extraClass, 'et-card et-flow-col');
  stats.collapsed += 1;
  return stats;
}

/**
 * Quote / CTA banner: wide short shell with full-bleed chrome + text (+ optional media).
 * Lifts the dark fill onto the banner so white quote text stays readable — never leave
 * chrome as a missing-asset SVG placeholder that paints over the real colour.
 */
function collapseBannerShells(el, stats = { banners: 0 }) {
  if (!el || !el.children) return stats;
  el.children.forEach((c) => collapseBannerShells(c, stats));
  if (el._constraintTranscribed) return stats;
  if (!dualPath.shouldRunPathAHeuristics(el)) return stats;

  if (!el.box || !el.decls || el._etBanner || el._etCard) return stats;
  const { width: w, height: h } = el.box;
  if (!(w >= 480 && h >= 80 && h <= 360 && w / Math.max(h, 1) >= 2.2)) return stats;

  const kids = el.children.filter((c) => c && c.decls && c.box);
  if (kids.length < 2) return stats;

  const chrome = kids.filter((c) => isChromeBg(c, el.box) || c._chromeRect);
  const content = kids.filter((c) => !chrome.includes(c) && !isThinOverlay(c));
  if (chrome.length < 1 || content.length < 1) return stats;
  if (!content.some(hasTextDescendant)) return stats;

  const paint = chrome.find((c) => c.decls && c.decls.has('background-color')) || chrome[0];
  const paintColor = paint.decls && paint.decls.get('background-color');
  // Quote banners are dark strips — skip light event-card / tile chrome
  if (!isDarkCssColor(paintColor)) return stats;

  for (const key of [
    'background-color', 'background-image', 'background-size', 'background-position',
    'background-repeat', 'border-radius', 'box-shadow', 'outline', 'border', 'backdrop-filter',
    'opacity',
  ]) {
    if (paint.decls.has(key) && !el.decls.has(key)) el.decls.set(key, paint.decls.get(key));
  }

  const sorted = [...content].sort((a, b) => a.box.x - b.box.x);
  const padTop = Math.round(Math.min(...sorted.map((c) => Math.max(0, c.box.y - el.box.y))));
  const padBottom = Math.round(Math.min(...sorted.map((c) => Math.max(0, (el.box.y + el.box.height) - (c.box.y + c.box.height)))));
  const padLeft = Math.round(Math.max(0, sorted[0].box.x - el.box.x));
  const last = sorted[sorted.length - 1];
  const padRight = Math.round(Math.max(0, (el.box.x + el.box.width) - (last.box.x + last.box.width)));

  el.decls.set('display', 'flex');
  el.decls.set('flex-direction', 'row');
  el.decls.set('align-items', 'center');
  el.decls.set('justify-content', 'space-between');
  el.decls.set('flex-wrap', 'wrap');
  el.decls.set('box-sizing', 'border-box');
  // Keep overflow visible so character/SVG art isn't clipped at the banner edge.
  el.decls.set('overflow', 'visible');
  el.decls.set('padding', `${px(padTop)} ${px(padRight)} ${px(Math.max(padBottom, 8))} ${px(padLeft)}`);
  el.decls.set('gap', '24px');
  el.decls.delete('position');
  el.decls.delete('left');
  el.decls.delete('top');
  el.decls.delete('height');
  el.decls.set('min-height', px(Math.round(h)));
  el.decls.set('width', '100%');
  el.decls.set('max-width', '100%');

  sorted.forEach((c) => {
    c.decls.delete('left');
    c.decls.delete('top');
    if (c.decls.get('position') === 'absolute' || c.decls.get('position') === 'relative') {
      c.decls.delete('position');
    }
    if (c.kind === 'img' || c.kind === 'svg') {
      // Do NOT stamp et-hug — fit-content !important expands bitmaps to intrinsic size.
      c.extraClass = mergeClass(c.extraClass, 'et-banner__media');
      c.decls.set('flex', '0 0 auto');
      c.decls.set('align-self', 'flex-end');
      if (c.box) {
        c.decls.set('width', px(c.box.width));
        c.decls.set('height', px(c.box.height));
        c.decls.set('max-width', px(c.box.width));
        c.decls.set('max-height', px(c.box.height));
        c.decls.set('object-fit', 'contain');
      }
    } else {
      c.decls.set('flex', '1 1 280px');
      c.decls.set('min-width', '0');
      c.decls.set('max-width', '100%');
    }
  });

  el.children = sorted;
  el._etBanner = true;
  el._standardsFlow = true;
  el.extraClass = mergeClass(el.extraClass, 'et-banner');
  stats.banners += 1;
  return stats;
}

/**
 * Flatten quote banners to market layout: [icon] [quote] [media].
 * Drops zero-size ghosts, hairlines, and inferColumnFlex leftover empty cols.
 */
function polishBannerContent(el, stats = { polished: 0 }) {
  if (!el) return stats;
  (el.children || []).forEach((c) => polishBannerContent(c, stats));
  if (el._constraintTranscribed && el._etBanner) return stats;
  if (!el._etBanner || !el.decls) return stats;

  const leaves = [];
  function collect(n, depth) {
    if (!n || !n.decls) return;
    // Skip zero-area ghosts (e.g. SYSTEM_ARCHITECT_LOG group at 0×0)
    if (n.box && n.box.width < 1 && n.box.height < 1) return;
    if (isThinOverlay(n)) return;
    const label = String(n.text != null ? n.text : n.name || '');
    if (/SYSTEM_ARCHITECT/i.test(label)) return;

    if (n.kind === 'img' || n.kind === 'svg') {
      leaves.push(n);
      return;
    }
    if (n.text != null || n.runs) {
      leaves.push(n);
      return;
    }
    // Circle / ellipse badge chrome
    const br = n.decls.get('border-radius');
    const isCircle = br === '50%' || /ellipse/i.test(n.name || '');
    if (isCircle && n.box && n.box.width >= 24 && n.box.width <= 80) {
      leaves.push(n);
      return;
    }
    // Icon cluster: circle + small glyph — keep as one unit
    const kids = (n.children || []).filter((c) => c && c.decls);
    const hasCircle = kids.some((c) => {
      const r = c.decls && c.decls.get('border-radius');
      return r === '50%' || /ellipse/i.test(c.name || '');
    });
    const hasGlyph = kids.some((c) => c.kind === 'img' || c.kind === 'svg'
      || (c.box && c.box.width <= 40 && c.box.height <= 40 && (c.kind === 'el')));
    if (hasCircle && kids.length <= 4) {
      // Drop broken bbox-only SVG squares inside the badge
      n.children = kids.filter((c) => {
        if (c.kind !== 'svg') return true;
        // keep real icons; drop pure rect fillGeometry placeholders later via CSS
        return true;
      });
      n.extraClass = mergeClass(n.extraClass, 'et-banner__icon');
      n.decls.set('position', 'relative');
      n.decls.set('flex', '0 0 auto');
      n.decls.set('width', n.box ? px(n.box.width) : '55px');
      n.decls.set('height', n.box ? px(n.box.height) : '55px');
      n.decls.delete('left');
      n.decls.delete('top');
      kids.forEach((c) => {
        if (!c.decls) return;
        if (/ellipse/i.test(c.name || '') || c.decls.get('border-radius') === '50%') {
          c.decls.set('position', 'absolute');
          c.decls.set('inset', '0');
          c.decls.set('width', '100%');
          c.decls.set('height', '100%');
          c.decls.delete('left');
          c.decls.delete('top');
        } else if (c.kind === 'img' || c.kind === 'svg' || (c.box && c.box.width <= 40)) {
          c.decls.set('position', 'absolute');
          c.decls.set('left', '50%');
          c.decls.set('top', '50%');
          c.decls.set('transform', 'translate(-50%, -50%)');
          c.decls.set('width', c.box ? px(c.box.width) : '25px');
          c.decls.set('height', c.box ? px(c.box.height) : '25px');
          c.decls.set('max-width', '60%');
          c.decls.set('max-height', '60%');
          c.extraClass = mergeClass(c.extraClass, 'et-banner__glyph');
        }
      });
      leaves.push(n);
      return;
    }
    if (depth < 4) kids.forEach((c) => collect(c, depth + 1));
  }

  (el.children || []).forEach((c) => collect(c, 0));
  if (leaves.length < 2) return stats;

  // De-dupe by nodeId
  const seen = new Set();
  const uniq = [];
  for (const n of leaves) {
    const id = n.nodeId || n;
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(n);
  }

  const sorted = [...uniq].sort((a, b) => {
    const ax = a.box ? a.box.x : 0;
    const bx = b.box ? b.box.x : 0;
    return ax - bx;
  });

  // Figma spacing: icon→quote gap (~28) + side padding — not space-between (looks sparse).
  let iconQuoteGap = 24;
  let padL = 0;
  let padR = 0;
  let padT = 0;
  let padB = 0;
  if (el.box && sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first.box) {
      padL = Math.max(0, Math.round(first.box.x - el.box.x));
      padT = Math.max(0, Math.round(Math.min(...sorted.filter((c) => c.box).map((c) => c.box.y - el.box.y))));
    }
    if (last.box) {
      padR = Math.max(0, Math.round((el.box.x + el.box.width) - (last.box.x + last.box.width)));
      padB = Math.max(0, Math.round((el.box.y + el.box.height) - Math.max(...sorted.filter((c) => c.box).map((c) => c.box.y + c.box.height))));
    }
    if (sorted[0].box && sorted[1].box) {
      iconQuoteGap = Math.max(8, Math.round(sorted[1].box.x - (sorted[0].box.x + sorted[0].box.width)));
    }
  }

  sorted.forEach((c) => {
    c.decls.delete('left');
    c.decls.delete('top');
    if (c.decls.get('position') === 'absolute' && !/\bet-banner__icon\b/.test(c.extraClass || '')
      && !/\bet-banner__glyph\b/.test(c.extraClass || '')) {
      // quote text / media stay in flow
      if (!(c.kind === 'img' || c.kind === 'svg') || /\bet-banner__media\b/.test(c.extraClass || '')) {
        c.decls.delete('position');
      }
    }
    if (c.text != null || c.runs || hasTextDescendant(c)) {
      if (!/\bet-banner__icon\b/.test(c.extraClass || '')) {
        c.decls.set('flex', '1 1 auto');
        c.decls.set('min-width', '0');
        if (c.box && c.box.width >= 200) {
          c.decls.set('max-width', px(Math.round(c.box.width)));
        } else {
          c.decls.set('max-width', '100%');
        }
        c.extraClass = mergeClass(c.extraClass, 'et-banner__quote');
      }
    }
    if ((c.kind === 'img' || c.kind === 'svg') && c.box && c.box.width > 60) {
      c.extraClass = mergeClass(c.extraClass, 'et-banner__media');
      c.decls.set('flex', '0 0 auto');
      c.decls.set('width', px(c.box.width));
      c.decls.set('height', px(c.box.height));
      c.decls.set('max-width', px(c.box.width));
      c.decls.set('max-height', px(c.box.height));
      c.decls.set('margin-left', 'auto');
    }
  });

  el.children = sorted;
  el.decls.set('display', 'flex');
  el.decls.set('flex-direction', 'row');
  el.decls.set('align-items', 'center');
  el.decls.set('justify-content', 'flex-start');
  el.decls.set('flex-wrap', 'nowrap');
  el.decls.set('gap', px(iconQuoteGap));
  if (padL || padR || padT || padB) {
    el.decls.set('padding', `${px(padT)} ${px(padR)} ${px(padB)} ${px(padL)}`);
  }
  // Keep banner off generic .et-flow-row breakpoint stacks
  if (el.extraClass) {
    el.extraClass = String(el.extraClass).split(/\s+/).filter((c) => c && c !== 'et-flow-row').join(' ');
  }
  el.extraClass = mergeClass(el.extraClass, 'et-banner');
  stats.polished += 1;
  return stats;
}

/**
 * Feature / lifecycle columns: frame already owns the fill (not chrome+wrap).
 * Stamp as et-card so sibling rows become et-card-grid.
 */
function stampFeatureCards(el, stats = { cards: 0 }) {
  if (!el || !el.children) return stats;
  el.children.forEach((c) => stampFeatureCards(c, stats));
  if (el._constraintTranscribed || el._constraintDemoted || el._etCard) return stats;
  if (!dualPath.shouldRunPathAHeuristics(el)) return stats;

  if (el._etCard || el._etBanner || el._etCardGrid) return stats;
  if (!el.box || !el.decls) return stats;
  if (!el.decls.has('background-color')) return stats;

  const { width: w, height: h } = el.box;
  if (w < 160 || w > 440 || h < 180 || h > 640) return stats;

  const kids = (el.children || []).filter((c) => c && c.decls);
  if (kids.length < 2) return stats;
  if (!kids.some(hasTextDescendant)) return stats;

  const content = kids.filter((c) => !isChromeBg(c, el.box) && !isThinOverlay(c));
  const stackAll = content.length >= 2 ? content : kids;
  const cardBox = el.box;

  function isStepBadge(c) {
    const label = String((c.text != null ? c.text : c.name) || '').trim();
    if (/^STEP[_\s-]?\d+/i.test(label)) return true;
    return !!(c.box && cardBox
      && c.box.width <= 72 && c.box.height <= 24
      && (c.text != null || c.runs)
      && (c.box.x - cardBox.x) > cardBox.width * 0.45);
  }

  const badges = stackAll.filter(isStepBadge);
  const stack = stackAll.filter((c) => !isStepBadge(c));
  if (stack.length < 2) return stats;

  if (el.decls.get('display') !== 'flex' && stack.every((c) => c.box)) {
    applyFlexColumnFromBoxes(el, [...stack].sort((a, b) => a.box.y - b.box.y));
  } else if (el.decls.get('display') !== 'flex') {
    el.decls.set('display', 'flex');
    el.decls.set('flex-direction', 'column');
    el.decls.set('align-items', 'flex-start');
    el.decls.set('box-sizing', 'border-box');
  }

  el.decls.delete('height');
  el.decls.set('min-height', '0');
  el.decls.set('max-width', '100%');
  if (el.decls.has('width')) {
    const wRaw = el.decls.get('width');
    const wNum = parseFloat(wRaw);
    const ww = Number.isFinite(wNum) ? `${Math.round(wNum)}px` : wRaw;
    el.decls.set('width', ww);
    el.decls.set('flex', `1 1 ${ww}`);
  }

  // Card is a containing block so STEP badges can sit top-right without absolute artboard.
  el.decls.set('position', 'relative');
  el.decls.set('overflow', 'hidden');

  badges.forEach((c) => {
    if (!c.box || !cardBox) return;
    c.decls.set('position', 'absolute');
    c.decls.set('top', px(Math.max(0, c.box.y - cardBox.y)));
    c.decls.set('right', px(Math.max(0, (cardBox.x + cardBox.width) - (c.box.x + c.box.width))));
    c.decls.delete('left');
    c.decls.delete('margin-top');
    c.extraClass = mergeClass(c.extraClass, 'et-card__badge et-badge et-hug');
  });

  stack.forEach((c) => {
    c.decls.delete('left');
    c.decls.delete('top');
    if (c.decls.get('position') === 'absolute') c.decls.delete('position');

    // Icon / SVG: keep intrinsic Figma size (no stretch).
    if (c.kind === 'img' || c.kind === 'svg') {
      const nearBottom = c.box && cardBox
        && (c.box.y + c.box.height) >= (cardBox.y + cardBox.height * 0.55)
        && c.box.width >= cardBox.width * 0.7;
      if (nearBottom) {
        c.extraClass = mergeClass(c.extraClass, 'et-card__media');
        c.decls.set('height', 'auto');
        c.decls.set('object-fit', 'cover');
        c.decls.set('margin-top', 'auto');
        c.decls.delete('flex');
        // width + side insets applied below from Figma box
      } else {
        c.extraClass = mergeClass(c.extraClass, 'et-card__icon');
        if (c.box) {
          c.decls.set('width', px(c.box.width));
          c.decls.set('height', px(c.box.height));
          c.decls.set('max-width', px(c.box.width));
          c.decls.set('max-height', px(c.box.height));
        }
        c.decls.set('flex', '0 0 auto');
        c.decls.set('object-fit', 'contain');
      }
    }
  });

  // Keep badges in the DOM (absolute overlay) after flow children.
  const flowIds = new Set(stack.map((c) => c.nodeId || c));
  const rest = (el.children || []).filter((c) => c && !flowIds.has(c.nodeId || c) && !badges.includes(c));
  el.children = [...stack, ...badges, ...rest];

  // Bottom media keeps Figma side insets (not forced full-bleed against card border).
  const mediaKids = stack.filter((c) => c.extraClass && /\bet-card__media\b/.test(c.extraClass));
  const bodyKids = stack.filter((c) => !mediaKids.includes(c));
  if (mediaKids.length && bodyKids.length && cardBox) {
    const padTop = Math.max(0, Math.min(...bodyKids.filter((c) => c.box).map((c) => c.box.y - cardBox.y)));
    const padLeft = Math.max(0, Math.min(...bodyKids.filter((c) => c.box).map((c) => c.box.x - cardBox.x)));
    const padRight = Math.max(0, Math.min(...bodyKids.filter((c) => c.box).map((c) => (cardBox.x + cardBox.width) - (c.box.x + c.box.width))));
    el.decls.set('padding', `${px(Math.round(padTop))} 0 0 0`);
    bodyKids.forEach((c) => {
      if (!c.decls) return;
      const pl = padLeft;
      const pr = padRight;
      if (pl >= 0.5 || pr >= 0.5) {
        c.decls.set('margin-left', px(Math.round(pl)));
        c.decls.set('margin-right', px(Math.round(pr)));
        c.decls.set('max-width', `calc(100% - ${px(Math.round(pl + pr))})`);
      }
    });
    mediaKids.forEach((c) => {
      if (!c.decls || !c.box) return;
      const ml = Math.max(0, Math.round(c.box.x - cardBox.x));
      const mr = Math.max(0, Math.round((cardBox.x + cardBox.width) - (c.box.x + c.box.width)));
      c.decls.set('width', px(Math.round(c.box.width)));
      c.decls.set('max-width', `calc(100% - ${px(ml + mr)})`);
      c.decls.set('height', 'auto');
      c.decls.set('align-self', 'flex-start');
      c.decls.set('margin-left', px(ml));
      c.decls.set('margin-right', px(mr));
      c.decls.set('margin-top', 'auto');
      c.decls.delete('flex');
    });
  }

  el._etCard = true;
  el._standardsFlow = true;
  if (el.extraClass) {
    el.extraClass = String(el.extraClass).split(/\s+/).filter((c) => c && c !== 'et-flow-row').join(' ');
  }
  el.extraClass = mergeClass(el.extraClass, 'et-card et-flow-col');
  stats.cards += 1;
  return stats;
}

/**
 * Row of similar-sized cards → wrapping flex/grid (responsive), not fixed absolute row.
 */
function inferCardGrids(el, stats = { grids: 0 }) {
  if (!el || !el.children) return stats;
  el.children.forEach((c) => inferCardGrids(c, stats));
  if (el._constraintTranscribed || el._constraintDemoted || el._etCardGrid) return stats;
  if (!dualPath.shouldRunPathAHeuristics(el)) return stats;

  const kids = (el.children || []).filter((c) => c && c.decls && c.box);
  if (kids.length < 2) return stats;

  const cards = kids.filter((c) => c._etCard
    || (c.decls.get('display') === 'flex'
      && c.decls.has('background-color')
      && (c.children || []).length >= 2));
  if (cards.length < 2 || cards.length < kids.length) return stats;

  const widths = cards.map((c) => c.box.width);
  const heights = cards.map((c) => c.box.height);
  const wSpan = Math.max(...widths) - Math.min(...widths);
  const hSpan = Math.max(...heights) - Math.min(...heights);
  if (wSpan > Math.max(...widths) * 0.2) return stats;
  if (hSpan > Math.max(...heights) * 0.35) return stats;

  // Gap from Figma horizontal spacing
  const byX = [...cards].sort((a, b) => a.box.x - b.box.x);
  const gaps = [];
  for (let i = 1; i < byX.length; i++) {
    gaps.push(Math.max(0, byX[i].box.x - (byX[i - 1].box.x + byX[i - 1].box.width)));
  }
  const gap = gaps.length
    ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
    : 28;

  if (!el.decls) el.decls = new Map();
  el.decls.set('display', 'flex');
  el.decls.set('flex-direction', 'row');
  el.decls.set('flex-wrap', 'wrap');
  el.decls.set('align-items', 'stretch');
  el.decls.set('gap', px(gap));
  el.decls.set('width', '100%');
  el.decls.set('max-width', '100%');
  el.decls.delete('height');
  el.decls.delete('position');
  el.decls.delete('left');
  el.decls.delete('top');

  cards.forEach((c) => {
    c.decls.delete('position');
    c.decls.delete('left');
    c.decls.delete('top');
    c.decls.delete('height');
    if (!c.decls.has('flex')) c.decls.set('flex', '1 1 280px');
    c.decls.set('max-width', '100%');
  });

  el.children = byX; // visual order
  el._standardsFlow = true;
  el._etCardGrid = true;
  el.extraClass = mergeClass(el.extraClass, 'et-card-grid et-flow-row');
  stats.grids += 1;
  return stats;
}

/**
 * Artboard → padded section: one flex content column with left/top inset
 * becomes parent padding + in-flow content (no absolute stage).
 * Walks the tree so page wrappers + section frames both get lifted.
 */
function liftArtboardContent(root, stats = { lifted: 0 }) {
  if (!root) return stats;
  (root.children || []).forEach((c) => liftArtboardContent(c, stats));
  if (!dualPath.shouldRunPathAHeuristics(root)) return stats;
  if (!root.box || !root.decls || !root.children) return stats;

  const kids = root.children.filter(Boolean);
  const content = kids.filter((c) => c.decls && (
    c._standardsFlow
    || c._etCardGrid
    || c._etCard
    || c.decls.get('display') === 'flex'
    || c.decls.get('display') === 'grid'
  ));
  if (content.length !== 1) return stats;
  const main = content[0];
  if (!main.box) return stats;

  // Only when content is still artboard-placed (absolute / left+top)
  if (!(main.decls.get('position') === 'absolute' || main.decls.has('left') || main.decls.has('top'))) {
    return stats;
  }

  // Section-sized frames only (avoid lifting tiny nested flex stacks)
  if (root.box.width < 600 || root.box.height < 400) return stats;

  const pt = Math.max(0, main.box.y - root.box.y);
  const pl = Math.max(0, main.box.x - root.box.x);
  const pr = Math.max(0, (root.box.x + root.box.width) - (main.box.x + main.box.width));
  const pb = Math.max(40, (root.box.y + root.box.height) - (main.box.y + main.box.height));

  root.decls.set('position', 'relative');
  root.decls.set('box-sizing', 'border-box');
  root.decls.set('padding', `${px(pt)} ${px(pr)} ${px(pb)} ${px(pl)}`);
  root.decls.set('width', '100%');
  root.decls.set('max-width', '100%');
  root.decls.delete('left');
  root.decls.delete('top');
  root.decls.delete('height');
  if (root.box.height) root.decls.set('min-height', px(root.box.height));
  root.extraClass = mergeClass(root.extraClass, 'et-section-shell');

  main.decls.delete('position');
  main.decls.delete('left');
  main.decls.delete('top');
  main.decls.delete('height');
  main.decls.set('width', '100%');
  main.decls.set('max-width', '100%');
  main.decls.set('position', 'relative');
  main.decls.set('z-index', '1');
  main.extraClass = mergeClass(main.extraClass, 'et-content');

  kids.forEach((c) => {
    if (c === main || !c.decls) return;
    // Full-bleed bg layers stay absolute but fluid
    c.decls.set('z-index', '0');
  });
  stats.lifted += 1;
  return stats;
}

/** Flex/grid containers must not stay absolutely positioned — that is the artboard anti-pattern. */
function demoteAbsoluteFlexStacks(el, stats = { demoted: 0 }) {
  if (!el) return stats;
  (el.children || []).forEach((c) => demoteAbsoluteFlexStacks(c, stats));
  // A node the constraint transcriber already verified or faithfully demoted
  // (e.g. a reward/xp label+value sub-stack that forceContentFlexStacks legally
  // wrapped in flex WHILE it stayed position:absolute within its demoted parent
  // row) must not be "corrected" here — this function's own display:flex +
  // position:absolute check looks exactly like the pattern it targets, but
  // stripping the absolute placement re-corrupts a node the row demotion
  // deliberately positioned. Same bug class as the other five fixes above.
  if (el._constraintTranscribed || el._constraintDemoted) return stats;
  if (!dualPath.shouldRunPathAHeuristics(el)) return stats;
  if (!el.decls) return stats;
  // Never flatten intentional card overlays (category pills on image-top cards)
  const cls = el.extraClass || '';
  if (/\bet-card__badge\b|\bet-badge\b/.test(cls)) return stats;
  if (el._constraintImageTop || (el._parent && el._parent._constraintImageTop && el.decls.get('position') === 'absolute')) {
    return stats;
  }
  const disp = el.decls.get('display');
  if (disp !== 'flex' && disp !== 'grid') return stats;
  if (el.decls.get('position') !== 'absolute' && !el.decls.has('left') && !el.decls.has('top')) {
    return stats;
  }
  el.decls.delete('position');
  el.decls.delete('left');
  el.decls.delete('top');
  el.decls.delete('height');
  el.decls.set('position', 'relative');
  el.decls.set('width', '100%');
  el.decls.set('max-width', '100%');
  el.extraClass = mergeClass(el.extraClass, 'et-flow-stack');
  stats.demoted += 1;
  return stats;
}

/**
 * Eyebrow chips like SYSTEM_CORE + hairline rule must hug-center.
 * inferColumnFlex often wraps them in full-width et-flow-row → stray bar on the left edge.
 * CRITICAL: only rewrite tiny clusters — never section shells / card grids / banners.
 */
function polishSectionEyebrows(el, stats = { polished: 0 }) {
  if (!el) return stats;
  (el.children || []).forEach((c) => polishSectionEyebrows(c, stats));
  if (!el.decls || !el.children || !el.children.length) return stats;
  if (el._etCard || el._etBanner || el._etCardGrid || el._pathB || el._standardsPromoted) return stats;
  if (el._constraintTranscribed || el._constraintDemoted || el._constraintImageTop || el._sourceAutoLayout) return stats;
  if (constraintTranscriber.skipHeuristics(el)) return stats;
  if (/\bet-section-shell\b|\bet-card-grid\b|\bet-banner\b|\bet-content\b|\bet-page\b/.test(el.extraClass || '')) {
    return stats;
  }
  // Eyebrow chips are small (e.g. 146×20). Never touch large frames.
  if (!el.box || el.box.width > 420 || el.box.height > 120) return stats;
  if ((el.children || []).length > 8) return stats;

  const hasEyebrowText = (n) => {
    const t = String(n.text != null ? n.text : '').trim();
    return /^(SYSTEM_|STEP_|MODULE_)/i.test(t) || /^[A-Z][A-Z0-9_]{3,24}$/.test(t);
  };
  const isHairline = (n) => {
    if (!n || !n.box || !n.decls) return false;
    return n.box.height <= 4 && n.box.width >= 16 && n.box.width <= 80
      && (n.decls.has('background-color') || n._chromeRect || n.kind === 'el');
  };

  const flatKids = [];
  function flatten(n) {
    if (!n || !n.decls) return;
    if (n.text != null || n.runs) { flatKids.push(n); return; }
    if (isHairline(n)) { flatKids.push(n); return; }
    const kids = (n.children || []).filter((c) => c && c.decls);
    const colWrap = /^col-\d+/i.test(String(n.name || ''))
      || /\bcol-\d+\b/.test(n.extraClass || '')
      || /\bet-flow-col--hug\b/.test(n.extraClass || '');
    if (colWrap || (kids.length === 1 && n.text == null && (!n.box || n.box.height <= 48))) {
      kids.forEach(flatten);
    }
  }

  const directEyebrow = (el.children || []).some(hasEyebrowText)
    || (el.children || []).some((c) => (c.children || []).some(hasEyebrowText));
  const directHair = (el.children || []).some(isHairline)
    || (el.children || []).some((c) => (c.children || []).some(isHairline));
  if (!directEyebrow || !directHair) return stats;

  (el.children || []).forEach(flatten);
  if (flatKids.length < 1 || flatKids.length > 6) return stats;
  if (!flatKids.every((n) => hasEyebrowText(n) || isHairline(n))) return stats;
  if (!flatKids.some(hasEyebrowText)) return stats;

  const uniq = [];
  const seen = new Set();
  for (const n of flatKids) {
    const id = n.nodeId || n;
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(n);
  }
  uniq.sort((a, b) => (a.box ? a.box.x : 0) - (b.box ? b.box.x : 0));

  el.children = uniq;
  el.decls.set('display', 'flex');
  el.decls.set('flex-direction', 'row');
  el.decls.set('align-items', 'center');
  el.decls.set('justify-content', 'center');
  el.decls.set('gap', '12px');
  el.decls.set('width', 'fit-content');
  el.decls.set('max-width', '100%');
  el.decls.set('margin-left', 'auto');
  el.decls.set('margin-right', 'auto');
  el.decls.delete('height');
  el.decls.delete('position');
  el.decls.delete('left');
  el.decls.delete('top');
  uniq.forEach((c) => {
    if (!c.decls) return;
    c.decls.delete('left');
    c.decls.delete('top');
    c.decls.delete('position');
    c.decls.delete('margin-top');
    c.decls.set('flex', '0 0 auto');
    if (c.text != null || c.runs) {
      c.decls.set('text-align', 'center');
      c.decls.delete('width');
      c.decls.delete('max-width');
    }
  });
  if (el.extraClass) {
    el.extraClass = String(el.extraClass).split(/\s+/).filter((x) => x && x !== 'et-flow-row').join(' ');
  }
  el.extraClass = mergeClass(el.extraClass, 'et-section-eyebrow');
  el._standardsFlow = true;
  stats.polished += 1;
  return stats;
}

/**
 * Centered section headers (eyebrow + title + subtitle) still sitting absolute
 * on the artboard → market-standard flex column, then parent ordered by visual Y.
 */
function recoverSectionHeaders(el, stats = { headers: 0 }) {
  if (!el || !el.children) return stats;
  el.children.forEach((c) => recoverSectionHeaders(c, stats));
  if (!dualPath.shouldRunPathAHeuristics(el)) return stats;
  if (!el.box || !el.decls || el._etCard || el._etBanner || el._etCardGrid) return stats;
  if (el._constraintTranscribed || el._constraintDemoted || el._constraintImageTop || el._sourceAutoLayout) return stats;
  if (constraintTranscriber.skipHeuristics(el)) return stats;

  const kids = (el.children || []).filter((c) => c && c.decls && c.box);
  if (kids.length < 2) return stats;

  const texts = kids.filter((c) => c.text != null || c.runs || hasTextDescendant(c));
  if (texts.length < 2) return stats;

  // Header clusters are relatively short vs section height
  const maxY = Math.max(...kids.map((c) => c.box.y + c.box.height));
  const minY = Math.min(...kids.map((c) => c.box.y));
  const clusterH = maxY - minY;
  if (clusterH > el.box.height * 0.45 && el.box.height > 280) return stats;
  if (clusterH > 220) return stats;

  const absish = kids.filter((c) => isAbsPlaced(c) || c.decls.get('position') === 'absolute');
  if (absish.length < 2) return stats;

  // Prefer vertical stacks (centered titles), not horizontal card rows
  const xs = texts.map((c) => c.box.x + c.box.width / 2);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  if (xSpan > el.box.width * 0.35 && texts.length >= 3) return stats;

  applyFlexColumnFromBoxes(el, [...kids].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x));
  el.decls.set('align-items', 'center');
  el.decls.set('width', '100%');
  el.decls.set('max-width', '100%');
  el.decls.delete('height');
  el.decls.delete('position');
  el.decls.delete('left');
  el.decls.delete('top');
  el.decls.set('text-align', 'center');
  texts.forEach((c) => {
    if (!c.decls) return;
    c.decls.set('text-align', 'center');
    // Pin measured Figma text frame width so centered copy wraps like the design
    // (e.g. Bob subtitle ≈583px → 2 lines). max-width:100% forces a single long line.
    if (c.box && c.box.width > 0) {
      const mw = Math.round(c.box.width);
      c.decls.set('max-width', px(mw));
      c.decls.set('width', '100%');
    } else {
      c.decls.set('max-width', '100%');
    }
    c.decls.delete('position');
    c.decls.delete('left');
    c.decls.delete('top');
  });
  // Eyebrow row (SYSTEM_CORE + rule) — center as a hug cluster
  (el.children || []).forEach((c) => {
    if (!c || !c.decls) return;
    if (c.decls.get('display') === 'flex' && c.decls.get('flex-direction') === 'row') {
      c.decls.set('justify-content', 'center');
      c.decls.set('align-items', 'center');
      c.decls.set('width', 'auto');
      c.decls.set('max-width', '100%');
      c.extraClass = mergeClass(c.extraClass, 'et-section-eyebrow');
    }
  });
  el._standardsFlow = true;
  el.extraClass = mergeClass(el.extraClass, 'et-section-header et-flow-col');
  stats.headers += 1;
  return stats;
}

/** After flex recovery, DOM order must match visual top→bottom (market standard). */
function orderSectionChildrenByVisualY(el) {
  if (!el || !el.children || !el.children.length) return;
  // Always walk descendants first — parents with a single child must not block deeper reordering.
  el.children.forEach(orderSectionChildrenByVisualY);
  if (el.children.length < 2) return;
  // A container the constraint transcriber already verified (flex/grid) or
  // faithfully demoted to an absolute snapshot must never be re-flexed here —
  // this was the confirmed root cause of the Challenge Arena row corruption:
  // this function had no _constraintDemoted awareness at all and would set
  // display:flex/flex-direction/gap on a just-demoted row the moment >=2 of its
  // children happened to be independently flex internally (e.g. their own
  // title+desc sub-stack), deleting the demoted position:relative in the process.
  if (el._constraintTranscribed || el._constraintDemoted) return;
  if (!dualPath.shouldRunPathAHeuristics(el)) return;
  if (!el.box || el.box.width < 480) return;
  const withBox = el.children.filter((c) => c && c.box);
  if (withBox.length < 2) return;
  const hasHeader = withBox.some((c) => c.extraClass && /\bet-section-header\b/.test(c.extraClass));
  if (!hasHeader) {
    const flexish = withBox.filter((c) => c._standardsFlow || c._etCardGrid || c._etBanner
      || c.decls.get('display') === 'flex' || c.decls.get('display') === 'grid'
      || (c.extraClass && /\bet-(content|card-grid|banner|flow)\b/.test(c.extraClass)));
    if (flexish.length < 2) return;
  }
  // Always promote section headers to the front of their sibling list.
  const heads = withBox.filter((c) => c.extraClass && /\bet-section-header\b/.test(c.extraClass));
  const body = withBox.filter((c) => !heads.includes(c));
  body.sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));
  const rest = el.children.filter((c) => !c || !c.box);
  el.children = [...heads, ...body, ...rest];
  if (el.decls.get('display') !== 'flex' && el.decls.get('display') !== 'grid') {
    el.decls.set('display', 'flex');
    el.decls.set('flex-direction', 'column');
    el.decls.set('align-items', 'stretch');
    // Measured header→body gap from oracle boxes (never hardcode 32)
    let gapPx = 32;
    if (heads[0] && heads[0].box && body[0] && body[0].box) {
      const g = body[0].box.y - (heads[0].box.y + heads[0].box.height);
      if (Number.isFinite(g) && g >= 0) gapPx = Math.round(g);
    }
    el.decls.set('gap', px(gapPx));
    el.decls.delete('height');
    el.decls.delete('position');
    el.decls.delete('left');
    el.decls.delete('top');
    el._standardsFlow = true;
  } else if (heads[0] && heads[0].box && body[0] && body[0].box) {
    // Already flex — still pin measured header→body gap when present
    const g = body[0].box.y - (heads[0].box.y + heads[0].box.height);
    if (Number.isFinite(g) && g >= 0) {
      el.decls.set('gap', px(Math.round(g)));
    }
  }
}

/**
 * When a section header is in normal flow, large top padding (from artboard lift
 * for absolute headers) doubles the gap — clamp it.
 */
function normalizeInFlowHeaderPadding(el) {
  if (!el) return;
  (el.children || []).forEach(normalizeInFlowHeaderPadding);
  if (!el.decls || !el.children || el.children.length < 2) return;
  const first = el.children.find((c) => c && c.decls);
  if (!first || !first.extraClass || !/\bet-section-header\b/.test(first.extraClass)) return;
  const pad = el.decls.get('padding');
  if (!pad) return;
  const parts = String(pad).trim().split(/\s+/);
  const top = parseFloat(parts[0]);
  if (!Number.isFinite(top) || top < 80) return;
  const next = [`${Math.min(48, Math.round(top * 0.15))}px`, ...parts.slice(1)];
  el.decls.set('padding', next.join(' '));
  el.decls.delete('min-height');
}

/** Full-bleed bg rects/images → inset:0; width/height 100% (not fixed artboard px). */
function fluidBackgroundLayers(el, rootBox, isRoot = true) {
  if (!el) return;
  const box = rootBox || el.box;
  (el.children || []).forEach((c) => fluidBackgroundLayers(c, box, false));
  // Never treat the section/page root as a background layer (undoes padding lift).
  if (isRoot) return;
  if (!el.decls || !el.box || !box) return;
  if (el.extraClass && /\bet-section-shell\b/.test(el.extraClass)) return;
  if (el.decls.has('padding')) return;
  const covers = el.box.width >= box.width * 0.92
    && el.box.height >= box.height * 0.85
    && Math.abs(el.box.x - box.x) <= 6
    && Math.abs(el.box.y - box.y) <= 6;
  if (!covers) return;
  if (el._etCard || el._etCardGrid || el.decls.get('display') === 'flex') return;
  el.decls.set('position', 'absolute');
  el.decls.set('inset', '0');
  el.decls.delete('left');
  el.decls.delete('top');
  el.decls.set('width', '100%');
  el.decls.set('height', '100%');
  el.decls.set('max-width', '100%');
  if (el.kind === 'img') el.decls.set('object-fit', el.decls.get('object-fit') || 'cover');
}

/**
 * Artboard/section shell: relative flow container, not a fixed absolute stage.
 */
function normalizeSectionShell(el, depth = 0) {
  if (!el || !el.decls) return;
  (el.children || []).forEach((c) => normalizeSectionShell(c, depth + 1));

  if (depth > 0) return;
  if (!el.box || el.box.width < 600) return;

  el.decls.set('position', 'relative');
  el.decls.delete('left');
  el.decls.delete('top');
  el.decls.set('width', '100%');
  el.decls.set('max-width', '100%');
  el.decls.delete('height');
  // Prefer content-driven height; keep a soft min only for full-bleed bg sections
  if (el.box && el.box.height >= 600) el.decls.set('min-height', px(Math.round(el.box.height)));
  el.extraClass = mergeClass(el.extraClass, 'et-section-shell');
}

function inferFlow(el) {
  if (!el || !el.children || !el.children.length) return;
  el.children.forEach(inferFlow); // depth-first: settle children before their parent
  if (el._constraintTranscribed || el._constraintDemoted) return;
  if (constraintTranscriber.skipHeuristics(el)) return;
  if (!dualPath.shouldRunPathAHeuristics(el)) return;

  const kids = el.children;
  if (kids.length < 2 || !el.box) return;
  // Allow svg icons in stacks (previously blocked → card content stayed absolute)
  if (!kids.every((c) => (c.kind === 'el' || c.kind === 'img' || c.kind === 'svg') && c.box && c.decls && isAbsPlaced(c))) return;
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].box;
      const b = kids[j].box;
      if (!overlaps(a, b)) continue;
      // Allow tiny Figma measurement overlaps (icon/title) — block only real collisions
      const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      if (yOverlap > 4 && xOverlap > 4) return;
    }
  }

  const gapsOf = (arr, axis) => arr.slice(1).map((c, i) => {
    const p = arr[i].box, q = c.box;
    return axis === 'y' ? q.y - (p.y + p.height) : q.x - (p.x + p.width);
  });
  const uniform = (g) => g.every((x) => x >= -ALIGN_TOL) && (Math.max(...g) - Math.min(...g) <= GAP_TOL);
  const aligned = (arr, edge) => { const v = arr.map((k) => (edge === 'x' ? k.box.x : k.box.y)); return Math.max(...v) - Math.min(...v) <= ALIGN_TOL; };

  const byY = [...kids].sort((a, b) => a.box.y - b.box.y);
  const byX = [...kids].sort((a, b) => a.box.x - b.box.x);
  let dir, arr, gaps;
  let unevenColumn = false;
  if (aligned(byY, 'x') && uniform(gapsOf(byY, 'y'))) { dir = 'column'; arr = byY; gaps = gapsOf(byY, 'y'); }
  else if (aligned(byX, 'y') && uniform(gapsOf(byX, 'x'))) { dir = 'row'; arr = byX; gaps = gapsOf(byX, 'x'); }
  else if (aligned(byY, 'x') && gapsOf(byY, 'y').every((x) => x >= -4)) {
    // Loose vertical stack (uneven/negative micro-gaps) — preserve per-item spacing
    dir = 'column'; arr = byY; gaps = gapsOf(byY, 'y');
    unevenColumn = true;
  } else return;

  const padTop = Math.max(0, arr[0].box.y - el.box.y);
  const padLeft = Math.max(0, Math.min(...arr.map((k) => k.box.x)) - el.box.x);

  el.children = arr; // emit in visual order (also fixes shuffled Figma layer order)
  el.decls.set('display', 'flex');
  el.decls.set('flex-direction', dir);
  el.decls.set('align-items', 'flex-start');
  el.decls.delete('gap');
  if (unevenColumn || (dir === 'column' && gaps.length && (Math.max(...gaps) - Math.min(...gaps) > GAP_TOL))) {
    // Per-item margins match Figma; averaged gap flattens icon→title vs title→body
    for (let i = 0; i < arr.length; i++) {
      arr[i].decls.delete('margin-top');
      if (i > 0) {
        const mt = Math.max(0, gaps[i - 1]);
        if (mt >= 0.5) arr[i].decls.set('margin-top', px(Math.round(mt)));
      }
    }
  } else {
    const gap = Math.max(0, gaps.reduce((a, b) => a + b, 0) / gaps.length);
    if (gap >= 0.5) el.decls.set('gap', px(gap));
  }
  if (padTop >= 0.5 || padLeft >= 0.5) el.decls.set('padding', `${px(padTop)} 0 0 ${px(padLeft)}`);
  if (el.decls.get('position') === 'relative') el.decls.delete('position'); // no absolute kids left to anchor
  for (const c of arr) {
    c.decls.delete('left'); c.decls.delete('top');
    if (c.decls.get('position') === 'absolute') c.decls.delete('position');
    // a converted child that still hosts absolute descendants must stay a containing block
    const hostsAbs = (c.children || []).some((ch) => ch.decls && isAbsPlaced(ch));
    if (hostsAbs) c.decls.set('position', 'relative'); else c.decls.delete('position');
  }
  el._standardsFlow = true;
  if (el.extraClass) {
    el.extraClass = String(el.extraClass).split(/\s+/).filter((c) => c && c !== 'et-flow-row' && c !== 'et-flow-col').join(' ');
  }
  el.extraClass = mergeClass(el.extraClass, dir === 'row' ? 'et-flow-row' : 'et-flow-col');
}

/**
 * Side-by-side header/body rows where tops are not edge-aligned (Figma often
 * offsets the right column below a badge). inferFlow misses these because
 * ALIGN_TOL is 2px — recover as flex row with align-items:flex-start + margin-top.
 */
function yOverlapRatio(a, b) {
  const top = Math.max(a.y, b.y);
  const bot = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, bot - top);
  const minH = Math.min(a.height, b.height);
  return minH > 0 ? overlap / minH : 0;
}

function inferSideBySideRows(el, stats = { rows: 0 }) {
  if (!el) return stats;
  (el.children || []).forEach((c) => inferSideBySideRows(c, stats));
  // A container the constraint transcriber already verified as flex/grid, or
  // faithfully demoted to an absolute snapshot, must never be reprocessed by this
  // cruder heuristic — it has no knowledge of _constraintDemoted and will happily
  // re-flex a demoted container's now-clean absolute children, silently leaving
  // whichever child it deems "overlapping" as a raw position:absolute leftover
  // inside the row it just re-flexed (root cause of the Challenge Arena row bug).
  if (el._constraintTranscribed || el._constraintDemoted) return stats;
  if (!dualPath.shouldRunPathAHeuristics(el)) return stats;
  if (!el.box || !el.decls || !el.children || el.children.length < 2) return stats;
  if (el.decls.get('display') === 'flex' || el.decls.get('display') === 'grid') return stats;
  if (el.box.width < 400) return stats;

  const kids = el.children.filter((c) => (
    c && c.box && c.decls
    && (c.kind === 'el' || c.kind === 'img' || c.kind === 'svg')
  ));
  if (kids.length < 2) return stats;

  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      if (overlaps(kids[i].box, kids[j].box)) return stats;
    }
  }

  const byX = [...kids].sort((a, b) => a.box.x - b.box.x);
  const gaps = [];
  for (let i = 1; i < byX.length; i++) {
    const g = byX[i].box.x - (byX[i - 1].box.x + byX[i - 1].box.width);
    if (g < -ALIGN_TOL) return stats;
    gaps.push(Math.max(0, g));
    if (yOverlapRatio(byX[0].box, byX[i].box) < 0.35) return stats;
  }

  // At least one child still artboard-placed (otherwise already fine)
  if (!byX.some((c) => isAbsPlaced(c))) return stats;

  const gap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const useSpaceBetween = byX.length === 2 && gap > 80;
  // Top-align columns (Figma default). Preserve intentional vertical offset via margin-top.
  const baseY = Math.min(...byX.map((c) => c.box.y));

  el.children = byX;
  el.decls.set('display', 'flex');
  el.decls.set('flex-direction', 'row');
  el.decls.set('align-items', 'flex-start');
  el.decls.set('width', '100%');
  el.decls.set('max-width', '100%');
  el.decls.delete('height');
  if (useSpaceBetween) {
    el.decls.set('justify-content', 'space-between');
    // Keep a modest flex gap; space-between owns the large Figma gutter
    if (gap >= 0.5) el.decls.set('gap', px(Math.min(Math.round(gap), 48)));
  } else if (gap >= 0.5) {
    el.decls.set('gap', px(Math.round(gap)));
  }
  if (el.decls.get('position') === 'absolute') el.decls.delete('position');

  for (const c of byX) {
    c.decls.delete('left');
    c.decls.delete('top');
    if (c.decls.get('position') === 'absolute') c.decls.delete('position');
    const dy = Math.round(c.box.y - baseY);
    if (dy > 2) c.decls.set('margin-top', px(dy));
    // Hug content — never width:100% inside a space-between header row
    c.decls.delete('width');
    if (c.box && c.box.width) c.decls.set('max-width', px(Math.round(c.box.width)));
    c.decls.set('flex', '0 1 auto');
    c.decls.set('min-width', '0');
    if (c.text != null || c.runs) {
      c.decls.delete('height');
    }
  }
  el._standardsFlow = true;
  el.extraClass = mergeClass(el.extraClass, 'et-flow-row');
  stats.rows += 1;
  return stats;
}

/**
 * Production polish — pixel-perfect look without raw Figma artboard CSS.
 * Text: no fixed height. Flex wrappers: height auto. Large widths → max-width.
 * Cards in a grid: shared padding/gap. Decimal px → integers.
 */
function roundDeclPx(value) {
  if (typeof value !== 'string' || !/\d+\.\d+px/.test(value)) return value;
  return value.replace(/(\d+\.\d+)px/g, (_, n) => `${Math.round(parseFloat(n))}px`);
}

function isTextEl(el) {
  if (!el) return false;
  if (el.text != null || el.runs) return true;
  return ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'label', 'a'].includes(el.tag);
}

function polishProductionLayout(el, stats = { polished: 0 }) {
  if (!el) return stats;
  (el.children || []).forEach((c) => polishProductionLayout(c, stats));
  if (!el.decls) return stats;
  // Constraint-transcribed geometry is measured — do not re-guess widths/padding
  if (el._constraintTranscribed || el._constraintDemoted) return stats;

  const isFlex = el.decls.get('display') === 'flex' || el.decls.get('display') === 'grid';
  const isCard = !!(el._etCard || hasClassToken(el.extraClass, 'et-card'));
  const isFullBleedBg = el.decls.get('position') === 'absolute'
    && (el.decls.get('inset') === '0' || el.decls.get('height') === '100%');

  if (isTextEl(el) && el.decls.has('height')) {
    el.decls.delete('height');
    stats.polished += 1;
  }
  // Text: never fixed width — max-width only (responsive-safe)
  if (isTextEl(el) && el.decls.has('width')) {
    const tw = el.decls.get('width');
    const tn = parseFloat(tw);
    el.decls.delete('width');
    if (Number.isFinite(tn) && tn > 0 && !el.decls.has('max-width')) {
      el.decls.set('max-width', `${Math.round(tn)}px`);
    }
    stats.polished += 1;
  }

  if ((isFlex || isCard || el._etCardGrid) && !isFullBleedBg) {
    const h = el.decls.get('height');
    if (h && h !== 'auto' && h !== '100%') {
      el.decls.delete('height');
      stats.polished += 1;
    }
  }

  // Card grids must never keep card padding (class-token false positive guard)
  if (el._etCardGrid || hasClassToken(el.extraClass, 'et-card-grid')) {
    if (el.decls.has('padding')) {
      el.decls.delete('padding');
      stats.polished += 1;
    }
  }

  const w = el.decls.get('width');
  if (w && /px$/i.test(w) && !isFullBleedBg) {
    const n = parseFloat(w);
    if (Number.isFinite(n) && n >= 600) {
      el.decls.set('width', '100%');
      el.decls.set('max-width', `${Math.round(n)}px`);
      stats.polished += 1;
    } else if (Number.isFinite(n) && Math.abs(n - Math.round(n)) > 0.01) {
      el.decls.set('width', `${Math.round(n)}px`);
      stats.polished += 1;
    }
  }

  // Flex row children must not claim width:100% (breaks header + card rows)
  if (isFlex && el.decls.get('flex-direction') === 'row') {
    (el.children || []).forEach((c) => {
      if (!c || !c.decls) return;
      if (c.decls.get('width') === '100%') {
        c.decls.delete('width');
        if (c.box && c.box.width) c.decls.set('max-width', px(Math.round(c.box.width)));
        stats.polished += 1;
      }
    });
  }

  for (const [k, v] of [...el.decls.entries()]) {
    const next = roundDeclPx(v);
    if (next !== v) {
      el.decls.set(k, next);
      stats.polished += 1;
    }
  }
  return stats;
}

function hasClassToken(extra, token) {
  return new RegExp(`(?:^|\\s)${token}(?:\\s|$)`).test(String(extra || ''));
}

/** Same-grid cards share one padding + gap (ignore tiny Figma measurement drift). */
function normalizeSiblingCardChrome(root) {
  const cards = [];
  (function walk(el) {
    if (!el) return;
    if (el._etCard || hasClassToken(el.extraClass, 'et-card')) cards.push(el);
    (el.children || []).forEach(walk);
  })(root);
  if (cards.length < 2) return 0;

  const roundPad = (p) => {
    if (!p) return null;
    return p.split(/\s+/).map((part) => {
      const n = parseFloat(part);
      return Number.isFinite(n) ? `${Math.round(n)}px` : part;
    }).join(' ');
  };

  const pads = cards.map((c) => roundPad(c.decls.get('padding'))).filter(Boolean);
  const gaps = cards.map((c) => roundDeclPx(c.decls.get('gap') || '')).filter(Boolean);
  const mode = (arr) => {
    const m = new Map();
    arr.forEach((a) => m.set(a, (m.get(a) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  if (!pads.length) return 0;
  const pad = mode(pads);
  const gap = gaps.length ? mode(gaps) : null;
  let n = 0;
  cards.forEach((c) => {
    if (c._constraintTranscribed || c._constraintDemoted) return;
    if (c.decls.get('padding') !== pad) {
      c.decls.set('padding', pad);
      n += 1;
    }
    if (gap && c.decls.get('gap') !== gap) {
      c.decls.set('gap', gap);
      n += 1;
    }
    c.decls.delete('height');
    c.decls.set('min-height', '0');
  });
  return n;
}

/** Decorative LINE / hairline only — not icons or photos. */
function isThinOverlay(c) {
  if (!c || !c.box) return false;
  const b = c.box;
  return (b.width <= 4 && b.height > 40) || (b.height <= 4 && b.width > 40);
}

function isVerticalDivider(c) {
  if (!c || !c.box) return false;
  return c.box.width <= 4 && c.box.height > 40;
}

function isChromeBg(c, elBox) {
  if (!c || !c.box || !elBox || c.text != null || c.runs) return false;
  // Photos / icons are never chrome; solid-rect VECTOR chrome is promoted to el.
  if (c.kind === 'img' || c.kind === 'svg') return false;
  const coversW = c.box.width >= elBox.width * 0.9;
  const coversH = c.box.height >= elBox.height * 0.85;
  const nearOrigin = Math.abs(c.box.x - elBox.x) <= 4 && Math.abs(c.box.y - elBox.y) <= 4;
  if (!(coversW && coversH && nearOrigin)) return false;
  if (c._chromeRect) return true;
  return true;
}

/**
 * Score freeform → column flex recovery without mutating.
 * High score (≥ COLUMN_FLEX_MIN_SCORE) is required in standard mode.
 */
function evaluateColumnFlex(el) {
  if (!el || !el.children || !el.children.length) return { ok: false, score: 0, reason: 'empty' };
  if (!el.decls) el.decls = new Map();
  if (!el.box) {
    const withBox = el.children.filter((c) => c && c.box);
    if (withBox.length) {
      const minX = Math.min(...withBox.map((c) => c.box.x));
      const minY = Math.min(...withBox.map((c) => c.box.y));
      const maxX = Math.max(...withBox.map((c) => c.box.x + c.box.width));
      const maxY = Math.max(...withBox.map((c) => c.box.y + c.box.height));
      el.box = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
  }
  if (!el.box) return { ok: false, score: 0, reason: 'no_box' };
  if (el._sourceAutoLayout) return { ok: false, score: 0, reason: 'auto_layout' };
  if (el.decls.get('display') === 'flex' || el.decls.get('display') === 'grid') {
    return { ok: false, score: 0, reason: 'already_flow' };
  }

  const kids = el.children.filter((c) => c && c.box && c.decls);
  if (kids.length < 2) return { ok: false, score: 0, reason: 'few_kids' };
  const absKids = kids.filter((c) => c.decls.get('position') === 'absolute');
  if (absKids.length < 2 || absKids.length < kids.length * 0.5) {
    return { ok: false, score: 0, reason: 'not_freeform_abs' };
  }

  const chrome = absKids.filter((c) => isChromeBg(c, el.box));
  const overlays = absKids.filter((c) => isThinOverlay(c) && !isChromeBg(c, el.box));
  const content = absKids.filter((c) => !isThinOverlay(c) && !isChromeBg(c, el.box));
  if (content.length < 2) return { ok: false, score: 0, reason: 'few_content' };

  // Overlapping content → low confidence
  for (let i = 0; i < content.length; i++) {
    for (let j = i + 1; j < content.length; j++) {
      if (overlaps(content[i].box, content[j].box)) {
        return { ok: false, score: 0.2, reason: 'content_overlap' };
      }
    }
  }

  const sorted = [...content].sort((a, b) => a.box.x - b.box.x);
  const columns = [];
  for (const c of sorted) {
    let placed = false;
    for (const col of columns) {
      const colMinX = Math.min(...col.map((k) => k.box.x));
      const colMaxX = Math.max(...col.map((k) => k.box.x + k.box.width));
      const cx1 = c.box.x;
      const cx2 = c.box.x + c.box.width;
      const overlap = Math.min(colMaxX, cx2) - Math.max(colMinX, cx1);
      const minW = Math.min(colMaxX - colMinX, c.box.width) || c.box.width;
      if (overlap > minW * 0.35) {
        col.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) columns.push([c]);
  }
  if (columns.length < 2 || columns.length > 4) {
    return { ok: false, score: 0.35, reason: 'bad_column_count', columnCount: columns.length };
  }

  const gapX = [];
  for (let i = 1; i < columns.length; i++) {
    const prevRight = Math.max(...columns[i - 1].map((k) => k.box.x + k.box.width));
    const nextLeft = Math.min(...columns[i].map((k) => k.box.x));
    gapX.push(Math.max(0, nextLeft - prevRight));
  }
  const rowGap = gapX.length ? gapX.reduce((a, b) => a + b, 0) / gapX.length : 12;
  const minGap = gapX.length ? Math.min(...gapX) : 0;

  let score = 0.4;
  if (columns.length === 2 || columns.length === 3) score += 0.25;
  else score += 0.1;
  if (minGap >= 4) score += 0.15;
  else if (minGap >= 0) score += 0.05;
  const lineOverlays = overlays.filter(isVerticalDivider);
  if (overlays.length && lineOverlays.length === overlays.length) score += 0.1;
  else if (!overlays.length) score += 0.05;
  if (content.length >= 3 && content.length <= 8) score += 0.1;
  score = Math.min(1, Math.round(score * 100) / 100);

  const padLeft = Math.max(0, Math.min(...content.map((k) => k.box.x)) - el.box.x);
  const padTop = Math.max(0, Math.min(...content.map((k) => k.box.y)) - el.box.y);
  const padRight = Math.max(0, (el.box.x + el.box.width) - Math.max(...content.map((k) => k.box.x + k.box.width)));
  const padBottom = Math.max(0, (el.box.y + el.box.height) - Math.max(...content.map((k) => k.box.y + k.box.height)));

  return {
    ok: score >= COLUMN_FLEX_MIN_SCORE,
    score,
    reason: score >= COLUMN_FLEX_MIN_SCORE ? 'ok' : 'low_score',
    columns,
    overlays,
    chrome,
    content,
    rowGap,
    pads: { padTop, padRight, padBottom, padLeft },
  };
}

/**
 * Map thin vertical LINE overlays to border-right on the column to their left.
 * Remaining overlays stay absolute (hidden on mobile via .et-overlay).
 */
function convertDividersToBorders(columns, overlays, parentBox) {
  const remaining = [];
  const borders = columns.map(() => null);
  for (const o of overlays) {
    if (!isVerticalDivider(o) || !o.box || !parentBox) {
      remaining.push(o);
      continue;
    }
    const midX = o.box.x + o.box.width / 2;
    let assigned = false;
    for (let i = 0; i < columns.length - 1; i++) {
      const right = Math.max(...columns[i].map((k) => k.box.x + k.box.width));
      const nextLeft = Math.min(...columns[i + 1].map((k) => k.box.x));
      if (midX >= right - 4 && midX <= nextLeft + 4) {
        let color = 'rgba(20, 22, 28, 0.12)';
        if (o.decls && o.decls.get('background-color')) color = o.decls.get('background-color');
        else if (o.decls && o.decls.get('border-color')) color = o.decls.get('border-color');
        borders[i] = `1px solid ${color}`;
        assigned = true;
        break;
      }
    }
    if (!assigned) remaining.push(o);
  }
  return { remaining, borders };
}

/**
 * Apply scored column-flex recovery. Returns whether mutation happened.
 * opts.convertDividers — prefer CSS border over absolute LINE overlays.
 */
function applyColumnFlex(el, evalResult, opts = {}) {
  if (!evalResult || !evalResult.ok) return false;
  const { columns, overlays, chrome, rowGap, pads } = evalResult;
  const convertDividers = opts.convertDividers !== false;

  for (const c of chrome) {
    if (c.decls) {
      for (const key of ['background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'border-radius', 'box-shadow', 'opacity', 'border', 'outline']) {
        if (c.decls.has(key) && !el.decls.has(key)) el.decls.set(key, c.decls.get(key));
      }
    }
  }

  const { remaining, borders } = convertDividers
    ? convertDividersToBorders(columns, overlays, el.box)
    : { remaining: overlays, borders: columns.map(() => null) };

  const colEls = columns.map((col, idx) => {
    col.sort((a, b) => a.box.y - b.box.y);
    const colGaps = [];
    for (let i = 1; i < col.length; i++) {
      colGaps.push(Math.max(0, col[i].box.y - (col[i - 1].box.y + col[i - 1].box.height)));
    }
    const g = colGaps.length ? colGaps.reduce((a, b) => a + b, 0) / colGaps.length : 8;
    for (const c of col) stripAbsoluteDeep(c);
    let packed = packColumnClusters(col);
    const hug = packed.length === 1 && (packed[0].kind === 'img' || packed[0].kind === 'svg');
    const isActions = packed.some((c) => {
      const n = String(c.name || '').toLowerCase();
      return /register|offline|cta|button|btn/.test(n)
        || (c.tag === 'button')
        || (c.children || []).some((ch) => ch.tag === 'button' || /offline|register/i.test(ch.name || ch.text || ''));
    });
    if (isActions) centerActionTexts(packed);
    const decls = new Map();
    decls.set('display', 'flex');
    decls.set('flex-direction', 'column');
    decls.set('align-items', hug || isActions ? 'center' : 'flex-start');
    const useSpaceBetween = packed.length > 1 && !isActions;
    decls.set('justify-content', useSpaceBetween ? 'space-between' : 'center');
    // gap + space-between fight; only gap when packing tightly
    if (!useSpaceBetween) decls.set('gap', px(Math.max(4, g)));
    else decls.set('gap', '0px');
    decls.set('flex', (hug || isActions) ? '0 0 auto' : '1 1 0%');
    decls.set('min-width', '0');
    if (borders[idx]) {
      decls.set('border-right', borders[idx]);
      decls.set('padding-right', px(Math.max(8, Math.min(16, rowGap / 2))));
    }
    return {
      kind: 'el',
      type: 'FRAME',
      name: `col-${idx + 1}`,
      tag: 'div',
      decls,
      children: packed,
      box: null,
      nodeId: null,
      extraClass: (hug || isActions) ? 'et-flow-col et-flow-col--hug' : 'et-flow-col',
    };
  });

  // Keep only vertical leftovers as overlays; horizontal hairlines misalign after flex recovery
  const overlayEls = remaining
    .filter((o) => isVerticalDivider(o))
    .map((o) => wrapAsOverlay(o, el.box))
    .filter(Boolean);

  el.decls.set('display', 'flex');
  el.decls.set('flex-direction', 'row');
  el.decls.set('align-items', 'stretch');
  el.decls.set('gap', px(Math.max(8, Math.min(24, rowGap))));
  el.decls.set('box-sizing', 'border-box');
  el.decls.set('position', 'relative');
  const { padTop, padRight, padBottom, padLeft } = pads;
  if (padTop || padRight || padBottom || padLeft) {
    el.decls.set('padding', `${px(padTop)} ${px(padRight)} ${px(padBottom)} ${px(padLeft)}`);
  }
  if (el.box) {
    el.decls.set('width', '100%');
    el.decls.set('max-width', px(el.box.width));
    if (!el.decls.has('min-height') && !el.decls.has('height')) el.decls.set('min-height', px(el.box.height));
  }
  el._standardsFlow = true;
  el._recoveryScore = evalResult.score;
  el.extraClass = el.extraClass ? `${el.extraClass} et-flow-row` : 'et-flow-row';
  el.children = [...colEls, ...overlayEls];
  return true;
}

/**
 * Depth-first scored recovery for freeform cards (standard mode only).
 */
function inferColumnFlex(el, opts = {}) {
  if (!el || !el.children || !el.children.length) return { applied: 0, attempts: [] };
  const report = { applied: 0, attempts: [] };
  const isBanner = !!(el._etBanner || (el.extraClass && /\bet-banner\b/.test(el.extraClass)));
  const insideBanner = !!(opts.insideBanner || isBanner);
  // Never explode quote/CTA banners (or their descendants) into multi-column freeform.
  if (insideBanner) {
    return report;
  }
  // Same protection as inferSideBySideRows: never re-score a container the
  // constraint transcriber already owns (verified flex/grid) or faithfully
  // demoted to absolute — this heuristic has no _constraintDemoted awareness.
  if (el._constraintTranscribed || el._constraintDemoted) return report;
  for (const c of el.children) {
    const childBanner = !!(c && (c._etBanner || (c.extraClass && /\bet-banner\b/.test(c.extraClass))));
    const sub = inferColumnFlex(c, { ...opts, insideBanner: insideBanner || childBanner });
    report.applied += sub.applied;
    report.attempts.push(...sub.attempts);
  }
  if (!dualPath.shouldRunPathAHeuristics(el)) return report;
  const minScore = opts.minScore != null ? opts.minScore : COLUMN_FLEX_MIN_SCORE;
  const ev = evaluateColumnFlex(el);
  report.attempts.push({
    name: el.name || el.nodeId || 'node',
    score: ev.score,
    reason: ev.reason,
    ok: ev.ok,
  });
  if (ev.ok && Array.isArray(ev.columns) && ev.score >= minScore) {
    if (applyColumnFlex(el, ev, opts)) report.applied += 1;
  }
  return report;
}

/** Remove absolute positioning in flow content (nested groups included). */
function stripAbsoluteDeep(el) {
  if (!el) return;
  const kids = el.children || [];
  const hadAbsKids = kids.some((c) => c.decls && c.decls.get('position') === 'absolute');

  if (el.decls) {
    el.decls.delete('position');
    el.decls.delete('left');
    el.decls.delete('top');
  }

  // Nested freeform group (e.g. Offline + Register) → vertical flex
  if (kids.length >= 2 && el.decls && hadAbsKids) {
    kids.sort((a, b) => {
      const ay = (a.box && a.box.y) || 0;
      const by = (b.box && b.box.y) || 0;
      return ay - by;
    });
    el.decls.set('display', 'flex');
    el.decls.set('flex-direction', 'column');
    el.decls.set('align-items', 'center');
    el.decls.set('justify-content', 'center');
    el.decls.set('gap', '8px');
    el.decls.delete('height');
  }
  for (const c of kids) stripAbsoluteDeep(c);
}

/**
 * Title + icon sit tight at top; date sits at bottom — wrap the tight head so
 * space-between matches Figma instead of evenly spreading 3 flex items.
 */
function packColumnClusters(col) {
  if (!col || col.length < 3) return col;
  const gaps = [];
  for (let i = 1; i < col.length; i++) {
    const prev = col[i - 1].box;
    const next = col[i].box;
    if (!prev || !next) return col;
    gaps.push(Math.max(0, next.y - (prev.y + prev.height)));
  }
  const lastGap = gaps[gaps.length - 1];
  const headTight = gaps.slice(0, -1).every((g) => g < 18);
  if (!(headTight && lastGap >= 20)) return col;

  const head = col.slice(0, -1);
  const tail = col[col.length - 1];
  const headGaps = gaps.slice(0, -1);
  const headGap = headGaps.length
    ? Math.max(4, headGaps.reduce((a, b) => a + b, 0) / headGaps.length)
    : 8;
  const decls = new Map();
  decls.set('display', 'flex');
  decls.set('flex-direction', 'column');
  decls.set('align-items', 'flex-start');
  decls.set('gap', px(headGap));
  decls.set('min-width', '0');
  const cluster = {
    kind: 'el',
    type: 'FRAME',
    name: 'col-cluster',
    tag: 'div',
    decls,
    children: head,
    box: null,
    nodeId: null,
    extraClass: 'et-flow-cluster',
  };
  return [cluster, tail];
}

function centerActionTexts(nodes) {
  for (const n of nodes || []) {
    if (!n) continue;
    if (n.decls && (n.text != null || n.runs || n.tag === 'button' || n.tag === 'p')) {
      n.decls.set('text-align', 'center');
      // Fixed Figma text widths fight centered labels (e.g. Offline)
      if (n.text != null || n.runs) {
        n.decls.delete('width');
        n.decls.delete('height');
      }
    }
    if (n.children) centerActionTexts(n.children);
  }
}

/** CTA frames → real buttons with centered label (matches Figma outline buttons). */
function styleAsControlButton(el) {
  if (!el || !el.decls) return;
  el.decls.set('display', 'inline-flex');
  el.decls.set('align-items', 'center');
  el.decls.set('justify-content', 'center');
  el.decls.set('text-align', 'center');
  el.decls.set('line-height', '1.2');
  el.decls.set('box-sizing', 'border-box');
  // Keep designed height but center label inside (Figma text y ≠ CSS line box)
  const h = el.decls.get('height');
  if (h && !el.decls.get('min-height')) el.decls.set('min-height', h);
  if (!el.decls.has('padding-left') && !el.decls.has('padding')) {
    el.decls.set('padding', '0 12px');
  }
  el.extraClass = el.extraClass ? `${el.extraClass} et-btn` : 'et-btn';
}

function wrapAsOverlay(o, parentBox) {
  if (!o || !o.box || !parentBox) return null;
  const decls = new Map();
  decls.set('position', 'absolute');
  decls.set('left', px(o.box.x - parentBox.x));
  decls.set('top', px(o.box.y - parentBox.y));
  decls.set('width', px(o.box.width));
  decls.set('height', px(o.box.height));
  decls.set('pointer-events', 'none');
  decls.set('z-index', '0');
  if (o.decls) {
    o.decls.delete('position');
    o.decls.delete('left');
    o.decls.delete('top');
  }
  return {
    kind: 'el',
    type: 'FRAME',
    name: (o.name || 'overlay') + '-wrap',
    tag: 'div',
    decls,
    children: [o],
    box: o.box,
    nodeId: null,
    extraClass: 'et-overlay',
  };
}

function slug(text) {
  const s = (text || '').toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 5).join('-').slice(0, 40).replace(/-+$/g, '') || 'box';
  // A CSS class can't start with a digit; numeric layer names ("872.400", "4")
  // would otherwise emit invalid selectors that the browser drops entirely.
  return /^[0-9]/.test(s) ? 'n-' + s : s;
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Split a text node into styled runs from characterStyleOverrides + styleOverrideTable.
// characterStyleOverrides[i] = override id for char i (0/undefined = base style);
// styleOverrideTable[id] = partial style. Consecutive same-id chars form one run.
function textRuns(node) {
  const chars = node.characters || '';
  const ov = node.characterStyleOverrides || [];
  const table = node.styleOverrideTable || {};
  if (!chars || !ov.length || !Object.keys(table).length) return [{ text: chars }];
  const runs = [];
  for (let i = 0; i < chars.length;) {
    const id = ov[i] || 0;
    let j = i; while (j < chars.length && (ov[j] || 0) === id) j++;
    const text = chars.slice(i, j);
    runs.push(id && table[id] ? { text, style: table[id] } : { text });
    i = j;
  }
  return runs;
}
// Inline CSS for a run's per-range overrides (only the props that can differ).
function runStyleCss(s) {
  const d = [];
  const fills = (s.fills || []).filter((f) => f.visible !== false);
  const top = fills[fills.length - 1];
  if (top && top.type === 'SOLID') d.push(`color:${figmaColor(top.color, top.opacity)}`);
  if (s.fontWeight) d.push(`font-weight:${s.fontWeight}`);
  if (s.italic || /italic|oblique/i.test(s.fontStyle || '')) d.push('font-style:italic');
  if (s.fontSize) d.push(`font-size:${px(s.fontSize)}`);
  if (s.letterSpacing) d.push(`letter-spacing:${px(s.letterSpacing)}`);
  if (s.textDecoration === 'UNDERLINE') d.push('text-decoration:underline');
  if (s.fontFamily) d.push(`font-family:'${s.fontFamily}', sans-serif`);
  return d.join(';');
}

function hasImageFill(node) { return (node.fills || []).some((f) => f.visible !== false && f.type === 'IMAGE'); }
function imageRefOf(node) { const f = (node.fills || []).find((x) => x.visible !== false && x.type === 'IMAGE'); return f ? f.imageRef : null; }

// A node whose whole subtree is vectors (an icon/logo) — export it as ONE SVG
// instead of dozens of sub-paths (avoids hammering the images API).
function isVectorOnly(node) {
  if (node.visible === false) return false;
  if (VECTOR_TYPES.has(node.type)) return true;
  if (node.type === 'TEXT' || hasImageFill(node)) return false;
  if (CONTAINER_TYPES.has(node.type) && node.children && node.children.length) {
    const kids = node.children.filter((c) => c.visible !== false);
    return kids.length > 0 && kids.every(isVectorOnly);
  }
  return false;
}

// pick a semantic tag from the node type + name + text size
function tagFor(node, decls) {
  const name = (node.name || '').toLowerCase();
  if (node.type === 'TEXT') {
    const fs = node.style && node.style.fontSize || 0;
    if (/h1|title|headline/.test(name) || fs >= 40) return 'h1';
    if (fs >= 28) return 'h2';
    if (fs >= 20) return 'h3';
    return 'p';
  }
  if (/(^|\s|\/)(button|btn|cta)(\s|$|\/)/.test(name)) return 'button';
  if (/(^|\s)(nav|navbar|menu)(\s|$)/.test(name)) return 'nav';
  if (/(^|\s)footer(\s|$)/.test(name)) return 'footer';
  if (/(^|\s)header(\s|$)/.test(name)) return 'header';
  return 'div';
}

// Clip media that overflows its frame. Avatars/cover photos are exported as an
// oversized, negatively-offset image meant to be cropped by their frame (Figma's
// mask pattern, where the clip shape is often a sibling ellipse). Generic rule: if
// an <img> child extends beyond its parent's box, clip the parent and let the image
// fill it, inheriting a sibling's border-radius as the mask shape (→ circular
// avatars, rounded photos). Runs after inferFlow so positions are settled.
function clipMedia(el) {
  if (!el || !el.children || !el.children.length) return;
  el.children.forEach(clipMedia);
  if (!el.box) return;
  // Quote banners intentionally allow media to sit past the strip edge (robot art).
  if (el._etBanner || (el.extraClass && /\bet-banner\b/.test(el.extraClass))) return;
  for (const c of el.children) {
    if (c.kind !== 'img' || !c.box) continue;
    const b = c.box, p = el.box;
    const overflows = b.x < p.x - 0.5 || b.y < p.y - 0.5
      || b.x + b.width > p.x + p.width + 0.5 || b.y + b.height > p.y + p.height + 0.5;
    if (!overflows) continue;
    el.decls.set('overflow', 'hidden');
    if (!el.decls.get('position')) el.decls.set('position', 'relative');
    const rounded = el.children.find((s) => s !== c && s.decls && s.decls.get('border-radius'));
    if (rounded && !el.decls.get('border-radius')) el.decls.set('border-radius', rounded.decls.get('border-radius'));
    c.decls.set('left', '0'); c.decls.set('top', '0'); c.decls.set('width', '100%'); c.decls.set('height', '100%');
  }
}

function countFreeformContainers(node, acc = { freeform: 0, autoLayout: 0 }) {
  if (!node || node.visible === false) return acc;
  if (CONTAINER_TYPES.has(node.type) && node.children && node.children.some((c) => c.visible !== false)) {
    if (isAutoLayout(node)) acc.autoLayout += 1;
    else if (node.type !== 'CANVAS' && node.type !== 'DOCUMENT') acc.freeform += 1;
  }
  for (const c of node.children || []) countFreeformContainers(c, acc);
  return acc;
}

function buildQualityScorecard(report) {
  const freeform = !!report.freeform;
  const recovered = !!report.recoveryApplied;
  const productionReady = !!report.productionReady;
  let grade = 'B';
  if (productionReady) grade = 'A';
  else if (freeform && !recovered && report.emitMode === 'pixel') grade = 'C';
  else if (freeform && !recovered) grade = 'C';
  else if (freeform && recovered) grade = 'B';

  let summary = 'HTML and CSS generated from your Figma URL.';
  if (productionReady) {
    summary = 'HTML/CSS ready — layout is mostly Auto Layout.';
  } else if (report.emitMode === 'pixel') {
    summary = 'HTML/CSS generated (artboard-faithful preview). Verify visually; freeform sections may not be responsive.';
  } else if (recovered) {
    summary = 'HTML/CSS generated with heuristic flex recovery. Verify alignment; prefer Auto Layout in Figma for cleaner results.';
  } else if (freeform) {
    summary = 'HTML/CSS generated. Freeform Groups limit responsive layout — code is still downloadable.';
  }

  return {
    grade,
    alwaysReturnsHtmlCss: true,
    productionReady,
    summary,
    emitMode: report.emitMode,
    emitModeRequested: report.emitModeRequested || report.emitMode,
  };
}

function buildLayoutReport({ emitMode, emitModeRequested, recovery, freeformCounts, dualPath: dualMeta, demoteReasons, standards }) {
  const warnings = [];
  const freeform = (freeformCounts && freeformCounts.freeform > 0) || false;
  const cardCollapsed = (recovery && recovery.cardShellsCollapsed) || 0;
  const bannerShells = (recovery && recovery.bannerShells) || 0;
  const featureCards = (recovery && recovery.featureCards) || 0;
  const cardGrids = (recovery && recovery.cardGrids) || 0;
  const artboardLifted = (recovery && recovery.artboardLifted) || 0;
  const absFlexDemoted = (recovery && recovery.absoluteFlexDemoted) || 0;
  const sideBySideRows = (recovery && recovery.sideBySideRows) || 0;
  const productionPolished = (recovery && recovery.productionPolished) || 0;
  const structuralDemoted = (recovery && recovery.structuralDemoted) || 0;
  const reasons = Array.isArray(demoteReasons) ? demoteReasons : [];
  const routeA = (dualMeta && dualMeta.routeA) || 0;
  const routeB = (dualMeta && dualMeta.routeB) || 0;
  const alCoverageAvg = (dualMeta && dualMeta.alCoverageAvg) || 0;
  const alThreshold = (dualMeta && dualMeta.threshold) || dualPath.AL_COVERAGE;
  const qaReady = !!(standards && standards.qaReady) || !!(recovery && recovery.qaReady);

  const applied = (recovery && recovery.applied > 0)
    || cardCollapsed > 0
    || bannerShells > 0
    || featureCards > 0
    || cardGrids > 0
    || artboardLifted > 0
    || absFlexDemoted > 0
    || sideBySideRows > 0
    || productionPolished > 0
    || structuralDemoted > 0;
  const bestAttempt = (recovery && recovery.attempts || [])
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;

  if (emitModeRequested === 'auto') {
    warnings.push({
      code: 'EMIT_AUTO',
      message: `emitMode=auto resolved to ${emitMode}. You always get HTML/CSS; path is chosen from file structure.`,
    });
  }

  if (cardCollapsed > 0) {
    warnings.push({
      code: 'CARD_SHELL_COLLAPSE',
      message: `Collapsed ${cardCollapsed} freeform card shell(s) into relative flex cards (bg + padding + column).`,
    });
  }
  if (bannerShells > 0) {
    warnings.push({
      code: 'BANNER_SHELL',
      message: `Recovered ${bannerShells} quote/CTA banner shell(s) — dark fill kept with text/media as flex row.`,
    });
  }
  if (routeB > 0 || emitMode === 'pixel') {
    warnings.push({
      code: 'DUAL_PATH_B',
      message: `Path B (scaled absolute) on ${routeB || 'root'} subtree(s); alCoverage avg ${alCoverageAvg} (threshold ${alThreshold}). Not production-responsive — Auto Layout required for Path A.`,
    });
  }
  if (structuralDemoted > 0 || reasons.length) {
    warnings.push({
      code: 'STRUCTURAL_DEMOTE',
      message: `Demoted ${structuralDemoted || reasons.length} Path A subtree(s) after structural oracle failed.`,
      demoteReasons: reasons.slice(0, 12),
    });
  }
  if (featureCards > 0) {
    warnings.push({
      code: 'FEATURE_CARDS',
      message: `Stamped ${featureCards} feature/lifecycle column(s) as et-card.`,
    });
  }
  if (cardGrids > 0) {
    warnings.push({
      code: 'CARD_GRID',
      message: `Promoted ${cardGrids} uniform card row(s) to wrapping flex grid for responsive layout.`,
    });
  }
  if (artboardLifted > 0) {
    warnings.push({
      code: 'ARTBOARD_TO_PADDING',
      message: 'Converted absolute content inset to section padding (no artboard stage).',
    });
  }
  if (absFlexDemoted > 0) {
    warnings.push({
      code: 'DEMOTE_ABS_FLEX',
      message: `Removed absolute positioning from ${absFlexDemoted} flex/grid container(s).`,
    });
  }
  if (sideBySideRows > 0) {
    warnings.push({
      code: 'SIDE_BY_SIDE_ROW',
      message: `Recovered ${sideBySideRows} side-by-side header/content row(s) as flex.`,
    });
  }
  if (productionPolished > 0) {
    warnings.push({
      code: 'PRODUCTION_POLISH',
      message: `Normalized ${productionPolished} artboard measurement(s) for production CSS (heights/widths/spacing).`,
    });
  }

  if (emitMode === 'pixel') {
    warnings.push({
      code: 'PIXEL_PREVIEW',
      message: 'Artboard-faithful layout (absolute freeform preserved). Good for visual QA; not fully production-responsive.',
    });
    if (freeform) {
      warnings.push({
        code: 'FREEFORM_GROUP',
        message: 'Freeform Group/Frame (no Auto Layout) detected. Responsive HTML is not guaranteed.',
      });
    }
  } else if (freeform && !applied) {
    warnings.push({
      code: 'FREEFORM_GROUP',
      message: 'Freeform Group without Auto Layout — flex recovery not applied. HTML/CSS still generated; verify visually or add Auto Layout in Figma.',
    });
    if (bestAttempt && bestAttempt.score > 0 && bestAttempt.score < COLUMN_FLEX_MIN_SCORE) {
      warnings.push({
        code: 'RECOVERY_BELOW_THRESHOLD',
        message: `Heuristic column recovery score ${bestAttempt.score} < ${COLUMN_FLEX_MIN_SCORE} (${bestAttempt.reason}) — refused inventing flex.`,
      });
    }
  } else if (freeform && applied) {
    warnings.push({
      code: 'FREEFORM_RECOVERY',
      message: `Applied heuristic flex recovery (best score ${bestAttempt ? bestAttempt.score : '?'}). Verify alignment; prefer Auto Layout in Figma for a solid SLA.`,
    });
  }

  if (standards && standards.regions && standards.regions.length) {
    warnings.push({
      code: 'STANDARDS_PROMOTION',
      message: `Standards engine promoted ${standards.regions.length} region(s); qaReady=${!!standards.qaReady}; pathBShells=${standards.pathBShells || 0}.`,
      regions: standards.regions.slice(0, 16),
    });
  }
  if (standards && standards.oracle && !standards.oracle.pass) {
    warnings.push({
      code: 'STANDARDS_ORACLE_FAIL',
      message: 'Standards oracle: layout regions incomplete or page still Path B — improve promoters before QA sign-off.',
      failures: (standards.oracle.failures || []).slice(0, 8),
    });
  }

  const report = {
    emitMode,
    emitModeRequested: emitModeRequested || emitMode,
    freeform,
    freeformContainerCount: (freeformCounts && freeformCounts.freeform) || 0,
    autoLayoutContainerCount: (freeformCounts && freeformCounts.autoLayout) || 0,
    recoveryApplied: applied,
    recoveryAttempts: (recovery && recovery.attempts) || [],
    cardShellsCollapsed: cardCollapsed,
    bannerShells,
    featureCards,
    cardGrids,
    routeA,
    routeB,
    alCoverageAvg,
    alCoverageThreshold: alThreshold,
    demoteReasons: reasons,
    structuralDemoted,
    dualPath: dualMeta || null,
    standards: standards || null,
    qaReady,
    constraintTranscriber: (recovery && recovery.constraintTranscriber) || null,
    warnings,
    // QA bar: flex/grid shippable when standards engine passes (or pure AL Path A).
    productionReady: emitMode === 'standard'
      && reasons.length === 0
      && (qaReady || (routeB === 0 && alCoverageAvg >= dualPath.AL_COVERAGE)),
    alwaysReturnsHtmlCss: true,
  };
  report.quality = buildQualityScorecard(report);
  return report;
}

// ---- analyze: node tree -> element tree -------------------------------------
function analyze(root, opts = {}) {
  const freeformCounts = countFreeformContainers(root);
  const resolved = resolveEmitMode(opts.emitMode, freeformCounts);
  const emitMode = resolved.emitMode;
  const emitModeRequested = resolved.emitModeRequested;
  const imageNodeIds = new Set();
  const svgNodeIds = new Set();
  const svgNodes = {};
  const fonts = new Set();
  const ctx = { exportImage: (id) => imageNodeIds.add(id), bgImageNodes: new Set(), fonts };

  function walk(node, parent, isRoot) {
    if (node.visible === false) return null;

    // vector / icon → local SVG when path geometry exists; else PNG <img>
    // LINE stays a normal element so divider→border recovery can run
    // Solid bbox "Rectangle" VECTORs → CSS chrome (never missing-asset placeholders)
    if (!isRoot && node.type !== 'LINE' && (VECTOR_TYPES.has(node.type) || isVectorOnly(node))) {
      if (isSolidRectVectorChrome(node)) {
        return solidRectVectorAsEl(node, parent, ctx);
      }
      if (hasImageFill(node) || !canReconstructVectorLocally(node)) {
        return vectorAsImageEl(node, parent, ctx, imageNodeIds);
      }
      svgNodeIds.add(node.id);
      svgNodes[node.id] = node;
      return { kind: 'svg', nodeId: node.id, name: node.name, decls: nodeDecls(node, parent, ctx), box: node.absoluteBoundingBox };
    }

    const decls = nodeDecls(node, parent, ctx);
    const el = {
      kind: 'el',
      type: node.type,
      name: node.name || 'box',
      tag: tagFor(node, decls),
      decls,
      children: [],
      nodeId: node.id,
      box: node.absoluteBoundingBox,
      _sourceAutoLayout: isAutoLayout(node),
      layoutMode: node.layoutMode || null,
    };

    if (node.type === 'TEXT') {
      const runs = textRuns(node);
      if (runs.length > 1) el.runs = runs; else el.text = node.characters || '';
      return el;
    }

    // image fill → capture its imageRef (resolved via the fills-images map);
    // fall back to per-node render only if there's no ref.
    if (hasImageFill(node)) {
      el.imageRef = imageRefOf(node);
      if (!el.imageRef) imageNodeIds.add(node.id);
      if (!node.children || !node.children.length) {
        el.kind = 'img';
        // A real <img> is styled with object-fit, not background-* — drop the
        // background paint props nodeDecls emitted (they only apply to a
        // background-image container) so the rule reads like hand-written CSS.
        el.decls.delete('background-image'); el.decls.delete('background-size'); el.decls.delete('background-position'); el.decls.delete('background-repeat');
        el.decls.delete('border'); el.decls.delete('outline'); // a photo layer's stroke is not a real border
        // Render photos to their BOX with object-fit (Figma scaleMode → cover/
        // contain), not the raw bitmap's intrinsic size. When the image layer is
        // larger than a clipping parent (avatar/photo crops), fill the parent and
        // let its overflow:hidden do the crop — a human would write exactly this,
        // instead of an oversized, negatively-offset <img>.
        const paint = (node.fills || []).find((f) => f.visible !== false && f.type === 'IMAGE');
        el.decls.set('object-fit', paint && paint.scaleMode === 'FIT' ? 'contain' : 'cover');
        const pb = parent && parent.absoluteBoundingBox;
        const b = node.absoluteBoundingBox;
        if (parent && parent.clipsContent && pb && b && (b.width > pb.width + 0.5 || b.height > pb.height + 0.5)) {
          el.decls.set('left', '0'); el.decls.set('top', '0');
          el.decls.set('width', '100%'); el.decls.set('height', '100%');
        }
        return el;
      }
      el.imageFill = true; // container → background-image
    }

    if (CONTAINER_TYPES.has(node.type) && node.children) {
      // A freeform container must be a containing block for its absolute children.
      // If nodeDecls already placed it with `position:absolute` (a freeform child
      // of a freeform parent), that IS a containing block — keep it, so the node
      // stays at its coordinates. Only add `position:relative` when it isn't
      // already positioned (an in-flow container, e.g. under auto-layout or the
      // root). Overwriting absolute→relative was what made containers collapse
      // into normal flow instead of sitting at their coordinates.
      const auto = isAutoLayout(node);
      if (!auto && node.children.some((c) => c.visible !== false) && el.decls.get('position') !== 'absolute') {
        el.decls.set('position', 'relative');
      }
      for (const child of node.children) { const c = walk(child, node); if (c) el.children.push(c); }
    }
    return el;
  }

  const tree = walk(root, null, true);
  // Remember the root frame's own box + clip so emit() can build a single canvas
  // that carries the page background and gives every section one coordinate system.
  if (tree) {
    tree.box = root.absoluteBoundingBox || null;
    tree.clips = root.clipsContent === true;
    tree._sourceAutoLayout = isAutoLayout(root);
  }
  let recovery = { applied: 0, attempts: [] };
  let dualSummary = null;
  let structuralDemote = { demoted: 0, reasons: [] };

  if (tree && emitMode === 'pixel') {
    // QA: force entire tree Path B (scaled absolute composition)
    dualPath.classifySubtreeRoutes(tree, 1.01); // nothing reaches A
    dualPath.sealAllPathB(tree);
    dualPath.clampMediaToFigmaBox(tree);
    dualSummary = dualPath.summarizeRoutes(tree);
  } else if (tree) {
    // Classify, then unlock freeform for Standards Promotion (QA bar = flex/grid).
    // Path B absolute remains only for emitMode=pixel (fidelity oracle / eng preview).
    const thr = opts.alCoverageThreshold != null ? Number(opts.alCoverageThreshold) : undefined;
    dualSummary = dualPath.classifySubtreeRoutes(tree, thr);
    if (emitMode === 'standard') {
      dualPath.unlockForFlexAttempt(tree);
    }
    dualPath.snapshotAbsCounts(tree);
    // Constraint Transcriber FIRST (general A0–A5 walk) — measured flex/grid before heuristics.
    // Spec: docs/CONSTRAINT_TRANSCRIBER_SPEC.md
    if (emitMode === 'standard') {
      const constraintReport = constraintTranscriber.run(tree);
      recovery.constraintTranscriber = constraintReport;
    }
    inferFlow(tree);
  }

  let standardsReport = null;
  if (tree && emitMode === 'standard') {
    // Heuristics only fill gaps on containers the transcriber did not own
    forceContentFlexStacks(tree);
    // Collapse chrome+content freeform cards → single relative flex card
    const cardStats = collapseCardShells(tree);
    
    // Quote/CTA banners: lift dark chrome fill so white text stays readable
    const bannerStats = collapseBannerShells(tree);
    
    dualPath.stampBannerDescendants(tree);
    // Feature columns that already own their fill → et-card
    const featureStats = stampFeatureCards(tree);
    
    // Uniform card rows → wrapping flex grid
    const gridStats = inferCardGrids(tree);
    
    // Content column absolute inset → section padding (kill artboard stage)
    const liftStats = liftArtboardContent(tree);
    
    const demoteStats = demoteAbsoluteFlexStacks(tree);
    
    // Centered title blocks still absolute on freeform artboards
    const headerStats = recoverSectionHeaders(tree);
    
    // Header → cards → banner in visual order
    orderSectionChildrenByVisualY(tree);
    
    // Header/body side-by-side when tops aren't edge-aligned
    const sideStats = inferSideBySideRows(tree);
    
    fluidBackgroundLayers(tree, tree.box);
    
    normalizeSectionShell(tree);
    
    // 2D freeform → flex only when scored ≥ threshold; dividers → CSS borders
    const columnFlex = inferColumnFlex(tree, { minScore: COLUMN_FLEX_MIN_SCORE, convertDividers: true });
    recovery.applied = columnFlex.applied;
    recovery.attempts = columnFlex.attempts;
    // Quote banners: flatten icon | quote | robot (undo freeform col splits)
    let bannerPolish = polishBannerContent(tree);
    dualPath.stampBannerDescendants(tree);
    // Production polish: no text heights, no wrapper heights, clean widths/spacing
    const polishStats = polishProductionLayout(tree);
    const cardNorm = normalizeSiblingCardChrome(tree);
    recovery.cardShellsCollapsed = cardStats.collapsed;
    recovery.bannerShells = bannerStats.banners;
    recovery.bannerPolished = bannerPolish.polished;
    recovery.featureCards = featureStats.cards;
    recovery.cardGrids = gridStats.grids;
    recovery.artboardLifted = liftStats.lifted;
    recovery.absoluteFlexDemoted = demoteStats.demoted;
    recovery.sectionHeaders = headerStats.headers;
    recovery.sideBySideRows = sideStats.rows;
    recovery.productionPolished = polishStats.polished + cardNorm;

    // Final visual order pass — later heuristics may reshuffle siblings
    orderSectionChildrenByVisualY(tree);
    // Header now in-flow → drop artboard top padding that reserved absolute header space
    normalizeInFlowHeaderPadding(tree);

    // Oracle: only demote broken Path A attempts → Path B (skip recovered cards/banners)
    structuralDemote = dualPath.applyStructuralDemote(tree);
    recovery.structuralDemoted = structuralDemote.demoted;
    // Absolute composition only for freeform that never recovered to flex
    dualPath.sealUnresolvedFreeform(tree);
    dualPath.clampMediaToFigmaBox(tree);
    // Heuristics may have rewritten card interiors — re-assert image-top contract
    constraintTranscriber.repairImageTopCards(tree);
    // Re-flatten banners if anything nested got touched
    bannerPolish = polishBannerContent(tree);
    recovery.bannerPolished = bannerPolish.polished;
    const eyebrowStats = polishSectionEyebrows(tree);
    recovery.eyebrowsPolished = eyebrowStats.polished;
    dualSummary = dualPath.summarizeRoutes(tree);

    // Standards Promotion Engine — scorecard + hover stamps; qaReady for QA bar
    const fidelityAbs = tree._absCountBefore != null ? tree._absCountBefore : undefined;
    standardsReport = standardsEngine.promote(tree, { fidelityAbsCount: fidelityAbs });
    recovery.standardsPromoted = (standardsReport.regions || []).length;
    recovery.qaReady = !!standardsReport.qaReady;
  }

  if (tree) clipMedia(tree);
  if (tree) promoteCtaButtons(tree);
  if (tree) demoteFalseButtons(tree);
  if (tree && emitMode === 'standard') applyEventCardSemantics(tree);

  const demoteReasons = tree ? dualPath.collectDemoteReasons(tree) : [];
  const layoutReport = buildLayoutReport({
    emitMode,
    emitModeRequested,
    recovery,
    freeformCounts,
    dualPath: dualSummary,
    demoteReasons,
    standards: standardsReport,
  });
  if (tree) tree._layoutReport = layoutReport;

  return {
    tree,
    imageNodeIds: [...imageNodeIds],
    svgNodeIds: [...svgNodeIds],
    svgNodes,
    fonts: [...fonts],
    bgImageNodes: [...ctx.bgImageNodes],
    emitMode,
    layoutReport,
    standardsReport,
  };
}

/**
 * Map recovered 3-region cards onto BEM roles used by the design-system EventCard.
 * Does not invent layout — only stable class names for promote → large-app reuse.
 * See docs/EVENT_CARD_COMPONENT_STANDARD.md
 */
function applyEventCardSemantics(root) {
  if (!root || !root._standardsFlow) return;
  const cols = (root.children || []).filter((c) => c && String(c.extraClass || '').includes('et-flow-col'));
  if (cols.length < 2 || cols.length > 4) return;

  root.semanticClass = 'event-card';
  root.tag = root.tag === 'header' || root.tag === 'footer' ? root.tag : 'article';
  root.extraClass = mergeClass(root.extraClass, 'event-card');

  for (const col of cols) {
    const hug = String(col.extraClass || '').includes('et-flow-col--hug');
    const hasImg = (col.children || []).some((c) => c.kind === 'img' || (c.children || []).some((x) => x.kind === 'img'));
    const hasBtn = (col.children || []).some((c) =>
      c.tag === 'button'
      || (c.children || []).some((x) => x.tag === 'button')
      || /offline|register|online/i.test(c.name || c.text || ''));

    if (hug && hasImg && !hasBtn) {
      col.semanticClass = 'event-card__media';
      col.extraClass = mergeClass(col.extraClass, 'event-card__media');
      stampMediaChild(col);
    } else if (hug && hasBtn) {
      col.semanticClass = 'event-card__actions';
      col.extraClass = mergeClass(col.extraClass, 'event-card__actions');
      stampActions(col);
    } else {
      col.semanticClass = 'event-card__body';
      col.extraClass = mergeClass(col.extraClass, 'event-card__body');
      stampBody(col);
    }
  }
}

function mergeClass(existing, add) {
  const parts = String(existing || '').split(/\s+/).filter(Boolean);
  if (!parts.includes(add)) parts.push(add);
  return parts.join(' ');
}

function stampMediaChild(col) {
  for (const c of col.children || []) {
    if (c.kind === 'img') {
      c.semanticClass = 'event-card__image';
      c.extraClass = mergeClass(c.extraClass, 'event-card__image');
      if (!c.attrs) c.attrs = {};
      if (!c.attrs.alt || /^rectangle|image|img/i.test(c.attrs.alt) || c.attrs.alt === c.name) {
        c.attrs.alt = (c.name && !/^rectangle|img/i.test(c.name)) ? c.name : 'Event thumbnail';
      }
    }
  }
}

function stampBody(col) {
  for (const c of col.children || []) {
    if (c.extraClass === 'et-flow-cluster' || c.name === 'col-cluster') {
      c.semanticClass = 'event-card__header';
      c.extraClass = mergeClass(c.extraClass, 'event-card__header');
      for (const h of c.children || []) stampBodyLeaf(h);
    } else {
      stampBodyLeaf(c);
    }
  }
}

function stampBodyLeaf(el) {
  if (!el) return;
  const text = String(el.text || '').toLowerCase().trim();
  const name = String(el.name || '').toLowerCase();
  if (/trophy|award|🏆/.test(text) || /trophy|award|meta/i.test(name) || /^[\u{1F300}-\u{1FAFF}\s]+$/u.test(el.text || '')) {
    el.semanticClass = 'event-card__meta';
    el.extraClass = mergeClass(el.extraClass, 'event-card__meta');
    if (!el.attrs) el.attrs = {};
    if (!el.attrs['aria-label']) el.attrs['aria-label'] = 'Awards';
    return;
  }
  if (/registration|ends on|mon\s*\d/i.test(text) || /date|registration/i.test(name)) {
    el.semanticClass = 'event-card__date';
    el.extraClass = mergeClass(el.extraClass, 'event-card__date');
    promoteDateTime(el);
    return;
  }
  if (el.tag === 'h1' || el.tag === 'h2' || el.tag === 'h3'
    || /title|hackspace/i.test(name)
    || (el.text && el.text.trim().length >= 2 && el.text.trim().length < 48 && !/register|offline|online/i.test(text))) {
    if (el.text != null || el.runs) {
      el.tag = 'h3';
      el.semanticClass = 'event-card__title';
      el.extraClass = mergeClass(el.extraClass, 'event-card__title');
    }
  }
}

function promoteDateTime(el) {
  if (!el || el.kind === 'svg') return;
  const raw = String(el.text || (el.runs && el.runs.map((r) => r.text).join('')) || '');
  // "Registration Ends on | Mon 08 2025" → ISO guess
  const m = raw.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\s+(\d{4})\b/i)
    || raw.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  let iso = null;
  if (m && m[2] && m[2].length === 4) {
    // Mon 08 2025 → day month year ambiguous; treat as day + year with Aug default only if "08" and year
    const day = String(m[1]).padStart(2, '0');
    const year = m[2];
    iso = `${year}-08-${day}`; // best-effort when month name missing
  }
  if (!iso) return;
  // Keep parent as p.event-card__date; wrap visible date via runs/html is hard — set data-datetime for emit
  if (!el.attrs) el.attrs = {};
  el.attrs['data-datetime'] = iso;
}

function stampActions(col) {
  const walk = (nodes) => {
    for (const c of nodes || []) {
      if (c.tag === 'button') {
        c.semanticClass = 'event-card__button';
        c.extraClass = mergeClass(c.extraClass, 'event-card__button');
        styleAsControlButton(c);
      } else if (c.text != null || c.runs) {
        const t = String(c.text || '').toLowerCase();
        if (/offline|online|hybrid/i.test(t) || /offline|online|status/i.test(c.name || '')) {
          c.semanticClass = 'event-card__status';
          c.extraClass = mergeClass(c.extraClass, 'event-card__status');
          if (!c.attrs) c.attrs = {};
          if (!c.attrs['aria-label']) {
            c.attrs['aria-label'] = /online/i.test(t) ? 'Online event' : 'Offline event';
          }
        }
      }
      if (c.children) walk(c.children);
    }
  };
  walk(col.children);
}

/** Prefer real <button> for CTA frames that only wrap a label (standards §5.4). */
function promoteCtaButtons(el) {
  if (!el) return;
  (el.children || []).forEach(promoteCtaButtons);
  if (el.tag !== 'div' && el.tag !== 'button') return;
  const name = (el.name || '').toLowerCase();
  const kids = el.children || [];
  const textKid = kids.length === 1 && kids[0].text != null ? kids[0]
    : kids.length === 1 && kids[0].runs ? kids[0] : null;
  if (!textKid) return;
  if (el.tag === 'button' || /(^|\s|\/)(button|btn|cta|register)(\s|$|\/)/.test(name)
    || /register|sign up|get started|subscribe/i.test(textKid.text || '')) {
    el.tag = 'button';
    if (!el.attrs) el.attrs = {};
    if (el.attrs.type == null) el.attrs.type = 'button';
    // Flatten label into button when single text child
    if (textKid.text != null && kids.length === 1) {
      el.text = textKid.text;
      el.runs = textKid.runs;
      el.children = [];
      if (textKid.decls) {
        for (const [k, v] of textKid.decls.entries()) {
          if (['color', 'font-family', 'font-weight', 'font-size', 'letter-spacing'].includes(k)) {
            el.decls.set(k, v);
          }
        }
      }
      el.decls.delete('position');
      el.decls.delete('left');
      el.decls.delete('top');
    }
    styleAsControlButton(el);
  }
}

// ---- emit: element tree -> HTML + CSS ---------------------------------------
function emit(tree, { imageUrls = {}, imageFillUrls = {}, svgMarkup = {}, title = 'Figma design', fonts = [] } = {}) {
  // Promoted EventCard path — clean BEM + design-system CSS (not Figma layer dump)
  if (tree && tree.semanticClass === 'event-card') {
    return emitPromotedEventCard(tree, { imageUrls, imageFillUrls, title, fonts });
  }

  const imgUrl = (el) => (el.imageRef && imageFillUrls[el.imageRef]) || imageUrls[el.nodeId] || '';
  const sigToName = new Map();
  const nameToDecls = new Map();
  const nameCounts = new Map();
  const nameSections = new Map();
  const usedOrder = [];

  function declString(decls) {
    return [...decls.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}:${v}`).join(';');
  }
  function classFor(el, section) {
    if (!el.decls || !el.decls.size) return null;
    const sig = declString(el.decls) + '|' + (el.semanticClass || '');
    let name = sigToName.get(sig);
    if (!name) {
      const base = el.semanticClass || slug(el.name);
      const n = (nameCounts.get(base) || 0) + 1; nameCounts.set(base, n);
      // BEM semantic classes stay stable (no -2 suffix) when unique sig
      name = (el.semanticClass && n === 1) ? el.semanticClass
        : (n === 1 ? base : `${base}-${n}`);
      if (el.semanticClass && n > 1) name = `${el.semanticClass}-${n}`;
      sigToName.set(sig, name); nameToDecls.set(name, el.decls);
    }
    if (!nameSections.has(name)) nameSections.set(name, new Set());
    nameSections.get(name).add(section);
    if (!usedOrder.includes(name)) usedOrder.push(name);
    return name;
  }

  // Optional architecture overlays (attrs / extraClass) — set by product adapter; ignore if absent.
  function attrsString(el) {
    if (!el.attrs || typeof el.attrs !== 'object') return '';
    return Object.keys(el.attrs).sort().map((k) => {
      const v = el.attrs[k];
      if (v == null || v === false) return '';
      if (k === 'role' && NON_ARIA_ROLES.has(String(v))) {
        if (String(v) === 'decorative') return ' aria-hidden="true"';
        return '';
      }
      if (k === 'alt' && el.tag !== 'img') return '';
      if (v === true) return ` ${k}`;
      return ` ${k}="${esc(String(v))}"`;
    }).join('');
  }
  function classAttr(el, section) {
    const parts = [];
    const cls = classFor(el, section);
    if (cls) parts.push(cls);
    if (el.extraClass) {
      String(el.extraClass).split(/\s+/).filter(Boolean).forEach((c) => {
        if (!parts.includes(c)) parts.push(c);
      });
    }
    return parts.length ? ` class="${parts.join(' ')}"` : '';
  }

  function renderEl(el, section, indent) {
    const pad = '  '.repeat(indent);
    if (el.kind === 'svg') {
      let svg = svgMarkup[el.nodeId];
      const clsAttr = classAttr(el, section);
      const extra = attrsString(el);
      if (svg) {
        svg = svg.replace(/<\?xml[^>]*\?>/, '').trim();
        // Apply layout class so absolute left/top from Figma land on the glyph
        if (/^<svg\b/i.test(svg)) {
          svg = svg.replace(/^<svg\b/i, `<svg${clsAttr}${extra}`);
        }
        return `${pad}${svg}`;
      }
      const url = imgUrl(el);
      const alt = (el.attrs && el.attrs.alt != null) ? el.attrs.alt : el.name;
      if (url) return `${pad}<img${clsAttr}${extra} src="${url}" alt="${esc(alt)}">`;
      // Missing asset: visible placeholder + warning attribute (never silent empty success).
      return `${pad}<div${clsAttr}${extra} data-figma-kind="vector" data-figma-missing-asset="1" role="img" aria-label="${esc(el.name || 'icon')}" style="min-width:1em;min-height:1em;outline:1px dashed rgba(255,80,80,.6);background:rgba(255,80,80,.08)"></div>`;
    }
    const clsAttr = classAttr(el, section);
    const extra = attrsString(el);
    if (el.kind === 'img') {
      const alt = (el.attrs && el.attrs.alt != null) ? el.attrs.alt : el.name;
      const withoutAlt = extra.replace(/\s+alt="[^"]*"/g, '');
      const src = imgUrl(el) || '';
      return `${pad}<img${clsAttr}${withoutAlt} src="${src}" alt="${esc(alt)}">`;
    }
    if (el.runs) {
      const inner = el.runs.map((r) => {
        const t = esc(r.text).replace(/\n/g, '<br>');
        return r.style ? `<span style="${runStyleCss(r.style)}">${t}</span>` : t;
      }).join('');
      return `${pad}<${el.tag}${clsAttr}${extra}>${inner}</${el.tag}>`;
    }
    if (el.text != null) return `${pad}<${el.tag}${clsAttr}${extra}>${esc(el.text).replace(/\n/g, '<br>')}</${el.tag}>`;
    if (!el.children || !el.children.length) return `${pad}<${el.tag}${clsAttr}${extra}></${el.tag}>`;
    const inner = el.children.map((c) => renderEl(c, section, indent + 1)).filter((s) => s != null && s !== '').join('\n');
    return `${pad}<${el.tag}${clsAttr}${extra}>\n${inner}\n${pad}</${el.tag}>`;
  }

  // Inject the actual background-image URL for container image fills (the URL
  // isn't known during analyze). Walk the whole tree once.
  (function injectBg(el) {
    if (!el) return;
    // paintLayers emitted a `__IMG__` sentinel per image layer; swap it for the
    // resolved url now (composes correctly with stacked gradient/solid layers).
    if (el.decls) {
      const bg = el.decls.get('background-image');
      if (bg && bg.includes('__IMG__')) {
        const u = imgUrl(el);
        el.decls.set('background-image', u ? bg.split('__IMG__').join(`url("${u}")`) : bg.replace(/(^|,\s*)__IMG__(\s*,|$)/g, '$1$2').replace(/^,\s*|,\s*$/g, ''));
      }
    }
    (el.children || []).forEach(injectBg);
  })(tree);

  const sectionBlocks = [];
  const sectionOrder = [];

  /** Nested unit: one article/section for the whole tree (standards) vs flatten leaves. */
  function emitAsNestedUnit(root) {
    if (!root || !root.children || !root.children.length) return false;
    // Path B artboard is a single composition (host + stage) — never flatten to stage-only
    if (root._pathB) return true;
    if (root.children.length < 2) return false;
    if (root._standardsFlow) return true;
    if (root.decls && (root.decls.get('display') === 'flex' || root.decls.get('display') === 'grid')) return true;
    const abs = root.children.filter((c) => c.decls && c.decls.get('position') === 'absolute');
    return abs.length >= 2 && abs.length >= root.children.length * 0.5;
  }

  const nestedEmit = emitAsNestedUnit(tree);

  if (nestedEmit) {
    const name = tree.semanticClass || slug(tree.name || 'component');
    const label = (tree.semanticClass || name).replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    sectionOrder.push({ key: name, label });
    const cardLike = tree.semanticClass === 'event-card'
      || /card|tile|hack|mentor|event|group/i.test(tree.name || '')
      || tree._standardsFlow;
    const semTag = tree.tag === 'header' || tree.tag === 'footer' ? tree.tag
      : (cardLike ? 'article' : 'section');
    if (!tree.decls) tree.decls = new Map();
    if ([...tree.children].some((c) => c.decls && c.decls.get('position') === 'absolute')) {
      if (!tree.decls.has('position') && tree.decls.get('display') !== 'flex') {
        tree.decls.set('position', 'relative');
      }
    }
    // Prefer semantic root class over Figma group id
    if (tree.semanticClass) tree.name = tree.semanticClass;
    const rootClassList = [
      tree.semanticClass || `section-${slug(tree.name || 'component')}`,
      'et-component',
      tree._standardsFlow ? 'et-flow-row' : null,
      tree._pathB ? 'et-path-b-root' : null,
    ].filter(Boolean);
    // Register root decls under semantic/BEM name
    classFor({ ...tree, semanticClass: tree.semanticClass || null, name: tree.semanticClass || tree.name }, name);
    let inner;
    if (tree.semanticClass) {
      // Flatten: article.event-card owns layout; children are media/body/actions
      inner = (tree.children || []).map((c) => renderEl(c, name, 3)).filter(Boolean).join('\n');
    } else {
      inner = renderEl({ ...tree, tag: 'div' }, name, 3);
    }
    sectionBlocks.push(
      `  <!-- Component: ${label} -->\n  <${semTag} class="${rootClassList.join(' ')}">\n${inner}\n  </${semTag}>`
    );
  } else {
    const rootChildren = (tree.children && tree.children.length) ? tree.children : [tree];
    rootChildren.forEach((child) => {
      const name = slug(child.name);
      sectionOrder.push({ key: name, label: name.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) });
      const label = name.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
      const semTag = child.tag === 'header' || child.tag === 'footer' ? child.tag : 'section';
      const inner = renderEl(child, name, 3);
      sectionBlocks.push(`  <!-- Section: ${label} -->\n  <${semTag} class="section-${name}">\n${inner}\n  </${semTag}>`);
    });
  }

  // Page shell — fluid width (design max via --page-max), not a fixed artboard stage.
  const canvasDecls = new Map();
  if (!nestedEmit && tree.decls) {
    for (const [k, v] of tree.decls.entries()) {
      if (k === 'left' || k === 'top') continue;
      canvasDecls.set(k, v);
    }
  }
  if (tree.box) {
    canvasDecls.set('width', '100%');
    canvasDecls.set('max-width', px(Math.round(tree.box.width)));
    canvasDecls.set('--page-max', px(Math.round(tree.box.width)));
    canvasDecls.delete('--canvas-width');
  }
  canvasDecls.set('margin', '0 auto');
  canvasDecls.set('position', 'relative');
  canvasDecls.set('box-sizing', 'border-box');
  if (tree.clips) canvasDecls.set('overflow', 'hidden');

  const sectionsHtml = sectionBlocks.join('\n\n').replace(/^/gm, '  ');
  const body = `  <div class="et-page">\n${sectionsHtml}\n  </div>`;
  const css = buildCss({ nameToDecls, nameSections, sectionOrder, usedOrder, canvasDecls });
  const html = buildHtml(title, body, fonts);
  const summary = [...new Set(sectionOrder.map((s) => s.label))].join(', ');
  return { html, css, js: '// static design — no runtime interactivity\n', sections: sectionOrder, sectionsSummary: summary };
}

function fontsLink(fonts) {
  const fams = [...new Set((fonts || []).filter(Boolean))];
  if (!fams.length) return '';
  const q = fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&');
  return `  <link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${q}&display=swap">`;
}

function buildHtml(title, body, fonts) {
  const fl = fontsLink(fonts);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
${fl ? fl + '\n' : ''}  <link rel="stylesheet" href="styles.css">
</head>
<body>
${body}
  <script src="script.js"></script>
</body>
</html>
`;
}

function buildCss({ nameToDecls, nameSections, sectionOrder, usedOrder, canvasDecls }) {
  const parts = [];
  parts.push(`/* styles.css — generated from the Figma design */`);
  parts.push(`/* --- reset --- */
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  -webkit-font-smoothing: antialiased;
  background: #161616;
  color: #fff;
}
img, svg { display: block; max-width: 100%; }
p, h1, h2, h3, h4, h5, h6 { margin: 0; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.et-btn,
.et-component button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  line-height: 1.2;
  box-sizing: border-box;
}`);

  if (canvasDecls && canvasDecls.size) {
    const b = [...canvasDecls.entries()].map(([k, v]) => `  ${k}: ${v};`).join('\n');
    parts.push(`/* --- page --- */\n.et-page {\n${b}\n}`);
  }

  const common = [], bySection = {};
  const ruleFor = (name) => {
    const d = nameToDecls.get(name); if (!d || !d.size) return '';
    const body = [...d.entries()].map(([k, v]) => `  ${k}: ${v};`).join('\n');
    return `.${name} {\n${body}\n}`;
  };
  for (const name of usedOrder) {
    const rule = ruleFor(name); if (!rule) continue;
    const secs = nameSections.get(name) || new Set();
    if (secs.size > 1) common.push(rule);
    else { const s = [...secs][0] || 'misc'; (bySection[s] || (bySection[s] = [])).push(rule); }
  }
  if (common.length) parts.push(`/* ===== Common / shared ===== */\n${common.join('\n\n')}`);
  const seen = new Set();
  for (const { key, label } of sectionOrder) {
    if (seen.has(key)) continue; seen.add(key);
    if (bySection[key] && bySection[key].length) parts.push(`/* ===== Section: ${label} ===== */\n${bySection[key].join('\n\n')}`);
  }

  // Real responsive rules (standards) — empty ResponsiveIR stubs are not enough.
  parts.push(`/* --- responsive (standards) --- */
html, body {
  margin: 0;
  width: 100%;
  min-height: 100%;
}
body {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #fff;
}
.et-page,
.et-component {
  box-sizing: border-box;
  width: 100%;
  max-width: min(var(--page-max, 100%), 100%);
  margin-left: auto !important;
  margin-right: auto !important;
}
${dualPath.dualPathStandardsCss()}
.et-content,
.et-flow-stack {
  position: relative !important;
  left: auto !important;
  top: auto !important;
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
}
.et-flow-row {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box;
  min-width: 0;
  position: relative !important;
  left: auto !important;
  top: auto !important;
  height: auto !important;
}
.et-flow-row > *:not(.et-card__badge):not(.et-badge) {
  position: relative !important;
  left: auto !important;
  top: auto !important;
}
.et-flow-col {
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-start !important;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
}
.et-flow-col--hug {
  flex: 0 0 auto !important;
}
.et-badge,
.et-hug {
  max-width: 100% !important;
  flex: 0 0 auto !important;
  align-self: flex-start !important;
}
/* Text/pill hugs only — never let fit-content blow up img/svg to intrinsic bitmap size */
.et-badge:not(img):not(svg),
.et-hug:not(img):not(svg):not(.et-banner__media):not(.et-card__icon):not(.et-card__media) {
  width: fit-content !important;
}
.et-card {
  position: relative !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-start !important;
  box-sizing: border-box !important;
  height: auto !important;
  max-width: 100% !important;
  overflow: hidden;
}
.et-card:not(.et-measured-card) {
  min-height: 0 !important;
}
.et-card__badge {
  position: absolute !important;
  z-index: 2;
  margin: 0 !important;
  pointer-events: none;
}
.et-card__icon {
  flex: 0 0 auto !important;
  object-fit: contain !important;
  max-width: 48px !important;
  max-height: 48px !important;
  width: auto !important;
  height: auto !important;
  overflow: visible !important;
}
.et-card.et-measured-card > .et-card__icon,
.et-card.et-measured-card > svg.et-card__icon {
  width: var(--et-icon-w, 26px) !important;
  height: var(--et-icon-h, 30px) !important;
  max-width: var(--et-icon-w, 48px) !important;
  max-height: var(--et-icon-h, 48px) !important;
  flex: 0 0 auto !important;
  margin-top: 0 !important;
  align-self: flex-start !important;
}
.et-card__media {
  height: auto !important;
  object-fit: cover !important;
  display: block;
  /* Keep Figma side insets + measured margin-top — do not force full-bleed or margin-top:auto */
  max-width: 100% !important;
}
.et-banner {
  position: relative !important;
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  align-items: center !important;
  justify-content: flex-start !important;
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
  overflow: visible !important;
}
/* Measured banners: keep oracle Y packing (icon/quote/robot), not CSS center */
.et-banner.et-measured-banner {
  align-items: flex-start !important;
}
.et-banner__media {
  flex: 0 0 auto !important;
  width: auto !important;
  max-width: 120px !important;
  max-height: 140px !important;
  height: auto !important;
  object-fit: contain !important;
  align-self: flex-end !important;
}
.et-banner.et-measured-banner > .et-banner__media {
  align-self: flex-start !important;
  width: var(--et-banner-media-w, 92px) !important;
  height: var(--et-banner-media-h, 135px) !important;
  max-width: none !important;
  max-height: none !important;
  margin-left: var(--et-banner-media-ml, 60px) !important;
}
.et-banner.et-measured-banner > .et-banner__icon {
  width: var(--et-banner-icon-w, 55px) !important;
  height: var(--et-banner-icon-h, 55px) !important;
  min-width: var(--et-banner-icon-w, 55px) !important;
  margin-top: var(--et-banner-icon-mt, 0px) !important;
}
.et-banner.et-measured-banner > .et-banner__quote {
  margin-top: var(--et-banner-quote-mt, 0px) !important;
  max-width: var(--et-banner-quote-max, 885px) !important;
}
.et-banner__icon {
  position: relative !important;
  flex: 0 0 auto !important;
  width: 55px !important;
  height: 55px !important;
  min-width: 55px !important;
  overflow: hidden;
  border-radius: 50%;
}
.et-banner__icon > [class*="ellipse"],
.et-banner__icon > .ellipse-145 {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  border-radius: 50% !important;
}
.et-banner__glyph {
  position: absolute !important;
  left: 50% !important;
  top: 50% !important;
  transform: translate(-50%, -50%) !important;
  max-width: 55% !important;
  max-height: 55% !important;
  object-fit: contain !important;
}
.et-banner__icon > svg.et-banner__glyph,
.et-banner__icon > svg {
  position: absolute !important;
  left: 50% !important;
  top: 50% !important;
  transform: translate(-50%, -50%) !important;
  width: 25px !important;
  height: 25px !important;
  max-width: 60% !important;
  max-height: 60% !important;
  opacity: 1 !important;
}
.et-banner__quote {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  color: #fff;
}
.et-section-eyebrow {
  display: inline-flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  justify-content: center !important;
  align-items: center !important;
  gap: 12px !important;
  width: fit-content !important;
  max-width: 100% !important;
  margin-inline: auto !important;
  margin-left: auto !important;
  margin-right: auto !important;
}
.et-section-header {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  text-align: center !important;
  width: 100% !important;
}
.et-section-header.et-flow-row {
  flex-direction: column !important;
}
.et-card-grid {
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
  align-items: stretch !important;
  box-sizing: border-box !important;
}
/* Heuristic promoters: wrapping flex row */
.et-card-grid:not(.et-measured-grid) {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: wrap !important;
}
.et-card-grid:not(.et-measured-grid) > .et-card {
  flex: 1 1 280px !important;
  min-width: min(100%, 260px);
}
/* Constraint transcriber: keep measured CSS grid (equal 1fr columns) */
.et-card-grid.et-measured-grid {
  display: grid !important;
  flex-wrap: nowrap !important;
  align-items: stretch !important;
}
.et-card-grid.et-measured-grid > .et-card {
  flex: none !important;
  min-width: 0 !important;
  width: auto !important;
  max-width: none !important;
  height: auto !important;
  align-self: stretch !important;
}
.et-card.et-measured-card {
  display: flex !important;
  flex-direction: column !important;
  height: auto !important;
  min-height: var(--et-card-min-h, auto) !important;
  align-self: stretch !important;
}
.et-card.et-measured-card > .et-card__icon,
.et-card.et-measured-card > svg.et-card__icon {
  width: var(--et-icon-w, 26px) !important;
  height: var(--et-icon-h, 30px) !important;
  max-width: var(--et-icon-w, 48px) !important;
  max-height: var(--et-icon-h, 48px) !important;
  flex: 0 0 auto !important;
  margin-top: 0 !important;
  align-self: flex-start !important;
  position: relative !important;
  left: auto !important;
  top: auto !important;
}
.et-card.et-measured-card > .et-card__title,
.et-card.et-measured-card > .et-card__body {
  position: relative !important;
  left: auto !important;
  top: auto !important;
}
.et-card.et-measured-card > .et-card__media:not(.et-card__icon):not(.et-card__media--top) {
  margin-top: auto !important;
  width: 100% !important;
  max-width: 100% !important;
  align-self: stretch !important;
  height: var(--et-media-h, 106px) !important;
  object-fit: cover !important;
  position: relative !important;
  left: auto !important;
  top: auto !important;
}
.et-card.et-measured-card > .et-card__media--top,
.et-card.et-image-top-card > .et-card__media {
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
  align-self: stretch !important;
  height: var(--et-media-h, 231px) !important;
  object-fit: cover !important;
  position: relative !important;
  left: auto !important;
  top: auto !important;
  flex: 0 0 auto !important;
}
.et-card__badge,
.et-card.et-image-top-card > .et-card__badge,
.et-card.et-image-top-card > .et-badge {
  position: absolute !important;
  z-index: 3 !important;
  left: var(--et-badge-left, 20px) !important;
  top: var(--et-badge-top, 20px) !important;
  right: auto !important;
  width: auto !important;
  max-width: 70% !important;
  height: auto !important;
  margin: 0 !important;
  flex: 0 0 auto !important;
}
.et-card__badge.et-flow-stack,
.et-badge.et-flow-stack {
  position: absolute !important;
  left: var(--et-badge-left, 20px) !important;
  top: var(--et-badge-top, 20px) !important;
  width: auto !important;
  max-width: 70% !important;
  height: auto !important;
}
.et-section-shell {
  position: relative !important;
  left: auto !important;
  top: auto !important;
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
  box-sizing: border-box !important;
}
.et-section-shell.et-measured-content,
.et-measured-content {
  width: 100% !important;
  max-width: min(100%, var(--et-content-max, 1196px)) !important;
  margin-left: auto !important;
  margin-right: auto !important;
  margin-top: auto !important;
  margin-bottom: auto !important;
  align-self: center !important;
}
.et-page {
  display: flex !important;
  flex-direction: column !important;
  justify-content: center !important;
  align-items: stretch !important;
}
.et-page > section {
  width: 100% !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  flex: 0 0 auto !important;
}
.et-page > section > * {
  width: 100% !important;
  max-width: min(100%, var(--et-content-max, 1196px)) !important;
  margin-left: auto !important;
  margin-right: auto !important;
}
.et-title-link-row {
  display: flex !important;
  flex-direction: row !important;
  align-items: flex-end !important;
  justify-content: space-between !important;
  gap: 24px !important;
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
}
.et-title-link-row > h1,
.et-title-link-row > h2,
.et-title-link-row > [class*="take-a-look"] {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  margin-top: 0 !important;
  position: relative !important;
  left: auto !important;
  top: auto !important;
  width: auto !important;
  max-width: none !important;
}
.et-title-link-row__cta,
.et-title-link-row > .et-title-link-row__cta {
  display: inline-flex !important;
  flex: 0 0 auto !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 6px !important;
  margin-left: auto !important;
  margin-top: 0 !important;
  width: auto !important;
  max-width: max-content !important;
  position: relative !important;
  left: auto !important;
  top: auto !important;
}
.et-card.et-image-top-card {
  align-items: stretch !important;
  padding: 0 !important;
  justify-content: flex-start !important;
}
.et-card.et-image-top-card > .et-measured-flow,
.et-card.et-image-top-card > .et-card__footer,
.et-card.et-image-top-card > [class*="group-"] {
  width: 100% !important;
  max-width: 100% !important;
  margin-left: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
  align-self: stretch !important;
  align-items: flex-start !important;
}
.et-card.et-image-top-card > .et-card__footer {
  margin-top: auto !important;
  flex: 0 0 auto !important;
}
.et-card__footer {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  justify-content: space-between !important;
  width: 100% !important;
  border-top: 1px solid #e0e0e0 !important;
  padding: 16px 0 0 0 !important;
  margin-top: 0 !important;
  gap: 12px !important;
  min-height: 48px !important;
  height: auto !important;
}
.et-card__footer > [class*="line-"],
.et-card__footer > .line-69 {
  display: none !important;
}
.et-card__footer-date {
  flex: 1 1 auto !important;
  min-width: 0 !important;
}
.et-card__footer-cta {
  flex: 0 0 auto !important;
  margin-left: auto !important;
  position: relative !important;
  width: 31px !important;
  height: 31px !important;
  min-width: 31px !important;
  min-height: 31px !important;
  border-radius: 50% !important;
  overflow: hidden !important;
}
.et-overlay {
  pointer-events: none;
}

/* Subtle interaction — shadow only (never translateY: breaks card row alignment) */
.et-card {
  transition:
    box-shadow 0.22s ease,
    outline-color 0.22s ease,
    background-color 0.22s ease;
}
.et-card:hover {
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
  outline-color: rgba(40, 100, 245, 0.2);
}
.et-card:focus-within {
  outline: 1px solid rgba(255, 255, 255, 0.35);
  outline-offset: 2px;
}
.et-btn,
.et-component button {
  transition: transform 0.18s ease, opacity 0.18s ease, filter 0.18s ease;
}
.et-btn:hover,
.et-component button:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
}
.et-btn:active,
.et-component button:active {
  transform: translateY(0);
}
@media (hover: none) {
  .et-card:hover,
  .et-btn:hover,
  .et-component button:hover {
    transform: none;
    box-shadow: none;
    filter: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .et-card,
  .et-btn,
  .et-component button {
    transition: none !important;
  }
  .et-card:hover,
  .et-btn:hover,
  .et-component button:hover {
    transform: none;
  }
}

/* Tablet / small laptop: stack header rows, fluid padding, no fixed text widths */
@media (max-width: 1100px) {
  .et-section-shell {
    padding-left: 40px !important;
    padding-right: 40px !important;
    min-height: 0 !important;
  }
  /* Header/content rows only — not card grids, quote banners, column stacks, or eyebrow chips */
  .et-flow-row:not(.et-card-grid):not(.et-banner):not(.et-section-eyebrow):not(.et-flow-col):not(.et-card):not(.et-title-link-row) {
    flex-direction: column !important;
    align-items: stretch !important;
    flex-wrap: wrap !important;
    justify-content: flex-start !important;
    gap: 20px !important;
  }
  .et-flow-row:not(.et-card-grid):not(.et-banner):not(.et-section-eyebrow):not(.et-flow-col):not(.et-card):not(.et-title-link-row) > *:not(.et-badge):not(.et-hug):not(.et-flow-col--hug):not(.et-title-link-row__cta) {
    width: 100% !important;
    max-width: 100% !important;
    flex: 1 1 auto !important;
    min-width: 0 !important;
    margin-top: 0 !important;
  }
  .et-title-link-row {
    flex-direction: row !important;
    flex-wrap: nowrap !important;
    align-items: flex-end !important;
    justify-content: space-between !important;
  }
  .et-title-link-row > h1,
  .et-title-link-row > h2,
  .et-title-link-row__cta {
    width: auto !important;
    max-width: none !important;
    flex: 0 0 auto !important;
  }
  .et-title-link-row > h1,
  .et-title-link-row > h2 {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    max-width: calc(100% - 160px) !important;
  }
  .et-section-eyebrow {
    flex-direction: row !important;
    width: fit-content !important;
    margin-inline: auto !important;
  }
  .et-banner {
    flex-direction: row !important;
    flex-wrap: nowrap !important;
    align-items: center !important;
    justify-content: flex-start !important;
  }
  .et-banner > .et-banner__icon,
  .et-banner > .et-banner__media {
    width: auto !important;
    flex: 0 0 auto !important;
  }
  .et-banner > .et-banner__quote,
  .et-banner > h1,
  .et-banner > h2,
  .et-banner > h3,
  .et-banner > p {
    flex: 1 1 auto !important;
    width: auto !important;
    max-width: none !important;
    min-width: 0 !important;
  }
  .et-badge:not(img):not(svg),
  .et-hug:not(img):not(svg):not(.et-banner__media):not(.et-card__icon):not(.et-card__media) {
    width: fit-content !important;
    max-width: 100% !important;
    flex: 0 0 auto !important;
    align-self: flex-start !important;
  }
  .et-banner__media {
    max-width: 100px !important;
    max-height: 120px !important;
    width: auto !important;
    height: auto !important;
  }
  .et-card-grid:not(.et-measured-grid) {
    flex-direction: row !important;
    flex-wrap: wrap !important;
  }
  .et-card-grid:not(.et-measured-grid) > .et-card {
    flex: 1 1 calc(50% - 12px) !important;
    width: auto !important;
    max-width: 100% !important;
  }
  .et-card-grid.et-measured-grid {
    display: grid !important;
  }
  .et-card-grid.et-measured-grid > .et-card {
    flex: none !important;
    min-width: 0 !important;
    width: auto !important;
    max-width: none !important;
  }
  h1, h2, h3, h4, h5, h6, p {
    width: auto !important;
    max-width: 100% !important;
  }
}

@media (max-width: 900px) {
  .et-section-shell {
    padding-left: 28px !important;
    padding-right: 28px !important;
  }
  .et-card-grid:not(.et-measured-grid) {
    gap: 16px !important;
  }
  .et-card-grid:not(.et-measured-grid) > .et-card {
    flex: 1 1 calc(50% - 12px) !important;
  }
  .et-card-grid.et-measured-grid {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
  .et-measured-content {
    max-width: 100% !important;
  }
  .et-section-header p,
  .et-section-header h1,
  .et-section-header h2,
  .et-section-header h3 {
    max-width: 100% !important;
  }
}

/* Phone: full-bleed content column, single-column cards */
@media (max-width: 720px) {
  .et-page,
  .et-component,
  .et-flow-row,
  .et-card-grid,
  .et-section-shell,
  .et-content {
    width: 100% !important;
    max-width: 100% !important;
  }
  .et-section-shell {
    padding: 40px 20px !important;
    min-height: 0 !important;
  }
  .et-flow-row:not(.et-banner):not(.et-measured-grid),
  .et-card-grid:not(.et-measured-grid) {
    flex-direction: column !important;
    align-items: stretch !important;
    flex-wrap: wrap !important;
    min-height: 0 !important;
    gap: 16px !important;
  }
  .et-flow-row:not(.et-banner):not(.et-measured-grid) > *:not(.et-badge):not(.et-hug):not(.et-flow-col--hug),
  .et-flow-col:not(.et-flow-col--hug),
  .et-card-grid:not(.et-measured-grid) > .et-card {
    flex: 1 1 auto !important;
    width: 100% !important;
    max-width: 100% !important;
  }
  .et-card-grid.et-measured-grid {
    display: grid !important;
    grid-template-columns: 1fr !important;
    width: 100% !important;
    max-width: 100% !important;
  }
  .et-card-grid.et-measured-grid > .et-card {
    flex: none !important;
    width: 100% !important;
    max-width: 100% !important;
  }
  .et-measured-content {
    width: 100% !important;
    max-width: 100% !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
  }
  .et-banner,
  .et-banner.et-measured-banner {
    flex-direction: column !important;
    flex-wrap: nowrap !important;
    align-items: stretch !important;
    justify-content: flex-start !important;
    gap: 16px !important;
    width: 100% !important;
    max-width: 100% !important;
    min-height: 0 !important;
    height: auto !important;
    padding: 28px 20px !important;
  }
  .et-banner.et-measured-banner > .et-banner__icon,
  .et-banner.et-measured-banner > .et-banner__quote,
  .et-banner.et-measured-banner > .et-banner__media {
    margin-top: 0 !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
    max-width: 100% !important;
    width: auto !important;
  }
  .et-banner.et-measured-banner > .et-banner__icon {
    width: 48px !important;
    height: 48px !important;
    min-width: 48px !important;
    align-self: flex-start !important;
  }
  .et-banner.et-measured-banner > .et-banner__quote {
    flex: 1 1 auto !important;
    width: 100% !important;
    max-width: 100% !important;
    font-size: clamp(18px, 5.5vw, 28px) !important;
    line-height: 1.35 !important;
  }
  .et-banner.et-measured-banner > .et-banner__media {
    align-self: flex-end !important;
    width: auto !important;
    height: auto !important;
    max-width: 96px !important;
    max-height: 120px !important;
  }
  .et-card.et-measured-card {
    width: 100% !important;
    max-width: 100% !important;
    min-height: 0 !important;
    height: auto !important;
    --et-card-min-h: 0px !important;
    padding: 24px 20px !important;
  }
  .et-card.et-measured-card > .et-card__title,
  .et-card.et-measured-card > .et-card__body {
    margin-top: 12px !important;
    max-width: 100% !important;
    width: auto !important;
  }
  .et-card.et-measured-card > .et-card__media:not(.et-card__icon):not(.et-card__media--top) {
    margin-top: 16px !important;
    width: 100% !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    --et-media-h: auto !important;
    aspect-ratio: 236 / 106;
  }
  .et-card.et-image-top-card > .et-card__media--top {
    margin-top: 0 !important;
    height: auto !important;
    aspect-ratio: 380 / 231;
    --et-media-h: auto !important;
  }
  .et-card.et-image-top-card {
    padding: 0 !important;
  }
  .et-card.et-image-top-card > .et-card__badge,
  .et-card.et-image-top-card > .et-badge,
  .et-card.et-measured-card > .et-card__badge,
  .et-card.et-measured-card > .et-badge {
    top: var(--et-badge-top, 16px) !important;
    left: var(--et-badge-left, 16px) !important;
    right: auto !important;
  }
  .et-section-header p,
  .et-section-header h1,
  .et-section-header h2,
  .et-section-header h3 {
    max-width: 100% !important;
  }
  .et-banner > .et-banner__media {
    align-self: flex-end !important;
  }
  .et-badge:not(img):not(svg),
  .et-hug:not(img):not(svg):not(.et-banner__media):not(.et-card__icon):not(.et-card__media),
  .et-flow-col--hug {
    width: fit-content !important;
    max-width: 100% !important;
    flex: 0 0 auto !important;
    align-self: flex-start !important;
  }
  .et-card {
    padding: 28px 24px !important;
  }
  .et-card__icon {
    max-width: 40px !important;
    max-height: 40px !important;
    width: auto !important;
    height: auto !important;
  }
  .et-card__media {
    width: auto !important;
    max-width: 100% !important;
    height: auto !important;
    max-height: none !important;
    object-fit: cover !important;
  }
  .et-banner__media {
    max-width: 90px !important;
    max-height: 110px !important;
  }
  h1 {
    font-size: clamp(28px, 8vw, 40px) !important;
    line-height: 1.25 !important;
  }
  .et-flow-row button {
    width: 100% !important;
    min-height: 44px;
  }
  .et-overlay {
    display: none !important;
  }
}`);

  return parts.join('\n\n') + '\n';
}

function visibleTextOf(el) {
  if (!el) return '';
  if (el.text != null) return String(el.text);
  if (el.runs && el.runs.length) return el.runs.map((r) => r.text || '').join('');
  return '';
}

function normA11yText(s) {
  return String(s || '')
    .replace(/[\u2028\u2029\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Production a11y + semantics polish (does not change layout):
 * - Drop redundant aria-label on visible text
 * - Decorative bg / card icons → alt="" aria-hidden
 * - Stamp et-card__media|title|body on card children
 * - Stamp et-badge on pill chips so responsive rules don't stretch them
 */
function parseRadiusPx(v) {
  if (!v) return 0;
  const m = String(v).match(/([\d.]+)px/);
  return m ? parseFloat(m[1]) : 0;
}

function stampHugBadges(el) {
  if (!el || !el.decls || el._etCard) return;
  const h = el.box && el.box.height;
  const w = el.box && el.box.width;
  if (!(h > 0 && h <= 40 && w > 0 && w <= 320)) return;
  const radius = parseRadiusPx(el.decls.get('border-radius'));
  const hasBg = el.decls.has('background-color') || el.decls.has('background-image');
  const pill = radius >= Math.min(h / 2, 12) || radius >= 20;
  if (!pill || !hasBg) return;
  const text = visibleTextOf(el)
    || (el.children || []).map(visibleTextOf).join(' ');
  if (!text || text.length > 48) return;

  el.extraClass = mergeClass(el.extraClass, 'et-badge et-hug');
  el.decls.set('width', 'fit-content');
  el.decls.set('max-width', '100%');
  el.decls.set('flex', '0 0 auto');
  el.decls.set('align-self', 'flex-start');
}

function polishGeneratedTree(el) {
  if (!el) return;
  stampHugBadges(el);
  (el.children || []).forEach(polishGeneratedTree);

  const isCard = !!(el._etCard || hasClassToken(el.extraClass, 'et-card'));
  if (isCard) {
    (el.children || []).forEach((c) => {
      if (!c) return;
      if (c.kind === 'img' || c.kind === 'svg') {
        const isIcon = hasClassToken(c.extraClass, 'et-card__icon')
          || (c.box && c.box.width <= 64 && c.box.height <= 64 && c.kind === 'svg');
        if (isIcon) {
          c.extraClass = mergeClass(c.extraClass, 'et-card__icon');
        } else {
          c.extraClass = mergeClass(c.extraClass, 'et-card__media');
        }
        if (!c.attrs) c.attrs = {};
        c.attrs.alt = '';
        c.attrs['aria-hidden'] = 'true';
      } else if (c.tag === 'h1' || c.tag === 'h2' || c.tag === 'h3' || c.tag === 'h4') {
        c.extraClass = mergeClass(c.extraClass, 'et-card__title');
      } else if (c.tag === 'p' && !hasClassToken(c.extraClass, 'et-card__badge') && !hasClassToken(c.extraClass, 'et-badge')) {
        c.extraClass = mergeClass(c.extraClass, 'et-card__body');
      }
    });
  }

  // Full-bleed background layers (solid/img) are decorative
  const isBleed = el.decls
    && el.decls.get('position') === 'absolute'
    && (el.decls.get('inset') === '0' || el.decls.get('height') === '100%')
    && (el.kind === 'img' || el.kind === 'el');
  if (isBleed && (el.kind === 'img' || /^rectangle/i.test(el.name || ''))) {
    if (!el.attrs) el.attrs = {};
    if (el.kind === 'img') el.attrs.alt = '';
    el.attrs['aria-hidden'] = 'true';
    el.attrs.role = 'presentation';
  }

  if (el.attrs && el.attrs['aria-label']) {
    const visible = visibleTextOf(el);
    const textTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'label', 'span', 'a', 'button']);
    if (visible && textTags.has(el.tag)) {
      // Visible text is the accessible name — aria-label duplicates/overrides it
      delete el.attrs['aria-label'];
    } else if (visible && normA11yText(el.attrs['aria-label']) === normA11yText(visible)) {
      delete el.attrs['aria-label'];
    }
  }
}

module.exports = {
  analyze,
  emit,
  polishGeneratedTree,
  inferColumnFlex,
  evaluateColumnFlex,
  normalizeEmitMode,
  resolveEmitMode,
  buildQualityScorecard,
  COLUMN_FLEX_MIN_SCORE,
  dualPath,
};
