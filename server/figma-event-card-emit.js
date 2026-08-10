'use strict';
/**
 * Promoted EventCard emit — replaces Figma layer dump with the design-system
 * HTML/CSS contract (docs/EVENT_CARD_COMPONENT_STANDARD.md).
 * Used when analyze() stamped tree.semanticClass === 'event-card'.
 */

const fs = require('fs');
const path = require('path');

function loadEventCardCss() {
  // Always read from disk so design-system token tweaks apply without process restart quirks
  const cssPath = path.join(__dirname, '..', 'design-system', 'event-card', 'EventCard.css');
  try {
    return fs.readFileSync(cssPath, 'utf8');
  } catch {
    return FALLBACK_CSS;
  }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textOf(el) {
  if (!el) return '';
  if (el.text != null) return String(el.text).trim();
  if (el.runs) return el.runs.map((r) => r.text || '').join('').trim();
  return '';
}

function walk(el, fn) {
  if (!el) return;
  fn(el);
  for (const c of el.children || []) walk(c, fn);
}

/**
 * Pull title / image / date / status / cta from a semantically stamped tree.
 */
function extractEventCardModel(tree, resolveImg) {
  const model = {
    title: 'Event',
    imageUrl: '',
    imageAlt: '',
    mode: 'offline',
    statusLabel: 'Offline',
    registrationEndLabel: '',
    registrationEndIso: '',
    ctaLabel: 'Register Now',
    awarded: false,
    awardText: '🏆',
  };

  walk(tree, (el) => {
    const sc = el.semanticClass || '';
    if (sc === 'event-card__title' || el.tag === 'h3') {
      const t = textOf(el);
      if (t) model.title = t;
    }
    if (sc === 'event-card__image' || el.kind === 'img') {
      const u = typeof resolveImg === 'function' ? resolveImg(el) : '';
      if (u && String(u).trim()) model.imageUrl = String(u).trim();
      const alt = (el.attrs && el.attrs.alt) || el.name || model.title;
      if (alt && !/^rectangle|img|image|unavailable/i.test(alt)) model.imageAlt = alt;
      else model.imageAlt = model.title;
    }
    if (sc === 'event-card__meta') {
      model.awarded = true;
      const t = textOf(el);
      if (t) model.awardText = t;
    }
    if (sc === 'event-card__date') {
      const raw = textOf(el);
      model.registrationEndLabel = raw
        .replace(/^registration\s+ends\s+on\s*\|?\s*/i, '')
        .replace(/^\|\s*/, '')
        .trim() || raw;
      if (el.attrs && el.attrs['data-datetime']) {
        model.registrationEndIso = el.attrs['data-datetime'];
      } else {
        const m = raw.match(/\b(\d{1,2})\s+(\d{4})\b/);
        if (m) model.registrationEndIso = `${m[2]}-08-${String(m[1]).padStart(2, '0')}`;
      }
      if (!/registration/i.test(raw) && raw) {
        model.registrationEndLabel = raw;
      } else if (raw) {
        // Keep friendly full line for display inside <time> sibling pattern
        const dateOnly = raw.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*\d{1,2}\s+\d{4}/i);
        model.registrationEndLabel = dateOnly ? dateOnly[0].trim() : model.registrationEndLabel;
      }
    }
    if (sc === 'event-card__status') {
      const t = textOf(el) || 'Offline';
      model.statusLabel = t;
      model.mode = /online/i.test(t) ? 'online' : /hybrid/i.test(t) ? 'hybrid' : 'offline';
    }
    if (sc === 'event-card__button' || el.tag === 'button') {
      const t = textOf(el);
      if (t) model.ctaLabel = t;
    }
  });

  if (!model.imageAlt) model.imageAlt = model.title;
  // Keep http(s) URLs (including Figma signed) so packageSite can download → assets/.
  // Only drop truly empty / data-asset-missing placeholders.
  if (!model.imageUrl || !String(model.imageUrl).trim()) {
    model.imageUrl = '';
  }
  return model;
}

function fontsLink(fonts) {
  const fams = [...new Set((fonts || []).filter(Boolean))];
  if (!fams.length) fams.push('Poppins');
  const q = fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&');
  return `  <link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${q}&display=swap">`;
}

function defaultThumbDataUri(title) {
  const label = String(title || 'EVENT').slice(0, 18).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="100" viewBox="0 0 128 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#3b1f6e"/><stop offset="55%" stop-color="#6b2d8b"/>
    <stop offset="100%" stop-color="#e07a3a"/></linearGradient></defs>
  <rect width="128" height="100" rx="10" fill="url(#g)"/>
  <text x="64" y="48" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="12" font-weight="700">${label.replace(/[<>&]/g, '')}</text>
  <text x="64" y="66" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="7" opacity="0.9">Build. Break. Beyond.</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildEventCardHtml(model, { title = 'Event card', fonts = [] } = {}) {
  const statusAria = `${model.statusLabel} event`;
  const timeInner = model.registrationEndIso
    ? `<time datetime="${esc(model.registrationEndIso)}">${esc(model.registrationEndLabel)}</time>`
    : `<span>${esc(model.registrationEndLabel)}</span>`;

  const awardBlock = model.awarded
    ? `        <p class="event-card__meta" aria-label="Awards">
          <span class="event-card__award" aria-hidden="true">${esc(model.awardText || '🏆')}</span>
          <span class="event-card__award event-card__award--ghost" aria-hidden="true">${esc(model.awardText || '🏆')}</span>
          <span class="visually-hidden">Awarded event</span>
        </p>`
    : '';

  // Prefer real URL; else embed SVG data-URI so the thumb never shows as a broken/empty box
  const src = (model.imageUrl && String(model.imageUrl).trim())
    || defaultThumbDataUri(model.title);
  const img = `<img class="event-card__image" src="${esc(src)}" alt="${esc(model.imageAlt || model.title)}" width="128" height="100">`;

  const dateBlock = model.registrationEndLabel
    ? `      <p class="event-card__date">
        Registration Ends on
        ${timeInner}
      </p>`
    : '';

  const body = `  <main class="page">
    <article class="event-card" data-mode="${esc(model.mode)}">
      <div class="event-card__media">
        ${img}
      </div>
      <div class="event-card__body">
        <div class="event-card__header">
          <h3 class="event-card__title">${esc(model.title)}</h3>
${awardBlock}
        </div>
${dateBlock}
      </div>
      <div class="event-card__actions">
        <p class="event-card__status" aria-label="${esc(statusAria)}">${esc(model.statusLabel)}</p>
        <button class="event-card__button" type="button">${esc(model.ctaLabel)}</button>
      </div>
    </article>
  </main>`;

  const fl = fontsLink(fonts);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
${fl ? fl + '\n' : ''}  <link rel="stylesheet" href="styles.css">
</head>
<body>
${body}
  <script src="script.js"></script>
</body>
</html>
`;
}

function buildEventCardCss(tree) {
  const component = loadEventCardCss();
  const overrides = buildFigmaTokenOverrides(tree);
  return `/* EventCard — Figma paints are source of truth (no invented chrome) */
/* See docs/EVENT_CARD_COMPONENT_STANDARD.md */

*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-family-body, 'Poppins', system-ui, sans-serif);
  color: var(--color-text-primary, #172435);
  -webkit-font-smoothing: antialiased;
  background: #f5f5f5;
}
.page {
  padding: 1.5rem;
  max-width: 48rem;
  margin: 0 auto;
}

${component}
${overrides}
`;
}

/**
 * Override design tokens from Figma node decls when present.
 * Never invent card stroke / gray actions — only copy what Figma emitted.
 */
function buildFigmaTokenOverrides(tree) {
  if (!tree) return '';
  const vars = [];
  let buttonBorder = null;
  let buttonRadius = null;
  let buttonBg = null;
  let cardBg = null;
  let cardRadius = null;
  let divider = null;

  walk(tree, (el) => {
    if (!el || !el.decls) return;
    const sc = el.semanticClass || '';
    const bg = el.decls.get('background-color') || el.decls.get('background');
    const radius = el.decls.get('border-radius');

    if (el === tree || sc === 'event-card') {
      if (bg && !/gradient|url\(/i.test(String(bg))) cardBg = bg;
      if (radius) cardRadius = radius;
    }
    if (sc === 'event-card__button' || el.tag === 'button') {
      if (bg && !/gradient|url\(/i.test(String(bg))) buttonBg = bg;
      if (radius) buttonRadius = radius;
      const border = el.decls.get('border');
      const bw = el.decls.get('border-width');
      const bc = el.decls.get('border-color') || el.decls.get('border-top-color');
      if (border && border !== '0' && border !== 'none') buttonBorder = border;
      else if (bw && bc && bw !== '0') buttonBorder = `${bw} solid ${bc}`;
    }
    const br = el.decls.get('border-right');
    if (br && /solid/i.test(String(br))) {
      const m = String(br).match(/solid\s+(.+)$/i);
      if (m) divider = m[1].trim();
    }
  });

  if (cardBg) vars.push(`  --color-surface: ${cardBg};`);
  if (cardRadius) vars.push(`  --radius-card: ${cardRadius};`);
  if (buttonBg) vars.push(`  --figma-button-bg: ${buttonBg};`);
  if (buttonRadius) vars.push(`  --radius-button: ${buttonRadius};`);
  if (divider) vars.push(`  --color-divider: ${divider};`);

  const rules = [];
  if (vars.length) rules.push(`:root {\n${vars.join('\n')}\n}`);
  if (buttonBg || buttonBorder || buttonRadius) {
    const parts = [];
    if (buttonBg) parts.push(`  background: ${buttonBg};`);
    if (buttonBorder) parts.push(`  border: ${buttonBorder};`);
    if (buttonRadius) parts.push(`  border-radius: ${buttonRadius};`);
    rules.push(`.event-card__button {\n${parts.join('\n')}\n}`);
  }
  return rules.length ? `\n/* Figma node overrides */\n${rules.join('\n')}\n` : '';
}

function buildEventCardJs() {
  return `// EventCard — static demo hook
document.querySelectorAll('.event-card__button').forEach(function (btn) {
  btn.addEventListener('click', function () {
    btn.setAttribute('aria-pressed', 'true');
  });
});
`;
}

/**
 * @returns {{ html, css, js, sections, sectionsSummary, promoted: true, model }}
 */
function emitPromotedEventCard(tree, opts = {}) {
  const resolveImg = (el) =>
    (el.imageRef && opts.imageFillUrls && opts.imageFillUrls[el.imageRef])
    || (opts.imageUrls && opts.imageUrls[el.nodeId])
    || '';
  const model = extractEventCardModel(tree, resolveImg);
  const title = opts.title || model.title || 'Event card';
  const html = buildEventCardHtml(model, { title, fonts: opts.fonts || ['Poppins'] });
  const css = buildEventCardCss(tree);
  const js = buildEventCardJs();
  return {
    html,
    css,
    js,
    sections: [{ key: 'event-card', label: 'Event Card' }],
    sectionsSummary: 'Event Card',
    promoted: true,
    model,
  };
}

const FALLBACK_CSS = `
:root {
  --color-surface: #ffffff;
  --color-text-primary: #172435;
  --color-border: #172435;
  --color-divider: #dadada;
  --color-accent: #172435;
  --font-family-body: 'Poppins', system-ui, sans-serif;
  --font-size-title: 1.125rem;
  --font-size-meta: 1rem;
  --font-size-date: 0.8125rem;
  --font-size-status: 0.75rem;
  --font-size-button: 0.75rem;
  --radius-card: 10px;
  --radius-media: 10px;
  --radius-button: 10px;
  --event-card-max-width: 38.125rem;
  --pad-media: 0.75rem 0 0.75rem 0.625rem;
  --pad-body: 0.75rem 1rem;
  --pad-actions: 0.75rem 1.25rem;
}
.visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
.event-card {
  display: flex; flex-direction: row; align-items: stretch;
  width: 100%; max-width: var(--event-card-max-width); min-height: 7.6875rem;
  padding: 0; box-sizing: border-box; overflow: hidden;
  background: var(--color-surface); border: 0; border-radius: var(--radius-card);
  box-shadow: none; color: var(--color-text-primary); font-family: var(--font-family-body);
}
.event-card__media { flex: 0 0 auto; display: flex; align-items: center; padding: var(--pad-media); }
.event-card__image {
  display: block; width: 8rem; height: 6.25rem; object-fit: cover;
  border-radius: var(--radius-media); border: 0;
}
.event-card__body {
  flex: 1 1 0%; min-width: 0; display: flex; flex-direction: column;
  justify-content: space-between; gap: 0.5rem; padding: var(--pad-body); border: 0;
}
.event-card__header { display: flex; flex-direction: column; gap: 0.35rem; border: 0; }
.event-card__title { margin: 0; font-size: var(--font-size-title); font-weight: 600; line-height: 1.35; }
.event-card__meta {
  margin: 0; display: flex; flex-direction: row; align-items: center; gap: 0.25rem;
  font-size: var(--font-size-meta);
}
.event-card__award--ghost { opacity: 0.35; }
.event-card__date { margin: 0; font-size: var(--font-size-date); font-weight: 500; }
.event-card__actions {
  flex: 0 0 auto; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 0.5rem; min-width: 8.5rem; padding: var(--pad-actions);
  background: transparent; border: 0; border-left: 1px solid var(--color-divider);
}
.event-card__status { margin: 0; font-size: var(--font-size-status); text-align: center; }
.event-card__button {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 7.25rem; min-height: 2rem; padding: 0 0.75rem;
  font: inherit; font-size: var(--font-size-button); font-weight: 500;
  color: var(--color-text-primary); background: #ffffff;
  border: 1px solid var(--color-border); border-radius: var(--radius-button);
  cursor: pointer; box-sizing: border-box; box-shadow: none;
}
.event-card__button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
@media (max-width: 720px) {
  .event-card { flex-direction: column; min-height: 0; }
  .event-card__image { width: 100%; height: auto; max-height: 15rem; }
  .event-card__actions {
    width: 100%; min-width: 0; flex-direction: row; justify-content: space-between;
    border-left: 0; border-top: 1px solid var(--color-divider);
  }
  .event-card__button { min-height: 2.75rem; }
}
`;

module.exports = {
  extractEventCardModel,
  emitPromotedEventCard,
  buildEventCardHtml,
  buildEventCardCss,
  buildFigmaTokenOverrides,
};
