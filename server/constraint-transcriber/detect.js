'use strict';
/**
 * Pattern helpers for specialized transcription (card grids, banners).
 * General walk no longer depends on detectTargets alone — findCardGridAt is per-node.
 */

const { absBox, sizesEqual, hasText, isVisible, isFullBleedBg, cfg } = require('./geometry');

function walk(el, fn) {
  if (!el) return;
  fn(el);
  (el.children || []).forEach((c) => walk(c, fn));
}

function isCardLikeFrame(el) {
  if (!el || !el.box || !el.decls) return false;
  if (el._sourceAutoLayout) return false;
  const b = absBox(el);
  // Looser than first-slice: article cards and feature tiles vary
  if (!b || b.w < 120 || b.w > 720 || b.h < 100 || b.h > 900) return false;
  const hasChrome = el.decls.has('background-color')
    || el.decls.has('border')
    || el.decls.has('background-image')
    || el.decls.has('box-shadow');
  const kids = (el.children || []).filter(isVisible);
  if (kids.length < 2) return false;
  // Image card: large img + text cluster
  const hasImg = kids.some((c) => c.kind === 'img' && absBox(c) && absBox(c).w >= b.w * 0.5);
  if (hasImg && kids.some(hasText)) return true;
  if (!hasChrome) return false;
  return kids.some(hasText);
}

function isDarkBanner(el) {
  if (!el || !el.box || !el.decls) return false;
  const b = absBox(el);
  if (!b || b.w < 400 || b.h < 80 || b.h > 320) return false;

  let dark = false;
  const bg = el.decls.get('background-color') || '';
  if (/rgb\(\s*\d{1,2}\s*,|#[0-3][0-9a-f]{5}/i.test(bg)) dark = true;
  if (!dark) {
    for (const c of el.children || []) {
      if (!c || !c.decls) continue;
      const fill = c.decls.get('background-color') || '';
      const cb = absBox(c);
      if (cb && cb.w >= b.w * 0.9 && /rgb\(\s*\d{1,2}\s*,|#[0-3][0-9a-f]{5}/i.test(fill)) {
        dark = true;
        break;
      }
    }
  }
  if (!dark) return false;

  let hasQuote = false;
  let hasMedia = false;
  walk(el, (n) => {
    if (n === el) return;
    if (hasText(n) && absBox(n) && absBox(n).w > 100) hasQuote = true;
    if (n.kind === 'img' && absBox(n) && absBox(n).w > 50) hasMedia = true;
  });
  return hasQuote && hasMedia;
}

/**
 * If `el` is an equal-width horizontal card row, return { container, cards }.
 * Also supports mixed parents: returns { container, cards, band: true } when
 * ≥2 card-like siblings share a Y band among other children (Articles).
 */
function findCardGridAt(el) {
  if (!el || !el.children || el._constraintTranscribed) return null;
  const kids = el.children.filter(isVisible);
  const cards = kids.filter(isCardLikeFrame);
  if (cards.length < 2) return null;

  const byX = [...cards].sort((a, b) => absBox(a).x - absBox(b).x);
  const tops = byX.map((c) => absBox(c).y);
  const ws = byX.map((c) => absBox(c).w);
  const hs = byX.map((c) => absBox(c).h);
  const topSpan = Math.max(...tops) - Math.min(...tops);
  const wOk = ws.every((w) => sizesEqual(w, ws[0]));
  const hOk = hs.every((h) => sizesEqual(h, hs[0]) || Math.abs(h - hs[0]) <= Math.max(hs[0] * 0.2, 24));
  if (!(topSpan <= cfg.ALIGN_TOL + 8 && wOk && hOk)) return null;

  const other = kids.filter((c) => !cards.includes(c) && !isFullBleedBg(c, el));
  const mostlyCards = other.length === 0
    || other.every((c) => {
      const b = absBox(c);
      return b && (b.w <= 4 || b.h <= 4);
    });
  if (mostlyCards) {
    return { container: el, cards: byX };
  }
  // Mixed parent (header + card row): promote as a band to wrap
  if (cards.length >= 2 && byX.every((c) => {
    const b = absBox(c);
    return b && b.w >= 140;
  })) {
    return { container: el, cards: byX, band: true };
  }
  return null;
}

/**
 * @returns {{ cardGrids: { container: object, cards: object[] }[], banners: object[] }}
 */
function detectTargets(tree) {
  const cardGrids = [];
  const banners = [];
  const gridIds = new Set();
  const bannerIds = new Set();

  walk(tree, (el) => {
    if (!el || !el.children || el._constraintTranscribed) return;
    const grid = findCardGridAt(el);
    if (grid) {
      const id = el.nodeId || el;
      if (!gridIds.has(id)) {
        gridIds.add(id);
        cardGrids.push(grid);
      }
    }
    if (isDarkBanner(el)) {
      const id = el.nodeId || el;
      if (!bannerIds.has(id)) {
        bannerIds.add(id);
        banners.push(el);
      }
    }
  });

  return { cardGrids, banners };
}

module.exports = {
  detectTargets,
  isCardLikeFrame,
  isDarkBanner,
  findCardGridAt,
};
