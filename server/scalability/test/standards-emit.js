'use strict';
/**
 * Emit modes + standards recovery gates.
 */
const {
  analyze,
  emit,
  normalizeEmitMode,
  COLUMN_FLEX_MIN_SCORE,
} = require('../../figma-build');

/** Force Path A so gated heuristics remain unit-testable under Phase 0 dual-path. */
function analyzePathA(doc, extra = {}) {
  return analyze(doc, { emitMode: 'standard', alCoverageThreshold: 0, ...extra });
}

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

function hackSpaceDoc(withLines) {
  const children = [
    {
      id: 'bg',
      type: 'RECTANGLE',
      name: 'bg',
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      absoluteBoundingBox: box(0, 0, 610, 123),
      cornerRadius: 10,
    },
    {
      id: 'thumb',
      type: 'RECTANGLE',
      name: 'Thumb',
      fills: [{ type: 'IMAGE', imageRef: 'r1', scaleMode: 'FILL' }],
      absoluteBoundingBox: box(10, 12, 128, 100),
      cornerRadius: 10,
    },
    {
      id: 'title',
      type: 'TEXT',
      name: 'Title',
      characters: 'HackSpace',
      style: { fontSize: 18, fontWeight: 600, fontFamily: 'Poppins' },
      fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.2, a: 1 } }],
      absoluteBoundingBox: box(158, 13, 104, 27),
    },
    {
      id: 'date',
      type: 'TEXT',
      name: 'Date',
      characters: 'Registration Ends on | Mon 08 2025',
      style: { fontSize: 13, fontWeight: 500, fontFamily: 'Poppins' },
      fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.2, a: 1 } }],
      absoluteBoundingBox: box(158, 87, 227, 20),
    },
    {
      id: 'cta',
      type: 'FRAME',
      name: 'Register CTA',
      absoluteBoundingBox: box(473, 62, 115, 31),
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      strokes: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.2, a: 1 } }],
      strokeWeight: 1,
      cornerRadius: 10,
      children: [
        {
          id: 'cta-label',
          type: 'TEXT',
          name: 'Register Now',
          characters: 'Register Now',
          style: { fontSize: 12, fontWeight: 500, fontFamily: 'Poppins' },
          fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.2, a: 1 } }],
          absoluteBoundingBox: box(493, 68, 79, 20),
        },
      ],
    },
    {
      id: 'status',
      type: 'TEXT',
      name: 'Offline',
      characters: 'Offline',
      style: { fontSize: 12, fontWeight: 400, fontFamily: 'Poppins' },
      fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.2, a: 1 } }],
      absoluteBoundingBox: box(511, 30, 39, 18),
    },
  ];
  if (withLines) {
    children.push({
      id: 'line15',
      type: 'LINE',
      name: 'Line 15',
      absoluteBoundingBox: box(447, 20, 1, 80),
      fills: [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8, a: 1 } }],
    });
  }
  return {
    id: 'g1',
    type: 'GROUP',
    name: 'HackSpace Card',
    absoluteBoundingBox: box(0, 0, 610, 123),
    children,
  };
}

test('normalizeEmitMode defaults to auto', () => {
  assert(normalizeEmitMode() === 'auto', 'default');
  assert(normalizeEmitMode('pixel') === 'pixel', 'pixel');
  assert(normalizeEmitMode('PIXEL-PREVIEW') === 'pixel', 'alias');
  assert(normalizeEmitMode('standard') === 'standard', 'standard');
});

test('resolveEmitMode auto prefers standard unless freeform-heavy', () => {
  const { resolveEmitMode } = require('../../figma-build');
  assert(resolveEmitMode('auto', { freeform: 1, autoLayout: 2 }).emitMode === 'standard', 'mixed → standard');
  assert(resolveEmitMode('auto', { freeform: 10, autoLayout: 0 }).emitMode === 'standard', 'freeform → still standard (flex)');
  assert(resolveEmitMode('standard', { freeform: 10, autoLayout: 0 }).emitMode === 'standard', 'explicit standard');
  assert(resolveEmitMode('pixel', { freeform: 0, autoLayout: 5 }).emitMode === 'pixel', 'explicit pixel');
});

test('layoutReport.quality alwaysPromisesHtmlCss', () => {
  const { layoutReport } = analyze(hackSpaceDoc(false), { emitMode: 'auto' });
  assert(layoutReport.quality && layoutReport.quality.alwaysReturnsHtmlCss === true, 'promise');
  assert(layoutReport.alwaysReturnsHtmlCss === true, 'report flag');
  assert(typeof layoutReport.quality.summary === 'string' && layoutReport.quality.summary.length > 0, 'summary');
  const { html, css } = emit(
    analyzePathA(hackSpaceDoc(false)).tree,
    { title: 'HackSpace' },
  );
  assert(/event-card|HackSpace/.test(html), 'html returned');
  assert(css.length > 20, 'css returned');
});

test('standard freeform card → flex columns when score passes', () => {
  const { tree, layoutReport } = analyzePathA(hackSpaceDoc(false));
  assert(tree._standardsFlow, 'expected standards flex recovery');
  assert(tree.decls.get('display') === 'flex', 'root should be flex');
  assert(tree.decls.get('flex-direction') === 'row', 'root row');
  assert(tree.children.some((c) => String(c.extraClass || '').includes('et-flow-col')), 'column wrappers');
  assert(layoutReport.freeform === true, 'freeform flagged');
  assert(layoutReport.recoveryApplied === true, 'recovery applied');
  assert(layoutReport.warnings.some((w) => w.code === 'FREEFORM_RECOVERY'), 'recovery warning');
  assert(layoutReport.productionReady === false, 'not production-ready without AL');

  const { html, css, promoted } = emit(tree, { title: 'HackSpace' });
  assert(promoted === true, 'uses promoted EventCard emit');
  assert(/<article[\s>]/.test(html), 'article landmark');
  assert(/event-card/.test(html), 'event-card class');
  assert(/event-card__button/.test(html), 'cta button');
  assert(/@media \(max-width: 720px\)/.test(css), 'mobile stack rules');
  assert(!/role="interactive"/.test(html), 'no invalid interactive role');
  const sectionCount = (html.match(/event-card/g) || []).length;
  assert(sectionCount >= 1, 'event-card present');
});

test('CTA button is flex-centered (not left/top text)', () => {
  const doc = hackSpaceDoc(false);
  const { tree } = analyzePathA(doc);
  const btn = (function find(el) {
    if (!el) return null;
    if (el.tag === 'button') return el;
    for (const c of el.children || []) {
      const f = find(c);
      if (f) return f;
    }
    return null;
  })(tree);
  assert(btn, 'button promoted in tree');
  assert(btn.decls.get('display') === 'inline-flex', 'inline-flex');
  assert(btn.decls.get('align-items') === 'center', 'align center');
  assert(btn.decls.get('justify-content') === 'center', 'justify center');
  assert(btn.decls.get('text-align') === 'center', 'text center');
  const { html, css } = emit(tree);
  assert(/event-card__button/.test(html), 'semantic button class');
  assert(/inline-flex|align-items:\s*center/.test(css), 'centering in css');
});

test('content column clusters title+icon above date', () => {
  const doc = hackSpaceDoc(false);
  // Insert trophy between title and date (tight gap), date far below
  doc.children.splice(3, 0, {
    id: 'trophy',
    type: 'TEXT',
    name: 'Trophy',
    characters: '🏆',
    style: { fontSize: 14, fontWeight: 400, fontFamily: 'Poppins' },
    fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.2, a: 1 } }],
    absoluteBoundingBox: box(158, 44, 16, 20),
  });
  const { tree } = analyzePathA(doc);
  const cols = tree.children.filter((c) => String(c.extraClass || '').includes('et-flow-col'));
  const mid = cols.find((c) => (c.children || []).some((ch) =>
    ch.extraClass === 'et-flow-cluster'
    || ch.name === 'col-cluster'
    || /hackspace|title|trophy/i.test(ch.name || ch.text || '')
    || (ch.children || []).some((g) => /hackspace|title|trophy/i.test(g.name || g.text || ''))));
  assert(mid, 'middle column');
  assert(
    mid.children.some((c) => c.extraClass === 'et-flow-cluster' || c.name === 'col-cluster'),
    'title/icon clustered',
  );
  assert(mid.decls.get('justify-content') === 'space-between', 'date pushed to bottom');
});

test('pixel mode skips column flex recovery', () => {
  const { tree, layoutReport } = analyze(hackSpaceDoc(false), { emitMode: 'pixel' });
  assert(!tree._standardsFlow, 'no heuristic flex in pixel mode');
  assert(layoutReport.emitMode === 'pixel', 'mode');
  assert(layoutReport.warnings.some((w) => w.code === 'PIXEL_PREVIEW'), 'pixel warning');
  assert(layoutReport.warnings.some((w) => w.code === 'FREEFORM_GROUP'), 'freeform warning');
});

test('divider LINE → border-right (not absolute overlay) when recovered', () => {
  const { tree } = analyzePathA(hackSpaceDoc(true));
  assert(tree._standardsFlow, 'recovered');
  const cols = tree.children.filter((c) => String(c.extraClass || '').includes('et-flow-col'));
  assert(cols.some((c) => c.decls && c.decls.get('border-right')), 'border-right on a column');
  const overlays = tree.children.filter((c) => String(c.extraClass || '').includes('et-overlay'));
  assert(overlays.length === 0, 'vertical divider should not remain as overlay');
});

test('CANVAS page root still walks children', () => {
  const doc = {
    id: '0:1',
    type: 'CANVAS',
    name: 'Page 1',
    absoluteBoundingBox: box(0, 0, 400, 200),
    children: [
      {
        id: 'f1',
        type: 'FRAME',
        name: 'Card',
        layoutMode: 'HORIZONTAL',
        itemSpacing: 8,
        absoluteBoundingBox: box(0, 0, 400, 100),
        children: [
          {
            id: 't1',
            type: 'TEXT',
            name: 'Hi',
            characters: 'Hello',
            style: { fontSize: 16 },
            fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
            absoluteBoundingBox: box(0, 0, 80, 24),
          },
          {
            id: 't2',
            type: 'TEXT',
            name: 'Bye',
            characters: 'World',
            style: { fontSize: 14 },
            fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
            absoluteBoundingBox: box(90, 0, 80, 24),
          },
        ],
      },
    ],
  };
  const { tree, layoutReport } = analyzePathA(doc);
  assert(tree.children && tree.children.length === 1, 'canvas children walked');
  assert(/Hello/.test(emit(tree).html), 'text emitted from canvas child');
  assert(layoutReport.productionReady === true, 'AL-only tree is production-ready');
  const unexpected = layoutReport.warnings.filter((w) => w.code !== 'DEMOTE_ABS_FLEX');
  assert(unexpected.length === 0, 'no freeform warnings for AL (demote abs-flex ok)');
});

test('recovered card stamps event-card BEM roles', () => {
  const { tree } = analyzePathA(hackSpaceDoc(false));
  assert(tree.semanticClass === 'event-card', 'root semantic');
  const { html, css, promoted } = emit(tree, { title: 'HackSpace' });
  assert(promoted === true, 'promoted EventCard emit');
  assert(/class="event-card"/.test(html), 'event-card root');
  assert(/event-card__media/.test(html), 'media region');
  assert(/event-card__body/.test(html), 'body region');
  assert(/event-card__actions/.test(html), 'actions region');
  assert(/event-card__button/.test(html), 'cta button class');
  assert(/<h3 class="event-card__title">/.test(html), 'semantic title');
  assert(/<time datetime=/.test(html), 'time element');
  assert(!/group-117127/.test(html), 'no figma group class');
  assert(!/class="canvas"/.test(html), 'no fixed canvas wrapper');
  assert(/--color-surface/.test(css), 'design tokens in css');
  assert(/<img class="event-card__image"/.test(html), 'img tag for thumb');
  assert(!/event-card__image--placeholder/.test(html), 'no empty placeholder div');
  assert(/src="(https?:|data:|assets\/)/.test(html), 'image has usable src');
});

test('incentive-like card content stack → flex (not absolute text)', () => {
  const doc = {
    id: 'card',
    type: 'GROUP',
    name: 'IncentiveCard',
    absoluteBoundingBox: box(0, 0, 380, 358),
    children: [
      {
        id: 'bg',
        type: 'RECTANGLE',
        name: 'Rectangle 1',
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.1 }, opacity: 0.1 }],
        absoluteBoundingBox: box(0, 0, 380, 358),
      },
      {
        id: 'content',
        type: 'GROUP',
        name: 'Content',
        absoluteBoundingBox: box(40, 44, 280, 253),
        children: [
          {
            id: 'icon',
            type: 'VECTOR',
            name: 'fi_icon',
            fills: [{ type: 'SOLID', color: { r: 1, g: 0.6, b: 0.2, a: 1 } }],
            fillGeometry: [{ path: 'M25 2C20 2 8 12 8 22C8 32 16 42 25 48C34 42 42 32 42 22C42 12 30 2 25 2Z' }],
            absoluteBoundingBox: box(40, 44, 50, 50),
          },
          {
            id: 'title',
            type: 'TEXT',
            name: 'Title',
            characters: 'Learn by Building',
            style: { fontSize: 24, fontWeight: 600 },
            fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
            absoluteBoundingBox: box(40, 132, 193, 36),
          },
          {
            id: 'body',
            type: 'TEXT',
            name: 'Body',
            characters: 'Gain hands-on experience',
            style: { fontSize: 16, fontWeight: 400 },
            fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
            absoluteBoundingBox: box(40, 201, 280, 96),
          },
        ],
      },
    ],
  };
  const { tree } = analyzePathA(doc);
  const content = (function find(el) {
    if (!el) return null;
    if (el.name === 'Content' || (el.children || []).some((c) => c.text === 'Learn by Building')) {
      if (el.decls && el.decls.get('display') === 'flex') return el;
    }
    for (const c of el.children || []) {
      const f = find(c);
      if (f) return f;
    }
    return null;
  })(tree);
  assert(content, 'content stack found as flex');
  assert(content.decls.get('flex-direction') === 'column', 'column flex');
  const title = (content.children || []).find((c) => /Learn by Building/.test(c.text || ''));
  assert(title, 'title present');
  assert(title.decls.get('position') !== 'absolute', 'title not absolute');
  assert(!title.decls.has('top'), 'title has no top offset');
});

test('artboard section → padding + et-page (no absolute content column)', () => {
  // Mirrors Incentives: full-bleed bg + inset flex content column
  const doc = {
    id: '1:3',
    type: 'FRAME',
    name: 'Elevate',
    clipsContent: true,
    absoluteBoundingBox: box(0, 0, 1440, 1079),
    fills: [{ type: 'SOLID', color: { r: 0.09, g: 0.09, b: 0.09, a: 1 } }],
    children: [
      {
        id: '1:4',
        type: 'RECTANGLE',
        name: 'Rectangle bg',
        fills: [{ type: 'SOLID', color: { r: 0.09, g: 0.09, b: 0.09, a: 1 } }],
        absoluteBoundingBox: box(0, 0, 1440, 1079),
      },
      {
        id: '1:6',
        type: 'FRAME',
        name: 'Group 1171277895',
        layoutMode: 'VERTICAL',
        itemSpacing: 36,
        absoluteBoundingBox: box(122, 76, 1196, 923),
        children: [
          {
            id: '1:10',
            type: 'TEXT',
            name: 'Headline',
            characters: 'Elevate Your Success with Premium Rewards',
            style: { fontSize: 40, fontWeight: 600 },
            fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
            absoluteBoundingBox: box(122, 76, 500, 100),
          },
          {
            id: '1:13',
            type: 'TEXT',
            name: 'Body',
            characters: 'From financial grants to technical resources',
            style: { fontSize: 16, fontWeight: 400 },
            fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
            absoluteBoundingBox: box(122, 200, 400, 80),
          },
        ],
      },
    ],
  };
  const { tree, layoutReport } = analyzePathA(doc);
  const { html, css } = emit(tree, { title: 'Incentives' });
  assert(html.includes('et-page'), 'uses et-page not canvas');
  assert(!/class="[^"]*\bcanvas\b/.test(html), 'no canvas class');
  assert(!/\.canvas\s*\{/.test(css), 'no .canvas rule');
  assert(!/\.group-1171277895\s*\{[^}]*position:\s*absolute/.test(css), 'content column not absolute');
  assert(/padding:/.test(css), 'section uses padding');
  assert(html.includes('Elevate Your Success'), 'headline text present');
});

test('quote banner: VECTOR rect chrome lifts fill (no missing-asset pink)', () => {
  // IBM-style quote strip: dark VECTOR rectangle + white quote + media
  const doc = {
    id: '11:695',
    type: 'GROUP',
    name: 'Group Banner',
    absoluteBoundingBox: box(0, 0, 1196, 214),
    children: [
      {
        id: '11:696',
        type: 'VECTOR',
        name: 'Rectangle 34624510',
        fills: [{ type: 'SOLID', color: { r: 3 / 255, g: 17 / 255, b: 62 / 255, a: 1 } }],
        fillsGeometry: [{ path: 'M0 0L1196 0L1196 214L0 214Z' }],
        absoluteBoundingBox: box(0, 0, 1196, 214),
      },
      {
        id: '11:697',
        type: 'GROUP',
        name: 'Quote wrap',
        absoluteBoundingBox: box(33, 68, 967, 79),
        children: [
          {
            id: '11:699',
            type: 'TEXT',
            name: 'Quote',
            characters: '"The evolution from manual oversight to agentic orchestration."',
            style: { fontSize: 24, fontWeight: 600, fontFamily: 'IBM Plex Sans' },
            fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
            absoluteBoundingBox: box(33, 68, 885, 79),
          },
        ],
      },
      {
        id: '11:709',
        type: 'RECTANGLE',
        name: 'image 232',
        fills: [{ type: 'IMAGE', imageRef: 'robot', scaleMode: 'FILL' }],
        absoluteBoundingBox: box(1060, 39, 92, 135),
      },
    ],
  };
  const { tree, layoutReport } = analyze(doc, { emitMode: 'standard' });
  const { html, css } = emit(tree, { title: 'Banner' });
  // Phase 0: freeform banner → Path B (scaled absolute); chrome must not be missing-asset pink
  assert(html.includes('et-path-b') || (layoutReport.bannerShells || 0) >= 1, 'Path B or banner shell');
  assert(!/data-figma-missing-asset/.test(html), 'no missing-asset placeholder on chrome');
  assert(!/background:\s*rgba\(255,\s*80,\s*80/.test(html), 'no pink placeholder override');
  assert(/#03113e/i.test(css), 'dark banner fill in CSS');
  assert(/color:\s*#ffffff/i.test(css), 'quote text stays white');
  assert(html.includes('evolution from manual'), 'quote text present');
  assert(Array.isArray(layoutReport.demoteReasons), 'demoteReasons on scorecard');
});

test('COLUMN_FLEX_MIN_SCORE is gated', () => {
  assert(COLUMN_FLEX_MIN_SCORE >= 0.7, 'threshold stays conservative');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
