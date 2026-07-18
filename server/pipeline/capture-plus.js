'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Capture++ (Stage 1 of the v2 pipeline). ISOLATED + READ-ONLY.
//   • Opens its OWN headless page (never touches v1 capture.js).
//   • Pass A — computed-style resolver (sourceOfTruth: computed-style).
//   • Pass B — runtime probe: injected vars, animations, behavior transitions
//     (sourceOfTruth: runtime).
//   • Config-driven (capture-plus.config.js) — detectors/selectors/properties
//     are data, not code. Output is raw, provenance-tagged material for DG/BG.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = require('./capture-plus.config');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function loadPuppeteer() {
  try { return require('puppeteer'); } catch (e) {
    throw new Error('Capture++ needs "puppeteer" installed (npm install puppeteer).');
  }
}
function mergeConfig(user = {}) {
  return {
    viewports: user.viewports || DEFAULTS.viewports,
    computed: Object.assign({}, DEFAULTS.computed, user.computed),
    probe: Object.assign({}, DEFAULTS.probe, user.probe),
    detectors: [...(DEFAULTS.detectors || []), ...(user.detectors || [])],
  };
}

// ── in-page functions (serialized into the browser; self-contained) ──────────
/* eslint-disable */
function instrument() {
  // record WAAPI, IntersectionObserver targets, and in-flight fetch, before boot
  window.__waapi = [];
  var A = Element.prototype.animate;
  if (A) Element.prototype.animate = function (kf, opts) { try { window.__waapi.push({ tag: (this.tagName || '').toLowerCase(), cls: (this.getAttribute && this.getAttribute('class')) || '' }); } catch (e) {} return A.call(this, kf, opts); };
  window.__io = new Set();
  var NIO = window.IntersectionObserver;
  if (NIO) window.IntersectionObserver = function (cb, o) { var i = new NIO(cb, o); var ob = i.observe.bind(i); i.observe = function (el) { try { if (el && el.nodeType === 1) window.__io.add(el); } catch (e) {} return ob(el); }; return i; };
  window.__net = 0;
  var F = window.fetch;
  if (F) window.fetch = function () { window.__net++; return F.apply(this, arguments).finally(function () { window.__net--; }); };
}
function pageSnapshotComputed(cfg) {
  function pathOf(n) { var s = ''; var g = 0; while (n && n.nodeType === 1 && n !== document.body && g < 12) { var i = 1, p = n; while ((p = p.previousElementSibling)) i++; s = n.tagName.toLowerCase() + ':nth(' + i + ')>' + s; n = n.parentElement; g++; } return s.slice(0, -1); }
  var out = [], seen = new Set(), n = 0;
  var els = [document.documentElement, document.body].concat([].slice.call(document.querySelectorAll(cfg.interestingSelector)));
  for (var k = 0; k < els.length; k++) {
    var el = els[k]; if (!el || seen.has(el)) continue; seen.add(el); if (n++ >= cfg.maxElements) break;
    var cs = getComputedStyle(el), props = {};
    for (var j = 0; j < cfg.properties.length; j++) props[cfg.properties[j]] = cs.getPropertyValue(cfg.properties[j]);
    out.push({ tag: el.tagName.toLowerCase(), cls: (el.getAttribute('class') || '').slice(0, 160), path: pathOf(el), props: props });
  }
  return out;
}
function pageSnapshotAnimations() {
  var active = [];
  try {
    var list = document.getAnimations ? document.getAnimations() : [];
    active = list.map(function (a) {
      var t = a.effect && a.effect.target;
      return { name: a.animationName || null, kind: a.animationName ? 'css-animation' : 'waapi', playState: a.playState,
        target: t ? (t.tagName || '').toLowerCase() + (t.getAttribute && t.getAttribute('class') ? '.' + (t.getAttribute('class').split(' ')[0]) : '') : null };
    });
  } catch (e) {}
  return { active: active, waapiCalls: (window.__waapi || []).length, ioObserved: (window.__io ? window.__io.size : 0) };
}
async function pageRunProbes(cfg) {
  function pathOf(n) { var s = ''; var g = 0; while (n && n.nodeType === 1 && n !== document.body && g < 12) { var i = 1, p = n; while ((p = p.previousElementSibling)) i++; s = n.tagName.toLowerCase() + ':nth(' + i + ')>' + s; n = n.parentElement; g++; } return s.slice(0, -1); }
  function snap(scope) {
    var nodes = [scope].concat([].slice.call(scope.querySelectorAll('*'))).slice(0, 200);
    return nodes.map(function (n) {
      return { p: pathOf(n),
        a: n.getAttribute('aria-expanded') + '|' + n.getAttribute('data-state') + '|' + (n.hidden ? '1' : '0'),
        c: n.getAttribute('class') || '',
        v: (n.getAttribute('style') || '').match(/--[\w-]+\s*:[^;]+/g) || [] };
    });
  }
  // settle waits only for animations STARTED by this interaction — ambient/infinite
  // ones running before the click (e.g. background drifts) are baselined and ignored,
  // otherwise a looping animation would prevent settle forever.
  function settle(baseAnims) {
    return new Promise(function (res) {
      var done = false, quiet, t0 = Date.now();
      var mo = new MutationObserver(function () { clearTimeout(quiet); quiet = setTimeout(check, cfg.settleQuietMs); });
      try { mo.observe(document.documentElement, { subtree: true, attributes: true, childList: true }); } catch (e) {}
      function fin() { if (!done) { done = true; try { mo.disconnect(); } catch (e) {} res(Date.now() - t0 >= cfg.perCandidateTimeoutMs); } }
      function check() {
        var anims = document.getAnimations ? document.getAnimations() : [];
        var pending = anims.some(function (a) {
          if (a.playState !== 'running' || baseAnims.has(a)) return false;         // ignore pre-existing/ambient
          var it = a.effect && a.effect.getTiming ? a.effect.getTiming().iterations : 1;
          return it !== Infinity;                                                   // wait only on finite new animations
        });
        if (!pending && !(window.__net > 0)) fin();
        else if (Date.now() - t0 > cfg.perCandidateTimeoutMs) fin();
        else quiet = setTimeout(check, cfg.settleQuietMs);
      }
      quiet = setTimeout(check, cfg.settleQuietMs);
      setTimeout(fin, cfg.perCandidateTimeoutMs + 200);
    });
  }
  var all = [].slice.call(document.querySelectorAll(cfg.interactionSignals));
  var cands = all.slice(0, cfg.cap);
  var behaviors = [], runtimeVars = [], timeouts = 0, probed = 0;
  for (var i = 0; i < cands.length; i++) {
    var el = cands[i];
    try {
      if (cfg.skipAnchorNavigation && el.tagName === 'A') { var h = el.getAttribute('href') || ''; if (h && h[0] !== '#') continue; }
      var scope = el.closest('section,article,li,div') || el;
      var before = snap(scope);
      var baseAnims = new Set(document.getAnimations ? document.getAnimations() : []); // ambient baseline
      probed++;
      el.click();
      var timedOut = await settle(baseAnims); if (timedOut) timeouts++;
      var after = snap(scope);
      var bmap = {}; before.forEach(function (x) { bmap[x.p] = x; });
      var diffs = [];
      after.forEach(function (x) {
        var b = bmap[x.p];
        if (!b) { diffs.push({ p: x.p, change: 'added' }); return; }
        if (b.a !== x.a || b.c !== x.c) diffs.push({ p: x.p, aBefore: b.a, aAfter: x.a, classChanged: b.c !== x.c });
        var nv = x.v.filter(function (v) { return b.v.indexOf(v) < 0; });
        nv.forEach(function (v) { runtimeVars.push({ name: v.split(':')[0].trim(), on: x.p, via: 'click' }); });
      });
      if (diffs.length) behaviors.push({ trigger: { selector: pathOf(el), event: 'click' }, diffs: diffs.slice(0, 20) });
    } catch (e) {}
  }
  return { behaviors: behaviors, runtimeVars: runtimeVars, report: { probed: probed, skipped: all.length - probed, timeouts: timeouts } };
}
/* eslint-enable */

// ── Node orchestration ───────────────────────────────────────────────────────
async function capturePlus(url, userConfig = {}) {
  const cfg = mergeConfig(userConfig);
  const vp = cfg.viewports[0];
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const out = { meta: { url, viewport: vp.name }, computed: [], animations: {}, runtimeVars: [], behaviors: [], detectors: {}, report: {} };
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.evaluateOnNewDocument(instrument);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 900));

    out.computed = await page.evaluate(pageSnapshotComputed, cfg.computed);
    out.animations = await page.evaluate(pageSnapshotAnimations);
    for (const d of cfg.detectors) { try { out.detectors[d.name] = await d.run(page); } catch (e) { out.detectors[d.name] = { error: e.message }; } }
    const pr = await page.evaluate(pageRunProbes, cfg.probe);
    out.behaviors = pr.behaviors; out.runtimeVars = pr.runtimeVars; out.report = pr.report;
  } finally { await browser.close(); }

  return tagProvenance(out);
}

// Attach IR provenance (sourceOfTruth + locator) to every raw datum.
function tagProvenance(out) {
  const prov = (sot, locator, extra) => Object.assign({ sourceOfTruth: sot, contributing: [], locator, confidence: 1, signals: [] }, extra || {});
  return {
    meta: out.meta,
    computed: out.computed.map((c) => ({ ...c, provenance: prov('computed-style', { domPath: c.path, viewport: out.meta.viewport }) })),
    animations: {
      active: (out.animations.active || []).map((a) => ({ ...a, provenance: prov(a.kind === 'waapi' ? 'runtime' : 'css-rule', { probe: 'load' }, { confidence: 0.9 }) })),
      waapiCalls: out.animations.waapiCalls || 0,
      ioObserved: out.animations.ioObserved || 0,
    },
    runtimeVars: out.runtimeVars.map((v) => ({ ...v, provenance: prov('runtime', { probe: 'click ' + v.on }, { confidence: 0.9 }) })),
    behaviors: out.behaviors.map((b) => ({ ...b, provenance: prov('runtime', { probe: b.trigger.event + ' ' + b.trigger.selector }, { confidence: 0.85 }) })),
    detectors: out.detectors,
    report: out.report,
  };
}

module.exports = { capturePlus, mergeConfig };
