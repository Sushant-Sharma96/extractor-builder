// fetch-page.js
// Lovable pages are React SPAs: the HTML served on first load is usually an
// empty <div id="root"></div> shell, with all content rendered client-side by
// JavaScript. So we:
//   1. try a plain HTTP fetch (fast, no browser),
//   2. if the returned body looks like an unrendered shell, fall back to a
//      headless Chromium render via Puppeteer (loaded lazily so the server
//      still boots even if Chromium isn't installed).
//
// For PIXEL-FAITHFUL extraction we don't reverse-map Tailwind class names —
// we render the page in Chromium and read the *real computed styles* of every
// element (resolved colors, gradients, shadows, borders, fonts). That is the
// only way to reproduce a shadcn/Lovable page exactly, because its colors live
// in per-project CSS variables that class names alone can't reveal.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function looksUnrendered(html) {
  if (!html || html.length < 200) return true;
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const emptyRoot = /<div[^>]*id=["']root["'][^>]*>\s*<\/div>/i.test(html);
  return emptyRoot || stripped.length < 400;
}

async function plainFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

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

// The in-page capture. Runs inside the rendered page. For every element in the
// body it:
//   - stamps a stable data-sx index (so we can match DOM node -> styles later),
//   - records only the computed properties that DIFFER from a bare element of
//     the same tag (so we keep what the site actually styled, not every UA
//     default). Colors/gradients/shadows come out fully resolved.
// Returns the stamped outerHTML plus the style map and the body's own styling.
/* istanbul ignore next -- runs in browser context */
function pageCapture() {
  const PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self',
    'align-content', 'order', 'flex-grow', 'flex-shrink', 'flex-basis',
    'gap', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
    'grid-auto-flow', 'grid-auto-rows',
    'justify-items', 'place-items', 'place-content',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-right-radius', 'border-bottom-left-radius',
    'background-color', 'background-image', 'background-size', 'background-position',
    'background-repeat', 'background-clip', '-webkit-background-clip', '-webkit-text-fill-color',
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
    'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line', 'white-space',
    'box-shadow', 'opacity', 'transform', 'transform-origin', 'filter', 'backdrop-filter',
    'overflow-x', 'overflow-y', 'object-fit', 'object-position', 'cursor', 'list-style-type',
    'text-overflow', '-webkit-line-clamp', 'visibility', 'pointer-events',
  ];
  const REPLACED = { IMG: 1, SVG: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1, PICTURE: 1 };

  // Chrome now serializes computed colors as lab()/oklab(). Round-trip every
  // color through a canvas so we emit clean, widely-compatible #hex / rgba().
  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  function toColor(v) {
    if (!v || v === 'transparent') return v;
    try {
      // Render the color (canvas parses lab/oklab/oklch fine) then read the
      // actual sRGB bytes back — robust no matter how Chrome serializes it.
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      if (a === 0) return 'transparent';
      if (a === 255) return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
      return `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
    } catch { return v; }
  }
  const NOOP = {
    'min-width': 'auto', 'min-height': 'auto', 'max-width': 'none', 'max-height': 'none',
    'flex-basis': 'auto', 'aspect-ratio': 'auto',
  };

  const defaultsCache = {};
  function defaultsFor(tag) {
    if (defaultsCache[tag]) return defaultsCache[tag];
    const ref = document.createElement(tag);
    document.body.appendChild(ref);
    const cs = getComputedStyle(ref);
    const d = {};
    for (const p of PROPS) d[p] = cs.getPropertyValue(p);
    document.body.removeChild(ref);
    defaultsCache[tag] = d;
    return d;
  }

  function parseFontFamilyNames(stack) {
    if (!stack) return [];
    return stack.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''))
      .filter((f) => f && !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|inherit|initial)$/i.test(f));
  }

  const styles = {};
  const bodyFont = getComputedStyle(document.body).getPropertyValue('font-family');
  const fontFamilies = new Set(parseFontFamilyNames(bodyFont));
  const fontLinks = [];
  const fontFaces = [];

  document.querySelectorAll('link[rel="stylesheet"], link[rel="preload"][as="font"]').forEach((link) => {
    const href = link.href || link.getAttribute('href') || '';
    if (/fonts\.googleapis|fonts\.gstatic|use\.typekit|typekit\.net|cloud\.typenetwork|fast\.ly.*font|fontshare|rsms\.me\/inter|cdnfonts|bunny\.net\/font|fontsource|\/font/i.test(href)) {
      if (!fontLinks.includes(href)) fontLinks.push(href);
    }
  });

  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.type === CSSRule.FONT_FACE_RULE) fontFaces.push(rule.cssText);
          if (rule.type === CSSRule.IMPORT_RULE && /font/i.test(rule.href || '')) {
            if (rule.href && !fontLinks.includes(rule.href)) fontLinks.push(rule.href);
          }
        }
      } catch { /* cross-origin stylesheet */ }
    }
  } catch { /* ignore */ }

  const els = document.body.querySelectorAll('*');
  let i = 0;
  for (const el of els) {
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'LINK' || tag === 'META') continue;
    const idx = i++;
    el.setAttribute('data-sx', String(idx));

    const cs = getComputedStyle(el);
    // Hidden at this viewport: record only that fact.
    if (cs.getPropertyValue('display') === 'none') {
      styles[idx] = { display: 'none' };
      continue;
    }

    const defaults = defaultsFor(tag);
    const out = {};
    for (const p of PROPS) {
      let v = cs.getPropertyValue(p);
      if (!v) continue;
      if (p === 'font-family') {
        // Tag defaults inherit body font and would hide real overrides (h1, .font-display, etc.).
        if (v !== bodyFont) {
          out[p] = v;
          parseFontFamilyNames(v).forEach((f) => fontFamilies.add(f));
        }
        continue;
      }
      if (v === defaults[p]) continue;
      if (NOOP[p] === v) continue;
      if (p.indexOf('color') !== -1) v = toColor(v);
      out[p] = v;
    }

    const rect = el.getBoundingClientRect();

    // Don't hardcode block widths/heights (they flow from layout). Keep sizing
    // only for replaced elements (img, svg, video, etc.).
    if (!REPLACED[tag]) {
      delete out.width;
      delete out.height;
    }
    if (out.width === 'auto') delete out.width;
    if (out.height === 'auto') delete out.height;

    // min-h-screen etc. resolve to a pixel viewport height — restore the vh.
    if (out['min-height'] && Math.abs(parseFloat(out['min-height']) - window.innerHeight) < 2) out['min-height'] = '100vh';
    if (out.height && Math.abs(parseFloat(out.height) - window.innerHeight) < 2) out.height = '100vh';

    // Centered block (mx-auto): equal positive L/R margins on an element
    // narrower than its parent — emit auto so it re-centers at any width.
    const ml = out['margin-left'];
    const mr = out['margin-right'];
    if (ml && mr && ml === mr && parseFloat(ml) > 0) {
      const parent = el.parentElement;
      if (parent && rect.width < parent.clientWidth - 1) {
        out['margin-left'] = 'auto';
        out['margin-right'] = 'auto';
      }
    }

    // Absolutely-positioned elements: computed insets are frozen pixels from the
    // capture width. Reconstruct translate-based centering (left-1/2 + -translate-x-1/2)
    // and drop over-constrained insets so they don't overflow at other widths.
    const pos = cs.getPropertyValue('position');
    if (pos === 'absolute' || pos === 'fixed') {
      const op = el.offsetParent || document.body;
      const pw = op.clientWidth || op.getBoundingClientRect().width;
      const ph = op.clientHeight || op.getBoundingClientRect().height;
      const tr = cs.getPropertyValue('transform');
      const mm = tr && tr.indexOf('matrix') === 0 ? tr.match(/matrix\(([^)]+)\)/) : null;
      if (mm) {
        const p = mm[1].split(',').map(parseFloat);
        const tx = p[4], ty = p[5];
        if (out.left != null && Math.abs(tx + rect.width / 2) < 2) { out.left = '50%'; delete out.right; }
        if (out.top != null && Math.abs(ty + rect.height / 2) < 2) { out.top = '50%'; delete out.bottom; }
      }
      // Frozen pixel insets from the capture width don't reflow. Small ones are
      // corner offsets (keep px); large proportional ones become percentages.
      const scale = (prop, dim) => {
        const v = out[prop];
        if (v && /px$/.test(v)) {
          const n = parseFloat(v);
          if (Math.abs(n) <= 96) return; // corner offsets — keep px
          if (dim > 0 && Math.abs(n) > 48 && Math.abs(n) < dim) out[prop] = (Math.round((n / dim) * 1000) / 10) + '%';
        }
      };
      scale('left', pw); scale('right', pw); scale('top', ph); scale('bottom', ph);
      if (out.left != null && out.right != null && out.width != null) delete out.right;
      if (out.top != null && out.bottom != null && out.height != null) delete out.bottom;
      // Corner-anchored overlays: drop the opposite inset so the box can size naturally.
      if (pos === 'fixed' || pos === 'sticky') {
        if (out.bottom != null) delete out.top;
        else if (out.top != null) delete out.bottom;
        if (out.left != null) delete out.right;
        else if (out.right != null) delete out.left;
      }
    }

    styles[idx] = out;
  }

  const bcs = getComputedStyle(document.body);
  const bodyStyle = {
    'background-color': toColor(bcs.getPropertyValue('background-color')),
    color: toColor(bcs.getPropertyValue('color')),
    'font-family': bodyFont,
    'font-size': bcs.getPropertyValue('font-size'),
    'line-height': bcs.getPropertyValue('line-height'),
  };

  return {
    html: '<!doctype html>\n' + document.documentElement.outerHTML,
    styles,
    bodyStyle,
    title: document.title || '',
    fontLinks,
    fontFaces,
    fontFamilies: [...fontFamilies],
  };
}

async function headlessCapture(url, { viewportWidth = 1280 } = {}) {
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: viewportWidth, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 800)); // let late hydration settle
    return await page.evaluate(pageCapture);
  } finally {
    await browser.close();
  }
}

// Faithful extraction needs a browser (only a browser resolves computed
// styles). If Puppeteer is missing we degrade gracefully to a plain fetch with
// no computed styles, and the caller falls back to class-name mapping.
async function fetchRenderedHtml(url, { forceHeadless = false, capture = false } = {}) {
  if (capture) {
    try {
      const cap = await headlessCapture(url);
      return { html: cap.html, computed: cap.styles, bodyStyle: cap.bodyStyle, pageTitle: cap.title, fontLinks: cap.fontLinks, fontFaces: cap.fontFaces, fontFamilies: cap.fontFamilies, mode: 'headless' };
    } catch (e) {
      if (/puppeteer/i.test(e.message)) {
        const html = await plainFetch(url);
        return { html, computed: null, mode: 'fetch' };
      }
      throw e;
    }
  }

  let html = '';
  let mode = 'fetch';
  if (!forceHeadless) {
    try {
      html = await plainFetch(url);
    } catch {
      html = '';
    }
  }
  if (forceHeadless || looksUnrendered(html)) {
    const cap = await headlessCapture(url);
    return { html: cap.html, computed: cap.styles, bodyStyle: cap.bodyStyle, pageTitle: cap.title, fontLinks: cap.fontLinks, fontFaces: cap.fontFaces, fontFamilies: cap.fontFamilies, mode: 'headless' };
  }
  return { html, computed: null, mode };
}

module.exports = { fetchRenderedHtml, looksUnrendered };
