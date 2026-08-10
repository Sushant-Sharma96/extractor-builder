'use strict';
/**
 * Phase 0 dual-path corpus / unit gates.
 */
const {
  analyze,
  emit,
  dualPath,
} = require('../../figma-build');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL  ${name} — ${e.message}`);
  }
}

function box(x, y, w, h) {
  return { x, y, width: w, height: h };
}

test('alCoverage: layout-bearing needs ≥2 kids; threshold is config', () => {
  assert(dualPath.AL_COVERAGE > 0 && dualPath.AL_COVERAGE <= 1, 'threshold configured');
  const freeform = {
    id: 'r',
    type: 'FRAME',
    name: 'Free',
    absoluteBoundingBox: box(0, 0, 400, 200),
    children: [
      {
        id: 'a',
        type: 'RECTANGLE',
        name: 'a',
        fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0.2, a: 1 } }],
        absoluteBoundingBox: box(0, 0, 400, 200),
      },
      {
        id: 'b',
        type: 'TEXT',
        name: 't',
        characters: 'Hello',
        style: { fontSize: 16 },
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
        absoluteBoundingBox: box(20, 20, 100, 20),
      },
    ],
  };
  const { tree, layoutReport } = analyze(freeform, { emitMode: 'auto' });
  assert(tree._route === 'B' || tree._pathB, 'freeform root → Path B');
  assert((layoutReport.routeB || 0) >= 1, 'scorecard routeB');
  assert(layoutReport.productionReady !== true, 'Path B not productionReady');
  const { html, css } = emit(tree, { title: 'B' });
  assert(html.includes('et-path-b'), 'composition contract class');
  assert(html.includes('et-path-b__stage'), 'stage wrapper');
  assert(css.includes('100cqw') || css.includes('et-path-b'), 'scale CSS present');
});

test('Path A Auto Layout subtree keeps flex; demoteReason field exists', () => {
  const doc = {
    id: 'r',
    type: 'FRAME',
    name: 'ALRoot',
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
    absoluteBoundingBox: box(0, 0, 400, 200),
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
    children: [
      {
        id: 't1',
        type: 'TEXT',
        name: 'Title',
        characters: 'Hello',
        style: { fontSize: 24, fontWeight: 600 },
        fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
        absoluteBoundingBox: box(0, 0, 200, 30),
        layoutSizingHorizontal: 'FILL',
      },
      {
        id: 't2',
        type: 'TEXT',
        name: 'Body',
        characters: 'World',
        style: { fontSize: 14 },
        fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
        absoluteBoundingBox: box(0, 42, 200, 20),
        layoutSizingHorizontal: 'FILL',
      },
    ],
  };
  const { tree, layoutReport } = analyze(doc, { emitMode: 'auto' });
  assert(Array.isArray(layoutReport.demoteReasons), 'demoteReasons on scorecard');
  assert(typeof layoutReport.alCoverageThreshold === 'number', 'threshold on report');
  // Single AL layout-bearing root → coverage 1 → Path A
  assert(tree._route === 'A' || (layoutReport.routeA >= 1), 'AL root Path A');
  const { html } = emit(tree, { title: 'A' });
  assert(html.includes('Hello') && html.includes('World'), 'text emitted');
});

test('media clamp: huge intrinsic image kept to Figma box decls', () => {
  const doc = {
    id: 'r',
    type: 'FRAME',
    name: 'Banner',
    absoluteBoundingBox: box(0, 0, 400, 200),
    children: [
      {
        id: 'bg',
        type: 'RECTANGLE',
        name: 'bg',
        fills: [{ type: 'SOLID', color: { r: 0.02, g: 0.07, b: 0.24, a: 1 } }],
        absoluteBoundingBox: box(0, 0, 400, 200),
      },
      {
        id: 'img',
        type: 'RECTANGLE',
        name: 'robot',
        fills: [{ type: 'IMAGE', imageRef: 'r1', scaleMode: 'FILL' }],
        absoluteBoundingBox: box(300, 40, 92, 135),
      },
    ],
  };
  const { tree } = analyze(doc, { emitMode: 'auto' });
  function findImg(el) {
    if (!el) return null;
    if (el.kind === 'img') return el;
    for (const c of el.children || []) {
      const f = findImg(c);
      if (f) return f;
    }
    return null;
  }
  const img = findImg(tree);
  assert(img, 'img node');
  assert(img.decls.get('width') === '92px', 'width clamped to Figma box');
  assert(img.decls.get('height') === '135px', 'height clamped to Figma box');
});

test('Path B seals only outermost shell (no nested et-path-b)', () => {
  const doc = {
    id: 'r',
    type: 'FRAME',
    name: 'Page',
    absoluteBoundingBox: box(0, 0, 800, 600),
    children: [
      {
        id: 'g1',
        type: 'GROUP',
        name: 'Outer',
        absoluteBoundingBox: box(0, 0, 800, 600),
        children: [
          {
            id: 'g2',
            type: 'GROUP',
            name: 'Inner',
            absoluteBoundingBox: box(100, 100, 400, 300),
            children: [
              {
                id: 't1',
                type: 'TEXT',
                name: 'A',
                characters: 'Hello',
                style: { fontSize: 16 },
                fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
                absoluteBoundingBox: box(120, 120, 80, 20),
              },
              {
                id: 't2',
                type: 'TEXT',
                name: 'B',
                characters: 'World',
                style: { fontSize: 16 },
                fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
                absoluteBoundingBox: box(120, 160, 80, 20),
              },
            ],
          },
          {
            id: 'bg',
            type: 'RECTANGLE',
            name: 'bg',
            fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
            absoluteBoundingBox: box(0, 0, 800, 600),
          },
        ],
      },
    ],
  };
  const { tree } = analyze(doc, { emitMode: 'pixel' });
  const { html } = emit(tree, { title: 'Nest' });
  const hostMatches = html.match(/et-path-b"/g) || [];
  const stages = (html.match(/et-path-b__stage/g) || []).length;
  assert(hostMatches.length === 1, `exactly one et-path-b\" host, got ${hostMatches.length}`);
  assert(stages === 1, `exactly one path-b stage, got ${stages}`);
  assert(html.includes('Hello') && html.includes('World'), 'text present');
});

