'use strict';

const cfg = require('./config');

function px(n) {
  return `${Math.round((n + 1e-9) * 100) / 100}px`;
}

function absBox(el) {
  if (!el || !el.box) return null;
  const b = el.box;
  return {
    x: b.x,
    y: b.y,
    w: b.width != null ? b.width : b.w,
    h: b.height != null ? b.height : b.h,
  };
}

/** Union of absolute boxes — used for synthetic card-band wrappers. */
function unionBoxes(els) {
  const boxes = (els || []).map(absBox).filter(Boolean);
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const btm = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, width: r - x, height: btm - y };
}

/** Parent-relative oracle box (Pass-1 spec). */
function relBox(el, parent) {
  const a = absBox(el);
  const p = absBox(parent);
  if (!a || !p) return null;
  return { x: a.x - p.x, y: a.y - p.y, w: a.w, h: a.h };
}

function area(b) {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

function overlapArea(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function sizesEqual(a, b) {
  const dw = Math.abs(a - b);
  const base = Math.max(a, b, 1);
  return dw <= cfg.SIZE_TOL_PX || dw / base <= cfg.SIZE_TOL_PCT;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function isVisible(el) {
  if (!el) return false;
  if (el.visible === false) return false;
  const b = absBox(el);
  if (!b) return false;
  // Figma LINE nodes are stroke-only — absoluteBoundingBox.height is often 0
  if (el.type === 'LINE' || /^line\b/i.test(String(el.name || ''))) {
    return b.w >= 0.5 || b.h >= 0.5;
  }
  if (b.w < 0.5 || b.h < 0.5) return false;
  return true;
}

function isFullBleedBg(child, parent) {
  const c = absBox(child);
  const p = absBox(parent);
  if (!c || !p) return false;
  const coverX = c.w >= p.w * 0.92;
  const coverY = c.h >= p.h * 0.85;
  const nearOrigin = Math.abs(c.x - p.x) <= cfg.ALIGN_TOL + 2
    && Math.abs(c.y - p.y) <= cfg.ALIGN_TOL + 2;
  const hasPaint = !!(child.decls && (
    child.decls.has('background-color')
    || child.decls.has('background-image')
    || (child.kind === 'svg' || child.type === 'VECTOR')
  ));
  return coverX && coverY && nearOrigin && hasPaint;
}

function isDecorativeDot(el) {
  const b = absBox(el);
  if (!b) return false;
  if (b.w <= 10 && b.h <= 10) return true;
  const name = String(el.name || '');
  return /^ellipse/i.test(name) && b.w <= 12 && b.h <= 12;
}

function isStepOverlay(el, parent) {
  const label = String((el.text != null ? el.text : el.name) || '').trim();
  if (/^STEP[_\s-]?\d+/i.test(label)) return true;
  const r = relBox(el, parent);
  const p = absBox(parent);
  if (!r || !p) return false;
  return r.w <= 72 && r.h <= 24
    && (el.text != null || el.runs)
    && r.x > p.w * 0.45
    && r.y < p.h * 0.2;
}

function hasText(el) {
  if (!el) return false;
  if (el.text != null || el.runs) return true;
  return (el.children || []).some(hasText);
}

function mergeClass(existing, add) {
  const parts = String(existing || '').split(/\s+/).filter(Boolean);
  String(add || '').split(/\s+/).filter(Boolean).forEach((c) => {
    if (!parts.includes(c)) parts.push(c);
  });
  return parts.join(' ');
}

module.exports = {
  px,
  absBox,
  unionBoxes,
  relBox,
  area,
  overlapArea,
  sizesEqual,
  median,
  isVisible,
  isFullBleedBg,
  isDecorativeDot,
  isStepOverlay,
  hasText,
  mergeClass,
  cfg,
};
