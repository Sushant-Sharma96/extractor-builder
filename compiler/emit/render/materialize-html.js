'use strict';

/**
 * Phase 3 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — Renderer, minimal vocabulary.
 *
 * Materializes a small render tree (tag choices from tag.js + CSS decls from
 * css-declarations.js) into literal HTML + CSS strings.
 *
 * Ported (faithfully) from server/figma-build.js:
 *   - `esc()` — HTML-escape (unchanged).
 *   - `slug()` — class-name slugging (unchanged formula, incl. the
 *     digit-leading-class guard).
 *   - `textRuns()` / `runStyleCss()` — styled text run splitting +
 *     per-run inline style (unchanged; only reads
 *     characterStyleOverrides/styleOverrideTable which live on TEXT nodes).
 *   - the class-dedupe pattern from `emit()`'s `classFor`/`declString`
 *     (one class per unique declaration signature) and `buildHtml()`'s
 *     document shell.
 *
 * Deliberate scope reduction vs. legacy's `buildCss` (documented, not
 * silently dropped): legacy partitions rules into "common" vs. per-section
 * blocks with comment headers; this minimal-vocabulary renderer emits one
 * flat rule list (no section partitioning) — the Phase 3 vocabulary (row/
 * column/grid/absolute/card) has no section concept of its own yet. Also
 * omits legacy's `@media` (that's explicitly Phase 4 scope) and its
 * dual-path standards CSS block (`.et-flow-row`, `.et-card`, ... — those are
 * legacy-emitter-specific utility classes for heuristics this phase does not
 * port, e.g. `forceContentFlexStacks`/`clipMedia`/`normalizeSectionShell`).
 *
 * Pure functions only — input is an immutable render-tree description, not a
 * mutated figma-build element tree.
 */

const { buildDecls, canvasDecls, declString, declBody, isPositionedAbsolute, px } = require('./css-declarations');
const { chooseTag } = require('./tag');
const { CSS_RESET_BLOCK } = require('./utility-css');
const { buildResponsiveMediaCss } = require('./responsive-media');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Port of server/figma-build.js's slug() — unchanged formula. */
function slug(text) {
  const s = (text || '').toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 5).join('-').slice(0, 40).replace(/-+$/g, '') || 'box';
  return /^[0-9]/.test(s) ? 'n-' + s : s;
}

/** Port of server/figma-build.js's textRuns() — unchanged. */
function textRuns(node) {
  const chars = node.characters || '';
  const ov = node.characterStyleOverrides || [];
  const table = node.styleOverrideTable || {};
  if (!chars || !ov.length || !Object.keys(table).length) return [{ text: chars }];
  const runs = [];
  for (let i = 0; i < chars.length;) {
    const id = ov[i] || 0;
    let j = i;
    while (j < chars.length && (ov[j] || 0) === id) j += 1;
    const text = chars.slice(i, j);
    runs.push(id && table[id] ? { text, style: table[id] } : { text });
    i = j;
  }
  return runs;
}

/**
 * docs/STYLE_RESOLVER_ARCHITECTURE.md Section 5.2 — per-character-run
 * style, now sharing the SAME resolveTypography() the whole-node path
 * (css-declarations.js's modeDecls()) uses, instead of a second, smaller,
 * independent re-implementation. This closes a real, confirmed gap: the
 * old separate implementation here never read `textCase` at all and only
 * handled `textDecoration:UNDERLINE` (silently dropping STRIKETHROUGH) —
 * both now behave identically to the whole-node path. `color` stays a
 * separate, untouched concern (a paint/fill decision, not typography —
 * see resolveTypography()'s own header comment). Property ORDER in the
 * resulting inline-style string differs from the old implementation's
 * (fontFamily now emits first, matching the whole-node path's own order,
 * rather than last) — harmless, since these are non-conflicting CSS
 * properties; only ever visible as a byte-diff artifact, never a real
 * rendering difference.
 */
function runStyleCss(s) {
  const { figmaColor } = require('./css-declarations');
  const { resolveTypography } = require('../../style');
  const d = [];
  const fills = (s.fills || []).filter((f) => f.visible !== false);
  const top = fills[fills.length - 1];
  if (top && top.type === 'SOLID') d.push(`color:${figmaColor(top.color, top.opacity)}`);
  for (const [prop, value] of resolveTypography(s)) {
    d.push(`${prop}:${value}`);
  }
  return d.join(';');
}

/**
 * @typedef {object} RenderNode
 * @property {string} nodeId
 * @property {string} [type] — 'TEXT'|'IMAGE'|'FRAME'|'GROUP'|...
 * @property {string} [name]
 * @property {number} [fontSize]
 * @property {string} [characters] — TEXT content
 * @property {number[]} [characterStyleOverrides]
 * @property {object} [styleOverrideTable]
 * @property {object} [layoutChoice] — this node's EmitPlan layoutChoices entry
 * @property {RenderNode[]} [children]
 */

/**
 * Build the class registry (dedupe-by-signature), matching legacy's
 * classFor/nameSections — tracks which section(s) each class name is used in
 * so buildCss's "Common / shared" vs. per-section split can be ported.
 */
function buildClassRegistry() {
  const sigToName = new Map();
  const nameToDecls = new Map();
  const nameCounts = new Map();
  const nameSections = new Map(); // name -> Set(sectionKey)
  const usedOrder = [];
  // Phase 4 — nodeId -> layoutChoice, populated as renderNode walks the tree,
  // so buildResponsiveMediaCss can read a node's own gap for
  // space-tighten/space-preserve without a second tree walk.
  const layoutChoiceByNode = new Map();
  // Phase 4 — nodeId -> a dedicated (never deduped-by-signature) CSS class,
  // assigned up front by materializeHtml() for every node with a real
  // ResponsiveIR adaptation. A signature-deduped class (the `name` above)
  // can be shared by many structurally-identical nodes; a per-node
  // responsive override must never accidentally apply to a sibling that
  // happens to share the same base declarations, so it gets its own class.
  const responsiveClassByNode = new Map();

  function classFor(node, decls, section) {
    if (node && node.nodeId) layoutChoiceByNode.set(node.nodeId, node.layoutChoice || {});
    if (!decls.length) return null;
    const sig = declString(decls);
    let name = sigToName.get(sig);
    if (!name) {
      const base = slug(node.name);
      const n = (nameCounts.get(base) || 0) + 1;
      nameCounts.set(base, n);
      name = n === 1 ? base : `${base}-${n}`;
      sigToName.set(sig, name);
      nameToDecls.set(name, decls);
    }
    if (!nameSections.has(name)) nameSections.set(name, new Set());
    if (section != null) nameSections.get(name).add(section);
    if (!usedOrder.includes(name)) usedOrder.push(name);
    return name;
  }

  return {
    classFor, nameToDecls, nameSections, usedOrder, layoutChoiceByNode, responsiveClassByNode,
  };
}

function renderNode(node, registry, indent, section) {
  const pad = '  '.repeat(indent);
  const layoutChoice = node.layoutChoice || {};
  const tag = chooseTag(node, layoutChoice);
  const decls = buildDecls(layoutChoice);
  // A `position:absolute` child resolves its left/top against the nearest
  // positioned ancestor. If this node isn't already positioned (its own mode
  // isn't 'absolute'), any absolute child would otherwise anchor all the way
  // up to the page root, collapsing unrelated subtrees on top of each other.
  // Establish this node as that anchor whenever it has such a child.
  const hasOwnPosition = decls.some(([k]) => k === 'position');
  const hasAbsoluteChild = (node.children || []).some(
    (c) => c && isPositionedAbsolute(c.layoutChoice)
  );
  if (hasAbsoluteChild && !hasOwnPosition) {
    decls.push(['position', 'relative']);
  }
  const cls = registry.classFor(node, decls, section);
  // Phase 4 — attach the dedicated per-node responsive class (if this node
  // has a real ResponsiveIR adaptation; see materializeHtml()'s
  // responsiveClassByNode assignment) alongside the deduped base class.
  const rspCls = node && node.nodeId && registry.responsiveClassByNode
    ? registry.responsiveClassByNode.get(node.nodeId)
    : null;
  const classes = [cls, rspCls].filter(Boolean).join(' ');
  const clsAttr = classes ? ` class="${classes}"` : '';

  // Design Skeleton role (compiler/skeleton, see ir-experimental-renderer.js's
  // buildRenderNode() comment) — 'decorative-chrome'/'leaf-shape' means this
  // node carries no information of its own (a background rect, a divider),
  // as opposed to 'content' (real text/image/icon), which this role scheme
  // never assigns to a node with real text or an image fill — so this can
  // never suppress real content, only genuine decoration.
  const isDecorativeRole = node.role === 'decorative-chrome' || node.role === 'leaf-shape';

  // Broadened beyond literal `type === 'IMAGE'` — real-fixture validation
  // (Challenge Arena) showed image-bearing nodes are usually RECTANGLE/
  // ELLIPSE shapes carrying an IMAGE-type Figma paint, not literal IMAGE-type
  // nodes. `ir-experimental-renderer.js`'s `buildRenderNode()` already did
  // the type-agnostic detection (mirroring legacy's `imageRefOf()`) and set
  // `node.isImageFill`/`node.src` for any such node; this only reads that
  // flag. Falls back to the pre-existing `type === 'IMAGE'` / `tag === 'img'`
  // checks so any caller not populating `isImageFill` keeps prior behavior.
  if (String(node.type || '').toUpperCase() === 'IMAGE' || tag === 'img' || node.isImageFill) {
    // A real, previously-shipped accessibility gap, not hypothetical: every
    // image got its raw Figma layer name as alt text (e.g. "Rectangle 47"),
    // regardless of whether it was real content or pure decoration — a
    // screen reader reading that aloud for a background rectangle is noise,
    // not information. Decorative images get the empty alt="" HTML itself
    // defines for exactly this case; real content keeps its existing name.
    const alt = isDecorativeRole ? '' : (node.name || '');
    return `${pad}<img${clsAttr} src="${esc(node.src || '')}" alt="${esc(alt)}">`;
  }

  if (String(node.type || '').toUpperCase() === 'TEXT') {
    const runs = textRuns(node);
    const inner = runs.map((r) => {
      const t = esc(r.text).replace(/\n/g, '<br>');
      return r.style ? `<span style="${runStyleCss(r.style)}">${t}</span>` : t;
    }).join('');
    return `${pad}<${tag}${clsAttr}>${inner}</${tag}>`;
  }

  // No prior aria-hidden handling existed anywhere in this render path —
  // purely additive. Hidden from assistive technology only; has no effect
  // whatsoever on visual rendering, layout, or CSS.
  const a11yAttr = isDecorativeRole ? ' aria-hidden="true"' : '';
  const children = node.children || [];
  if (!children.length) return `${pad}<${tag}${clsAttr}${a11yAttr}></${tag}>`;
  const inner = children.map((c) => renderNode(c, registry, indent + 1, section)).join('\n');
  return `${pad}<${tag}${clsAttr}${a11yAttr}>\n${inner}\n${pad}</${tag}>`;
}

/**
 * Port of `emit()`'s label derivation: `Group 1171277963` -> `Group 1171277963`
 * (slug then title-case each hyphen-split word) — unchanged formula.
 */
function labelFor(name) {
  const s = slug(name);
  return s.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Port of `emit()`'s non-nested-emit branch: wrap each top-level child of
 * the root in a labeled `<section>`/`<header>`/`<footer>` with an HTML
 * comment, exactly matching legacy's `sectionBlocks` construction.
 *
 * @returns {{ blocks: string[], sectionOrder: Array<{key:string,label:string}> }}
 */
function renderSections(root, registry, indent) {
  const rootChildren = (root.children && root.children.length) ? root.children : [root];
  const sectionOrder = [];
  const blocks = rootChildren.map((child) => {
    const name = slug(child.name);
    const label = labelFor(child.name);
    sectionOrder.push({ key: name, label });
    const layoutChoice = child.layoutChoice || {};
    const childTag = chooseTag(child, layoutChoice);
    const semTag = childTag === 'header' || childTag === 'footer' ? childTag : 'section';
    const inner = renderNode(child, registry, indent + 1, name);
    const pad = '  '.repeat(indent);
    return `${pad}<!-- Section: ${label} -->\n${pad}<${semTag} class="section-${name}">\n${inner}\n${pad}</${semTag}>`;
  });
  return { blocks, sectionOrder };
}

/**
 * Real, confirmed bug (Figma file eOwzPCQP0f3sAxzI0T0b9d, "Group 357", the
 * "3 Month" clock icon on each recommended-course card): Figma's common
 * "paste an icon-font glyph as a text layer" workflow sets that text node's
 * `fontName` to an ICON font (here "Font Awesome 5 Free") — this is a
 * legitimate, correctly-ingested font-family name (NDG/ingest.js reads it
 * faithfully, and even preserves the raw Unicode codepoint the glyph itself
 * needs, U+F017 — Font Awesome 5's own "clock" character, verified byte-for-
 * byte against the compiled HTML). But every icon font's actual font FILE
 * lives on its own CDN, never on Google Fonts — routing it through
 * `fontsLink()`'s Google Fonts query (as every other collected family is)
 * requests a family Google Fonts doesn't have, silently fails to load, and
 * the browser falls back to a "tofu" box for that codepoint — exactly the
 * broken square glyph the user's screenshot shows standing in for a clock.
 * Real Figma designs routinely use icon fonts this way (small UI glyphs are
 * a common lightweight alternative to individual vector icons), so this is
 * a general gap, not specific to this one card. Known icon-font families
 * are routed to their own real, official CDN stylesheet instead of the
 * Google Fonts query; anything not recognized as an icon font still goes
 * through the unchanged Google Fonts path below.
 */
const ICON_FONT_STYLESHEETS = {
  'font awesome 5 free': 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css',
  'font awesome 5 brands': 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css',
  'font awesome 6 free': 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
  'font awesome 6 brands': 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
};

/**
 * Port of server/figma-build.js's fontsLink() — unchanged URL-building
 * formula (same query-param format: one `family=<name>:wght@400;500;600;700`
 * param per unique font family, `+` for spaces, `&display=swap`) for real
 * Google Fonts families. Icon fonts (see ICON_FONT_STYLESHEETS above) are
 * split out and given their own `<link>` to their real CDN instead.
 * @param {string[]} [fonts]
 * @returns {string} the combined `<link>` tags, or '' if no real fonts were found.
 */
function fontsLink(fonts) {
  const fams = [...new Set((fonts || []).filter(Boolean))];
  if (!fams.length) return '';
  const iconFontUrls = new Set();
  const googleFams = [];
  for (const f of fams) {
    const url = ICON_FONT_STYLESHEETS[f.trim().toLowerCase()];
    if (url) iconFontUrls.add(url);
    else googleFams.push(f);
  }
  const links = [];
  if (googleFams.length) {
    const q = googleFams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&');
    links.push(`  <link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${q}&display=swap">`);
  }
  for (const url of iconFontUrls) {
    links.push(`  <link rel="stylesheet" href="${url}">`);
  }
  return links.join('\n');
}

/**
 * Port of server/figma-build.js's buildHtml() document shell — unchanged
 * shape, plus (additive) a real Google Fonts `<link>` when `fonts` names any
 * real font family, mirroring legacy's own `fontsLink()` call exactly.
 */
function buildHtmlDocument(title, body, fonts) {
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

/**
 * Materialize a render tree into literal HTML + CSS.
 *
 * Ports `emit()`'s non-nested-emit branch (section-per-top-level-child, the
 * shape Articles/IBM/Challenge Arena all use) and `buildCss`'s block
 * ordering: header comment, reset, page (if `opts.canvas`/root has a box),
 * common/shared rules (classes used across >1 section), per-section rule
 * blocks (in section order), then the fixed responsive/standards block.
 *
 * @param {RenderNode} root
 * @param {{ title?: string, canvas?: { fillCss?: string, box?: {width:number,height:number}, clips?: boolean, padding?: {top?:number,right?:number,bottom?:number,left?:number} }, fonts?: string[] }} [opts]
 *   `opts.fonts` — real font family names used across the document (collected
 *   by ir-experimental-renderer.js's `buildRenderNode`); emits a Google Fonts
 *   `<link>` in the document `<head>` when non-empty (see `fontsLink()`).
 * @returns {{ html: string, css: string }}
 */
function materializeHtml(root, opts = {}) {
  const registry = buildClassRegistry();

  // Phase 4 — assign a dedicated per-node class to every node with a real
  // (non-abstain) ResponsiveIR adaptation, BEFORE rendering, so renderNode()
  // can attach it while walking the tree. `opts.responsiveIr` is the
  // published ResponsiveIR payload shape ({ breakpoints, adaptations, ... }
  // — see compiler/responsive/project.js). Optional and additive: when
  // absent, output is byte-identical to before this phase.
  const responsiveIr = opts.responsiveIr || null;
  if (responsiveIr && Array.isArray(responsiveIr.adaptations)) {
    for (const a of responsiveIr.adaptations) {
      if (a && a.nodeId && a.strategy !== 'abstain') {
        registry.responsiveClassByNode.set(a.nodeId, `rsp-${slug(a.nodeId)}`);
      }
    }
  }

  const { blocks, sectionOrder } = renderSections(root, registry, 2);
  const bodyInner = blocks.join('\n\n');
  const body = `  <div class="et-page">\n${bodyInner}\n  </div>`;
  const html = buildHtmlDocument(opts.title || 'Compiled design', body, opts.fonts);

  const parts = [`/* styles.css — generated by compiler/emit/render (Phase 3 renderer) */`, CSS_RESET_BLOCK];

  const canvas = opts.canvas
    || (root.box ? {
      fillCss: root.fillCss, box: root.box, clips: root.clips, padding: root.padding, sectionGap: root.gap,
    } : null);
  if (canvas && (canvas.fillCss || canvas.box)) {
    const decls = canvasDecls(canvas);
    if (decls.length) parts.push(`/* --- page --- */\n.et-page {\n${declBody(decls)}\n}`);
  }
  // The ROOT node's own Auto Layout gap (`itemSpacing`) BETWEEN its
  // top-level children — see ir-experimental-renderer.js's `gap` comment on
  // the RenderNode return for the full root-cause writeup (real bug: Figma
  // node 43:2, "section.section-light", itemSpacing:84 rendered as a hard
  // 0px gap). `renderSections()` above already emitted each root child as
  // its own sibling `<section>`/`<header>`/`<footer>` with zero shared
  // container to hang a flexbox `gap` off — a plain adjacent-sibling
  // selector (matching CSS `gap`'s own "between every pair, not just after
  // the first" semantics, without needing to know each section's tag name)
  // is the direct fix.
  if (canvas && Number.isFinite(canvas.sectionGap) && canvas.sectionGap > 0 && sectionOrder.length > 1) {
    parts.push(`/* --- page section spacing --- */\n.et-page > * + * {\n  margin-top: ${px(canvas.sectionGap)};\n}`);
  }

  const ruleFor = (name) => {
    const decls = registry.nameToDecls.get(name);
    if (!decls || !decls.length) return '';
    return `.${name} {\n${declBody(decls)}\n}`;
  };
  const common = [];
  const bySection = {};
  for (const name of registry.usedOrder) {
    const rule = ruleFor(name);
    if (!rule) continue;
    const secs = registry.nameSections.get(name) || new Set();
    if (secs.size > 1) {
      common.push(rule);
    } else {
      const s = [...secs][0] || 'misc';
      (bySection[s] || (bySection[s] = [])).push(rule);
    }
  }
  if (common.length) parts.push(`/* ===== Common / shared ===== */\n${common.join('\n\n')}`);
  const seen = new Set();
  for (const { key, label } of sectionOrder) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (bySection[key] && bySection[key].length) {
      parts.push(`/* ===== Section: ${label} ===== */\n${bySection[key].join('\n\n')}`);
    }
  }

  // Phase 4 — literal @media text from ResponsiveIR's adaptations, keyed to
  // the dedicated per-node classes assigned above. Placed after per-section
  // rules so a real per-node decision always outranks any generic fallback
  // for the same property at the same viewport.
  if (responsiveIr) {
    const responsiveCss = buildResponsiveMediaCss(
      responsiveIr.adaptations,
      responsiveIr.breakpoints,
      (nodeId) => registry.responsiveClassByNode.get(nodeId),
      (nodeId) => registry.layoutChoiceByNode.get(nodeId)
    );
    if (responsiveCss) parts.push(`/* ===== Responsive (Phase 4) ===== */\n${responsiveCss}`);
  }

  // RESPONSIVE_STANDARDS_BLOCK (legacy's `.et-card`/`.et-banner`/`.et-flow-row`/
  // `.et-measured-*`/... heuristic classes) is deliberately NOT appended here —
  // this renderer's own class-name vocabulary (tag.js/css-declarations.js) never
  // assigns any of those class names to anything, on any input (grepped both
  // modules: zero occurrences), so every rule in that block would be permanent
  // dead CSS shipped on every single page. It was only ever included for a
  // since-abandoned byte-diff-against-legacy comparison (see git history on
  // this file / scripts/render-byte-diff.js) — not needed for real output.
  const css = parts.join('\n\n') + '\n';

  return { html, css };
}

module.exports = {
  materializeHtml,
  buildHtmlDocument,
  buildClassRegistry,
  renderNode,
  renderSections,
  labelFor,
  esc,
  slug,
  textRuns,
  runStyleCss,
  fontsLink,
};
