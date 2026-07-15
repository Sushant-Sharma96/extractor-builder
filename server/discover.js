// discover.js — Stage 5 (Runtime Behavior Discovery) + Stage 6 (Classification)
//
// Boots a live Lovable URL in headless Chromium, instruments its runtime BEFORE
// the app's scripts execute (wraps IntersectionObserver / requestAnimationFrame /
// timers) and records every class/style/attr/text mutation with timing while it
// drives the page (paint → scroll → hover → click). It then classifies each
// animating element into a Behavior IR node. This stage is READ-ONLY: it changes
// nothing in the generated output; it produces the IR the reconstruction stage
// will consume. Works for ANY Lovable project — no per-site logic.
//
// Behavior IR node:
//   { selector, category, mechanism, initialState, activeState, trigger, timing, permanent }

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function loadPuppeteer() {
  try { return require('puppeteer'); }
  catch { throw new Error('puppeteer not installed — run `npm install puppeteer`.'); }
}

// ── Runs in the PAGE context, injected via evaluateOnNewDocument (before boot) ──
/* istanbul ignore next */
function instrument() {
  const ET = (window.__ET = {
    t0: Date.now(), io: [], ioObserved: [], raf: 0, timers: 0, mut: [], nodeId: 0,
  });
  const now = () => Date.now() - ET.t0;

  // A short, stable-ish CSS path so Node can correlate events to elements.
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (!el.__etid) el.__etid = ++ET.nodeId;
    const parts = [];
    let n = el, depth = 0;
    while (n && n.nodeType === 1 && depth < 4) {
      let s = n.tagName.toLowerCase();
      const cls = (n.getAttribute && n.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (cls) s += '.' + cls;
      parts.unshift(s);
      n = n.parentElement; depth++;
    }
    return '#' + el.__etid + ' ' + parts.join('>');
  }

  // Wrap IntersectionObserver so we see which elements the app watches and when
  // they cross into view (the dominant scroll-reveal TRIGGER).
  // Record which elements the app WIRES UP to an IntersectionObserver (via
  // .observe) — the reliable signal for scroll-reveal, independent of whether the
  // intersection actually fires in headless. Also log intersections when they do.
  const NativeIO = window.IntersectionObserver;
  if (NativeIO) {
    function WrappedIO(cb, opts) {
      const inst = new NativeIO((entries, obs) => {
        try { entries.forEach((e) => { if (e.isIntersecting) ET.io.push({ t: now(), id: e.target.__etid }); }); } catch (err) {}
        return cb(entries, obs);
      }, opts);
      const origObserve = inst.observe.bind(inst);
      inst.observe = function (el) {
        try { if (el && el.nodeType === 1) { if (!el.__etid) el.__etid = ++ET.nodeId; ET.ioObserved.push({ t: now(), id: el.__etid, sel: cssPath(el) }); } } catch (e) {}
        return origObserve(el);
      };
      return inst;
    }
    window.IntersectionObserver = WrappedIO;
  }

  // Count rAF / timer usage — a signal of JS-driven value animation (counters).
  const rAF = window.requestAnimationFrame;
  if (rAF) window.requestAnimationFrame = function (fn) { ET.raf++; return rAF.call(window, fn); };
  const sT = window.setTimeout;
  window.setTimeout = function (fn, ms) { if (ms != null && ms < 4000) ET.timers++; return sT.apply(window, arguments); };

  // Record attribute + text mutations with timestamps.
  function startMO() {
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        const t = m.target;
        if (m.type === 'characterData') {
          ET.mut.push({ t: now(), kind: 'text', sel: cssPath(t.parentElement), id: t.parentElement && t.parentElement.__etid,
            val: (t.data || '').slice(0, 40) });
        } else {
          const val = (t.getAttribute && t.getAttribute(m.attributeName)) || '';
          ET.mut.push({ t: now(), kind: 'attr', attr: m.attributeName, sel: cssPath(t), id: t.__etid,
            old: (m.oldValue || '').slice(0, 90), val: String(val).slice(0, 90) });
        }
      }
    });
    mo.observe(document.documentElement, {
      subtree: true, attributes: true, attributeOldValue: true, characterData: true,
      attributeFilter: ['class', 'style', 'data-state', 'aria-expanded', 'aria-selected', 'aria-hidden'],
    });
    ET.mo = mo;
  }
  if (document.documentElement) startMO();
  else document.addEventListener('DOMContentLoaded', startMO);
}

// ── Runs in PAGE context after load: capture initial/settled states + drive UI ──
/* istanbul ignore next */
async function drive() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ET = window.__ET;
  const cssPath = (el) => {
    if (!el.__etid) return '';
    return '#' + el.__etid;
  };
  // Snapshot the initial (pre-scroll) state of every element that looks animatable.
  function snap(el) {
    const c = getComputedStyle(el);
    return { opacity: c.opacity, transform: c.transform === 'none' ? 'none' : c.transform,
      transition: c.transitionProperty, transDur: c.transitionDuration, transDelay: c.transitionDelay, easing: c.transitionTimingFunction,
      animName: c.animationName, animDur: c.animationDuration,
      cls: (el.getAttribute('class') || '') };
  }
  window.scrollTo(0, 0); await sleep(400);
  const initial = new Map();
  const els = [].slice.call(document.querySelectorAll('*'));
  els.forEach((el) => {
    if (!el.__etid) el.__etid = ++ET.nodeId;
    const c = getComputedStyle(el);
    const animatable = c.transitionDuration !== '0s' || parseFloat(c.opacity) < 1 ||
      (c.transform && c.transform !== 'none') || (el.getAttribute('style') || '').indexOf('opacity') >= 0;
    if (animatable && el.getBoundingClientRect().width > 0) initial.set(el.__etid, { el, s: snap(el) });
  });

  // DRIVE: slow scroll to trigger scroll-reveals & choreography.
  const H = () => document.body.scrollHeight;
  for (let y = 0; y <= H(); y += Math.round(window.innerHeight * 0.6)) { window.scrollTo(0, y); await sleep(160); }
  window.scrollTo(0, H()); await sleep(700);
  window.scrollTo(0, 0); await sleep(300);

  // Settled state after everything has run.
  const settled = {};
  initial.forEach((v, id) => { settled[id] = snap(v.el); });

  // DRIVE: hover a few interactive-looking elements (detect hover-only reveals).
  const hoverTargets = [].slice.call(document.querySelectorAll('a,button,[class*="group"],[class*="card"]')).slice(0, 8);
  const hoverEffects = [];
  for (const el of hoverTargets) {
    const before = getComputedStyle(el).opacity + '|' + getComputedStyle(el).transform;
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(120);
    const after = getComputedStyle(el).opacity + '|' + getComputedStyle(el).transform;
    if (before !== after) hoverEffects.push(el.__etid);
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
  }

  // Serialize initial states (only the animatable set) for Node-side classification.
  const initialOut = {};
  initial.forEach((v, id) => { initialOut[id] = v.s; });

  return {
    counts: { totalEls: els.length, animatable: initial.size, ioObserved: ET.ioObserved.length, ioEvents: ET.io.length, mutations: ET.mut.length, raf: ET.raf, timers: ET.timers, hoverEffects: hoverEffects.length },
    initial: initialOut, settled, io: ET.io, ioObserved: ET.ioObserved, mut: ET.mut, hoverEffects,
  };
}

// ── Node-side Stage 6: classify observations into Behavior IR ──────────────────
function classify(data) {
  const { initial, mut, hoverEffects, ioObserved } = data;
  const hoverSet = new Set(hoverEffects);
  const observedSet = new Set((ioObserved || []).map((e) => e.id)); // elements wired to an IntersectionObserver
  const classToggled = new Set(), textMutated = new Set();
  for (const m of mut) {
    if (m.kind === 'text') { if (m.id != null) textMutated.add(m.id); continue; }
    if (m.attr === 'class') classToggled.add(m.id);
  }

  const behaviors = [];
  const hasTranslate = (t) => t && t !== 'none' && /matrix|translate/.test(t) && t !== 'matrix(1, 0, 0, 1, 0, 0)';
  for (const id of Object.keys(initial)) {
    const i = initial[id];
    const numId = Number(id);
    const startedHidden = parseFloat(i.opacity) < 1 || hasTranslate(i.transform);
    const hasTransition = i.transDur && i.transDur !== '0s';
    const hasKeyframe = i.animName && i.animName !== 'none';
    const observed = observedSet.has(numId);
    const hoverOnly = hoverSet.has(numId);

    // 1) CSS keyframe animation (pure CSS, no trigger needed) — preserve verbatim.
    if (hasKeyframe) {
      behaviors.push({ id: numId, category: 'css-animation', mechanism: 'pure-css', permanent: false,
        timing: { animation: i.animName, duration: i.animDur } });
      continue;
    }
    // 2) Scroll-reveal: has a reveal initial-state + a transition, AND the app wired
    //    it to an IntersectionObserver (or toggles its class). Trigger = intersect.
    if (startedHidden && hasTransition && (observed || classToggled.has(numId))) {
      behaviors.push({ id: numId, category: 'scroll-reveal',
        mechanism: observed ? 'io+css-transition' : 'css+class-toggle', trigger: { on: 'intersect' },
        initialState: pick(i), activeState: { opacity: '1', transform: 'none' },
        timing: { duration: i.transDur, delay: i.transDelay, easing: i.easing }, permanent: false });
      continue;
    }
    // 3) Choreographed reveal: reveal initial-state + a transition-DELAY but NOT
    //    individually observed (revealed as a group when an ancestor enters view).
    if (startedHidden && hasTransition && i.transDelay && i.transDelay !== '0s') {
      behaviors.push({ id: numId, category: 'choreography', mechanism: 'css+group-trigger', trigger: { on: 'ancestor-intersect' },
        initialState: pick(i), activeState: { opacity: '1', transform: 'none' },
        timing: { duration: i.transDur, delay: i.transDelay, easing: i.easing }, permanent: false });
      continue;
    }
    // 4) Permanent / hover: opacity:0, not observed, not transitioning in on scroll.
    if (parseFloat(i.opacity) === 0) {
      behaviors.push({ id: numId, category: hoverOnly ? 'hover' : 'permanent-hidden', mechanism: 'pure-css',
        permanent: true, initialState: pick(i), trigger: { on: hoverOnly ? 'hover' : 'none' } });
      continue;
    }
    // 5) Counter: numeric text mutating over time.
    if (textMutated.has(numId)) {
      behaviors.push({ id: numId, category: 'counter', mechanism: 'js-raf', trigger: { on: 'intersect' }, permanent: false });
      continue;
    }
  }
  return behaviors;
}
function pick(s) { return { opacity: s.opacity, transform: s.transform, dur: s.transDur, delay: s.transDelay, easing: s.easing }; }

async function discover(url, { viewportWidth = 1280 } = {}) {
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: viewportWidth, height: 900 });
    await page.evaluateOnNewDocument(instrument);   // wrap APIs BEFORE the app boots
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 900));
    const data = await page.evaluate(drive);
    const behaviors = classify(data);
    // summarize by category
    const byCat = {};
    for (const b of behaviors) byCat[b.category] = (byCat[b.category] || 0) + 1;
    const byMech = {};
    for (const b of behaviors) if (b.mechanism) byMech[b.mechanism] = (byMech[b.mechanism] || 0) + 1;
    // surface animatable elements we did NOT classify — so unknown techniques are visible, not silently dropped
    const classified = new Set(behaviors.map((b) => b.id));
    const unclassified = Object.keys(data.initial).filter((id) => !classified.has(Number(id)));
    const unclassifiedSample = unclassified.slice(0, 8).map((id) => {
      const s = data.initial[id];
      return { opacity: s.opacity, transform: s.transform, transDur: s.transDur, transDelay: s.transDelay, animName: s.animName, cls: (s.cls || '').slice(0, 45) };
    });
    return { url, counts: data.counts, behaviorCount: behaviors.length, byCategory: byCat, byMechanism: byMech,
      unclassifiedCount: unclassified.length, unclassifiedSample, sample: behaviors.slice(0, 6), behaviors };
  } finally {
    await browser.close();
  }
}

module.exports = { discover };

// CLI: node server/discover.js <url> [url2 ...]
if (require.main === module) {
  (async () => {
    const urls = process.argv.slice(2);
    for (const u of urls) {
      try {
        const r = await discover(u);
        const { behaviors, sample, ...summary } = r;
        console.log('\n=== ' + u + ' ===');
        console.log(JSON.stringify(summary, null, 2));
      } catch (e) { console.error('discover failed for', u, e.message); }
    }
  })();
}
