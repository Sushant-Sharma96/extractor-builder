'use strict';

/**
 * Phase 4 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — `@media` emission.
 *
 * Genuinely new capability, not a port: legacy (server/figma-build.js) never
 * emits a literal `@media` block keyed to a specific node's adaptation — its
 * RESPONSIVE_STANDARDS_BLOCK (compiler/emit/render/utility-css.js, copied
 * verbatim from legacy in Phase 3) is a FIXED, class-keyed stylesheet
 * (`.et-flow-row`, `.et-card-grid`, ...) with its own hardcoded breakpoints
 * (1100/900/720px), never driven by compiler/responsive's per-node
 * Adaptation Facts. A repo-wide grep before this phase confirmed zero code
 * anywhere emits `@media` from ResponsiveIR data — see blueprint §0.
 *
 * This module is the first thing in the whole compiler/ tree that reads
 * ResponsiveIR's published `adaptations`/`breakpoints`
 * (compiler/responsive/detect.js, compiler/responsive/project.js) and emits
 * literal, per-node `@media (max-width: Npx) { .class { ... } }` text.
 *
 * Pure functions only: given already-published ResponsiveIR data plus a
 * caller-supplied nodeId -> CSS class lookup (materialize-html.js assigns a
 * dedicated, non-deduped class per adapted node — see its
 * `responsiveClassByNode` map), produce CSS text. Never reads or mutates a
 * live tree, never invents data ResponsiveIR does not publish.
 */

const { STRATEGY, BREAKPOINT_KIND, DEFAULT_BREAKPOINTS } = require('../../responsive/constants');
const { px } = require('./css-declarations');

/**
 * Per-strategy declaration mapping — the exhaustive set of strategies
 * compiler/responsive/constants.js's STRATEGY enum defines. Each entry
 * returns an ordered decl list, or `null` when this strategy has no
 * realizable CSS from data ResponsiveIR currently publishes (documented
 * inline, not invented).
 */
const STRATEGY_DECLS = {
  [STRATEGY.STACK]: () => [
    ['flex-direction', 'column'],
    ['align-items', 'stretch'],
  ],
  [STRATEGY.ROW]: () => [
    ['flex-direction', 'row'],
  ],
  [STRATEGY.WRAP]: () => [
    ['flex-wrap', 'wrap'],
  ],
  [STRATEGY.HIDE]: () => [
    ['display', 'none'],
  ],
  // SHOW has no current producer in compiler/responsive/detect.js (no
  // candidate ever pushes STRATEGY.SHOW today) — kept for contract
  // completeness (the enum has it), not exercised by any real Adaptation
  // Fact yet. If detect.js ever gains a SHOW-producing rule, this is ready.
  [STRATEGY.SHOW]: () => [
    ['display', 'block'],
  ],
  [STRATEGY.SPACE_TIGHTEN]: (layoutChoice) => {
    const gap = layoutChoice && Number.isFinite(layoutChoice.gap) ? layoutChoice.gap : null;
    if (gap == null) return [['gap', '8px']];
    return [['gap', px(Math.max(0, gap * 0.5))]];
  },
  [STRATEGY.SPACE_PRESERVE]: (layoutChoice) => {
    const gap = layoutChoice && Number.isFinite(layoutChoice.gap) ? layoutChoice.gap : null;
    if (gap == null) return null;
    // Explicit re-assertion of the node's own gap — a real, deliberate
    // decision (pin the spacing so no later, less specific rule shrinks it),
    // not a no-op.
    return [['gap', px(gap)]];
  },
  [STRATEGY.FIXED]: () => [
    // ResponsiveIR does not publish per-breakpoint left/top coordinates for
    // FIXED nodes (only the strategy decision itself) — emitting a bare
    // `position: fixed` is honest; inventing left/top would not be sourced
    // from any published Fact. See this phase's STATUS note for this
    // documented gap.
    ['position', 'fixed'],
  ],
  // ABSTAIN is a deliberate non-decision (conservative profile / ambiguous
  // signal) — no CSS is ever emitted for it.
  [STRATEGY.ABSTAIN]: () => null,
};

/**
 * @param {string} strategy
 * @param {object} [layoutChoice] — the node's own layoutChoice (for context,
 *   e.g. its current `gap`, needed by space-tighten/space-preserve)
 * @returns {Array<[string,string]>|null}
 */
function declsForStrategy(strategy, layoutChoice) {
  const fn = STRATEGY_DECLS[strategy];
  if (!fn) return null;
  return fn(layoutChoice || {});
}

/** Render one `@media` block's rule body from `{className, decls}` entries. */
function ruleBlock(rules) {
  return rules
    .filter((r) => r.decls && r.decls.length)
    .map((r) => `  .${r.className} {\n${r.decls.map(([k, v]) => `    ${k}: ${v};`).join('\n')}\n  }`)
    .join('\n');
}

/**
 * Group ResponsiveIR adaptations by breakpoint and emit literal `@media`
 * text — one block per breakpoint with at least one real (non-null,
 * non-abstain) declaration.
 *
 * Only `narrow`/`medium` breakpoints (mobile-first max-width overrides) are
 * emitted. A `wide`-only adaptation (e.g. STRATEGY.ROW scored at `bp:wide`
 * in compiler/responsive/detect.js) represents the *default* desktop state
 * that `css-declarations.js`'s `modeDecls()` already emits unconditionally —
 * it is not an override, so emitting it as a redundant
 * `@media (min-width: ...)` block would change nothing. Documented here
 * (and in this phase's blueprint STATUS note), not silently dropped.
 *
 * @param {object[]} adaptations — ResponsiveIR published `payload.adaptations`
 * @param {object[]} breakpoints — ResponsiveIR published `payload.breakpoints`
 * @param {(nodeId: string) => string|null|undefined} classForNode
 * @param {(nodeId: string) => object|undefined} [layoutChoiceForNode]
 * @returns {string} literal CSS text (empty string if nothing to emit)
 */
function buildResponsiveMediaCss(adaptations, breakpoints, classForNode, layoutChoiceForNode) {
  const bpById = new Map((breakpoints || []).map((b) => [b.breakpointId, b]));
  const byBreakpoint = new Map(); // breakpointId -> { bp, rules: [] }

  for (const a of adaptations || []) {
    if (!a || !a.nodeId || a.strategy === STRATEGY.ABSTAIN) continue;
    const className = classForNode ? classForNode(a.nodeId) : null;
    if (!className) continue;
    const layoutChoice = layoutChoiceForNode ? layoutChoiceForNode(a.nodeId) : null;
    const decls = declsForStrategy(a.strategy, layoutChoice);
    if (!decls || !decls.length) continue;

    for (const bpId of a.atBreakpointIds || []) {
      const bp = bpById.get(bpId);
      if (!bp || bp.kind === 'wide') continue;
      if (!byBreakpoint.has(bpId)) byBreakpoint.set(bpId, { bp, rules: [] });
      byBreakpoint.get(bpId).rules.push({ className, decls });
    }
  }

  const blocks = [...byBreakpoint.values()]
    .sort((a, b) => a.bp.widthHint - b.bp.widthHint)
    .map(({ bp, rules }) => {
      // Deterministic rule order — sort by className.
      rules.sort((a, b) => (a.className < b.className ? -1 : 1));
      const body = ruleBlock(rules);
      if (!body) return null;
      return `@media (max-width: ${Math.round(bp.widthHint)}px) {\n${body}\n}`;
    })
    .filter(Boolean);

  return blocks.join('\n\n');
}

/**
 * UNUSED as of this session — no longer called from `materialize-html.js`.
 * Superseded by `canvasDecls()`'s unconditional `overflow-x:hidden` (see
 * that function's own comment for the full writeup): forcing `.et-page` to
 * a hard fixed width fixed the original overflow bug, but traded it for a
 * page-level horizontal scrollbar on nearly every real desktop viewport
 * (confirmed live: a real ~1920px-class maximized browser window's usable
 * width is still a few px short of an exact 1920px design canvas, since the
 * browser's own vertical scrollbar/chrome eats into it) — clipping the
 * excess instead of forcing the whole page wider is the better default.
 * Kept defined (not deleted) for reference/possible future reuse — e.g. a
 * future real-reflow increment might resurrect a variant of this for
 * content that has no fluid alternative. Original doc below, unchanged:
 *
 * `.et-page`'s own width across viewport ranges — a real, general bug, not
 * a per-node adaptation. `canvasDecls()` (css-declarations.js) emits
 * `width:100%` unconditionally so the page can shrink to fit a genuinely
 * narrow (<= the narrow breakpoint) viewport — required for that
 * breakpoint's own STACK/WRAP adaptations to visually read as "mobile"
 * instead of a horizontally-scrolled full-width canvas. But every other
 * node on the page is positioned with raw Figma pixel offsets computed
 * against the FULL design canvas width — so on any viewport wider than the
 * narrow breakpoint but narrower than the design's own width, `width:100%`
 * shrinks the page below its design width while children's absolute
 * offsets stay anchored to the full width, overflowing past the page's own
 * (now-narrower) right edge. Forcing the page back to its fixed design
 * width above the narrow breakpoint fixes this generically: the browser
 * gives native horizontal scroll instead of internal-content overflow,
 * exactly matching a real desktop viewport narrower than a fixed-width
 * design. Below the narrow breakpoint, `width:100%` is left untouched.
 *
 * @param {{ box?: {width:number} }} canvas
 * @param {object[]} [breakpoints] — ResponsiveIR's own published
 *   breakpoints, when available, so the threshold always matches whatever
 *   this project's actual narrow breakpoint is; falls back to the shared
 *   `DEFAULT_BREAKPOINTS` (the same source `compiler/responsive/detect.js`
 *   itself defaults to) when responsive detection did not run.
 * @returns {string|null}
 */
function pageWidthMediaCss(canvas, breakpoints) {
  if (!canvas || !canvas.box || !Number.isFinite(canvas.box.width)) return null;
  const list = (breakpoints && breakpoints.length) ? breakpoints : DEFAULT_BREAKPOINTS;
  const narrow = list.find((b) => b.kind === BREAKPOINT_KIND.NARROW);
  const threshold = Math.round(narrow ? narrow.widthHint : 375) + 1;
  const designWidth = px(Math.round(canvas.box.width));
  return `@media (min-width: ${threshold}px) {\n  .et-page {\n    width: ${designWidth};\n  }\n}`;
}

module.exports = {
  declsForStrategy, buildResponsiveMediaCss, STRATEGY_DECLS, pageWidthMediaCss,
};
