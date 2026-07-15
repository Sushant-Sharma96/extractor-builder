// figma-generate.js
// Turns a Figma node subtree into clean semantic HTML + one styles.css, matching
// the Lovable converter's output conventions (semantic reusable classes, per-
// section comments, assets/). Auto-layout frames → flexbox; freeform frames →
// absolute positioning. Text/fills/strokes/effects/radius map directly from the
// node's real properties (the source of truth), so the result is accurate.

// ---- helpers ----------------------------------------------------------------
function hex2(n) { return Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0'); }
function figmaColor(c, opacity) {
  if (!c) return null;
  const a = (c.a == null ? 1 : c.a) * (opacity == null ? 1 : opacity);
  if (a >= 0.999) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${+a.toFixed(3)})`;
}
function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function px(n) { return `${round(n)}px`; }

function visibleFills(node) {
  return (node.fills || []).filter((f) => f.visible !== false && (f.opacity == null || f.opacity > 0));
}

function gradientCss(fill) {
  const stops = (fill.gradientStops || []).map((s) => `${figmaColor(s.color)} ${round(s.position * 100)}%`).join(', ');
  const h = fill.gradientHandlePositions || [];
  if (fill.type === 'GRADIENT_RADIAL' || fill.type === 'GRADIENT_DIAMOND') return `radial-gradient(${stops})`;
  let angle = 180;
  if (h.length >= 2) angle = Math.round(Math.atan2(h[1].y - h[0].y, h[1].x - h[0].x) * 180 / Math.PI) + 90;
  return `linear-gradient(${angle}deg, ${stops})`;
}

// ---- node → declarations ----------------------------------------------------
// ctx.exportImage(id) marks a node for PNG export; ctx.exportSvg(id) for SVG.
function nodeDecls(node, parent, ctx) {
  const d = new Map();
  const set = (k, v) => { if (v != null && v !== '') d.set(k, v); };
  const box = node.absoluteBoundingBox || {};
  const parentBox = (parent && parent.absoluteBoundingBox) || {};
  const parentAuto = parent && (parent.layoutMode === 'HORIZONTAL' || parent.layoutMode === 'VERTICAL');
  const isAuto = node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL';

  // --- layout: auto-layout → flex -------------------------------------------
  if (isAuto) {
    set('display', 'flex');
    set('flex-direction', node.layoutMode === 'VERTICAL' ? 'column' : 'row');
    if (node.itemSpacing) set('gap', px(node.itemSpacing));
    if (node.layoutWrap === 'WRAP') set('flex-wrap', 'wrap');
    const pad = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft];
    if (pad.some((p) => p)) set('padding', pad.map((p) => px(p || 0)).join(' '));
    const JUST = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' };
    const ALIGN = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline' };
    if (JUST[node.primaryAxisAlignItems]) set('justify-content', JUST[node.primaryAxisAlignItems]);
    if (ALIGN[node.counterAxisAlignItems]) set('align-items', ALIGN[node.counterAxisAlignItems]);
  }

  // --- sizing ----------------------------------------------------------------
  const hSize = node.layoutSizingHorizontal; // FIXED | FILL | HUG
  const vSize = node.layoutSizingVertical;
  if (parentAuto) {
    const primaryRow = parent.layoutMode === 'HORIZONTAL';
    // fill along the parent's primary axis → grow; along counter axis → stretch
    if ((primaryRow && hSize === 'FILL') || (!primaryRow && vSize === 'FILL')) set('flex', '1 1 0%');
    if ((primaryRow && vSize === 'FILL') || (!primaryRow && hSize === 'FILL')) set('align-self', 'stretch');
    if (hSize === 'FIXED' && box.width) set('width', px(box.width));
    if (vSize === 'FIXED' && box.height) set('height', px(box.height));
  } else if (parent) {
    // freeform child → absolute position within the parent
    if (box.x != null && parentBox.x != null) {
      set('position', 'absolute');
      set('left', px(box.x - parentBox.x));
      set('top', px(box.y - parentBox.y));
      if (box.width) set('width', px(box.width));
      if (box.height) set('height', px(box.height));
    }
  }
  if (node.rotation) set('transform', `rotate(${round(-node.rotation * 180 / Math.PI)}deg)`);

  // --- fills → background / color -------------------------------------------
  const fills = visibleFills(node);
  const isText = node.type === 'TEXT';
  if (fills.length) {
    const top = fills[fills.length - 1];
    if (top.type === 'SOLID') {
      if (isText) set('color', figmaColor(top.color, top.opacity));
      else set('background-color', figmaColor(top.color, top.opacity));
    } else if (top.type && top.type.startsWith('GRADIENT')) {
      if (isText) { set('background-image', gradientCss(top)); set('-webkit-background-clip', 'text'); set('background-clip', 'text'); set('color', 'transparent'); }
      else set('background-image', gradientCss(top));
    } else if (top.type === 'IMAGE') {
      ctx.exportImage(node.id);
      set('background-size', top.scaleMode === 'FIT' ? 'contain' : 'cover');
      set('background-position', 'center');
      set('background-repeat', 'no-repeat');
      ctx.bgImageNodes.add(node.id); // resolved to url later
    }
  }

  // --- strokes → border ------------------------------------------------------
  const strokes = (node.strokes || []).filter((s) => s.visible !== false);
  if (strokes.length && node.strokeWeight) {
    const c = strokes[0].type === 'SOLID' ? figmaColor(strokes[0].color, strokes[0].opacity) : null;
    if (c) set('border', `${px(node.strokeWeight)} solid ${c}`);
  }

  // --- corner radius ---------------------------------------------------------
  if (Array.isArray(node.rectangleCornerRadii)) set('border-radius', node.rectangleCornerRadii.map(px).join(' '));
  else if (node.cornerRadius) set('border-radius', px(node.cornerRadius));
  if (node.type === 'ELLIPSE') set('border-radius', '50%');

  // --- effects → shadow / blur ----------------------------------------------
  const effs = (node.effects || []).filter((e) => e.visible !== false);
  const shadows = [];
  for (const e of effs) {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      shadows.push(`${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius)} ${e.spread ? px(e.spread) + ' ' : ''}${figmaColor(e.color)}`);
    } else if (e.type === 'LAYER_BLUR') set('filter', `blur(${px(e.radius)})`);
    else if (e.type === 'BACKGROUND_BLUR') set('backdrop-filter', `blur(${px(e.radius)})`);
  }
  if (shadows.length) set('box-shadow', shadows.join(', '));

  if (node.opacity != null && node.opacity < 1) set('opacity', String(round(node.opacity)));

  // --- typography ------------------------------------------------------------
  if (isText && node.style) {
    const s = node.style;
    if (s.fontFamily) { set('font-family', `'${s.fontFamily}', sans-serif`); ctx.fonts.add(s.fontFamily); }
    if (s.fontWeight) set('font-weight', String(s.fontWeight));
    if (s.fontSize) set('font-size', px(s.fontSize));
    if (s.lineHeightPx) set('line-height', px(s.lineHeightPx));
    if (s.letterSpacing) set('letter-spacing', px(s.letterSpacing));
    const TA = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' };
    if (TA[s.textAlignHorizontal]) set('text-align', TA[s.textAlignHorizontal]);
    if (s.textDecoration === 'UNDERLINE') set('text-decoration', 'underline');
    if (s.textDecoration === 'STRIKETHROUGH') set('text-decoration', 'line-through');
    const TC = { UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' };
    if (TC[s.textCase]) set('text-transform', TC[s.textCase]);
  }

  return d;
}

module.exports = { nodeDecls, figmaColor, visibleFills };
