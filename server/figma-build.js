// figma-build.js
// Walks a Figma node subtree into a clean element tree, dedupes styles into
// semantic reusable classes (named from the Figma layer names), and emits
// index.html + styles.css + script.js matching the Lovable converter's output.
//   analyze(root) -> { tree, imageNodeIds, svgNodeIds, fonts }
//   emit(tree, { imageUrls, svgMarkup, title }) -> { html, css, js, sections, ... }

const { nodeDecls, figmaColor } = require('./figma-generate');

const VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'LINE', 'STAR', 'REGULAR_POLYGON']);
const CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']);
const px = (n) => `${Math.round((n + 1e-9) * 100) / 100}px`;

// Flow inference (generator-only, deterministic). A freeform container whose
// children form a clean, non-overlapping, evenly-spaced vertical/horizontal stack
// is really a normal flow layout drawn with coordinates — emit it as
// flex-direction:column|row + gap and drop the children's absolute placement.
// This is CONSERVATIVE by design: it only fires when the flexed result reproduces
// the exact same box positions (aligned edges + uniform gaps), so visual output
// never changes. Anything with overlap or freeform placement stays absolute.
const ALIGN_TOL = 2; // px — sibling edges within this count as aligned
const GAP_TOL = 2;   // px — inter-item gaps within this count as uniform
function overlaps(a, b) {
  return a.x < b.x + b.width - ALIGN_TOL && a.x + a.width > b.x + ALIGN_TOL
    && a.y < b.y + b.height - ALIGN_TOL && a.y + a.height > b.y + ALIGN_TOL;
}
function inferFlow(el) {
  if (!el || !el.children || !el.children.length) return;
  el.children.forEach(inferFlow); // depth-first: settle children before their parent

  const kids = el.children;
  if (kids.length < 2 || !el.box) return;
  // Only plain boxes/images that we placed absolutely qualify. Raw <svg> children
  // don't carry their class/position, so a group containing one is left as-is.
  if (!kids.every((c) => (c.kind === 'el' || c.kind === 'img') && c.box && c.decls && c.decls.get('position') === 'absolute')) return;
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) if (overlaps(kids[i].box, kids[j].box)) return; // overlap → keep absolute
  }

  const gapsOf = (arr, axis) => arr.slice(1).map((c, i) => {
    const p = arr[i].box, q = c.box;
    return axis === 'y' ? q.y - (p.y + p.height) : q.x - (p.x + p.width);
  });
  const uniform = (g) => g.every((x) => x >= -ALIGN_TOL) && (Math.max(...g) - Math.min(...g) <= GAP_TOL);
  const aligned = (arr, edge) => { const v = arr.map((k) => (edge === 'x' ? k.box.x : k.box.y)); return Math.max(...v) - Math.min(...v) <= ALIGN_TOL; };

  const byY = [...kids].sort((a, b) => a.box.y - b.box.y);
  const byX = [...kids].sort((a, b) => a.box.x - b.box.x);
  let dir, arr, gaps;
  if (aligned(byY, 'x') && uniform(gapsOf(byY, 'y'))) { dir = 'column'; arr = byY; gaps = gapsOf(byY, 'y'); }
  else if (aligned(byX, 'y') && uniform(gapsOf(byX, 'x'))) { dir = 'row'; arr = byX; gaps = gapsOf(byX, 'x'); }
  else return;

  const gap = Math.max(0, gaps.reduce((a, b) => a + b, 0) / gaps.length);
  const padTop = Math.max(0, arr[0].box.y - el.box.y);
  const padLeft = Math.max(0, Math.min(...arr.map((k) => k.box.x)) - el.box.x);

  el.children = arr; // emit in visual order (also fixes shuffled Figma layer order)
  el.decls.set('display', 'flex');
  el.decls.set('flex-direction', dir);
  el.decls.set('align-items', 'flex-start');
  if (gap >= 0.5) el.decls.set('gap', px(gap));
  if (padTop >= 0.5 || padLeft >= 0.5) el.decls.set('padding', `${px(padTop)} 0 0 ${px(padLeft)}`);
  if (el.decls.get('position') === 'relative') el.decls.delete('position'); // no absolute kids left to anchor
  for (const c of arr) {
    c.decls.delete('left'); c.decls.delete('top');
    // a converted child that still hosts absolute descendants must stay a containing block
    const hostsAbs = (c.children || []).some((ch) => ch.decls && ch.decls.get('position') === 'absolute');
    if (hostsAbs) c.decls.set('position', 'relative'); else c.decls.delete('position');
  }
}

function slug(text) {
  const s = (text || '').toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 5).join('-').slice(0, 40).replace(/-+$/g, '') || 'box';
  // A CSS class can't start with a digit; numeric layer names ("872.400", "4")
  // would otherwise emit invalid selectors that the browser drops entirely.
  return /^[0-9]/.test(s) ? 'n-' + s : s;
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Split a text node into styled runs from characterStyleOverrides + styleOverrideTable.
// characterStyleOverrides[i] = override id for char i (0/undefined = base style);
// styleOverrideTable[id] = partial style. Consecutive same-id chars form one run.
function textRuns(node) {
  const chars = node.characters || '';
  const ov = node.characterStyleOverrides || [];
  const table = node.styleOverrideTable || {};
  if (!chars || !ov.length || !Object.keys(table).length) return [{ text: chars }];
  const runs = [];
  for (let i = 0; i < chars.length;) {
    const id = ov[i] || 0;
    let j = i; while (j < chars.length && (ov[j] || 0) === id) j++;
    const text = chars.slice(i, j);
    runs.push(id && table[id] ? { text, style: table[id] } : { text });
    i = j;
  }
  return runs;
}
// Inline CSS for a run's per-range overrides (only the props that can differ).
function runStyleCss(s) {
  const d = [];
  const fills = (s.fills || []).filter((f) => f.visible !== false);
  const top = fills[fills.length - 1];
  if (top && top.type === 'SOLID') d.push(`color:${figmaColor(top.color, top.opacity)}`);
  if (s.fontWeight) d.push(`font-weight:${s.fontWeight}`);
  if (s.italic || /italic|oblique/i.test(s.fontStyle || '')) d.push('font-style:italic');
  if (s.fontSize) d.push(`font-size:${px(s.fontSize)}`);
  if (s.letterSpacing) d.push(`letter-spacing:${px(s.letterSpacing)}`);
  if (s.textDecoration === 'UNDERLINE') d.push('text-decoration:underline');
  if (s.fontFamily) d.push(`font-family:'${s.fontFamily}', sans-serif`);
  return d.join(';');
}

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

// Clip media that overflows its frame. Avatars/cover photos are exported as an
// oversized, negatively-offset image meant to be cropped by their frame (Figma's
// mask pattern, where the clip shape is often a sibling ellipse). Generic rule: if
// an <img> child extends beyond its parent's box, clip the parent and let the image
// fill it, inheriting a sibling's border-radius as the mask shape (→ circular
// avatars, rounded photos). Runs after inferFlow so positions are settled.
function clipMedia(el) {
  if (!el || !el.children || !el.children.length) return;
  el.children.forEach(clipMedia);
  if (!el.box) return;
  for (const c of el.children) {
    if (c.kind !== 'img' || !c.box) continue;
    const b = c.box, p = el.box;
    const overflows = b.x < p.x - 0.5 || b.y < p.y - 0.5
      || b.x + b.width > p.x + p.width + 0.5 || b.y + b.height > p.y + p.height + 0.5;
    if (!overflows) continue;
    el.decls.set('overflow', 'hidden');
    if (!el.decls.get('position')) el.decls.set('position', 'relative');
    const rounded = el.children.find((s) => s !== c && s.decls && s.decls.get('border-radius'));
    if (rounded && !el.decls.get('border-radius')) el.decls.set('border-radius', rounded.decls.get('border-radius'));
    c.decls.set('left', '0'); c.decls.set('top', '0'); c.decls.set('width', '100%'); c.decls.set('height', '100%');
  }
}

// ---- analyze: node tree -> element tree -------------------------------------
function analyze(root) {
  const imageNodeIds = new Set();
  const svgNodeIds = new Set();
  const svgNodes = {};
  const fonts = new Set();
  const ctx = { exportImage: (id) => imageNodeIds.add(id), bgImageNodes: new Set(), fonts };

  function walk(node, parent, isRoot) {
    if (node.visible === false) return null;

    // vector / icon (or an all-vector group) → export as ONE SVG, don't recurse
    if (!isRoot && (VECTOR_TYPES.has(node.type) || isVectorOnly(node))) {
      svgNodeIds.add(node.id);
      svgNodes[node.id] = node; // kept so emit can reconstruct SVG locally (no /images REST)
      return { kind: 'svg', nodeId: node.id, name: node.name, decls: nodeDecls(node, parent, ctx), box: node.absoluteBoundingBox };
    }

    const decls = nodeDecls(node, parent, ctx);
    const el = { kind: 'el', type: node.type, name: node.name || 'box', tag: tagFor(node, decls), decls, children: [], nodeId: node.id, box: node.absoluteBoundingBox };

    if (node.type === 'TEXT') {
      const runs = textRuns(node);
      if (runs.length > 1) el.runs = runs; else el.text = node.characters || '';
      return el;
    }

    // image fill → capture its imageRef (resolved via the fills-images map);
    // fall back to per-node render only if there's no ref.
    if (hasImageFill(node)) {
      el.imageRef = imageRefOf(node);
      if (!el.imageRef) imageNodeIds.add(node.id);
      if (!node.children || !node.children.length) {
        el.kind = 'img';
        // A real <img> is styled with object-fit, not background-* — drop the
        // background paint props nodeDecls emitted (they only apply to a
        // background-image container) so the rule reads like hand-written CSS.
        el.decls.delete('background-image'); el.decls.delete('background-size'); el.decls.delete('background-position'); el.decls.delete('background-repeat');
        el.decls.delete('border'); el.decls.delete('outline'); // a photo layer's stroke is not a real border
        // Render photos to their BOX with object-fit (Figma scaleMode → cover/
        // contain), not the raw bitmap's intrinsic size. When the image layer is
        // larger than a clipping parent (avatar/photo crops), fill the parent and
        // let its overflow:hidden do the crop — a human would write exactly this,
        // instead of an oversized, negatively-offset <img>.
        const paint = (node.fills || []).find((f) => f.visible !== false && f.type === 'IMAGE');
        el.decls.set('object-fit', paint && paint.scaleMode === 'FIT' ? 'contain' : 'cover');
        const pb = parent && parent.absoluteBoundingBox;
        const b = node.absoluteBoundingBox;
        if (parent && parent.clipsContent && pb && b && (b.width > pb.width + 0.5 || b.height > pb.height + 0.5)) {
          el.decls.set('left', '0'); el.decls.set('top', '0');
          el.decls.set('width', '100%'); el.decls.set('height', '100%');
        }
        return el;
      }
      el.imageFill = true; // container → background-image
    }

    if (CONTAINER_TYPES.has(node.type) && node.children) {
      // A freeform container must be a containing block for its absolute children.
      // If nodeDecls already placed it with `position:absolute` (a freeform child
      // of a freeform parent), that IS a containing block — keep it, so the node
      // stays at its coordinates. Only add `position:relative` when it isn't
      // already positioned (an in-flow container, e.g. under auto-layout or the
      // root). Overwriting absolute→relative was what made containers collapse
      // into normal flow instead of sitting at their coordinates.
      const auto = node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL';
      if (!auto && node.children.some((c) => c.visible !== false) && el.decls.get('position') !== 'absolute') {
        el.decls.set('position', 'relative');
      }
      for (const child of node.children) { const c = walk(child, node); if (c) el.children.push(c); }
    }
    return el;
  }

  const tree = walk(root, null, true);
  // Remember the root frame's own box + clip so emit() can build a single canvas
  // that carries the page background and gives every section one coordinate system.
  if (tree) { tree.box = root.absoluteBoundingBox || null; tree.clips = root.clipsContent === true; }
  if (tree) inferFlow(tree); // collapse coordinate-drawn stacks into real flex flow
  if (tree) clipMedia(tree); // crop oversized avatar/cover images to their frame
  return { tree, imageNodeIds: [...imageNodeIds], svgNodeIds: [...svgNodeIds], svgNodes, fonts: [...fonts], bgImageNodes: [...ctx.bgImageNodes] };
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
    if (el.runs) {
      const inner = el.runs.map((r) => {
        const t = esc(r.text).replace(/\n/g, '<br>');
        return r.style ? `<span style="${runStyleCss(r.style)}">${t}</span>` : t;
      }).join('');
      return `${pad}<${el.tag}${clsAttr}>${inner}</${el.tag}>`;
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
    // paintLayers emitted a `__IMG__` sentinel per image layer; swap it for the
    // resolved url now (composes correctly with stacked gradient/solid layers).
    if (el.decls) {
      const bg = el.decls.get('background-image');
      if (bg && bg.includes('__IMG__')) {
        const u = imgUrl(el);
        el.decls.set('background-image', u ? bg.split('__IMG__').join(`url("${u}")`) : bg.replace(/(^|,\s*)__IMG__(\s*,|$)/g, '$1$2').replace(/^,\s*|,\s*$/g, ''));
      }
    }
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

  // Root canvas: one element that owns the page background (root frame fill +
  // radius + shadow, otherwise lost because the root frame is never rendered) and
  // establishes a single coordinate system for all top-level sections. Keeps the
  // root's own layout (flex for an auto-layout root); adds position:relative only
  // for a freeform root so its absolutely-placed sections anchor to it.
  const canvasDecls = new Map(tree.decls || []);
  if (tree.box) { canvasDecls.set('width', px(tree.box.width)); canvasDecls.set('min-height', px(tree.box.height)); }
  canvasDecls.set('margin', '0 auto');
  if (!canvasDecls.has('display')) canvasDecls.set('position', 'relative');
  if (tree.clips) canvasDecls.set('overflow', 'hidden');

  const sectionsHtml = sectionBlocks.join('\n\n').replace(/^/gm, '  ');
  const body = `  <div class="canvas">\n${sectionsHtml}\n  </div>`;
  const css = buildCss({ nameToDecls, nameSections, sectionOrder, usedOrder, canvasDecls });
  const html = buildHtml(title, body, fonts);
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

function buildCss({ nameToDecls, nameSections, sectionOrder, usedOrder, canvasDecls }) {
  const parts = [];
  parts.push(`/* styles.css — generated from the Figma design */`);
  parts.push(`/* --- reset --- */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; -webkit-font-smoothing: antialiased; }
img, svg { display: block; max-width: 100%; }
p, h1, h2, h3, h4, h5, h6 { margin: 0; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }`);

  if (canvasDecls && canvasDecls.size) {
    const b = [...canvasDecls.entries()].map(([k, v]) => `  ${k}: ${v};`).join('\n');
    parts.push(`/* --- canvas --- */\n.canvas {\n${b}\n}`);
  }

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
