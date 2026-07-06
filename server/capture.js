// capture.js
// Renders a Lovable URL in headless Chromium and extracts a STRUCTURED CSS MODEL
// from the site's own compiled stylesheet — the source of truth. We do NOT
// reverse-map Tailwind class names; we read the real declarations the site ships.
//
// Lovable ships Tailwind v4: the compiled CSS is same-origin and readable, but
// every utility is nested inside @layer blocks, and declaration values must be
// read from rule.style.cssText (property enumeration drops v4 calc()/var()).
//
// Output model (all JSON-serializable):
//   { html, title,
//     rootCss, darkCss,            // verbatim :root / .dark custom-property blocks
//     atProperty[], keyframes[], fontFaces[], fontLinks[],
//     baseRules[{selector,css}],   // type/universal selectors (preflight, shadcn base, --tw init)
//     classRules{ token: [ {order,media,pseudo,pseudoEl,css} ] },
//     complexRules[{kind,selectorText,media,css}],   // group/peer/dark/data-state (approximated)
//     assets[] }

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function loadPuppeteer() {
  try {
    return require('puppeteer');
  } catch {
    throw new Error(
      'This page renders client-side and needs a headless browser, but "puppeteer" is not installed. ' +
      'Run `npm install puppeteer` (downloads Chromium once), then try again.'
    );
  }
}

/* istanbul ignore next -- runs in the browser context */
function extractModel() {
  // --- helpers ---------------------------------------------------------------
  const STATE_PSEUDOS = new Set([
    'hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited',
    'disabled', 'checked', 'required', 'first-child', 'last-child', 'first-of-type',
    'last-of-type', 'odd', 'even', 'empty', 'target', 'default', 'indeterminate',
  ]);
  const PSEUDO_ELEMENTS = new Set([
    'before', 'after', 'placeholder', 'file-selector-button', 'marker', 'backdrop',
    'first-line', 'first-letter', 'selection',
  ]);

  function unescapeIdent(s) {
    // CSS hex escapes (\32 ) then simple char escapes (\: \/ \[ ...)
    return s
      .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/\\(.)/g, '$1');
  }

  // Parse a selector into { token, states[], pseudoEl } IF it is a single-class
  // utility (optionally with state pseudos / one pseudo-element). Returns null
  // for type selectors, compounds (.a.b), attributes, or combinators.
  function parseSimple(sel) {
    if (sel[0] !== '.') return null;
    let i = 1;
    let token = '';
    while (i < sel.length) {
      const c = sel[i];
      if (c === '\\') { token += sel[i] + (sel[i + 1] || ''); i += 2; continue; }
      if (c === ':' ) break;                       // pseudo starts
      if (c === ' ' || c === '>' || c === '+' || c === '~' || c === ',') return null; // combinator
      if (c === '.' || c === '#' || c === '[') return null; // compound / attribute
      token += c; i++;
    }
    const rest = sel.slice(i); // pseudos, e.g. ":hover" or "::before" or ":hover:focus"
    const states = [];
    let pseudoEl = null;
    const re = /(::?)([a-z-]+)(\([^)]*\))?/g;
    let m;
    while ((m = re.exec(rest))) {
      const name = m[2];
      if (m[1] === '::' || PSEUDO_ELEMENTS.has(name)) pseudoEl = name;
      else if (STATE_PSEUDOS.has(name)) states.push(name);
      // ignore :is()/:where() wrappers etc. on a simple selector tail
    }
    return { token: unescapeIdent(token), states, pseudoEl };
  }

  function selectorKind(sel) {
    if (/(^|[^\\])\.dark\b/.test(sel) || /:where\(\.dark\b/.test(sel)) return 'dark';
    if (/\.group\b/.test(sel)) return 'group';
    if (/\.peer\b/.test(sel)) return 'peer';
    if (/\[data-state/.test(sel)) return 'data-state';
    return 'other';
  }

  const model = {
    rootCss: '', darkCss: '',
    atProperty: [], keyframes: [], fontFaces: [], fontLinks: [],
    baseRules: [], classRules: {}, complexRules: [], assets: [],
  };
  let order = 0;

  function pushClass(token, ctx) {
    (model.classRules[token] || (model.classRules[token] = [])).push(ctx);
  }

  // Split a selector LIST on top-level commas only — commas inside :where(),
  // :is(), :not() or [attr] must NOT split (else selectors like
  // `input:where([type="button"], [type="reset"])` break the whole sheet).
  function splitSelectorList(sel) {
    const out = [];
    let depth = 0, buf = '';
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

  function handleStyleRule(rule, media) {
    const css = rule.style.cssText;
    if (!css) return;
    const selectors = splitSelectorList(rule.selectorText);
    for (const sel of selectors) {
      // :root / html custom-property blocks → tokens
      if (sel === ':root' || sel === 'html' || sel === ':where(html)' || sel === 'html:root') {
        if (/--/.test(css)) model.rootCss += (model.rootCss ? '\n' : '') + css;
        else model.baseRules.push({ selector: sel, css });
        continue;
      }
      if (sel === '.dark' || sel === ':root.dark' || sel === 'html.dark' || sel === '.dark\\:') {
        model.darkCss += (model.darkCss ? '\n' : '') + css;
        continue;
      }
      const simple = parseSimple(sel);
      if (simple) {
        pushClass(simple.token, { order, media: media || null, states: simple.states, pseudoEl: simple.pseudoEl, css });
        continue;
      }
      // type / universal selectors (preflight, shadcn base, universal --tw init)
      if (/^[a-zA-Z*]/.test(sel) || sel.startsWith('::') || sel.startsWith(':where(') || sel.startsWith(':is(')) {
        model.baseRules.push({ selector: sel, css, media: media || null });
        continue;
      }
      // combinators: group-hover / peer / dark descendant / data-state → approximated
      model.complexRules.push({ kind: selectorKind(sel), selectorText: sel, media: media || null, css });
    }
    order++;
  }

  // NOTE: in modern Chrome CSSStyleRule.cssRules exists (CSS Nesting) and is a
  // truthy empty list, so we must identify style rules by selectorText — not by
  // "has no cssRules" — and detect at-rules by their cssText prefix (rule.type
  // is deprecated / unreliable for @layer/@property/@container).
  function walk(rules, media) {
    for (const rule of rules) {
      const ct = rule.cssText || '';
      if (ct.slice(0, 9) === '@property') { model.atProperty.push(rule.cssText); continue; }
      if (ct.slice(0, 10) === '@font-face') { model.fontFaces.push(rule.cssText); continue; }
      if (ct.slice(0, 10) === '@keyframes' || ct.slice(0, 18) === '@-webkit-keyframes') { model.keyframes.push(rule.cssText); continue; }
      if (rule.selectorText != null) {
        handleStyleRule(rule, media);
        if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules, media); // nested (CSS nesting)
        continue;
      }
      if (rule.media && rule.cssRules) { walk(rule.cssRules, rule.media.mediaText || media); continue; }
      if (rule.cssRules) { walk(rule.cssRules, media); continue; } // @layer / @supports / @container
    }
  }

  for (const sheet of document.styleSheets) {
    try { if (sheet.cssRules) walk(sheet.cssRules, null); } catch { /* cross-origin */ }
  }

  // CSSOM sometimes serializes a rule's declarations as EMPTY values — notably
  // custom @apply component classes with gradients (e.g. .text-gradient-gold →
  // "background-image: ;"). Recover the real values from a probe element's
  // computed style. Only the base context (no media/state) can be probed.
  function splitDeclsLocal(text) {
    const out = []; let depth = 0, buf = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '(') depth++; else if (c === ')') depth--;
      if (c === ';' && depth === 0) { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
      buf += c;
    }
    if (buf.trim()) out.push(buf.trim());
    return out.map((d) => { const i = d.indexOf(':'); return i < 0 ? null : [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }).filter(Boolean);
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-99999px;top:0;';
  document.body.appendChild(probe);
  for (const token of Object.keys(model.classRules)) {
    for (const ctx of model.classRules[token]) {
      if (ctx.media || (ctx.states && ctx.states.length) || ctx.pseudoEl) continue; // base only
      const decls = splitDeclsLocal(ctx.css);
      if (!decls.some(([, v]) => v === '')) continue;
      probe.className = token;
      const cs = getComputedStyle(probe);
      const fixed = decls.map(([p, v]) => {
        if (v !== '') return `${p}: ${v}`;
        let cv = cs.getPropertyValue(p);
        if ((p === 'background-clip' || p === 'background-image') && cv) {
          // mirror background-clip:text to the -webkit- prefix for Safari
        }
        return cv ? `${p}: ${cv}` : null;
      }).filter(Boolean);
      // ensure -webkit-background-clip mirrors background-clip:text (gradient text)
      if (/background-clip:\s*text/.test(ctx.css) || cs.getPropertyValue('background-clip') === 'text') {
        if (!fixed.some((d) => d.startsWith('-webkit-background-clip'))) fixed.push('-webkit-background-clip: text');
      }
      ctx.css = fixed.join('; ') + ';';
    }
  }
  probe.remove();

  // Font <link>s (Google Fonts etc.) to preserve typography.
  document.querySelectorAll('link[rel="stylesheet"],link[rel="preload"][as="font"]').forEach((l) => {
    const href = l.href || l.getAttribute('href') || '';
    if (/fonts\.googleapis|fonts\.gstatic|use\.typekit|typekit|fontshare|rsms\.me|cdnfonts|bunny\.net|fontsource/i.test(href)
      && !model.fontLinks.includes(href)) model.fontLinks.push(href);
  });

  // Asset URLs: <img src/srcset>, <source>, and url(...) in inline styles / bg tokens.
  const assets = new Set();
  document.querySelectorAll('img[src],source[srcset],img[srcset]').forEach((el) => {
    if (el.getAttribute('src')) assets.add(el.src);
    const ss = el.getAttribute('srcset');
    if (ss) ss.split(',').forEach((p) => { const u = p.trim().split(/\s+/)[0]; if (u) { try { assets.add(new URL(u, location.href).href); } catch {} } });
  });
  document.querySelectorAll('[style*="url("]').forEach((el) => {
    const m = el.getAttribute('style').match(/url\((['"]?)([^'")]+)\1\)/g) || [];
    m.forEach((u) => { const mm = u.match(/url\((['"]?)([^'")]+)\1\)/); if (mm) { try { assets.add(new URL(mm[2], location.href).href); } catch {} } });
  });
  model.assets = [...assets];

  model.html = '<!doctype html>\n' + document.documentElement.outerHTML;
  model.title = document.title || '';
  return model;
}

async function captureSite(url, { viewportWidth = 1280 } = {}) {
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: viewportWidth, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 900)); // let late hydration settle
    // Let on-view animations COMPLETE so JS-driven finals are captured:
    //   - progress bars animate width 0 -> N%  (we want the final width)
    //   - count-up numbers animate 0 -> N       (we want the final text)
    //   - fade/slide reveals animate opacity 0 -> 1 (we DON'T want the final —
    //     we reconstruct these, so we snapshot their "from" state first and
    //     restore it afterward).
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // snapshot animation FROM-states BEFORE animating (opacity/transform/
      // width/height that start at 0 — progress bars, scale-in dots, reveals)
      window.__revealFrom = new Map();
      document.querySelectorAll('[style]').forEach((el) => {
        const s = el.getAttribute('style') || '';
        if (/opacity:\s*0(\D|$)/.test(s)
          || /transform:\s*(?!none)[^;]*(translate|scale|rotate)/.test(s)
          || /(^|;)\s*width:\s*0(px|%)?\s*(;|$)/.test(s)
          || /(^|;)\s*height:\s*0(px|%)?\s*(;|$)/.test(s)) {
          window.__revealFrom.set(el, s);
        }
      });
      // slow scroll so IntersectionObserver-driven animations run to completion
      const h = () => document.body.scrollHeight;
      for (let y = 0; y <= h(); y += 400) { window.scrollTo(0, y); await sleep(120); }
      window.scrollTo(0, h()); await sleep(1000);
      window.scrollTo(0, 0); await sleep(300);
    });
    // Reveal collapsed content so it's in the captured DOM. Accordions (radix or
    // custom React) unmount/hide closed panels; we safely click likely triggers.
    // Standard aria accordions are then re-collapsed (script.js re-expands on
    // click); custom no-aria ones are left revealed so their content isn't lost.
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const startHref = location.href;
      const CTA = /reserve|register|\bbuy\b|apply|\bhold\b|download|submit|\bstart\b|\bbook\b|subscribe|contact|close|\bmenu\b|\bplay\b|\bprev\b|\bnext\b|log ?in|sign ?up|sign ?in|checkout|add to/i;

      document.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; });

      // Standard aria accordions: click, capture content, then re-collapse.
      const ariaTriggers = Array.from(document.querySelectorAll('[aria-expanded="false"][aria-controls]'));
      const touched = [];
      for (const t of ariaTriggers) { try { t.click(); touched.push({ t, id: t.getAttribute('aria-controls') }); } catch {} await sleep(15); }
      await sleep(120);
      for (const { t, id } of touched) {
        t.setAttribute('aria-expanded', 'false'); t.setAttribute('data-state', 'closed');
        const p = id && document.getElementById(id);
        if (p) { p.setAttribute('hidden', ''); p.setAttribute('data-state', 'closed'); }
      }

      // Custom accordions (no aria), often single-open (opening one unmounts the
      // others). Click each trigger, STASH a copy of the revealed panel so it
      // survives the next click, mark it hidden (collapsed), then collapse the
      // real one. script.js toggles the stashed panels via data-acc-*.
      const cands = Array.from(document.querySelectorAll('button, [role="button"], summary')).filter((el) => {
        if (el.closest('a')) return false;
        if (el.hasAttribute('aria-expanded')) return false; // handled above
        const ty = (el.getAttribute('type') || '').toLowerCase();
        if (ty === 'submit' || ty === 'reset') return false;
        if (el.getAttribute('aria-haspopup') || /dialog|modal/.test(el.getAttribute('aria-controls') || '')) return false; // don't open modals
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt || txt.length > 120 || CTA.test(txt)) return false;
        const hasIcon = !!el.querySelector('svg');
        const isQuestion = /\?$/.test(txt);
        const inAccordion = !!el.closest('[class*="accordion" i],[class*="faq" i],[class*="collaps" i],[class*="disclosure" i]');
        return inAccordion || (hasIcon && (isQuestion || txt.length <= 80));
      });
      const startPath = new URL(startHref).pathname;
      // The revealed panel may appear as a child of the trigger's parent OR a
      // higher ancestor. Snapshot a few levels and detect where children grew.
      const ancestorsOf = (el) => {
        const out = []; let p = el.parentElement;
        for (let i = 0; i < 4 && p && p !== document.body; i++) { out.push(p); p = p.parentElement; }
        return out;
      };
      const addedIn = (ancs, snaps, el) => {
        for (let i = 0; i < ancs.length; i++) {
          const add = Array.from(ancs[i].children).filter((c) => !snaps[i].has(c) && c !== el && !c.contains(el) && !c.hasAttribute('data-acc-panel'));
          if (add.length) return { host: ancs[i], add };
        }
        return null;
      };
      for (const el of cands) {
        const ancs = ancestorsOf(el);
        if (!ancs.length) continue;
        try {
          const snaps = ancs.map((a) => new Set(Array.from(a.children)));
          el.click(); await sleep(80);
          if (new URL(location.href).pathname !== startPath) { history.pushState(null, '', startHref); break; }
          let info = addedIn(ancs, snaps, el);
          if (!info) { el.click(); await sleep(80); info = addedIn(ancs, snaps, el); }
          if (info) {
            el.setAttribute('data-acc-trigger', '');
            for (const node of info.add) {
              const clone = node.cloneNode(true);
              clone.setAttribute('data-acc-panel', '');
              clone.setAttribute('hidden', '');
              node.parentNode.insertBefore(clone, node.nextSibling);
            }
            el.click(); await sleep(40); // collapse the real panel; hidden clone remains
          }
        } catch { /* ignore */ }
      }
      await sleep(150);

      // Close any modal/dialog left open (incl. auto-open-on-load) so the
      // captured page isn't blocked. Hide (not remove) to preserve content.
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch {}
      // Also click any modal close buttons.
      document.querySelectorAll('[aria-label="Close" i], [aria-label="close" i], button[class*="close" i]').forEach((b) => { try { b.click(); } catch {} });
      await sleep(100);
      document.querySelectorAll('[role="dialog"], [aria-modal="true"]').forEach((d) => { d.setAttribute('hidden', ''); });
      // Custom modals have no role: detect by structure. A fixed/absolute,
      // high-z element that is either a near-fullscreen backdrop OR a centered
      // panel containing a form/heading is almost certainly an open modal.
      Array.from(document.querySelectorAll('body *')).forEach((el) => {
        const c = getComputedStyle(el);
        if (c.position !== 'fixed' && c.position !== 'absolute') return;
        const z = parseFloat(c.zIndex) || 0;
        if (z < 30) return;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 40) return;
        const full = r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
        const hasBg = c.backgroundColor && c.backgroundColor !== 'rgba(0, 0, 0, 0)';
        const centeredPanel = r.width < window.innerWidth * 0.92 && r.top > 0 && r.left > 4
          && !!el.querySelector('input, textarea, form, h1, h2, h3, [class*="close" i]');
        const looksModal = /modal|dialog|popup|overlay|backdrop/i.test(el.className || '') || el.getAttribute('data-state') === 'open';
        // sticky headers/footers span full width but little height — exclude those
        const bannerish = r.height < window.innerHeight * 0.35 && (r.top < 8 || r.bottom > window.innerHeight - 8);
        if (((full && hasBg) || centeredPanel || looksModal) && !bannerish) el.setAttribute('hidden', '');
      });
      await sleep(60);

      // Restore fade/slide reveal "from" states (opacity/transform) that the
      // scroll animated to their final visible values — so build.js can mark
      // them data-reveal and script.js re-animates them. Progress-bar widths and
      // count-up numbers keep their FINAL values (we don't touch those).
      if (window.__revealFrom) {
        window.__revealFrom.forEach((from, el) => {
          try {
            const tm = (from.match(/transform:\s*([^;]+)/) || [])[1];
            if (/opacity:\s*0(\D|$)/.test(from)) el.style.opacity = '0';
            if (tm && /(translate|scale|rotate)/.test(tm)) el.style.transform = tm.trim();
          } catch { /* ignore */ }
        });
      }
      await sleep(40);
    });
    await new Promise((r) => setTimeout(r, 150));
    const model = await page.evaluate(extractModel);
    model.url = url;
    return model;
  } finally {
    await browser.close();
  }
}

module.exports = { captureSite };
