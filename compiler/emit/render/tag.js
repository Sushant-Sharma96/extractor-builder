'use strict';

/**
 * Phase 3 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — Renderer, minimal vocabulary.
 *
 * Pure tag-selection: given a `layoutChoice` (EmitPlan's new `layoutChoices`
 * entry — mode + optional card/banner shape fact) and the node's own kind
 * (text/image/container), choose the literal HTML tag.
 *
 * Ported (faithfully, not reinvented) from server/figma-build.js's `tagFor`
 * and the `emit()` nested-unit section-tag choice (`semTag`):
 *   - TEXT nodes: h1/h2/h3/p by font size, or name-hinted h1 (unchanged rule).
 *   - name-hinted button/nav/header/footer (unchanged regexes).
 *   - card shape (Component IR `cardPatterns`) -> 'article' (legacy's
 *     `cardLike ? 'article' : 'section'` semTag choice).
 *   - banner shape (Component IR `bannerPatterns`) -> 'section' (legacy's
 *     semTag default for a non-card nested unit).
 *   - everything else in the minimal vocabulary (flow-row/flow-column/
 *     grid-track/absolute) -> 'div' (a plain layout container — legacy never
 *     gives these a semantic tag by mode alone either).
 *
 * This module is a pure function over IR data — it never reads or mutates a
 * live figma-build element tree. `compiler/artifacts/apply-plan.js`'s
 * `applyEmitPlanTags` remains the (unchanged, default) tree-mutation path.
 */

/** @param {string} name node name (may be undefined) */
function nameHintedTag(name) {
  const n = String(name || '').toLowerCase();
  if (/(^|\s|\/)(button|btn|cta)(\s|$|\/)/.test(n)) return 'button';
  if (/(^|\s)(nav|navbar|menu)(\s|$)/.test(n)) return 'nav';
  if (/(^|\s)footer(\s|$)/.test(n)) return 'footer';
  if (/(^|\s)header(\s|$)/.test(n)) return 'header';
  return null;
}

/**
 * @param {{type?:string,name?:string,fontSize?:number}} node — minimal node facts
 */
function tagForText(node) {
  const name = String((node && node.name) || '').toLowerCase();
  const fs = (node && node.fontSize) || 0;
  if (/h1|title|headline/.test(name) || fs >= 40) return 'h1';
  if (fs >= 28) return 'h2';
  if (fs >= 20) return 'h3';
  return 'p';
}

/**
 * Choose the literal HTML tag for one node.
 *
 * @param {object} node — { nodeId, type ('TEXT'|'IMAGE'|'FRAME'|'GROUP'|...), name, fontSize }
 * @param {{ mode?: string, cardShape?: 'shell'|'frame'|null, bannerShape?: boolean }} layoutChoice
 * @returns {string} lowercase HTML tag name
 */
function chooseTag(node, layoutChoice = {}) {
  const type = String((node && node.type) || '').toUpperCase();
  if (type === 'TEXT') return tagForText(node);
  if (type === 'IMAGE') return 'img';

  const hinted = nameHintedTag(node && node.name);
  if (hinted) return hinted;

  if (layoutChoice.cardShape) return 'article';
  if (layoutChoice.bannerShape) return 'section';

  // Minimal vocabulary containers — flow-row / flow-column / grid-track /
  // absolute all render as a plain <div>; the CSS declarations (see
  // css-declarations.js) carry the actual arrangement, not the tag.
  return 'div';
}

module.exports = { chooseTag, tagForText, nameHintedTag };
