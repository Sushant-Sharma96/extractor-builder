// build.js
// Consumes the structured CSS model from capture.js and produces:
//   - clean semantic HTML (Tailwind classes replaced by reusable semantic ones)
//   - one styles.css: preamble (@property + :root tokens + base + keyframes)
//     → Common/shared classes → each section's classes under a /* Section */ comment
//   - a section manifest
//
// The declarations are the SITE'S OWN — we union each element's classes' real
// rules (base + responsive @media + :hover/:focus + ::before/::after), keeping
// var(--token) and --tw-* references so everything resolves exactly as it did.

const cheerio = require('cheerio');

// Pretty-print generated HTML for developer review. Falls back to the raw
// (compact) markup if js-beautify isn't installed, so a conversion never fails
// over formatting. Inline elements are kept on one line so text spacing is
// unchanged (js-beautify's inline list handles a/span/strong/em/etc.).
let _htmlBeautify = null;
try { _htmlBeautify = require('js-beautify').html; } catch { _htmlBeautify = null; }
function prettyHtml(html) {
  if (!html || !_htmlBeautify) return html;
  try {
    return _htmlBeautify(html, {
      indent_size: 2,
      preserve_newlines: false,
      wrap_line_length: 0,
      extra_liners: [],
    });
  } catch { return html; }
}

// --- declaration parsing -----------------------------------------------------
// Split "a: b; c: d" into [[a,b],[c,d]] respecting parens (calc(), gradients).
function splitDeclarations(cssText) {
  const out = [];
  let depth = 0, buf = '';
  for (let i = 0; i < cssText.length; i++) {
    const c = cssText[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ';' && depth === 0) { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.map((d) => {
    const idx = d.indexOf(':');
    if (idx < 0) return null;
    return [d.slice(0, idx).trim(), d.slice(idx + 1).trim()];
  }).filter(Boolean);
}

// A context key groups declarations by breakpoint + state + pseudo-element.
function ctxKey(ctx) {
  return JSON.stringify([ctx.media || '', (ctx.states || []).slice().sort().join(':'), ctx.pseudoEl || '']);
}
const BASE_KEY = JSON.stringify(['', '', '']);

// --- CSS identifier helpers (for combinator/complex-rule translation) --------
function unescapeIdent(s) {
  return s.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, '$1');
}
function escapeIdent(s) {
  return s.replace(/[^\w-]/g, (ch) => '\\' + ch);
}
// Extract every class token (unescaped) that appears in a selector.
function extractClassTokens(sel) {
  const tokens = [];
  let i = 0;
  while (i < sel.length) {
    if (sel[i] === '.') {
      i++;
      let t = '';
      while (i < sel.length) {
        const c = sel[i];
        if (c === '\\') { t += c + (sel[i + 1] || ''); i += 2; continue; }
        if ('.#:>+~[](), \t\n'.includes(c)) break;
        t += c; i++;
      }
      if (t) tokens.push(unescapeIdent(t));
    } else { i++; }
  }
  return tokens;
}

// --- Tailwind --tw-* flattening ----------------------------------------------
// Compiled Tailwind leans on ~70 registered custom properties (--tw-shadow,
// --tw-translate-x, gradient stops, …) whose defaults come from @property and
// whose real values are set by utility classes on the SAME element. We resolve
// those composed values (box-shadow / transform / filter / gradients) to literal
// CSS per class, so the output needs no @property machinery and no --tw-* vars.
function eachAtProperty(atProperty) {
  const text = (atProperty || []).join('\n');
  const out = [];
  const re = /@property[^{]+\{[^}]*\}/g;
  let m;
  while ((m = re.exec(text))) out.push(m[0]);
  return out;
}
function parseTwDefaults(atProperty) {
  const map = new Map();
  for (const block of eachAtProperty(atProperty)) {
    const name = (/@property\s+(--[\w-]+)/.exec(block) || [])[1];
    if (!name) continue;
    const iv = /initial-value\s*:\s*([^;}]+)/.exec(block);
    map.set(name, iv ? iv[1].trim() : '');
  }
  return map;
}
function splitVarContent(content) {
  let depth = 0;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) return { name: content.slice(0, i).trim(), fallback: content.slice(i + 1).trim() };
  }
  return { name: content.trim(), fallback: null };
}
function replaceVarCalls(str, fn) {
  let out = '', i = 0;
  while (i < str.length) {
    if (str.startsWith('var(', i)) {
      let k = i + 4, d = 1, content = '';
      while (k < str.length && d > 0) {
        const c = str[k];
        if (c === '(') d++;
        else if (c === ')') { d--; if (d === 0) { k++; break; } }
        content += c; k++;
      }
      const { name, fallback } = splitVarContent(content);
      const rep = fn(name, fallback);
      out += (rep == null) ? str.slice(i, k) : rep;
      i = k;
    } else { out += str[i++]; }
  }
  return out;
}
function resolveVars(value, local, twDefaults) {
  let out = value, guard = 0, changed = true;
  while (changed && guard++ < 12) {
    changed = false;
    out = replaceVarCalls(out, (name, fb) => {
      if (!name.startsWith('--tw-')) return null; // only flatten Tailwind plumbing
      if (local.has(name)) { changed = true; return local.get(name); }
      if (fb != null) { changed = true; return fb; }
      if (twDefaults.has(name)) { changed = true; return twDefaults.get(name); }
      return null; // unresolved -> keep machinery
    });
  }
  return out;
}
function extractTwVarNames(v) {
  const out = [];
  const re = /var\(\s*(--tw-[\w-]+)/g;
  let m;
  while ((m = re.exec(v))) out.push(m[1]);
  return out;
}
function splitTopComma(s) {
  const out = []; let depth = 0, buf = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}
function tidyValue(prop, v) {
  let out = v.replace(/\s+/g, ' ').trim();
  if (/box-shadow$/.test(prop)) {
    const segs = splitTopComma(out).map((s) => s.trim())
      .filter((s) => s && !/^0 0 #0000$/i.test(s) && !/^0 0 (rgba?\(0,\s*0,\s*0,\s*0\)|transparent)$/i.test(s));
    out = segs.length ? segs.join(', ') : 'none';
  }
  return out;
}
// Resolve --tw-* references in one context's declaration map, mutating it.
// Records any --tw prop that survives (still referenced) in `unresolvedTw` so
// buildCss keeps exactly those @property rules and reset decls.
function flattenTwVars(map, twDefaults, unresolvedTw) {
  let touches = false;
  for (const [p, v] of map) { if (p.startsWith('--tw-') || v.includes('var(--tw-')) { touches = true; break; } }
  if (!touches) return;
  const local = new Map();
  for (const [p, v] of map) if (p.startsWith('--tw-')) local.set(p, v);
  for (const [p, v] of [...map]) {
    if (p.startsWith('--tw-') || !v.includes('var(--tw-')) continue;
    const resolved = resolveVars(v, local, twDefaults);
    if (resolved.includes('var(--tw-')) continue; // couldn't fully resolve — leave as-is
    const tidy = tidyValue(p, resolved);
    if (tidy === '') map.delete(p); else map.set(p, tidy);
  }
  const stillRef = new Set();
  for (const [p, v] of map) if (!p.startsWith('--tw-') && v.includes('var(--tw-')) for (const n of extractTwVarNames(v)) stillRef.add(n);
  for (const p of [...map.keys()]) {
    if (!p.startsWith('--tw-')) continue;
    if (stillRef.has(p)) unresolvedTw.add(p); else map.delete(p);
  }
}

// --- per-element style resolution --------------------------------------------
// classList -> { ctxKey: orderedMap(prop->val) }, merging in stylesheet order.
function resolveElementStyle(classList, classRules, twDefaults, unresolvedTw) {
  const collected = {}; // ctxKey -> [{order, decls:[[p,v]]}]
  for (const token of classList) {
    const rules = classRules[token];
    if (!rules) continue;
    for (const ctx of rules) {
      const key = ctxKey(ctx);
      (collected[key] || (collected[key] = [])).push({ order: ctx.order, decls: splitDeclarations(ctx.css), ctx });
    }
  }
  const buckets = {};
  for (const [key, entries] of Object.entries(collected)) {
    entries.sort((a, b) => a.order - b.order);
    const map = new Map();
    for (const e of entries) for (const [p, v] of e.decls) map.set(p, v); // later order wins
    if (twDefaults) flattenTwVars(map, twDefaults, unresolvedTw); // literalize --tw-* plumbing
    buckets[key] = { ctx: entries[0].ctx, map };
  }
  return buckets;
}

function isEmptyBuckets(buckets) {
  return Object.keys(buckets).length === 0 || Object.values(buckets).every((b) => b.map.size === 0);
}

// Stable signature so identically-styled elements collapse to one class.
// comboTokens (space-y, group, group-hover:*, etc.) participate so elements
// that need combinator rules never merge with ones that don't.
function signatureOf(buckets, comboTokens) {
  const parts = [];
  for (const key of Object.keys(buckets).sort()) {
    const b = buckets[key];
    if (!b.map.size) continue;
    const decls = [...b.map.entries()].sort((a, c) => a[0].localeCompare(c[0])).map(([p, v]) => `${p}:${v}`).join(';');
    parts.push(key + '{' + decls + '}');
  }
  let sig = parts.join('|');
  if (comboTokens && comboTokens.length) sig += '||combos:' + comboTokens.slice().sort().join(',');
  return sig;
}

// --- semantic naming ---------------------------------------------------------
function baseName(el, baseMap, $) {
  const tag = el.tagName ? el.tagName.toLowerCase() : 'div';
  const has = (p) => baseMap.has(p);
  const val = (p) => baseMap.get(p) || '';
  const disp = val('display');
  const txt = ($(el).text() || '').trim();

  if (tag === 'button' || (tag === 'a' && (has('background-color') || has('background-image')) && (has('border-radius') || has('padding') || has('padding-left') || has('padding-inline')))) return 'btn';
  if (tag === 'a') return 'link';
  if (tag === 'nav') return 'nav';
  if (tag === 'ul' || tag === 'ol') return 'list';
  if (tag === 'li') return 'list-item';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'field';
  if (tag === 'img' || tag === 'svg') return 'icon';
  if (tag === 'figure') return 'figure';
  if (tag === 'blockquote') return 'quote';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'p') return 'text';
  if (/(card|border) /.test(' ' + [...baseMap.keys()].join(' ') + ' ') && (has('border-radius')) && (has('padding') || has('padding-top')) && (has('box-shadow') || has('border-top-width') || has('border-width') || has('background-color'))) return 'card';
  if (disp === 'grid') return 'grid';
  if (disp === 'flex' || disp === 'inline-flex') {
    if (val('justify-content') === 'space-between') return 'row-between';
    if (val('align-items') === 'center' && val('justify-content') === 'center') return 'center';
    if (val('flex-direction') === 'column') return 'stack';
    return 'row';
  }
  if ((has('max-width')) && (val('margin-left') === 'auto' || val('margin-inline') === 'auto' || /auto/.test(val('margin')))) return 'container';
  if (tag === 'section' || tag === 'header' || tag === 'footer' || tag === 'main') return 'block';
  if (txt && txt.length < 40 && !$(el).children().length) return 'label';
  return 'box';
}

// --- section detection (reused, tuned) ---------------------------------------
function slug(text) {
  return (text || '').toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 5).join('-').slice(0, 40).replace(/-+$/g, '');
}
function eyebrowLabel($el, $) {
  for (const e of $el.find('span, p, div, small, strong, em, h2, h3').toArray()) {
    const $e = $(e);
    if ($e.children().length) continue;
    const t = $e.text().replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const words = t.split(' ');
    if (t.length <= 34 && words.length <= 5 && /[a-z]/i.test(t) && !/^[\d₹$€£]/.test(t)) return t;
  }
  return '';
}
function detectSectionName(el, $, index, total) {
  const $el = $(el);
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  const text = $el.text().replace(/\s+/g, ' ').trim();
  const lc = text.toLowerCase();
  const heading = $el.find('h1, h2, h3').first().text().replace(/\s+/g, ' ').trim();
  if (tag === 'header' || $el.find('nav').length) return 'header';
  if (tag === 'footer' || (/\b(copyright|©|all rights reserved)\b/i.test(text) && text.length < 800)) return 'footer';
  if ($el.find('h1').length) return 'hero';
  if (!heading && text.length < 160) return 'announcement';
  if (/faq|frequently asked|questions?,?\s*answered/.test(lc)) return 'faq';
  if ($el.find('blockquote, figure').length >= 2 || /\btestimonials?\b|\breviews?\b/.test(lc)) return 'testimonials';
  const priceTokens = (text.match(/[₹$€£]\s?\d[\d,]*/g) || []).length;
  if (priceTokens >= 2 || /\bpricing\b|\bplans?\b|\btiers?\b|\/mo\b|per month/.test(lc)) return 'pricing';
  if ((text.match(/\d[\d,]*\+?%?/g) || []).length >= 3 && text.length < 220) return 'stats';
  if (/reserve|get started|sign up|book (your|a)|start (free|now|today)|get the brochure/.test(lc) && text.length < 600) return 'cta';
  return slug(eyebrowLabel($el, $)) || slug(heading) || `block-${index + 1}`;
}
const SEMANTIC_SECTION_TAGS = new Set(['section', 'header', 'footer', 'main', 'article']);
function findSectionRoot($) {
  const main = $('main').first();
  if (main.length && main.children().length >= 2) return main;
  let node = $('body');
  const ignore = ['script', 'style', 'noscript', 'link', 'meta'];
  for (let depth = 0; depth < 8; depth++) {
    const kids = node.children().filter((_, c) => c.tagName && !ignore.includes(c.tagName.toLowerCase())).toArray();
    if (kids.length === 0) break;
    if (kids.length >= 2 && kids.every((k) => SEMANTIC_SECTION_TAGS.has(k.tagName.toLowerCase()))) return node;
    const totals = kids.map((k) => $(k).find('*').length + 1);
    const sum = totals.reduce((a, b) => a + b, 0);
    let maxI = 0;
    for (let i = 1; i < kids.length; i++) if (totals[i] > totals[maxI]) maxI = i;
    if (kids.length === 1 || totals[maxI] >= sum * 0.7) { node = $(kids[maxI]); continue; }
    return node;
  }
  return node;
}

// --- CSS emit helpers --------------------------------------------------------
// Normalize a couple of compiled-Tailwind values back to what a human writes:
// the float-max "rounded-full" radius, and the 30-property "transition-all" list.
const TRANSITION_SAFE = 'color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter';
function normalizeValue(prop, v) {
  if (/3\.40282[\de+]*px/i.test(v)) v = v.replace(/3\.40282[\de+]*px/gi, '9999px');
  // Avoid transition:all (perf) — both the compiled 30-property "transition-all"
  // list and a bare `all` — but keep the visually-relevant animatable properties
  // so hover/state animations look identical.
  if (prop === 'transition-property' && (v.trim() === 'all' || (/content-visibility|overlay/.test(v) && v.split(',').length > 10))) v = TRANSITION_SAFE;
  return v;
}
function declBlock(map, indent = '  ') {
  return [...map.entries()].map(([p, v]) => `${indent}${p}: ${normalizeValue(p, v)};`).join('\n');
}
function selectorFor(name, ctx) {
  let sel = '.' + name;
  if (ctx.states && ctx.states.length) sel += ':' + ctx.states.join(':');
  if (ctx.pseudoEl) sel += '::' + ctx.pseudoEl;
  return sel;
}
// Emit all rules for one class (base + states + pseudo + media), grouped.
function rulesForClass(name, buckets) {
  const flat = [];
  const media = {};
  for (const key of Object.keys(buckets)) {
    const b = buckets[key];
    if (!b.map.size) continue;
    const body = declBlock(b.map, '  ');
    const sel = selectorFor(name, b.ctx);
    if (b.ctx.media) (media[b.ctx.media] || (media[b.ctx.media] = [])).push(`${sel} {\n${body}\n}`);
    else flat.push(`${sel} {\n${body}\n}`);
  }
  const chunks = flat.slice();
  for (const mq of Object.keys(media)) chunks.push(`@media ${mq} {\n` + media[mq].map((r) => r.replace(/^/gm, '  ')).join('\n') + `\n}`);
  return chunks.join('\n');
}

// --- semantic naming ---------------------------------------------------------
// Every generated class is namespaced with `et-` (Bootstrap/global-safe) and
// named by ROLE + SECTION. Section-local classes read as BEM: `.et-hero__title`,
// `.et-pricing__card`. Styles shared across sections become reusable globals:
// `.et-button`, `.et-card`, `.et-title`, `.et-flex-center`.
const NS = 'et-';
const ROLE_WORD = {
  heading: 'title', text: 'text', label: 'label', btn: 'button', link: 'link',
  card: 'card', container: 'container', grid: 'grid', row: 'row', 'row-between': 'flex-between',
  stack: 'flex-col', center: 'flex-center', icon: 'icon', box: 'box', block: 'block',
  list: 'list', 'list-item': 'item', nav: 'nav', field: 'field', figure: 'figure', quote: 'quote',
};
// Global (cross-section) classes routed to Utilities vs Components in the output.
const UTIL_WORDS = new Set(['flex-between', 'flex-col', 'flex-center', 'row', 'grid', 'container']);
const COMPONENT_WORDS = new Set(['button', 'link', 'card', 'title', 'text', 'label', 'icon', 'field', 'nav', 'list', 'item', 'figure', 'quote']);
function sanitizeSeg(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x'; }
function baseOf(name) { return name.replace(/-\d+$/, ''); }

// Map every provisional name (box-13, heading-4, …) to a semantic namespaced one.
// `forced` pre-assigns names (used to pin section wrappers to `.et-<section>`).
function computeSemanticNames(usedNameOrder, nameSections, nameFirstSection, forced) {
  const map = new Map();
  const used = new Set();
  for (const v of forced.values()) used.add(v);
  for (const name of usedNameOrder) {
    if (forced.has(name)) { map.set(name, forced.get(name)); continue; }
    const role = baseOf(name);
    const word = ROLE_WORD[role] || sanitizeSeg(role);
    const sections = nameSections.get(name) || new Set();
    let target;
    if (sections.size > 1) target = NS + word;                                   // shared → reusable global
    else target = NS + sanitizeSeg(nameFirstSection.get(name) || [...sections][0] || 'block') + '__' + word; // section-local (BEM)
    let final = target, i = 2;
    while (used.has(final)) final = `${target}-${i++}`;
    used.add(final);
    map.set(name, final);
  }
  return map;
}
// Rewrite every structure that keys off class names, applying a rename map.
function applyRenameToStructures(map, nameToBuckets, nameSections, nameFirstSection, usedNameOrder, tokenToNames) {
  const nb = new Map(), ns = new Map(), nf = new Map(), order = [], seen = new Set();
  for (const [k, v] of nameToBuckets) nb.set(map.get(k) || k, v);
  for (const [k, v] of nameSections) ns.set(map.get(k) || k, v);
  for (const [k, v] of nameFirstSection) nf.set(map.get(k) || k, v);
  for (const n of usedNameOrder) { const nn = map.get(n) || n; if (!seen.has(nn)) { seen.add(nn); order.push(nn); } }
  for (const [tok, set] of tokenToNames) { const s = new Set(); for (const n of set) s.add(map.get(n) || n); tokenToNames.set(tok, s); }
  return { nameToBuckets: nb, nameSections: ns, nameFirstSection: nf, usedNameOrder: order };
}
// Route a final class name to an output group.
function classifyName(name, sectionKeySet) {
  const core = name.replace(/--\d+$/, '');
  if (core.includes('__')) return { kind: 'section', section: core.slice(NS.length).split('__')[0] };
  const word = core.slice(NS.length);
  if (sectionKeySet.has(word)) return { kind: 'section', section: word }; // section wrapper block
  if (UTIL_WORDS.has(word)) return { kind: 'utilities' };
  if (COMPONENT_WORDS.has(word)) return { kind: 'components' };
  return { kind: 'layout' };
}

// --- component factoring -----------------------------------------------------
// Within each role family, cluster near-identical variants and extract a shared
// base + thin per-variant modifiers (base ∪ modifier == original → identical
// render). Returns `emit` (finalName -> buckets, base+mods+leftovers) so the CSS
// writer can route each rule to its section/component/utility group.

// Given members [{name, buckets}], compute the per-context declarations common to
// ALL of them (the base) and each member's remaining declarations (its modifier).
function intersectBuckets(members) {
  const ctxKeys = new Set();
  for (const m of members) for (const k of Object.keys(m.buckets)) ctxKeys.add(k);
  const baseBuckets = {};
  let baseSize = 0;
  for (const key of ctxKeys) {
    if (!members.every((m) => m.buckets[key] && m.buckets[key].map.size)) continue;
    const shared = new Map();
    for (const [p, v] of members[0].buckets[key].map) {
      if (members.every((m) => m.buckets[key].map.get(p) === v)) shared.set(p, v);
    }
    if (shared.size) { baseBuckets[key] = { ctx: members[0].buckets[key].ctx, map: shared }; baseSize += shared.size; }
  }
  const remainders = new Map();
  for (const m of members) {
    const rem = {};
    for (const key of Object.keys(m.buckets)) {
      const base = baseBuckets[key] ? baseBuckets[key].map : new Map();
      const diff = new Map();
      for (const [p, v] of m.buckets[key].map) if (base.get(p) !== v) diff.set(p, v);
      if (diff.size) rem[key] = { ctx: m.buckets[key].ctx, map: diff };
    }
    remainders.set(m.name, rem);
  }
  return { baseBuckets, remainders, baseSize };
}

// A member's "shape" = which contexts + which property names it sets (ignoring
// values). Members with the same shape are the same visual pattern differing
// only in values → they factor cleanly into a shared base + value-diff modifiers.
function shapeKey(buckets) {
  return Object.keys(buckets).filter((k) => buckets[k].map.size).sort()
    .map((k) => k + '::' + [...buckets[k].map.keys()].sort().join(',')).join('|');
}

function factorComponents({ usedNameOrder, nameToBuckets, tokenToNames }) {
  const fams = new Map();
  for (const name of usedNameOrder) {
    if (!nameToBuckets.has(name)) continue;
    const b = baseOf(name);
    if (!fams.has(b)) fams.set(b, []);
    fams.get(b).push(name);
  }
  const comboRefNames = new Set();
  for (const set of tokenToNames.values()) for (const n of set) comboRefNames.add(n);

  const renameHtml = new Map();          // oldName -> "base mod" | "base"
  const nameReplaceForCombo = new Map(); // oldName -> unique class token (for combinator selectors)
  const emit = new Map();                // finalName -> buckets (base + modifiers + leftovers + singletons)
  const order = [];                      // emission order of final names

  for (const [b, names] of fams) {
    if (names.length === 1) { emit.set(names[0], nameToBuckets.get(names[0])); order.push(names[0]); continue; }
    const members = names.map((n) => ({ name: n, buckets: nameToBuckets.get(n) }));

    // Cluster members by shape; a cluster of >=2 with a shared core is factorable.
    const clusters = new Map();
    for (const m of members) { const k = shapeKey(m.buckets); if (!clusters.has(k)) clusters.set(k, []); clusters.get(k).push(m); }
    const clusterList = [...clusters.values()].sort((a, c) => c.length - a.length);
    const factorable = [], leftovers = [];
    for (const cl of clusterList) {
      // Only factor when the shared base pays for itself: extracting a base of B
      // decls from N members removes (N-1)*B duplicated decls; require that to
      // clear the ~4-line cost of the extra base rule.
      if (cl.length >= 2) { const info = intersectBuckets(cl); if (info.baseSize >= 1 && (cl.length - 1) * info.baseSize >= 4) { factorable.push({ cl, info }); continue; } }
      leftovers.push(...cl);
    }

    // Base names for factored clusters: `b`, `b-a`, `b-b`, … . A member literally
    // named `b` that isn't in any factored cluster keeps `b`, so bases skip the
    // clean slot. Original leftover names are `b-2`, `b-3`, … so never collide.
    const memberNamedBase = members.find((m) => m.name === b);
    const baseTaken = !!memberNamedBase && !factorable.some((fc) => fc.cl.includes(memberNamedBase));
    const letters = ['', '-a', '-b', '-c', '-d', '-e', '-f', '-g', '-h'];

    factorable.forEach((fc, idx) => {
      const slot = baseTaken ? idx + 1 : idx;
      const baseName = b + (slot < letters.length ? letters[slot] : `-s${slot}`);
      emit.set(baseName, fc.info.baseBuckets); order.push(baseName);
      fc.cl.forEach((m, i) => {
        const mod = `${baseName}--${i + 1}`;
        const rem = fc.info.remainders.get(m.name);
        const hasRem = Object.keys(rem).length > 0;
        const needCombo = comboRefNames.has(m.name);
        if (hasRem || needCombo) {
          renameHtml.set(m.name, `${baseName} ${mod}`);
          nameReplaceForCombo.set(m.name, mod);
          if (hasRem) { emit.set(mod, rem); order.push(mod); }
        } else {
          renameHtml.set(m.name, baseName);
        }
      });
    });
    for (const m of leftovers) { emit.set(m.name, m.buckets); order.push(m.name); }
  }

  // Re-point combinator selectors from old numbered names to their new tokens.
  for (const [tok, set] of tokenToNames) {
    const ns = new Set();
    for (const n of set) ns.add(nameReplaceForCombo.get(n) || n);
    tokenToNames.set(tok, ns);
  }
  return { renameHtml, emit, order };
}

// Rewrite url(...) references (root-relative /assets/…, relative paths) to
// absolute origin URLs so background-images resolve when the export is opened
// as a local file or served from a subfolder. Leaves data:/http(s):/blob: alone.
function rewriteCssUrls(text, absUrl) {
  if (!text || text.indexOf('url(') === -1) return text;
  return text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => {
    if (/^(data:|https?:|blob:|#)/i.test(u.trim())) return m;
    return `url(${q}${absUrl(u.trim())}${q})`;
  });
}

// --- scroll reveal reconstruction (Stage 7) ----------------------------------
// Consumes the per-element Behavior IR captured as data-et-reveal={o,ty,d,dl,e}:
// the exact from-state (opacity, translateY px) + timing (duration, delay,
// easing) discovered from the live original. We neutralize the baked hidden
// state (so the static baseline is visible — never blank) and reconstruct the
// reveal as an additive .et-in animation triggered by IntersectionObserver.
function parseReveal(raw) {
  if (!raw) return null;
  const p = String(raw).split('|');
  if (p.length < 5) return null;
  return { o: parseFloat(p[0]) || 0, ty: parseFloat(p[1]) || 0, d: p[2], dl: p[3], e: p[4] };
}
// Remove the reveal hidden-state declarations (opacity/transform) from a bucket
// map, so the element renders visible by default.
function neutralizeRevealBucket(map) {
  if (!map) return;
  map.delete('opacity');
  map.delete('transform');
  map.delete('-webkit-transform');
}
// Strip opacity/transform out of an inline style string (choreography SVG etc.).
function neutralizeRevealInline(style) {
  return (style || '').split(';').map((d) => d.trim()).filter(Boolean)
    .filter((d) => !/^(opacity|transform|-webkit-transform)\s*:/.test(d)).join(';');
}
// Pick the dominant timing across all reveals → CSS defaults; outliers get vars.
function revealDefaults(infos) {
  const mode = (key, fallback) => {
    const counts = new Map();
    for (const i of infos) { const v = i[key]; if (v != null) counts.set(v, (counts.get(v) || 0) + 1); }
    let best = fallback, n = 0;
    for (const [v, c] of counts) if (c > n) { best = v; n = c; }
    return best;
  };
  return { o: mode('o', 0), ty: mode('ty', 14), d: mode('d', '0.5s'), dl: mode('dl', '0s'), e: mode('e', 'ease-out') };
}

// --- main --------------------------------------------------------------------
function build(model) {
  const $ = cheerio.load(model.html, { decodeEntities: false });
  $('script, noscript, template').remove();
  $('#lovable-badge, [id^="lovable-badge"]').remove();

  const baseUrl = model.url || 'https://localhost/';
  const absUrl = (u) => { if (!u) return u; try { return new URL(u, baseUrl).href; } catch { return u; } };

  // Tag the consent/cookie banner so script.js can dismiss it (independent of
  // renamed classes). Anchor on an Accept/Decline button, walk up to the
  // container that also holds the cookie text, and tag that.
  if (!$('[data-dismiss-banner]').length) {
    $('button, a[role="button"]').each((_, b) => {
      const $b = $(b);
      if (!/^(accept|decline|reject|agree|got it|allow|dismiss|ok(ay)?)\b/i.test(($b.text() || '').trim())) return undefined;
      let $a = $b.parent();
      for (let i = 0; i < 8 && $a.length && $a.get(0) && $a.get(0).tagName !== 'body'; i++) {
        const t = $a.text() || '';
        if (/we use cookies|cookie policy|consent|we value your privacy|cookie preferences/i.test(t) && t.length < 700) {
          $a.attr('data-dismiss-banner', '');
          return false;
        }
        $a = $a.parent();
      }
      return undefined;
    });
  }

  const classRules = model.classRules || {};
  // Drop the removed Lovable badge's CSS from every rule bucket (its markup is
  // already stripped above) so none of it ships.
  const isBadge = (sel) => /lovable-badge/i.test(sel || '');
  const complexRules = (model.complexRules || []).filter((r) => !isBadge(r.selectorText));

  // Tailwind @property defaults, used to literalize --tw-* composed values.
  // unresolvedTw collects any --tw prop that can't be flattened, so buildCss
  // keeps exactly those (and drops the other ~70 @property rules).
  const twDefaults = parseTwDefaults(model.atProperty);
  const unresolvedTw = new Set();
  // Every class token that appears in a combinator rule (space-y, divide, group,
  // group-hover:*, peer-*, data-state targets, descendant rules).
  const comboTokenSet = new Set();
  for (const r of complexRules) for (const t of extractClassTokens(r.selectorText)) comboTokenSet.add(t);

  // ZERO-LOSS GUARD: figure out which combinator rules we can't fully translate
  // to semantic classes (a referenced class isn't on any normal element). For
  // those, we keep the ORIGINAL classes on the affected elements and emit the
  // rule verbatim — so no style is ever silently dropped, even for selector
  // shapes we've never seen.
  const LITERAL_MARKERS = new Set(['group', 'peer']);
  const nonSvgTokens = new Set();
  const allElementTokens = new Set();
  $('[class]').each((_, el) => {
    const inSvg = $(el).closest('svg').length > 0;
    ($(el).attr('class') || '').split(/\s+/).filter(Boolean).forEach((t) => {
      allElementTokens.add(t);
      if (!inSvg) nonSvgTokens.add(t);
    });
  });
  const failedRuleIdx = new Set(); // untranslatable but references a real element → emit verbatim
  const skipRuleIdx = new Set();   // references no element at all → dead rule → skip (lossless)
  const keepLiteralTokens = new Set();
  complexRules.forEach((r, i) => {
    const toks = extractClassTokens(r.selectorText);
    const nonLit = toks.filter((t) => !LITERAL_MARKERS.has(t));
    const translatable = nonLit.length > 0 && nonLit.every((t) => nonSvgTokens.has(t));
    if (translatable) return;
    const onEl = toks.filter((t) => allElementTokens.has(t));
    if (onEl.length) { failedRuleIdx.add(i); onEl.forEach((t) => keepLiteralTokens.add(t)); }
    else skipRuleIdx.add(i);
  });

  const sigToName = new Map();
  const nameToBuckets = new Map();
  const nameCounts = new Map();
  const nameSections = new Map();      // name -> Set(sectionName)
  const nameFirstSection = new Map();  // name -> section it first appeared in (for BEM naming)
  const tokenToNames = new Map();      // original token -> Set(semantic name) — for combinator translation

  function comboTokensOf(classList) {
    return classList.filter((t) => comboTokenSet.has(t));
  }

  function classFor(el, buckets, section, classList) {
    const comboTokens = comboTokensOf(classList);
    const sig = signatureOf(buckets, comboTokens);
    let name = sigToName.get(sig);
    if (!name) {
      let base = baseName(el, buckets[BASE_KEY] ? buckets[BASE_KEY].map : new Map(), $);
      const n = (nameCounts.get(base) || 0) + 1;
      nameCounts.set(base, n);
      name = n === 1 ? base : `${base}-${n}`;
      sigToName.set(sig, name);
      nameToBuckets.set(name, buckets);
      nameFirstSection.set(name, section);
    }
    for (const t of comboTokens) {
      if (!tokenToNames.has(t)) tokenToNames.set(t, new Set());
      tokenToNames.get(t).add(name);
    }
    if (!nameSections.has(name)) nameSections.set(name, new Set());
    nameSections.get(name).add(section);
    return name;
  }

  const sectionRoot = findSectionRoot($);
  const sectionEls = sectionRoot.children()
    .filter((_, c) => c.tagName && !['script', 'style'].includes(c.tagName.toLowerCase())).toArray();

  const sectionOrder = []; // { name, label }
  const usedNameOrder = []; // preserve first-seen order of classes

  function classListOf($el) {
    return ($el.attr('class') || '').split(/\s+/).filter(Boolean);
  }

  function walk(el, section) {
    if (el.type === 'text') { const t = el.data.replace(/\s+/g, ' '); return t.trim() ? t : ''; }
    if (!el.tagName) return '';
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'link', 'meta', 'template'].includes(tag)) return '';
    const $el = $(el);

    if (tag === 'svg') {
      // Give the <svg> a semantic class so its size (h-4 w-4) and color
      // (text-emerald -> currentColor) survive. Keep inner markup + inline
      // styles + data-from (animated chart dots) on descendants.
      const svgClassList = classListOf($el);
      const svgBuckets = resolveElementStyle(svgClassList, classRules, twDefaults, unresolvedTw);
      const svgCombo = comboTokensOf(svgClassList);
      const svgCls = (isEmptyBuckets(svgBuckets) && !svgCombo.length) ? null : classFor(el, svgBuckets, section, svgClassList);
      if (svgCls && !usedNameOrder.includes(svgCls)) usedNameOrder.push(svgCls);
      const $c = $el.clone();
      $c.find('[data-sx]').removeAttr('data-sx');
      $c.removeAttr('data-sx');
      // strip descendant classes, but keep ones an untranslatable rule needs
      $c.find('[class]').each((_, d) => {
        const kept = ($(d).attr('class') || '').split(/\s+/).filter((t) => keepLiteralTokens.has(t));
        if (kept.length) $(d).attr('class', kept.join(' ')); else $(d).removeAttr('class');
      });
      // Neutralize baked reveal hidden-state on SVG choreography nodes so the
      // chart renders (Stage 7 keeps them visible; staggered draw is preserved
      // by their own transition-delay when revealed).
      $c.find('[data-et-reveal]').each((_, d) => {
        const $d = $(d);
        $d.attr('style', neutralizeRevealInline($d.attr('style')));
        $d.removeAttr('data-et-reveal');
      });
      $c.removeAttr('class');
      $c.removeAttr('data-et-reveal');
      if (svgCls) $c.attr('class', svgCls);
      return $.html($c);
    }

    const classList = classListOf($el);
    const buckets = resolveElementStyle(classList, classRules, twDefaults, unresolvedTw);
    // Scroll-reveal (Behavior IR): neutralize the baked hidden state BEFORE naming
    // so the element dedups/renders by its visible style; the reveal is added back
    // additively (et-reveal + IntersectionObserver) in the post-walk pass.
    const revealRaw = $el.attr('data-et-reveal');
    if (revealRaw && buckets[BASE_KEY]) neutralizeRevealBucket(buckets[BASE_KEY].map);
    const countRaw = $el.attr('data-et-count'); // count-up number: text is the baked final
    const comboTokens = comboTokensOf(classList);
    const cls = (isEmptyBuckets(buckets) && !comboTokens.length) ? null : classFor(el, buckets, section, classList);
    if (cls && !usedNameOrder.includes(cls)) usedNameOrder.push(cls);

    if (tag === 'img') {
      const src = absUrl($el.attr('src') || '');
      const alt = ($el.attr('alt') || '').trim().replace(/"/g, '&quot;');
      let srcset = $el.attr('srcset') || '';
      if (srcset) srcset = srcset.split(',').map((p) => { const [u, d] = p.trim().split(/\s+/); return absUrl(u) + (d ? ' ' + d : ''); }).join(', ');
      const attrs = [cls ? ` class="${cls}"` : '', src ? ` src="${src}"` : '', srcset ? ` srcset="${srcset}"` : '', ` alt="${alt}"`,
        $el.attr('loading') ? ` loading="${$el.attr('loading')}"` : ''].join('');
      return `<img${attrs}>`;
    }

    // Inline styles carry REAL final rendered values (progress-bar widths, chart
    // positions, transforms, CSS vars) — keep them. data-from (set at capture)
    // carries the animation start state so script.js can replay the animation.
    let inlineStyle = rewriteCssUrls(($el.attr('style') || '').replace(/"/g, "'").replace(/\s+/g, ' ').trim(), absUrl);
    if (revealRaw) inlineStyle = neutralizeRevealInline(inlineStyle); // drop baked opacity/transform (choreography)

    const children = $el.contents().toArray();
    const inner = children.map((c) => walk(c, section)).filter(Boolean).join('');

    // drop unstyled wrapper divs/spans with a single child, no direct text, no
    // inline styling (keeping ones that carry inline styles)
    if ((tag === 'div' || tag === 'span') && !cls && !inlineStyle && !revealRaw) {
      const elemKids = children.filter((c) => c.tagName).length;
      const directText = $el.clone().children().remove().end().text().trim();
      if (elemKids <= 1 && !directText) return inner;
    }

    // Keep group/peer as literal markers so group-hover:/peer- combinator rules
    // still match. Also keep any original class an untranslatable rule needs
    // (zero-loss guard) so its verbatim rule still applies to this element.
    const markers = [];
    if (classList.includes('group')) markers.push('group');
    if (classList.includes('peer')) markers.push('peer');
    for (const t of classList) if (keepLiteralTokens.has(t) && !markers.includes(t)) markers.push(t);
    if (countRaw) markers.push('et-count'); // number counts up on scroll-in (final value is the text)
    const fullCls = [cls, ...markers].filter(Boolean).join(' ');
    const clsAttr = fullCls ? ` class="${fullCls}"` : '';
    const keep = [];
    if (inlineStyle) keep.push(` style="${inlineStyle}"`);
    if (revealRaw) keep.push(` data-et-reveal="${revealRaw.replace(/"/g, '&quot;')}"`); // consumed by post-walk pass, then removed
    if (countRaw) keep.push(` data-et-count="${String(countRaw).replace(/"/g, '&quot;')}"`);
    if (tag === 'a' && $el.attr('href')) keep.push(` href="${$el.attr('href')}"`);
    // Preserve accessibility + widget-state attributes so the interactivity
    // (accordions, tabs, menus) can be rewired by script.js.
    const KEEP_ATTRS = [
      'id', 'role', 'type', 'value', 'placeholder', 'name', 'for', 'title', 'open', 'tabindex',
      'aria-label', 'aria-hidden', 'aria-expanded', 'aria-controls', 'aria-selected',
      'aria-current', 'aria-labelledby', 'aria-describedby', 'hidden',
      'data-state', 'data-orientation', 'data-value', 'data-acc-trigger', 'data-acc-panel',
      'data-tabs', 'data-tab', 'data-tab-panel', 'data-dismiss-banner',
      'viewBox', 'fill', 'stroke', 'stroke-width', 'points', 'd', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
    ];
    for (const a of KEEP_ATTRS) {
      const v = $el.attr(a);
      if (v != null) keep.push(v === '' ? ` ${a}` : ` ${a}="${String(v).replace(/"/g, '&quot;')}"`);
    }
    const attrs = clsAttr + keep.join('');
    if (['br', 'hr', 'input'].includes(tag)) return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${inner}</${tag}>`;
  }

  const bodyBlocks = [];
  const sectionInfo = [];              // { et, cls } per section (for post-walk pinning)
  const sectionMarkerMap = new Map();  // wrapper marker token -> et-<section>
  const usedSecKeys = new Set();
  sectionEls.forEach((el, i) => {
    const rawName = detectSectionName(el, $, i, sectionEls.length);
    const label = rawName.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    let secKey = sanitizeSeg(rawName), k = 2;
    while (usedSecKeys.has(secKey)) secKey = `${sanitizeSeg(rawName)}-${k++}`;
    usedSecKeys.add(secKey);
    sectionOrder.push({ key: secKey, label });
    const $el = $(el);
    const secClassList = classListOf($el);
    const buckets = resolveElementStyle(secClassList, classRules, twDefaults, unresolvedTw);
    const comboTokens = comboTokensOf(secClassList);
    const cls = (isEmptyBuckets(buckets) && !comboTokens.length) ? null : classFor(el, buckets, secKey, secClassList);
    if (cls && !usedNameOrder.includes(cls)) usedNameOrder.push(cls);
    const inner = $el.contents().toArray().map((c) => walk(c, secKey)).filter(Boolean).join('');
    const semTag = secKey === 'header' ? 'header' : (secKey === 'footer' || rawName === 'footer') ? 'footer' : 'section';
    const et = NS + secKey;
    const marker = `xsec-${i}`;
    sectionMarkerMap.set(marker, et);
    sectionInfo.push({ et, cls });
    const sectionCls = marker + (cls ? ' ' + cls : '');
    bodyBlocks.push(`  <!-- Section: ${label} -->\n  <${semTag} class="${sectionCls}">\n${indent(inner, 4)}\n  </${semTag}>`);
  });

  // Pin a section's OWN style class to `et-<section>` only when that class is
  // unique to the section (a class shared across sections stays a shared global,
  // so it never leaks a second section name onto a wrapper).
  const sectionForced = new Map();
  for (const { et, cls } of sectionInfo) {
    if (cls && (nameSections.get(cls) || new Set()).size === 1) sectionForced.set(cls, et);
  }

  // 1) Assign every class a semantic, namespaced name (section wrappers pinned).
  const semMap = computeSemanticNames(usedNameOrder, nameSections, nameFirstSection, sectionForced);
  const renamed = applyRenameToStructures(semMap, nameToBuckets, nameSections, nameFirstSection, usedNameOrder, tokenToNames);
  // 2) Factor each role family into a shared base + thin modifiers.
  const factored = factorComponents({ usedNameOrder: renamed.usedNameOrder, nameToBuckets: renamed.nameToBuckets, tokenToNames });
  // 3) Rewrite HTML class tokens + apply discovered scroll-reveals.
  const reveal = { count: 0, defaults: revealDefaults([]) };
  let bodyHtml = bodyBlocks.join('\n\n');
  {
    const $$ = cheerio.load(`<body>${bodyHtml}</body>`, { decodeEntities: false });
    $$('[class]').each((_, el) => {
      const out = [], seen = new Set();
      for (const t of ($$(el).attr('class') || '').split(/\s+/).filter(Boolean)) {
        const sem = sectionMarkerMap.get(t) || semMap.get(t) || t;
        const finalCls = factored.renameHtml.get(sem) || sem;
        for (const piece of finalCls.split(' ')) if (piece && !seen.has(piece)) { seen.add(piece); out.push(piece); }
      }
      $$(el).attr('class', out.join(' '));
    });
    // Apply the discovered scroll-reveals: dominant timing → CSS defaults, each
    // reveal gets `.et-reveal` (+ inline vars only where it differs), then the
    // build-time tag is removed. Faithful to the original (IntersectionObserver +
    // per-element from-state/timing), reconstructed as an additive animation.
    const revealEls = $$('[data-et-reveal]').toArray();
    reveal.count = revealEls.length;
    if (revealEls.length) {
      const infos = revealEls.map((el) => parseReveal($$(el).attr('data-et-reveal'))).filter(Boolean);
      reveal.defaults = revealDefaults(infos);
      const D = reveal.defaults;
      revealEls.forEach((el) => {
        const $e = $$(el);
        const info = parseReveal($e.attr('data-et-reveal')) || {};
        const vars = [];
        if (info.o != null && info.o !== D.o) vars.push(`--et-ro:${info.o}`);
        if (info.ty != null && info.ty !== D.ty) vars.push(`--et-ry:${info.ty}px`);
        if (info.d && info.d !== D.d) vars.push(`--et-rd:${info.d}`);
        if (info.dl && info.dl !== D.dl) vars.push(`--et-rdelay:${info.dl}`);
        if (info.e && info.e !== D.e) vars.push(`--et-re:${info.e}`);
        const cls = ($e.attr('class') || '').split(/\s+/).filter(Boolean);
        if (!cls.includes('et-reveal')) cls.push('et-reveal');
        $e.attr('class', cls.join(' '));
        if (vars.length) { const st = ($e.attr('style') || '').trim(); $e.attr('style', (st ? st.replace(/;?$/, ';') : '') + vars.join(';')); }
        $e.removeAttr('data-et-reveal');
      });
    }

    // NEVER-BLANK SAFETY NET: an inline opacity:0 is always a reveal INITIAL state
    // in Lovable output (permanent hides use classes/aria, not inline). If any
    // slipped through detection, strip the hidden state (visible by default) and
    // turn it into a default reveal so it animates in rather than vanishing.
    $$('[style]').each((_, el) => {
      const $e = $$(el);
      const st = $e.attr('style') || '';
      if (!/opacity:\s*0(\D|$)/.test(st)) return;
      const cleaned = st.split(';').map((d) => d.trim()).filter(Boolean)
        .filter((d) => !/^(opacity|transform|-webkit-transform)\s*:/.test(d)).join(';');
      $e.attr('style', cleaned);
      const cls = ($e.attr('class') || '').split(/\s+/).filter(Boolean);
      if (!cls.includes('et-reveal')) { cls.push('et-reveal'); $e.attr('class', cls.join(' ')); }
    });
    reveal.count = $$('.et-reveal').length; // include any swept-in reveals so CSS/JS emit

    // Namespace each top-level section with .et-scope so it is SELF-CONTAINED:
    // the scoped reset/base and the design tokens (defined on .et-scope) apply
    // inside every section on their own, with no outer wrapper required. This
    // matches the platform storing each section independently — no wrapper for
    // the importer to add, and the shared stylesheet is NOT duplicated (only a
    // ~12-byte class token repeats per section).
    $$('body').children().each((_, el) => {
      const cls = ($$(el).attr('class') || '').split(/\s+/).filter(Boolean);
      if (!cls.includes('et-scope')) { cls.unshift('et-scope'); $$(el).attr('class', cls.join(' ')); }
    });

    bodyHtml = $$('body').html();
  }

  const cssBuilt = buildCss(model, { sectionOrder, complexRules, tokenToNames, failedRuleIdx, skipRuleIdx, unresolvedTw, factored, reveal });
  // Namespace captured keyframes (fade-up/marquee/drift → et-kf-*) after URL
  // rewriting so animation references in every css slice are rewritten too.
  const kfNames = (model.keyframes || []).map((k) => (String(k).match(/@(?:-webkit-)?keyframes\s+"?([A-Za-z0-9_-]+)/) || [])[1]).filter(Boolean);
  const finishCss = (s) => namespaceKeyframes(rewriteCssUrls(s, absUrl), kfNames);
  const css = finishCss(cssBuilt.full);       // fix root-relative url(/assets/…) + namespace kf
  // Preserve external font imports (Google Fonts etc.). The standalone `html`
  // gets <link>s via buildHtml; globalCss (used by the platform's Global CSS
  // field, injected into a <style>) gets @import at the very top so webfonts
  // still load there. fontLinks is also exposed on the response for callers
  // that prefer to emit <link> tags themselves.
  const fontImports = (model.fontLinks || []).map((h) => `@import url("${h}");`).join('\n');
  const globalCss = (fontImports ? fontImports + '\n\n' : '') + finishCss(cssBuilt.globalCss);
  const html = prettyHtml(buildHtml(model, bodyHtml));
  const js = buildScript(reveal);
  const summary = [...new Set(sectionOrder.map((s) => s.label))].join(', ');

  // Per-section split for the event-platform import: the final body has exactly
  // one top-level element per section (same order as sectionOrder). Pair each
  // element's outerHTML with that section's own CSS. globalJs is the page script.
  const scss = (key) => finishCss(cssBuilt.sectionCss[key] || '');
  let sectionsDetailed;
  try {
    const $$ = cheerio.load(`<body>${bodyHtml}</body>`, { decodeEntities: false });
    const kids = $$('body').children().toArray();
    sectionsDetailed = sectionOrder.map((s, i) => {
      const el = kids[i];
      const $el = el ? $$(el) : null;
      const html = el ? prettyHtml($$.html(el).trim()) : '';
      const tag = el ? String(el.tagName || el.name || 'section').toLowerCase() : 'section';
      // label = the section TYPE (Hero, Pricing, Footer…) — how developers think
      // about a page. The section's real heading is surfaced only as a content
      // preview so the checklist reads well without any DOM parsing.
      const heading = $el ? ($el.find('h1,h2,h3').first().text() || '').trim().replace(/\s+/g, ' ') : '';
      const text = $el ? ($el.text() || '').trim().replace(/\s+/g, ' ') : '';
      // Phase-2 structured payload for the native-module mappers (best-effort;
      // PHP consumes this, never re-parses HTML). Empty object if extraction throws.
      let structured = {};
      try { if (el) structured = extractStructured($$, el, s.label); } catch { structured = {}; }
      // Twig template (dynamic bind) — only for bindable sections with a clean,
      // uniform structure; '' otherwise (conservative gate → section stays static).
      let html_with_vars = '', bind_manifest = null;
      try {
        if (el && structured.bindable) {
          const tw = buildTwigTemplate($$, el, structured);
          if (tw && tw.html) { html_with_vars = tw.html; bind_manifest = tw.manifest || null; }
        }
      } catch { html_with_vars = ''; }
      // Ship the accordion/tab initializer in the section's own JS when its Twig
      // uses those interactions (agenda Details / day-tabs) — so it works even if
      // the platform doesn't inject globalJs. Idempotent with globalJs.
      const secNeedsJs = /data-acc-trigger|data-tabs|role="tab(list)?"/.test(html_with_vars || '');
      return {
        key: s.key,                 // unique, stable id (use for section title uniqueness)
        label: s.label,             // section type — human display name
        tag,                        // section | header | footer
        html,                       // one self-contained block, ready to insert
        css: scss(s.key),           // this section's own rules only
        js: secNeedsJs ? SECTION_INTERACTION_JS : '', // per-section interactivity (else global)
        preview: (heading || text).slice(0, 120),
        htmlBytes: html.length,
        hasImages: /<img\b|background-image|url\(/i.test(html),
        // structured fields: suggestedType, structure, items[], prose, email, phone, dateHints
        ...structured,
        // Twig shell for dynamic bind (present only when the section is safely
        // templatable). has_twig_template is the conservative UI/API gate flag.
        // bind_manifest gives Corporate/Microsite the loop container + item
        // selectors so it can target the dynamic region without re-parsing.
        ...(html_with_vars ? { html_with_vars, has_twig_template: true, bind_manifest } : { has_twig_template: false }),
      };
    });
  } catch {
    sectionsDetailed = sectionOrder.map((s) => ({
      key: s.key, label: s.label, tag: 'section', html: '', css: scss(s.key),
      js: '', preview: '', htmlBytes: 0, hasImages: false,
    }));
  }

  // ── Page-level reconciliation ────────────────────────────────────────────
  // A backend module (speakers/sponsors/…) has ONE data source, so if several
  // sections bind the SAME module they'd all render identical data. Keep the
  // single best candidate per module as dynamic; demote the rest to static and
  // record why. "Best" = highest confidence, then most items, then largest html.
  try { reconcileDuplicateBindings(sectionsDetailed); } catch (e) { console.error('[build] reconcile failed', e); }

  console.log(`[build] scroll-reveals reconstructed: ${reveal.count} (defaults ${reveal.defaults.d}/${reveal.defaults.e}, translateY ${reveal.defaults.ty}px)`);
  const bound = sectionsDetailed.filter((s) => s.bindable).map((s) => `${s.key}:${s.bindable}`);
  console.log(`[build] dynamic bindings: ${bound.length ? bound.join(', ') : 'none'}`);
  return { html, css, js, sectionsSummary: summary, sections: sectionOrder, sectionsDetailed, globalCss, globalJs: js, fontLinks: model.fontLinks || [] };
}

// Demote all-but-the-best section per bound module to static, so no two Custom
// Sections pull the same backend module (which would duplicate data on render).
function reconcileDuplicateBindings(sections) {
  const byType = {};
  sections.forEach((s) => { if (s.bindable) (byType[s.bindable] = byType[s.bindable] || []).push(s); });
  Object.keys(byType).forEach((type) => {
    const group = byType[type];
    if (group.length < 2) return;
    const score = (s) => [s.bindable_confidence || 0, (s.bind_diagnostics && s.bind_diagnostics.itemCount) || 0, s.htmlBytes || 0];
    group.sort((a, b) => { const A = score(a), B = score(b); return B[0] - A[0] || B[1] - A[1] || B[2] - A[2]; });
    const primary = group[0];
    group.slice(1).forEach((s) => {
      s.bindable = null;
      s.has_twig_template = false;
      delete s.html_with_vars;
      const why = `duplicate "${type}" on page — kept "${primary.key}" (higher confidence/items); this one stays static`;
      s.bind_diagnostics = Object.assign({}, s.bind_diagnostics, { reason: why, demoted: true, primary: primary.key });
      (s.static_extras = s.static_extras || []).push(why);
    });
    if (primary.bind_diagnostics) primary.bind_diagnostics.primaryFor = type;
  });
}

function indent(str, n) {
  const pad = ' '.repeat(n);
  return str.split('\n').map((l) => (l.trim() ? pad + l : l)).join('\n');
}

function buildHtml(model, body) {
  const fontLinks = (model.fontLinks || []).map((h) => `  <link rel="stylesheet" href="${h}">`).join('\n');
  const title = (model.title || 'Converted Page').replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
${fontLinks ? fontLinks + '\n' : ''}  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <!-- Each section carries class="et-scope": all generated CSS is scoped under
       .et-scope, so it never touches host styles AND every section is
       self-contained (tokens + reset apply without any outer wrapper). -->
${body}
  <script src="script.js"></script>
</body>
</html>
`;
}

// Translate captured combinator rules (space-y / divide / group-hover / peer /
// data-state / descendant) onto the generated semantic classes, so their
// declarations are never lost. Each .token in the selector is rewritten to the
// semantic class(es) of elements that had that token; group/peer stay literal.
function emitCombinatorRules(complexRules, tokenToNames, failedRuleIdx, skipRuleIdx) {
  const flat = [], media = {};
  const LITERAL = new Set(['group', 'peer']);
  failedRuleIdx = failedRuleIdx || new Set();
  skipRuleIdx = skipRuleIdx || new Set();
  let translated = 0, verbatim = 0;
  const push = (sel, body, mq) => {
    const rule = `${sel} {\n${body}\n}`;
    if (mq) (media[mq] || (media[mq] = [])).push(rule); else flat.push(rule);
  };
  complexRules.forEach((r, i) => {
    if (skipRuleIdx.has(i)) return; // dead rule (matches no element) — lossless to drop
    // These gather rules (space-y / divide spacing) are the ones the host's tag
    // rules most often clobber, so pin them with !important (normalizing any
    // existing) so the legacy bundle can't re-write the spacing.
    const body = splitDeclarations(r.css).map(([p, v]) => {
      const vv = String(v).replace(/\s*!important\s*$/i, '');
      return `  ${p}: ${vv} !important;`;
    }).join('\n');
    if (!body.trim()) return;
    // Zero-loss fallback: rules we couldn't map are emitted verbatim (their
    // original classes are kept on the elements by the guard in build()).
    if (failedRuleIdx.has(i)) { push(r.selectorText, body, r.media); verbatim++; return; }
    const tokens = [...new Set(extractClassTokens(r.selectorText))];
    if (!tokens.length) return;
    let selectors = [r.selectorText];
    let ok = true;
    for (const tok of tokens) {
      if (LITERAL.has(tok)) continue; // keep .group / .peer literal
      const names = tokenToNames.get(tok);
      if (!names || !names.size) { ok = false; break; }
      const nameArr = [...names].slice(0, 6);
      const needle = '.' + escapeIdent(tok);
      const next = [];
      for (const sel of selectors) for (const nm of nameArr) next.push(sel.split(needle).join('.' + nm));
      selectors = next.slice(0, 24);
    }
    if (!ok) { push(r.selectorText, body, r.media); verbatim++; return; } // safety net
    for (const sel of selectors) push(sel, body, r.media);
    translated++;
  });
  const chunks = [...new Set(flat)];
  for (const mq of Object.keys(media)) chunks.push(`@media ${mq} {\n` + [...new Set(media[mq])].map((x) => x.replace(/^/gm, '  ')).join('\n') + `\n}`);
  return { css: chunks.join('\n\n'), translated, verbatim };
}

// ── CSS isolation helpers ────────────────────────────────────────────────────
// Everything the compiler emits must be embeddable into ANY host page without
// touching it. Global selectors (*, element types, :root, [hidden], focus,
// reduced-motion) are scoped under a single root namespace; keyframes are
// namespaced so animations can't collide.
const ROOT = '.et-scope';
function splitTopComma(sel) {
  const out = []; let depth = 0, buf = '';
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
// Zero-specificity scope. Using :where(.et-scope) — NOT a bare `.et-scope ` prefix —
// is critical: :where() contributes 0 to specificity, so a scoped reset like
// `:where(.et-scope) h1 { font-size: inherit }` stays at (0,0,1), exactly as the
// original `h1` reset, and still loses to utility classes like .et-hero__title
// (0,1,0). A plain `.et-scope h1` would be (0,1,1) and WRONGLY override utilities,
// collapsing every heading/size to the reset value.
const SCOPE = `:where(${ROOT})`;
function scopeSelector(selList) {
  return splitTopComma(selList).map((part) => {
    part = part.trim();
    if (!part) return null;
    // Selectors that target the document ROOT/BODY (or a shadow :host) map to the
    // namespace root itself — the .et-scope element stands in for <html>/<body>.
    // Mapping them to a DESCENDANT (`.et-scope body`) matches nothing and drops the
    // page's foundational typography.
    if (/^(:root|html|body|:host|:where\(html\)|:where\(:host\)|html:root|:root:where\(html\)|:host\([^)]*\))$/i.test(part)) return SCOPE;
    const rooted = part.match(/^(?::root|html|body|:host)\b([\s\S]*)$/i); // html.dark, body .x, :root.dark
    if (rooted) return SCOPE + rooted[1];                         // -> :where(.et-scope).dark / :where(.et-scope) .x
    if (part === '*') return SCOPE + ', ' + SCOPE + ' *';         // include the root element itself
    if (part.startsWith('::')) return SCOPE + ' ' + part;         // ::before / ::after
    return SCOPE + ' ' + part;                                    // element / [attr] / :where(...)
  }).filter(Boolean).join(', ');
}
function namespaceKeyframes(css, names) {
  if (!css || !names || !names.length) return css;
  const uniq = [...new Set(names)];
  css = css.replace(/(@(?:-webkit-)?keyframes\s+)("?)([A-Za-z0-9_-]+)\2/g, (m, kw, q, nm) =>
    uniq.includes(nm) ? kw + 'et-kf-' + nm : m);
  css = css.replace(/(animation(?:-name)?\s*:\s*)([^;{}]+)/g, (m, prop, val) => {
    let v = val;
    for (const n of uniq) v = v.replace(new RegExp('(^|[\\s,])' + n.replace(/[-]/g, '\\-') + '(?=$|[\\s,])', 'g'), '$1et-kf-' + n);
    return prop + v;
  });
  return css;
}

// ── Phase-2 structured extraction ───────────────────────────────────────────
// Schema-AGNOSTIC. The converter (which already owns the DOM) does ALL parsing;
// the PHP mappers consume this and map to each module's fields. We emit a best
// guess of the module type plus generic list `items[]` / `prose`, so PHP never
// re-parses HTML. Best-effort by design: the admin confirms in the checklist and
// anything that doesn't map cleanly falls back to a Custom-HTML section.
const TYPE_RULES = [
  // Aligned to the corporate rule-book keyword lists. Precise event-domain terms
  // only — the broad terms (leadership/advisors/our experts) were dropped because
  // they mis-flag feature/about blocks; classification is conservative on purpose.
  ['faq',               /faqs?\b|frequently asked|common questions|got questions|\bq\s*&\s*a\b|\bquestions\b|\bhelp\b/i],
  ['agenda',            /\bagenda\b|schedule|timeline|sessions?\b|programme\b|program\b|day\s*\d/i],
  ['speakers',          /speakers?\b|faculty|mentors?\b|panel(?:ist)?s?\b|jur(?:y|ors?)\b|judges?\b|\bguests?\b|leaders?\b|leadership\b|voices?\b|dignitar/i],
  ['sponsors',          /sponsors?\b|partners?\b|backed by|powered by|supported by|our supporters/i],
  ['contact',           /contact\b|get in touch|reach us|write to us/i],
  ['resources',         /resources?\b|whitepapers?|downloads?|reports?\b|case stud|\bblog\b/i],
  ['glimpses',          /glimpses?\b|gallery|photos?\b|moments|highlights|in pictures|snapshots/i],
  ['key-points',        /key (discussion|takeaways|topics|themes)|what (we|you).?ll (cover|discuss)|discussion points|focus areas/i],
  ['who-should-attend', /who should attend|who is this for|ideal for|designed for/i],
  ['why-join-us',       /why (join|attend|participate)|what you.?ll (get|gain)|reasons to|benefits\b/i],
  ['about',             /about (us|the|this)\b|who we are|our (story|mission|vision)/i],
];
function guessSectionType(text) {
  const t = (text || '').toLowerCase();
  for (const [type, re] of TYPE_RULES) if (re.test(t)) return type;
  return null;
}
function txt($$, el) { return ($$(el).text() || '').replace(/\s+/g, ' ').trim(); }
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/;
const DATE_RE = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b|\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{0,2}\b|\bday\s*\d\b/gi;

function extractStructured($$, el, label) {
  const $sec = $$(el);
  const heading = ($sec.find('h1,h2,h3,h4').first().text() || '').replace(/\s+/g, ' ').trim();
  const secText = txt($$, el);
  // Classify from the section LABEL + heading only (high precision). Body text is
  // deliberately NOT used — incidental keywords in card content (e.g. an item
  // titled "Leadership Programs") caused false positives.
  const suggestedType = guessSectionType(label) || guessSectionType(heading);

  // Flat repeated items (speakers / faq, and the fallback for grouped modules).
  const bestGroup = pickRepeatedGroup($$, $sec, false);
  const flatItems = (bestGroup || []).map((k) => itemFrom($$, k)).filter((it) => it.title || it.image || it.text || it.email || it.phone);

  const paragraphs = $sec.find('p').map((_, p) => txt($$, p)).get().filter(Boolean);
  const bullets = $sec.find('li').map((_, li) => txt($$, li)).get().filter(Boolean);

  // sponsors / agenda / contact are GROUPED (tiers / days / contact categories);
  // speakers / faq are flat. Grouped modules always emit groups[] — real groups
  // when the design has group headings, else a single wrapping group.
  const GROUPED = suggestedType === 'sponsors' || suggestedType === 'agenda' || suggestedType === 'contact';
  let structure, groups = [], items = [];
  if (GROUPED) {
    structure = 'grouped_list';
    const g = extractGroups($$, $sec, suggestedType, heading); // sectionHeading excluded from groups
    if (g && g.length) groups = g;
    else if (flatItems.length) groups = [{ group_title: heading || label || '', group_key: slugify(heading || label || 'group'), items: flatItems }];
  } else {
    items = flatItems;
    structure = items.length >= 2 ? 'list' : ((paragraphs.length || bullets.length) ? 'prose' : null);
  }

  const allItems = GROUPED ? groups.reduce((a, g) => a.concat(g.items), []) : items;
  // slots — which fields the item template ACTUALLY has. Only true slots are
  // candidates for dynamic replacement; false = not in the design.
  const SLOT_KEYS = ['title', 'subtitle', 'text', 'image', 'href', 'email', 'phone'];
  const slots = {};
  SLOT_KEYS.forEach((k) => { slots[k] = allItems.some((it) => it[k]); });

  // bindable — TYPE + STRUCTURE, not slot presence. A section binds when its TYPE
  // is one of the 5 modules (from nav/eyebrow/heading — the type signal is the
  // guard against false positives) AND it has a repeated/grouped structure. Slots
  // only decide WHICH fields to fill (and are synthesized for placeholder
  // mockups), never WHETHER to bind. Every decision records a `bind_reason` so a
  // static fallback is always explainable (see bind_diagnostics).
  const imgRatio = allItems.length ? allItems.filter((it) => it.image).length / allItems.length : 0;
  const qShare = allItems.length ? allItems.filter((it) => (it.title || '').includes('?')).length / allItems.length : 0;
  const realGrid = allItems.length >= 3 || imgRatio >= 0.5; // a people/logo grid, not a 2-item CTA
  const MODULES = ['speakers', 'faq', 'sponsors', 'agenda', 'contact'];
  const t = suggestedType;
  const hasStruct = GROUPED ? groups.length > 0 : items.length >= 2;
  let bindable = null, confidence = 0, bindReason = '';
  if (!t || !MODULES.includes(t)) {
    bindReason = t ? `type "${t}" is not a bindable module` : 'no module type signal (nav / eyebrow / heading)';
  } else if (!hasStruct) {
    bindReason = `type "${t}" but no repeated/grouped structure (items:${items.length}, groups:${groups.length})`;
  } else if (!GROUPED) {
    if (t === 'speakers') {
      if (realGrid) { bindable = 'speakers'; confidence = imgRatio >= 0.5 ? 0.9 : 0.75; }
      else bindReason = `speakers but not a real grid (items:${allItems.length}, imgRatio:${imgRatio.toFixed(2)}) — likely a 2-item CTA`;
    } else if (t === 'faq') {
      if (qShare >= 0.5 || slots.text) { bindable = 'faq'; confidence = qShare >= 0.5 ? 0.9 : 0.7; }
      else bindReason = `faq but items don't look like Q/A (qShare:${qShare.toFixed(2)})`;
    }
  } else { // GROUPED: sponsors / agenda / contact — bind on type + structure
    if (t === 'sponsors') { bindable = 'sponsors'; confidence = slots.image ? 0.85 : (slots.title || slots.subtitle ? 0.7 : 0.6); }
    else if (t === 'agenda') { bindable = 'agenda'; confidence = slots.title ? 0.8 : 0.65; }
    else if (t === 'contact') { bindable = 'contact'; confidence = (slots.email || slots.phone) ? 0.85 : 0.6; }
  }
  if (bindable) bindReason = `bound as ${bindable} (conf ${confidence}${imgRatio ? `, imgRatio ${imgRatio.toFixed(2)}` : ''})`;

  // speakers/sponsors always carry an image slot: even when the Lovable design
  // uses an initials avatar or a "LOGO" placeholder, the backend supplies a real
  // photo/logo, which the converter synthesizes into an <img> in html_with_vars.
  if (bindable === 'speakers' || bindable === 'sponsors') slots.image = true;

  const static_extras = [];
  if (heading) static_extras.push(`section heading "${heading.slice(0, 60)}" is static`);
  if (bindable) static_extras.push(GROUPED
    ? `bindable "${bindable}" — ${groups.length} group(s), ${allItems.length} item(s); non-slot elements stay static`
    : `bindable "${bindable}" — ${allItems.length} item(s); non-slot elements (badges/icons) stay static`);

  return {
    suggestedType,
    bindable,
    bindable_confidence: confidence,
    structure,
    slots,
    items: (GROUPED ? [] : items).slice(0, 60),
    groups: groups.map((g) => ({ group_title: g.group_title, group_key: g.group_key, items: g.items.slice(0, 40) })).slice(0, 20),
    prose: { heading, paragraphs: paragraphs.slice(0, 20), bullets: bullets.slice(0, 40) },
    static_extras,
    email: (secText.match(EMAIL_RE) || [''])[0],
    phone: (secText.match(PHONE_RE) || [''])[0],
    dateHints: [...new Set(secText.match(DATE_RE) || [])].slice(0, 20),
    // Observability: why this section did/didn't bind. Read this to diagnose any
    // static fallback across 200+ templates without reverse-engineering.
    bind_diagnostics: {
      reason: bindReason,
      type: t || null,
      structure,
      itemCount: allItems.length,
      groupCount: groups.length,
      imgRatio: Number(imgRatio.toFixed(2)),
      qShare: Number(qShare.toFixed(2)),
      slots,
    },
  };
}

// Slugify a group heading into a stable key for DOM matching (platinum, day-1…).
function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'group'; }

// Largest homogeneous repeated child group within $scope. requireMarker=true only
// counts children carrying an item marker (img / heading / link) — used inside a
// group so a contact card's <p> fields aren't mistaken for separate items.
function pickRepeatedGroup($$, $scope, requireMarker) {
  let best = null, bestScore = 1;
  $scope.find('*').each((_, node) => {
    const kids = $$(node).children().toArray();
    if (kids.length < 2) return;
    const tags = {};
    kids.forEach((k) => { const tn = (k.tagName || k.name || '').toLowerCase(); tags[tn] = (tags[tn] || 0) + 1; });
    const top = Object.keys(tags).sort((a, b) => tags[b] - tags[a])[0];
    if (!top || tags[top] < 2) return;
    const group = kids.filter((k) => (k.tagName || k.name || '').toLowerCase() === top);
    const meaningful = group.filter((k) => {
      const $k = $$(k);
      if (requireMarker) return $k.find('img').length || $k.find('h1,h2,h3,h4,h5,h6').length || $k.find('a[href]').length;
      return $k.find('img').length || $k.find('h1,h2,h3,h4,h5,h6').length || txt($$, k).length > 15;
    });
    if (meaningful.length >= 2 && meaningful.length > bestScore) { bestScore = meaningful.length; best = meaningful; }
  });
  return best;
}

// Build a generic {title,subtitle,text,image,href,email,phone} item from a node.
function itemFrom($$, k) {
  const $k = $$(k);
  const title = ($k.find('h1,h2,h3,h4,h5,h6').first().text() || $k.find('strong,b,button').first().text() || '').replace(/\s+/g, ' ').trim();
  const paras = $k.find('p').map((_, p) => txt($$, p)).get().filter(Boolean);
  const all = txt($$, k);
  let itemText = all;
  if (title && itemText.indexOf(title) === 0) itemText = itemText.slice(title.length).trim();
  else if (title) itemText = itemText.replace(title, '').trim();
  let subtitle = paras[0] || '';
  if (subtitle && (subtitle === itemText || subtitle === title)) subtitle = '';
  return {
    title, subtitle, text: itemText,
    image: $k.find('img').first().attr('src') || '',
    href: $k.find('a').first().attr('href') || '',
    email: (all.match(EMAIL_RE) || [''])[0],
    phone: (all.match(PHONE_RE) || [''])[0],
  };
}

// Grouped extraction: find the container whose children are group units (each a
// heading = group_title + its own item content). For agenda, only day/track
// headings count as dividers (a session title is an item, not a group).
function extractGroups($$, $sec, module, sectionHeading) {
  const units = findGroupUnits($$, $sec, module, sectionHeading);
  if (!units) return null;
  const groups = units.map((u) => {
    const $u = $$(u);
    const ghNode = unitHeadingNode($$, $u, module);
    const gt = (ghNode ? $$(ghNode).text() : '').replace(/\s+/g, ' ').trim();
    const sub = pickRepeatedGroup($$, $u, true); // logos / sessions inside the group
    let items;
    if (sub && sub.length >= 2) {
      items = sub.map((k) => itemFrom($$, k));
    } else {
      const paras = $u.find('p').map((_, p) => txt($$, p)).get().filter(Boolean);
      const all = txt($$, u);
      items = [{
        title: (paras[0] || '').slice(0, 120),
        subtitle: paras[1] || '',
        text: paras.slice(2).join(' '),
        image: $u.find('img').first().attr('src') || '',
        href: $u.find('a').first().attr('href') || '',
        email: (all.match(EMAIL_RE) || [''])[0],
        phone: (all.match(PHONE_RE) || [''])[0],
      }];
    }
    items = items.filter((it) => it.title || it.image || it.text || it.email || it.phone);
    return { group_title: gt, group_key: slugify(gt), items };
  }).filter((g) => g.group_title && g.items.length);
  return groups.length ? groups : null;
}

// The heading node of a group unit. Real headings are <h2-h6>; but sponsors tiers
// and contact desks often label the group with a styled <div>/<span> instead
// (Lovable auto-classes aren't semantic), so for those modules we also accept a
// short leaf-text element as the group label.
function unitHeadingNode($$, $k, module) {
  const h = $k.find('h2,h3,h4,h5,h6').toArray()[0];
  if (h) return h;
  if (module === 'sponsors' || module === 'contact') {
    return $k.find('*').toArray().find((c) => {
      if ($$(c).children().toArray().some((x) => txt($$, x).replace(/\s+/g, '').length > 0)) return false; // leaf
      const t = txt($$, c).replace(/\s+/g, ' ').trim();
      return t && t.length <= 40;
    }) || null;
  }
  return null;
}

// Locate the container whose children are group units (each a group_title
// heading + its own content). Shared by extractGroups (data) and
// buildTwigTemplate (DOM rewrite) so both operate on the SAME groups.
function findGroupUnits($$, $sec, module, sectionHeading) {
  const dayRe = /\bday\s*\d|\btrack\b|morning|afternoon|forenoon|evening|session\s*\d/i;
  const secH = (sectionHeading || '').trim();
  let units = null, bestScore = 1;
  $sec.find('*').each((_, node) => {
    const kids = $$(node).children().toArray();
    if (kids.length < 2) return;
    const groupKids = kids.filter((k) => {
      const $k = $$(k);
      const hNode = unitHeadingNode($$, $k, module);
      if (!hNode) return false;
      const htext = ($$(hNode).text() || '').replace(/\s+/g, ' ').trim();
      // skip the section's OWN heading block — it's not a group
      if (secH && htext && (htext === secH || secH.indexOf(htext) === 0 || htext.indexOf(secH) === 0)) return false;
      const body = txt($$, k).replace(htext, '').trim();
      if (!(body.length > 3 || $k.find('img').length > 0)) return false;
      if (module === 'agenda') return dayRe.test(htext); // day/track dividers only
      return true;
    });
    // >= prefers the DEEPER container on ties (the real group grid, not an
    // ancestor that also happens to contain N heading-bearing children).
    if (groupKids.length >= 2 && groupKids.length >= bestScore) { bestScore = groupKids.length; units = groupKids; }
  });
  return units;
}

// ── Twig template emission (html_with_vars) ─────────────────────────────────
// For a bindable section, produce a Twig template that reuses the platform's
// existing resolver (/fetch-dynamic-html). We keep the EXACT Lovable shell,
// classes and CSS hooks and replace ONLY data slots with {{ vars }}; the whole
// original static markup is preserved as the {% else %} fallback so an empty
// backend never renders a blank section. If the structure isn't clean/uniform
// we return '' (static-only) — conservative gate, no broken layouts.

// bindable → Twig field names (must match the resolver's extractedData shape).
const FIELD = {
  speakers: { itemvar: 'speaker', collection: 'extractedData', title: 'speaker_name',
    paras: ['speaker_desig', 'speaker_company', 'speaker_info'], image: 'speaker_picture', href: 'linkedin_url', raw: [] },
  faq: { itemvar: 'faq', collection: 'extractedData', title: 'question', answer: 'answer', raw: ['answer'] },
  sponsors: { grouped: true, itemvar: 'sponsor', collection: 'extractedData', title: 'sponsor_title',
    image: 'sponsor_logo', href: 'sponsor_url', paras: ['description'], raw: ['description'] },
  agenda: { grouped: true, itemvar: 'agenda', collection: 'extractedData', title: 'agenda_title',
    time: true, paras: ['agenda_description'], raw: ['agenda_description'] },
  contact: { grouped: true, itemvar: 'contact', collection: 'extractedData', title: 'name',
    email: 'email', phone: 'phone', paras: [], raw: [] },
};

function escapeTwigStr(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function varExpr(v, field, raw) { return raw && raw.indexOf(field) >= 0 ? `{{ ${v}.${field}|raw }}` : `{{ ${v}.${field} }}`; }
function setTwigText($$, node, s) { $$(node).text(s); } // {{ }} / {% %} survive .text()

// Replace an element's TEXT with a Twig var while preserving interactive/icon
// wrappers (accordion <button>, <svg> icons, <a>). Drills to the deepest single
// text-bearing element, then overwrites only its text nodes — so e.g.
// <h3><button>Q <svg/></button></h3> becomes <h3><button>{{q}} <svg/></button></h3>,
// keeping the button that drives the accordion.
function setSlotText($$, node, twig) {
  let cur = node;
  for (let guard = 0; guard < 6; guard++) {
    const childEls = $$(cur).children().toArray();
    const textEls = childEls.filter((c) => !$$(c).is('svg,img,br,hr,input,label') && txt($$, c).replace(/\s+/g, '').length > 0);
    if (textEls.length === 1 && childEls.length <= 2) { cur = textEls[0]; continue; }
    break;
  }
  const $cur = $$(cur);
  const hasIcon = $cur.children().toArray().some((c) => $$(c).is('svg,img'));
  if (hasIcon) { $cur.contents().each((_, n) => { if (n.type === 'text') n.data = ''; }); $cur.prepend(twig); }
  else $cur.text(twig);
}

// Register a unique text token that gets string-replaced with Twig control
// markup after serialization (Twig tags aren't valid DOM, so we can't insert
// them as nodes).
function twMarker(ctr, repl, twig) { const tok = `@@ETTW${ctr.n++}@@`; repl.push([tok, twig]); return tok; }
function twWrap($$, node, ctr, repl, open, close) {
  $$(node).before(twMarker(ctr, repl, open));
  $$(node).after(twMarker(ctr, repl, close));
}

// Structural signature by tag + immediate child tags — catches non-uniform
// siblings (e.g. a larger "featured" first card) that would break templating.
// normMedia collapses an <img> and a short-text placeholder (initials/"Logo") to
// a common 'media' token, so a speaker/sponsor grid MIXING real images and
// placeholders (Lovable adds an image to one card at a time) still reads as
// uniform and binds — the loop template normalizes them to one image slot.
function twSig($$, node, normMedia) {
  const tag = (node.tagName || node.name || '').toLowerCase();
  const kids = $$(node).children().toArray().map((k) => {
    const kt = (k.tagName || k.name || '').toLowerCase();
    if (!normMedia) return kt;
    if (kt === 'img' || kt === 'svg' || kt === 'picture' || kt === 'figure') return 'media';
    const $k = $$(k);
    const leaf = !$k.children().toArray().some((c) => txt($$, c).replace(/\s+/g, '').length > 0);
    if (leaf && txt($$, k).replace(/\s+/g, '').length <= 6) return 'media'; // initials / "Logo" placeholder
    return kt;
  }).sort().join(',');
  return `${tag}|${kids}`;
}
function twUniform($$, nodes) {
  if (!nodes || !nodes.length) return false;
  const s0 = twSig($$, nodes[0]);
  return nodes.every((n) => twSig($$, n) === s0);
}

// Largest set of repeated children that are ALL structurally uniform (same
// dominant tag AND identical child-tag signature). Unlike pickRepeatedGroup
// (which maximizes count and may return a heterogeneous top-level block), this
// guarantees a clean loop body and that removing the siblings leaves no static
// leftover of the same tag. Used only for Twig emission.
function twPickUniform($$, $scope, requireMarker, module) {
  const normMedia = module === 'speakers' || module === 'sponsors';
  let best = null, bestLen = 1;
  $scope.find('*').each((_, node) => {
    const kids = $$(node).children().toArray();
    if (kids.length < 2) return;
    const tags = {};
    kids.forEach((k) => { const t = (k.tagName || k.name || '').toLowerCase(); tags[t] = (tags[t] || 0) + 1; });
    const top = Object.keys(tags).sort((a, b) => tags[b] - tags[a])[0];
    if (!top || tags[top] < 2) return;
    const meaningful = kids.filter((k) => (k.tagName || k.name || '').toLowerCase() === top).filter((k) => {
      const $k = $$(k);
      if (requireMarker) return $k.find('img').length || $k.find('h1,h2,h3,h4,h5,h6').length || $k.find('a[href]').length;
      return $k.find('img').length || $k.find('h1,h2,h3,h4,h5,h6').length || txt($$, k).length > 15;
    });
    if (meaningful.length < 2) return;
    const s0 = twSig($$, meaningful[0], normMedia);
    if (!meaningful.every((k) => twSig($$, k, normMedia) === s0)) return; // not cleanly templatable
    if (meaningful.length > bestLen) { bestLen = meaningful.length; best = meaningful; }
  });
  return best;
}

// Tightest descendant whose text matches re (min text length = most specific).
function twFindByRe($$, $scope, re, sel) {
  let best = null, bestLen = 1e9;
  $scope.find(sel || 'p,span,div,a,li,td,time').each((_, n) => {
    const t = txt($$, n);
    if (re.test(t) && t.length < bestLen) { best = n; bestLen = t.length; }
  });
  return best;
}
// Richest leaf-ish text block (used for a FAQ answer that may be a <div>).
function twRichestText($$, $scope, excludeNode, exSet) {
  let best = null, bestLen = 15;
  $scope.find('p,div,span,li').each((_, n) => {
    if (n === excludeNode || (exSet && exSet.has(n))) return;
    if ($$(n).children().toArray().some((c) => txt($$, c).length > 15)) return; // not a wrapper
    const t = txt($$, n);
    if (t.length > bestLen) { best = n; bestLen = t.length; }
  });
  return best;
}

// Repeated item cells inside a group unit (e.g. sponsor logo tiles in a tier
// grid) — the largest set of uniform element-children of any descendant
// container, excluding the group heading. Accepts a single cell (a 1-logo tier
// is still a valid loop template). Used for grouped modules whose items are
// visual tiles rather than text blocks.
function twGridCells($$, $unit, ghNode) {
  let best = null, bestLen = 0;
  $unit.find('*').each((_, n) => {
    if (n === ghNode) return;
    const els = $$(n).children().toArray().filter((k) => k.tagName || k.name);
    if (els.length < 1) return;
    if (els.some((k) => k === ghNode)) return;
    const s0 = twSig($$, els[0]);
    if (!els.every((k) => twSig($$, k) === s0)) return;
    if (els.length > bestLen) { bestLen = els.length; best = els; }
  });
  return best;
}

// Image slot: bind an existing <img>, OR synthesize one into a placeholder area
// (initials avatar, "LOGO" tile) so backend photos/logos inject at render, with
// the original placeholder kept as the {% else %} fallback. Marks the touched
// node(s) in `used` so title/paragraph detection won't re-grab the placeholder.
function twImageSlot($$, $item, module, ex, used, ctr, repl) {
  const F = FIELD[module];
  const V = F.itemvar, imgF = F.image, titleF = F.title || 'title';
  // Speaker photos are portraits → cover; sponsor logos must not be cropped → contain.
  const fit = module === 'sponsors' ? 'contain' : 'cover';
  const dyn = `<img src="{{ ${V}.${imgF} }}" alt="{{ ${V}.${titleF} }}" style="width:100%;height:100%;object-fit:${fit}" />`;

  const img = $item.find('img').toArray().find((i) => !ex.has(i));
  if (img) {
    const orig = $$.html(img);
    let d = orig.replace(/\ssrc="[^"]*"/i, ` src="{{ ${V}.${imgF} }}"`);
    d = /\salt="[^"]*"/i.test(d) ? d.replace(/\salt="[^"]*"/i, ` alt="{{ ${V}.${titleF} }}"`) : d.replace(/<img/i, `<img alt="{{ ${V}.${titleF} }}"`);
    // enforce the right object-fit (sponsor logos = contain)
    if (/style="/i.test(d)) d = /object-fit/i.test(d) ? d.replace(/object-fit:\s*[a-z-]+/i, `object-fit:${fit}`) : d.replace(/style="/i, `style="object-fit:${fit};`);
    else d = d.replace(/<img/i, `<img style="object-fit:${fit}"`);
    $$(img).replaceWith(twMarker(ctr, repl, `{% if ${V}.${imgF} is not empty %}${d}{% else %}${orig}{% endif %}`));
    used.add(img);
    return true;
  }

  // No <img> — find the placeholder frame: an aspect-ratio box, a short-text
  // holder (initials/LOGO/tile name), or the item itself. For sponsors the whole
  // tile IS the logo slot, so allow a longer placeholder ("Presenting 1", etc.).
  const maxLbl = module === 'sponsors' ? 40 : 6;
  const leafOnly = (n) => !$$(n).children().toArray().some((c) => !$$(c).is('svg,img,br,hr') && txt($$, c).replace(/\s+/g, '').length > 0);
  let box = $item.find('[style*="aspect-ratio"]').toArray().find((n) => !ex.has(n) && $$(n).find('img').length === 0);
  if (!box) box = $item.find('div,span,figure').toArray().find((n) => {
    if (ex.has(n) || $$(n).find('img').length || !leafOnly(n)) return false;
    const t = txt($$, n).replace(/\s+/g, '');
    return t.length > 0 && t.length <= maxLbl;
  });
  if (!box) { const t = txt($$, $item[0] || $item).replace(/\s+/g, ''); if (t.length > 0 && t.length <= maxLbl && $item.children().length === 0) box = $item[0] || $item; }
  if (box) {
    const inner = $$(box).html() || '';
    let elseBranch = inner;
    if (module === 'speakers') { // regenerate initials from the live name
      const init = `{{ ${V}.speaker_name|slice(0,2)|upper }}`;
      elseBranch = /<[^>]+>[^<]*<\/[^>]+>/.test(inner) ? inner.replace(/>([^<]*)</, `>${init}<`) : `<span>${init}</span>`;
    }
    $$(box).empty().append(twMarker(ctr, repl, `{% if ${V}.${imgF} is not empty %}${dyn}{% else %}${elseBranch}{% endif %}`));
    used.add(box);
    return true;
  }
  return false;
}

// Find the eyebrow label (a short section-name line, e.g. "Featured speakers")
// that sits ABOVE the hero h2. When present, the eyebrow — not the hero — is the
// admin-overridable section title (Pattern A). Returns the node or null.
function findEyebrow($$, hEl) {
  const $h = $$(hEl);
  const short = (n) => { const t = ($$(n).text() || '').replace(/\s+/g, ' ').trim(); return t && t.length < 60 && !$$(n).is('h1,h2,h3,h4,h5,h6') && $$(n).find('h1,h2,h3,h4,h5,h6').length === 0; };
  let p = $h.prev();
  while (p && p.length) { if (short(p[0])) return p[0]; p = p.prev(); }
  const kids = $h.parent().children().toArray();
  const hi = kids.indexOf(hEl);
  for (let i = hi - 1; i >= 0; i--) if (short(kids[i])) return kids[i];
  return null;
}

// Make id / id-reference attributes unique per loop iteration so repeated items
// (FAQ accordions, agenda Details panels) don't collide on duplicate ids —
// captured React/Radix ids are identical across items. idxExpr is a Twig
// expression (e.g. '{{ loop.index }}') appended to every id and its references.
function twUniqueIds($$, node, idxExpr) {
  const attrs = ['id', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'for', 'headers'];
  const $set = $$(node).find('[id],[aria-controls],[aria-labelledby],[aria-describedby],[for],[headers]');
  const all = $$(node).is('[id],[aria-controls],[aria-labelledby],[aria-describedby],[for],[headers]') ? $set.add(node) : $set;
  all.each((_, el) => {
    for (const a of attrs) { const v = $$(el).attr(a); if (v) $$(el).attr(a, `${v}-${idxExpr}`); }
  });
}

// Fill one item node's data slots with {{ vars }}. Returns the number of slots
// mapped, or false to HARD-GATE (too many unsupported fields would be dropped).
// mapped === 0 means nothing bindable was found (e.g. a mock sponsor tile with a
// text placeholder instead of a real <img>) — callers gate that to static.
function twFillItem($$, node, module, repl, ctr, exclude, idxExpr) {
  const F = FIELD[module];
  const V = F.itemvar;
  const $n = $$(node);
  const ex = new Set(exclude || []);
  const used = new Set();
  const IDX = idxExpr || '{{ loop.index }}';
  let mapped = 0;

  if (F.email) { const en = twFindByRe($$, $n, EMAIL_RE, 'p,span,div,a,li,td'); if (en && !ex.has(en)) { setSlotText($$, en, `{{ ${V}.${F.email} }}`); twWrap($$, en, ctr, repl, `{% if ${V}.${F.email} is not empty %}`, `{% endif %}`); used.add(en); mapped++; } }
  if (F.phone) { const pn = twFindByRe($$, $n, PHONE_RE, 'p,span,div,a,li,td'); if (pn && !ex.has(pn) && !used.has(pn)) { setSlotText($$, pn, `{{ ${V}.${F.phone} }}`); twWrap($$, pn, ctr, repl, `{% if ${V}.${F.phone} is not empty %}`, `{% endif %}`); used.add(pn); mapped++; } }
  if (F.time) { const tn = twFindByRe($$, $n, /\d{1,2}[:.]\d{2}|\b(a\.?m\.?|p\.?m\.?)\b/i, 'p,span,div,time,li'); if (tn && !ex.has(tn)) { setSlotText($$, tn, `{{ ${V}.agenda_start_datetime|date('H:i') }} – {{ ${V}.agenda_end_datetime|date('H:i') }}`); used.add(tn); mapped++; } }

  // image FIRST — bind an existing <img> OR synthesize one into the placeholder
  // area, marking it used so the title/paras below skip the placeholder text.
  if (F.image && twImageSlot($$, $n, module, ex, used, ctr, repl)) mapped++;

  // title: first heading; else the first LEAF text element (name <p>, etc.).
  // Never pick a wrapper (e.g. a card <button> that holds the photo + all text) —
  // setSlotText on a wrapper would wipe the whole card. A <button>/<a> is only a
  // valid title when it is itself a leaf (e.g. <button>Name</button>).
  const isLeafText = (e) => txt($$, e).replace(/\s+/g, '').length > 0
    && !$$(e).children().toArray().some((c) => !$$(c).is('svg,img,br,hr') && txt($$, c).replace(/\s+/g, '').length > 0);
  // include <div> in the leaf search ONLY for contact (div-based desk cards whose
  // name isn't a heading/<p>). Elsewhere <div> is excluded so the image container
  // (which twImageSlot turns into a text token) is never mistaken for a title.
  const leafSel = module === 'contact' ? 'p,strong,b,span,button,a,div' : 'p,strong,b,span,button,a';
  let titleNode = $n.find('h1,h2,h3,h4,h5,h6').toArray().find((h) => !ex.has(h) && !used.has(h))
    || $n.find(leafSel).toArray().find((e) => !ex.has(e) && !used.has(e) && isLeafText(e));
  if (F.title && titleNode) { setSlotText($$, titleNode, varExpr(V, F.title, F.raw)); used.add(titleNode); mapped++; }

  if (F.href) {
    const a = $n.find('a[href]').toArray().find((x) => !ex.has(x));
    if (a) { $$(a).attr('href', `{{ ${V}.${F.href} }}`); twWrap($$, a, ctr, repl, `{% if ${V}.${F.href} is not empty %}`, `{% endif %}`); mapped++; }
  }

  // FAQ answer: prefer the richest text block; if empty (radix/collapsible bodies
  // are rendered client-side and captured empty), target the region/last block
  // after the question so the answer still binds.
  if (F.answer) {
    let ans = twRichestText($$, $n, titleNode, used);
    if (!ans) {
      ans = $n.find('[role="region"]').toArray().find((n) => n !== titleNode)
        || $n.children().toArray().filter((c) => c !== titleNode && !$$(c).is('svg,img')).pop();
    }
    if (ans) { setSlotText($$, ans, varExpr(V, F.answer, F.raw)); used.add(ans); mapped++; }
    twUniqueIds($$, node, IDX);
    return mapped;
  }

  // AGENDA: the session synopsis belongs in the collapsible Details panel, not a
  // visible line. Bind agenda_description into the [data-acc-panel]/region body
  // (with the design's own fallback text), and skip the <p> description mapping.
  let agendaDescInPanel = false;
  if (module === 'agenda') {
    const panel = $n.find('[data-acc-panel],[role="region"]').toArray().find((n) => !ex.has(n) && !used.has(n))
      || $n.find('[hidden]').toArray().find((n) => !ex.has(n) && !used.has(n));
    if (panel) {
      const orig = ($$(panel).html() || '').trim();
      const fb = orig || '<p>Session synopsis will be published closer to the event date.</p>';
      $$(panel).empty().append(twMarker(ctr, repl, `{% if ${V}.agenda_description is not empty %}{{ ${V}.agenda_description|raw }}{% else %}${fb}{% endif %}`));
      used.add(panel); mapped++; agendaDescInPanel = true;
    }
  }

  // Ordered paragraphs → the module's field list. Everything INSIDE a repeated
  // item is per-item data, so an unmapped paragraph (a field the backend module
  // can't supply — agenda venue/track, etc.) must be REMOVED, not left static, or
  // it would repeat identically on every rendered item. The original line stays
  // in the {% else %} fallback (toggle OFF). Too many unsupported fields → the
  // design diverges from the data model, so gate to static.
  const fields = (module === 'agenda' && agendaDescInPanel) ? [] : (F.paras || []);
  // contact cards are often div-based, so also sweep leaf <div>/<span> to avoid a
  // static desk/category line duplicating across every rendered contact.
  const paraSel = module === 'contact' ? 'p,div,span' : 'p';
  const paras = $n.find(paraSel).toArray().filter((p) => !ex.has(p) && !used.has(p) && p !== titleNode && (module !== 'contact' || isLeafText(p)));
  let fi = 0, dropped = 0;
  for (const p of paras) {
    const hasText = txt($$, p).replace(/\s+/g, '').length > 0;
    if (fi < fields.length) { setSlotText($$, p, varExpr(V, fields[fi++], F.raw)); used.add(p); mapped++; }
    else if (hasText) { $$(p).remove(); dropped++; }
  }
  // Drop unsupported per-item lines (fields with no backend column). A very high
  // count means the section probably isn't really this module — only then gate.
  if (dropped > 6) { if (process.env.TW_DEBUG) console.error(`[twig-gate] ${module} fillItem: ${dropped} unmapped paras dropped`); return false; }
  twUniqueIds($$, node, IDX);
  return mapped;
}

// Fill one agenda SESSION node (time / title / description-in-Details) and wire
// its Details accordion with ids unique across (group, session).
function fillAgendaSession($$, node, V, ctr, repl) {
  const $n = $$(node);
  const used = new Set();
  const tn = twFindByRe($$, $n, /\d{1,2}[:.]\d{2}|\b(a\.?m\.?|p\.?m\.?)\b/i, 'p,span,div,time,li');
  if (tn) { setSlotText($$, tn, `{{ ${V}.agenda_start_datetime|date('H:i') }} – {{ ${V}.agenda_end_datetime|date('H:i') }}`); used.add(tn); }
  const h = $n.find('h1,h2,h3,h4,h5,h6').toArray()[0];
  if (h) { setSlotText($$, h, `{{ ${V}.agenda_title }}`); used.add(h); }

  // SPEAKER slot: the design puts speaker name(s) in a meta box AFTER the title
  // (a second <p> there is the location, which has no backend field). Bind the
  // first post-title <p> to the joined speaker names on ONE line (ellipsis +
  // tooltip so multiple names don't break the row); full details go in the panel.
  if (h) {
    let seen = false, spk = null;
    $n.find('p,h1,h2,h3,h4,h5,h6').toArray().forEach((el) => {
      if (el === h) { seen = true; return; }
      if (seen && !spk && (el.tagName || '').toLowerCase() === 'p' && !used.has(el)) spk = el;
    });
    if (spk) {
      const cur = ($$(spk).attr('style') || '').replace(/;\s*$/, '');
      $$(spk).attr('style', (cur ? cur + ';' : '') + 'max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
      $$(spk).attr('title', `{{ ${V}.speaker_names }}`);
      setSlotText($$, spk, `{{ ${V}.speaker_names }}`);
      used.add(spk);
    }
  }

  // DETAILS accordion — gated ENTIRELY on a non-empty description. Empty synopsis
  // ⇒ no Details button and no panel (never a placeholder). Non-empty ⇒ button +
  // panel with the description (and multi-speaker details). The panel toggles via
  // the `hidden` attribute (see accordion JS + the [hidden] CSS rule).
  const panel = $n.find('[data-acc-panel],[role="region"]').toArray()[0] || $n.find('[hidden]').toArray()[0];
  const trig = $n.find('[data-acc-trigger]').toArray()[0];
  const uid = `agenda-panel-{{ loop.parent.loop.index0 }}-{{ loop.index0 }}`;
  const gate = `{% if ${V}.agenda_description is not empty %}`;
  if (panel) {
    const spkTwig = `{% if ${V}.speakers is defined and ${V}.speakers|length > 1 %}{% for s in ${V}.speakers %}<p class="et-conference-agenda__text-7">{{ s.speaker_name }}{% if s.speaker_desig is not empty %} — {{ s.speaker_desig }}{% endif %}{% if s.speaker_company is not empty %}, {{ s.speaker_company }}{% endif %}</p>{% endfor %}{% endif %}`;
    $$(panel).empty().append(twMarker(ctr, repl, `{{ ${V}.agenda_description|raw }}${spkTwig}`));
    $$(panel).attr('id', uid).attr('data-acc-panel', '1').attr('data-state', 'closed').attr('hidden', 'hidden');
    twWrap($$, panel, ctr, repl, gate, '{% endif %}'); // no panel when description empty
    used.add(panel);
  }
  if (trig) {
    $$(trig).attr('data-acc-trigger', '1').attr('aria-controls', uid).attr('aria-expanded', 'false').attr('data-state', 'closed');
    twWrap($$, trig, ctr, repl, gate, '{% endif %}'); // no Details button when description empty (Bookmark stays)
  }
  // drop remaining per-session lines with no backend field (track/location) so
  // they don't repeat as static text on every rendered session.
  $n.find('p').toArray().forEach((p) => { if (!used.has(p) && txt($$, p).replace(/\s+/g, '').length > 0) $$(p).remove(); });
}

// Agenda with day/track TAB controls (scenario #2): build BOTH the tab strip and
// one panel per group from extractedData — tabs show {{ group.group_name }}, each
// panel loops its group's sessions, and panels after the first are hidden. Returns
// true if it handled a tabbed agenda.
function buildAgendaTabs($$, $root, F, repl, ctr, manifest) {
  const V = F.itemvar;
  const tabBtns = $root.find('[data-tab],[role="tab"]').toArray();
  const panels = $root.find('[data-tab-panel],[role="tabpanel"]').toArray();
  if (tabBtns.length < 1) return false;

  // No per-day PANELS in the DOM (e.g. role=tab buttons with client-side day
  // filtering over one list): make the tab LABELS dynamic — killing demo dates
  // like "01 Dec" — and loop all sessions in the single list. Tabs are cosmetic
  // here (the design has no separate panels to switch) but the data is dynamic.
  if (!panels.length) {
    const tb0 = tabBtns[0];
    if ($$(tb0).attr('data-tab') != null) $$(tb0).attr('data-tab', '{{ loop.index0 }}');
    $$(tb0).empty().text('{{ group.group_name }}');
    $$(tb0).before(twMarker(ctr, repl, '{% if extractedData is not empty %}{% for group in extractedData %}'));
    $$(tb0).after(twMarker(ctr, repl, '{% endfor %}{% endif %}'));
    for (let i = 1; i < tabBtns.length; i++) $$(tabBtns[i]).remove();
    const items = twPickUniform($$, $root, true, 'agenda') || twPickUniform($$, $root, false, 'agenda');
    if (!items || !items.length) return false;
    const si = items[0];
    fillAgendaSession($$, si, V, ctr, repl);
    $$(si).before(twMarker(ctr, repl, `{% if extractedData is not empty %}{% for group in extractedData %}{% for ${V} in group.child %}`));
    $$(si).after(twMarker(ctr, repl, '{% endfor %}{% endfor %}{% endif %}'));
    for (let i = 1; i < items.length; i++) $$(items[i]).remove();
    const clsL = (n, d) => '.' + ((($$(n).attr('class') || '').split(/\s+/).filter(Boolean))[0] || d);
    manifest.dynamic_container_selector = clsL($$(si).parent()[0], 'et-agenda__list');
    manifest.item_selector = clsL(si, 'et-agenda__item');
    manifest.structure = 'grouped_list';
    return true;
  }

  // Wrap the tab strip + all panels in ONE dynamic container so the whole region
  // is a single target for the tab JS / a future Microsite re-render, and panels
  // stay as siblings of the tab strip (the tab JS finds them via nextElementSibling).
  const tabStrip = $root.find('[data-tabs],[role="tablist"]').toArray()[0] || $$(tabBtns[0]).parent()[0];
  if (tabStrip) {
    const $wrap = $$('<div class="et-conference-agenda__dynamic"></div>');
    $$(tabStrip).before($wrap);
    $wrap.append(tabStrip);
    panels.forEach((p) => $wrap.append(p));
  }

  // TAB STRIP → one looped button; keep sibling filter chips static.
  const t0 = tabBtns[0];
  const baseCls = (($$(t0).attr('class') || '').split(/\s+/).filter(Boolean))[0] || '';
  const altCls = tabBtns[1] ? ((($$(tabBtns[1]).attr('class') || '').split(/\s+/).filter(Boolean))[0] || baseCls) : baseCls;
  if (baseCls) $$(t0).attr('class', `{% if loop.first %}${baseCls}{% else %}${altCls}{% endif %}`);
  if ($$(t0).attr('data-tab') != null) $$(t0).attr('data-tab', '{{ loop.index0 }}');
  $$(t0).empty().text('{{ group.group_name }}');
  $$(t0).before(twMarker(ctr, repl, '{% if extractedData is not empty %}{% for group in extractedData %}'));
  $$(t0).after(twMarker(ctr, repl, '{% endfor %}{% endif %}'));
  for (let i = 1; i < tabBtns.length; i++) $$(tabBtns[i]).remove();

  // PANELS → one looped panel; each loops its group's sessions; hide non-first.
  const p0 = panels[0], $p0 = $$(p0);
  const sess = $p0.children().toArray().filter((n) => n.tagName || n.name);
  if (!sess.length) return false;
  const s0 = sess[0];
  fillAgendaSession($$, s0, V, ctr, repl);
  $$(s0).before(twMarker(ctr, repl, `{% for ${V} in group.child %}`));
  $$(s0).after(twMarker(ctr, repl, '{% endfor %}'));
  for (let i = 1; i < sess.length; i++) $$(sess[i]).remove();
  if ($p0.attr('data-tab-panel') != null) $p0.attr('data-tab-panel', '{{ loop.index0 }}');
  const condAttr = `etcond${ctr.n++}`;
  $p0.attr(condAttr, '1');
  repl.push([`${condAttr}="1"`, '{% if not loop.first %}hidden="hidden"{% endif %}']);
  $p0.before(twMarker(ctr, repl, '{% if extractedData is not empty %}{% for group in extractedData %}'));
  $p0.after(twMarker(ctr, repl, '{% endfor %}{% endif %}'));
  for (let i = 1; i < panels.length; i++) $$(panels[i]).remove();

  const cls = (n, d) => '.' + ((($$(n).attr('class') || '').split(/\s+/).filter(Boolean))[0] || d);
  manifest.dynamic_container_selector = '.et-conference-agenda__dynamic';
  manifest.item_selector = cls(s0, 'et-conference-agenda__item');
  manifest.structure = 'grouped_list';
  return true;
}

function buildTwigTemplate($$, el, structured) {
  const module = structured && structured.bindable;
  if (!module || !FIELD[module]) return '';
  const F = FIELD[module];
  let $T;
  try { $T = cheerio.load($$.html(el), { decodeEntities: false }); } catch { return ''; }
  const $root = $T('body').children().first();
  if (!$root.length) return '';
  const repl = [];
  const ctr = { n: 0 };
  const IDX_FLAT = '{{ loop.index }}';
  const IDX_GROUP = '{{ loop.parent.loop.index }}-{{ loop.index }}'; // unique across groups
  const manifest = {};
  const clsSel = (n) => {
    if (!n) return '';
    const c = (($T(n).attr('class') || '').split(/\s+/).filter(Boolean))[0];
    if (c) return '.' + c;
    return (n.tagName || n.name || '').toLowerCase(); // fall back to tag when class-less
  };

  // Smart heading: the admin section title binds to the EYEBROW label (e.g.
  // "Featured speakers") when one sits above the hero h2 (Pattern A) — the hero
  // marketing copy stays static. If there's no eyebrow, the hero h2 itself is the
  // section-title slot (Pattern B). Never overwrite a hero headline with the
  // admin section name.
  const headingText = (structured.prose && structured.prose.heading) || '';
  const why = (r) => { if (process.env.TW_DEBUG) console.error(`[twig-gate] ${module} "${(headingText || '').slice(0, 40)}": ${r}`); return ''; };
  if (headingText) {
    const h = $root.find('h1,h2,h3,h4').toArray().find((n) => ($T(n).text() || '').replace(/\s+/g, ' ').trim() === headingText);
    if (h) {
      const eyebrow = findEyebrow($T, h);
      const et = eyebrow ? ($T(eyebrow).text() || '').replace(/\s+/g, ' ').trim() : '';
      if (eyebrow && et && et.length < headingText.length) {
        setSlotText($T, eyebrow, `{{ section_title|default('${escapeTwigStr(et)}') }}`); // Pattern A: bind eyebrow, hero stays static
      } else {
        setSlotText($T, h, `{{ section_title|default('${escapeTwigStr(headingText)}') }}`); // Pattern B: bind hero
      }
    }
  }

  if (!F.grouped) {
    // FLAT (speakers, faq)
    const items = twPickUniform($T, $root, false, module);
    if (!items || items.length < 2) return why('no uniform repeated items');
    if (!twFillItem($T, items[0], module, repl, ctr, [], IDX_FLAT)) return why('fillItem failed');
    manifest.dynamic_container_selector = clsSel($T(items[0]).parent()[0]);
    manifest.item_selector = clsSel(items[0]);
    // No {% else %}: the full original design is preserved in the static snapshot
    // (shown on Dynamic OFF). Empty data → empty loop; the section's heading/CTA
    // chrome outside the loop keeps it from ever being blank, and no mock item
    // data can be persisted as if it were real.
    twWrap($T, items[0], ctr, repl,
      `{% if extractedData is not empty %}{% for ${F.itemvar} in ${F.collection} %}`,
      `{% endfor %}{% endif %}`);
    for (let i = 1; i < items.length; i++) $T(items[i]).remove();
  } else {
    // GROUPED (sponsors, agenda, contact) — ALWAYS emit a template; the Lovable
    // placeholder (initials/LOGO/dummy) becomes the {% else %} fallback. NOTE:
    // an agenda with day/track TAB controls still emits, but the loop fills the
    // single captured panel — day-tab switching is a known cosmetic limitation
    // until buttons+panels are wired to one group loop.
    // agenda with day/track tabs (scenario #2): build tabs + per-group panels.
    if (module === 'agenda' && $root.find('[data-tab],[role="tab"]').length >= 2) {
      if (!buildAgendaTabs($T, $root, F, repl, ctr, manifest)) return why('agenda-tabs build failed');
      let out2 = $T('body').html() || '';
      for (const [tok, val] of repl) out2 = out2.split(tok).join(val);
      let html2; try { html2 = prettyHtml(out2.trim()); } catch { html2 = out2.trim(); }
      return { html: html2, manifest };
    }
    const units = findGroupUnits($T, $root, module, headingText);
    if (units && units.length >= 2 && twUniform($T, units)) {
      const u0 = units[0], $u0 = $T(u0);
      const gh = unitHeadingNode($T, $u0, module);
      if (gh) setSlotText($T, gh, '{{ group.group_name }}');
      manifest.dynamic_container_selector = clsSel($T(u0).parent()[0]);
      // inner items: sponsors → logo tiles (grid cells, ≥1). contact → always a
      // single card per group (name+email+phone is ONE contact, not repeats).
      // others → repeated marker blocks.
      const gitems = module === 'sponsors' ? twGridCells($T, $u0, gh) : (module === 'contact' ? null : twPickUniform($T, $u0, true));
      const useInner = gitems && (gitems.length >= 2 || (module === 'sponsors' && gitems.length >= 1));
      if (useInner) {
        if (!twFillItem($T, gitems[0], module, repl, ctr, gh ? [gh] : [], IDX_GROUP)) return why('grouped-inner fillItem failed');
        manifest.item_selector = clsSel(gitems[0]);
        twWrap($T, gitems[0], ctr, repl,
          `{% if group.child is not empty %}{% for ${F.itemvar} in group.child %}`, `{% endfor %}{% endif %}`);
        for (let i = 1; i < gitems.length; i++) $T(gitems[i]).remove();
      } else {
        // single card per group (e.g. a contact desk): unit body = one item
        if (!twFillItem($T, u0, module, repl, ctr, gh ? [gh] : [], IDX_GROUP)) return why('single-card group fillItem failed');
        manifest.item_selector = clsSel(u0);
        if (gh) $T(gh).after(twMarker(ctr, repl, `{% if group.child is not empty %}{% for ${F.itemvar} in group.child %}`));
        else $u0.prepend(twMarker(ctr, repl, `{% if group.child is not empty %}{% for ${F.itemvar} in group.child %}`));
        $u0.append(twMarker(ctr, repl, `{% endfor %}{% endif %}`));
      }
      // No {% else %} — see note above; empty data → empty container, chrome stays.
      twWrap($T, u0, ctr, repl,
        `{% if extractedData is not empty %}{% for group in extractedData %}`,
        `{% endfor %}{% endif %}`);
      for (let i = 1; i < units.length; i++) $T(units[i]).remove();
    } else {
      // single wrapping group: items live directly in the section, no group
      // headings — loop group then child around the item list.
      const items = twPickUniform($T, $root, true, module) || twPickUniform($T, $root, false, module);
      if (!items || !items.length) return why('single-group: no uniform items');
      if (!twFillItem($T, items[0], module, repl, ctr, [], IDX_GROUP)) return why('single-group: fillItem failed');
      manifest.dynamic_container_selector = clsSel($T(items[0]).parent()[0]);
      manifest.item_selector = clsSel(items[0]);
      twWrap($T, items[0], ctr, repl,
        `{% if extractedData is not empty %}{% for group in extractedData %}{% for ${F.itemvar} in group.child %}`,
        `{% endfor %}{% endfor %}{% endif %}`);
      for (let i = 1; i < items.length; i++) $T(items[i]).remove();
    }
  }

  let out = $T('body').html() || '';
  for (const [tok, val] of repl) out = out.split(tok).join(val);
  let html; try { html = prettyHtml(out.trim()); } catch { html = out.trim(); }
  return { html, manifest };
}

function buildCss(model, { sectionOrder, complexRules, tokenToNames, failedRuleIdx, skipRuleIdx, unresolvedTw, factored, reveal }) {
  const parts = [];
  const keepTw = unresolvedTw || new Set();
  parts.push(`/* styles.css — generated from the site's own compiled CSS */`);

  // Host root override (INTENTIONALLY global, not scoped): the ET platform sets
  // html{font-size:10px}, which shrinks every rem in this rem-based design to
  // 62.5%. Restore the 16px rem base with !important so the host can't win. This
  // is the one rule we deliberately let reach the host <html>.
  parts.push(`/* --- host root override: restore rem base --- */\nhtml { font-size: 100% !important; }`);

  // Accordion/tab panel visibility: the `hidden` attribute is the source of truth,
  // but the host page (Bootstrap etc.) may override [hidden]'s default display —
  // force it, scoped to our sections so it can't touch the host.
  parts.push(`/* --- dynamic panel visibility (override host [hidden]) --- */\n:where(.et-scope) [data-acc-panel][hidden], :where(.et-scope) [data-tab-panel][hidden] { display: none !important; }\n:where(.et-scope) [data-acc-panel]:not([hidden]) { display: block !important; }`);

  // Keep a declaration unless it's a flattened-away --tw-* var.
  const keepDecl = ([p]) => !p.startsWith('--tw-') || keepTw.has(p);
  const stripTw = (cssText) => splitDeclarations(cssText).filter(keepDecl);

  // preamble: @property (only ones still referenced), :root tokens, base layer, keyframes, @font-face
  const keptProps = eachAtProperty(model.atProperty).filter((b) => keepTw.has((/@property\s+(--[\w-]+)/.exec(b) || [])[1]));
  if (keptProps.length) parts.push(`/* --- Tailwind @property (only those still used) --- */\n${keptProps.join('\n')}`);
  // Variables block: emitted at this early position but its contents are
  // tree-shaken at the very end (only referenced vars + their deps survive) and
  // scoped to .et-scope so custom properties never leak to / collide with the host.
  const rootDecls = model.rootCss ? stripTw(model.rootCss) : [];
  let varsIdx = -1;
  if (rootDecls.length) varsIdx = parts.push('') - 1; // placeholder, filled below
  if (model.darkCss) {
    const d = stripTw(model.darkCss).map(([p, v]) => `  ${p}: ${v};`);
    if (d.length) parts.push(`${scopeSelector('.dark')} {\n${d.join('\n')}\n}`);
  }
  if (model.baseRules && model.baseRules.length) {
    const baseFlat = [], baseMedia = {};
    for (const r of model.baseRules) {
      if (/lovable-badge/i.test(r.selector)) continue;      // drop removed-badge CSS
      const decls = stripTw(r.css);                          // drop flattened --tw resets
      if (!decls.length) continue;
      const rule = `${scopeSelector(r.selector)} {\n${decls.map(([p, v]) => `  ${p}: ${v};`).join('\n')}\n}`;
      if (r.media) (baseMedia[r.media] || (baseMedia[r.media] = [])).push(rule); else baseFlat.push(rule);
    }
    let base = baseFlat.join('\n');
    for (const mq of Object.keys(baseMedia)) base += `\n@media ${mq} {\n` + baseMedia[mq].map((x) => x.replace(/^/gm, '  ')).join('\n') + `\n}`;
    if (base.trim()) parts.push(`/* ===== Reset & Base Typography ===== */\n${base}`);
  }
  // The hidden attribute must win even when a class sets display (accordions,
  // closed dialogs rely on this).
  parts.push(`/* --- hidden --- */\n${scopeSelector('[hidden]')} { display: none !important; }`);

  // Scroll-reveal (reconstructed from the discovered Behavior IR). Elements are
  // VISIBLE by default; script.js adds .et-in as each enters view, playing a
  // fade-up keyframe built from the ORIGINAL from-state + timing (per-element
  // overrides via --et-* vars). A missed trigger just leaves it visible — never
  // blank. Respects reduced-motion. Only emitted when reveals were discovered.
  if (reveal && reveal.count) {
    const D = reveal.defaults;
    parts.push(`/* ===== Motion (scroll reveal — reconstructed) ===== */
@media (prefers-reduced-motion: no-preference) {
  .et-reveal.et-in {
    animation: et-reveal var(--et-rd, ${D.d}) var(--et-re, ${D.e}) var(--et-rdelay, ${D.dl}) both;
  }
}
@keyframes et-reveal {
  from { opacity: var(--et-ro, ${D.o}); transform: translateY(var(--et-ry, ${D.ty}px)); }
  to { opacity: 1; transform: none; }
}`);
  }

  if (model.keyframes && model.keyframes.length) parts.push(`/* --- keyframes --- */\n${model.keyframes.join('\n')}`);
  if (model.fontFaces && model.fontFaces.length) parts.push(`/* --- @font-face --- */\n${model.fontFaces.join('\n')}`);

  // Route every class rule to a logical group by its semantic name: reusable
  // Utilities (et-flex-*, et-row, …), Components (et-button, et-card, et-title),
  // shared Layout, then per-section blocks (et-hero__*, et-pricing__*, …).
  const sectionKeySet = new Set(sectionOrder.map((s) => s.key));
  const groups = { utilities: [], components: [], layout: [] };
  const sectionRules = {};
  for (const name of factored.order) {
    const buckets = factored.emit.get(name);
    if (!buckets) continue;
    const rule = rulesForClass(name, buckets);
    if (!rule.trim()) continue;
    const c = classifyName(name, sectionKeySet);
    if (c.kind === 'section') (sectionRules[c.section] || (sectionRules[c.section] = [])).push(rule);
    else groups[c.kind].push(rule);
  }
  if (groups.utilities.length) parts.push(`/* ===== Utilities ===== */\n${groups.utilities.join('\n\n')}`);
  if (groups.layout.length) parts.push(`/* ===== Layout ===== */\n${groups.layout.join('\n\n')}`);
  if (groups.components.length) parts.push(`/* ===== Components ===== */\n${groups.components.join('\n\n')}`);
  const seen = new Set();
  const sectionCssMap = {};        // section key -> its own CSS rules (for the split output)
  const sectionPartSet = new Set(); // the exact part strings that are per-section (to derive globalCss)
  for (const { key, label } of sectionOrder) {
    if (seen.has(key)) continue; seen.add(key);
    if (sectionRules[key] && sectionRules[key].length) {
      const body = sectionRules[key].join('\n\n');
      sectionCssMap[key] = body;
      const part = `/* ===== Section: ${label} ===== */\n${body}`;
      sectionPartSet.add(part);
      parts.push(part);
    }
  }

  // Combinator/interaction rules (space-y, divide, group-hover, peer, data-state)
  // re-scoped onto the semantic classes — completes the gather so nothing drops.
  if (complexRules && complexRules.length) {
    const combo = emitCombinatorRules(complexRules, tokenToNames || new Map(), failedRuleIdx, skipRuleIdx);
    if (combo.css.trim()) parts.push(`/* ===== Spacing & interaction (combinators) ===== */\n${combo.css}`);
    console.log(`[build] combinator rules: ${combo.translated} translated, ${combo.verbatim} verbatim (zero-loss), ${(skipRuleIdx || new Set()).size} dead-skipped`);
  }

  // Accessibility: visible keyboard focus + honor reduced-motion (additive; does
  // not alter the default visual design).
  parts.push(`/* ===== Accessibility ===== */
${scopeSelector(':where(a, button, [role="button"], input, select, textarea, summary, [tabindex]):focus-visible')} {
  outline: 2px solid var(--ring, currentColor);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  ${scopeSelector('*, ::before, ::after')} {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}`);
  // Tree-shake :root — keep only variables referenced anywhere in the output
  // (plus their transitive deps), scoped to .et-scope. Drops the unused shadcn
  // token set (~24% of :root) with zero visual change.
  if (varsIdx >= 0) {
    const scan = parts.filter((_, i) => i !== varsIdx).join('\n');
    const used = new Set([...scan.matchAll(/var\((--[A-Za-z0-9_-]+)/g)].map((m) => m[1]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const [p, v] of rootDecls) {
        if (!used.has(p)) continue;
        for (const m of String(v).matchAll(/var\((--[A-Za-z0-9_-]+)/g)) {
          if (!used.has(m[1])) { used.add(m[1]); changed = true; }
        }
      }
    }
    const keep = rootDecls.filter(([p]) => used.has(p));
    // Expose ONE common body-font variable for the whole microsite (the font
    // shared by tags/elements), and apply it on the root with class specificity
    // so it's the single lever for typography.
    const bodyFontDecl = `  --body-font-family: var(--font-body, var(--default-font-family, ui-sans-serif, system-ui, sans-serif));`;
    parts[varsIdx] = keep.length
      ? `/* ===== Variables ===== */\n${ROOT} {\n${keep.map(([p, v]) => `  ${p}: ${v};`).join('\n')}\n${bodyFontDecl}\n}\n\n${ROOT} { font-family: var(--body-font-family); }`
      : `${ROOT} {\n${bodyFontDecl}\n}\n\n${ROOT} { font-family: var(--body-font-family); }`;
  }

  const full = parts.filter(Boolean).join('\n\n') + '\n';
  // globalCss = everything that is NOT a per-section block (Variables, Reset,
  // Motion, keyframes, @font-face, Utilities, Layout, Components, combinator
  // spacing/interaction, Accessibility). This is what goes into the platform's
  // "Global CSS and Javascript" field; each section's own rules go on its tab.
  const globalCss = parts.filter((p) => p && !sectionPartSet.has(p)).join('\n\n') + '\n';
  return { full, globalCss, sectionCss: sectionCssMap };
}

// Generic vanilla-JS interactivity, driven by the preserved aria/data
// Self-contained accordion+tab interactivity for a Custom Section's own JS field,
// so a dynamic section works even if the platform doesn't inject globalJs. Uses
// the SAME once-flags (__eta/__ett) as globalJs, so if both run each element binds
// exactly once. Toggles the `hidden` attribute (the visibility source of truth).
const SECTION_INTERACTION_JS = `(function(){function E(){
document.querySelectorAll('[data-acc-trigger]').forEach(function(b){if(b.__eta)return;b.__eta=1;b.addEventListener('click',function(){var p=null,a=b.getAttribute('aria-controls');if(a)p=document.getElementById(a);if(!p){var i=b.closest('li,[class*=item],[class*=agenda]');if(i)p=i.querySelector('[data-acc-panel]');}if(!p)return;var o=!p.hasAttribute('hidden');if(o){p.setAttribute('hidden','hidden');p.setAttribute('data-state','closed');}else{p.removeAttribute('hidden');p.setAttribute('data-state','open');}b.setAttribute('aria-expanded',o?'false':'true');b.setAttribute('data-state',o?'closed':'open');});});
document.querySelectorAll('[data-tabs],[role=tablist]').forEach(function(s){if(s.__ett)return;s.__ett=1;var ts=[].slice.call(s.querySelectorAll('[data-tab],[role=tab]'));if(!ts.length)return;function P(){var o=[],n=s.nextElementSibling;while(n){if(n.hasAttribute&&(n.hasAttribute('data-tab-panel')||n.getAttribute('role')==='tabpanel'))o.push(n);n=n.nextElementSibling;}return o;}function A(t){var idx=t.getAttribute('data-tab');P().forEach(function(p){var on=idx!=null&&p.getAttribute('data-tab-panel')===idx;if(on){p.removeAttribute('hidden');}else{p.setAttribute('hidden','hidden');}});ts.forEach(function(x){var on=x===t;x.setAttribute('aria-selected',on?'true':'false');x.setAttribute('data-state',on?'active':'inactive');});}ts.forEach(function(t){t.addEventListener('click',function(){A(t);});});A(ts[0]);});
}if(document.readyState!=='loading')E();else document.addEventListener('DOMContentLoaded',E);})();`;

// attributes. Same logic for any Lovable site (accordion, tabs, menu, scroll).
function buildScript(reveal) {
  return `// script.js — reconstructed interactivity (generated)
(function () {
  'use strict';

  // Smooth-scroll for in-page anchor links.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (!id) return;
    var t = document.getElementById(id) || document.querySelector('[name="' + CSS.escape(id) + '"]');
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  function panelFor(trigger) {
    var id = trigger.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  }

  // Accordions / collapsibles / mobile menus: any trigger with aria-expanded.
  document.querySelectorAll('[aria-expanded]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      btn.setAttribute('data-state', open ? 'closed' : 'open');
      var panel = panelFor(btn);
      if (panel) {
        if (open) { panel.hidden = true; panel.setAttribute('data-state', 'closed'); }
        else { panel.hidden = false; panel.removeAttribute('hidden'); panel.setAttribute('data-state', 'open'); }
      }
    });
  });

  // Custom accordions (data-acc-trigger → its [data-acc-panel]). The panel may not
  // be a direct sibling (e.g. an agenda session where the trigger is nested in a
  // row and the panel is a sibling of that row), so resolve it by, in order:
  // aria-controls id → nearest enclosing item → following sibling.
  document.querySelectorAll('[data-acc-trigger]').forEach(function (btn) {
    if (btn.__eta) return; btn.__eta = 1; // once-flag: never bind twice (section js + globalJs share it)
    btn.addEventListener('click', function () {
      var panel = null;
      var ac = btn.getAttribute('aria-controls');
      if (ac) panel = document.getElementById(ac);
      if (!panel) { var p = btn.nextElementSibling; while (p && !p.hasAttribute('data-acc-panel')) p = p.nextElementSibling; panel = p; }
      if (!panel) { var item = btn.closest('li,[class*="item"],[class*="agenda"]') || btn.parentElement; if (item) panel = item.querySelector('[data-acc-panel]'); }
      if (!panel) return;
      var open = !panel.hasAttribute('hidden'); // hidden attribute is the source of truth
      if (open) { panel.setAttribute('hidden', 'hidden'); panel.setAttribute('data-state', 'closed'); }
      else { panel.removeAttribute('hidden'); panel.setAttribute('data-state', 'open'); }
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      btn.setAttribute('data-state', open ? 'closed' : 'open');
    });
  });

  // Active/selected STATE styling. Lovable renders a selected control with a
  // conditional className (active variant vs inactive variant). The static
  // capture freezes one snapshot: within a sibling group the active control has
  // the MINORITY class and the rest share the inactive class. etVariant() derives
  // the two variants by frequency; etSetActive() swaps ONLY the differing tokens
  // (shared tokens like "group" are preserved), so the active look follows the
  // click instead of being frozen on the captured tab. Returns null when no
  // distinct variant was captured (styling is attribute-based) — then we just
  // toggle data-state/aria-selected and let the CSS handle it.
  function etVariant(items) {
    var freq = {};
    items.forEach(function (el) { var c = (el.getAttribute('class') || '').trim(); freq[c] = (freq[c] || 0) + 1; });
    var keys = Object.keys(freq);
    if (keys.length < 2) return null;
    keys.sort(function (a, b) { return freq[a] - freq[b]; }); // fewest first = active variant
    // NOTE: split on ' ' (not /\\s+/) — this string is emitted via a template
    // literal where a single-backslash \\s would be stripped to a literal "s".
    var a = keys[0].split(' ').filter(Boolean), i = keys[keys.length - 1].split(' ').filter(Boolean);
    var aSet = {}, iSet = {};
    a.forEach(function (t) { aSet[t] = 1; }); i.forEach(function (t) { iSet[t] = 1; });
    return {
      add: a.filter(function (t) { return t && !iSet[t]; }),   // tokens present only when active
      rem: i.filter(function (t) { return t && !aSet[t]; }),   // tokens present only when inactive
      activeClass: keys[0],
    };
  }
  function etSetActive(el, on, v) {
    if (!v) return;
    var set = {};
    (el.getAttribute('class') || '').split(' ').forEach(function (t) { if (t) set[t] = 1; });
    if (on) { v.rem.forEach(function (t) { delete set[t]; }); v.add.forEach(function (t) { set[t] = 1; }); }
    else { v.add.forEach(function (t) { delete set[t]; }); v.rem.forEach(function (t) { set[t] = 1; }); }
    el.setAttribute('class', Object.keys(set).join(' '));
  }

  // Tabs: role=tablist / role=tab / aria-controls -> role=tabpanel.
  document.querySelectorAll('[role="tablist"]').forEach(function (list) {
    if (list.__ett) return; list.__ett = 1;
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;
    var v = etVariant(tabs);
    function activate(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.setAttribute('data-state', on ? 'active' : 'inactive');
        etSetActive(t, on, v);
        var p = panelFor(t); if (p) { p.hidden = !on; if (on) p.removeAttribute('hidden'); p.setAttribute('data-state', on ? 'active' : 'inactive'); }
      });
    }
    tabs.forEach(function (tab) { tab.addEventListener('click', function () { activate(tab); }); });
    var init = (v && tabs.filter(function (t) { return (t.getAttribute('class') || '').trim() === v.activeClass; })[0])
      || tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0];
    activate(init); // normalize so the styled-active tab and shown panel agree
  });

  // Tabs: captured tab groups swap their stashed [data-tab-panel] siblings.
  document.querySelectorAll('[data-tabs]').forEach(function (group) {
    if (group.__ett) return; group.__ett = 1;
    var tabs = Array.prototype.slice.call(group.querySelectorAll('[data-tab]'));
    if (!tabs.length) return;
    function panels() { var out = [], n = group.nextElementSibling; while (n) { if (n.hasAttribute('data-tab-panel')) out.push(n); n = n.nextElementSibling; } return out; }
    var ps = panels();
    var v = etVariant(tabs);
    function activate(tab) {
      var idx = tab.getAttribute('data-tab');
      ps.forEach(function (p) { var on = p.getAttribute('data-tab-panel') === idx; p.hidden = !on; if (on) p.removeAttribute('hidden'); });
      tabs.forEach(function (x) { var on = x === tab; x.setAttribute('data-state', on ? 'active' : 'inactive'); etSetActive(x, on, v); });
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { activate(t); }); });
    var init = (v && tabs.filter(function (t) { return (t.getAttribute('class') || '').trim() === v.activeClass; })[0]) || tabs[0];
    activate(init); // normalize the captured snapshot to a consistent active tab
  });

  // Consent/cookie banners: any button inside a tagged banner dismisses it.
  document.querySelectorAll('[data-dismiss-banner]').forEach(function (banner) {
    banner.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('button, a[role="button"], [data-close]')) { banner.setAttribute('hidden', ''); }
    });
  });

  // Scroll-driven animations (reveal / count-up / svg-draw), reconstructed from
  // the Behavior IR. One shared factory + a single reduced-motion / IO-support
  // guard replaces three near-duplicate observer blocks. Each animation keeps
  // its OWN trigger geometry (rootMargin), so timing is byte-identical to the
  // per-block version. A missed or disabled trigger leaves the element in its
  // final, visible state — never blank.
  var MOTION_OK = ('IntersectionObserver' in window)
    && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function observeOnce(sel, opts, onEnter) {
    if (!MOTION_OK) return;
    var els = Array.prototype.slice.call(document.querySelectorAll(sel));
    if (!els.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target); // once
        onEnter(e.target, e);
      });
    }, opts);
    els.forEach(function (el) { io.observe(el); });
  }

  // Reveal: add .et-in (plays the fade-up keyframe from the original
  // from-state/timing) as each enters from below. Elements already high in view
  // when observed are left visible without a flash.
  observeOnce('.et-reveal', { rootMargin: '0px 0px 20% 0px', threshold: 0 }, function (el, e) {
    if (e.boundingClientRect.top > window.innerHeight * 0.5) el.classList.add('et-in');
  });

  // Count-up: final value shown by default; on scroll-in animate 0 -> final once.
  observeOnce('.et-count', { rootMargin: '0px 0px -10% 0px', threshold: 0 }, function (el) {
    var finalStr = (el.getAttribute('data-et-count') || el.textContent || '').trim();
    var numMatch = finalStr.match(/[0-9.,]+/); if (!numMatch) return; // [0-9] not \\d (template-literal strips the backslash)
    var numStr = numMatch[0], idx = finalStr.indexOf(numStr);
    var prefix = finalStr.slice(0, idx), suffix = finalStr.slice(idx + numStr.length);
    var target = parseFloat(numStr.replace(/,/g, '')); if (isNaN(target)) return;
    var decimals = (numStr.split('.')[1] || '').length;
    var t0 = null, dur = 1200;
    function fmt(v) { return prefix + (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString()) + suffix; }
    function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur); el.textContent = fmt(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); else el.textContent = finalStr; }
    requestAnimationFrame(step);
  });

  // SVG draw (line charts / donut rings): rests DRAWN; on scroll-in replay
  // stroke-dashoffset from full (undrawn) to the drawn value once.
  observeOnce('[data-et-draw]', { rootMargin: '0px 0px -5% 0px', threshold: 0 }, function (el) {
    var p = (el.getAttribute('data-et-draw') || '').split('|'); // dasharray|dur|delay|easing
    var init = p[0], dur = p[1] || '1200ms', dl = p[2] || '0s', ez = p[3] || 'ease';
    var fin = (el.style.strokeDashoffset || getComputedStyle(el).strokeDashoffset || '0');
    el.style.transition = 'none'; el.style.strokeDashoffset = init; el.getBoundingClientRect();
    el.style.transition = 'stroke-dashoffset ' + dur + ' ' + ez + ' ' + dl; el.style.strokeDashoffset = fin;
  });

  // Dismissable overlays: modals/dialogs AND cookie/consent banners.
  function hideEl(el) { if (el) { el.setAttribute('hidden', ''); el.setAttribute('data-state', 'closed'); } }
  function closeDialogs() {
    document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal, [data-state="open"][class*="dialog" i]').forEach(hideEl);
    document.querySelectorAll('[data-overlay], [class*="overlay" i], [class*="backdrop" i]').forEach(hideEl);
  }
  // Find the dismissable container (banner/modal/overlay) an element sits in.
  function overlayContainer(el) {
    var n = el;
    while (n && n !== document.body) {
      var cs = getComputedStyle(n);
      if ((cs.position === 'fixed' || cs.position === 'sticky')
        && (n.getAttribute('role') === 'dialog' || /cookie|consent|banner|modal|dialog|overlay|toast|popup/i.test(n.className || ''))) return n;
      n = n.parentElement;
    }
    // fall back to the nearest fixed ancestor
    n = el;
    while (n && n !== document.body) { if (getComputedStyle(n).position === 'fixed') return n; n = n.parentElement; }
    return null;
  }
  document.addEventListener('click', function (e) {
    var el = e.target;
    // explicit close controls
    var closeBtn = el.closest && el.closest('[aria-label="Close" i], [aria-label="close" i], [data-close], button[class*="close" i]');
    if (closeBtn) { var c = overlayContainer(closeBtn); if (c) hideEl(c); else closeDialogs(); return; }
    // cookie/consent buttons (Accept / Decline / Got it / Agree / Reject / OK)
    var btn = el.closest && el.closest('button, a[role="button"]');
    if (btn && /^(accept|decline|reject|agree|got it|allow|dismiss|ok(ay)?|i understand|continue)(?![a-z])/i.test((btn.textContent || '').trim())) {
      var cont = overlayContainer(btn); if (cont) hideEl(cont); return;
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDialogs(); });
})();
`;
}

module.exports = { build };
