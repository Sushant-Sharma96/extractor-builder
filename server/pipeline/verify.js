'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Stage 5 — Verify harness. THE ACCEPTANCE GATE for a conversion.
//   verify({ url, ir, output, config }) → report
//
// Renders the ORIGINAL (url) and the V2 OUTPUT (output.html) with identical
// instrumentation in one browser session, then runs 6 validators:
//   DOM structure · CSS fidelity · Behavior · Console/runtime · Visual · A11y
// Each yields { score, pass, advisory, findings }. The gate passes iff every
// BLOCKING validator passes. Visual + A11y are advisory until thresholds are
// baselined against the reference set (honest default — no false green).
//
// Dependency-free: visual diff uses the browser's own canvas decoder; a11y is a
// curated in-page ruleset. Verify may render (impure) — it is the gate, not the
// deterministic generator.
// ─────────────────────────────────────────────────────────────────────────────

const cheerio = require('cheerio');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ── Section-partition validator ───────────────────────────────────────────────
// Builds a content "bag" (per-atom text tokens + media/interactive signatures,
// boundary-independent) for a static HTML body, then compares SOURCE vs OUTPUT:
//   coverage = 1 − missing/source   (dropped regions ⇒ <100%)
//   overlap  = extra/output         (duplicated/nested regions ⇒ >0%)
// A perfect partition is coverage=100% ∧ overlap=0%. Same cheerio parse for both
// sides, so the comparison is exact (matches the offline proof).
const PARTITION_ATOM = 'img,svg,video,iframe,picture,canvas,input,button,select,textarea,a[href]';
function contentBag(html) {
  const $ = cheerio.load(html || '<body></body>');
  const scope = $('body').length ? $('body') : $.root();
  const bag = new Map(); const add = (t) => { if (t) bag.set(t, (bag.get(t) || 0) + 1); };
  const norm = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []);
  scope.find('*').each((_, el) => {
    const tag = (el.tagName || '').toLowerCase();
    if (['script', 'style', 'noscript', 'template', 'title', 'head'].includes(tag)) return;
    if ($(el).parents('.et-video-facade').length) return; // synthetic facade internals — not source content
    norm($(el).clone().children().remove().end().text()).forEach(add); // own (direct) text
  });
  scope.find(PARTITION_ATOM).each((_, el) => {
    const $el = $(el);
    if ($el.parents('.et-video-facade').length) return; // skip facade internals (svg icon); the button itself carries @video
    // Video embeds: a source <iframe> and its generated facade (<button data-embed>)
    // are the SAME content — normalize both to the video id so partition matches.
    const embed = $el.attr('src') || $el.attr('data-embed') || '';
    const vid = (embed.match(/(?:vimeo\.com\/video\/|youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([\w-]+)/) || [])[1];
    if (vid) { add('@video:' + vid); return; }
    add('@' + el.tagName.toLowerCase() + ':' + String($el.attr('src') || $el.attr('href') || $el.attr('alt') || $el.attr('aria-label') || '').slice(0, 48));
  });
  return bag;
}
function partitionCheck(sourceHtml, outputHtml) {
  const bs = contentBag(sourceHtml), bo = contentBag(outputHtml);
  let sSum = 0, oSum = 0, missing = 0, extra = 0; const sampleMiss = [], sampleExtra = [];
  new Set([...bs.keys(), ...bo.keys()]).forEach((k) => {
    const s = bs.get(k) || 0, o = bo.get(k) || 0; sSum += s; oSum += o;
    if (o < s) { missing += s - o; if (sampleMiss.length < 6) sampleMiss.push(k + '×' + (s - o)); }
    if (o > s) { extra += o - s; if (sampleExtra.length < 6) sampleExtra.push(k + '×' + (o - s)); }
  });
  return { coverage: sSum ? 1 - missing / sSum : 1, overlap: oSum ? extra / oSum : 0, missing, extra, sourceUnits: sSum, outputUnits: oSum, sampleMiss, sampleExtra };
}

function loadPuppeteer() { try { return require('puppeteer'); } catch (e) { throw new Error('Verify needs "puppeteer" (npm install puppeteer).'); } }

const DEFAULTS = {
  viewport: { width: 1280, height: 900 },
  maxKeys: 500,
  matchSelectors: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'button', 'blockquote', 'li', 'span'],
  cssProps: ['font-family', 'font-size', 'font-weight', 'color', 'background-color', 'line-height', 'text-align', 'display'],
  thresholds: { domStructure: 0.90, cssFidelity: 0.85, visual: 0.85 },
  blocking: { sectionPartition: true, domStructure: true, cssFidelity: true, behavior: true, console: true, visual: false, a11y: false },
};

/* eslint-disable */
// ── in-page collectors (serialized into the browser) ──────────────────────────
function pageDomSkeleton() {
  var tags = {};
  var all = document.getElementsByTagName('*');
  for (var i = 0; i < all.length; i++) { var t = all[i].tagName.toLowerCase(); tags[t] = (tags[t] || 0) + 1; }
  var landmarks = {
    header: document.querySelectorAll('header,[role=banner]').length,
    footer: document.querySelectorAll('footer,[role=contentinfo]').length,
    nav: document.querySelectorAll('nav,[role=navigation]').length,
    main: document.querySelectorAll('main,[role=main]').length,
    section: document.querySelectorAll('section').length,
    headings: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
    images: document.querySelectorAll('img').length,
    links: document.querySelectorAll('a[href]').length,
    buttons: document.querySelectorAll('button').length,
  };
  return { tags: tags, landmarks: landmarks, total: all.length };
}
function pageComputedAt(cfg) {
  // Key each text-bearing element by tag+content so the SAME element can be matched
  // across the two renders, then compare computed styles of matched pairs. This is
  // robust to element count/order differences (the captured DOM is more complete
  // than a quick goto), unlike positional/first-N sampling.
  var out = {};
  function rec(el) { var cs = getComputedStyle(el), o = {}; for (var i = 0; i < cfg.cssProps.length; i++) o[cfg.cssProps[i]] = cs.getPropertyValue(cfg.cssProps[i]); return o; }
  if (document.body) out['@body'] = rec(document.body);
  var els = []; try { els = [].slice.call(document.querySelectorAll(cfg.matchSelectors.join(','))); } catch (e) {}
  var seen = {};
  for (var k = 0; k < els.length; k++) {
    var el = els[k]; var txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!txt) continue;
    var base = el.tagName.toLowerCase() + '|' + txt; var n = (seen[base] = (seen[base] || 0) + 1);
    out[base + '#' + n] = rec(el);
    if (Object.keys(out).length > (cfg.maxKeys || 500)) break;
  }
  return out;
}
function pageA11y() {
  var v = [];
  if (!document.documentElement.getAttribute('lang')) v.push({ rule: 'html-lang', sev: 'serious', detail: '<html> missing lang' });
  var imgs = document.querySelectorAll('img'), noAlt = 0;
  for (var i = 0; i < imgs.length; i++) { if (imgs[i].getAttribute('alt') == null) noAlt++; }
  if (noAlt) v.push({ rule: 'img-alt', sev: 'serious', detail: noAlt + ' <img> without alt' });
  var btns = document.querySelectorAll('button'), noName = 0;
  for (var b = 0; b < btns.length; b++) { var bt = btns[b]; var name = (bt.textContent || '').trim() || bt.getAttribute('aria-label') || bt.getAttribute('title'); if (!name) noName++; }
  if (noName) v.push({ rule: 'button-name', sev: 'serious', detail: noName + ' <button> without accessible name' });
  // aria-controls / aria-labelledby references resolve
  var dangling = 0; var refs = document.querySelectorAll('[aria-controls],[aria-labelledby],[aria-describedby]');
  for (var r = 0; r < refs.length; r++) {
    ['aria-controls', 'aria-labelledby', 'aria-describedby'].forEach(function (a) {
      var val = refs[r].getAttribute(a); if (!val) return;
      val.split(/\s+/).forEach(function (id) { if (id && !document.getElementById(id)) dangling++; });
    });
  }
  if (dangling) v.push({ rule: 'aria-ref', sev: 'moderate', detail: dangling + ' dangling aria id refs' });
  // heading order (no skips beyond +1)
  var hs = document.querySelectorAll('h1,h2,h3,h4,h5,h6'), prev = 0, skips = 0;
  for (var h = 0; h < hs.length; h++) { var lvl = parseInt(hs[h].tagName[1], 10); if (prev && lvl > prev + 1) skips++; prev = lvl; }
  if (skips) v.push({ rule: 'heading-order', sev: 'moderate', detail: skips + ' heading-level skips' });
  return v;
}
async function pageBehaviorTabs() {
  // returns true if switching tabs changes which panel is unhidden
  var trig = document.querySelector('[data-tab]'); if (!trig) return { ran: false };
  var panels = [].slice.call(document.querySelectorAll('[data-tab-panel]'));
  if (panels.length < 2) return { ran: false };
  function vis() { return panels.map(function (p) { return p.hasAttribute('hidden') ? 0 : 1; }).join(''); }
  var before = vis();
  var second = document.querySelector('[data-tab]:not([data-tab="' + trig.getAttribute('data-tab') + '"])');
  var target = second || trig;
  target.click();
  var after = vis();
  return { ran: true, changed: before !== after, before: before, after: after, activeIdx: target.getAttribute('data-tab') };
}
async function pixelSim(aDataUri, bDataUri) {
  function load(src) { return new Promise(function (r) { var im = new Image(); im.onload = function () { r(im); }; im.onerror = function () { r(null); }; im.src = src; }); }
  var ia = await load(aDataUri), ib = await load(bDataUri);
  if (!ia || !ib) return -1;
  var w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
  var W = Math.min(w, 360), scale = W / w, H = Math.max(1, Math.round(h * scale));
  function grid(img) { var c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; }
  var da = grid(ia), db = grid(ib), diff = 0, tot = da.length / 4;
  for (var i = 0; i < da.length; i += 4) { var d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3; if (d > 30) diff++; }
  return 1 - diff / tot;
}
/* eslint-enable */

// ── scoring helpers (Node) ────────────────────────────────────────────────────
function cosineCounts(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, na = 0, nb = 0;
  keys.forEach((k) => { const x = a[k] || 0, y = b[k] || 0; dot += x * y; na += x * x; nb += y * y; });
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
// Matched-pair fidelity: compare computed styles of elements matched across the
// two renders by tag+content key. Only matched pairs count (unmatched elements are
// a structural concern owned by domStructure/sectionPartition, not CSS fidelity).
function cssMatchRate(o, v, props) {
  let total = 0, match = 0; const misses = []; let matchedKeys = 0;
  Object.keys(o).forEach((key) => {
    if (!v[key]) return;
    matchedKeys += 1;
    props.forEach((p) => {
      const a = (o[key][p] || '').trim(), b = (v[key][p] || '').trim();
      if (!a && !b) return;
      total += 1;
      if (a === b) match += 1; else if (misses.length < 12) misses.push(key.slice(0, 28) + '{' + p + '} orig="' + a.slice(0, 22) + '" v2="' + b.slice(0, 22) + '"');
    });
  });
  const orphanO = Object.keys(o).filter((k) => !v[k]).length;
  const orphanV = Object.keys(v).filter((k) => !o[k]).length;
  return { rate: total ? match / total : 1, total, match, misses, matchedKeys, orphanO, orphanV };
}

async function collect(page, cfg, sink) {
  const dom = await page.evaluate(pageDomSkeleton);
  const computed = await page.evaluate(pageComputedAt, { matchSelectors: cfg.matchSelectors, cssProps: cfg.cssProps, maxKeys: cfg.maxKeys });
  const a11y = await page.evaluate(pageA11y);
  let shot = null;
  try { shot = await page.screenshot({ encoding: 'base64', type: 'png' }); } catch (e) { sink.push('screenshot failed: ' + e.message); }
  return { dom, computed, a11y, shot };
}

async function verify({ url, ir, output, sourceHtml, config } = {}) {
  const cfg = Object.assign({}, DEFAULTS, config || {});
  cfg.thresholds = Object.assign({}, DEFAULTS.thresholds, (config || {}).thresholds);
  cfg.blocking = Object.assign({}, DEFAULTS.blocking, (config || {}).blocking);
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const notes = [];
  const errV = []; const errO = [];
  let O, V, behavior, visualScore = -1;
  try {
    // ORIGINAL
    const pO = await browser.newPage(); await pO.setUserAgent(UA); await pO.setViewport(cfg.viewport);
    pO.on('console', (m) => { if (m.type() === 'error') errO.push(m.text().slice(0, 200)); });
    pO.on('pageerror', (e) => errO.push('pageerror: ' + e.message.slice(0, 200)));
    await pO.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 800));
    O = await collect(pO, cfg, notes);

    // V2 OUTPUT
    const pV = await browser.newPage(); await pV.setUserAgent(UA); await pV.setViewport(cfg.viewport);
    pV.on('console', (m) => { if (m.type() === 'error') errV.push(m.text().slice(0, 200)); });
    pV.on('pageerror', (e) => errV.push('pageerror: ' + e.message.slice(0, 200)));
    await pV.setContent(output.html, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 800));
    V = await collect(pV, cfg, notes);
    // behavior (v2 only)
    behavior = await pV.evaluate(pageBehaviorTabs);

    // visual similarity via canvas page
    if (O.shot && V.shot) {
      const pX = await browser.newPage();
      try { visualScore = await pX.evaluate(pixelSim, 'data:image/png;base64,' + O.shot, 'data:image/png;base64,' + V.shot); } catch (e) { notes.push('pixelSim failed: ' + e.message); }
      await pX.close();
    }
  } finally { await browser.close(); }

  // ── validators ──
  const verdicts = {};
  // Section partition — 100% coverage, 0% overlap, no dropped/duplicated regions.
  if (sourceHtml) {
    const pc = partitionCheck(sourceHtml, output.html);
    const pass = pc.missing === 0 && pc.extra === 0;
    verdicts.sectionPartition = { score: +pc.coverage.toFixed(4), pass, findings: [
      'coverage=' + (pc.coverage * 100).toFixed(2) + '% overlap=' + (pc.overlap * 100).toFixed(2) + '%',
      'missing=' + pc.missing + ' extra=' + pc.extra + ' (source units=' + pc.sourceUnits + ', output units=' + pc.outputUnits + ')',
    ].concat(pc.sampleMiss.length ? ['dropped: ' + pc.sampleMiss.join(', ')] : []).concat(pc.sampleExtra.length ? ['duplicated: ' + pc.sampleExtra.join(', ')] : []) };
  } else {
    verdicts.sectionPartition = { score: null, pass: null, findings: ['sourceHtml not provided — partition check skipped'] };
  }
  // DOM structure
  const tagSim = cosineCounts(O.dom.tags, V.dom.tags);
  const lmSim = cosineCounts(O.dom.landmarks, V.dom.landmarks);
  const domScore = 0.5 * tagSim + 0.5 * lmSim;
  verdicts.domStructure = { score: +domScore.toFixed(3), pass: domScore >= cfg.thresholds.domStructure, findings: ['tagCosine=' + tagSim.toFixed(3), 'landmarkCosine=' + lmSim.toFixed(3), 'origTotal=' + O.dom.total + ' v2Total=' + V.dom.total] };
  // CSS fidelity
  const css = cssMatchRate(O.computed, V.computed, cfg.cssProps);
  verdicts.cssFidelity = { score: +css.rate.toFixed(3), pass: css.rate >= cfg.thresholds.cssFidelity, findings: ['props matched ' + css.match + '/' + css.total + ' over ' + css.matchedKeys + ' matched elements (unmatched orig=' + css.orphanO + ' v2=' + css.orphanV + ')'].concat(css.misses.slice(0, 8)) };
  // Behavior
  const genControllers = (ir && ir.behavior ? ir.behavior.nodes : []).filter((n) => n.type === 'Controller' && n.fallback && n.fallback.action === 'generate');
  const tabsGen = genControllers.some((c) => c.kind === 'tabs');
  let behPass = true; const behFind = [];
  if (tabsGen) {
    if (!behavior || !behavior.ran) { behPass = false; behFind.push('tabs controller generated but no [data-tab]/panels found at runtime'); }
    else if (!behavior.changed) { behPass = false; behFind.push('tab click did not change panel visibility (' + behavior.before + '→' + behavior.after + ')'); }
    else behFind.push('tab switch OK (' + behavior.before + '→' + behavior.after + ')');
  } else behFind.push('no generate-controllers to drive');
  behFind.push(genControllers.length + ' generate-controller(s)');
  verdicts.behavior = { score: behPass ? 1 : 0, pass: behPass, findings: behFind };
  // Console/runtime — gate on errors v2's OWN code introduces. Exclude (a) errors
  // also present in the original (source-inherited) and (b) benign environmental
  // resource/security notices (third-party iframe X-Frame-Options, blocked
  // resources, CSP, analytics) that are not our logic failing.
  const norm = (s) => s.replace(/https?:\/\/[^\s'")]+/g, '<url>').replace(/\d+/g, '#').slice(0, 80);
  const BENIGN = /(X-Frame-Options|Refused to (display|frame|load|execute|apply)|Failed to load resource|net::ERR|ERR_BLOCKED|ERR_CONNECTION|favicon|Content Security Policy|Mixed Content|gtag|analytics|googletag|doubleclick|third-party cookie)/i;
  const baseSet = new Set(errO.map(norm));
  const benignCount = errV.filter((e) => BENIGN.test(e)).length;
  const newErr = errV.filter((e) => !baseSet.has(norm(e)) && !BENIGN.test(e));
  verdicts.console = { score: newErr.length === 0 ? 1 : 0, pass: newErr.length === 0, findings: newErr.length ? newErr.slice(0, 8) : ['0 v2-introduced errors (baseline=' + errO.length + ', benign filtered=' + benignCount + ', v2 total=' + errV.length + ')'], baselineOrig: errO.length, benignFiltered: benignCount, totalV2: errV.length };
  // Visual (advisory)
  verdicts.visual = { score: +Number(visualScore).toFixed(3), pass: visualScore < 0 ? null : visualScore >= cfg.thresholds.visual, advisory: true, findings: visualScore < 0 ? ['visual diff unavailable'] : ['pixel similarity=' + visualScore.toFixed(3)] };
  // A11y (advisory) — v2 should not INTRODUCE issues beyond the original
  const serV = V.a11y.filter((x) => x.sev === 'serious').length;
  verdicts.a11y = { score: serV === 0 ? 1 : 0, pass: serV === 0, advisory: true, findings: (V.a11y.length ? V.a11y.map((x) => x.rule + ':' + x.detail) : ['no violations']).concat(['origSerious=' + O.a11y.filter((x) => x.sev === 'serious').length]) };

  // ── gate ──
  const blockingNames = Object.keys(cfg.blocking).filter((k) => cfg.blocking[k]);
  const failedBlocking = blockingNames.filter((k) => verdicts[k] && verdicts[k].pass === false);
  const gate = { pass: failedBlocking.length === 0, blocking: blockingNames, failedBlocking, notes };

  return { url, gate, verdicts, thresholds: cfg.thresholds };
}

module.exports = { verify, DEFAULTS, partitionCheck, contentBag };
