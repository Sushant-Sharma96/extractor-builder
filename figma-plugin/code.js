// stripmine Figma plugin — runs INSIDE Figma (no REST API, no rate limits).
// Reads the selected frame, exports icons (SVG) + photos (PNG) locally, and
// serializes the node tree into the shape server/figma-build.js expects, then
// hands it to the UI which POSTs it to the local stripmine server.

const VECTOR = ['VECTOR', 'BOOLEAN_OPERATION', 'LINE', 'STAR', 'REGULAR_POLYGON'];
const CONTAINER = ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION'];

function paintArr(f) { return Array.isArray(f) ? f : []; }
function hasImageFill(n) { return paintArr(n.fills).some((x) => x.visible !== false && x.type === 'IMAGE'); }
function isVectorOnly(n) {
  if (n.visible === false) return false;
  if (VECTOR.indexOf(n.type) !== -1) return true;
  if (n.type === 'TEXT' || hasImageFill(n)) return false;
  if (CONTAINER.indexOf(n.type) !== -1 && n.children && n.children.length) {
    const k = n.children.filter((c) => c.visible !== false);
    return k.length > 0 && k.every(isVectorOnly);
  }
  return false;
}
function weight(style) {
  const s = (style || '').toLowerCase();
  if (s.indexOf('thin') !== -1) return 100;
  if (s.indexOf('extralight') !== -1 || s.indexOf('extra light') !== -1) return 200;
  if (s.indexOf('semibold') !== -1 || s.indexOf('semi bold') !== -1) return 600;
  if (s.indexOf('extrabold') !== -1 || s.indexOf('extra bold') !== -1) return 800;
  if (s.indexOf('light') !== -1) return 300;
  if (s.indexOf('medium') !== -1) return 500;
  if (s.indexOf('black') !== -1) return 900;
  if (s.indexOf('bold') !== -1) return 700;
  return 400;
}
function bytesToStr(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); try { return decodeURIComponent(escape(s)); } catch (e) { return s; } }

function serialize(node, isRoot) {
  const o = { id: node.id, name: node.name, type: node.type, visible: node.visible !== false };
  const bb = node.absoluteBoundingBox;
  if (bb) o.absoluteBoundingBox = { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
  if ('opacity' in node) o.opacity = node.opacity;
  if (node.rotation) o.rotation = node.rotation;

  o.fills = paintArr(node.fills).map((f) => ({ type: f.type, visible: f.visible, opacity: f.opacity, color: f.color, gradientStops: f.gradientStops, gradientHandlePositions: f.gradientHandlePositions, scaleMode: f.scaleMode, imageHash: f.imageHash }));
  o.strokes = paintArr(node.strokes).map((f) => ({ type: f.type, visible: f.visible, opacity: f.opacity, color: f.color }));
  if (typeof node.strokeWeight === 'number') o.strokeWeight = node.strokeWeight;

  if (typeof node.cornerRadius === 'number') o.cornerRadius = node.cornerRadius;
  else if ('topLeftRadius' in node) o.rectangleCornerRadii = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius];

  if (node.effects && node.effects.length) o.effects = node.effects.map((e) => ({ type: e.type, visible: e.visible, color: e.color, offset: e.offset, radius: e.radius, spread: e.spread }));

  if (node.layoutMode && node.layoutMode !== 'NONE') {
    o.layoutMode = node.layoutMode; o.itemSpacing = node.itemSpacing;
    o.paddingTop = node.paddingTop; o.paddingRight = node.paddingRight; o.paddingBottom = node.paddingBottom; o.paddingLeft = node.paddingLeft;
    o.primaryAxisAlignItems = node.primaryAxisAlignItems; o.counterAxisAlignItems = node.counterAxisAlignItems; o.layoutWrap = node.layoutWrap;
  }
  if (node.layoutSizingHorizontal) o.layoutSizingHorizontal = node.layoutSizingHorizontal;
  if (node.layoutSizingVertical) o.layoutSizingVertical = node.layoutSizingVertical;

  if (node.type === 'TEXT') {
    o.characters = node.characters;
    const st = {};
    if (node.fontName && node.fontName !== figma.mixed) { st.fontFamily = node.fontName.family; st.fontWeight = weight(node.fontName.style); }
    if (typeof node.fontSize === 'number') st.fontSize = node.fontSize;
    if (node.lineHeight && node.lineHeight.unit === 'PIXELS') st.lineHeightPx = node.lineHeight.value;
    else if (node.lineHeight && node.lineHeight.unit === 'PERCENT' && typeof node.fontSize === 'number') st.lineHeightPx = node.fontSize * node.lineHeight.value / 100;
    if (node.letterSpacing && node.letterSpacing.unit === 'PIXELS') st.letterSpacing = node.letterSpacing.value;
    else if (node.letterSpacing && node.letterSpacing.unit === 'PERCENT' && typeof node.fontSize === 'number') st.letterSpacing = node.fontSize * node.letterSpacing.value / 100;
    st.textAlignHorizontal = node.textAlignHorizontal;
    if (node.textDecoration) st.textDecoration = node.textDecoration;
    if (node.textCase) st.textCase = node.textCase;
    o.style = st;
  }

  // don't include children for vector-only groups (exported as one SVG)
  if (!(!isRoot && isVectorOnly(node)) && CONTAINER.indexOf(node.type) !== -1 && node.children) {
    o.children = node.children.filter((c) => c.visible !== false).map((c) => serialize(c, false));
  }
  return o;
}

async function collectAndExport(root) {
  const images = {}, svgs = {};
  async function walk(node, isRoot) {
    if (node.visible === false) return;
    if (!isRoot && isVectorOnly(node)) {
      try { const b = await node.exportAsync({ format: 'SVG' }); svgs[node.id] = bytesToStr(b); } catch (e) { /* skip */ }
      return;
    }
    if (hasImageFill(node)) {
      try { const b = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } }); images[node.id] = 'data:image/png;base64,' + figma.base64Encode(b); } catch (e) { /* skip */ }
    }
    if (CONTAINER.indexOf(node.type) !== -1 && node.children) { for (const c of node.children) await walk(c, false); }
  }
  await walk(root, true);
  return { images, svgs };
}

figma.showUI(__html__, { width: 360, height: 260 });

figma.ui.onmessage = async (msg) => {
  if (msg.type !== 'generate') return;
  const sel = figma.currentPage.selection;
  const root = (sel && sel.length) ? sel[0]
    : (figma.currentPage.children.filter((c) => c.type === 'FRAME')[0] || figma.currentPage.children[0]);
  if (!root) { figma.ui.postMessage({ type: 'error', error: 'Select a frame, then run again.' }); return; }
  try {
    figma.ui.postMessage({ type: 'status', msg: 'Reading "' + root.name + '"…' });
    const tree = serialize(root, true);
    figma.ui.postMessage({ type: 'status', msg: 'Exporting icons & images…' });
    const assets = await collectAndExport(root);
    figma.ui.postMessage({ type: 'payload', payload: { name: root.name, tree, images: assets.images, svgs: assets.svgs } });
  } catch (e) {
    figma.ui.postMessage({ type: 'error', error: String(e && e.message || e) });
  }
};
