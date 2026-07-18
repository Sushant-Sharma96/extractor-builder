'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Stage 4b — IR-driven Generator. PURE + DETERMINISTIC. Consumes ONLY the IR.
//   generate(ir) → { html, css, js, trace, report }
//
// Frozen rules enforced here:
//   • IR is the single source of truth — this module requires NOTHING from the
//     capture model or Capture++ (no ../capture, ./capture-plus, no model access).
//   • Deterministic — same IR ⇒ identical output. Every collection is emitted in
//     an explicit stable order (vars/keyframes by name, rules by numeric id,
//     sections in ir order, links sorted). No clock, no randomness, no reliance
//     on object-key / Set enumeration order, no module-level mutable state.
//   • Trace (IR Addition 2) — each output chunk records its contributing IR nodes.
//   • Missing info is enriched INTO the IR upstream, never fetched around it.
// ─────────────────────────────────────────────────────────────────────────────

// ── Fixed, idempotent interaction handlers (constant text ⇒ deterministic) ──
// Tabs: site convention is [data-tab="i"] triggers ↔ [data-tab-panel="i"] panels,
// inactive panels carry `hidden`. Scope = nearest ancestor holding both.
const HANDLER_TABS = "(function(){if(window.__etTabs)return;window.__etTabs=1;" +
  "function grp(el){var n=el;while(n&&n!==document.body){if(n.querySelector&&n.querySelector('[data-tab-panel]')&&n.querySelector('[data-tab]'))return n;n=n.parentElement;}return document;}" +
  "document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-tab]');if(!t)return;var g=grp(t),idx=t.getAttribute('data-tab');" +
  "g.querySelectorAll('[data-tab-panel]').forEach(function(p){if(p.getAttribute('data-tab-panel')===idx)p.removeAttribute('hidden');else p.setAttribute('hidden','');});" +
  "g.querySelectorAll('[data-tab]').forEach(function(b){var on=b.getAttribute('data-tab')===idx;b.setAttribute('aria-selected',on?'true':'false');b.setAttribute('data-state',on?'active':'inactive');});});})();";
// Accordion: button[aria-expanded] toggles its target (aria-controls id, else next
// sibling). No target ⇒ no-op, so panel-less rows stay safely static.
const HANDLER_ACCORDION = "(function(){if(window.__etAcc)return;window.__etAcc=1;" +
  "document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('button[aria-expanded]');if(!t)return;" +
  "var id=t.getAttribute('aria-controls'),p=id?document.getElementById(id):null;if(!p){var n=t.nextElementSibling;if(n)p=n;}if(!p)return;" +
  "var open=t.getAttribute('aria-expanded')==='true';t.setAttribute('aria-expanded',open?'false':'true');" +
  "if(open)p.setAttribute('hidden','');else p.removeAttribute('hidden');});})();";
// Scroll-reveal: Lovable hides reveal elements with inline opacity:0 and shows them via
// IntersectionObserver on scroll. We reproduce that (fade-in on scroll using the element's
// own transition) AND guarantee visibility via a safety timeout — so content is never stuck
// hidden when the observer can't fire (headless / never-scrolled).
const HANDLER_REVEAL = "(function(){if(window.__etReveal)return;window.__etReveal=1;" +
  "function rv(el){el.style.opacity='';el.style.transform='';el.setAttribute('data-et-revealed','1');}" +
  "var t=[].slice.call(document.querySelectorAll('[style*=\"opacity:0\"],[style*=\"opacity: 0\"]'));" +
  "if(!('IntersectionObserver' in window)){t.forEach(rv);return;}" +
  "var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){rv(e.target);io.unobserve(e.target);}});},{rootMargin:'0px 0px -8% 0px'});" +
  "t.forEach(function(x){io.observe(x);});" +
  "setTimeout(function(){t.forEach(function(x){if(!x.getAttribute('data-et-revealed'))rv(x);});},2500);})();";

// Video-embed facade: third-party players (Vimeo/YouTube) render a broken white/black
// box off their origin (domain + autoplay restrictions). Replace the iframe with a
// branded play-button facade that loads the real iframe on click (user gesture ⇒
// autoplay allowed). Generic + deterministic; the video content is preserved (the
// src rides in data-embed, and Verify's partition counts it as the same video).
const VIDEO_RE = /<iframe\b[^>]*\bsrc="([^"]*(?:player\.vimeo\.com|youtube(?:-nocookie)?\.com\/embed|youtu\.be)[^"]*)"[^>]*>[\s\S]*?<\/iframe>/gi;
function videoFacade(src) {
  const clean = src.replace(/[?&]autoplay=1/g, '');
  const play = clean + (clean.indexOf('?') >= 0 ? '&' : '?') + 'autoplay=1';
  return '<button type="button" class="et-video-facade" data-embed="' + play.replace(/"/g, '&quot;') + '" aria-label="Play video" '
    + 'style="position:absolute;inset:0;width:100%;height:100%;border:0;cursor:pointer;background:#0b0b0b;display:flex;align-items:center;justify-content:center">'
    + '<span aria-hidden="true" style="width:74px;height:74px;border-radius:9999px;background:linear-gradient(135deg,#f5c46b,#e8892b);color:#1a1a1a;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 34px rgba(0,0,0,.45)">'
    + '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></button>';
}
const HANDLER_VIDEO = "(function(){if(window.__etVideo)return;window.__etVideo=1;document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.et-video-facade');if(!b)return;var s=b.getAttribute('data-embed');var f=document.createElement('iframe');f.src=s;f.setAttribute('allow','autoplay; fullscreen; picture-in-picture');f.setAttribute('allowfullscreen','');f.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:0';b.parentNode.replaceChild(f,b);});})();";

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function attrEsc(s) { return esc(s).replace(/"/g, '&quot;'); }
function ruleIdNum(id) { const m = /^rule:(\d+)$/.exec(id || ''); return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER; }
function byName(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }

// Pixel-Perfect isolation: prefix a selector with the scope root so every generated
// rule outranks a host's bare-element rules (e.g. Bootstrap `ul{…}`), while keeping
// the relative specificity AMONG generated rules intact. `:root`/keyframes stay
// global; `html`/`body` map onto the scope root itself.
function scopeSelector(sel, rootSel) {
  return sel.split(',').map((raw) => {
    const s = raw.trim(); if (!s) return raw;
    if (/^:root\b/.test(s)) return s;
    if (/^(html|body)\b/.test(s)) return s.replace(/^(html|body)\b/, rootSel);
    return rootSel + ' ' + s;
  }).join(', ');
}
// Scoped baseline reset (`.et-scope :where(…)` = one class of specificity): beats host
// bare-element rules but loses to the scoped utilities, so Lovable's design still wins.
const ISO_RESET = [
  ':where(h1,h2,h3,h4,h5,h6,p,ul,ol,li,figure,blockquote,dl,dd,pre,hr,fieldset){margin:0;padding:0}',
  // headings inherit line-height from the scope root (blocks a host `h1-h6{line-height}`
  // direct rule); a Lovable `leading-*` utility still wins by higher specificity.
  ':where(h1,h2,h3,h4,h5,h6){line-height:inherit}',
  ':where(ul,ol){list-style:none}',
  ':where(a){color:inherit;text-decoration:inherit}',
  ':where(button,input,select,textarea){font:inherit;color:inherit}',
  ':where(img,svg,video){max-width:100%}',
].map((r) => '.et-scope ' + r).join('\n');

function generate(ir) {
  if (!ir || typeof ir !== 'object') throw new Error('generate(ir): ir object required');
  const doc = ir.document || {};
  const dnodes = (ir.dependency && ir.dependency.nodes) || [];
  const bnodes = (ir.behavior && ir.behavior.nodes) || [];
  const sections = ir.sections || [];
  const report = { warnings: [], approximations: [], skipped: [], review: [] };
  const trace = { html: [], css: [], js: [] };
  // Class/scope standard: every section is wrapped in `.et-scope` and ALL generated
  // CSS is scoped under `.et-scope` — self-contained + host-isolated per section
  // (finalized standard), while the ORIGINAL Lovable classes are kept intact.
  const prune = !!(ir.options && ir.options.pruneCss);
  const ROOT = '.et-scope';
  const scope = (sel) => scopeSelector(sel, ROOT);

  // Opt-in dead-CSS elimination (state-safe): drop a class rule only when NONE of its
  // class tokens appear on any emitted element. Such a rule is inert — no element has
  // the class, so no interaction state (:hover/[data-state]/aria) can ever match it.
  // Vars, keyframes, @font-face, global (*/:root), and element/preflight rules are
  // never pruned (avoids v1's var-drop bug and keeps resets for dynamic-bound content).
  const classTokensOf = (sel) => (sel.match(/\.((?:\\.|[A-Za-z0-9_-])+)/g) || []).map((s) => s.slice(1).replace(/\\/g, ''));
  const presentClasses = new Set();
  if (prune) {
    const addCls = (html) => { const re = /class="([^"]*)"/g; let m; while ((m = re.exec(html || ''))) m[1].split(/\s+/).forEach((t) => t && presentClasses.add(t)); };
    sections.forEach((s) => addCls(s.html));
    (doc.wrapperChain || []).forEach((w) => (w.class || '').split(/\s+/).forEach((t) => t && presentClasses.add(t)));
    (doc.bodyClass || '').split(/\s+/).forEach((t) => t && presentClasses.add(t));
  }
  const isClassDead = (sel) => { const t = classTokensOf(sel); return t.length > 0 && !t.some((x) => presentClasses.has(x)); };
  let prunedRules = 0;

  // ── CSS (fixed layer order; deterministic within each layer) ──────────────
  const cssChunks = [];
  // layer 1: :root / .dark variable blocks — emitted verbatim (no var drop)
  if ((doc.rootCss || '').trim()) {
    cssChunks.push(':root{\n' + doc.rootCss.trim() + '\n}'); trace.css.push({ output: ':root', irNodeIds: [] });
    // Also apply the root block to .et-scope so each scoped section carries the design
    // tokens + inherited typography (line-height/font) — self-contained, no outer wrapper.
    cssChunks.push(ROOT + '{\n' + doc.rootCss.trim() + '\n}'); trace.css.push({ output: ROOT + ' (root-inherit)', irNodeIds: [] });
  }
  if ((doc.darkCss || '').trim()) { cssChunks.push('.dark{\n' + doc.darkCss.trim() + '\n}'); trace.css.push({ output: '.dark', irNodeIds: [] }); }
  // Scoped baseline reset (before rules) so host element defaults don't leak into a section.
  cssChunks.push(ISO_RESET); trace.css.push({ output: 'scope-reset', irNodeIds: [] });
  // layer 2: @font-face (document order)
  (doc.fontFaceCss || []).forEach((ff, i) => { const t = (ff || '').trim(); if (t) { cssChunks.push(t); trace.css.push({ output: '@font-face#' + i, irNodeIds: [] }); } });
  // layer 3: @keyframes (sorted by name for stability)
  dnodes.filter((n) => n.type === 'Keyframes' && n.cssText).slice().sort(byName)
    .forEach((k) => { cssChunks.push(k.cssText.trim()); trace.css.push({ output: '@keyframes ' + k.name, irNodeIds: [k.id] }); });
  // layer 4: rules in source-cascade order (numeric rule id), each emitted once
  dnodes.filter((n) => n.type === 'CssRule' && (n.cssText || '').trim()).slice().sort((a, b) => ruleIdNum(a.id) - ruleIdNum(b.id))
    .forEach((r) => {
      if (prune && isClassDead(r.selector)) { prunedRules += 1; return; }
      let chunk = scope(r.selector) + '{' + r.cssText.trim() + '}';
      if (r.media) chunk = '@media ' + r.media + '{' + chunk + '}';
      cssChunks.push(chunk);
      trace.css.push({ output: r.selector + (r.media ? '@' + r.media : ''), irNodeIds: [r.id] });
    });
  if (prune && prunedRules) report.warnings.push('pruned ' + prunedRules + ' dead CSS rule(s) (class not present in markup)');
  const css = cssChunks.join('\n');

  // ── HTML body (sections in IR order) ──────────────────────────────────────
  // Each section is wrapped in `.et-scope` (self-contained + host-isolated) with its
  // original classes kept; sectionsOut carries the per-section markup for platform import.
  const bodyParts = [];
  const sectionsOut = [];
  let hasVideoFacade = false;
  sections.forEach((s) => {
    const inner = (s.html || '').replace(VIDEO_RE, (m, src) => { hasVideoFacade = true; return videoFacade(src); });
    const wrapped = '<div class="et-scope">' + inner + '</div>';
    bodyParts.push(wrapped);
    sectionsOut.push({ key: s.key, label: s.label, tag: s.tag, html: wrapped });
    trace.html.push({ output: 'section:' + s.key, irNodeIds: [] });
  });
  let bodyInner = bodyParts.join('\n');
  // Reconstruct the page-level wrapper chain (bg/min-h-screen/antialiased etc.) that
  // sits between <body> and the sections, so those classes/styles aren't dropped.
  const chain = doc.wrapperChain || [];
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const w = chain[i];
    const attrs = (w.id ? ' id="' + attrEsc(w.id) + '"' : '') + (w.class ? ' class="' + attrEsc(w.class) + '"' : '');
    bodyInner = '<' + (w.tag || 'div') + attrs + '>\n' + bodyInner + '\n</' + (w.tag || 'div') + '>';
    trace.html.push({ output: 'wrapper:' + (w.tag || 'div') + (w.class ? '.' + w.class.split(/\s+/)[0] : ''), irNodeIds: [] });
  }
  // Wrap the whole page in an outer `.et-scope` too, so the page-level wrapper chain
  // (bg/min-h) is also scoped for the full-page bundle. Sections remain individually
  // `.et-scope`-wrapped (nested scope is idempotent) for standalone platform import.
  bodyInner = '<div class="et-scope">\n' + bodyInner + '\n</div>'; trace.html.push({ output: 'scope-root:.et-scope', irNodeIds: [] });

  // ── JS from BG controllers. A controller is emitted ONLY when its markup
  //    target exists (fallback:generate). Handlers are fixed, idempotent,
  //    and scope by nearest-common-ancestor at runtime → deterministic. ──
  const controllers = bnodes.filter((n) => n.type === 'Controller').slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const motions = bnodes.filter((n) => n.type === 'Motion').slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const genKinds = new Set();
  // Aggregate skipped/approximated by (kind + reason) → one concise line with a count,
  // instead of one line per node (avoids the repeated-report noise QA flagged).
  const skipAgg = new Map(); const apprAgg = new Map();
  const bump = (map, kind, reason) => { const k = kind + '|' + reason; const g = map.get(k) || { kind, reason, count: 0 }; g.count += 1; map.set(k, g); };
  controllers.forEach((c) => {
    const action = (c.fallback && c.fallback.action) || 'skip';
    const reason = (c.fallback && c.fallback.reason) || 'kept static';
    if (action === 'generate') genKinds.add(c.kind);
    else if (action === 'approximate') bump(apprAgg, c.kind, reason);
    else bump(skipAgg, c.kind, reason);
  });
  motions.forEach((m) => {
    // 'generate' CSS/observer motion is already carried by the emitted keyframes/rules.
    const action = (m.fallback && m.fallback.action) || 'skip';
    const reason = (m.fallback && m.fallback.reason) || '';
    if (action === 'approximate') bump(apprAgg, 'motion:' + m.system, reason);
    else if (action === 'skip') bump(skipAgg, 'motion:' + m.system, reason);
  });
  skipAgg.forEach((g) => report.skipped.push(g.kind + (g.count > 1 ? ' ×' + g.count : '') + ': ' + g.reason));
  apprAgg.forEach((g) => report.approximations.push(g.kind + (g.count > 1 ? ' ×' + g.count : '') + ': ' + g.reason));
  const jsParts = [];
  if (genKinds.has('tabs')) { jsParts.push(HANDLER_TABS); trace.js.push({ output: 'handler:tabs', irNodeIds: controllers.filter((c) => c.kind === 'tabs' && c.fallback.action === 'generate').map((c) => c.id) }); }
  if (genKinds.has('accordion')) { jsParts.push(HANDLER_ACCORDION); trace.js.push({ output: 'handler:accordion', irNodeIds: controllers.filter((c) => c.kind === 'accordion' && c.fallback.action === 'generate').map((c) => c.id) }); }
  // scroll-reveal: emit the IntersectionObserver reveal when the BG observed IO reveals
  const revealMotions = motions.filter((m) => m.system === 'intersection-observer' && m.fallback && m.fallback.action === 'generate');
  if (revealMotions.length) { jsParts.push(HANDLER_REVEAL); trace.js.push({ output: 'handler:reveal', irNodeIds: revealMotions.map((m) => m.id) }); }
  if (hasVideoFacade) { jsParts.push(HANDLER_VIDEO); trace.js.push({ output: 'handler:video', irNodeIds: [] }); }
  const js = jsParts.join('\n');
  const jsTag = js ? '<script>\n' + js + '\n</script>' : '';

  // ── document assembly ─────────────────────────────────────────────────────
  const links = (doc.fontLinks || []).slice().sort().map((h) => '<link rel="stylesheet" href="' + attrEsc(h) + '">').join('\n');
  const bodyOpen = '<body' + (doc.bodyClass ? ' class="' + attrEsc(doc.bodyClass) + '"' : '') + '>';
  const html = [
    '<!doctype html>',
    '<html lang="' + attrEsc(doc.lang || 'en') + '">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="' + attrEsc(doc.metaViewport || 'width=device-width, initial-scale=1') + '">',
    '<title>' + esc(doc.title || '') + '</title>',
    links,
    '<style>',
    css,
    '</style>',
    '</head>',
    bodyOpen,
    bodyInner,
    jsTag,
    '</body>',
    '</html>',
    '',
  ].filter((l) => l !== '').join('\n');

  return { html, css, js, trace, report, sectionsOut };
}

module.exports = { generate };
