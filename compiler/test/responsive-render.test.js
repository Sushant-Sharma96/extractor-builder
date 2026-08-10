'use strict';

/**
 * Phase 4 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — Responsive emission +
 * remaining polish heuristics. Tests:
 *   - compiler/emit/render/responsive-media.js (`@media` emission for every
 *     STRATEGY the ResponsiveIR vocabulary defines)
 *   - an end-to-end proof that a real ResponsiveIR Adaptation Fact produces
 *     a real `@media` block through materializeHtml()
 *   - compiler/geometry/rules/structural-polish.js (the heuristics that
 *     needed NEW detection logic)
 *   - compiler/emit/render/polish.js (the heuristics that needed only
 *     renderer wiring over already-known facts)
 *   - the "demoteAbsoluteFlexStacks is moot by construction" invariant
 */

const assert = require('assert');
const { STRATEGY } = require('../responsive/constants');
const { declsForStrategy, buildResponsiveMediaCss } = require('../emit/render/responsive-media');
const { materializeHtml } = require('../emit/render/materialize-html');
const { modeDecls } = require('../emit/render/css-declarations');
const {
  isFullBleedLayer,
  detectArtboardLift,
  detectSectionHeaderCluster,
  orderChildrenVisualY,
  clampHeaderPadding,
} = require('../geometry/rules/structural-polish');
const { sectionShellDecls, polishDecls, polishFlexRowChildren } = require('../emit/render/polish');

let passed = 0;
let failed = 0;
function pass(name) { passed += 1; console.log(`PASS  ${name}`); }
function fail(name, err) { failed += 1; console.error(`FAIL  ${name} — ${err && err.message ? err.message : err}`); }
function test(name, fn) {
  try { fn(); pass(name); } catch (e) { fail(name, e); }
}

// ─── responsive-media.js — declsForStrategy, one per STRATEGY ─────────────

test('declsForStrategy — stack -> flex-direction:column + align-items:stretch', () => {
  assert.deepStrictEqual(declsForStrategy(STRATEGY.STACK), [
    ['flex-direction', 'column'],
    ['align-items', 'stretch'],
  ]);
});

test('declsForStrategy — row -> flex-direction:row', () => {
  assert.deepStrictEqual(declsForStrategy(STRATEGY.ROW), [['flex-direction', 'row']]);
});

test('declsForStrategy — wrap -> flex-wrap:wrap', () => {
  assert.deepStrictEqual(declsForStrategy(STRATEGY.WRAP), [['flex-wrap', 'wrap']]);
});

test('declsForStrategy — hide -> display:none', () => {
  assert.deepStrictEqual(declsForStrategy(STRATEGY.HIDE), [['display', 'none']]);
});

test('declsForStrategy — show -> display:block (contract completeness, no live producer yet)', () => {
  assert.deepStrictEqual(declsForStrategy(STRATEGY.SHOW), [['display', 'block']]);
});

test('declsForStrategy — space-tighten halves the node\'s own gap', () => {
  assert.deepStrictEqual(declsForStrategy(STRATEGY.SPACE_TIGHTEN, { gap: 24 }), [['gap', '12px']]);
  // No gap on the layoutChoice -> safe documented default, not a crash.
  assert.deepStrictEqual(declsForStrategy(STRATEGY.SPACE_TIGHTEN, {}), [['gap', '8px']]);
});

test('declsForStrategy — space-preserve re-asserts the existing gap explicitly', () => {
  assert.deepStrictEqual(declsForStrategy(STRATEGY.SPACE_PRESERVE, { gap: 16 }), [['gap', '16px']]);
  // No gap published -> nothing to re-assert (null, not invented).
  assert.strictEqual(declsForStrategy(STRATEGY.SPACE_PRESERVE, {}), null);
});

test('declsForStrategy — fixed -> position:fixed only (no left/top invented)', () => {
  assert.deepStrictEqual(declsForStrategy(STRATEGY.FIXED), [['position', 'fixed']]);
});

test('declsForStrategy — abstain -> null (never emits CSS)', () => {
  assert.strictEqual(declsForStrategy(STRATEGY.ABSTAIN), null);
});

// ─── buildResponsiveMediaCss ────────────────────────────────────────────────

test('buildResponsiveMediaCss — groups adaptations by breakpoint, skips abstain and wide-only', () => {
  const breakpoints = [
    { breakpointId: 'bp:narrow', kind: 'narrow', widthHint: 375 },
    { breakpointId: 'bp:medium', kind: 'medium', widthHint: 768 },
    { breakpointId: 'bp:wide', kind: 'wide', widthHint: 1280 },
  ];
  const adaptations = [
    { nodeId: 'n1', strategy: STRATEGY.STACK, atBreakpointIds: ['bp:narrow'] },
    { nodeId: 'n2', strategy: STRATEGY.HIDE, atBreakpointIds: ['bp:narrow', 'bp:medium'] },
    { nodeId: 'n3', strategy: STRATEGY.ROW, atBreakpointIds: ['bp:wide'] }, // skipped — wide-only
    { nodeId: 'n4', strategy: STRATEGY.ABSTAIN, atBreakpointIds: ['bp:narrow'] }, // skipped — abstain
  ];
  const classFor = (id) => ({ n1: 'card-1', n2: 'aside-2' }[id] || null);
  const css = buildResponsiveMediaCss(adaptations, breakpoints, classFor);

  assert.ok(css.includes('@media (max-width: 375px)'));
  assert.ok(css.includes('@media (max-width: 768px)'));
  assert.ok(!css.includes('1280px'), 'wide-only adaptation must not produce a media block');
  assert.ok(css.includes('.card-1'));
  assert.ok(css.includes('.aside-2'));
  assert.ok(css.includes('flex-direction: column;'));
  assert.ok(css.includes('display: none;'));
  // n2 fires at both narrow and medium — both blocks should mention it.
  const narrowBlock = css.slice(css.indexOf('375px'), css.indexOf('768px'));
  const mediumBlock = css.slice(css.indexOf('768px'));
  assert.ok(narrowBlock.includes('.aside-2'));
  assert.ok(mediumBlock.includes('.aside-2'));
});

test('buildResponsiveMediaCss — no adaptations with a resolvable class -> empty string', () => {
  const breakpoints = [{ breakpointId: 'bp:narrow', kind: 'narrow', widthHint: 375 }];
  const adaptations = [{ nodeId: 'n1', strategy: STRATEGY.STACK, atBreakpointIds: ['bp:narrow'] }];
  const css = buildResponsiveMediaCss(adaptations, breakpoints, () => null);
  assert.strictEqual(css, '');
});

// ─── End-to-end: a real ResponsiveIR Fact -> a real @media block ──────────

test('materializeHtml — a ResponsiveIR adaptation produces a real @media block through the renderer', () => {
  const renderTree = {
    nodeId: 'root',
    type: 'FRAME',
    name: 'Page',
    children: [
      {
        nodeId: 'row-1',
        type: 'FRAME',
        name: 'Info Row',
        layoutChoice: { mode: 'flow-row', gap: 24 },
        children: [
          { nodeId: 't1', type: 'TEXT', name: 'Label', characters: 'Hello', fontSize: 14 },
        ],
      },
    ],
  };
  const responsiveIr = {
    breakpoints: [
      { breakpointId: 'bp:narrow', kind: 'narrow', widthHint: 375 },
      { breakpointId: 'bp:medium', kind: 'medium', widthHint: 768 },
      { breakpointId: 'bp:wide', kind: 'wide', widthHint: 1280 },
    ],
    adaptations: [
      { nodeId: 'row-1', strategy: STRATEGY.STACK, atBreakpointIds: ['bp:narrow'] },
    ],
  };

  const { html, css } = materializeHtml(renderTree, { title: 'Test Page', responsiveIr });

  // The node gets its dedicated responsive class alongside its base class.
  assert.ok(/class="info-row rsp-[\w-]+"/.test(html), `expected dedicated rsp- class in html, got: ${html}`);
  assert.ok(css.includes('/* ===== Responsive (Phase 4) ===== */'));
  assert.ok(css.includes('@media (max-width: 375px)'));
  assert.ok(css.includes('flex-direction: column;'));
  assert.ok(css.includes('align-items: stretch;'));
});

test('materializeHtml — absent responsiveIr produces byte-identical output to Phase 3 (no regression)', () => {
  const renderTree = {
    nodeId: 'root',
    type: 'FRAME',
    name: 'Page',
    children: [
      { nodeId: 'row', type: 'FRAME', name: 'Row', layoutChoice: { mode: 'flow-row', gap: 8 }, children: [] },
    ],
  };
  const withNoOpt = materializeHtml(renderTree, { title: 'X' });
  const withUndefined = materializeHtml(renderTree, { title: 'X', responsiveIr: null });
  assert.strictEqual(withNoOpt.html, withUndefined.html);
  assert.strictEqual(withNoOpt.css, withUndefined.css);
  assert.ok(!withNoOpt.css.includes('Responsive (Phase 4)'));
});

// ─── structural-polish.js — heuristics needing NEW detection logic ────────

test('isFullBleedLayer — covers ~all of parent box (fluidBackgroundLayers port)', () => {
  const parent = { x: 0, y: 0, width: 1200, height: 800 };
  assert.strictEqual(isFullBleedLayer({ x: 2, y: 1, width: 1180, height: 700 }, parent), true);
  // Too small — not full-bleed.
  assert.strictEqual(isFullBleedLayer({ x: 2, y: 1, width: 400, height: 300 }, parent), false);
  // Offset too far from origin.
  assert.strictEqual(isFullBleedLayer({ x: 40, y: 1, width: 1180, height: 700 }, parent), false);
  assert.strictEqual(isFullBleedLayer(null, parent), false);
});

test('detectArtboardLift — computes padding from root-vs-content box offset (liftArtboardContent port)', () => {
  const root = { x: 0, y: 0, width: 1200, height: 900 };
  const main = { x: 40, y: 60, width: 1100, height: 700 };
  const pad = detectArtboardLift(root, main);
  assert.strictEqual(pad.top, 60);
  assert.strictEqual(pad.left, 40);
  assert.strictEqual(pad.right, 60); // 1200 - (40+1100)
  // bottom uses Math.max(40, ...): 900 - (60+700) = 140
  assert.strictEqual(pad.bottom, 140);
});

test('detectArtboardLift — bottom floors at 40px (legacy Math.max(40, ...))', () => {
  const root = { x: 0, y: 0, width: 1000, height: 780 };
  const main = { x: 0, y: 10, width: 1000, height: 760 }; // 780-(10+760)=10 < 40
  const pad = detectArtboardLift(root, main);
  assert.strictEqual(pad.bottom, 40);
});

test('detectSectionHeaderCluster — centered eyebrow+title+subtitle cluster recognized', () => {
  const parent = { x: 0, y: 0, width: 1200, height: 900 };
  const kids = [
    { box: { x: 500, y: 0, width: 200, height: 20 }, hasText: true, isAbsolute: true },
    { box: { x: 450, y: 30, width: 300, height: 60 }, hasText: true, isAbsolute: true },
  ];
  assert.strictEqual(detectSectionHeaderCluster(parent, kids), true);
});

test('detectSectionHeaderCluster — negative: wide x-span (card row, not a centered header)', () => {
  const parent = { x: 0, y: 0, width: 1200, height: 900 };
  const kids = [
    { box: { x: 0, y: 0, width: 200, height: 60 }, hasText: true, isAbsolute: true },
    { box: { x: 900, y: 0, width: 200, height: 60 }, hasText: true, isAbsolute: true },
    { box: { x: 1050, y: 0, width: 100, height: 60 }, hasText: true, isAbsolute: true },
  ];
  assert.strictEqual(detectSectionHeaderCluster(parent, kids), false);
});

test('detectSectionHeaderCluster — negative: fewer than 2 absolute-placed children', () => {
  const parent = { x: 0, y: 0, width: 1200, height: 900 };
  const kids = [
    { box: { x: 500, y: 0, width: 200, height: 20 }, hasText: true, isAbsolute: true },
    { box: { x: 450, y: 30, width: 300, height: 60 }, hasText: true, isAbsolute: false },
  ];
  assert.strictEqual(detectSectionHeaderCluster(parent, kids), false);
});

test('orderChildrenVisualY — header promoted to front, remainder sorted by (y, x)', () => {
  const children = [
    { id: 'body-2', box: { x: 0, y: 200, width: 100, height: 50 } },
    { id: 'header', box: { x: 0, y: 0, width: 100, height: 50 }, isHeader: true },
    { id: 'body-1', box: { x: 0, y: 100, width: 100, height: 50 } },
  ];
  assert.deepStrictEqual(orderChildrenVisualY(children), ['header', 'body-1', 'body-2']);
});

test('orderChildrenVisualY — no box data on <2 children -> passthrough by id, no crash', () => {
  assert.deepStrictEqual(orderChildrenVisualY([{ id: 'only' }]), ['only']);
});

test('clampHeaderPadding — clamps large artboard-lift top padding (normalizeInFlowHeaderPadding port)', () => {
  assert.strictEqual(clampHeaderPadding(200), 30); // min(48, round(200*0.15))
  assert.strictEqual(clampHeaderPadding(400), 48); // clamps at 48
  assert.strictEqual(clampHeaderPadding(40), null); // below 80 -> no clamp
  assert.strictEqual(clampHeaderPadding(NaN), null);
});

// ─── polish.js — heuristics needing only renderer wiring ───────────────────

test('sectionShellDecls — depth-0 section root gets relative/full-width flow decls (normalizeSectionShell port)', () => {
  const decls = sectionShellDecls({ width: 1200, height: 900 });
  const map = new Map(decls);
  assert.strictEqual(map.get('position'), 'relative');
  assert.strictEqual(map.get('width'), '100%');
  assert.strictEqual(map.get('max-width'), '100%');
  assert.strictEqual(map.get('min-height'), '900px'); // tall section keeps a soft min-height
});

test('sectionShellDecls — small box (<600 width) -> no shell decls', () => {
  assert.deepStrictEqual(sectionShellDecls({ width: 400, height: 300 }), []);
});

test('sectionShellDecls — short section (<600 height) -> no min-height', () => {
  const decls = sectionShellDecls({ width: 1200, height: 500 });
  const map = new Map(decls);
  assert.strictEqual(map.has('min-height'), false);
});

test('polishDecls — text node: fixed height removed, fixed width -> max-width (polishProductionLayout port)', () => {
  const decls = [['height', '48px'], ['width', '320px']];
  const out = polishDecls(decls, { isText: true });
  const map = new Map(out);
  assert.strictEqual(map.has('height'), false);
  assert.strictEqual(map.has('width'), false);
  assert.strictEqual(map.get('max-width'), '320px');
});

test('polishDecls — flex/card container: fixed non-auto height removed', () => {
  const decls = [['height', '480px'], ['display', 'flex']];
  const out = polishDecls(decls, { isFlex: true });
  const map = new Map(out);
  assert.strictEqual(map.has('height'), false);
});

test('polishDecls — full-bleed background is exempt from height stripping', () => {
  const decls = [['height', '480px'], ['display', 'flex']];
  const out = polishDecls(decls, { isFlex: true, isFullBleedBg: true });
  const map = new Map(out);
  assert.strictEqual(map.get('height'), '480px');
});

test('polishDecls — card-grid never keeps card padding', () => {
  const decls = [['padding-top', '24px']];
  const out = polishDecls(decls, { isCardGrid: true });
  assert.deepStrictEqual(out, []);
});

test('polishDecls — large fixed width (>=600px) converts to width:100%+max-width', () => {
  const decls = [['width', '960px']];
  const out = polishDecls(decls);
  const map = new Map(out);
  assert.strictEqual(map.get('width'), '100%');
  assert.strictEqual(map.get('max-width'), '960px');
});

test('polishDecls — decimal px values round to integers', () => {
  const decls = [['padding-top', '23.7px'], ['gap', '10.005px']];
  const out = polishDecls(decls);
  const map = new Map(out);
  assert.strictEqual(map.get('padding-top'), '24px');
  assert.strictEqual(map.get('gap'), '10px');
});

test('polishFlexRowChildren — row children never keep width:100% (converted to measured max-width)', () => {
  const childDecls = [[['width', '100%'], ['color', 'red']]];
  const out = polishFlexRowChildren(childDecls, [{ width: 342.4 }]);
  const map = new Map(out[0]);
  assert.strictEqual(map.has('width'), false);
  assert.strictEqual(map.get('max-width'), '342.4px');
  assert.strictEqual(map.get('color'), 'red');
});

// ─── position:absolute + display:flex/grid are orthogonal, not exclusive ──
// How a node arranges ITS OWN children (`mode`) and whether that node is
// itself positioned by ITS parent (finite left/top) are separate facts —
// see ir-experimental-renderer.js's buildRenderNode() and this file's
// isPositionedAbsolute() comment for the full rule (a node whose PARENT has
// no Figma Auto Layout was placed by raw x/y regardless of its own mode).
// A "flow-row"/"flow-column"/"grid-track" node with a finite left/top MUST
// carry both position:absolute and display:flex/grid together — this is
// the corrected replacement for the old "never both" invariant this test
// used to assert.

test('modeDecls() emits BOTH position:absolute and display:flex/grid together when a flow/grid-mode node also has a finite left/top', () => {
  const modes = ['flow-row', 'flow-column', 'grid-track'];
  for (const mode of modes) {
    const decls = modeDecls({ mode, gap: 8, left: 4, top: 4, columns: 2 });
    const map = new Map(decls);
    assert.strictEqual(map.get('position'), 'absolute', `mode ${mode} must still carry position:absolute`);
    assert.strictEqual(map.get('left'), '4px');
    assert.strictEqual(map.get('top'), '4px');
    const hasFlexOrGrid = map.get('display') === 'flex' || map.get('display') === 'grid';
    assert.ok(hasFlexOrGrid, `mode ${mode} must still carry its own display:flex/grid`);
  }
});

test('modeDecls() — a flow/grid-mode node with NO left/top (in-flow, positioned by parent flex/grid) gets no position:absolute', () => {
  const modes = ['flow-row', 'flow-column', 'grid-track'];
  for (const mode of modes) {
    const decls = modeDecls({ mode, gap: 8, columns: 2 });
    const map = new Map(decls);
    assert.strictEqual(map.has('position'), false, `mode ${mode} with no left/top must not get position:absolute`);
  }
});

process.exitCode = failed ? 1 : 0;
console.log(`\n${passed} passed, ${failed} failed`);
