'use strict';

/**
 * Style Resolver v0 — docs/STYLE_RESOLVER_ARCHITECTURE.md.
 *
 * Migration order (Section 8.2 of that document): relocate already-correct,
 * already-scattered logic into ONE resolver per category before extending
 * any of it. This file starts with Shape facts (border-radius, corner
 * smoothing, clip content) — the first, purely-relocated slice.
 *
 * Pure functions only. Never touches a live render tree or emits CSS
 * strings itself beyond the final, ready-to-print value (per the
 * roadmap's Phase 8 contract: "final CSS-property-shaped values, not raw
 * Figma facts" — Render should have nothing left to compute).
 */

const { px, figmaColor } = require('../emit/render/units');

/**
 * Shape facts: border-radius (uniform / per-corner / ellipse), corner
 * smoothing, and clip-content — relocated verbatim from
 * compiler/emit/render/css-declarations.js's modeDecls()/canvasDecls(),
 * zero behavior change intended.
 *
 * `cornerSmoothing` is resolved but has no CSS primitive today (Style
 * Resolver Architecture doc Section 3.4 — a real superellipse `clip-path`
 * would be needed, no real fixture justifies building it yet) — carried
 * through anyway so a future consumer has it without re-reading raw NDG
 * data, matching this project's "ingest/resolve once, even before a
 * renderer needs it" precedent (e.g. strokeCap/strokeJoin).
 *
 * @param {{isEllipse?, rectangleCornerRadii?, cornerRadius?, cornerSmoothing?, clips?}} facts
 * @returns {{ borderRadius: string|null, cornerSmoothing: number|null, clipContent: boolean }}
 */
function resolveShape(facts) {
  let borderRadius = null;
  if (facts && facts.isEllipse) {
    // ELLIPSE nodes carry no `cornerRadius` field at all — Figma expresses
    // full roundness via the node TYPE itself, not a number — so this wins
    // outright over the numeric branches below for any ellipse.
    borderRadius = '50%';
  } else if (
    facts
    && Array.isArray(facts.rectangleCornerRadii)
    && facts.rectangleCornerRadii.length === 4
    && facts.rectangleCornerRadii.some((r) => r)
  ) {
    // Figma's per-corner radius array is ordered [topLeft, topRight,
    // bottomRight, bottomLeft] — byte-for-byte CSS border-radius's own
    // shorthand order, no reordering needed. Only takes this branch when
    // at least one corner differs from 0 (a real mixed radius); a
    // genuinely uniform array falls through to the plain cornerRadius
    // branch below, unchanged.
    const [tl, tr, br, bl] = facts.rectangleCornerRadii.map((r) => px(Number.isFinite(r) ? r : 0));
    borderRadius = `${tl} ${tr} ${br} ${bl}`;
  } else if (Number.isFinite(facts && facts.cornerRadius) && facts.cornerRadius > 0) {
    borderRadius = px(facts.cornerRadius);
  }

  return {
    borderRadius,
    cornerSmoothing: Number.isFinite(facts && facts.cornerSmoothing) ? facts.cornerSmoothing : null,
    clipContent: !!(facts && facts.clips),
  };
}

/**
 * Figma `effects[]` (DROP_SHADOW/INNER_SHADOW only — BACKGROUND_BLUR/
 * LAYER_BLUR need `filter`/`backdrop-filter`, an architecturally different
 * mechanism handled separately by blurFiltersCss() below) -> a single CSS
 * `box-shadow` value, one comma-separated shadow per effect (Figma allows
 * several stacked on one node). Relocated verbatim from
 * compiler/emit/render/css-declarations.js, docs/STYLE_RESOLVER_ARCHITECTURE.md
 * Section 3.6 — already correct, already unit-tested, zero behavior change.
 * @param {object[]} effects
 * @returns {string|null}
 */
function boxShadowCss(effects) {
  const shadows = (effects || []).filter(
    (e) => e && e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'),
  );
  if (!shadows.length) return null;
  return shadows
    .map((e) => {
      const x = px(Math.round((e.offset && e.offset.x) || 0));
      const y = px(Math.round((e.offset && e.offset.y) || 0));
      const blur = px(Math.round(e.radius || 0));
      const spread = px(Math.round(e.spread || 0));
      const color = figmaColor(e.color, 1) || 'rgba(0, 0, 0, 0.25)';
      const inset = e.type === 'INNER_SHADOW' ? ' inset' : '';
      return `${x} ${y} ${blur} ${spread} ${color}${inset}`;
    })
    .join(', ');
}

/**
 * Figma LAYER_BLUR/BACKGROUND_BLUR effects -> CSS `filter:blur()`/
 * `backdrop-filter:blur()`. Distinct properties (not comma-composed like
 * boxShadowCss's shadows): a node can carry both a layer blur AND a
 * background blur simultaneously, each affecting a different thing (the
 * node's own rendered content vs. whatever is behind it) — returned as two
 * independent declarations, not one merged value. Relocated verbatim,
 * same provenance as boxShadowCss above.
 * @param {object[]} effects
 * @returns {{ filter: string|null, backdropFilter: string|null }}
 */
function blurFiltersCss(effects) {
  const list = effects || [];
  const layerBlur = list.find((e) => e && e.visible !== false && e.type === 'LAYER_BLUR' && Number.isFinite(e.radius));
  const bgBlur = list.find((e) => e && e.visible !== false && e.type === 'BACKGROUND_BLUR' && Number.isFinite(e.radius));
  return {
    filter: layerBlur ? `blur(${px(Math.round(layerBlur.radius))})` : null,
    backdropFilter: bgBlur ? `blur(${px(Math.round(bgBlur.radius))})` : null,
  };
}

/**
 * Effects facts — the ONE call that produces a node's complete resolved
 * effects (box-shadow + filter + backdrop-filter), so a future caller
 * doesn't need to call boxShadowCss()/blurFiltersCss() independently
 * (docs/STYLE_RESOLVER_ARCHITECTURE.md's StyleFacts.boxShadow/filter/
 * backdropFilter contract, Section 2).
 * @param {object[]} effects
 * @returns {{ boxShadow: string|null, filter: string|null, backdropFilter: string|null }}
 */
function resolveEffects(effects) {
  const blur = blurFiltersCss(effects);
  return {
    boxShadow: boxShadowCss(effects),
    filter: blur.filter,
    backdropFilter: blur.backdropFilter,
  };
}

/**
 * Typography decls — docs/STYLE_RESOLVER_ARCHITECTURE.md Section 5. ONE
 * shared function for both the whole-node path (previously
 * css-declarations.js's modeDecls(), relocated verbatim — every field
 * below already existed there) AND the per-character-run override path
 * (previously materialize-html.js's runStyleCss(), a SEPARATE, smaller
 * partial re-implementation that silently dropped `textDecoration:
 * STRIKETHROUGH` and never read `textCase` at all — Section 5.2's
 * confirmed real gap, now closed by construction: both callers go through
 * this one function, so a per-run override gets the exact same
 * STRIKETHROUGH/textCase handling the whole-node path already had).
 *
 * Deliberately does NOT resolve `color` — that's a paint/fill concern
 * (Section 2.1, `docs/PAINT_ARCHITECTURE_RESEARCH.md`'s Paint Resolver,
 * not yet built) and already lives in its own, untouched code path in both
 * callers; folding it in here would pull Paint IR work into this slice.
 *
 * @param {{fontFamily?, fontWeight?, fontSize?, lineHeight?, letterSpacing?,
 *   textNoWrap?, textCase?, textAlign?, textDecoration?, italic?, fontStyle?}} facts
 * @returns {Array<[string,string]>} decl pairs — empty array if `facts` is absent.
 */
function resolveTypography(facts) {
  const decls = [];
  if (!facts) return decls;
  if (facts.fontFamily) decls.push(['font-family', `'${facts.fontFamily}', sans-serif`]);
  if (Number.isFinite(facts.fontWeight)) decls.push(['font-weight', String(facts.fontWeight)]);
  // Per-run-only today (no whole-node caller currently supplies either
  // field, so this is a zero-behavior-change addition for the whole-node
  // path — see this function's own header comment).
  if (facts.italic || /italic|oblique/i.test(facts.fontStyle || '')) decls.push(['font-style', 'italic']);
  if (Number.isFinite(facts.fontSize)) decls.push(['font-size', px(facts.fontSize)]);
  if (Number.isFinite(facts.lineHeight)) decls.push(['line-height', px(facts.lineHeight)]);
  if (Number.isFinite(facts.letterSpacing)) decls.push(['letter-spacing', px(facts.letterSpacing)]);
  if (facts.textNoWrap) decls.push(['white-space', 'nowrap']);
  // Figma's textCase is a display transform, never a change to the
  // underlying characters — CSS text-transform does the same.
  if (facts.textCase === 'UPPER') decls.push(['text-transform', 'uppercase']);
  else if (facts.textCase === 'LOWER') decls.push(['text-transform', 'lowercase']);
  else if (facts.textCase === 'TITLE') decls.push(['text-transform', 'capitalize']);
  // Paragraph-level; per-run callers simply never supply this field, so it
  // naturally never fires for a run's own inline style.
  if (facts.textAlign === 'CENTER') decls.push(['text-align', 'center']);
  else if (facts.textAlign === 'RIGHT') decls.push(['text-align', 'right']);
  else if (facts.textAlign === 'JUSTIFIED') decls.push(['text-align', 'justify']);
  if (facts.textDecoration === 'UNDERLINE') decls.push(['text-decoration', 'underline']);
  else if (facts.textDecoration === 'STRIKETHROUGH') decls.push(['text-decoration', 'line-through']);
  return decls;
}

module.exports = {
  resolveShape, boxShadowCss, blurFiltersCss, resolveEffects, resolveTypography,
};
