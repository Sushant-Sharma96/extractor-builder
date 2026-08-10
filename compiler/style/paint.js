'use strict';

/**
 * Style Resolver — Paint module. docs/PAINT_ARCHITECTURE_RESEARCH.md +
 * docs/STYLE_RESOLVER_ARCHITECTURE.md. Style Resolver is the single owner
 * of every visual property Figma can produce; Paint (fills, gradients,
 * strokes, blend modes, image fills/transforms/filters) is one module of
 * it, not a separate architecture.
 *
 * This file starts with a verbatim relocation of already-correct fill/
 * gradient/stroke/blend-mode logic out of css-declarations.js (zero
 * behavior change), then adds the real, census-grounded fixes: image
 * filters, imageTransform-aware object-position, and the SOLID+IMAGE
 * wash/opacity case (the original trigger for this whole research effort).
 */

const { px, round, figmaColor } = require('../emit/render/units');

/**
 * Figma blend-mode enum -> CSS `mix-blend-mode` keyword. NORMAL and
 * PASS_THROUGH are deliberately absent (Figma's own default; no
 * declaration needed) rather than mapped to CSS `normal`.
 */
const BLEND_MODE_CSS = {
  MULTIPLY: 'multiply',
  SCREEN: 'screen',
  OVERLAY: 'overlay',
  DARKEN: 'darken',
  LIGHTEN: 'lighten',
  COLOR_DODGE: 'color-dodge',
  COLOR_BURN: 'color-burn',
  HARD_LIGHT: 'hard-light',
  SOFT_LIGHT: 'soft-light',
  DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion',
  HUE: 'hue',
  SATURATION: 'saturation',
  COLOR: 'color',
  LUMINOSITY: 'luminosity',
};

/** Single SOLID paint only -> css color, else null. Relocated verbatim. */
function solidFillCss(paints) {
  const fills = (paints || []).filter((f) => f && f.visible !== false && (f.opacity == null || f.opacity > 0));
  if (fills.length !== 1 || fills[0].type !== 'SOLID') return null;
  return figmaColor(fills[0].color, fills[0].opacity);
}

/**
 * CSS angle (0deg = up, clockwise) for a Figma linear/angular gradient's
 * start->end handle, converted from Figma's box-normalized (0-1) handle
 * space into real pixels first. Relocated verbatim — this already
 * generalizes to any angle (not hardcoded to axis-aligned cases); the
 * real ~-45° diagonal gradient found in the corpus
 * (docs/PAINT_FEATURE_CENSUS.md Section 2, node 1118:50900) is expected to
 * already render correctly through this unchanged formula.
 */
function gradientAngleDeg(handles, box) {
  const w = (box && box.width) || 1;
  const h = (box && box.height) || 1;
  const dx = (handles[1].x - handles[0].x) * w;
  const dy = (handles[1].y - handles[0].y) * h;
  let deg = 90 + (Math.atan2(dy, dx) * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  return round(deg);
}

function gradientStopsCss(stops) {
  return (stops || [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => `${figmaColor(s.color, 1)} ${round((s.position || 0) * 100)}%`)
    .join(', ');
}

/**
 * Figma GRADIENT_RADIAL's 3-handle system approximated as a CSS
 * radial-gradient() ellipse. Relocated verbatim — deliberately does not
 * attempt handle rotation (docs/PAINT_FEATURE_CENSUS.md confirms 0 real
 * GRADIENT_DIAMOND occurrences and the 2 real GRADIENT_RADIAL occurrences
 * are on strokes, not fills — no real data to verify a rotated-ellipse
 * case against).
 */
function radialGradientCss(handles, box, stops) {
  if (!stops) return null;
  const w = (box && box.width) || 1;
  const h = (box && box.height) || 1;
  const cx = handles[0].x * w;
  const cy = handles[0].y * h;
  const rx = Math.hypot((handles[1].x - handles[0].x) * w, (handles[1].y - handles[0].y) * h);
  const ry = Math.hypot((handles[2].x - handles[0].x) * w, (handles[2].y - handles[0].y) * h);
  if (!(rx > 0) || !(ry > 0)) return null;
  const cxPct = round(handles[0].x * 100);
  const cyPct = round(handles[0].y * 100);
  return `radial-gradient(ellipse ${round(rx)}px ${round(ry)}px at ${cxPct}% ${cyPct}%, ${stops})`;
}

/**
 * One fill paint -> a single CSS `background-image` LAYER string. SOLID is
 * expressed as the `linear-gradient(color, color)` trick. Returns null for
 * IMAGE (handled entirely separately — a real `<img>` element, see
 * resolveImageStrategy() below) or GRADIENT_DIAMOND (0 real occurrences,
 * docs/PAINT_FEATURE_CENSUS.md Section 2 — not built speculatively).
 * Relocated verbatim.
 */
function singleFillLayerCss(f, box) {
  if (f.type === 'SOLID') {
    const c = figmaColor(f.color, f.opacity);
    return c ? `linear-gradient(${c}, ${c})` : null;
  }
  const hasStops = Array.isArray(f.gradientStops) && f.gradientStops.length;
  const hasHandles = Array.isArray(f.gradientHandlePositions) && f.gradientHandlePositions.length >= 2;
  if ((f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_ANGULAR') && hasHandles && hasStops) {
    const angle = gradientAngleDeg(f.gradientHandlePositions, box);
    const stops = gradientStopsCss(f.gradientStops);
    return stops ? `linear-gradient(${angle}deg, ${stops})` : null;
  }
  if (f.type === 'GRADIENT_RADIAL' && Array.isArray(f.gradientHandlePositions) && f.gradientHandlePositions.length >= 3 && hasStops) {
    return radialGradientCss(f.gradientHandlePositions, box, gradientStopsCss(f.gradientStops));
  }
  return null;
}

/**
 * A node's fill(s) -> CSS background value + the property it belongs
 * under. Relocated verbatim — still bails to null when any fill in a 2+
 * stack is IMAGE (that case is now handled by resolveImageStrategy()
 * below instead, which the renderer consults separately for image-fill
 * nodes; docs/PAINT_FEATURE_CENSUS.md Section 1 confirms 2+ fills is a
 * true edge case, 3 nodes total in the whole corpus).
 */
function paintCss(paints, box) {
  const fills = (paints || []).filter((f) => f && f.visible !== false && (f.opacity == null || f.opacity > 0));
  if (!fills.length) return null;
  if (fills.length === 1) {
    const f = fills[0];
    if (f.type === 'SOLID') {
      const c = figmaColor(f.color, f.opacity);
      return c ? { prop: 'background-color', value: c } : null;
    }
    const layer = singleFillLayerCss(f, box);
    return layer ? { prop: 'background-image', value: layer } : null;
  }
  if (fills.some((f) => f.type === 'IMAGE')) return null;
  const layers = [...fills].reverse().map((f) => singleFillLayerCss(f, box));
  if (layers.some((l) => !l)) return null;
  return { prop: 'background-image', value: layers.join(', ') };
}

/**
 * strokeAlign-aware single stroke decision (Style Resolver Phase 8
 * increment 1, already shipped and watcher-approved this session) —
 * relocated verbatim into the Paint module (a stroke IS a paint stack,
 * docs/PAINT_ARCHITECTURE_RESEARCH.md Section 1.9).
 */
function strokeDecls(strokeCss, strokeWeight, strokeAlign, style) {
  if (!strokeCss || !Number.isFinite(strokeWeight) || strokeWeight <= 0) return [];
  const w = px(strokeWeight);
  const decls = [];
  if (strokeAlign === 'OUTSIDE') {
    decls.push(['outline', `${w} ${style} ${strokeCss}`]);
    decls.push(['outline-offset', '0px']);
  } else if (strokeAlign === 'CENTER') {
    decls.push(['outline', `${w} ${style} ${strokeCss}`]);
    decls.push(['outline-offset', px(-strokeWeight / 2)]);
  } else {
    decls.push(['border', `${w} ${style} ${strokeCss}`]);
  }
  return decls;
}

/**
 * docs/PAINT_FEATURE_CENSUS.md Section 8 — Figma image `filters` (real,
 * 19 occurrences: saturation/contrast/highlights/tint/exposure/
 * temperature; `shadows` never appears in the corpus). Approximated via
 * CSS `filter` functions — the closest primitives CSS has for Figma's own
 * non-destructive image adjustment sliders:
 *   - `saturation` (-1 to 1) -> `saturate()`, remapped from Figma's signed
 *     range to CSS's 0-1+ multiplier (0 = grayscale, 1 = unchanged).
 *   - `contrast` (-1 to 1) -> `contrast()`, same remap.
 *   - `exposure` (-1 to 1) -> `brightness()`, same remap (closest available
 *     primitive; not a true photographic exposure curve).
 *   - `temperature`/`tint` -> approximated together via `sepia()` +
 *     `hue-rotate()` (warm/cool color-cast shift) — an approximation, not
 *     an exact colorimetric match; no CSS primitive does this precisely.
 *   - `highlights`/`shadows` -> no CSS primitive exists for tone-range-
 *     targeted adjustment at all; `highlights` (present in the real data)
 *     is left unmapped rather than guessed at with an unverified formula.
 * Returns null if no real filter values are present (never emits a no-op
 * `filter:` declaration).
 * @param {{saturation?, contrast?, exposure?, temperature?, tint?}} filters
 * @returns {string|null}
 */
function imageFiltersCss(filters) {
  if (!filters) return null;
  const parts = [];
  if (Number.isFinite(filters.saturation) && filters.saturation !== 0) {
    parts.push(`saturate(${round(Math.max(0, 1 + filters.saturation))})`);
  }
  if (Number.isFinite(filters.contrast) && filters.contrast !== 0) {
    parts.push(`contrast(${round(Math.max(0, 1 + filters.contrast))})`);
  }
  if (Number.isFinite(filters.exposure) && filters.exposure !== 0) {
    parts.push(`brightness(${round(Math.max(0, 1 + filters.exposure))})`);
  }
  if (Number.isFinite(filters.temperature) && filters.temperature !== 0) {
    // Positive temperature = warmer (toward orange); negative = cooler
    // (toward blue). sepia() pushes warm; a negative hue-rotate pushes the
    // sepia tone toward blue for a cool cast. Coefficients are a visual
    // approximation (Figma's own curve is not published), scaled so a
    // full -1..1 range stays within a plausible, non-garish shift.
    const warm = filters.temperature > 0;
    parts.push(`sepia(${round(Math.min(1, Math.abs(filters.temperature) * 0.4))})`);
    if (!warm) parts.push(`hue-rotate(${round(Math.abs(filters.temperature) * -40)}deg)`);
  }
  if (Number.isFinite(filters.tint) && filters.tint !== 0) {
    // Positive tint = toward magenta; negative = toward green.
    parts.push(`hue-rotate(${round(filters.tint * 30)}deg)`);
  }
  return parts.length ? parts.join(' ') : null;
}

/**
 * docs/PAINT_ARCHITECTURE_RESEARCH.md Sections 1.4/1.11/1.12 — image
 * position from a real `imageTransform` 2x3 affine matrix
 * ([[a,b,c],[d,e,f]]), when present (docs/PAINT_FEATURE_CENSUS.md Section
 * 8: 41 real occurrences, always non-identity — every one a genuine
 * crop/offset). Derives an `object-position` percentage using the exact
 * same formula legacy's `imageFillCss()` (server/figma-generate.js) uses
 * for its `background-position` equivalent.
 *
 * Honest, documented limitation: this resolves POSITION only, not the
 * matrix's independent horizontal/vertical SCALE (`sx`/`sy`) — a real
 * `<img>` element's `object-fit` model has no primitive that reproduces
 * an arbitrary non-uniform crop scale the way a `background-size`
 * percentage can (legacy's approach, which composites images as
 * background-image layers instead of real `<img>` elements — see
 * docs/PAINT_ARCHITECTURE_RESEARCH.md Section 6, still an open,
 * undecided question). `object-fit:cover` (already emitted elsewhere)
 * remains the sizing strategy; this only corrects WHERE within the box
 * the image is anchored, a real, verifiable improvement over the
 * previous always-centered default.
 * @param {number[][]} imageTransform
 * @returns {string|null}
 */
function imageObjectPosition(imageTransform) {
  if (!Array.isArray(imageTransform) || imageTransform.length < 2) return null;
  const a = imageTransform[0][0];
  const e = imageTransform[1][1];
  const cx = imageTransform[0][2];
  const cy = imageTransform[1][2];
  if (!Number.isFinite(a) || !Number.isFinite(e) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const posX = Math.abs(1 - a) > 1e-4 ? round((cx / (1 - a)) * 100) : 50;
  const posY = Math.abs(1 - e) > 1e-4 ? round((cy / (1 - e)) * 100) : 50;
  return `${posX}% ${posY}%`;
}

/**
 * docs/PAINT_ARCHITECTURE_RESEARCH.md — the SOLID+IMAGE multi-fill case
 * that triggered this whole research effort (EXPLORE node 86:62; 3 real
 * occurrences corpus-wide, docs/PAINT_FEATURE_CENSUS.md Section 1). When
 * an image-fill node's paint stack ALSO has a SOLID (or gradient) fill
 * beneath the image, resolves:
 *   - `washBehind`: the non-image fill(s), resolved exactly like
 *     paintCss() above — this is the fact that was silently dropped
 *     before (the tint/wash color never reached the DOM at all).
 *   - `opacity`: the IMAGE paint's own opacity (also previously dropped —
 *     the photo always rendered at full, untinted opacity).
 * Returns null when there's no non-image fill in the stack (the ordinary,
 * dominant case — a lone IMAGE fill needs no wash at all).
 * @param {object[]} paints
 * @param {{width:number,height:number}} box
 * @returns {{ washBehind: {prop,value}|null, opacity: number|null }|null}
 */
function resolveImageWash(paints, box) {
  const fills = (paints || []).filter((f) => f && f.visible !== false && (f.opacity == null || f.opacity > 0));
  const imageIndex = fills.findIndex((f) => f.type === 'IMAGE');
  if (imageIndex === -1) return null;
  const nonImage = fills.filter((f) => f.type !== 'IMAGE');
  if (!nonImage.length) return null;
  const washBehind = paintCss(nonImage, box);
  const imagePaint = fills[imageIndex];
  const opacity = Number.isFinite(imagePaint.opacity) && imagePaint.opacity < 1 ? round(imagePaint.opacity) : null;
  if (!washBehind && opacity == null) return null;
  return { washBehind, opacity };
}

module.exports = {
  BLEND_MODE_CSS,
  solidFillCss,
  gradientAngleDeg,
  gradientStopsCss,
  radialGradientCss,
  singleFillLayerCss,
  paintCss,
  strokeDecls,
  imageFiltersCss,
  imageObjectPosition,
  resolveImageWash,
};
