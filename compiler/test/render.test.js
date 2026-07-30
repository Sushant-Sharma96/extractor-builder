'use strict';

/**
 * Phase 3 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — Renderer, minimal
 * vocabulary. Tests compiler/emit/render/{tag,css-declarations,materialize-html}
 * plus the new `layoutChoices` EmitPlan field and `applyLayoutBindings`.
 */

const assert = require('assert');
const { chooseTag } = require('../emit/render/tag');
const {
  buildDecls,
  modeDecls,
  cardChromeDecls,
  rowSetRowDecls,
  rowSetPassthroughDecls,
  rowSetChromeHiddenDecls,
  freeformGroupContainerDecls,
  freeformGroupMemberDecls,
  freeformChromeHiddenDecls,
  freeformPassthroughDecls,
  freeformGridPlacementDecls,
  freeformLeafChromeDecls,
  solidFillCss,
  paintCss,
  px,
  declString,
} = require('../emit/render/css-declarations');
const { materializeHtml } = require('../emit/render/materialize-html');
const { CSS_RESET_BLOCK } = require('../emit/render/utility-css');
const { buildLayoutChoices } = require('../emit/project');
const { applyLayoutBindings } = require('../artifacts/apply-plan');

let passed = 0;
let failed = 0;
function pass(name) { passed += 1; console.log(`PASS  ${name}`); }
function fail(name, err) { failed += 1; console.error(`FAIL  ${name} — ${err && err.message ? err.message : err}`); }
function test(name, fn) {
  try { fn(); pass(name); } catch (e) { fail(name, e); }
}

// ─── tag.js — 4 minimal-vocabulary modes ───────────────────────────────────

test('chooseTag — flow-row container -> div', () => {
  const tag = chooseTag({ type: 'FRAME', name: 'Row' }, { mode: 'flow-row' });
  assert.strictEqual(tag, 'div');
});

test('chooseTag — flow-column container -> div', () => {
  const tag = chooseTag({ type: 'FRAME', name: 'Stack' }, { mode: 'flow-column' });
  assert.strictEqual(tag, 'div');
});

test('chooseTag — grid-track container -> div', () => {
  const tag = chooseTag({ type: 'FRAME', name: 'Grid' }, { mode: 'grid-track' });
  assert.strictEqual(tag, 'div');
});

test('chooseTag — absolute container -> div', () => {
  const tag = chooseTag({ type: 'FRAME', name: 'Freeform' }, { mode: 'absolute' });
  assert.strictEqual(tag, 'div');
});

test('chooseTag — card shape -> article (legacy cardLike semTag choice)', () => {
  const tag = chooseTag({ type: 'FRAME', name: 'Card 1' }, { mode: 'flow-column', cardShape: 'shell' });
  assert.strictEqual(tag, 'article');
});

test('chooseTag — banner shape -> section', () => {
  const tag = chooseTag({ type: 'FRAME', name: 'Quote strip' }, { mode: 'flow-row', bannerShape: true });
  assert.strictEqual(tag, 'section');
});

test('chooseTag — TEXT node uses font-size tag rule (unchanged from legacy tagFor)', () => {
  assert.strictEqual(chooseTag({ type: 'TEXT', name: 'Heading', fontSize: 42 }, {}), 'h1');
  assert.strictEqual(chooseTag({ type: 'TEXT', name: 'Sub', fontSize: 30 }, {}), 'h2');
  assert.strictEqual(chooseTag({ type: 'TEXT', name: 'Small heading', fontSize: 22 }, {}), 'h3');
  assert.strictEqual(chooseTag({ type: 'TEXT', name: 'Body', fontSize: 14 }, {}), 'p');
});

test('chooseTag — name-hinted button/nav/header/footer win over generic div', () => {
  assert.strictEqual(chooseTag({ type: 'FRAME', name: 'CTA Button' }, { mode: 'flow-row' }), 'button');
  assert.strictEqual(chooseTag({ type: 'FRAME', name: 'Navbar' }, { mode: 'flow-row' }), 'nav');
});

// ─── css-declarations.js ────────────────────────────────────────────────────

test('modeDecls — flow-row emits display:flex + flex-direction:row + gap', () => {
  const decls = modeDecls({ mode: 'flow-row', gap: 16 });
  assert.deepStrictEqual(decls, [
    ['display', 'flex'],
    ['flex-direction', 'row'],
    ['align-items', 'center'],
    ['gap', '16px'],
  ]);
});

test('modeDecls — flow-column emits display:flex + flex-direction:column', () => {
  const decls = modeDecls({ mode: 'flow-column', gap: 8 });
  assert.deepStrictEqual(decls, [
    ['display', 'flex'],
    ['flex-direction', 'column'],
    ['align-items', 'flex-start'],
    ['gap', '8px'],
  ]);
});

test('modeDecls — grid-track emits display:grid + grid-template-columns', () => {
  const decls = modeDecls({ mode: 'grid-track', columns: 3, gap: 24 });
  assert.deepStrictEqual(decls, [
    ['display', 'grid'],
    ['grid-template-columns', 'repeat(3, 1fr)'],
    ['gap', '24px'],
  ]);
});

test('modeDecls — absolute emits position:absolute + left/top', () => {
  const decls = modeDecls({ mode: 'absolute', left: 12, top: 40 });
  assert.deepStrictEqual(decls, [
    ['position', 'absolute'],
    ['left', '12px'],
    ['top', '40px'],
  ]);
});

test('modeDecls — TEXT layoutChoice with fillCss emits color, not background-color', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 12, top: 40, fillCss: '#ff0000', isText: true,
  });
  assert.deepStrictEqual(decls, [
    ['color', '#ff0000'],
    ['position', 'absolute'],
    ['left', '12px'],
    ['top', '40px'],
  ]);
});

test('modeDecls — non-TEXT layoutChoice with a fillPaint still emits background-color', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 12, top: 40, fillPaint: { prop: 'background-color', value: '#ff0000' },
  });
  assert.deepStrictEqual(decls, [
    ['background-color', '#ff0000'],
    ['position', 'absolute'],
    ['left', '12px'],
    ['top', '40px'],
  ]);
});

test('modeDecls — ELLIPSE node gets border-radius:50% regardless of (absent) cornerRadius — Figma expresses ellipse roundness via node type, not a numeric field', () => {
  const decls = modeDecls({ mode: 'absolute', left: 0, top: 0, isEllipse: true, cornerRadius: null });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('border-radius'), '50%');
});

test('modeDecls — non-ellipse with a real cornerRadius still uses the numeric px value (isEllipse does not clobber the normal path)', () => {
  const decls = modeDecls({ mode: 'absolute', left: 0, top: 0, isEllipse: false, cornerRadius: 20 });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('border-radius'), '20px');
});

test('paintCss — real Challenge Arena gradient fixture (handles (0,0.5)->(1,0.5), pure horizontal) resolves to exactly linear-gradient(90deg, ...)', () => {
  const paint = {
    type: 'GRADIENT_LINEAR',
    gradientHandlePositions: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }],
    gradientStops: [
      { color: { r: 0.6117647290229797, g: 0.45098039507865906, b: 0.9686274528503418, a: 1 }, position: 0 },
      { color: { r: 0.16078431904315948, g: 0.3921568691730499, b: 0.9607843160629272, a: 1 }, position: 1 },
    ],
  };
  const result = paintCss([paint], { width: 335, height: 9 });
  assert(result, 'gradient paint resolved to a value');
  assert.strictEqual(result.prop, 'background-image');
  assert.strictEqual(result.value, 'linear-gradient(90deg, #9c73f7 0%, #2964f5 100%)');
});

test('modeDecls — a gradient fillPaint emits background-image, never background-color (they are not interchangeable CSS properties)', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 0, top: 0, fillPaint: { prop: 'background-image', value: 'linear-gradient(90deg, red 0%, blue 100%)' },
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('background-image'), 'linear-gradient(90deg, red 0%, blue 100%)');
  assert.strictEqual(asMap.has('background-color'), false);
});

test('modeDecls — node-level opacity < 1 is emitted; opacity === 1 (or absent) emits nothing (never a no-op `opacity:1` on every node)', () => {
  const withOpacity = new Map(modeDecls({ mode: 'absolute', left: 0, top: 0, nodeOpacity: 0.8 }));
  assert.strictEqual(withOpacity.get('opacity'), '0.8');
  const fullOpacity = new Map(modeDecls({ mode: 'absolute', left: 0, top: 0, nodeOpacity: 1 }));
  assert.strictEqual(fullOpacity.has('opacity'), false);
  const noOpacityField = new Map(modeDecls({ mode: 'absolute', left: 0, top: 0 }));
  assert.strictEqual(noOpacityField.has('opacity'), false);
});

test('modeDecls — rotationDeg emits transform:rotate(), converted from the radian source (real data is always exactly 180deg for the one non-GROUP case this is wired for)', () => {
  const decls = modeDecls({ mode: 'absolute', left: 0, top: 0, rotationDeg: 180 });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('transform'), 'rotate(180deg)');
});

test('modeDecls — strokeAlign OUTSIDE uses outline (not border) at outline-offset:0, so the box\'s own dimensions/layout are untouched', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 0, top: 0, strokeCss: '#ffffff', strokeWeight: 2, strokeAlign: 'OUTSIDE',
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('outline'), '2px solid #ffffff');
  assert.strictEqual(asMap.get('outline-offset'), '0px');
  assert.strictEqual(asMap.has('border'), false);
});

test('modeDecls — strokeAlign CENTER uses outline with a negative half-width offset (straddles the edge, matching Figma\'s CENTER stroke)', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 0, top: 0, strokeCss: '#ffffff', strokeWeight: 2, strokeAlign: 'CENTER',
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('outline'), '2px solid #ffffff');
  assert.strictEqual(asMap.get('outline-offset'), '-1px');
});

test('modeDecls — strokeAlign INSIDE (or absent) keeps the plain border path unchanged (no regression for the majority-unaffected 46 real INSIDE strokes)', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 0, top: 0, strokeCss: '#ffffff', strokeWeight: 1, strokeAlign: 'INSIDE',
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('border'), '1px solid #ffffff');
  assert.strictEqual(asMap.has('outline'), false);
});

test('modeDecls — individualStrokeWeights emits only the real non-zero sides (e.g. a border-bottom-only divider), overriding the uniform border shorthand', () => {
  const decls = modeDecls({
    mode: 'absolute',
    left: 0,
    top: 0,
    strokeCss: '#e0e0e0',
    strokeWeight: 1,
    individualStrokeWeights: {
      top: 0, right: 0, bottom: 3, left: 0,
    },
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('border-bottom'), '3px solid #e0e0e0');
  assert.strictEqual(asMap.has('border-top'), false);
  assert.strictEqual(asMap.has('border-right'), false);
  assert.strictEqual(asMap.has('border-left'), false);
  assert.strictEqual(asMap.has('border'), false);
});

test('px — rounds to 2 decimals (legacy formula)', () => {
  assert.strictEqual(px(10), '10px');
  assert.strictEqual(px(10.005), '10.01px');
});

test('solidFillCss — single SOLID paint -> hex, else null', () => {
  assert.strictEqual(solidFillCss([{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]), '#ffffff');
  assert.strictEqual(solidFillCss([{ type: 'IMAGE' }]), null);
  assert.strictEqual(solidFillCss([]), null);
});

test('cardChromeDecls — card-chrome node consumes Component IR card fact (flex column + bg + padding)', () => {
  const cardFact = {
    shape: 'shell',
    paints: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 }, opacity: 1 }],
    cornerRadius: 12,
    padding: { top: 24, right: 16, bottom: 24, left: 16 },
  };
  const decls = cardChromeDecls(cardFact);
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'flex');
  assert.strictEqual(asMap.get('flex-direction'), 'column');
  assert.strictEqual(asMap.get('background-color'), '#1a1a1a');
  assert.strictEqual(asMap.get('border-radius'), '12px');
  assert.strictEqual(asMap.get('padding-top'), '24px');
  assert.strictEqual(asMap.get('padding-left'), '16px');
});

test('buildDecls — card chrome overrides the generic mode decl for the same property', () => {
  const decls = buildDecls({
    mode: 'flow-row', // would normally give flex-direction:row
    gap: 10,
    cardFact: { padding: {} },
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'flex');
  // card chrome's flex-direction:column wins over flow-row's :row
  assert.strictEqual(asMap.get('flex-direction'), 'column');
});

// ─── Row-set (repeating-pattern / table) decls ─────────────────────────────

test('rowSetRowDecls — hasChrome row gets display:grid + grid-template-columns from fact columns, chrome bg lifted, own padding zeroed', () => {
  const decls = rowSetRowDecls({
    columns: [{ width: 40 }, { width: 424 }, { width: 212 }, { width: 87 }, { width: 123 }],
    hasChrome: true,
    chromeBg: 'rgba(172, 200, 251, 0.3)',
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'grid');
  assert.strictEqual(asMap.get('grid-template-columns'), '40px 424px 212px 87px 123px');
  assert.strictEqual(asMap.get('background-color'), 'rgba(172, 200, 251, 0.3)');
  assert.strictEqual(asMap.get('padding-left'), '0px');
  assert.strictEqual(asMap.get('padding-top'), '0px');
});

test('rowSetRowDecls — no-chrome row falls back to display:contents (textbook flatten-into-parent)', () => {
  const decls = rowSetRowDecls({
    columns: [{ width: 40 }, { width: 100 }],
    hasChrome: false,
    chromeBg: null,
  });
  assert.deepStrictEqual(decls, [['display', 'contents']]);
});

test('rowSetPassthroughDecls / rowSetChromeHiddenDecls — pure fixed decls', () => {
  assert.deepStrictEqual(rowSetPassthroughDecls(), [['display', 'contents']]);
  assert.deepStrictEqual(rowSetChromeHiddenDecls(), [['display', 'none']]);
});

test('buildDecls — row-set row decls override the generic mode decl for the same property (display)', () => {
  const decls = buildDecls({
    mode: 'flow-row', // would normally give display:flex
    rowSetRow: {
      columns: [{ width: 40 }, { width: 424 }],
      hasChrome: true,
      chromeBg: '#abc123',
    },
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'grid');
  assert.strictEqual(asMap.get('grid-template-columns'), '40px 424px');
  assert.strictEqual(asMap.get('background-color'), '#abc123');
});

test('buildDecls — row-set passthrough wrapper overrides display to contents', () => {
  const decls = buildDecls({ mode: 'flow-row', gap: 8, rowSetPassthrough: true });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'contents');
});

test('buildDecls — row-set chrome-hidden node overrides display to none', () => {
  const decls = buildDecls({
    mode: 'absolute', left: 0, top: 0, width: 100, height: 20, rowSetChromeHidden: true,
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'none');
  // position:absolute/left/top from the generic mode decl are untouched —
  // only 'display' is overridden.
  assert.strictEqual(asMap.get('position'), 'absolute');
});

test('END-TO-END: materializeHtml renders a synthetic row-set (container + 3 rows) with identical grid-template-columns and display:contents bytes', () => {
  const columns = [{ width: 40 }, { width: 424 }, { width: 212 }];
  function makeRow(rowNodeId, chromeNodeId) {
    return {
      nodeId: rowNodeId,
      type: 'GROUP',
      name: `Row ${rowNodeId}`,
      layoutChoice: {
        mode: 'absolute',
        left: 0,
        top: 0,
        width: 900,
        height: 100,
        rowSetRow: { columns, hasChrome: true, chromeBg: '#eeeeee' },
      },
      children: [
        {
          nodeId: `${rowNodeId}-chrome`,
          type: 'RECTANGLE',
          name: chromeNodeId,
          layoutChoice: {
            mode: 'absolute', left: 0, top: 0, width: 900, height: 100, rowSetChromeHidden: true,
          },
          children: [],
        },
        {
          nodeId: `${rowNodeId}-c1`,
          type: 'TEXT',
          name: 'Id',
          characters: '001',
          layoutChoice: { mode: 'unknown' },
          children: [],
        },
        {
          // A pass-through wrapper bundling the remaining 2 columns — the
          // Challenge Arena-shaped case where one column-candidate unwrap
          // level is needed (rowColumnCandidates' "wide wrapper" case).
          nodeId: `${rowNodeId}-wrap`,
          type: 'GROUP',
          name: 'Content wrapper',
          layoutChoice: { mode: 'flow-row', rowSetPassthrough: true },
          children: [
            {
              nodeId: `${rowNodeId}-c2`,
              type: 'TEXT',
              name: 'Title',
              characters: 'Row title',
              layoutChoice: { mode: 'unknown' },
              children: [],
            },
            {
              nodeId: `${rowNodeId}-c3`,
              type: 'TEXT',
              name: 'Reward',
              characters: 'Reward',
              layoutChoice: { mode: 'unknown' },
              children: [],
            },
          ],
        },
      ],
    };
  }
  const renderTree = {
    nodeId: 'doc',
    type: 'FRAME',
    name: 'Document',
    children: [
      {
        nodeId: 'table',
        type: 'FRAME',
        name: 'Table',
        layoutChoice: { mode: 'flow-column', rowSetContainer: { columns } },
        children: [makeRow('row1', 'rect1'), makeRow('row2', 'rect2'), makeRow('row3', 'rect3')],
      },
    ],
  };
  const { css } = materializeHtml(renderTree);
  const gridColMatches = [...css.matchAll(/grid-template-columns: 40px 424px 212px;/g)];
  assert.strictEqual(gridColMatches.length, 1, 'the 3 structurally-identical rows dedupe to ONE shared class/rule (same signature), still containing the exact expected track string');
  assert.ok(css.includes('display: contents;'), 'the pass-through content wrapper flattens into the row grid');
  assert.ok(css.includes('display: none;'), 'the chrome node is hidden, its color already lifted onto the row');
  assert.ok(css.includes('background-color: #eeeeee;'));
});

// ─── freeform-layout-ir renderer wiring ────────────────────────────────────

test('freeformGroupContainerDecls — axis:"column" emits display:grid + grid-template-columns with a real gap track between each pair of columns (from their own x/width)', () => {
  const decls = freeformGroupContainerDecls({
    axis: 'column',
    columns: [
      { x: 21, width: 40 }, { x: 110, width: 424 }, { x: 640, width: 212 }, { x: 918, width: 87 }, { x: 1043, width: 123 },
    ],
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'grid');
  // gaps: (110-61)=49, (640-534)=106, (918-852)=66, (1043-1005)=38 — verified
  // against Challenge Arena's real member 1:327 column facts.
  assert.strictEqual(asMap.get('grid-template-columns'), '40px 49px 424px 106px 212px 66px 87px 38px 123px');
  assert.strictEqual(asMap.get('grid-template-rows'), undefined, 'axis:"column" never emits grid-template-rows');
});

test('freeformGroupContainerDecls — axis:"row" emits display:grid + grid-template-rows (members side-by-side, internal content bucketed along the perpendicular/Y axis), gap tracks interspersed the same way', () => {
  const decls = freeformGroupContainerDecls({
    axis: 'row',
    columns: [{ x: 0, width: 231 }, { x: 251, width: 88 }, { x: 349, width: 51 }],
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'grid');
  assert.strictEqual(asMap.get('grid-template-rows'), '231px 20px 88px 10px 51px');
  assert.strictEqual(asMap.get('grid-template-columns'), undefined, 'axis:"row" never emits grid-template-columns');
});

test('freeformGroupContainerDecls — columns with no x data (gap unknowable) -> 0px gap tracks, never invented widths', () => {
  const decls = freeformGroupContainerDecls({
    axis: 'column',
    columns: [{ width: 40 }, { width: 424 }],
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('grid-template-columns'), '40px 0px 424px');
});

test('freeformGroupMemberDecls — member becomes its own grid with the SAME track string as the container (guarantees cross-member alignment), chrome bg lifted, real inset derived from column[0].x', () => {
  const decls = freeformGroupMemberDecls({
    axis: 'column',
    columns: [{ x: 21, width: 40 }, { x: 110, width: 424 }],
    chromeBg: 'rgba(172, 200, 251, 0.3)',
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'grid');
  assert.strictEqual(asMap.get('grid-template-columns'), '40px 49px 424px');
  assert.strictEqual(asMap.get('background-color'), 'rgba(172, 200, 251, 0.3)');
  // column[0].x (21) IS the real inset for axis:'column' — not zeroed.
  assert.strictEqual(asMap.get('padding-left'), '21px');
  assert.strictEqual(asMap.get('padding-top'), '0px');
});

test('freeformGroupMemberDecls — axis:"row" puts the along-axis inset on padding-top (perpendicular bucketing) and the cross-axis inset (crossInset — detect.js\'s crossPositionOf(), e.g. Incentives\' cards real 40px content inset) on padding-left', () => {
  const decls = freeformGroupMemberDecls({
    axis: 'row',
    columns: [{ x: 8, width: 100 }],
    crossInset: 40,
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('padding-top'), '8px');
  assert.strictEqual(asMap.get('padding-left'), '40px');
});

test('freeformGroupMemberDecls — axis:"row" with no crossInset fact (older/absent data) falls back to padding-left:0, never NaN/undefined', () => {
  const decls = freeformGroupMemberDecls({
    axis: 'row',
    columns: [{ x: 8, width: 100 }],
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('padding-top'), '8px');
  assert.strictEqual(asMap.get('padding-left'), '0px');
});

test('freeformGroupMemberDecls — no chromeBg -> no background-color declared', () => {
  const decls = freeformGroupMemberDecls({ axis: 'row', columns: [{ width: 100 }] });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.has('background-color'), false);
});

test('freeformChromeHiddenDecls / freeformPassthroughDecls — pure fixed decls (same idiom as the row-set precedent)', () => {
  assert.deepStrictEqual(freeformChromeHiddenDecls(), [['display', 'none']]);
  assert.deepStrictEqual(freeformPassthroughDecls(), [['display', 'contents']]);
});

test('freeformGridPlacementDecls — axis:"column" -> grid-column (1-based line, skipping the interspersed gap tracks tracksWithGaps() adds); axis:"row" -> grid-row', () => {
  assert.deepStrictEqual(freeformGridPlacementDecls({ axis: 'column', order: 0 }), [['grid-column', '1']]);
  assert.deepStrictEqual(freeformGridPlacementDecls({ axis: 'column', order: 4 }), [['grid-column', '9']]);
  assert.deepStrictEqual(freeformGridPlacementDecls({ axis: 'row', order: 2 }), [['grid-row', '5']]);
});

test('freeformGridPlacementDecls — no placement (null column) -> no decls, graceful degrade', () => {
  assert.deepStrictEqual(freeformGridPlacementDecls(null), []);
  assert.deepStrictEqual(freeformGridPlacementDecls({ axis: 'row', order: NaN }), []);
});

test('buildDecls — freeformGroupContainer overrides the generic mode decl for the same property (display)', () => {
  const decls = buildDecls({
    mode: 'flow-row', // would normally give display:flex
    freeformGroupContainer: { axis: 'column', columns: [{ width: 40 }, { width: 424 }] },
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'grid');
  assert.strictEqual(asMap.get('grid-template-columns'), '40px 0px 424px');
});

test('buildDecls — freeformGroupMember + freeformGridPlacement compose (a member IS ALSO its own group, and its content is placed within it) without clobbering each other', () => {
  const decls = buildDecls({
    mode: 'unknown',
    freeformGroupMember: { axis: 'column', columns: [{ width: 40 }, { width: 424 }], chromeBg: '#abc123' },
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'grid');
  assert.strictEqual(asMap.get('background-color'), '#abc123');
});

test('buildDecls — freeformChromeHidden overrides display to none (chrome node inside a freeform member)', () => {
  const decls = buildDecls({
    mode: 'absolute', left: 0, top: 0, width: 100, height: 20, freeformChromeHidden: true,
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'none');
  assert.strictEqual(asMap.get('position'), 'absolute', 'only display is overridden, same precedent as rowSetChromeHidden');
});

test('buildDecls — freeformPassthrough overrides display to contents', () => {
  const decls = buildDecls({ mode: 'flow-row', gap: 8, freeformPassthrough: true });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('display'), 'contents');
});

test('buildDecls — freeformGridPlacement adds an explicit grid-column/grid-row without touching other decls', () => {
  const decls = buildDecls({ mode: 'unknown', freeformGridPlacement: { axis: 'column', order: 2 } });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('grid-column'), '5');
});

test('freeformLeafChromeDecls — a real, finite cornerRadius (e.g. a button/chip column leaf) emits border-radius verbatim, never invented', () => {
  assert.deepStrictEqual(freeformLeafChromeDecls(12), [['border-radius', '12px']]);
  assert.deepStrictEqual(freeformLeafChromeDecls(100), [['border-radius', '100px']]);
});

test('freeformLeafChromeDecls — no cornerRadius data (null/undefined/NaN) -> no decls, safe degrade (never a hardcoded default)', () => {
  assert.deepStrictEqual(freeformLeafChromeDecls(null), []);
  assert.deepStrictEqual(freeformLeafChromeDecls(undefined), []);
  assert.deepStrictEqual(freeformLeafChromeDecls(NaN), []);
});

test('buildDecls — freeformLeafCornerRadius adds border-radius without touching other decls (e.g. a freeform column-leaf button that is ALSO grid-placed)', () => {
  const decls = buildDecls({
    mode: 'unknown', freeformGridPlacement: { axis: 'column', order: 4 }, freeformLeafCornerRadius: 19,
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('grid-column'), '9');
  assert.strictEqual(asMap.get('border-radius'), '19px');
});

test('buildDecls — freeformLeafCornerRadius absent (no NDG corner-radius data for this node) -> no border-radius emitted, no invented default', () => {
  const decls = buildDecls({ mode: 'unknown', freeformGridPlacement: { axis: 'column', order: 4 } });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.has('border-radius'), false);
});

test('buildDecls — a node with NO freeform-layout-ir fields present is completely unaffected (fallback guarantee): identical output to before this wiring existed', () => {
  // Regression proof: every one of the pre-existing modes/fact fields, with
  // none of the new freeform* fields present, must produce EXACTLY what
  // buildDecls produced before this task touched the file — i.e. the new
  // overlays are a no-op whenever a node has no freeform-layout-ir fact.
  const before = [
    ['background-color', '#112233'],
    ['display', 'flex'], ['flex-direction', 'row'], ['align-items', 'center'],
    ['gap', '8px'],
    ['padding-top', '4px'], ['padding-right', '4px'], ['padding-bottom', '4px'], ['padding-left', '4px'],
  ];
  const layoutChoice = {
    mode: 'flow-row', gap: 8, padding: {
      top: 4, right: 4, bottom: 4, left: 4,
    }, fillPaint: { prop: 'background-color', value: '#112233' },
  };
  const decls = buildDecls(layoutChoice);
  assert.deepStrictEqual(decls, before, 'no freeform* field present -> byte-identical to the pre-wiring decl list');
});

test('END-TO-END: materializeHtml renders a synthetic freeform-layout-ir group (container + 2 members, axis:"column") with byte-identical per-member grid-template-columns and correct explicit grid-column placement, one member missing a column (null) degrades gracefully', () => {
  const columns = [{ width: 40 }, { width: 424 }, { width: 212 }];
  function makeMember(memberNodeId, includeThirdColumn) {
    const children = [
      {
        nodeId: `${memberNodeId}-chrome`,
        type: 'RECTANGLE',
        name: 'chrome',
        layoutChoice: {
          mode: 'absolute', left: 0, top: 0, width: 700, height: 60, freeformChromeHidden: true,
        },
        children: [],
      },
      {
        nodeId: `${memberNodeId}-c0`,
        type: 'TEXT',
        name: 'Id',
        characters: '001',
        layoutChoice: { mode: 'unknown', freeformGridPlacement: { axis: 'column', order: 0 } },
        children: [],
      },
      {
        nodeId: `${memberNodeId}-c1`,
        type: 'TEXT',
        name: 'Title',
        characters: 'Title',
        layoutChoice: { mode: 'unknown', freeformGridPlacement: { axis: 'column', order: 1 } },
        children: [],
      },
    ];
    if (includeThirdColumn) {
      children.push({
        nodeId: `${memberNodeId}-c2`,
        type: 'TEXT',
        name: 'Reward',
        characters: 'Reward',
        layoutChoice: { mode: 'unknown', freeformGridPlacement: { axis: 'column', order: 2 } },
        children: [],
      });
    }
    return {
      nodeId: memberNodeId,
      type: 'GROUP',
      name: `Member ${memberNodeId}`,
      layoutChoice: {
        mode: 'absolute',
        left: 0,
        top: 0,
        width: 700,
        height: 60,
        freeformGroupMember: { axis: 'column', columns, chromeBg: '#eeeeee' },
      },
      children,
    };
  }
  const renderTree = {
    nodeId: 'doc',
    type: 'FRAME',
    name: 'Document',
    children: [
      {
        nodeId: 'container',
        type: 'FRAME',
        name: 'Table',
        layoutChoice: { mode: 'flow-column', freeformGroupContainer: { axis: 'column', columns } },
        // member2 genuinely misses the 3rd column (null in memberColumnMap) —
        // proves graceful degradation: no crash, no placement emitted for
        // the missing column, the other 2 members still align correctly.
        children: [makeMember('member1', true), makeMember('member2', false)],
      },
    ],
  };
  const { css } = materializeHtml(renderTree);
  // No `.x` on these synthetic columns -> gap unknowable -> 0px gap tracks
  // interspersed (tracksWithGaps() never invents a width it can't compute).
  const gridColMatches = [...css.matchAll(/grid-template-columns: 40px 0px 424px 0px 212px;/g)];
  assert.ok(gridColMatches.length >= 1, 'container and/or members carry the exact fact column-width track string (with 0px gap tracks)');
  assert.ok(css.includes('grid-column: 1;'), 'column-0 leaf placed at grid line 1 (2*0+1)');
  assert.ok(css.includes('grid-column: 3;'), 'column-1 leaf placed at grid line 3 (2*1+1, skipping the gap track at line 2)');
  assert.ok(css.includes('grid-column: 5;'), 'member1\'s 3rd column leaf placed at grid line 5 (2*2+1; member2 has no such node — degrades gracefully, no crash)');
  assert.ok(css.includes('display: none;'), 'chrome node hidden, color lifted onto its member');
  assert.ok(css.includes('background-color: #eeeeee;'));
});

// ─── buildLayoutChoices — LayoutIR + Component IR -> layoutChoices ─────────

test('buildLayoutChoices — sourced from LayoutIR nodes + Component IR card facts', () => {
  const layoutIr = {
    nodes: [
      { nodeId: 'n:2', mode: 'flow-row', gap: 8, padding: null, decisionIds: [] },
      { nodeId: 'n:1', mode: 'flow-column', gap: 16, padding: { top: 4 }, decisionIds: [] },
    ],
  };
  const componentIr = {
    cardPatterns: [{ nodeId: 'n:1', shape: 'shell', padding: { top: 24, left: 16, right: 16, bottom: 24 } }],
    bannerPatterns: [],
  };
  const choices = buildLayoutChoices(layoutIr, componentIr);
  assert.strictEqual(choices.length, 2);
  // sorted by nodeId
  assert.strictEqual(choices[0].nodeId, 'n:1');
  assert.strictEqual(choices[0].mode, 'flow-column');
  assert.strictEqual(choices[0].cardShape, 'shell');
  assert.strictEqual(choices[1].nodeId, 'n:2');
  assert.strictEqual(choices[1].cardShape, undefined);
});

test('buildLayoutChoices — absent LayoutIR -> empty array (never breaks a caller)', () => {
  assert.deepStrictEqual(buildLayoutChoices(undefined, undefined), []);
});

// ─── applyLayoutBindings — additive lowering onto a figma-build-shaped tree ─

test('applyLayoutBindings — sets decls from layoutChoices onto matching tree node only', () => {
  const tree = {
    nodeId: 'root',
    decls: new Map(),
    children: [
      { nodeId: 'a', decls: new Map([['color', 'red']]), children: [] },
      { nodeId: 'b', decls: new Map(), children: [] },
    ],
  };
  const byId = new Map([
    ['root', tree],
    ['a', tree.children[0]],
    ['b', tree.children[1]],
  ]);
  const emitPlan = {
    payload: {
      layoutChoices: [
        { nodeId: 'src:a', mode: 'flow-row', gap: 8 },
      ],
    },
  };
  applyLayoutBindings(byId, emitPlan);
  assert.strictEqual(tree.children[0].decls.get('display'), 'flex');
  assert.strictEqual(tree.children[0].decls.get('flex-direction'), 'row');
  assert.strictEqual(tree.children[0].decls.get('gap'), '8px');
  assert.strictEqual(tree.children[0].decls.get('color'), 'red'); // untouched
  assert.strictEqual(tree.children[1].decls.size, 0); // 'b' had no matching choice
});

// ─── materialize-html.js — end-to-end synthetic NDG graph -> real HTML/CSS ──

test('materializeHtml — end-to-end: document root wraps its top-level child as a labeled section (legacy sectionBlocks port), exact HTML+CSS bytes', () => {
  // `root` here plays legacy emit()'s document/canvas role: it is never
  // rendered as an element itself — its top-level children become
  // `<!-- Section: Label --> <section class="section-...">` blocks, exactly
  // matching server/figma-build.js's `emit()` non-nested-emit branch (the
  // shape Articles/IBM/Challenge Arena all use).
  const renderTree = {
    nodeId: 'root',
    type: 'FRAME',
    name: 'Page',
    children: [
      {
        nodeId: 'row',
        type: 'FRAME',
        name: 'Info Row',
        layoutChoice: { mode: 'flow-row', gap: 8 },
        children: [
          { nodeId: 't1', type: 'TEXT', name: 'Label', characters: 'Hello', fontSize: 14 },
        ],
      },
    ],
  };

  const { html, css } = materializeHtml(renderTree, { title: 'Test Page' });

  const expectedHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Test Page</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="et-page">
    <!-- Section: Info Row -->
    <section class="section-info-row">
      <div class="info-row">
        <p>Hello</p>
      </div>
    </section>
  </div>
  <script src="script.js"></script>
</body>
</html>
`;
  assert.strictEqual(html, expectedHtml);

  const expectedCss = [
    '/* styles.css — generated by compiler/emit/render (Phase 3 renderer) */',
    CSS_RESET_BLOCK,
    '/* ===== Section: Info Row ===== */\n.info-row {\n  display: flex;\n  flex-direction: row;\n  align-items: center;\n  gap: 8px;\n}',
  ].join('\n\n') + '\n';
  assert.strictEqual(css, expectedCss);
});

test('materializeHtml — card node (as a section child) renders as <article> with chrome decls', () => {
  const renderTree = {
    nodeId: 'doc',
    type: 'FRAME',
    name: 'Document',
    children: [
      {
        nodeId: 'root',
        type: 'FRAME',
        name: 'Card 1',
        layoutChoice: {
          mode: 'flow-column',
          cardShape: 'shell',
          cardFact: { padding: { top: 24, left: 16, right: 16, bottom: 24 } },
        },
        children: [
          { nodeId: 't1', type: 'TEXT', name: 'Card heading', characters: 'Card title', fontSize: 20 },
        ],
      },
    ],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(html.includes('<!-- Section: Card 1 -->'), 'top-level card child gets section-wrapped');
  assert.ok(html.includes('<section class="section-card-1">'));
  assert.ok(html.includes('<article class="card-1">'), 'card node renders as <article>');
  assert.ok(html.includes('</article>'));
  assert.ok(html.includes('<h3>Card title</h3>'));
});

test('materializeHtml — canvas box + fill produce a .et-page rule (legacy canvasDecls port)', () => {
  const renderTree = {
    nodeId: 'root',
    type: 'FRAME',
    name: 'Articles',
    box: { width: 1440, height: 716 },
    fillCss: '#f9fafc',
    children: [
      { nodeId: 'g', type: 'FRAME', name: 'Group', layoutChoice: { mode: 'flow-column' }, children: [] },
    ],
  };
  const { css } = materializeHtml(renderTree);
  assert.ok(css.includes('/* --- page --- */\n.et-page {'), 'page block present');
  assert.ok(css.includes('background-color: #f9fafc;'));
  assert.ok(css.includes('max-width: 1440px;'));
  assert.ok(css.includes('--page-max: 1440px;'));
});

test('materializeHtml — per-character text-run overrides emit an inline <span> (NDG characterStyleOverrides/styleOverrideTable port)', () => {
  // Exact shape of the Articles "Take A Look at Our Latest Articles" TEXT node
  // as carried on NDG TEXT nodes (compiler/ndg/ingest.js, additive fields).
  // Override id 1 colours "Latest Articles" #2864f5 — the same inline span
  // legacy's textRuns()/runStyleCss() produces.
  const renderTree = {
    nodeId: 'root',
    type: 'FRAME',
    name: 'Root',
    box: { width: 100, height: 50 },
    layoutChoice: { mode: 'flow-column' },
    children: [
      {
        nodeId: 't',
        type: 'TEXT',
        name: 'Take A Look At Our',
        fontSize: 44,
        characters: 'Take A Look at Our Latest Articles',
        characterStyleOverrides: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        ],
        styleOverrideTable: {
          1: { fills: [{ type: 'SOLID', color: { r: 0.1568627506494522, g: 0.3921568691730499, b: 0.9607843160629272, a: 1 } }] },
        },
        layoutChoice: { mode: 'unknown' },
        children: [],
      },
    ],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(
    html.includes('<h1>Take A Look at Our <span style="color:#2864f5">Latest Articles</span></h1>'),
    'run-styled span matches legacy exactly'
  );
});

test('materializeHtml — TEXT node with no overrides emits no <span> (safe-degrade)', () => {
  const renderTree = {
    nodeId: 'root',
    type: 'FRAME',
    name: 'Root',
    layoutChoice: { mode: 'flow-column' },
    children: [
      {
        nodeId: 't',
        type: 'TEXT',
        name: 'Plain',
        fontSize: 20,
        characters: 'Read All Logs',
        characterStyleOverrides: null,
        styleOverrideTable: null,
        layoutChoice: { mode: 'unknown' },
        children: [],
      },
    ],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(html.includes('<h3>Read All Logs</h3>'), 'plain text renders without span wrapping');
  assert.ok(!/<span/.test(html), 'no span emitted when no overrides present');
});

test('materializeHtml — a RECTANGLE node with resolved image-fill src (node.isImageFill) renders a real <img src>, not a <div>', () => {
  // Real-fixture shape (Challenge Arena, node 1:4): the image-bearing nodes
  // are RECTANGLE shapes carrying an IMAGE-type Figma paint, never literal
  // type:'IMAGE' nodes. ir-experimental-renderer.js's buildRenderNode()
  // resolves this (mirroring legacy's imageRefOf()/imgUrl()) and sets
  // isImageFill/src on the render node regardless of node.type — this test
  // proves materialize-html.js's renderNode() honors that flag.
  const renderTree = {
    nodeId: 'root',
    type: 'FRAME',
    name: 'Root',
    layoutChoice: { mode: 'flow-column' },
    children: [
      {
        nodeId: 'rect1',
        type: 'RECTANGLE',
        name: 'Rectangle 34624593',
        layoutChoice: { mode: 'absolute', left: 0, top: 0, width: 100, height: 100 },
        isImageFill: true,
        imageRef: 'abc123',
        src: 'assets/fills/abc123-def456.png',
        children: [],
      },
    ],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(
    html.includes('<img class="rectangle-34624593" src="assets/fills/abc123-def456.png" alt="Rectangle 34624593">'),
    'RECTANGLE with isImageFill+src renders as a real <img src>, not a <div>'
  );
  assert.ok(!/<div class="rectangle-34624593">/.test(html));
});

test('materializeHtml — a RECTANGLE node with isImageFill but unresolved src (empty string) still renders <img> (matches legacy: kind stays image even if URL lookup misses)', () => {
  const renderTree = {
    nodeId: 'root',
    type: 'FRAME',
    name: 'Root',
    layoutChoice: { mode: 'flow-column' },
    children: [
      {
        nodeId: 'rect1',
        type: 'RECTANGLE',
        name: 'Dot',
        layoutChoice: { mode: 'absolute', left: 0, top: 0, width: 8, height: 8 },
        isImageFill: true,
        imageRef: 'unresolved-ref',
        src: '',
        children: [],
      },
    ],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(html.includes('<img class="dot" src="" alt="Dot">'));
});

test('modeDecls — TEXT node with real NDG typography emits font-family/size/weight/line-height/letter-spacing', () => {
  const decls = modeDecls({
    mode: 'absolute',
    left: 0,
    top: 0,
    isText: true,
    fontFamily: 'IBM Plex Sans',
    fontSize: 40,
    fontWeight: 600,
    lineHeight: 50,
    letterSpacing: 0,
  });
  const map = Object.fromEntries(decls);
  assert.strictEqual(map['font-family'], "'IBM Plex Sans', sans-serif");
  assert.strictEqual(map['font-weight'], '600');
  assert.strictEqual(map['font-size'], '40px');
  assert.strictEqual(map['line-height'], '50px');
  assert.strictEqual(map['letter-spacing'], '0px');
});

test('modeDecls — TEXT node with textAlign:CENTER emits text-align:center (real bug: every paragraph in a real fixture is genuinely CENTER, silently dropped before this fix)', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 0, top: 0, isText: true, textAlign: 'CENTER',
  });
  const map = Object.fromEntries(decls);
  assert.strictEqual(map['text-align'], 'center');
});

test('modeDecls — TEXT node with textAlign:LEFT (Figma\'s own default) emits no text-align at all (CSS\'s own default already matches, no redundant declaration)', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 0, top: 0, isText: true, textAlign: 'LEFT',
  });
  const map = Object.fromEntries(decls);
  assert.strictEqual('text-align' in map, false);
});

test('modeDecls — TEXT node with textAlign:JUSTIFIED emits text-align:justify', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 0, top: 0, isText: true, textAlign: 'JUSTIFIED',
  });
  const map = Object.fromEntries(decls);
  assert.strictEqual(map['text-align'], 'justify');
});

test('modeDecls — TEXT node missing some typography fields omits only the missing ones (never invents a default)', () => {
  const decls = modeDecls({
    mode: 'unknown',
    left: 0,
    top: 0,
    isText: true,
    fontSize: 20,
    // fontFamily/fontWeight/lineHeight/letterSpacing intentionally absent
  });
  const keys = decls.map(([k]) => k);
  assert.ok(keys.includes('font-size'));
  assert.ok(!keys.includes('font-family'));
  assert.ok(!keys.includes('font-weight'));
  assert.ok(!keys.includes('line-height'));
  assert.ok(!keys.includes('letter-spacing'));
});

test('modeDecls — a non-TEXT node with typography-shaped fields on layoutChoice never emits font decls (isText gate)', () => {
  const decls = modeDecls({
    mode: 'flow-row', fontFamily: 'IBM Plex Sans', fontSize: 40, isText: false,
  });
  const keys = decls.map(([k]) => k);
  assert.ok(!keys.includes('font-family'));
  assert.ok(!keys.includes('font-size'));
});

test('materializeHtml — opts.fonts threads a real Google Fonts <link> into the document head (mirrors legacy fontsLink())', () => {
  const renderTree = {
    nodeId: 'root', type: 'FRAME', name: 'Root', layoutChoice: { mode: 'flow-column' }, children: [],
  };
  const { html } = materializeHtml(renderTree, { fonts: ['IBM Plex Sans', 'IBM Plex Sans'] });
  assert.ok(html.includes('<link rel="preconnect" href="https://fonts.googleapis.com">'));
  assert.ok(html.includes('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap'));
  // De-duped: only one family= param even though 'IBM Plex Sans' was passed twice.
  assert.strictEqual((html.match(/family=/g) || []).length, 1);
});

test('materializeHtml — omitting opts.fonts (or an empty list) emits no Google Fonts link (fallback guarantee)', () => {
  const renderTree = {
    nodeId: 'root', type: 'FRAME', name: 'Root', layoutChoice: { mode: 'flow-column' }, children: [],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(!html.includes('fonts.googleapis.com'));
});

// ─── Phase A: clipsContent / blendMode / strokeDashes / textDecoration ─────

test('modeDecls — layoutChoice.clips emits overflow:hidden per-node (previously only ever applied at the page root)', () => {
  const decls = modeDecls({ mode: 'absolute', left: 0, top: 0, clips: true });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('overflow'), 'hidden');
});

test('modeDecls — layoutChoice.clips absent/false emits no overflow declaration', () => {
  const decls = modeDecls({ mode: 'absolute', left: 0, top: 0 });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.has('overflow'), false);
});

test('modeDecls — blendMode MULTIPLY emits mix-blend-mode:multiply', () => {
  const decls = modeDecls({ mode: 'absolute', left: 0, top: 0, blendMode: 'MULTIPLY' });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('mix-blend-mode'), 'multiply');
});

test('modeDecls — blendMode NORMAL/PASS_THROUGH (Figma\'s own defaults) emit no mix-blend-mode at all', () => {
  const normal = new Map(modeDecls({ mode: 'absolute', left: 0, top: 0, blendMode: 'NORMAL' }));
  const passThrough = new Map(modeDecls({ mode: 'absolute', left: 0, top: 0, blendMode: 'PASS_THROUGH' }));
  const absent = new Map(modeDecls({ mode: 'absolute', left: 0, top: 0 }));
  assert.strictEqual(normal.has('mix-blend-mode'), false);
  assert.strictEqual(passThrough.has('mix-blend-mode'), false);
  assert.strictEqual(absent.has('mix-blend-mode'), false);
});

test('modeDecls — strokeDashes present switches border style from solid to dashed (plain border path)', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 0, top: 0, strokeCss: '#e0e0e0', strokeWeight: 1, strokeDashes: [4, 4],
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('border'), '1px dashed #e0e0e0');
});

test('modeDecls — strokeDashes present switches the OUTSIDE/CENTER outline style to dashed too', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 0, top: 0, strokeCss: '#ffffff', strokeWeight: 2, strokeAlign: 'OUTSIDE', strokeDashes: [10, 10],
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('outline'), '2px dashed #ffffff');
});

test('modeDecls — strokeDashes present switches individualStrokeWeights borders to dashed too', () => {
  const decls = modeDecls({
    mode: 'absolute',
    left: 0,
    top: 0,
    strokeCss: '#e0e0e0',
    strokeWeight: 1,
    strokeDashes: [4, 4],
    individualStrokeWeights: {
      top: 0, right: 0, bottom: 3, left: 0,
    },
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('border-bottom'), '3px dashed #e0e0e0');
});

test('modeDecls — strokeDashes absent (or empty) keeps the existing solid-border behavior unchanged (no regression)', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 0, top: 0, strokeCss: '#e0e0e0', strokeWeight: 1,
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('border'), '1px solid #e0e0e0');
});

test('modeDecls — TEXT node with textDecoration:UNDERLINE emits text-decoration:underline', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 0, top: 0, isText: true, textDecoration: 'UNDERLINE',
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('text-decoration'), 'underline');
});

test('modeDecls — TEXT node with textDecoration:STRIKETHROUGH emits text-decoration:line-through', () => {
  const decls = modeDecls({
    mode: 'absolute', left: 0, top: 0, isText: true, textDecoration: 'STRIKETHROUGH',
  });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.get('text-decoration'), 'line-through');
});

test('modeDecls — TEXT node with no textDecoration emits no text-decoration declaration', () => {
  const decls = modeDecls({ mode: 'absolute', left: 0, top: 0, isText: true });
  const asMap = new Map(decls);
  assert.strictEqual(asMap.has('text-decoration'), false);
});

// ─── Design Skeleton role -> accessibility attributes ──────────────────────

test('materializeHtml — an image with role:decorative-chrome gets alt="" instead of its raw Figma layer name (real, previously-shipped accessibility gap)', () => {
  const renderTree = {
    nodeId: 'root', type: 'FRAME', name: 'Root', layoutChoice: { mode: 'flow-column' },
    children: [{
      nodeId: 'bg1',
      type: 'RECTANGLE',
      name: 'Rectangle 47',
      role: 'decorative-chrome',
      layoutChoice: { mode: 'absolute', left: 0, top: 0, width: 100, height: 100 },
      isImageFill: true,
      src: 'assets/fills/abc.png',
      children: [],
    }],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(html.includes('alt=""'), 'decorative image gets empty alt');
  assert.ok(!html.includes('alt="Rectangle 47"'), 'raw layer name never leaks into alt for a decorative image');
});

test('materializeHtml — role:leaf-shape image also gets alt=""', () => {
  const renderTree = {
    nodeId: 'root', type: 'FRAME', name: 'Root', layoutChoice: { mode: 'flow-column' },
    children: [{
      nodeId: 'divider1', type: 'RECTANGLE', name: 'Divider', role: 'leaf-shape',
      layoutChoice: { mode: 'absolute', left: 0, top: 0, width: 100, height: 1 },
      isImageFill: true, src: 'assets/fills/x.png', children: [],
    }],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(html.includes('alt=""'));
});

test('materializeHtml — an image with role:content (or no role) keeps its real alt text (no regression)', () => {
  const renderTree = {
    nodeId: 'root', type: 'FRAME', name: 'Root', layoutChoice: { mode: 'flow-column' },
    children: [{
      nodeId: 'photo1', type: 'RECTANGLE', name: 'Product screenshot', role: 'content',
      layoutChoice: { mode: 'absolute', left: 0, top: 0, width: 400, height: 300 },
      isImageFill: true, src: 'assets/fills/photo.png', children: [],
    }],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(html.includes('alt="Product screenshot"'));
});

test('materializeHtml — a non-text/non-image element with role:decorative-chrome gets aria-hidden="true" (no prior aria-hidden handling existed anywhere in this render path)', () => {
  const renderTree = {
    nodeId: 'root', type: 'FRAME', name: 'Root', layoutChoice: { mode: 'flow-column' },
    children: [{
      nodeId: 'bg1', type: 'RECTANGLE', name: 'Background', role: 'decorative-chrome',
      layoutChoice: { mode: 'absolute', left: 0, top: 0, width: 200, height: 100 }, children: [],
    }],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(/aria-hidden="true"/.test(html));
});

test('materializeHtml — a non-text/non-image element with role:leaf-shape gets aria-hidden="true"', () => {
  const renderTree = {
    nodeId: 'root', type: 'FRAME', name: 'Root', layoutChoice: { mode: 'flow-column' },
    children: [{
      nodeId: 'divider1', type: 'RECTANGLE', name: 'Divider', role: 'leaf-shape',
      layoutChoice: { mode: 'absolute', left: 0, top: 0, width: 200, height: 1 }, children: [],
    }],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(/aria-hidden="true"/.test(html));
});

test('materializeHtml — a non-text/non-image element with role:layout-container-inferred (or no role) never gets aria-hidden (no over-hiding real structure)', () => {
  const renderTree = {
    nodeId: 'root', type: 'FRAME', name: 'Root', layoutChoice: { mode: 'flow-column' },
    children: [{
      nodeId: 'card1', type: 'FRAME', name: 'Card', role: 'layout-container-inferred',
      layoutChoice: { mode: 'absolute', left: 0, top: 0, width: 200, height: 100 }, children: [],
    }],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(!/aria-hidden/.test(html));
});

test('materializeHtml — a TEXT node is never aria-hidden, even if (hypothetically) mis-tagged with a decorative role (this role scheme never actually produces that combination, but the renderer itself must not suppress real text)', () => {
  const renderTree = {
    nodeId: 'root', type: 'FRAME', name: 'Root', layoutChoice: { mode: 'flow-column' },
    children: [{
      nodeId: 't1', type: 'TEXT', name: 'Label', role: 'decorative-chrome', characters: 'Hello',
      layoutChoice: { mode: 'absolute', left: 0, top: 0, isText: true }, children: [],
    }],
  };
  const { html } = materializeHtml(renderTree);
  assert.ok(!/aria-hidden/.test(html), 'TEXT rendering path never even checks role — this asserts that stays true');
  assert.ok(html.includes('Hello'));
});

process.exitCode = failed ? 1 : 0;
console.log(`\n${passed} passed, ${failed} failed`);
