'use strict';

/**
 * Apply EmitPlan + domain IRs onto a figma-build element tree (in place).
 * Does not recompute heuristics — only lowers committed / projected IR into the tree.
 */

const ROLE_TO_TAG = Object.freeze({
  banner: 'header',
  navigation: 'nav',
  main: 'main',
  complementary: 'aside',
  contentinfo: 'footer',
  region: 'section',
  article: 'article',
  list: 'ul',
  listitem: 'li',
  form: 'form',
  button: 'button',
  heading: 'h2',
  generic: null,
});

const TOKEN_PROP_TO_CSS = Object.freeze({
  fill: 'background-color',
  'fill[0]': 'background-color',
  itemSpacing: 'gap',
  paddingTop: 'padding-top',
  paddingRight: 'padding-right',
  paddingBottom: 'padding-bottom',
  paddingLeft: 'padding-left',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  cornerRadius: 'border-radius',
});

function toSourceId(compileNodeId) {
  if (compileNodeId == null) return null;
  const s = String(compileNodeId);
  return s.startsWith('src:') ? s.slice(4) : s;
}

function cssVarName(tokenId) {
  return `--${String(tokenId).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

function indexTree(tree, map = new Map()) {
  if (!tree) return map;
  if (tree.nodeId != null) map.set(String(tree.nodeId), tree);
  for (const c of tree.children || []) indexTree(c, map);
  return map;
}

function ensureAttrs(el) {
  if (!el.attrs || typeof el.attrs !== 'object') el.attrs = {};
  return el.attrs;
}

function applySemanticTags(byId, semanticIr) {
  const annotations = (semanticIr && semanticIr.payload && semanticIr.payload.annotations) || [];
  for (const ann of annotations) {
    const src = toSourceId(ann.nodeId);
    const el = src && byId.get(src);
    if (!el || el.kind === 'svg' || el.kind === 'img') continue;
    if (ann.role === 'heading') {
      const level = Math.min(6, Math.max(1, Number(ann.level) || 2));
      el.tag = `h${level}`;
      continue;
    }
    // Never promote empty chrome / large surface rects to <button>
    if (ann.role === 'button' && isDecorativeChrome(el)) continue;
    const tag = ROLE_TO_TAG[ann.role];
    if (tag) el.tag = tag;
  }
}

/** Large empty fills (card surfaces, page backgrounds) are not controls. */
function isDecorativeChrome(el) {
  if (!el) return true;
  const name = String(el.name || '').toLowerCase();
  if (/rectangle|ellipse|vector|line|bg|background|surface|card.?bg|overlay/.test(name)) return true;
  const hasText = !!(el.text || el.runs
    || (el.children || []).some((c) => c && (c.text != null || c.runs || c.tag === 'button')));
  if (hasText) return false;
  const box = el.box;
  if (box && box.width >= 100 && box.height >= 60 && !(el.children && el.children.length)) return true;
  return false;
}

function demoteFalseButtons(el) {
  if (!el) return;
  if (el.tag === 'button' && isDecorativeChrome(el)) {
    el.tag = 'div';
    if (el.attrs) {
      delete el.attrs.type;
      delete el.attrs.tabindex;
      if (el.attrs.role === 'button') delete el.attrs.role;
    }
  }
  for (const c of el.children || []) demoteFalseButtons(c);
}

function applyTokenBindings(byId, tokenIr) {
  const payload = tokenIr && tokenIr.payload;
  if (!payload) return;

  for (const b of payload.bindings || []) {
    const src = toSourceId(b.nodeId);
    const el = src && byId.get(src);
    if (!el || !el.decls || !b.tokenId) continue;
    const cssProp = TOKEN_PROP_TO_CSS[b.property] || null;
    if (!cssProp) continue;
    // Text nodes: fill → color
    const prop = (el.type === 'TEXT' && cssProp === 'background-color') ? 'color' : cssProp;
    if (!el.decls.has(prop)) continue;
    const current = String(el.decls.get(prop) || '');
    // Do not replace translucent rgba(...) with an opaque rgb token (glass cards → solid white)
    if (/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0?\.\d+\s*\)/i.test(current)) {
      continue;
    }
    el.decls.set(prop, `var(${cssVarName(b.tokenId)})`);
  }
}

function applyEmitPlanTags(byId, emitPlan) {
  const payload = emitPlan && (emitPlan.payload || emitPlan);
  const tags = (payload && payload.tagChoices) || [];
  for (const choice of tags) {
    const src = toSourceId(choice.nodeId);
    const el = src && byId.get(src);
    if (!el || el.kind === 'svg') continue;
    const tag = String(choice.tag || '').toLowerCase();
    // EmitPlan may carry exporter-neutral unit ids; map common ones
    const mapped = ROLE_TO_TAG[tag] || tag;
    if (mapped === 'button' && isDecorativeChrome(el)) continue;
    if (mapped && /^[a-z][a-z0-9]*$/.test(mapped)) el.tag = mapped;
  }

  const roles = (payload && payload.roleChoices) || [];
  for (const choice of roles) {
    const src = toSourceId(choice.nodeId);
    const el = src && byId.get(src);
    if (!el) continue;
    const role = String(choice.role || '');
    if (!role || role === 'generic') continue;
    if (role === 'button' && isDecorativeChrome(el)) continue;
    ensureAttrs(el).role = role;
  }
}

function applyAccessibility(byId, a11yIr) {
  const payload = a11yIr && a11yIr.payload;
  if (!payload) return;

  for (const n of payload.names || []) {
    const src = toSourceId(n.nodeId);
    const el = src && byId.get(src);
    if (!el || !n.candidateName) continue;
    // Visible text nodes already expose their name — aria-label would override/duplicate.
    const hasVisibleText = el.text != null
      || (el.runs && el.runs.length)
      || ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'label'].includes(el.tag);
    if (hasVisibleText) continue;
    ensureAttrs(el)['aria-label'] = String(n.candidateName);
  }

  for (const img of payload.imageAccess || []) {
    const src = toSourceId(img.nodeId);
    const el = src && byId.get(src);
    if (!el) continue;
    const alt = img.altText || img.candidateName || img.label;
    if (alt) ensureAttrs(el).alt = String(alt);
    if (img.decorative === true) {
      ensureAttrs(el).alt = '';
      ensureAttrs(el)['aria-hidden'] = 'true';
    }
  }

  for (const k of payload.keyboardHints || []) {
    const src = toSourceId(k.nodeId);
    const el = src && byId.get(src);
    if (!el) continue;
    const attrs = ensureAttrs(el);
    const accessRole = k.accessRole ? String(k.accessRole) : '';
    // ACCESS_ROLE intents are not ARIA roles — never emit role="interactive" etc.
    if (accessRole === 'decorative') {
      attrs['aria-hidden'] = 'true';
    } else if (accessRole === 'interactive') {
      if (el.tag === 'div' || el.tag === 'span') {
        // Prefer native control when label looks like a CTA; otherwise leave tag.
      }
      // do not set attrs.role
    } else if (accessRole && !['static', 'landmark', 'heading', 'unknown'].includes(accessRole)) {
      if (!attrs.role) attrs.role = accessRole;
    }
    if (k.hint === 'focusable' || k.hint === 'tabbable') {
      if (isDecorativeChrome(el)) continue;
      if (
        attrs.tabindex == null
        && el.tag !== 'button'
        && el.tag !== 'a'
        && el.tag !== 'input'
        && el.tag !== 'p'
        && el.tag !== 'h1'
        && el.tag !== 'h2'
        && el.tag !== 'h3'
      ) {
        attrs.tabindex = '0';
      }
    }
  }

  // Stable focus order hints — only on real controls, not every text node
  const focus = [...(payload.focusOrder || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  focus.forEach((f, i) => {
    const src = toSourceId(f.nodeId);
    const el = src && byId.get(src);
    if (!el) return;
    if (!['button', 'a', 'input', 'select', 'textarea'].includes(el.tag)) return;
    if (f.order != null || f.rank != null) {
      ensureAttrs(el).tabindex = String(f.order != null ? f.order : i);
    }
  });
}

function applyComponents(byId, componentIr) {
  const payload = componentIr && componentIr.payload;
  if (!payload) return;

  const defClass = new Map();
  for (const d of payload.definitions || []) {
    const id = d.definitionId || d.nodeId;
    if (!id) continue;
    const slug = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cmp';
    defClass.set(String(id), `cmp-${slug}`);
  }

  for (const inst of payload.instances || []) {
    const src = toSourceId(inst.nodeId);
    const el = src && byId.get(src);
    if (!el) continue;
    const defId = inst.definitionId || inst.componentId;
    const cls = defId && (defClass.get(String(defId)) || `cmp-${String(defId).replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`);
    if (cls) el.extraClass = el.extraClass ? `${el.extraClass} ${cls}` : cls;
    ensureAttrs(el)['data-component'] = String(defId || inst.nodeId);
  }

  for (const d of payload.definitions || []) {
    const src = toSourceId(d.nodeId);
    const el = src && byId.get(src);
    if (!el) continue;
    const id = d.definitionId || d.nodeId;
    const cls = defClass.get(String(id));
    if (cls) el.extraClass = el.extraClass ? `${el.extraClass} ${cls}` : cls;
    ensureAttrs(el)['data-component-def'] = String(id);
  }
}

/**
 * Phase 3 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — lower EmitPlan's new
 * `layoutChoices` (mode + gap/padding + optional card/banner chrome fact)
 * onto the figma-build tree, the same additive way `applyTokenBindings`/
 * `applySemanticTags`/`applyComponents`/`applyAccessibility` already do.
 *
 * NOT wired into `applyPlanToTree` by default (see the risk note on
 * `applyPlanToTree` below) — reachable only when a caller explicitly asks
 * for it, so `emitArtifacts()`'s default behavior is unchanged.
 *
 * @param {Map<string,object>} byId
 * @param {object} emitPlan — IrSlice or payload with `.layoutChoices`
 */
function applyLayoutBindings(byId, emitPlan) {
  const { buildDecls } = require('../emit/render/css-declarations');
  const payload = emitPlan && (emitPlan.payload || emitPlan);
  const choices = (payload && payload.layoutChoices) || [];
  for (const choice of choices) {
    const src = toSourceId(choice.nodeId);
    const el = src && byId.get(src);
    if (!el || el.kind === 'svg' || el.kind === 'img') continue;
    if (!el.decls || typeof el.decls.set !== 'function') el.decls = new Map();
    for (const [prop, value] of buildDecls(choice)) {
      el.decls.set(prop, value);
    }
  }
}

/**
 * @param {object} tree — figma-build element tree
 * @param {{ emitPlan?, tokenIr?, semanticIr?, componentIr?, accessibilityIr?, applyLayoutBindings?: boolean }} irs
 */
function applyPlanToTree(tree, irs = {}) {
  const byId = indexTree(tree);
  applySemanticTags(byId, irs.semanticIr);
  applyEmitPlanTags(byId, irs.emitPlan);
  applyComponents(byId, irs.componentIr);
  applyAccessibility(byId, irs.accessibilityIr);
  applyTokenBindings(byId, irs.tokenIr);
  // Phase 3 — default-off. `emitArtifacts()` never sets this flag today, so
  // the legacy-path shipping output is byte-identical to before this phase
  // (docs/COMPILER_MIGRATION_BLUEPRINT.md Phase 3: "this phase makes the new
  // renderer *capable*, but emitArtifacts() still calls the legacy path by
  // default"). Tests opt in explicitly via `irs.applyLayoutBindings = true`.
  if (irs.applyLayoutBindings === true) {
    applyLayoutBindings(byId, irs.emitPlan);
  }
  demoteFalseButtons(tree);
  return { tree, indexed: byId.size };
}

module.exports = {
  applyPlanToTree,
  applyLayoutBindings,
  toSourceId,
  cssVarName,
  ROLE_TO_TAG,
  TOKEN_PROP_TO_CSS,
  demoteFalseButtons,
  isDecorativeChrome,
};
