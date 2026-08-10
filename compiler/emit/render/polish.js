'use strict';

/**
 * Phase 4 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — polish heuristics that are
 * PURE RENDERING DECISIONS over facts Phases 0-3 already publish (as opposed
 * to compiler/geometry/rules/structural-polish.js's detectors, which compute
 * a genuinely new structural fact). No new detection logic lives here —
 * every input these functions read (node kind/type, layoutChoice.mode,
 * box dimensions, decl values) is already available on a RenderNode by the
 * time materialize-html.js calls buildDecls().
 *
 * Ported (decl-cleanup only, operating on the ordered `[prop,value]` decl
 * array `buildDecls()` produces — never a live figma-build element tree):
 *   - polishProductionLayout() — server/figma-build.js: text never keeps a
 *     fixed height/width (max-width only), flex/card/grid containers never
 *     keep a fixed height, card-grids never keep card padding, large fixed
 *     widths (>=600px) convert to width:100%+max-width, flex-row children
 *     never claim width:100%, decimal px values round to integers.
 *   - normalizeSectionShell() — a depth-0 section root becomes a relative,
 *     full-width flow container (with a soft min-height for very tall
 *     full-bleed sections) rather than keeping any fixed artboard box decl.
 *   - normalizeInFlowHeaderPadding() — wired via
 *     compiler/geometry/rules/structural-polish.js's `clampHeaderPadding`
 *     (that IS new detection — the fact "is the first child a header" — so
 *     it lives in structural-polish.js; this module only shows how the
 *     already-computed clamp value gets applied to a padding decl).
 *
 * `demoteAbsoluteFlexStacks()` (server/figma-build.js) is deliberately NOT
 * ported here or anywhere: it exists only to undo a leftover
 * `position:absolute` on a node some OTHER legacy heuristic had already
 * flipped to `display:flex`/`grid` earlier in the same mutation pass — a bug
 * class that cannot occur in this renderer by construction.
 * `compiler/emit/render/css-declarations.js`'s `modeDecls()` selects exactly
 * one branch per `layoutChoice.mode` (`flow-row`/`flow-column`/`grid-track`/
 * `absolute`), so `position:absolute` and `display:flex`/`grid` can never
 * both appear in the same decl list — there is no second pass that could
 * leave one behind. See `compiler/test/responsive-render.test.js`'s
 * `demoteAbsoluteFlexStacks is moot by construction` test for the executable
 * proof.
 */

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function pxRound(value) {
  if (typeof value !== 'string' || !/\d+\.\d+px/.test(value)) return value;
  return value.replace(/(\d+\.\d+)px/g, (_, n) => `${Math.round(parseFloat(n))}px`);
}

/**
 * Port of normalizeSectionShell()'s decl assembly for a depth-0 section
 * root. Caller decides "is this depth 0" (materialize-html.js already knows
 * this from renderSections()'s own top-level-child walk).
 *
 * @param {{width:number,height:number}} box
 * @returns {Array<[string,string]>}
 */
function sectionShellDecls(box) {
  if (!box || !Number.isFinite(box.width) || box.width < 600) return [];
  const decls = [
    ['position', 'relative'],
    ['width', '100%'],
    ['max-width', '100%'],
  ];
  if (Number.isFinite(box.height) && box.height >= 600) {
    decls.push(['min-height', `${Math.round(box.height)}px`]);
  }
  return decls;
}

/**
 * Port of polishProductionLayout()'s per-node decl cleanup. Operates on a
 * plain ordered decl array (as produced by buildDecls()) plus a small facts
 * object describing the node — never a mutated element tree.
 *
 * @param {Array<[string,string]>} decls
 * @param {{ isText?: boolean, isFlex?: boolean, isCard?: boolean, isCardGrid?: boolean,
 *           isFullBleedBg?: boolean, flexDirection?: string, box?: {width?:number} }} facts
 * @returns {Array<[string,string]>} a NEW decl array (input is not mutated)
 */
function polishDecls(decls, facts = {}) {
  const map = new Map(decls);
  const isText = !!facts.isText;
  const isFlexOrGrid = !!facts.isFlex;
  const isCard = !!facts.isCard;
  const isCardGrid = !!facts.isCardGrid;
  const isFullBleedBg = !!facts.isFullBleedBg;

  if (isText && map.has('height')) map.delete('height');

  if (isText && map.has('width')) {
    const tn = parseFloat(map.get('width'));
    map.delete('width');
    if (Number.isFinite(tn) && tn > 0 && !map.has('max-width')) {
      map.set('max-width', `${Math.round(tn)}px`);
    }
  }

  if ((isFlexOrGrid || isCard || isCardGrid) && !isFullBleedBg) {
    const h = map.get('height');
    if (h && h !== 'auto' && h !== '100%') map.delete('height');
  }

  // Legacy's `padding` is a single shorthand decl; this renderer's
  // buildDecls() splits it into padding-top/right/bottom/left (see
  // css-declarations.js's modeDecls()/cardChromeDecls()) — strip all four.
  if (isCardGrid) {
    map.delete('padding');
    map.delete('padding-top');
    map.delete('padding-right');
    map.delete('padding-bottom');
    map.delete('padding-left');
  }

  const w = map.get('width');
  if (w && /px$/i.test(w) && !isFullBleedBg) {
    const n = parseFloat(w);
    if (Number.isFinite(n) && n >= 600) {
      map.set('width', '100%');
      map.set('max-width', `${Math.round(n)}px`);
    } else if (Number.isFinite(n) && Math.abs(n - Math.round(n)) > 0.01) {
      map.set('width', `${Math.round(n)}px`);
    }
  }

  const out = [...map.entries()].map(([k, v]) => [k, pxRound(v)]);
  return out;
}

/**
 * Port of polishProductionLayout()'s flex-row-children rule: a row's direct
 * children must not claim `width:100%` (breaks header/card rows). Operates
 * on the already-built child decl arrays for one flex-row parent.
 *
 * @param {Array<Array<[string,string]>>} childDeclsList
 * @param {Array<{width?:number}>} childBoxes — parallel array, same index
 * @returns {Array<Array<[string,string]>>} new arrays (inputs not mutated)
 */
function polishFlexRowChildren(childDeclsList, childBoxes = []) {
  return childDeclsList.map((decls, i) => {
    const map = new Map(decls);
    if (map.get('width') === '100%') {
      map.delete('width');
      const box = childBoxes[i];
      if (box && Number.isFinite(box.width)) {
        map.set('max-width', `${round(box.width)}px`);
      }
    }
    return [...map.entries()];
  });
}

module.exports = {
  sectionShellDecls,
  polishDecls,
  polishFlexRowChildren,
  pxRound,
};
