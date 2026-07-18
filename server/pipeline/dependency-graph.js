'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — Dependency Graph + VDG builder. PURE + DETERMINISTIC (no browser).
// Consumes the v1 capture `model` (structure/CSS, sourceOfTruth: css-rule) enriched
// by Capture++ (`computed` → resolved values; `runtimeVars`/`animations` → var
// origin + keyframe usage, sourceOfTruth: runtime/computed-style). Emits the IR's
// `dependency` graph + `sections[].owns`. Output validates against ir.validateIR.
// ─────────────────────────────────────────────────────────────────────────────

const cheerio = require('cheerio');
const { findSectionRoot, detectSectionName } = require('../build'); // reuse v1 section boundaries

const VARDEF = /(?:^|[;{]\s*)(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g;
const VARUSE = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,?)/g;
const GENERIC_FONTS = new Set(['ui-sans-serif', 'ui-serif', 'ui-monospace', 'system-ui', 'sans-serif', 'serif', 'monospace', '-apple-system', 'blinkmacsystemfont', 'arial', 'georgia', 'helvetica', 'times', 'times new roman', 'courier', 'courier new', 'cursive', 'inherit', 'emoji']);

const prov = (sourceOfTruth, locator, confidence, contributing) => ({ sourceOfTruth, contributing: contributing || [], locator: locator || {}, confidence: confidence == null ? 1 : confidence, signals: [] });
// CSS.escape for a raw class token (e.g. Tailwind arbitrary values `text-[12px]`,
// variant separators `md:px-6`) → valid selector. DOM attrs stay raw; escaped
// selector still matches. Complex/base rules keep their already-escaped CSSOM text.
const cssEsc = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch);
// Tailwind group-*/peer-* variants describe an ANCESTOR/SIBLING condition, not a
// self state. capture.js's parseSimple mis-captures the marker's pseudo (e.g. the
// `:hover` inside `.X:is(:where(.group):hover *)`) as a state on X, yielding a broken
// `.X:hover`. Reconstruct the correct combinator selector from the token prefix —
// deterministic per Tailwind semantics, and v2-only (capture.js untouched).
const VARIANT_PSEUDO = { hover: ':hover', 'focus-within': ':focus-within', 'focus-visible': ':focus-visible', focus: ':focus', active: ':active', checked: ':checked', disabled: ':disabled', invalid: ':invalid', visited: ':visited', target: ':target' };
function variantPrefix(tok) {
  const m = /(group|peer)-(hover|focus-within|focus-visible|focus|active|checked|disabled|invalid|visited|target)/.exec(tok);
  if (!m) return null;
  const ps = VARIANT_PSEUDO[m[2]]; if (!ps) return null;
  return m[1] === 'group' ? '.group' + ps + ' ' : '.peer' + ps + ' ~ '; // group=descendant, peer=sibling
}

function collectVarDefs(css, map) { VARDEF.lastIndex = 0; let m; while ((m = VARDEF.exec(css || ''))) if (!map.has(m[1])) map.set(m[1], m[2].trim()); return map; }
function collectVarUses(css, set) { VARUSE.lastIndex = 0; let m; while ((m = VARUSE.exec(css || ''))) set.add(m[1]); return set; }
function allCss(model) {
  const p = [model.rootCss || '', model.darkCss || ''];
  (model.baseRules || []).forEach((r) => p.push(r.css || ''));
  (model.complexRules || []).forEach((r) => p.push(r.css || ''));
  (model.keyframes || []).forEach((k) => p.push(k));
  (model.fontFaces || []).forEach((f) => p.push(f));
  Object.values(model.classRules || {}).forEach((cs) => cs.forEach((c) => p.push(c.css || '')));
  return p.join('\n');
}

// ── Generic top-level section discovery (v2) ─────────────────────────────────
// v1's findSectionRoot returns ONE container (often <main>) and drops its
// content-bearing siblings (hero/header/footer/banners). This preserves EVERY
// top-level content region generically: reuse findSectionRoot for the primary
// content (v1 parity — no regression), then walk the ancestor path to <body>
// and keep every content-bearing sibling, ordered by document position.
// A region qualifies by CARRYING CONTENT — no tag/role special-casing.
const IGNORE_TAGS = new Set(['script', 'style', 'noscript', 'link', 'meta', 'template']);
const INLINE_MEDIA = 'img,svg,video,picture,iframe,canvas,input,button,select,textarea,a[href]';
function isContentBearing($, el) {
  const tag = (el.tagName || '').toLowerCase();
  if (!tag || IGNORE_TAGS.has(tag)) return false;
  const $el = $(el);
  if ($el.text().replace(/\s+/g, '').length > 0) return true;
  if (['img', 'svg', 'video', 'picture', 'iframe', 'canvas', 'input', 'button', 'textarea'].includes(tag)) return true;
  return $el.find(INLINE_MEDIA).length > 0;
}
function contentKids($, node) {
  return $(node).children().toArray().filter((e) => e.tagName && !IGNORE_TAGS.has(e.tagName.toLowerCase()) && isContentBearing($, e));
}
// Wrapper chain = the shared ancestors between <body> and the discovered sections'
// lowest common ancestor. These carry page-level utility classes (bg, min-h-screen,
// antialiased) that would otherwise be dropped when only section elements are emitted.
function elAncestors(el) { const a = []; let p = el; while (p) { if (p.tagName) a.push(p); p = p.parentNode; } return a; }
function lowestCommonAncestor(els) {
  if (!els.length) return null;
  let common = elAncestors(els[0]);
  for (let i = 1; i < els.length; i += 1) { const s = new Set(elAncestors(els[i])); common = common.filter((x) => s.has(x)); if (!common.length) break; }
  return common[0] || null;
}
function computeWrapperChain($, sectionEls) {
  const lca = lowestCommonAncestor(sectionEls);
  const chain = []; let n = lca;
  while (n && n.tagName && !['body', 'html'].includes(n.tagName.toLowerCase())) {
    // stop if this node IS one of the sections (don't wrap sections in themselves)
    if (sectionEls.indexOf(n) >= 0) break;
    chain.push({ tag: n.tagName.toLowerCase(), id: $(n).attr('id') || '', class: $(n).attr('class') || '' });
    n = n.parentNode;
  }
  return chain.reverse(); // outermost first
}

function discoverSections($) {
  const primary = findSectionRoot($).get(0);
  if (!primary) return [];
  const regions = new Set(contentKids($, primary)); // primary's children = v1 behavior
  // Walk up to <body>, preserving content-bearing siblings at each level.
  let node = primary;
  for (let guard = 0; guard < 12 && node && node.parentNode; guard += 1) {
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'body' || tag === 'html') break;
    contentKids($, node.parentNode).forEach((s) => { if (s !== node) regions.add(s); });
    node = node.parentNode;
  }
  // Order by document position (single DFS pass).
  const order = new Map(); let oi = 0; $('*').each((_, e) => order.set(e, oi++));
  return [...regions].sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0));
}

function buildDependencyGraph({ model, capturePlus }) {
  const cp = capturePlus || {};
  const nodes = []; const edges = []; const ids = new Set();
  const add = (n) => { if (!ids.has(n.id)) { ids.add(n.id); nodes.push(n); } return n.id; };
  const link = (type, from, to, meta) => { if (ids.has(from) && ids.has(to)) edges.push(Object.assign({ type, from, to }, meta ? { meta } : {})); };
  const css = allCss(model);

  // ── Document head (ir-1.1.0) — parsed here so the Generator needs no model ──
  const $ = cheerio.load(model.html || '<!doctype html><html><head></head><body></body>');
  const documentHead = {
    lang: $('html').attr('lang') || 'en',
    title: model.title || $('head > title').first().text() || '',
    metaViewport: $('meta[name="viewport"]').attr('content') || 'width=device-width, initial-scale=1',
    fontLinks: [...new Set(model.fontLinks || [])],
    fontFaceCss: [...(model.fontFaces || [])],
    // verbatim variable-declaration bodies — emitted whole (no tree-shake → no var drop)
    rootCss: model.rootCss || '',
    darkCss: model.darkCss || '',
    bodyClass: $('body').attr('class') || '',
    htmlAttrs: {},
  };

  // ── Variables (VDG) ──
  const defs = collectVarDefs(model.rootCss || '', new Map());
  collectVarDefs(css, defs);
  const runtimeVars = new Set((cp.runtimeVars || []).map((v) => v.name));
  const uses = collectVarUses(css, new Set());
  for (const name of new Set([...defs.keys(), ...uses, ...runtimeVars])) {
    let origin = 'unknown', sot = 'derived', conf = 0.5, contrib = [], loc = { by: 'inferred-dangling' };
    if (defs.has(name)) { origin = 'static'; sot = 'css-rule'; conf = 1; loc = { selector: ':root' }; }
    if (runtimeVars.has(name)) { origin = 'runtime'; sot = 'runtime'; conf = 0.9; contrib = defs.has(name) ? ['css-rule'] : []; loc = { probe: 'click' }; }
    add({ id: 'var:' + name, type: 'Variable', name, definedInScope: defs.has(name) ? ':root' : '', value: defs.get(name) || '', computedValue: null, varOrigin: origin, usesVars: [], provenance: prov(sot, loc, conf, contrib) });
  }
  for (const [name, val] of defs) { let m; const re = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,?)/g; while ((m = re.exec(val))) link(m[2] ? 'fallbackTo' : 'referencesVar', 'var:' + name, 'var:' + m[1]); }

  // ── Keyframes ──
  const kfActive = new Set(((cp.animations && cp.animations.active) || []).map((a) => a.name).filter(Boolean));
  (model.keyframes || []).forEach((kf) => {
    const name = (kf.match(/@(?:-webkit-)?keyframes\s+([A-Za-z0-9_-]+)/) || [])[1]; if (!name) return;
    const wb = new RegExp('\\b' + name.replace(/-/g, '\\-') + '\\b', 'g');
    const cssHits = (css.match(wb) || []).length; const htmlHits = ((model.html || '').match(wb) || []).length;
    let usage = 'unresolved';
    if (kfActive.has(name)) usage = 'runtime-applied';
    else if (cssHits >= 2) usage = 'static-css';
    else if (htmlHits >= 1) usage = 'utility-class';
    add({ id: 'kf:' + name, type: 'Keyframes', name, cssText: kf.slice(0, 4000), usage, provenance: prov('css-rule', { by: 'keyframes-block' }, kfActive.has(name) ? 0.9 : (usage === 'unresolved' ? 0.4 : 1), kfActive.has(name) ? ['runtime'] : []) });
  });

  // ── Fonts (resolved from computed; honest source classification) ──
  const faceFams = new Set((model.fontFaces || []).map((f) => (f.match(/font-family\s*:\s*['"]?([^;'"}]+)/) || [])[1]).filter(Boolean).map((s) => s.trim().toLowerCase()));
  const googleFams = new Set();
  (model.fontLinks || []).forEach((h) => { [...String(h).matchAll(/family=([^&:]+)/g)].forEach((x) => googleFams.add(decodeURIComponent(x[1].replace(/\+/g, ' ')).toLowerCase())); });
  const seenFont = new Set();
  (cp.computed || []).forEach((c) => {
    const ff = c.props && c.props['font-family']; if (!ff) return;
    const first = ff.split(',')[0].trim().replace(/['"]/g, ''); if (!first || /var\(/.test(first)) return;
    const key = first.toLowerCase(); if (seenFont.has(key)) return; seenFont.add(key);
    let source = 'custom-nonGoogle';
    if (GENERIC_FONTS.has(key)) source = 'system';
    else if (faceFams.has(key)) source = 'fontface';
    else if (googleFams.has(key)) source = 'google';
    add({ id: 'font:' + key, type: 'Font', family: first, resolvedFrom: 'computed-style', source, provenance: prov('computed-style', { property: 'font-family' }, source === 'custom-nonGoogle' ? 0.6 : 0.9, ['css-rule']) });
  });

  // ── Assets ──
  (model.assets || []).forEach((url, i) => {
    const kind = /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.test(url) ? 'img' : /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url) ? 'font-file' : /\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : 'img';
    add({ id: 'asset:' + i, type: 'Asset', url, kind, provenance: prov('css-rule', { by: 'url()' }, 1) });
  });

  // ── CssRule nodes + edges + token→rule index ──
  const tokenToRules = new Map();
  const indexToken = (tok, id) => { if (!tokenToRules.has(tok)) tokenToRules.set(tok, []); tokenToRules.get(tok).push(id); };
  let ri = 0;
  const addRule = (selector, ruleCss, media, tokenHint) => {
    const id = 'rule:' + (ri++);
    const state = /:hover/.test(selector) ? 'hover' : /:focus/.test(selector) ? 'focus' : /group-hover/.test(selector) ? 'group-hover' : /:active/.test(selector) ? 'active' : (/\[aria-/.test(selector) ? 'aria' : null);
    const usesVars = [...collectVarUses(ruleCss || '', new Set())];
    const usesKeyframes = [];
    ((ruleCss || '').match(/animation(?:-name)?\s*:\s*([^;}]+)/g) || []).forEach((d) => (d.match(/[A-Za-z_][A-Za-z0-9_-]*/g) || []).forEach((t) => { if (ids.has('kf:' + t)) usesKeyframes.push(t); }));
    const body = (ruleCss || '').trim();
    const usesAssets = [...new Set((body.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g) || []).map((u) => (u.match(/url\(\s*['"]?([^'")]+)/) || [])[1]).filter(Boolean))];
    // cssText makes the rule self-sufficient so the Generator never re-reads the model.
    add({ id, type: 'CssRule', selector, media: media || null, state, cssText: body, declarations: [], usesVars, usesKeyframes, usesAssets, provenance: prov('css-rule', { selector, media: media || null }, 1) });
    usesVars.forEach((v) => link('usesVar', id, 'var:' + v));
    usesKeyframes.forEach((k) => link('animates', id, 'kf:' + k));
    if (tokenHint) indexToken(tokenHint, id);
    else (selector.match(/\.((?:\\.|[A-Za-z0-9_-])+)/g) || []).forEach((s) => indexToken(s.slice(1).replace(/\\/g, ''), id));
    return id;
  };
  (model.baseRules || []).forEach((r) => addRule(r.selector, r.css, r.media));
  (model.complexRules || []).forEach((r) => addRule(r.selectorText, r.css, r.media));
  Object.entries(model.classRules || {}).forEach(([tok, ctxs]) => ctxs.forEach((c) => {
    const vp = variantPrefix(tok);
    // group-*/peer-* → ancestor/sibling selector (drop the mis-captured self-state);
    // everything else keeps its captured self states (:hover, :focus, …).
    const selector = vp ? vp + '.' + cssEsc(tok) : '.' + cssEsc(tok) + (c.states ? c.states.map((s) => ':' + s).join('') : '');
    addRule(selector, c.css, c.media, tok);
  }));

  // maps for per-section font/asset ownership (IR-internal, so generator needs no model)
  const urlToAsset = new Map(); nodes.forEach((n) => { if (n.type === 'Asset') urlToAsset.set(n.url, n.id); });
  const famToFont = new Map(); nodes.forEach((n) => { if (n.type === 'Font') famToFont.set((n.family || '').toLowerCase(), n.id); });
  const ruleById = new Map(); nodes.forEach((n) => { if (n.type === 'CssRule') ruleById.set(n.id, n); });

  // ── Sections + ownership closure (token-indexed) ──
  const sections = [];
  try {
    // Generic discovery: primary content (v1 findSectionRoot) + all content-bearing
    // top-level siblings, so nothing outside <main> is dropped.
    const kids = discoverSections($);
    // Preserve the page-level wrapper chain (bg/min-h/antialiased) around the sections.
    documentHead.wrapperChain = computeWrapperChain($, kids);
    const seenKey = new Map();
    kids.forEach((el, si) => {
      const $el = $(el);
      const rawName = detectSectionName(el, $, si, kids.length) || ('block-' + (si + 1));
      const n = (seenKey.get(rawName) || 0) + 1; seenKey.set(rawName, n);
      const key = n > 1 ? rawName + '-' + n : rawName;         // dedup like v1
      const label = rawName;
      const toks = new Set();
      $el.find('[class]').addBack('[class]').each((_, n) => ($(n).attr('class') || '').split(/\s+/).forEach((t) => t && toks.add(t)));
      const ruleIds = new Set(); const varIds = new Set(); const kfIds = new Set();
      toks.forEach((t) => (tokenToRules.get(t) || []).forEach((rid) => ruleIds.add(rid)));
      // pull vars/keyframes from owned rules
      nodes.forEach((n) => { if (n.type === 'CssRule' && ruleIds.has(n.id)) { n.usesVars.forEach((v) => varIds.add('var:' + v)); n.usesKeyframes.forEach((k) => kfIds.add('kf:' + k)); } });
      // transitive var closure
      let changed = true; while (changed) { changed = false; edges.forEach((e) => { if ((e.type === 'referencesVar' || e.type === 'fallbackTo') && varIds.has(e.from) && !varIds.has(e.to)) { varIds.add(e.to); changed = true; } }); }
      // per-section fonts + assets, pulled from owned rules (IR-internal)
      const fontIds = new Set(); const assetIds = new Set();
      ruleIds.forEach((rid) => {
        const r = ruleById.get(rid); if (!r) return;
        (r.usesAssets || []).forEach((u) => { const aid = urlToAsset.get(u); if (aid) assetIds.add(aid); });
        [...(r.cssText || '').matchAll(/font-family\s*:\s*([^;}]+)/g)].forEach((m) => {
          const first = m[1].split(',')[0].trim().replace(/['"]/g, '').toLowerCase();
          const fid = famToFont.get(first); if (fid) fontIds.add(fid);
        });
      });
      const owns = { ruleIds: [...ruleIds], varIds: [...varIds], keyframeIds: [...kfIds], fontIds: [...fontIds], assetIds: [...assetIds] };
      // section.html makes markup a first-class IR datum — the generator renders from this.
      sections.push({ key, label, tag: (el.tagName || 'section').toLowerCase(), html: $.html($el), owns, scope: 'owned' });
    });
    // mark shared resources (owned by >=2 sections)
    const count = new Map();
    sections.forEach((s) => Object.values(s.owns).forEach((arr) => arr.forEach((id) => count.set(id, (count.get(id) || 0) + 1))));
    nodes.forEach((n) => { if (count.get(n.id) >= 2) n.scope = 'shared'; });
  } catch (e) { /* section split best-effort */ }

  return { document: documentHead, dependency: { nodes, edges }, sections };
}

// discoverSections + helpers exported for the coverage checker (additive, pure).
module.exports = { buildDependencyGraph, discoverSections, contentKids, isContentBearing };
