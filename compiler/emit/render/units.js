'use strict';

/**
 * Tiny, dependency-free numeric/unit helpers shared across css-declarations.js
 * and compiler/style/* — split out specifically so compiler/style/build.js
 * (the Style Resolver, docs/STYLE_RESOLVER_ARCHITECTURE.md) can format
 * ready-to-print CSS values without creating a circular require with
 * css-declarations.js (which will, in later increments, itself consume
 * Style Resolver output). Ported from server/figma-build.js — unchanged
 * formula.
 */

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function px(n) {
  return `${round(n)}px`;
}

function hex2(v) {
  return Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
}

/** Port of server/figma-generate.js's figmaColor — unchanged formula. */
function figmaColor(c, opacity) {
  if (!c) return null;
  const a = (c.a == null ? 1 : c.a) * (opacity == null ? 1 : opacity);
  if (a >= 0.999) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${+a.toFixed(3)})`;
}

module.exports = {
  round, px, hex2, figmaColor,
};
