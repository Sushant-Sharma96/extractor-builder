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
  if (fill.type === 'GRADIENT_ANGULAR') {
    let from = 0;
    if (h.length >= 2) from = round(Math.atan2(h[1].x - h[0].x, -(h[1].y - h[0].y)) * 180 / Math.PI);
    return `conic-gradient(from ${from}deg, ${stops})`;
  }
  // Linear. Figma handles are box-normalized, y-down; CSS angle is measured
  // clockwise from "to top" (0deg = up, 90deg = right). Map the start→end vector
  // accordingly (previous +90/atan2(dy,dx) form was ~90deg off on diagonals).
  let angle = 180;
  if (h.length >= 2) {
    const dx = h[1].x - h[0].x, dy = h[1].y - h[0].y;
    angle = round(((Math.atan2(dx, -dy) * 180 / Math.PI) % 360 + 360) % 360);
  }
  return `linear-gradient(${angle}deg, ${stops})`;
}

// Image fill → CSS background sizing/position. In the REST API scaleMode:
//   FILL  → cover ·  FIT → contain ·  TILE → repeat(scalingFactor) ·
//   STRETCH+imageTransform → CROP (a 2×3 affine on normalised image coords;
//   diagonal = scale, translation column = pan). Derive size/position from it.
function imageFillCss(f) {
  const m = f.scaleMode;
  if (m === 'FIT') return { size: 'contain', position: 'center', repeat: 'no-repeat' };
  if (m === 'TILE') { const s = f.scalingFactor || 1; return { size: `${round(s * 100)}%`, position: '0 0', repeat: 'repeat' }; }
  if (m === 'STRETCH' && f.imageTransform) {
    const t = f.imageTransform, a = t[0][0], e = t[1][1], cx = t[0][2], cy = t[1][2];
    const sx = a ? 1 / a : 1, sy = e ? 1 / e : 1;
    const posX = Math.abs(1 - a) > 1e-4 ? round((cx / (1 - a)) * 100) : 0;
    const posY = Math.abs(1 - e) > 1e-4 ? round((cy / (1 - e)) * 100) : 0;
    return { size: `${round(sx * 100)}% ${round(sy * 100)}%`, position: `${posX}% ${posY}%`, repeat: 'no-repeat' };
  }
  return { size: 'cover', position: 'center', repeat: 'no-repeat' }; // FILL (and any fallback)
}

// Composite ALL visible fills into stacked CSS backgrounds (Figma paints the
// array bottom→top; CSS lists layers top→bottom, so we unshift). Returns a
// background-color base plus aligned image/size/position/repeat layer lists.
// Image layers emit a `__IMG__` sentinel that emit() swaps for the resolved url.
function paintLayers(node, ctx) {
  const fills = visibleFills(node);
  const images = [], sizes = [], positions = [], repeats = [];
  let color = null;
  for (const f of fills) { // bottom → top
    if (f.type === 'SOLID') {
      const c = figmaColor(f.color, f.opacity);
      if (images.length === 0) color = c;                    // bottom-most solid → base color
      else { images.unshift(`linear-gradient(${c}, ${c})`); sizes.unshift('auto'); positions.unshift('0 0'); repeats.unshift('repeat'); } // solid over media → flat layer
    } else if (f.type && f.type.startsWith('GRADIENT')) {
      images.unshift(gradientCss(f)); sizes.unshift('auto'); positions.unshift('0 0'); repeats.unshift('no-repeat');
    } else if (f.type === 'IMAGE') {
      ctx.exportImage(node.id); ctx.bgImageNodes.add(node.id);
      const g = imageFillCss(f);
      images.unshift('__IMG__'); sizes.unshift(g.size); positions.unshift(g.position); repeats.unshift(g.repeat);
    }
  }
  return { color, images, sizes, positions, repeats };
}

// Stroke → border. Honours strokeAlign (INSIDE=border with border-box; OUTSIDE=
// outline so layout size is unaffected; CENTER≈border), individualStrokeWeights
// (per-side rules — bottom-only dividers etc.), and dashes.
function strokeCss(node, set) {
  const strokes = (node.strokes || []).filter((s) => s.visible !== false);
  if (!strokes.length) return;
  const s0 = strokes[0];
  const color = s0.type === 'SOLID' ? figmaColor(s0.color, s0.opacity) : null;
  if (!color) return;
  const style = (node.strokeDashes && node.strokeDashes.length) ? 'dashed' : 'solid';
  const iw = node.individualStrokeWeights;
  if (iw && (iw.top || iw.right || iw.bottom || iw.left)) {
    set('border-style', style); set('border-color', color);
    if (iw.top) set('border-top-width', px(iw.top));
    if (iw.right) set('border-right-width', px(iw.right));
    if (iw.bottom) set('border-bottom-width', px(iw.bottom));
    if (iw.left) set('border-left-width', px(iw.left));
    return;
  }
  if (!node.strokeWeight) return;
  if (node.strokeAlign === 'OUTSIDE') {
    // outline draws outside the box without affecting layout — matches Figma OUTSIDE
    set('outline', `${px(node.strokeWeight)} ${style} ${color}`);
  } else {
    // INSIDE (with global box-sizing:border-box) and CENTER ≈ border
    set('border', `${px(node.strokeWeight)} ${style} ${color}`);
  }
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
  if (fills.length && isText) {
    // text uses the top fill: a solid colour, or a clipped gradient (gradient text)
    const top = fills[fills.length - 1];
    if (top.type === 'SOLID') set('color', figmaColor(top.color, top.opacity));
    else if (top.type && top.type.startsWith('GRADIENT')) {
      set('background-image', gradientCss(top)); set('-webkit-background-clip', 'text'); set('background-clip', 'text'); set('color', 'transparent');
    }
  } else if (fills.length) {
    // every visible fill, composited as stacked CSS backgrounds (layered fills)
    const p = paintLayers(node, ctx);
    if (p.color) set('background-color', p.color);
    if (p.images.length) {
      set('background-image', p.images.join(', '));
      set('background-size', p.sizes.join(', '));
      set('background-position', p.positions.join(', '));
      set('background-repeat', p.repeats.join(', '));
    }
  }

  // --- strokes → border / outline -------------------------------------------
  strokeCss(node, set);

  // --- corner radius ---------------------------------------------------------
  if (Array.isArray(node.rectangleCornerRadii) && node.rectangleCornerRadii.some((r) => r > 0)) set('border-radius', node.rectangleCornerRadii.map(px).join(' '));
  else if (node.cornerRadius) set('border-radius', px(node.cornerRadius));
  if (node.type === 'ELLIPSE') set('border-radius', '50%');

  // --- clipping --------------------------------------------------------------
  // Frames that clip their content in Figma (cards, avatar/photo crops, masked
  // media) must hide overflow, or oversized image layers spill across the page.
  if (node.clipsContent) set('overflow', 'hidden');

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

  // --- blend mode ------------------------------------------------------------
  const BLEND = { MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', DARKEN: 'darken', LIGHTEN: 'lighten', COLOR_DODGE: 'color-dodge', COLOR_BURN: 'color-burn', HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light', DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity' };
  if (BLEND[node.blendMode]) set('mix-blend-mode', BLEND[node.blendMode]);

  // --- aspect ratio (media that preserves ratio) ----------------------------
  if (node.preserveRatio && box.width && box.height) set('aspect-ratio', `${round(box.width)} / ${round(box.height)}`);

  // --- typography ------------------------------------------------------------
  if (isText && node.style) {
    const s = node.style;
    if (s.fontFamily) { set('font-family', `'${s.fontFamily}', sans-serif`); ctx.fonts.add(s.fontFamily); }
    if (s.fontWeight) set('font-weight', String(s.fontWeight));
    if (s.italic || /italic|oblique/i.test(s.fontStyle || '')) set('font-style', 'italic');
    if (s.fontSize) set('font-size', px(s.fontSize));
    if (s.lineHeightPx) set('line-height', px(s.lineHeightPx));
    if (s.letterSpacing) set('letter-spacing', px(s.letterSpacing));
    const TA = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' };
    if (TA[s.textAlignHorizontal]) set('text-align', TA[s.textAlignHorizontal]);
    if (s.textDecoration === 'UNDERLINE') set('text-decoration', 'underline');
    if (s.textDecoration === 'STRIKETHROUGH') set('text-decoration', 'line-through');
    const TC = { UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' };
    if (TC[s.textCase]) set('text-transform', TC[s.textCase]);
    // vertical alignment inside a fixed text box → flex column justification
    const VA = { CENTER: 'center', BOTTOM: 'flex-end' };
    if (VA[s.textAlignVertical]) { set('display', 'flex'); set('flex-direction', 'column'); set('justify-content', VA[s.textAlignVertical]); }
    // truncation
    if (node.textTruncation === 'ENDING' || s.textAutoResize === 'TRUNCATE') { set('overflow', 'hidden'); set('text-overflow', 'ellipsis'); }
  }

  return d;
}

// Reconstruct a vector/icon node as inline SVG from its geometry — LOCALLY, with
// ZERO REST calls. Figma returns fillGeometry/strokeGeometry (SVG path data) when
// the file is fetched with `geometry=paths`; we wrap those paths in an <svg> sized
// to the node box, painting fills/strokes from the node's own paints. This removes
// the entire /images?format=svg render storm (the endpoint that causes the lock).
//
// Icon frames (fi_*) often only carry a bbox rectangle on the frame itself; the
// real paths live on VECTOR children. We compose those children when own geometry
// is empty or bbox-only — otherwise we emit a white/currentColor square.
const VECTOR_LEAF = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON', 'LINE', 'ELLIPSE']);

function geometryArrays(node) {
  const fillG = node.fillGeometry || node.fillsGeometry || [];
  const strokeG = node.strokeGeometry || [];
  return { fillG, strokeG };
}

function paintFromNode(node) {
  const fills = visibleFills(node);
  const solid = fills.find((f) => f.type === 'SOLID');
  const grad = fills.find((f) => f.type && f.type.startsWith('GRADIENT'));
  const fillColor = solid ? figmaColor(solid.color, solid.opacity)
    : (grad && grad.gradientStops && grad.gradientStops[0] ? figmaColor(grad.gradientStops[0].color) : null);
  const strokes = (node.strokes || []).filter((s) => s.visible !== false);
  const strokeColor = strokes[0] && strokes[0].type === 'SOLID' ? figmaColor(strokes[0].color, strokes[0].opacity) : null;
  return { fillColor, strokeColor };
}

function nearlyEq(a, b, eps = 0.06) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(eps, Math.abs(b) * 0.01);
}

function isBBoxRectPath(path, w, h) {
  if (!path || typeof path !== 'string') return false;
  if (!(w > 0) || !(h > 0)) return false;
  // Extract numbers — do NOT strip all whitespace (breaks decimals: '25.1141 0' -> '25.11410')
  const nums = [];
  const re = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
  let m;
  while ((m = re.exec(path)) !== null) nums.push(parseFloat(m[0]));
  // Classic bbox rect: M0 0 L w 0 L w h L 0 h [L 0 0] Z  → 8 or 10 numbers
  if (nums.length >= 8) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = nums;
    if (nearlyEq(x0, 0) && nearlyEq(y0, 0)
      && nearlyEq(x1, w) && nearlyEq(y1, 0)
      && nearlyEq(x2, w) && nearlyEq(y2, h)
      && nearlyEq(x3, 0) && nearlyEq(y3, h)) return true;
  }
  // H/V form: M0 0 H w V h H 0 → numbers 0,0,w,h,0
  if (nums.length >= 5 && /H/i.test(path) && /V/i.test(path)) {
    const [x0, y0, hw, vh] = nums;
    if (nearlyEq(x0, 0) && nearlyEq(y0, 0) && nearlyEq(hw, w) && nearlyEq(vh, h)) return true;
  }
  return false;
}

function isOwnGeometryBBoxOnly(node) {
  const { fillG, strokeG } = geometryArrays(node);
  const b = node.absoluteBoundingBox || {};
  return fillG.length === 1 && !strokeG.length && isBBoxRectPath(fillG[0].path, b.width || 0, b.height || 0);
}

function pathPartsForNode(node, ox, oy) {
  const { fillG, strokeG } = geometryArrays(node);
  const b = node.absoluteBoundingBox || {};
  const parts = [];
  const { fillColor, strokeColor } = paintFromNode(node);
  const paint = fillColor || strokeColor || 'currentColor';
  const tf = (ox || oy) ? (' transform="translate(' + round(ox) + ' ' + round(oy) + ')"') : '';
  for (const g of fillG) {
    // Never paint frame/vector bbox chrome as the icon glyph
    if (isBBoxRectPath(g.path, b.width || 0, b.height || 0)) continue;
    const rule = g.windingRule === 'EVENODD' ? ' fill-rule="evenodd"' : '';
    parts.push('<path d="' + g.path + '" fill="' + paint + '"' + rule + tf + '/>');
  }
  for (const g of strokeG) {
    parts.push('<path d="' + g.path + '" fill="' + (strokeColor || paint) + '"' + tf + '/>');
  }
  return parts;
}

/** Compose VECTOR children into one SVG when the frame itself is bbox-only/empty. */
function reconstructFromChildren(root) {
  const rb = root.absoluteBoundingBox || {};
  const w = round(rb.width || 0), h = round(rb.height || 0);
  if (!w || !h) return null;
  const parts = [];
  function walk(n) {
    if (!n || n.visible === false) return;
    if (n !== root && VECTOR_LEAF.has(n.type)) {
      const nb = n.absoluteBoundingBox || {};
      const ox = (nb.x || 0) - (rb.x || 0);
      const oy = (nb.y || 0) - (rb.y || 0);
      parts.push.apply(parts, pathPartsForNode(n, ox, oy));
      return;
    }
    for (const c of n.children || []) walk(c);
  }
  walk(root);
  if (!parts.length) return null;
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h
    + '" fill="none" xmlns="http://www.w3.org/2000/svg">' + parts.join('') + '</svg>';
}

function reconstructSvg(node) {
  const b = node.absoluteBoundingBox || {};
  const w = round(b.width || 0), h = round(b.height || 0);
  if (!w || !h) return null;
  const { fillG, strokeG } = geometryArrays(node);
  const onlyBBox = isOwnGeometryBBoxOnly(node);
  const empty = !fillG.length && !strokeG.length;

  // Icon frames / groups: compose real child paths instead of the frame bbox.
  if (empty || onlyBBox) {
    const composed = reconstructFromChildren(node);
    if (composed) return composed;
    return null; // never emit bbox placeholder squares
  }

  const { fillColor, strokeColor } = paintFromNode(node);
  const paint = fillColor || strokeColor || 'currentColor';
  const parts = [];
  for (const g of fillG) {
    const rule = g.windingRule === 'EVENODD' ? ' fill-rule="evenodd"' : '';
    parts.push('<path d="' + g.path + '" fill="' + paint + '"' + rule + '/>');
  }
  for (const g of strokeG) {
    parts.push('<path d="' + g.path + '" fill="' + (strokeColor || paint) + '"/>');
  }
  if (!parts.length) return null;
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h
    + '" fill="none" xmlns="http://www.w3.org/2000/svg">' + parts.join('') + '</svg>';
}

/** True when this node (or its vector children) can yield a real icon SVG locally. */
function canBuildSvgLocally(node) {
  if (!node) return false;
  const b = node.absoluteBoundingBox || {};
  if (!(b.width > 0) || !(b.height > 0)) return false;
  const { fillG, strokeG } = geometryArrays(node);
  const onlyBBox = isOwnGeometryBBoxOnly(node);
  if ((fillG.length || strokeG.length) && !onlyBBox) {
    const pathLen = fillG.reduce((n, g) => n + String(g.path || '').length, 0)
      + strokeG.reduce((n, g) => n + String(g.path || '').length, 0);
    if (pathLen >= 24) return true;
  }
  let found = false;
  function walk(n) {
    if (!n || n.visible === false || found) return;
    if (n !== node && VECTOR_LEAF.has(n.type)) {
      const g = geometryArrays(n);
      if ((g.fillG.length || g.strokeG.length) && !isOwnGeometryBBoxOnly(n)) found = true;
      return;
    }
    for (const c of n.children || []) walk(c);
  }
  walk(node);
  return found;
}

// Build { nodeId: svgMarkup } for a map of vector nodes — local, no REST.
function reconstructSvgMarkup(svgNodes) {
  const out = {};
  for (const id of Object.keys(svgNodes || {})) {
    const svg = reconstructSvg(svgNodes[id]);
    if (svg) out[id] = svg;
  }
  return out;
}

module.exports = { nodeDecls, figmaColor, visibleFills, reconstructSvg, reconstructSvgMarkup, isBBoxRectPath, canBuildSvgLocally, isOwnGeometryBBoxOnly };
