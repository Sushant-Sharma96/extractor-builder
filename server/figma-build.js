// figma-build.js
// Walks a Figma node subtree into a clean element tree, dedupes styles into
// semantic reusable classes (named from the Figma layer names), and emits
// index.html + styles.css + script.js matching the Lovable converter's output.
//   analyze(root) -> { tree, imageNodeIds, svgNodeIds, fonts }
//   emit(tree, { imageUrls, svgMarkup, title }) -> { html, css, js, sections, ... }

const { nodeDecls } = require('./figma-generate');

const VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'LINE', 'STAR', 'REGULAR_POLYGON']);
const CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']);

function slug(text) {
  return (text || '').toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 5).join('-').slice(0, 40).replace(/-+$/g, '') || 'box';
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function hasImageFill(node) { return (node.fills || []).some((f) => f.visible !== false && f.type === 'IMAGE'); }
function imageRefOf(node) { const f = (node.fills || []).find((x) => x.visible !== false && x.type === 'IMAGE'); return f ? f.imageRef : null; }

// A node whose whole subtree is vectors (an icon/logo) — export it as ONE SVG
// instead of dozens of sub-paths (avoids hammering the images API).
function isVectorOnly(node) {
  if (node.visible === false) return false;
  if (VECTOR_TYPES.has(node.type)) return true;
  if (node.type === 'TEXT' || hasImageFill(node)) return false;
  if (CONTAINER_TYPES.has(node.type) && node.children && node.children.length) {
    const kids = node.children.filter((c) => c.visible !== false);
    return kids.length > 0 && kids.every(isVectorOnly);
  }
  return false;
}

// pick a semantic tag from the node type + name + text size
function tagFor(node, decls) {
  const name = (node.name || '').toLowerCase();
  if (node.type === 'TEXT') {
    const fs = node.style && node.style.fontSize || 0;
    if (/h1|title|headline/.test(name) || fs >= 40) return 'h1';
    if (fs >= 28) return 'h2';
    if (fs >= 20) return 'h3';
    return 'p';
  }
  if (/(^|\s|\/)(button|btn|cta)(\s|$|\/)/.test(name)) return 'button';
  if (/(^|\s)(nav|navbar|menu)(\s|$)/.test(name)) return 'nav';
  if (/(^|\s)footer(\s|$)/.test(name)) return 'footer';
  if (/(^|\s)header(\s|$)/.test(name)) return 'header';
  return 'div';
}

// ---- analyze: node tree -> element tree -------------------------------------
function analyze(root) {
  const imageNodeIds = new Set();
  const svgNodeIds = new Set();
  const fonts = new Set();
  const ctx = { exportImage: (id) => imageNodeIds.add(id), bgImageNodes: new Set(), fonts };

  function walk(node, parent, isRoot) {
    if (node.visible === false) return null;

    // vector / icon (or an all-vector group) → export as ONE SVG, don't recurse
    if (!isRoot && (VECTOR_TYPES.has(node.type) || isVectorOnly(node))) {
      svgNodeIds.add(node.id);
      return { kind: 'svg', nodeId: node.id, name: node.name, decls: nodeDecls(node, parent, ctx) };
    }

    const decls = nodeDecls(node, parent, ctx);
    const el = { kind: 'el', type: node.type, name: node.name || 'box', tag: tagFor(node, decls), decls, children: [], nodeId: node.id };

    if (node.type === 'TEXT') { el.text = node.characters || ''; return el; }

    // image fill → capture its imageRef (resolved via the fills-images map);
    // fall back to per-node render only if there's no ref.
    if (hasImageFill(node)) {
      el.imageRef = imageRefOf(node);
      if (!el.imageRef) imageNodeIds.add(node.id);
      if (!node.children || !node.children.length) { el.kind = 'img'; return el; }
      el.imageFill = true; // container → background-image
    }

    if (CONTAINER_TYPES.has(node.type) && node.children) {
      // freeform container needs position:relative so absolute children anchor
      const auto = node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL';
      if (!auto && node.children.some((c) => c.visible !== false)) el.decls.set('position', 'relative');
      for (const child of node.children) { const c = walk(child, node); if (c) el.children.push(c); }
    }
    return el;
  }

  const tree = walk(root, null, true);
  return { tree, imageNodeIds: [...imageNodeIds], svgNodeIds: [...svgNodeIds], fonts: [...fonts], bgImageNodes: [...ctx.bgImageNodes] };
}

// ---- emit: element tree -> HTML + CSS ---------------------------------------
function emit(tree, { imageUrls = {}, imageFillUrls = {}, svgMarkup = {}, title = 'Figma design', fonts = [] } = {}) {
  const imgUrl = (el) => (el.imageRef && imageFillUrls[el.imageRef]) || imageUrls[el.nodeId] || '';
  const sigToName = new Map();
  const nameToDecls = new Map();
  const nameCounts = new Map();
  const nameSections = new Map();
  const usedOrder = [];

  function declString(decls) {
    return [...decls.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}:${v}`).join(';');
  }
  function classFor(el, section) {
    if (!el.decls || !el.decls.size) return null;
    const sig = declString(el.decls);
    let name = sigToName.get(sig);
    if (!name) {
      const base = slug(el.name);
      const n = (nameCounts.get(base) || 0) + 1; nameCounts.set(base, n);
      name = n === 1 ? base : `${base}-${n}`;
      sigToName.set(sig, name); nameToDecls.set(name, el.decls);
    }
    if (!nameSections.has(name)) nameSections.set(name, new Set());
    nameSections.get(name).add(section);
    if (!usedOrder.includes(name)) usedOrder.push(name);
    return name;
  }

  function renderEl(el, section, indent) {
    const pad = '  '.repeat(indent);
    if (el.kind === 'svg') {
      let svg = svgMarkup[el.nodeId];
      if (svg) { svg = svg.replace(/<\?xml[^>]*\?>/, '').trim(); return `${pad}${svg}`; }
      const url = imgUrl(el);
      return url ? `${pad}<img src="${url}" alt="${esc(el.name)}">` : '';
    }
    const cls = classFor(el, section);
    const clsAttr = cls ? ` class="${cls}"` : '';
    if (el.kind === 'img') {
      return `${pad}<img${clsAttr} src="${imgUrl(el)}" alt="${esc(el.name)}">`;
    }
    if (el.text != null) return `${pad}<${el.tag}${clsAttr}>${esc(el.text).replace(/\n/g, '<br>')}</${el.tag}>`;
    if (!el.children || !el.children.length) return `${pad}<${el.tag}${clsAttr}></${el.tag}>`;
    const inner = el.children.map((c) => renderEl(c, section, indent + 1)).filter(Boolean).join('\n');
    return `${pad}<${el.tag}${clsAttr}>\n${inner}\n${pad}</${el.tag}>`;
  }

  // Inject the actual background-image URL for container image fills (the URL
  // isn't known during analyze). Walk the whole tree once.
  (function injectBg(el) {
    if (!el) return;
    if (el.imageFill && el.decls) { const u = imgUrl(el); if (u) el.decls.set('background-image', `url("${u}")`); }
    (el.children || []).forEach(injectBg);
  })(tree);

  // top-level frame's children become sections
  const rootChildren = (tree.children && tree.children.length) ? tree.children : [tree];
  const sectionBlocks = [];
  const sectionOrder = [];
  rootChildren.forEach((child) => {
    const name = slug(child.name);
    sectionOrder.push({ key: name, label: name.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) });
    const label = name.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    const semTag = child.tag === 'header' || child.tag === 'footer' ? child.tag : 'section';
    const cls = classFor(child, name);
    const inner = (child.children || []).map((c) => renderEl(c, name, 3)).filter(Boolean).join('\n');
    sectionBlocks.push(`  <!-- Section: ${label} -->\n  <${semTag} class="section-${name}${cls ? ' ' + cls : ''}">\n${inner}\n  </${semTag}>`);
  });

  const css = buildCss({ nameToDecls, nameSections, sectionOrder, usedOrder });
  const html = buildHtml(title, sectionBlocks.join('\n\n'), fonts);
  const summary = [...new Set(sectionOrder.map((s) => s.label))].join(', ');
  return { html, css, js: '// static design — no runtime interactivity\n', sections: sectionOrder, sectionsSummary: summary };
}

function fontsLink(fonts) {
  const fams = [...new Set((fonts || []).filter(Boolean))];
  if (!fams.length) return '';
  const q = fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&');
  return `  <link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${q}&display=swap">`;
}

function buildHtml(title, body, fonts) {
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

function buildCss({ nameToDecls, nameSections, sectionOrder, usedOrder }) {
  const parts = [];
  parts.push(`/* styles.css — generated from the Figma design */`);
  parts.push(`/* --- reset --- */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; -webkit-font-smoothing: antialiased; }
img, svg { display: block; max-width: 100%; }
p, h1, h2, h3, h4, h5, h6 { margin: 0; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }`);

  const common = [], bySection = {};
  const ruleFor = (name) => {
    const d = nameToDecls.get(name); if (!d || !d.size) return '';
    const body = [...d.entries()].map(([k, v]) => `  ${k}: ${v};`).join('\n');
    return `.${name} {\n${body}\n}`;
  };
  for (const name of usedOrder) {
    const rule = ruleFor(name); if (!rule) continue;
    const secs = nameSections.get(name) || new Set();
    if (secs.size > 1) common.push(rule);
    else { const s = [...secs][0] || 'misc'; (bySection[s] || (bySection[s] = [])).push(rule); }
  }
  if (common.length) parts.push(`/* ===== Common / shared ===== */\n${common.join('\n\n')}`);
  const seen = new Set();
  for (const { key, label } of sectionOrder) {
    if (seen.has(key)) continue; seen.add(key);
    if (bySection[key] && bySection[key].length) parts.push(`/* ===== Section: ${label} ===== */\n${bySection[key].join('\n\n')}`);
  }
  return parts.join('\n\n') + '\n';
}

module.exports = { analyze, emit };
