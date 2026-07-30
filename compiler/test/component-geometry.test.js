'use strict';

/**
 * Phase 2 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — Component IR / Semantic IR
 * card/banner/divider shape recognition tests.
 *
 * Mirrors the PASS/FAIL harness pattern used by compiler/test/geometry.test.js.
 * Covers, per the Phase 2 task brief:
 *   (a) card-uniformity — 3+ structurally identical siblings get
 *       byte-identical Facts (the "row 002 got a different DOM shape than
 *       003/004" bug class named in the blueprint's Phase 2 risk note).
 *   (b) banner shape recognition.
 *   (c) divider recognition (consumes Phase 1's column-flex candidates).
 *   (d) END-TO-END: a recognized card/banner Fact reaches Component IR's
 *       and Semantic IR's published payload, not just the pure detector.
 */

const {
  detectComponentGeometry,
  detectCardShape,
  detectCardGridUniformity,
  normalizeUniformCardChrome,
  detectBannerShape,
  assignDividerToColumns,
  detectRowSetUniformity,
  computeRowSetColumns,
} = require('../rulepack/packs/component-detect/geometry-rules');
const { detectGeometry } = require('../geometry');
const { detectComponents, projectComponentIR } = require('../components');
const { detectSemantics, projectSemanticIR, ROLE } = require('../semantic');
const { materializeNormalizedDesignGraph } = require('../ndg');
const { createWorkspace } = require('../workspace');

let passed = 0;
let failed = 0;

function pass(name) {
  passed += 1;
  console.log(`PASS  ${name}`);
}
function fail(name, err) {
  failed += 1;
  console.error(`FAIL  ${name} — ${err && err.message ? err.message : err}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => pass(name))
    .catch((e) => fail(name, e));
}

async function seedNdg(document, graphId) {
  const ws = createWorkspace();
  return materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    document,
    graphId,
  });
}

/** NDG rewrites raw document ids (e.g. 'banner') to graph node ids (e.g.
 *  'src:banner') — resolve by sourceNodeId rather than hardcoding the
 *  prefix, which is an NDG implementation detail this test shouldn't pin. */
function idFor(graph, sourceNodeId) {
  const n = (graph.nodes || []).find((x) => x.sourceNodeId === sourceNodeId);
  return n ? n.id : null;
}

/** One "shell" card: chrome rect (full-bleed solid fill) + a content wrap
 *  with ≥2 TEXT children, at a given x offset — every card built from this
 *  helper is structurally IDENTICAL (same relative geometry), only shifted
 *  in x, which is exactly the "sibling cards in a row" shape from
 *  server/figma-build.js's collapseCardShells + inferCardGrids. */
function mkCard(idPrefix, x) {
  return {
    id: `${idPrefix}`,
    type: 'FRAME',
    absoluteBoundingBox: { x, y: 0, width: 200, height: 220 },
    children: [
      {
        id: `${idPrefix}-chrome`,
        type: 'RECTANGLE',
        fills: [{ type: 'SOLID' }],
        absoluteBoundingBox: { x, y: 0, width: 200, height: 220 },
      },
      {
        id: `${idPrefix}-wrap`,
        type: 'FRAME',
        absoluteBoundingBox: { x: x + 16, y: 16, width: 168, height: 180 },
        children: [
          {
            id: `${idPrefix}-title`,
            type: 'TEXT',
            characters: 'Card title',
            absoluteBoundingBox: { x: x + 16, y: 16, width: 168, height: 24 },
          },
          {
            id: `${idPrefix}-body`,
            type: 'TEXT',
            characters: 'Card body copy',
            absoluteBoundingBox: { x: x + 16, y: 48, width: 168, height: 60 },
          },
        ],
      },
    ],
  };
}

/** 3 structurally identical cards side by side, in a row parent — the
 *  fixture for both card-shape uniformity and card-grid recognition. */
function cardRowDoc() {
  return {
    id: 'row',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 660, height: 220 },
    children: [
      mkCard('card0', 0),
      mkCard('card1', 220),
      mkCard('card2', 440),
    ],
  };
}

/** Wide short dark banner shell + one text content child — collapseBannerShells'
 *  target shape (aspect ratio ≥2.2, height in [80,360], dark chrome fill). */
function bannerDoc() {
  return {
    id: 'banner',
    type: 'FRAME',
    absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 160 },
    children: [
      {
        id: 'banner-chrome',
        type: 'RECTANGLE',
        fills: [{ type: 'SOLID' }], // no color → defaults to black (dark)
        absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 160 },
      },
      {
        id: 'banner-quote',
        type: 'TEXT',
        characters: 'A quote worth reading',
        absoluteBoundingBox: { x: 32, y: 48, width: 400, height: 64 },
      },
    ],
  };
}

/** Freeform two-column cluster (same shape as geometry.test.js's
 *  columnFlexDoc) plus a thin vertical divider hairline sitting exactly
 *  between the two columns — server/figma-build.js's
 *  convertDividersToBorders' target shape. */
function columnFlexWithDividerDoc() {
  return {
    id: 'root',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 260, height: 130 },
    children: [
      { id: 'a', type: 'RECTANGLE', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 } },
      { id: 'b', type: 'RECTANGLE', absoluteBoundingBox: { x: 0, y: 60, width: 100, height: 40 } },
      { id: 'c', type: 'RECTANGLE', absoluteBoundingBox: { x: 140, y: 0, width: 100, height: 30 } },
      { id: 'd', type: 'RECTANGLE', absoluteBoundingBox: { x: 140, y: 50, width: 100, height: 25 } },
      { id: 'e', type: 'RECTANGLE', absoluteBoundingBox: { x: 140, y: 100, width: 100, height: 30 } },
      // Hairline: 2px wide, > 40px tall — midpoint (x=120) sits between
      // column A (right edge 100) and column B (left edge 140).
      { id: 'divider', type: 'RECTANGLE', absoluteBoundingBox: { x: 119, y: 10, width: 2, height: 100 } },
    ],
  };
}

/** One "table row" shaped like Challenge Arena's real rows (see this file's
 *  header + geometry-rules.js's row-set section comments): a full-width
 *  chrome rect, a content strip bundling id/title/reward/xp text columns,
 *  and a separate action-button sibling — at a given y offset. Every row
 *  built from this helper is structurally IDENTICAL (same relative
 *  geometry), only shifted in y. */
function mkRow(idPrefix, y) {
  return {
    id: idPrefix,
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y, width: 1000, height: 160 },
    children: [
      {
        id: `${idPrefix}-chrome`,
        type: 'RECTANGLE',
        fills: [{ type: 'SOLID' }],
        absoluteBoundingBox: { x: 0, y, width: 1000, height: 160 },
      },
      {
        id: `${idPrefix}-content`,
        type: 'GROUP',
        absoluteBoundingBox: { x: 20, y: y + 10, width: 780, height: 140 },
        children: [
          { id: `${idPrefix}-id`, type: 'TEXT', characters: '001', absoluteBoundingBox: { x: 20, y: y + 40, width: 40, height: 24 } },
          {
            id: `${idPrefix}-title`,
            type: 'GROUP',
            absoluteBoundingBox: { x: 100, y: y + 10, width: 350, height: 140 },
            children: [
              { id: `${idPrefix}-title-text`, type: 'TEXT', characters: 'Challenge title', absoluteBoundingBox: { x: 100, y: y + 10, width: 350, height: 29 } },
              { id: `${idPrefix}-title-desc`, type: 'TEXT', characters: 'Challenge description', absoluteBoundingBox: { x: 100, y: y + 50, width: 350, height: 40 } },
            ],
          },
          {
            id: `${idPrefix}-reward`,
            type: 'GROUP',
            absoluteBoundingBox: { x: 500, y: y + 30, width: 140, height: 40 },
            children: [
              { id: `${idPrefix}-reward-text`, type: 'TEXT', characters: 'Reward Kit', absoluteBoundingBox: { x: 500, y: y + 30, width: 140, height: 24 } },
            ],
          },
          {
            id: `${idPrefix}-xp`,
            type: 'GROUP',
            absoluteBoundingBox: { x: 700, y: y + 30, width: 70, height: 50 },
            children: [
              { id: `${idPrefix}-xp-text`, type: 'TEXT', characters: '3.8K', absoluteBoundingBox: { x: 700, y: y + 30, width: 70, height: 30 } },
            ],
          },
        ],
      },
      {
        id: `${idPrefix}-button`,
        type: 'FRAME',
        fills: [{ type: 'SOLID' }],
        absoluteBoundingBox: { x: 860, y: y + 60, width: 100, height: 32 },
        children: [
          { id: `${idPrefix}-button-text`, type: 'TEXT', characters: 'Register Now', absoluteBoundingBox: { x: 870, y: y + 66, width: 80, height: 18 } },
        ],
      },
    ],
  };
}

/** 4 structurally-identical rows stacked vertically, PLUS a differently-sized
 *  header sibling (mirrors the real Challenge Arena "table" node's actual
 *  shape — 4 uniform rows + one "TH" header row of a very different height)
 *  — the fixture for both row-set uniformity and column-alignment. */
function rowSetTableDoc() {
  return {
    id: 'table',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 680 },
    children: [
      {
        id: 'table-header',
        type: 'GROUP',
        absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 30 },
      },
      mkRow('row0', 40),
      mkRow('row1', 200),
      mkRow('row2', 360),
      mkRow('row3', 520),
    ],
  };
}

async function main() {
  // ─── (a) Card uniformity — the anti-drift proof ──────────────────────────

  await test('detectCardShape — pure function, shell shape from plain NDG-shaped nodes', () => {
    const parent = { id: 'p', box: { x: 0, y: 0, width: 200, height: 220 } };
    const children = [
      { id: 'chrome', type: 'RECTANGLE', paints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }], box: { x: 0, y: 0, width: 200, height: 220 } },
      { id: 'wrap', type: 'FRAME', box: { x: 16, y: 16, width: 168, height: 180 } },
    ];
    const card = detectCardShape(parent, children);
    assert(card, 'card detected');
    assert(card.shape === 'shell', 'shape=shell');
    assert(card.chromeId === 'chrome', 'chrome identified');
    assert(card.contentIds.length === 1 && card.contentIds[0] === 'wrap', 'content identified');
    assert(card.padding.top === 16 && card.padding.left === 16, 'padding derived from box geometry');
  });

  await test('card-uniformity — 3 structurally identical siblings yield byte-identical Facts', async () => {
    const ndg = await seedNdg(cardRowDoc(), 'g-card-row');
    const geo = detectComponentGeometry(ndg.graph, {});
    assert(geo.cardFacts.length === 3, `expected 3 card facts, got ${geo.cardFacts.length}`);
    const [c0, c1, c2] = geo.cardFacts.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
    assert(c0.shape === 'shell' && c1.shape === 'shell' && c2.shape === 'shell', 'all shell shape');
    const p0 = JSON.stringify(c0.padding);
    const p1 = JSON.stringify(c1.padding);
    const p2 = JSON.stringify(c2.padding);
    assert(p0 === p1 && p1 === p2, `padding must be byte-identical across siblings: ${p0} / ${p1} / ${p2}`);
    assert(geo.cardGridFacts.length === 1, 'one card-grid recognized for the row');
    assert(geo.cardGridFacts[0].orderedChildIds.length === 3, 'grid orders all 3 cards');
  });

  await test('normalizeUniformCardChrome — collapses deliberately-drifted padding onto ONE canonical descriptor', () => {
    const cards = [
      { nodeId: 'a', padding: { top: 24, left: 16, right: 16, bottom: 24 } },
      { nodeId: 'b', padding: { top: 25, left: 16, right: 16, bottom: 24 } }, // 1px drift
      { nodeId: 'c', padding: { top: 24, left: 16, right: 16, bottom: 24 } },
    ];
    const normalized = normalizeUniformCardChrome(cards);
    const keys = normalized.map((c) => JSON.stringify(c.padding));
    assert(keys[0] === keys[1] && keys[1] === keys[2], `expected all identical, got ${keys.join(' | ')}`);
    assert(keys[0] === JSON.stringify({ top: 24, left: 16, right: 16, bottom: 24 }), 'mode (2 votes) wins over the 1-vote outlier');
    assert(normalized[1].paddingNormalized === true, 'the drifted card is flagged as normalized');
    assert(normalized[0].paddingNormalized === false && normalized[2].paddingNormalized === false, 'already-canonical cards are not flagged');
  });

  await test('detectCardGridUniformity — pure function, rejects size variance outside tolerance', () => {
    const uniform = [
      { nodeId: 'a', box: { x: 0, y: 0, w: 200, h: 220 } },
      { nodeId: 'b', box: { x: 220, y: 0, w: 200, h: 220 } },
    ];
    const g = detectCardGridUniformity('p', uniform);
    assert(g && g.pattern === 'card-grid', 'uniform sizes accepted');

    const skewed = [
      { nodeId: 'a', box: { x: 0, y: 0, w: 200, h: 220 } },
      { nodeId: 'b', box: { x: 220, y: 0, w: 260, h: 220 } }, // 30% width span
    ];
    assert(detectCardGridUniformity('p', skewed) === null, 'excessive width variance rejected');
  });

  await test('detectCardGridUniformity — confirmed-bug fix: 3+ uniformly-sized cards stacked VERTICALLY are rejected, not misread as a horizontal grid (docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md Part 4.2.3)', () => {
    // Same width/height for every card (passes the existing w/h-variance
    // tolerance the function already had) but spread down the Y axis, not
    // across X — before this fix, detectCardGridUniformity had no
    // directional check at all and would have accepted this as a valid
    // card-grid, exactly the confirmed misclassification the research named.
    const stacked = [
      { nodeId: 'a', box: { x: 0, y: 0, w: 300, h: 120 } },
      { nodeId: 'b', box: { x: 0, y: 140, w: 300, h: 120 } },
      { nodeId: 'c', box: { x: 0, y: 280, w: 300, h: 120 } },
    ];
    assert(detectCardGridUniformity('p', stacked) === null, 'vertically-stacked uniform cards must NOT be reported as a card-grid');
  });

  await test('detectCardGridUniformity — a genuine horizontal row with small natural top-edge jitter (well within the 5% tolerance) still passes (no over-correction)', () => {
    const row = [
      { nodeId: 'a', box: { x: 0, y: 0, w: 200, h: 220 } },
      { nodeId: 'b', box: { x: 220, y: 2, w: 200, h: 220 } }, // 2px jitter, ~0.9% of height
      { nodeId: 'c', box: { x: 440, y: 0, w: 200, h: 220 } },
    ];
    const g = detectCardGridUniformity('p', row);
    assert(g && g.pattern === 'card-grid', 'small real-world top-edge jitter must not be rejected');
  });

  await test('END-TO-END confirmed-bug fix: detectComponentGeometry no longer reports a card-grid for 3 card-shaped elements stacked vertically', async () => {
    // Same per-card shape as mkCard()/cardRowDoc() above (chrome rect + text
    // wrap), but stacked down Y at a fixed X — structurally identical cards,
    // arranged the OTHER way. Before this fix, this real end-to-end path
    // (the level docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md Part 4.2.3
    // actually confirmed the bug at) would have produced a spurious
    // cardGridFacts entry with a nonsensical left-to-right order for
    // vertically-stacked content.
    // Exact same shape as mkCard() above (chrome rect + wrap FRAME containing
    // TWO text children) — deliberately not simplified, since a wrap with
    // only one child is itself eligible for NDG's own passthrough-collapse
    // (compiler/ndg/build.js Pass 3), which would change this fixture's
    // shape out from under the test in a way unrelated to what it means to
    // exercise.
    function mkCardAt(idPrefix, x, y) {
      return {
        id: idPrefix,
        type: 'FRAME',
        absoluteBoundingBox: { x, y, width: 200, height: 220 },
        children: [
          {
            id: `${idPrefix}-chrome`,
            type: 'RECTANGLE',
            fills: [{ type: 'SOLID' }],
            absoluteBoundingBox: { x, y, width: 200, height: 220 },
          },
          {
            id: `${idPrefix}-wrap`,
            type: 'FRAME',
            absoluteBoundingBox: { x: x + 16, y: y + 16, width: 168, height: 180 },
            children: [
              {
                id: `${idPrefix}-title`, type: 'TEXT', characters: 'Card title',
                absoluteBoundingBox: { x: x + 16, y: y + 16, width: 168, height: 24 },
              },
              {
                id: `${idPrefix}-body`, type: 'TEXT', characters: 'Card body copy',
                absoluteBoundingBox: { x: x + 16, y: y + 48, width: 168, height: 60 },
              },
            ],
          },
        ],
      };
    }
    const stackedDoc = {
      id: 'stack',
      type: 'GROUP',
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 700 },
      children: [
        mkCardAt('sa', 0, 0),
        mkCardAt('sb', 0, 240),
        mkCardAt('sc', 0, 480),
      ],
    };
    const ndg = await seedNdg(stackedDoc, 'g-card-stack');
    const geo = detectComponentGeometry(ndg.graph, {});
    assert(geo.cardFacts.length === 3, `expected 3 individual cards still recognized, got ${geo.cardFacts.length}`);
    assert(geo.cardGridFacts.length === 0, `expected NO card-grid for vertically-stacked cards, got ${geo.cardGridFacts.length}`);
  });

  // ─── (b) Banner shape ─────────────────────────────────────────────────────

  await test('detectBannerShape — pure function, dark wide shell + text content', () => {
    const parent = { id: 'banner', box: { x: 0, y: 0, width: 640, height: 160 } };
    const children = [
      { id: 'chrome', type: 'RECTANGLE', paints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }], box: { x: 0, y: 0, width: 640, height: 160 } },
      { id: 'quote', type: 'TEXT', box: { x: 32, y: 48, width: 400, height: 64 } },
    ];
    const banner = detectBannerShape(parent, children);
    assert(banner, 'banner detected');
    assert(banner.chromeId === 'chrome', 'chrome identified');
    assert(banner.contentIds.includes('quote'), 'quote content identified');
  });

  await test('detectBannerShape — rejects a light (non-dark) chrome fill', () => {
    const parent = { id: 'banner', box: { x: 0, y: 0, width: 640, height: 160 } };
    const children = [
      { id: 'chrome', type: 'RECTANGLE', paints: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }], box: { x: 0, y: 0, width: 640, height: 160 } },
      { id: 'quote', type: 'TEXT', box: { x: 32, y: 48, width: 400, height: 64 } },
    ];
    assert(detectBannerShape(parent, children) === null, 'light chrome is not a quote/CTA banner');
  });

  await test('detect — banner shape recognized end to end from NDG', async () => {
    const ndg = await seedNdg(bannerDoc(), 'g-banner');
    const geo = detectComponentGeometry(ndg.graph, {});
    assert(geo.bannerFacts.length === 1, `expected 1 banner fact, got ${geo.bannerFacts.length}`);
    assert(geo.bannerFacts[0].nodeId === idFor(ndg.graph, 'banner'), 'banner node identified');
    assert(geo.bannerFacts[0].contentIds.includes(idFor(ndg.graph, 'banner-quote')), 'quote content identified');
  });

  // ─── (c) Divider recognition ──────────────────────────────────────────────

  await test('assignDividerToColumns — pure function, hairline assigned to the boundary it sits at', () => {
    const columns = [
      [{ box: { x: 0, y: 0, w: 100, h: 40 } }],
      [{ box: { x: 140, y: 0, w: 100, h: 30 } }],
    ];
    const assignment = assignDividerToColumns({ x: 119, y: 10, w: 2, h: 100 }, columns, { x: 0, y: 0, w: 260, h: 130 });
    assert(assignment, 'divider assigned');
    assert(assignment.afterColumnIndex === 0, 'assigned after column 0');
  });

  await test('detect — divider recognized from a Phase 1 column-flex candidate', async () => {
    const ndg = await seedNdg(columnFlexWithDividerDoc(), 'g-divider');
    const graph = ndg.graph;
    const g = detectGeometry(graph, {});
    const colFlex = g.candidates.find((c) => c.pattern === 'column-flex');
    assert(colFlex, 'Phase 1 recognized the column-flex cluster');
    const geometryCandidatesByNode = { [colFlex.nodeId]: colFlex };

    const geo = detectComponentGeometry(graph, { geometryCandidatesByNode });
    assert(geo.dividerFacts.length === 1, `expected 1 divider fact, got ${geo.dividerFacts.length}`);
    assert(geo.dividerFacts[0].nodeId === idFor(graph, 'divider'), 'divider node identified');
    assert(geo.dividerFacts[0].afterColumnIndex === 0, 'assigned after column 0');
  });

  await test('detect — no Phase 1 candidate means no divider assignment (safe degrade, not a guess)', async () => {
    const ndg = await seedNdg(columnFlexWithDividerDoc(), 'g-divider-nogeo');
    const geo = detectComponentGeometry(ndg.graph, {}); // no geometryCandidatesByNode supplied
    assert(geo.dividerFacts.length === 0, 'no candidate → no divider assignment');
  });

  // ─── (d) END-TO-END — Facts reach Component IR / Semantic IR published output ──

  await test('END-TO-END: card Fact reaches Component IR published payload', async () => {
    const ndg = await seedNdg(cardRowDoc(), 'g-card-e2e');
    const out = projectComponentIR(ndg.graph, { sliceId: 'slice:component:g-card-e2e' });
    assert(Object.isFrozen(out.slice), 'frozen');
    assert(out.slice.payload.cardPatterns.length === 3, 'card patterns published');
    assert(out.slice.payload.cardGridPatterns.length === 1, 'card-grid pattern published');
    const paddings = out.slice.payload.cardPatterns.map((c) => JSON.stringify(c.padding));
    assert(paddings[0] === paddings[1] && paddings[1] === paddings[2], 'published padding byte-identical across siblings');
    assert(out.checksum === require('../components').componentIrChecksum(out.slice.payload), 'checksum matches published payload');
  });

  await test('END-TO-END: banner Fact reaches Component IR published payload', async () => {
    const ndg = await seedNdg(bannerDoc(), 'g-banner-e2e');
    const out = projectComponentIR(ndg.graph, { sliceId: 'slice:component:g-banner-e2e' });
    assert(out.slice.payload.bannerPatterns.length === 1, 'banner pattern published');
    assert(out.slice.payload.bannerPatterns[0].nodeId === idFor(ndg.graph, 'banner'), 'banner node id published');
  });

  await test('END-TO-END: divider Fact reaches Component IR published payload', async () => {
    const ndg = await seedNdg(columnFlexWithDividerDoc(), 'g-divider-e2e');
    const g = detectGeometry(ndg.graph, {});
    const colFlex = g.candidates.find((c) => c.pattern === 'column-flex');
    const out = projectComponentIR(ndg.graph, {
      sliceId: 'slice:component:g-divider-e2e',
      detected: detectComponents(ndg.graph, { geometryCandidatesByNode: { [colFlex.nodeId]: colFlex } }),
    });
    assert(out.slice.payload.dividerPatterns.length === 1, 'divider pattern published');
    assert(out.slice.payload.dividerPatterns[0].nodeId === idFor(ndg.graph, 'divider'), 'divider node id published');
  });

  await test('END-TO-END: recognized banner shape reaches Semantic IR as a banner role annotation', async () => {
    const ndg = await seedNdg(bannerDoc(), 'g-banner-semantic');
    const out = projectSemanticIR(ndg.graph, { sliceId: 'slice:semantic:g-banner-semantic' });
    const ann = out.slice.payload.annotations.find((a) => a.nodeId === idFor(ndg.graph, 'banner'));
    assert(ann, 'banner node got a semantic annotation');
    assert(ann.role === ROLE.BANNER, `expected banner role, got ${ann.role}`);
  });

  await test('END-TO-END: recognized divider shape reaches Semantic IR as a separator role annotation', async () => {
    const ndg = await seedNdg(columnFlexWithDividerDoc(), 'g-divider-semantic');
    const g = detectGeometry(ndg.graph, {});
    const colFlex = g.candidates.find((c) => c.pattern === 'column-flex');
    const detected = detectSemantics(ndg.graph, { geometryCandidatesByNode: { [colFlex.nodeId]: colFlex } });
    const ann = detected.annotations.find((a) => a.nodeId === idFor(ndg.graph, 'divider'));
    assert(ann, 'divider node got a semantic annotation');
    assert(ann.role === ROLE.SEPARATOR, `expected separator role, got ${ann.role}`);
  });

  // ─── (e) Row-set (repeating-pattern / table) recognition ─────────────────

  await test('detectRowSetUniformity — pure function, rejects size variance outside tolerance (negative case)', () => {
    const uniform = [
      { nodeId: 'r0', box: { x: 0, y: 0, w: 1000, h: 160 } },
      { nodeId: 'r1', box: { x: 0, y: 160, w: 1000, h: 160 } },
      { nodeId: 'r2', box: { x: 0, y: 320, w: 1000, h: 160 } },
    ];
    const g = detectRowSetUniformity('p', uniform);
    assert(g && g.pattern === 'row-set', 'uniform vertically-stacked rows accepted');

    const skewed = [
      { nodeId: 'r0', box: { x: 0, y: 0, w: 1000, h: 60 } },
      { nodeId: 'r1', box: { x: 0, y: 60, w: 1000, h: 400 } },
      { nodeId: 'r2', box: { x: 0, y: 460, w: 1000, h: 900 } },
    ];
    assert(detectRowSetUniformity('p', skewed) === null, 'wildly different heights (no majority cluster) rejected');

    const sideBySide = [
      { nodeId: 'c0', box: { x: 0, y: 0, w: 200, h: 220 } },
      { nodeId: 'c1', box: { x: 220, y: 0, w: 200, h: 220 } },
      { nodeId: 'c2', box: { x: 440, y: 0, w: 200, h: 220 } },
    ];
    assert(detectRowSetUniformity('p', sideBySide) === null, 'horizontally-arranged (unaligned x) siblings are not a row-set — that is card-grid\'s case');
  });

  await test('detectRowSetUniformity — a minority outlier (e.g. a table header) does not poison recognition of the majority uniform rows', () => {
    const rows = [
      { nodeId: 'header', box: { x: 0, y: 0, w: 1000, h: 30 } }, // very different height
      { nodeId: 'row0', box: { x: 0, y: 40, w: 1000, h: 160 } },
      { nodeId: 'row1', box: { x: 0, y: 200, w: 1000, h: 160 } },
      { nodeId: 'row2', box: { x: 0, y: 360, w: 1000, h: 160 } },
      { nodeId: 'row3', box: { x: 0, y: 520, w: 1000, h: 160 } },
    ];
    const g = detectRowSetUniformity('table', rows);
    assert(g, 'row-set recognized despite the header outlier');
    assert(g.orderedChildIds.length === 4, `expected 4 rows (header excluded), got ${g.orderedChildIds.length}`);
    assert(!g.orderedChildIds.includes('header'), 'header itself must not be counted as a row');
  });

  await test('row-set — synthetic 4-row vertical stack recognized end to end from NDG, with computed column boundaries', async () => {
    const ndg = await seedNdg(rowSetTableDoc(), 'g-row-set');
    const geo = detectComponentGeometry(ndg.graph, {});
    const tableId = idFor(ndg.graph, 'table');
    const rowSet = geo.rowSetFacts.find((r) => r.nodeId === tableId);
    assert(rowSet, 'row-set recognized for the table parent');
    assert(rowSet.orderedChildIds.length === 4, `expected 4 rows, got ${rowSet.orderedChildIds.length}`);
    assert(!rowSet.orderedChildIds.includes(idFor(ndg.graph, 'table-header')), 'header sibling excluded from the row-set');

    // Column boundaries: id / title / reward / xp / button — 5 columns, each
    // with all 4 rows contributing exactly one member (purely geometric
    // x-clustering, same shape the real Challenge Arena fixture produces).
    assert(rowSet.columns.length === 5, `expected 5 columns, got ${rowSet.columns.length}`);
    for (const col of rowSet.columns) {
      assert(col.rowCount === 4, `every column must have one member per row, got rowCount=${col.rowCount} for x=${col.x}`);
    }
    const xs = rowSet.columns.map((c) => c.x);
    assert(xs[0] === 20 && xs[1] === 100 && xs[2] === 500 && xs[3] === 700 && xs[4] === 860,
      `expected canonical column x-offsets [20,100,500,700,860], got ${JSON.stringify(xs)}`);
  });

  await test('row-set columns — byte-identical column Facts across structurally identical rows', async () => {
    const ndg = await seedNdg(rowSetTableDoc(), 'g-row-set-identical');
    const geo = detectComponentGeometry(ndg.graph, {});
    const tableId = idFor(ndg.graph, 'table');
    const rowSet = geo.rowSetFacts.find((r) => r.nodeId === tableId);
    assert(rowSet, 'row-set recognized');
    // Re-run column computation directly against each row's own candidates in
    // isolation (perRowColumns derived the same way detectComponentGeometry
    // does) — every row must yield the SAME shape of per-row column list
    // (same x-offsets, same widths), proving no per-row drift crept in.
    const { byId, childrenOf: childRefsOf } = require('../layout/collect').indexGraph(ndg.graph);
    const childrenOf = new Map();
    for (const [pid, refs] of childRefsOf) childrenOf.set(pid, refs.map((r) => byId.get(r.id)).filter(Boolean));
    const { rowColumnCandidates, boxOf } = require('../rulepack/packs/component-detect/geometry-rules');
    const perRow = rowSet.orderedChildIds.map((rowId) => rowColumnCandidates(
      boxOf(byId.get(rowId)),
      childrenOf.get(rowId) || [],
      (id) => childrenOf.get(id) || [],
    ).map((c) => c.box.x - boxOf(byId.get(rowId)).x).sort((a, b) => a - b));
    const key0 = JSON.stringify(perRow[0]);
    for (const p of perRow) {
      assert(JSON.stringify(p) === key0, `expected byte-identical relative column offsets across rows, got ${JSON.stringify(perRow)}`);
    }
    // And the published columns themselves must be identical in shape
    // (same count, same rowCount=4) regardless of which row happened to be
    // ordered first/last.
    const shapes = rowSet.columns.map((c) => JSON.stringify({ rowCount: c.rowCount }));
    assert(shapes.every((s) => s === shapes[0]), 'every column has the same rowCount across the uniform row-set');
  });

  await test('END-TO-END: row-set Fact reaches Component IR published payload', async () => {
    const ndg = await seedNdg(rowSetTableDoc(), 'g-row-set-e2e');
    const out = projectComponentIR(ndg.graph, { sliceId: 'slice:component:g-row-set-e2e' });
    assert(Object.isFrozen(out.slice), 'frozen');
    assert(out.slice.payload.rowSetPatterns.length === 1, 'row-set pattern published');
    const published = out.slice.payload.rowSetPatterns[0];
    assert(published.nodeId === idFor(ndg.graph, 'table'), 'table node id published');
    assert(published.orderedChildIds.length === 4, 'all 4 rows published');
    assert(published.columns.length === 5, 'all 5 columns published');
    assert(out.checksum === require('../components').componentIrChecksum(out.slice.payload), 'checksum matches published payload');
  });

  await test('deterministic + idempotent — same card-row graph, same Component IR checksum twice', async () => {
    const ndg1 = await seedNdg(cardRowDoc(), 'g-det-a');
    const out1 = projectComponentIR(ndg1.graph, { sliceId: 'slice:component:g-det-a' });
    const ndg2 = await seedNdg(cardRowDoc(), 'g-det-a');
    const out2 = projectComponentIR(ndg2.graph, { sliceId: 'slice:component:g-det-a' });
    assert(out1.checksum === out2.checksum, 'checksum stable across independent runs');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
