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

// --- per-element style resolution --------------------------------------------
// classList -> { ctxKey: orderedMap(prop->val) }, merging in stylesheet order.
function resolveElementStyle(classList, classRules) {
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
function declBlock(map, indent = '  ') {
  return [...map.entries()].map(([p, v]) => `${indent}${p}: ${v};`).join('\n');
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
  const complexRules = model.complexRules || [];
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
  const nameSections = new Map(); // name -> Set(sectionName)
  const tokenToNames = new Map(); // original token -> Set(semantic name) — for combinator translation

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
      const svgBuckets = resolveElementStyle(svgClassList, classRules);
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
      $c.removeAttr('class');
      if (svgCls) $c.attr('class', svgCls);
      return $.html($c);
    }

    const classList = classListOf($el);
    const buckets = resolveElementStyle(classList, classRules);
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
    const inlineStyle = ($el.attr('style') || '').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
    const dataFrom = ($el.attr('data-from') || '').replace(/"/g, "'").trim();
    const isReveal = !!dataFrom;

    const children = $el.contents().toArray();
    const inner = children.map((c) => walk(c, section)).filter(Boolean).join('');

    // drop unstyled wrapper divs/spans with a single child, no direct text, no
    // inline styling (keeping ones that carry inline styles or animation state)
    if ((tag === 'div' || tag === 'span') && !cls && !inlineStyle && !dataFrom) {
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
    const fullCls = [cls, ...markers].filter(Boolean).join(' ');
    const clsAttr = fullCls ? ` class="${fullCls}"` : '';
    const keep = [];
    if (isReveal) { keep.push(' data-reveal'); keep.push(` data-from="${dataFrom}"`); }
    if (inlineStyle) keep.push(` style="${inlineStyle}"`);
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
  const usedNames = new Set();
  sectionEls.forEach((el, i) => {
    const name = detectSectionName(el, $, i, sectionEls.length);
    const label = name.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    sectionOrder.push({ key: name, label });
    const $el = $(el);
    const secClassList = classListOf($el);
    const buckets = resolveElementStyle(secClassList, classRules);
    const comboTokens = comboTokensOf(secClassList);
    const cls = (isEmptyBuckets(buckets) && !comboTokens.length) ? null : classFor(el, buckets, name, secClassList);
    if (cls && !usedNameOrder.includes(cls)) usedNameOrder.push(cls);
    const inner = $el.contents().toArray().map((c) => walk(c, name)).filter(Boolean).join('');
    const tag = el.tagName.toLowerCase();
    let semTag = 'section';
    if (name === 'header') semTag = 'header';
    else if (name === 'footer') semTag = 'footer';
    const sectionCls = `section-${name}` + (cls ? ' ' + cls : '');
    bodyBlocks.push(`  <!-- Section: ${label} -->\n  <${semTag} class="${sectionCls}">\n${indent(inner, 4)}\n  </${semTag}>`);
  });

  const css = buildCss(model, { nameToBuckets, nameSections, sectionOrder, usedNameOrder, complexRules, tokenToNames, failedRuleIdx, skipRuleIdx });
  const html = buildHtml(model, bodyBlocks.join('\n\n'));
  const js = buildScript();
  const summary = [...new Set(sectionOrder.map((s) => s.label))].join(', ');
  return { html, css, js, sectionsSummary: summary, sections: sectionOrder };
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
    const body = splitDeclarations(r.css).map(([p, v]) => `  ${p}: ${v};`).join('\n');
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

function buildCss(model, { nameToBuckets, nameSections, sectionOrder, usedNameOrder, complexRules, tokenToNames, failedRuleIdx, skipRuleIdx }) {
  const parts = [];
  parts.push(`/* styles.css — generated from the site's own compiled CSS */`);

  // preamble: @property (--tw machinery), :root tokens, base layer, keyframes, @font-face
  if (model.atProperty && model.atProperty.length) parts.push(`/* --- Tailwind @property registrations --- */\n${model.atProperty.join('\n')}`);
  if (model.rootCss) parts.push(`/* --- design tokens --- */\n:root {\n${model.rootCss.split(';').map((d) => d.trim()).filter(Boolean).map((d) => '  ' + d + ';').join('\n')}\n}`);
  if (model.darkCss) parts.push(`.dark {\n${model.darkCss.split(';').map((d) => d.trim()).filter(Boolean).map((d) => '  ' + d + ';').join('\n')}\n}`);
  if (model.baseRules && model.baseRules.length) {
    const baseFlat = [], baseMedia = {};
    for (const r of model.baseRules) {
      const rule = `${r.selector} {\n${splitDeclarations(r.css).map(([p, v]) => `  ${p}: ${v};`).join('\n')}\n}`;
      if (r.media) (baseMedia[r.media] || (baseMedia[r.media] = [])).push(rule); else baseFlat.push(rule);
    }
    let base = baseFlat.join('\n');
    for (const mq of Object.keys(baseMedia)) base += `\n@media ${mq} {\n` + baseMedia[mq].map((x) => x.replace(/^/gm, '  ')).join('\n') + `\n}`;
    parts.push(`/* --- base / reset --- */\n${base}`);
  }
  // The hidden attribute must win even when a class sets display (accordions,
  // closed dialogs rely on this).
  parts.push(`/* --- hidden --- */\n[hidden] { display: none !important; }`);

  // Scroll-reveal: elements render at their FINAL state by default (visible,
  // correct); script.js applies the data-from start state and animates to final
  // on scroll. Only a perf hint is needed here.
  parts.push(`/* --- scroll reveal --- */\n[data-reveal] { will-change: opacity, transform; }`);

  if (model.keyframes && model.keyframes.length) parts.push(`/* --- keyframes --- */\n${model.keyframes.join('\n')}`);
  if (model.fontFaces && model.fontFaces.length) parts.push(`/* --- @font-face --- */\n${model.fontFaces.join('\n')}`);

  // classify each generated class: shared (used in >1 section) vs section-local
  const common = [], bySection = {};
  for (const name of usedNameOrder) {
    const buckets = nameToBuckets.get(name);
    if (!buckets) continue;
    const rule = rulesForClass(name, buckets);
    if (!rule.trim()) continue;
    const sections = nameSections.get(name) || new Set();
    if (sections.size > 1) common.push(rule);
    else { const s = [...sections][0] || 'misc'; (bySection[s] || (bySection[s] = [])).push(rule); }
  }
  if (common.length) parts.push(`/* ===== Common / shared ===== */\n${common.join('\n\n')}`);
  const seen = new Set();
  for (const { key, label } of sectionOrder) {
    if (seen.has(key)) continue; seen.add(key);
    if (bySection[key] && bySection[key].length) parts.push(`/* ===== Section: ${label} ===== */\n${bySection[key].join('\n\n')}`);
  }

  // Combinator/interaction rules (space-y, divide, group-hover, peer, data-state)
  // re-scoped onto the semantic classes — completes the gather so nothing drops.
  if (complexRules && complexRules.length) {
    const combo = emitCombinatorRules(complexRules, tokenToNames || new Map(), failedRuleIdx, skipRuleIdx);
    if (combo.css.trim()) parts.push(`/* ===== Spacing & interaction (combinators) ===== */\n${combo.css}`);
    console.log(`[build] combinator rules: ${combo.translated} translated, ${combo.verbatim} verbatim (zero-loss), ${(skipRuleIdx || new Set()).size} dead-skipped`);
  }
  return parts.join('\n\n') + '\n';
}

// Generic vanilla-JS interactivity, driven by the preserved aria/data
// attributes. Same logic for any Lovable site (accordion, tabs, menu, scroll).
function buildScript() {
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

  // Custom accordions captured with stashed panels (data-acc-trigger + the
  // following [data-acc-panel] sibling), for sites with no aria attributes.
  document.querySelectorAll('[data-acc-trigger]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var panel = btn.nextElementSibling;
      while (panel && !panel.hasAttribute('data-acc-panel')) panel = panel.nextElementSibling;
      if (!panel) return;
      var open = !panel.hidden;
      panel.hidden = open;
      btn.setAttribute('data-state', open ? 'closed' : 'open');
    });
  });

  // Tabs: role=tablist / role=tab / aria-controls -> role=tabpanel.
  document.querySelectorAll('[role="tablist"]').forEach(function (list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) {
          t.setAttribute('aria-selected', 'false');
          t.setAttribute('data-state', 'inactive');
          var p = panelFor(t); if (p) { p.hidden = true; p.setAttribute('data-state', 'inactive'); }
        });
        tab.setAttribute('aria-selected', 'true');
        tab.setAttribute('data-state', 'active');
        var panel = panelFor(tab); if (panel) { panel.hidden = false; panel.removeAttribute('hidden'); panel.setAttribute('data-state', 'active'); }
      });
    });
  });

  // Tabs: captured tab groups swap their stashed [data-tab-panel] siblings.
  document.querySelectorAll('[data-tabs]').forEach(function (group) {
    var tabs = Array.prototype.slice.call(group.querySelectorAll('[data-tab]'));
    function panels() { var out = [], n = group.nextElementSibling; while (n) { if (n.hasAttribute('data-tab-panel')) out.push(n); n = n.nextElementSibling; } return out; }
    var ps = panels();
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var idx = t.getAttribute('data-tab');
        ps.forEach(function (p) { var m = p.getAttribute('data-tab-panel') === idx; if (m) { p.hidden = false; p.removeAttribute('hidden'); } else { p.hidden = true; } });
        tabs.forEach(function (x) { x.setAttribute('data-state', x === t ? 'active' : 'inactive'); });
      });
    });
  });

  // Consent/cookie banners: any button inside a tagged banner dismisses it.
  document.querySelectorAll('[data-dismiss-banner]').forEach(function (banner) {
    banner.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('button, a[role="button"], [data-close]')) { banner.setAttribute('hidden', ''); }
    });
  });

  // Scroll-reveal: replay each element's captured animation from its data-from
  // state to its final (opacity/slide/scale reveals, progress-bar widths, chart
  // dots) as it enters the viewport. Elements render at FINAL without JS.
  (function () {
    var els = Array.prototype.slice.call(document.querySelectorAll('[data-from]'));
    if (!els.length) return;
    function parse(s) {
      var o = {};
      (s || '').split(';').forEach(function (d) { var i = d.indexOf(':'); if (i > 0) o[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
      return o;
    }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) return; // leave at final
    els.forEach(function (el) {
      el.__from = parse(el.getAttribute('data-from')); // opacity/transform start state
      el.style.transition = 'none';
      Object.keys(el.__from).forEach(function (p) { el.style.setProperty(p, el.__from[p]); });
    });
    void document.body.offsetWidth; // flush start state before observing
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        el.style.transition = 'opacity .7s cubic-bezier(.16,1,.3,1), transform .7s cubic-bezier(.16,1,.3,1)';
        Object.keys(el.__from).forEach(function (p) { el.style.removeProperty(p); }); // -> natural (opacity 1 / transform none)
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    els.forEach(function (el) { io.observe(el); });
  })();

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
    if (btn && /^(accept|decline|reject|agree|got it|allow|dismiss|ok(ay)?|i understand|continue)\b/i.test((btn.textContent || '').trim())) {
      var cont = overlayContainer(btn); if (cont) hideEl(cont); return;
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDialogs(); });
})();
`;
}

module.exports = { build };
