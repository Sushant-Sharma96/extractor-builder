'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — Behavior Graph builder. PURE + DETERMINISTIC.
//
// Controllers/Triggers/Regions are derived STRUCTURALLY from each section's
// emitted markup (sections[].html) — so every selector is guaranteed to match
// what the Generator emits. Capture++ runtime observations corroborate (raise
// confidence / mark runtimeConfirmed) and supply Motion nodes. A widget is only
// `fallback:generate` when its target exists in the static markup; otherwise it
// is `skip` (kept static + warned) — never guessed JS.
//
// Selectors recorded on nodes are the site's own stable attribute conventions
// ([data-tab="i"], [data-tab-panel="i"], button[aria-expanded]); the emitted
// handlers scope by nearest-common-ancestor at runtime, so no id injection.
// ─────────────────────────────────────────────────────────────────────────────

const cheerio = require('cheerio');

const prov = (sourceOfTruth, locator, confidence, contributing) => ({ sourceOfTruth, contributing: contributing || [], locator: locator || {}, confidence: confidence == null ? 1 : confidence, signals: [] });

function motionFallback(system) {
  if (['css-animation', 'css-transition', 'intersection-observer'].includes(system)) return { action: 'generate', reason: 'CSS/observer motion, reconstructable' };
  if (system === 'waapi') return { action: 'generate', reason: 'WAAPI keyframes captured' };
  if (['framer', 'gsap'].includes(system)) return { action: 'approximate', reason: 'JS-driven motion; approximate + flag' };
  return { action: 'skip', reason: 'unknown motion system' };
}

// Resolve an accordion trigger's collapsible target within its section markup.
// Returns a short descriptor of HOW it resolves, or null if none exists.
function resolveAccordionTarget($, btn) {
  const $b = $(btn);
  const ac = $b.attr('aria-controls');
  if (ac) return { via: 'aria-controls', ref: ac };
  // A next sibling only counts if it LOOKS like a collapsible panel — otherwise a
  // button merely followed by another element is a false positive (agenda rows).
  const next = $b.next();
  if (next && next.length && next.get(0).tagName) {
    const tag = next.get(0).tagName.toLowerCase();
    const looksPanel = next.attr('hidden') != null || next.attr('data-state') != null
      || ['region', 'tabpanel'].includes((next.attr('role') || '')) || tag === 'section';
    if (tag !== 'button' && looksPanel) return { via: 'next-sibling', ref: tag };
  }
  return null;
}

function buildBehaviorGraph({ capturePlus, dependency, sections }) {
  const cp = capturePlus || {};
  const secs = sections || [];
  const dgIds = new Set((dependency && dependency.nodes ? dependency.nodes : []).map((n) => n.id));
  const runtimeCount = (cp.behaviors || []).length;
  const nodes = []; const edges = []; const ids = new Set();
  const add = (n) => { if (!ids.has(n.id)) { ids.add(n.id); nodes.push(n); } return n.id; };
  const link = (type, from, to, meta) => { if (ids.has(from) && (ids.has(to) || dgIds.has(to))) edges.push(Object.assign({ type, from, to }, meta ? { meta } : {})); };

  // ── Controllers, structurally per section (deterministic order = ir.sections) ──
  secs.forEach((sec) => {
    if (!sec.html) return;
    const key = sec.key;
    const $ = cheerio.load('<div id="__root">' + sec.html + '</div>', null, false);
    const $root = $('#__root');
    const contrib = runtimeCount ? ['runtime'] : [];

    // Tabs — need both triggers and panels present in the SAME section.
    const triggers = $root.find('[data-tab]').toArray();
    const panels = $root.find('[data-tab-panel]').toArray();
    if (triggers.length && panels.length) {
      const cid = add({ id: 'ctrl:' + key + ':tabs', type: 'Controller', kind: 'tabs',
        stateModel: 'single-active', initialState: '0', keyboard: {}, transitions: [],
        scope: key, selectors: { trigger: '[data-tab]', panel: '[data-tab-panel]', activeAttr: 'hidden' },
        runtimeConfirmed: runtimeCount > 0,
        fallback: { action: 'generate', reason: 'tab panels present in static markup (hidden-attr driven)' },
        provenance: prov('dom', { selector: '[data-tab-panel]' }, 0.9, contrib) });
      triggers.forEach((t) => {
        const idx = ($(t).attr('data-tab') || '');
        const tid = add({ id: 'trig:' + key + ':tab:' + idx, type: 'Trigger', elementId: '[data-tab="' + idx + '"]', event: 'click', scope: key, provenance: prov('dom', { selector: '[data-tab="' + idx + '"]' }, 0.9, contrib) });
        link('controls', tid, cid, { index: idx });
      });
      panels.forEach((p) => {
        const idx = ($(p).attr('data-tab-panel') || '');
        const rid = add({ id: 'reg:' + key + ':panel:' + idx, type: 'Region', role: 'tabpanel', index: idx, elementId: '[data-tab-panel="' + idx + '"]', provenance: prov('dom', { selector: '[data-tab-panel="' + idx + '"]' }, 0.9, contrib) });
        link('manages', cid, rid, { index: idx });
      });
    }

    // Accordions — button[aria-expanded]; generate only if a target is resolvable.
    const accBtns = $root.find('button[aria-expanded]').toArray();
    if (accBtns.length) {
      let resolvable = 0;
      accBtns.forEach((b) => { if (resolveAccordionTarget($, b)) resolvable += 1; });
      const gen = resolvable > 0;
      const cid = add({ id: 'ctrl:' + key + ':accordion', type: 'Controller', kind: 'accordion',
        stateModel: 'multi-open', initialState: null, keyboard: {}, transitions: [],
        scope: key, selectors: { trigger: 'button[aria-expanded]', target: 'aria-controls|next-sibling' },
        counts: { total: accBtns.length, resolvable }, runtimeConfirmed: runtimeCount > 0,
        fallback: gen
          ? { action: 'generate', reason: resolvable + '/' + accBtns.length + ' triggers have a static panel' }
          : { action: 'skip', reason: 'no static collapsible panel (content is dynamic/react-only) — kept static' },
        provenance: prov('dom', { selector: 'button[aria-expanded]' }, gen ? 0.85 : 0.5, contrib) });
      // Represent resolvable targets as Regions (deterministic order by DOM order)
      accBtns.forEach((b, i) => {
        const tgt = resolveAccordionTarget($, b);
        if (!tgt) return;
        const rid = add({ id: 'reg:' + key + ':acc:' + i, type: 'Region', role: 'disclosure', index: i, elementId: tgt.via + (tgt.ref ? ':' + tgt.ref : ''), provenance: prov('dom', { selector: 'button[aria-expanded]', by: tgt.via }, 0.8, contrib) });
        link('manages', cid, rid, { index: i, via: tgt.via });
      });
    }

    // Modals/dialogs — content is in the static DOM but the trigger→dialog mapping
    // is React/portal-driven and not reliably present statically. Detect + SKIP +
    // report (no guessed JS). Emits no JS → output unchanged.
    const dialogs = $root.find('[role="dialog"],[aria-modal="true"]').toArray();
    if (dialogs.length) {
      add({ id: 'ctrl:' + key + ':modal', type: 'Controller', kind: 'modal', stateModel: 'modal', initialState: null, keyboard: {}, transitions: [], scope: key, counts: { total: dialogs.length },
        fallback: { action: 'skip', reason: 'dialog present but no reliable static trigger→dialog mapping (React/portal-driven) — kept static' },
        provenance: prov('dom', { selector: '[role=dialog]' }, 0.5, contrib) });
    }
    // Carousels/sliders — JS-driven; static fallback shows slides without auto-advance.
    const carousels = $root.find('[class*="carousel"],[class*="embla"],[class*="swiper"],[class*="keen-slider"],[data-carousel]').toArray();
    if (carousels.length) {
      add({ id: 'ctrl:' + key + ':carousel', type: 'Controller', kind: 'carousel', stateModel: 'carousel', initialState: null, keyboard: {}, transitions: [], scope: key, counts: { total: carousels.length },
        fallback: { action: 'approximate', reason: 'carousel/slider present; JS-driven — static output shows slides, no auto-advance/controls' },
        provenance: prov('dom', { selector: '[class*=carousel]' }, 0.5, contrib) });
    }
  });

  // ── Motion from live animations (unchanged; corroborated runtime) ──
  const active = (cp.animations && cp.animations.active) || [];
  active.forEach((a, i) => {
    const system = a.kind === 'waapi' ? 'waapi' : 'css-animation';
    const motId = add({ id: 'mot:' + i, type: 'Motion', system, trigger: 'load', targetRef: a.target || null, params: a.name ? { keyframeId: 'kf:' + a.name } : {}, reconstructable: system !== 'framer' && system !== 'gsap', fallback: motionFallback(system), provenance: prov(a.kind === 'waapi' ? 'runtime' : 'css-rule', { probe: 'load' }, 0.85, a.kind === 'waapi' ? [] : ['runtime']) });
    if (a.name && dgIds.has('kf:' + a.name)) link('dependsOn', motId, 'kf:' + a.name);
  });
  const ioCount = (cp.animations && cp.animations.ioObserved) || 0;
  if (ioCount > 0) add({ id: 'mot:io', type: 'Motion', system: 'intersection-observer', trigger: 'scroll', targetRef: null, params: { observed: ioCount }, reconstructable: true, fallback: motionFallback('intersection-observer'), provenance: prov('runtime', { probe: 'scroll' }, 0.8) });

  return { behavior: { nodes, edges } };
}

module.exports = { buildBehaviorGraph };
