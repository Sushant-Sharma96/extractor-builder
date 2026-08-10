'use strict';

/**
 * Phase 3 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — Renderer, minimal vocabulary.
 *
 * Literal, byte-for-byte ports of the fixed CSS blocks from
 * server/figma-build.js's `buildCss()`:
 *   - the reset block (`CSS_RESET_BLOCK`)
 *   - the large "responsive (standards)" block (`RESPONSIVE_STANDARDS_BLOCK`),
 *     including server/dual-path.js's `dualPathStandardsCss()` output inlined
 *     at the exact position legacy interpolates it.
 *
 * These are copied verbatim from legacy source (not paraphrased) so a byte
 * diff against legacy's output can pass for these sections. Do NOT hand-edit
 * this file's template-literal bodies without re-diffing against
 * server/figma-build.js's buildCss()/server/dual-path.js's
 * dualPathStandardsCss() — any drift here is a silent parity regression.
 */

/** Verbatim port of server/dual-path.js's dualPathStandardsCss(). */
const DUAL_PATH_STANDARDS_CSS = `/* --- dual-path Phase 0 (Path B composition contract) --- */
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

/** Verbatim port of server/figma-build.js's buildCss() reset block. */
const CSS_RESET_BLOCK = `/* --- reset --- */
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
}`;

/**
 * Verbatim port of server/figma-build.js's buildCss() "responsive (standards)"
 * block — everything from `/* --- responsive (standards) --- *\/` to the end
 * of the function, with `${dualPath.dualPathStandardsCss()}` inlined at its
 * original interpolation point.
 */
const RESPONSIVE_STANDARDS_BLOCK = `/* --- responsive (standards) --- */
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
${DUAL_PATH_STANDARDS_CSS}
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
  /* Floor at 240px so a bad --et-content-max (e.g. 6px decorative rail) cannot collapse the page */
  max-width: min(100%, max(240px, var(--et-content-max, 1196px))) !important;
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
/* A bare .et-page > section > * !important width/max-width override used
   to live here, gated in intent on an et-measured-content classification
   that ir-experimental's renderer never actually assigns to anything.
   Because the selector had no class requirement, it fired unconditionally
   on every section's real content, force-overriding each element's own
   correctly-computed width with a hardcoded 1196px fallback (verified:
   Challenge Arena's own full-page background rectangle, a real 1440px-wide
   node, silently rendered at 1196px). Removed outright rather than
   re-scoped, since re-scoping would need the classification step this
   renderer doesn't have -- each element's own declared width (already
   pixel-verified against Figma) is the correct value on its own. */
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
.et-decor-overlay {
  position: absolute !important;
  left: var(--et-decor-left, 0) !important;
  top: var(--et-decor-top, 0) !important;
  margin: 0 !important;
  z-index: 1 !important;
  pointer-events: none;
  flex: none !important;
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
}`;

module.exports = {
  CSS_RESET_BLOCK,
  RESPONSIVE_STANDARDS_BLOCK,
  DUAL_PATH_STANDARDS_CSS,
};
