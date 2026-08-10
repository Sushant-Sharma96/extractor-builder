#!/usr/bin/env node
require('dotenv').config();
const path = require('path');
process.env.FIGMA_CACHE_DIR = path.resolve('output/figma-cache');
const snap = require('../server/figma-snapshot');
const fb = require('../server/figma-build');

function find(n, id) {
  if (!n) return null;
  if (n.id === id) return n;
  for (const c of n.children || []) {
    const f = find(c, id);
    if (f) return f;
  }
  return null;
}
function findText(n, re, acc = []) {
  if (!n) return acc;
  if (n.type === 'TEXT' && re.test(n.characters || '')) {
    acc.push({
      id: n.id,
      name: n.name,
      chars: (n.characters || '').slice(0, 100),
      box: n.absoluteBoundingBox,
    });
  }
  for (const c of n.children || []) findText(c, re, acc);
  return acc;
}
function chainUp(n, target, acc = []) {
  if (!n) return acc;
  if (n.id === target) {
    acc.push({ id: n.id, name: n.name, type: n.type });
    return acc;
  }
  for (const c of n.children || []) {
    const before = acc.length;
    chainUp(c, target, acc);
    if (acc.length > before) {
      acc.unshift({
        id: n.id,
        name: n.name,
        type: n.type,
        al: n.layoutMode || null,
        box: n.absoluteBoundingBox,
      });
      return acc;
    }
  }
  return acc;
}
function findEl(el, pred) {
  if (!el) return null;
  if (pred(el)) return el;
  for (const c of el.children || []) {
    const f = findEl(c, pred);
    if (f) return f;
  }
  return null;
}

const sub = snap.loadSubtreeSnapshot('oPJPuHvvZOPo4nkzVxr11M', '11:79')
  || snap.loadSnapshot('oPJPuHvvZOPo4nkzVxr11M', '11:79');
const page = snap.loadSnapshot('oPJPuHvvZOPo4nkzVxr11M', '0:1');
const doc = find(sub.document, '11:79') || sub.document;

const quoteNodes = findText(doc, /evolution from manual/i);
console.log('QUOTE_IN_NODE', quoteNodes);
if (quoteNodes[0]) console.log('QUOTE_CHAIN', chainUp(doc, quoteNodes[0].id));

if (page) {
  const root = page.document;
  const kids = (root.children || []).filter((c) => c.visible !== false);
  console.log('PAGE_TOP_CHILDREN', kids.map((k) => ({
    id: k.id,
    name: k.name,
    type: k.type,
    y: k.absoluteBoundingBox && Math.round(k.absoluteBoundingBox.y),
    h: k.absoluteBoundingBox && Math.round(k.absoluteBoundingBox.height),
  })));
  console.log('EVERYTHING_ON_PAGE', findText(root, /Everything you need/i).map((e) => ({
    id: e.id,
    chars: e.chars,
    y: e.box && Math.round(e.box.y),
  })));
  const large = [];
  (function walk(n) {
    if (!n) return;
    const b = n.absoluteBoundingBox;
    if (b && b.height > 500 && (n.type === 'FRAME' || n.type === 'GROUP' || n.type === 'SECTION')) {
      large.push({
        id: n.id,
        name: n.name,
        type: n.type,
        y: Math.round(b.y),
        h: Math.round(b.height),
      });
    }
    for (const c of n.children || []) walk(c);
  })(root);
  console.log('LARGE_NODES', large.slice(0, 25));
}

const { tree, layoutReport } = fb.analyze(doc, { emitMode: 'standard' });
const { html, css } = fb.emit(tree, { title: 'IBM' });
const qel = findEl(tree, (e) =>
  /evolution from manual/i.test(e.text || '')
  || (e.runs || []).some((r) => /evolution from manual/i.test(r.text || '')));

console.log('EMIT', {
  htmlLen: html.length,
  hasQuoteInHtml: /evolution from manual/i.test(html),
  absCount: (css.match(/position:\s*absolute/g) || []).length,
  warnings: layoutReport.warnings.map((w) => w.code),
  freeform: layoutReport.freeformContainerCount,
  al: layoutReport.autoLayoutContainerCount,
});
console.log('QUOTE_EL_CSS', qel && {
  tag: qel.tag,
  name: qel.name,
  pos: qel.decls.get('position'),
  left: qel.decls.get('left'),
  top: qel.decls.get('top'),
  color: qel.decls.get('color'),
  width: qel.decls.get('width'),
  z: qel.decls.get('z-index'),
});

console.log('ROOT_BOX', doc.absoluteBoundingBox);
console.log('NODE_SCOPE_CONCLUSION', {
  nodeId: '11:79',
  height: doc.absoluteBoundingBox && doc.absoluteBoundingBox.height,
  includesEverythingSection: findText(doc, /Everything you need/i).length > 0,
  includesQuote: quoteNodes.length > 0,
  includesLifecycle: findText(doc, /AI-SDLC/i).length > 0,
});

const fs = require('fs');
fs.mkdirSync(path.resolve('output'), { recursive: true });
fs.writeFileSync(path.resolve('output/_ibm-rca.html'), html);
fs.writeFileSync(path.resolve('output/_ibm-rca.css'), css);
console.log('ASSET_STATS', {
  missingAsset: (html.match(/data-figma-missing-asset/g) || []).length,
  emptySrc: (html.match(/src=""/g) || []).length,
  imgTags: (html.match(/<img\b/gi) || []).length,
});
const bgRules = [];
for (const block of css.split('}')) {
  if (/background/i.test(block) && /#1|#0b|#16|22,\s*30/i.test(block)) {
    bgRules.push(block.replace(/\s+/g, ' ').trim().slice(0, 240));
  }
}
console.log('DARK_BG_RULES', bgRules.slice(0, 15));

// Is quote nested under a dark-bg ancestor in the tree?
function hasDarkBg(el) {
  if (!el || !el.decls) return false;
  const bg = String(el.decls.get('background-color') || '');
  return /#0|#1[0-6]|rgb\(\s*1?\d/.test(bg) || /22,\s*30,\s*68/.test(bg);
}
function pathTo(el, pred, chain = []) {
  if (!el) return null;
  chain.push({
    name: el.name,
    dark: hasDarkBg(el),
    bg: el.decls && el.decls.get('background-color'),
    disp: el.decls && el.decls.get('display'),
    extra: el.extraClass,
  });
  if (pred(el)) return chain;
  for (const c of el.children || []) {
    const f = pathTo(c, pred, chain.slice());
    if (f) return f;
  }
  return null;
}
const quotePath = pathTo(tree, (e) =>
  /evolution from manual/i.test(e.text || '')
  || (e.runs || []).some((r) => /evolution from manual/i.test(r.text || '')));
console.log('QUOTE_ANCESTOR_PATH', quotePath);
