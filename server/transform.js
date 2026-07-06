// transform.js
// Takes rendered HTML (Tailwind in the markup) and produces:
//   - clean semantic HTML using a small set of reusable global classes
//   - a single global stylesheet (tokens + base + components + responsive)
//
// The strategy: walk the DOM, translate each element's Tailwind classes into a
// CSS declaration set, then DEDUPE — elements with the same declarations share
// one generated class. That is what keeps the output "reusable classes", not
// "one class per element".

const cheerio = require('cheerio');
const { resolveUtility } = require('./tailwind-map');

const RESPONSIVE_PREFIXES = { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' };
const STATE_PREFIXES = ['hover', 'focus', 'active', 'group-hover', 'focus-visible', 'disabled'];

// Split a Tailwind class into { prefix, state, utility }.
function parseClass(cls) {
  const parts = cls.split(':');
  const utility = parts.pop();
  let prefix = null, state = null;
  for (const p of parts) {
    if (RESPONSIVE_PREFIXES[p]) prefix = p;
    else if (STATE_PREFIXES.includes(p)) state = p;
  }
  return { prefix, state, utility };
}

// Turn a className string into declaration buckets by breakpoint/state.
function classesToBuckets(className) {
  const buckets = { base: {}, sm: {}, md: {}, lg: {}, xl: {}, '2xl': {}, hover: {}, focus: {} };
  const classes = (className || '').split(/\s+/).filter(Boolean);
  for (const cls of classes) {
    const { prefix, state, utility } = parseClass(cls);
    const decls = resolveUtility(utility);
    if (!decls) continue;
    let target = 'base';
    if (state === 'hover') target = 'hover';
    else if (state === 'focus' || state === 'focus-visible') target = 'focus';
    else if (prefix) target = prefix;
    Object.assign(buckets[target], decls);
  }
  return buckets;
}

function isEmptyBuckets(b) {
  return Object.values(b).every((o) => Object.keys(o).length === 0);
}

// Stable signature so identical styling collapses to one class.
function signature(buckets) {
  const norm = {};
  for (const [k, v] of Object.entries(buckets)) {
    if (Object.keys(v).length === 0) continue;
    norm[k] = Object.keys(v).sort().map((p) => `${p}:${v[p]}`).join(';');
  }
  return JSON.stringify(norm, Object.keys(norm).sort());
}

// Pick a readable base name for a generated class from the element itself.
function baseName(el, buckets, $) {
  const tag = el.tagName ? el.tagName.toLowerCase() : 'el';
  const base = buckets.base || {};
  const has = (p, v) => base[p] && (v ? String(base[p]).includes(v) : true);

  if (tag === 'button' || (tag === 'a' && has('background-color') && has('border-radius'))) return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'nav') return 'navbar';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input';
  if (tag === 'ul' || tag === 'ol') return 'list';
  if (tag === 'img') return 'media';
  if (has('display', 'grid')) return 'grid';
  if (has('display', 'flex')) {
    if (has('justify-content', 'space-between')) return 'flex-between';
    if (has('align-items', 'center') && has('justify-content', 'center')) return 'flex-center';
    return 'flex-row';
  }
  if ((has('box-shadow') || has('border-width')) && has('border-radius') && has('padding')) return 'card';
  if (/^h[1-6]$/.test(tag)) return `heading-${tag[1]}`;
  if (tag === 'p') return 'text';
  if (has('max-width') && (has('margin-left', 'auto') || base.margin === 'auto')) return 'container';
  if (tag === 'section' || tag === 'header' || tag === 'footer') return 'block';
  return 'box';
}

// --- section detection -------------------------------------------------------
// Turn arbitrary label text into a safe, short class slug.
function slug(text) {
  return (text || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-').slice(0, 5).join('-')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

// The "eyebrow" kicker most Lovable sections have above the heading — a short
// bit of leaf text like "The Curriculum" or "Investment". Best source of a
// human-meaningful section label.
function eyebrowLabel($el, $) {
  const leaves = $el.find('span, p, div, small, strong, em, h2, h3').toArray();
  for (const e of leaves) {
    const $e = $(e);
    if ($e.children().length) continue; // leaf text only
    const t = $e.text().replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const words = t.split(' ');
    if (t.length <= 34 && words.length <= 5 && /[a-z]/i.test(t) && !/^[\d₹$€£]/.test(t)) {
      return t;
    }
  }
  return '';
}

function detectSectionName(el, $, index, total) {
  const $el = $(el);
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  const text = $el.text().replace(/\s+/g, ' ').trim();
  const lc = text.toLowerCase();
  const heading = $el.find('h1, h2, h3').first().text().replace(/\s+/g, ' ').trim();

  // structural roles
  if (tag === 'header' || $el.find('nav').length) return 'section-header';
  if (tag === 'footer' || (/\b(copyright|©|all rights reserved)\b/i.test(text) && text.length < 800)) return 'section-footer';
  if ($el.find('h1').length) return 'section-hero';

  // short banner with no heading (announcement / promo bar) — check first so
  // its copy (e.g. "early-bird pricing") doesn't trip the role heuristics below
  const cls = ($el.attr('class') || '').toLowerCase();
  if (/\bfixed\b/.test(cls) && /\bbottom-0\b/.test(cls) && /md:hidden/.test(cls)) return 'section-mobile-cta';
  if (/cookie/i.test(lc) && text.length < 400) return 'section-cookie';
  if (index === 0 && !heading && text.length < 160 && /cohort|early-bird|pricing closes/i.test(lc)) return 'section-strip';
  if ((text.match(/\d[\d,]*\+?%?/g) || []).length >= 3 && text.length < 600 && !$el.find('h1, h2').length) return 'section-stats';
  if (!heading && text.length < 160) return 'section-announcement';

  // strong content-signal roles
  if (/faq|frequently asked|questions?,?\s*answered/.test(lc)) return 'section-faq';
  if ($el.find('blockquote, figure').length >= 2 || /\btestimonials?\b|\breviews?\b/.test(lc)) return 'section-testimonials';
  // pricing needs several price tokens or an explicit plan word — a lone "$50M"
  // in a testimonial shouldn't count
  const priceTokens = (text.match(/[₹$€£]\s?\d[\d,]*/g) || []).length;
  if (priceTokens >= 2 || /\bpricing\b|\bplans?\b|\btiers?\b|\/mo\b|per month/.test(lc)) return 'section-pricing';
  if (/reserve|get started|sign up|book (your|a)|start (free|now|today)|get the brochure/.test(lc) && text.length < 600) return 'section-cta';

  // otherwise: derive a label from the eyebrow kicker, then the heading
  const label = slug(eyebrowLabel($el, $)) || slug(heading);
  if (label) return `section-${label}`;

  return `section-block-${index + 1}`;
}

// Choose the container whose direct children are the page's top-level sections.
// SPAs wrap content several divs deep and often append a stray badge/script as
// a sibling, so instead of "descend while single child" we descend into the
// child that dominates the subtree (>=70% of elements) and stop once no single
// child dominates — that node's children are the real sections.
const SEMANTIC_SECTION_TAGS = new Set(['section', 'header', 'footer', 'main', 'article']);

function findSectionRoot($) {
  const main = $('main').first();
  if (main.length && main.children().length >= 2) return main;

  let node = $('body');
  const ignore = ['script', 'style', 'noscript', 'link', 'meta'];
  for (let depth = 0; depth < 8; depth++) {
    const kids = node.children()
      .filter((_, c) => c.tagName && !ignore.includes(c.tagName.toLowerCase()))
      .toArray();
    if (kids.length === 0) break;
    // Direct children are already landmark sections — stop here.
    if (kids.length >= 2 && kids.every((k) => SEMANTIC_SECTION_TAGS.has(k.tagName.toLowerCase()))) return node;
    const totals = kids.map((k) => $(k).find('*').length + 1);
    const sum = totals.reduce((a, b) => a + b, 0);
    let maxI = 0;
    for (let i = 1; i < kids.length; i++) if (totals[i] > totals[maxI]) maxI = i;
    if (kids.length === 1) {
      const onlyTag = kids[0].tagName.toLowerCase();
      // Don't descend into a section/header/footer — export it as a section block.
      if (SEMANTIC_SECTION_TAGS.has(onlyTag)) return node;
      node = $(kids[0]);
      continue;
    }
    if (totals[maxI] >= sum * 0.7) {
      const nextTag = kids[maxI].tagName.toLowerCase();
      if (SEMANTIC_SECTION_TAGS.has(nextTag)) return node;
      node = $(kids[maxI]);
      continue;
    }
    return node; // multiple substantial children → these are the sections
  }
  return node;
}

// --- image placeholder naming ------------------------------------------------
function placeholderName(sectionName, alt, i) {
  const base = sectionName.replace(/^section-/, '') || 'image';
  const slug = (alt || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  const stem = slug ? `${base}-${slug}` : `${base}-${i + 1}`;
  return `${stem}.png`;
}

// --- attribute preservation (pixel-faithful markup) --------------------------------
const PRESERVE_ATTRS = [
  'id', 'type', 'name', 'value', 'placeholder', 'disabled', 'readonly', 'required',
  'checked', 'selected', 'for', 'target', 'rel', 'role', 'aria-label', 'aria-expanded',
  'aria-controls', 'aria-hidden', 'aria-current', 'aria-haspopup', 'aria-selected',
  'tabindex', 'width', 'height', 'loading', 'decoding', 'open',
];

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function serializeAttrs($el, tag, extras = {}) {
  const parts = [];
  for (const key of PRESERVE_ATTRS) {
    const v = $el.attr(key);
    if (v != null && v !== '') parts.push(`${key}="${escapeAttr(v)}"`);
  }
  for (const [k, v] of Object.entries(extras)) {
    if (v != null && v !== '') parts.push(`${k}="${escapeAttr(v)}"`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function isNavToggle($el) {
  const label = ($el.attr('aria-label') || '').toLowerCase();
  if (/menu|nav|toggle|open|close/.test(label)) return true;
  return $el.find('svg').length > 0 && !$el.text().replace(/\s+/g, '').length;
}

function interactivityMarkers($el, tag, behaviors) {
  const extras = {};
  if (behaviors.includes('mobile-nav')) {
    if (tag === 'button' && isNavToggle($el)) extras['data-nav-toggle'] = 'true';
    if (tag === 'nav') extras['data-nav-panel'] = 'true';
  }
  if (behaviors.includes('accordion')) {
    if ($el.attr('aria-expanded') != null) extras['data-accordion-trigger'] = 'true';
    if ($el.attr('data-state') === 'open' || $el.attr('data-state') === 'closed') {
      if (tag === 'button') extras['data-accordion-trigger'] = 'true';
      else extras['data-accordion-panel'] = 'true';
    }
  }
  if (behaviors.includes('tabs')) {
    if ($el.attr('role') === 'tab') extras['data-tab-trigger'] = 'true';
    if ($el.attr('role') === 'tabpanel') extras['data-tab-panel'] = 'true';
  }
  if (behaviors.includes('dialog')) {
    if ($el.attr('role') === 'dialog' || tag === 'dialog') extras['data-dialog'] = 'true';
    if (tag === 'button' && /open|show|contact|modal/i.test($el.text())) extras['data-dialog-open'] = 'true';
  }
  if (behaviors.includes('carousel')) {
    if (tag === 'button' && /prev|next|arrow|slide/i.test(($el.attr('aria-label') || $el.text()).toLowerCase())) {
      extras['data-carousel-control'] = /prev|back|left/i.test(($el.attr('aria-label') || $el.text()).toLowerCase()) ? 'prev' : 'next';
    }
  }
  if (behaviors.includes('pricing-toggle')) {
    if (tag === 'button' || $el.attr('role') === 'switch') extras['data-pricing-toggle'] = 'true';
  }
  return extras;
}

// --- section interactivity detection + script generation ---------------------------
function detectSectionInteractivity($el, $, sectionName) {
  const behaviors = [];
  const nav = $el.find('nav').first();
  const navBtn = $el.find('button').filter((_, b) => isNavToggle($(b))).first();
  if (nav.length && navBtn.length) behaviors.push('mobile-nav');

  if (
    $el.find('button[aria-expanded], [data-state="open"], [data-state="closed"], details').length
    || (sectionName.includes('faq') && $el.find('button').length >= 2)
  ) behaviors.push('accordion');

  if ($el.find('[role="tablist"]').length && $el.find('[role="tab"]').length >= 2) behaviors.push('tabs');

  if ($el.find('[role="dialog"], dialog').length) behaviors.push('dialog');
  else if ($el.find('button').filter((_, b) => /open|show|contact|modal/i.test($(b).text())).length) behaviors.push('dialog');

  if (
    $el.find('[class*="carousel"], [class*="embla"], [data-embla]').length
    || ($el.find('[class*="snap-x"], [class*="snap-mandatory"]').length && $el.find('button').length >= 2)
  ) behaviors.push('carousel');

  if (
    sectionName.includes('pricing')
    && /month|year|annual|billing/i.test($el.text())
    && $el.find('button, [role="switch"]').length
  ) behaviors.push('pricing-toggle');

  return [...new Set(behaviors)];
}

function scriptPath(sectionName) {
  return `scripts/${sectionName}.js`;
}

function isLayoutContainer(decls, childEls) {
  if (decls && ['flex', 'grid', 'inline-flex', 'inline-grid'].includes(decls.display)) return true;
  return childEls.filter((c) => c.tagName).length > 1;
}

function buildSectionBlock(semTag, sectionName, cls, inner, label, behaviors, sectionScripts) {
  let tag = semTag;
  let aria = '';
  let extraClass = '';
  if (sectionName === 'section-strip') {
    tag = 'div';
    extraClass = ' strip';
    aria = ' role="region" aria-label="Announcement"';
  } else if (sectionName === 'section-mobile-cta') {
    tag = 'aside';
    aria = ' aria-label="Booking bar"';
  } else if (sectionName === 'section-cookie') {
    tag = 'aside';
    aria = ' aria-label="Cookie consent"';
  }
  const classAttr = ` class="${sectionName}${extraClass}${cls ? ' ' + cls : ''}"`;
  let block = `    <!-- ${label} Section -->\n    <${tag}${classAttr}${aria}>\n${indent(inner, 6)}\n    </${tag}>`;
  if (behaviors.length) {
    const path = scriptPath(sectionName);
    sectionScripts[path] = generateSectionScript(sectionName, behaviors);
  }
  return block;
}

function generateSectionScript(sectionName, behaviors) {
  const sel = `.${sectionName}`;
  const blocks = [`/* ${sectionName} — generated interactivity */`];

  if (behaviors.includes('mobile-nav')) {
    blocks.push(`(function () {
  const root = document.querySelector(${JSON.stringify(sel)});
  if (!root) return;
  const toggle = root.querySelector('[data-nav-toggle]');
  const panel = root.querySelector('[data-nav-panel]');
  if (!toggle || !panel) return;
  panel.hidden = false;
  toggle.addEventListener('click', () => {
    const open = root.classList.toggle('is-nav-open');
    toggle.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('is-open', open);
  });
})();`);
  }

  if (behaviors.includes('accordion')) {
    blocks.push(`(function () {
  const root = document.querySelector(${JSON.stringify(sel)});
  if (!root) return;
  root.querySelectorAll('[data-accordion-trigger]').forEach((trigger) => {
    const panel = trigger.getAttribute('aria-controls')
      ? document.getElementById(trigger.getAttribute('aria-controls'))
      : trigger.closest('[data-accordion-item]')?.querySelector('[data-accordion-panel]')
        || trigger.nextElementSibling;
    if (panel) panel.hidden = trigger.getAttribute('aria-expanded') !== 'true';
    trigger.addEventListener('click', () => {
      const open = trigger.getAttribute('aria-expanded') === 'true';
      trigger.setAttribute('aria-expanded', String(!open));
      if (panel) {
        panel.hidden = open;
        panel.style.display = open ? 'none' : '';
      }
    });
  });
  root.querySelectorAll('details').forEach((d) => {
    d.open = d.hasAttribute('open');
  });
})();`);
  }

  if (behaviors.includes('tabs')) {
    blocks.push(`(function () {
  const root = document.querySelector(${JSON.stringify(sel)});
  if (!root) return;
  const tabs = [...root.querySelectorAll('[data-tab-trigger], [role="tab"]')];
  const panels = [...root.querySelectorAll('[data-tab-panel], [role="tabpanel"]')];
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t, j) => {
        const on = j === i;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        if (panels[j]) panels[j].hidden = !on;
      });
    });
  });
})();`);
  }

  if (behaviors.includes('dialog')) {
    blocks.push(`(function () {
  const root = document.querySelector(${JSON.stringify(sel)});
  if (!root) return;
  root.querySelectorAll('[data-dialog-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dlg = root.querySelector('[data-dialog], dialog, [role="dialog"]');
      if (dlg) { dlg.hidden = false; dlg.classList.add('is-open'); }
    });
  });
  root.querySelectorAll('[data-dialog], dialog, [role="dialog"]').forEach((dlg) => {
    dlg.querySelectorAll('button').forEach((btn) => {
      if (/close|dismiss|cancel/i.test(btn.textContent || btn.getAttribute('aria-label') || '')) {
        btn.addEventListener('click', () => { dlg.hidden = true; dlg.classList.remove('is-open'); });
      }
    });
  });
})();`);
  }

  if (behaviors.includes('carousel')) {
    blocks.push(`(function () {
  const root = document.querySelector(${JSON.stringify(sel)});
  if (!root) return;
  const track = root.querySelector('[class*="snap"], [data-carousel-track]') || root;
  root.querySelectorAll('[data-carousel-control]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dir = btn.getAttribute('data-carousel-control') === 'prev' ? -1 : 1;
      const w = track.clientWidth || 320;
      track.scrollBy({ left: dir * w, behavior: 'smooth' });
    });
  });
})();`);
  }

  if (behaviors.includes('pricing-toggle')) {
    blocks.push(`(function () {
  const root = document.querySelector(${JSON.stringify(sel)});
  if (!root) return;
  root.querySelectorAll('[data-pricing-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      root.classList.toggle('is-annual');
      root.querySelectorAll('[data-pricing-toggle]').forEach((t) => {
        t.setAttribute('aria-pressed', String(root.classList.contains('is-annual')));
      });
    });
  });
})();`);
  }

  return blocks.join('\n\n') + '\n';
}

function mergeTailwindBuckets(baseDecls, className) {
  const buckets = {
    base: { ...(baseDecls || {}) },
    sm: {}, md: {}, lg: {}, xl: {}, '2xl': {},
    hover: {}, focus: {},
  };
  if (!className) return buckets;
  const tw = classesToBuckets(className);
  // Fill gaps from Tailwind — needed when capture viewport froze display:none
  // but mobile/responsive utilities define the real layout (e.g. md:hidden bars).
  for (const [prop, val] of Object.entries(tw.base)) {
    if (buckets.base[prop] == null) buckets.base[prop] = val;
  }
  if (Object.keys(tw.hover).length) buckets.hover = { ...buckets.hover, ...tw.hover };
  if (Object.keys(tw.focus).length) buckets.focus = { ...buckets.focus, ...tw.focus };
  for (const bp of ['sm', 'md', 'lg', 'xl', '2xl']) {
    if (Object.keys(tw[bp]).length) buckets[bp] = { ...(buckets[bp] || {}), ...tw[bp] };
  }
  reconcileResponsiveDisplay(buckets, tw);
  return buckets;
}

// Desktop capture often records display:none for md:hidden elements — restore
// a visible base display and keep the hide rule in the matching breakpoint bucket.
function reconcileResponsiveDisplay(buckets, tw) {
  const breakpoints = ['sm', 'md', 'lg', 'xl', '2xl'];
  const hiddenAtBp = breakpoints.filter((bp) => tw[bp].display === 'none');
  if (hiddenAtBp.length && buckets.base.display === 'none') {
    delete buckets.base.display;
    buckets.base.display = tw.base.display
      || ((buckets.base.position === 'fixed' || buckets.base.position === 'sticky') ? 'block' : 'block');
  }
  if (tw.base.display === 'none') buckets.base.display = 'none';
}

function emitClassRules(classToDecls) {
  const base = [];
  const media = { sm: [], md: [], lg: [], xl: [], '2xl': [] };
  const states = [];
  for (const [name, buckets] of classToDecls) {
    const b = typeof buckets.base === 'object' && buckets.base !== null && !Array.isArray(buckets.base)
      ? buckets
      : { base: buckets, sm: {}, md: {}, lg: {}, xl: {}, '2xl': {}, hover: {}, focus: {} };
    if (Object.keys(b.base).length) base.push(`.${name} {\n${declBlock(b.base)}\n}`);
    for (const bp of ['sm', 'md', 'lg', 'xl', '2xl']) {
      if (b[bp] && Object.keys(b[bp]).length) media[bp].push(`  .${name} {\n${declBlock(b[bp], 4)}\n  }`);
    }
    if (b.hover && Object.keys(b.hover).length) states.push(`.${name}:hover {\n${declBlock(b.hover)}\n}`);
    if (b.focus && Object.keys(b.focus).length) states.push(`.${name}:focus-visible {\n${declBlock(b.focus)}\n}`);
  }
  const parts = [];
  if (base.length) parts.push(base.join('\n\n'));
  if (states.length) parts.push(`/* --- states --- */\n${states.join('\n\n')}`);
  for (const bp of ['sm', 'md', 'lg', 'xl', '2xl']) {
    if (media[bp].length) parts.push(`@media (min-width: ${RESPONSIVE_PREFIXES[bp]}) {\n${media[bp].join('\n\n')}\n}`);
  }
  return parts.join('\n\n');
}

// --- main --------------------------------------------------------------------
function transform(rawHtml, opts = {}) {
  // Pixel-faithful path: build CSS from real computed styles captured in the
  // browser, keyed by the data-sx index stamped onto each element.
  if (opts.computed) {
    return transformFaithful(rawHtml, opts);
  }

  const $ = cheerio.load(rawHtml, { decodeEntities: false });
  const scrapedFontLinks = scrapeFontLinks($);
  $('script, style, noscript, link, meta, svg > *').remove();

  const pageTitle = ($('title').first().text() || 'Converted Page').trim();

  const sigToClass = new Map(); // signature -> class name
  const classToDecls = new Map(); // class name -> buckets
  const nameCounts = new Map();
  const colorUsage = new Map(); // hex -> count (for token extraction)

  function classFor(el, buckets) {
    const sig = signature(buckets);
    const tag = el.tagName ? el.tagName.toLowerCase() : 'el';
    const sigKey = `${tag}|${sig}`;
    if (sigToClass.has(sigKey)) return sigToClass.get(sigKey);
    let name = baseName(el, buckets, $);
    const n = (nameCounts.get(name) || 0) + 1;
    nameCounts.set(name, n);
    const finalName = n === 1 ? name : `${name}-${n}`;
    sigToClass.set(sigKey, finalName);
    classToDecls.set(finalName, buckets);
    // tally colors for token extraction
    for (const bucket of Object.values(buckets)) {
      for (const [prop, val] of Object.entries(bucket)) {
        if (/color/.test(prop) && /^#/.test(val)) colorUsage.set(val, (colorUsage.get(val) || 0) + 1);
      }
    }
    return finalName;
  }

  const sectionRoot = findSectionRoot($);
  const sectionEls = sectionRoot.children().filter((_, c) => c.tagName && !['script', 'style'].includes(c.tagName.toLowerCase())).toArray();
  const sectionsSummaryParts = [];
  const sectionScripts = {};

  // Recursively rewrite an element into clean HTML.
  function walk(el, sectionName, imgCounter, behaviors) {
    if (el.type === 'text') {
      const t = el.data.replace(/\s+/g, ' ');
      return t.trim() ? t : '';
    }
    if (!el.tagName) return '';
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'link', 'meta'].includes(tag)) return '';

    const $el = $(el);
    const buckets = classesToBuckets($el.attr('class'));
    const cls = isEmptyBuckets(buckets) ? null : classFor(el, buckets);
    const attrStr = serializeAttrs($el, tag, interactivityMarkers($el, tag, behaviors));

    // images -> placeholder
    if (tag === 'img') {
      const name = placeholderName(sectionName, $el.attr('alt'), imgCounter.n++);
      const alt = ($el.attr('alt') || '').trim();
      const clsPart = cls ? ` class="${cls}"` : '';
      return `<img${clsPart}${attrStr} src="${name}" alt="${escapeAttr(alt)}">`;
    }

    // collapse pointless single-child wrapper <div> with no styling
    const children = $el.contents().toArray();
    const inner = children.map((c) => walk(c, sectionName, imgCounter, behaviors)).filter(Boolean).join('');
    const layoutDecls = buckets.base || null;
    if (tag === 'div' && !cls && !isLayoutContainer(layoutDecls, children)
      && children.filter((c) => c.tagName).length <= 1
      && !/[^\s]/.test($el.clone().children().remove().end().text())) {
      return inner; // drop empty wrapper
    }

    const selfClosing = ['br', 'hr', 'input', 'img'];
    const clsAttr = cls ? ` class="${cls}"` : '';
    const href = tag === 'a' && $el.attr('href') ? ` href="${escapeAttr($el.attr('href'))}"` : '';
    if (selfClosing.includes(tag)) return `<${tag}${clsAttr}${attrStr}${href}>`;
    return `<${tag}${clsAttr}${attrStr}${href}>${inner}</${tag}>`;
  }

  const bodyBlocks = [];
  sectionEls.forEach((el, i) => {
    const sectionName = detectSectionName(el, $, i, sectionEls.length);
    sectionsSummaryParts.push(sectionName.replace(/^section-/, '').replace(/-/g, ' '));
    const behaviors = detectSectionInteractivity($(el), $, sectionName);
    const imgCounter = { n: 0 };
    const $el = $(el);
    const buckets = classesToBuckets($el.attr('class'));
    const cls = isEmptyBuckets(buckets) ? null : classFor(el, buckets);
    const inner = $el.contents().toArray().map((c) => walk(c, sectionName, imgCounter, behaviors)).filter(Boolean).join('');

    const tag = el.tagName.toLowerCase();
    let semTag = 'section';
    if (sectionName === 'section-header') semTag = 'header';
    else if (sectionName === 'section-footer') semTag = 'footer';
    const label = sectionName.replace(/^section-/, '').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    bodyBlocks.push(buildSectionBlock(semTag, sectionName, cls, inner, label, behaviors, sectionScripts));
  });

  const fontLinks = resolveFontLinks({ ...opts, classToDecls }, scrapedFontLinks);
  const html = buildHtml(pageTitle, bodyBlocks.join('\n\n'), fontLinks, sectionScripts);
  const css = buildCss(classToDecls, colorUsage, opts);
  const summary = [...new Set(sectionsSummaryParts)].map((s) => s.replace(/\b\w/g, (m) => m.toUpperCase())).join(', ');

  return { sectionsSummary: summary, html, css, scripts: sectionScripts };
}

// --- serializers -------------------------------------------------------------
function indent(str, spaces) {
  const pad = ' '.repeat(spaces);
  return str.split('\n').map((l) => (l.trim() ? pad + l : l)).join('\n');
}

function buildScriptImports(sectionScripts) {
  const paths = Object.keys(sectionScripts || {}).sort();
  if (!paths.length) return '';
  const lines = [
    '',
    '    <!-- Section scripts — save these files under scripts/ (see scripts tab in extractor) -->',
  ];
  for (const p of paths) {
    lines.push(`    <script src="${p}" defer></script>`);
  }
  return lines.join('\n');
}

function buildHtml(title, body, fontLinks = [], sectionScripts = {}) {
  const fontTags = fontLinks
    .filter(Boolean)
    .map((href) => `  <link rel="stylesheet" href="${escapeAttr(href)}">`)
    .join('\n');
  const scriptPaths = Object.keys(sectionScripts).sort();
  const scriptManifest = scriptPaths.length
    ? `\n  <!-- Script files: ${scriptPaths.join(', ')} -->`
    : '';
  const scriptBlock = buildScriptImports(sectionScripts);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeAttr(title)}</title>
${fontTags ? fontTags + '\n' : ''}  <link rel="stylesheet" href="styles.css">${scriptManifest}
</head>
<body>
${body}${scriptBlock}
</body>
</html>
`;
}

// Extract loadable font-family names from a computed stack string.
function parseFontFamilyNames(stack) {
  if (!stack) return [];
  return stack.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''))
    .filter((f) => f && !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|inherit|initial)$/i.test(f));
}

// Build a Google Fonts stylesheet URL for any webfont families not already linked.
function buildGoogleFontsUrl(families) {
  const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|inherit|initial|apple system|segoe ui|roboto|helvetica|arial)$/i;
  const unique = [...new Set(families.map((f) => f.trim()).filter((f) => f && !generic.test(f)))];
  if (!unique.length) return null;
  const params = unique.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700;800`).join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

function resolveFontLinks(opts, scrapedLinks = []) {
  const links = [...(opts.fontLinks || []), ...scrapedLinks];
  const families = new Set(opts.fontFamilies || []);
  if (opts.bodyStyle && opts.bodyStyle['font-family']) {
    parseFontFamilyNames(opts.bodyStyle['font-family']).forEach((f) => families.add(f));
  }
  if (opts.classToDecls) {
    for (const [, buckets] of opts.classToDecls) {
      const b = buckets.base || buckets;
      if (b && b['font-family']) parseFontFamilyNames(b['font-family']).forEach((f) => families.add(f));
    }
  }
  const googleUrl = buildGoogleFontsUrl([...families]);
  if (googleUrl && !links.some((l) => /fonts\.googleapis\.com/.test(l))) links.unshift(googleUrl);
  return [...new Set(links.map((l) => {
    try { return new URL(l, opts.url || 'https://localhost/').href; } catch { return l; }
  }))];
}

function scrapeFontLinks($) {
  const links = [];
  if (!$) return links;
  $('link[rel="stylesheet"], link[rel="preload"][as="font"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && /fonts\.googleapis|fonts\.gstatic|use\.typekit|typekit\.net|cloud\.typenetwork|fontshare|cdnfonts|bunny\.net\/font|fontsource|\/font/i.test(href)) {
      links.push(href);
    }
  });
  return links;
}

function declBlock(decls, indentLevel = 2) {
  const pad = ' '.repeat(indentLevel);
  return Object.entries(decls).map(([p, v]) => `${pad}${p}: ${v};`).join('\n');
}

function buildCss(classToDecls, colorUsage, opts = {}) {
  // token extraction: most-used colors become variables
  const ranked = [...colorUsage.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const tokens = {
    '--color-bg-main': ranked.find((c) => isLight(c)) || '#ffffff',
    '--color-bg-section': '#f7f8fa',
    '--color-text-primary': ranked.find((c) => isDark(c)) || '#111827',
    '--color-text-muted': '#6b7280',
    '--color-accent': ranked.find((c) => !isLight(c) && !isDark(c)) || '#2563eb',
    '--color-border': '#e5e7eb',
    '--radius': '0.5rem',
    '--container': '72rem',
  };

  const bodyFont = (opts.bodyStyle && opts.bodyStyle['font-family'])
    || "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  const parts = [];
  parts.push(`/* styles.css — generated by lovable-extractor */`);
  if (opts.fontFaces && opts.fontFaces.length) {
    parts.push(`/* --- @font-face (from source page) --- */\n${opts.fontFaces.join('\n')}`);
  }
  parts.push(`:root {\n${Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`);

  parts.push(`/* --- base --- */
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: ${bodyFont};
  color: var(--color-text-primary);
  background: var(--color-bg-main);
  line-height: 1.5;
}
h1, h2, h3, h4, h5, h6 { margin: 0 0 0.5em; line-height: 1.15; font-weight: 700; }
h1 { font-size: clamp(2.25rem, 5vw, 3.75rem); }
h2 { font-size: clamp(1.75rem, 3.5vw, 2.5rem); }
h3 { font-size: 1.375rem; }
p { margin: 0 0 1rem; color: var(--color-text-muted); }
a { color: var(--color-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; height: auto; display: block; }
ul, ol { margin: 0 0 1rem; padding-left: 1.25rem; }
:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }`);

  parts.push(`/* --- section rhythm --- */
section, header, footer { padding: clamp(3rem, 8vw, 6rem) 1.25rem; }
.section-hero { padding-top: clamp(4rem, 10vw, 8rem); }
.section-footer { background: var(--color-text-primary); color: #fff; }
.section-block-1, .section-features, .section-testimonials { background: var(--color-bg-section); }`);

  // component / layout classes with responsive + state variants
  const emitted = emitClassRules(classToDecls);
  if (emitted) parts.push(`/* --- components & layout --- */\n${emitted}`);

  return parts.join('\n\n') + '\n';
}

// crude luminance helpers for token guessing
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}
function isLight(hex) { return luminance(hex) > 0.85; }
function isDark(hex) { return luminance(hex) < 0.2; }

// =============================================================================
// PIXEL-FAITHFUL PIPELINE
// Builds CSS from the computed styles captured in the browser rather than from
// Tailwind class names. Reuses the section detection, dedupe and HTML cleanup
// from the class-name path, but the declarations are the page's real values.
// =============================================================================

// Group the flat computed map (border-top-color, border-right-color, ...) into
// tidy shorthand where all four sides agree; leave the rest as longhand.
// Computed grid tracks come back as resolved pixels (frozen at capture width).
// Convert them back to fluid fr units so the layout reflows: equal tracks →
// repeat(n, minmax(0,1fr)); unequal → proportional fr ratios. Small tracks
// (icon/placement grids) stay fixed.
function fluidGridTracks(value) {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length < 2) {
    const n = parseFloat(tokens[0]);
    if (tokens[0].endsWith('px') && n > 120) return 'minmax(0, 1fr)';
    return value;
  }
  if (!tokens.every((t) => /^\d*\.?\d+px$/.test(t))) return value;
  const nums = tokens.map((t) => parseFloat(t));
  const max = Math.max(...nums);
  if (max <= 96) return value; // icon/placement grid — keep fixed
  const min = Math.min(...nums);
  if ((max - min) / max <= 0.05) return `repeat(${nums.length}, minmax(0, 1fr))`;
  return nums.map((n) => `minmax(0, ${+(n / min).toFixed(3)}fr)`).join(' ');
}

function fluidGridRows(value) {
  if (!value) return value;
  const tokens = value.trim().split(/\s+/);
  if (tokens.length === 1 && /^\d*\.?\d+px$/.test(tokens[0]) && parseFloat(tokens[0]) > 96) return 'auto';
  if (!tokens.every((t) => /^\d*\.?\d+px$/.test(t))) return value;
  const nums = tokens.map((t) => parseFloat(t));
  const max = Math.max(...nums);
  if (max <= 96) return value;
  if ((max - Math.min(...nums)) / max <= 0.05) return 'auto';
  return nums.map(() => 'auto').join(' ');
}

function fixFixedInsets(d) {
  const pos = d.position;
  if (pos !== 'fixed' && pos !== 'sticky') return;
  // Corner-anchored overlays: drop the opposite inset so the box can size naturally.
  if (d.bottom != null) delete d.top;
  else if (d.top != null) delete d.bottom;
  if (d.left != null) delete d.right;
  else if (d.right != null) delete d.left;
}

function stripFlowDimensions(d) {
  // Width/height on text links and flow elements break reflow — icons keep fixed size.
  const w = d.width && parseFloat(d.width);
  const h = d.height && parseFloat(d.height);
  const isIconBox = w > 0 && h > 0 && w <= 96 && h <= 96
    && ['grid', 'inline-grid', 'inline-block', 'flex', 'inline-flex'].includes(d.display);
  if (!isIconBox) {
    delete d.width;
    delete d.height;
  }
}

function inferGridIconBox(d) {
  const col = d['grid-template-columns'];
  const row = d['grid-template-rows'];
  const colPx = col && /^\d*\.?\d+px$/.test(col.trim()) ? parseFloat(col) : null;
  const rowPx = row && /^\d*\.?\d+px$/.test(row.trim()) ? parseFloat(row) : null;
  if (colPx && rowPx && colPx <= 96 && rowPx <= 96) {
    if (!d.width) d.width = `${colPx}px`;
    if (!d.height) d.height = `${rowPx}px`;
    if (d['align-items'] === 'center' && !d['justify-items']) d['justify-items'] = 'center';
    if (!d['place-items']) d['place-items'] = 'center';
  }
  if (d.display === 'grid' && d['grid-template-columns']
    && /minmax\(0,\s*1fr\)/.test(d['grid-template-columns'])
    && (d['grid-template-columns'].match(/minmax/g) || []).length >= 2
    && !d['align-items']) {
    d['align-items'] = 'start';
  }
}

function postProcessDeclsForTag(tag, decls, $el) {
  const d = { ...decls };
  if (tag === 'svg') {
    delete d['overflow-x'];
    delete d['overflow-y'];
    if (!d.width) {
      const w = $el && $el.attr('width');
      d.width = w ? (/px$/.test(w) ? w : `${w}px`) : '24px';
    }
    if (!d.height) {
      const h = $el && $el.attr('height');
      d.height = h ? (/px$/.test(h) ? h : `${h}px`) : '24px';
    }
    d['flex-shrink'] = '0';
  }
  if (tag === 'div' || tag === 'span') inferGridIconBox(d);
  return d;
}

function tidyDecls(raw) {
  const d = { ...raw };
  stripFlowDimensions(d);
  inferGridIconBox(d);
  if (d['grid-template-columns']) d['grid-template-columns'] = fluidGridTracks(d['grid-template-columns']);
  if (d['grid-template-rows']) d['grid-template-rows'] = fluidGridRows(d['grid-template-rows']);
  fixFixedInsets(d);
  delete d['transform-origin'];
  const collapse = (keys, shorthand) => {
    const vals = keys.map((k) => d[k]);
    if (vals.every((v) => v != null) && vals.every((v) => v === vals[0])) {
      keys.forEach((k) => delete d[k]);
      d[shorthand] = vals[0];
    }
  };
  collapse(['margin-top', 'margin-right', 'margin-bottom', 'margin-left'], 'margin');
  collapse(['padding-top', 'padding-right', 'padding-bottom', 'padding-left'], 'padding');
  collapse(['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'], 'border-width');
  collapse(['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'], 'border-style');
  collapse(['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'], 'border-color');
  collapse(['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'], 'border-radius');

  // A border-width with no style won't paint; default it to solid.
  const hasWidth = /border(-\w+)?-width/.test(Object.keys(d).join(' '));
  const hasStyle = /border(-\w+)?-style/.test(Object.keys(d).join(' '));
  if (hasWidth && !hasStyle) d['border-style'] = 'solid';

  // Normalize matrix() transforms to translate shorthand when only translation is used.
  if (d.transform && /^matrix\(/.test(d.transform)) {
    const mm = d.transform.match(/matrix\(([^)]+)\)/);
    if (mm) {
      const p = mm[1].split(',').map((v) => parseFloat(v.trim()));
      if (p.length >= 6 && Math.abs(p[0] - 1) < 0.01 && Math.abs(p[3] - 1) < 0.01 && Math.abs(p[1]) < 0.01 && Math.abs(p[2]) < 0.01) {
        const tx = p[4], ty = p[5];
        const x = d.left === '50%' ? '-50%' : (Math.abs(tx) > 0.5 ? `${tx}px` : null);
        const y = d.top === '50%' ? '-50%' : (Math.abs(ty) > 0.5 ? `${ty}px` : null);
        const parts = [x, y].filter(Boolean);
        if (parts.length) d.transform = `translate(${parts.join(', ')})`;
        else delete d.transform;
      }
    }
  }

  // Order roughly: layout, box, border, background, type, effects — keeps the
  // emitted CSS readable. Unknown keys keep insertion order after these.
  const ORDER = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'align-content',
    'order', 'flex-grow', 'flex-shrink', 'flex-basis', 'gap', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow', 'grid-auto-rows',
    'justify-items', 'place-items', 'place-content',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-width', 'border-style', 'border-color',
    'border-radius',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'background-clip', '-webkit-background-clip', '-webkit-text-fill-color',
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
    'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line', 'white-space',
    'box-shadow', 'opacity', 'transform', 'transform-origin', 'filter', 'backdrop-filter',
    'overflow-x', 'overflow-y', 'object-fit', 'object-position', 'cursor', 'list-style-type',
    'text-overflow', '-webkit-line-clamp', 'visibility', 'pointer-events',
  ];
  const out = {};
  for (const k of ORDER) if (k in d) { out[k] = d[k]; delete d[k]; }
  for (const k of Object.keys(d)) out[k] = d[k];
  return out;
}

function absolutize(src, base) {
  if (!src) return src;
  try { return new URL(src, base).href; } catch { return src; }
}

function transformFaithful(rawHtml, opts) {
  const computed = opts.computed || {};
  const baseUrl = opts.url || 'https://localhost/';
  const $ = cheerio.load(rawHtml, { decodeEntities: false });
  const scrapedFontLinks = scrapeFontLinks($);
  $('script, style, noscript, link, meta').remove();

  const pageTitle = (opts.pageTitle || $('title').first().text() || 'Converted Page').trim();

  const sigToClass = new Map();
  const classToDecls = new Map();
  const nameCounts = new Map();

  function declsFor(el) {
    const idx = el.attribs && el.attribs['data-sx'];
    if (idx == null) return null;
    const raw = computed[idx];
    if (!raw || Object.keys(raw).length === 0) return null;
    return tidyDecls(raw);
  }

  function classFor(el, decls) {
    if (!decls || Object.keys(decls).length === 0) return null;
    const tag = el.tagName ? el.tagName.toLowerCase() : 'el';
    const $el = $(el);
    const polished = postProcessDeclsForTag(tag, decls, $el);
    const className = el.attribs && el.attribs.class;
    const buckets = mergeTailwindBuckets(polished, className);
    if (isEmptyBuckets(buckets)) return null;
    const sig = signature(buckets);
    const sigKey = `${tag}|${sig}`;
    if (sigToClass.has(sigKey)) return sigToClass.get(sigKey);
    let name = baseName(el, buckets, $);
    const n = (nameCounts.get(name) || 0) + 1;
    nameCounts.set(name, n);
    const finalName = n === 1 ? name : `${name}-${n}`;
    sigToClass.set(sigKey, finalName);
    classToDecls.set(finalName, buckets);
    return finalName;
  }

  const sectionRoot = findSectionRoot($);
  const sectionEls = sectionRoot.children()
    .filter((_, c) => c.tagName && !['script', 'style'].includes(c.tagName.toLowerCase()))
    .toArray();
  const sectionsSummaryParts = [];
  const sectionScripts = {};

  function walk(el, sectionName, imgCounter, behaviors) {
    if (el.type === 'text') {
      const t = el.data.replace(/\s+/g, ' ');
      return t.trim() ? t : '';
    }
    if (!el.tagName) return '';
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'link', 'meta'].includes(tag)) return '';

    const $el = $(el);
    const decls = declsFor(el);
    const cls = classFor(el, decls);
    const attrStr = serializeAttrs($el, tag, interactivityMarkers($el, tag, behaviors));

    // Inline SVG icons: keep the vector markup intact so icons still render.
    if (tag === 'svg') {
      const $c = $el.clone();
      $c.removeAttr('data-sx');
      $c.removeAttr('class');
      $c.find('[data-sx]').removeAttr('data-sx');
      if (cls) $c.addClass(cls);
      return $.html($c);
    }

    if (tag === 'img') {
      const src = absolutize($el.attr('src'), baseUrl);
      const alt = ($el.attr('alt') || '').trim();
      const clsPart = cls ? ` class="${cls}"` : '';
      imgCounter.n++;
      return `<img${clsPart}${attrStr}${src ? ` src="${escapeAttr(src)}"` : ''} alt="${escapeAttr(alt)}">`;
    }

    const children = $el.contents().toArray();
    const inner = children.map((c) => walk(c, sectionName, imgCounter, behaviors)).filter(Boolean).join('');

    // Drop pointless unstyled single-child wrapper divs (keep layout containers).
    if (tag === 'div' && !cls && !isLayoutContainer(decls, children)
      && children.filter((c) => c.tagName).length <= 1
      && !/[^\s]/.test($el.clone().children().remove().end().text())) {
      return inner;
    }

    const selfClosing = ['br', 'hr', 'input'];
    const clsAttr = cls ? ` class="${cls}"` : '';
    const href = tag === 'a' && $el.attr('href') ? ` href="${escapeAttr($el.attr('href'))}"` : '';
    if (selfClosing.includes(tag)) return `<${tag}${clsAttr}${attrStr}${href}>`;
    return `<${tag}${clsAttr}${attrStr}${href}>${inner}</${tag}>`;
  }

  const bodyBlocks = [];
  sectionEls.forEach((el, i) => {
    const sectionName = detectSectionName(el, $, i, sectionEls.length);
    sectionsSummaryParts.push(sectionName.replace(/^section-/, '').replace(/-/g, ' '));
    const behaviors = detectSectionInteractivity($(el), $, sectionName);
    const imgCounter = { n: 0 };
    const $el = $(el);
    const decls = declsFor(el);
    const cls = classFor(el, decls);
    const inner = $el.contents().toArray().map((c) => walk(c, sectionName, imgCounter, behaviors)).filter(Boolean).join('');

    let semTag = 'section';
    if (sectionName === 'section-header') semTag = 'header';
    else if (sectionName === 'section-footer') semTag = 'footer';
    const label = sectionName.replace(/^section-/, '').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    bodyBlocks.push(buildSectionBlock(semTag, sectionName, cls, inner, label, behaviors, sectionScripts));
  });

  const fontLinks = resolveFontLinks({ ...opts, classToDecls }, scrapedFontLinks);
  const html = buildHtml(pageTitle, bodyBlocks.join('\n\n'), fontLinks, sectionScripts);
  const css = buildFaithfulCss(classToDecls, opts.bodyStyle || {}, sectionScripts, opts);
  const summary = [...new Set(sectionsSummaryParts)].map((s) => s.replace(/\b\w/g, (m) => m.toUpperCase())).join(', ');

  return { sectionsSummary: summary, html, css, scripts: sectionScripts };
}

function buildFaithfulCss(classToDecls, bodyStyle, sectionScripts = {}, opts = {}) {
  const parts = [];
  parts.push(`/* styles.css — pixel-faithful extraction (real computed styles) */`);

  if (opts.fontFaces && opts.fontFaces.length) {
    parts.push(`/* --- @font-face (from source page) --- */\n${opts.fontFaces.join('\n\n')}`);
  }

  const bodyDecls = {
    margin: '0',
    '-webkit-font-smoothing': 'antialiased',
    '-moz-osx-font-smoothing': 'grayscale',
  };
  if (bodyStyle['background-color']) bodyDecls['background-color'] = bodyStyle['background-color'];
  if (bodyStyle.color) bodyDecls.color = bodyStyle.color;
  if (bodyStyle['font-family']) bodyDecls['font-family'] = bodyStyle['font-family'];
  if (bodyStyle['font-size']) bodyDecls['font-size'] = bodyStyle['font-size'];
  if (bodyStyle['line-height']) bodyDecls['line-height'] = bodyStyle['line-height'];

  parts.push(`/* --- reset (minimal — preserves computed layout) --- */
*, *::before, *::after { box-sizing: border-box; }
img, svg, video { display: block; }
a { color: inherit; text-decoration: none; }
button, input, textarea, select { font: inherit; color: inherit; }
button { background: none; border: 0; cursor: pointer; }
h1, h2, h3, h4, h5, h6, p, figure, blockquote, ul, ol { margin: 0; }
ul, ol { padding: 0; list-style: none; }`);

  parts.push(`body {\n${declBlock(bodyDecls)}\n}`);

  parts.push(`/* --- layout helpers --- */
.strip { width: 100%; }
[class*="grid"] > * { min-width: 0; }`);

  const emitted = emitClassRules(classToDecls);
  if (emitted) parts.push(`/* --- elements --- */\n${emitted}`);

  // Minimal helpers for generated section scripts (no layout overrides).
  const helperRules = [];
  if (Object.keys(sectionScripts).some((p) => p.includes('section-header'))) {
    helperRules.push(`@media (max-width: 767px) {
  .section-header [data-nav-panel]:not(.is-open) { display: none; }
  .section-header.is-nav-open [data-nav-panel] { display: flex; flex-direction: column; }
}`);
  }
  if (Object.keys(sectionScripts).some((p) => p.includes('dialog'))) {
    helperRules.push(`[data-dialog], dialog[role="dialog"] { display: none; }`);
    helperRules.push(`[data-dialog].is-open, dialog[role="dialog"].is-open { display: block; }`);
  }
  if (helperRules.length) parts.push(`/* --- interactivity helpers --- */\n${helperRules.join('\n')}`);

  return parts.join('\n\n') + '\n';
}

module.exports = { transform };
