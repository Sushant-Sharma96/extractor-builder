'use strict';

/**
 * freeform-layout-ir tests.
 *
 * Mirrors the PASS/FAIL harness pattern used by compiler/test/geometry.test.js
 * and compiler/test/component-geometry.test.js. Covers:
 *   (a) determineGroupAxis — pure, axis-agnostic, both orientations.
 *   (b) chrome/content separation (resolveMemberContent excludes a chrome bg).
 *   (c) wrapper unwrap — synthetic asymmetric-member case mirroring the real
 *       Challenge Arena row-1-vs-row-2 shape (one member has a single wide
 *       wrapper bundling everything, another has the same wrapper minus one
 *       column pulled out as a sibling).
 *   (d) union-of-columns with an explicit-null case (a member genuinely
 *       missing one column).
 *   (e) END-TO-END: a RepeatingGroupMembership fact reaches a published
 *       freeform-layout-ir IrSlice via collect -> detect -> project ->
 *       publish -> materialize.
 */

const {
  determineGroupAxis,
  resolveMemberContent,
  unwrapChild,
  clusterByPosition,
  detectFreeformLayout,
  projectFreeformLayoutIR,
  materializeFreeformLayoutIR,
  freeformLayoutIrChecksum,
  STAGE_ID,
} = require('../freeform-layout');
const { detectComponents } = require('../components');
const { materializeNormalizedDesignGraph } = require('../ndg');
const { createWorkspace } = require('../workspace');
const { indexGraph } = require('../layout/collect');

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
  const ndg = await materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    document,
    graphId,
  });
  return { ws, graph: ndg.graph };
}

function idFor(graph, sourceNodeId) {
  const n = (graph.nodes || []).find((x) => x.sourceNodeId === sourceNodeId);
  return n ? n.id : null;
}

/** 3 cards side by side (Articles' real shape): uniform height, no chrome,
 *  4 internal regions (image/badge/title/footer) at fixed relative-y. */
function mkArticleCard(idPrefix, x) {
  return {
    id: idPrefix,
    type: 'GROUP',
    absoluteBoundingBox: { x, y: 0, width: 380, height: 413 },
    children: [
      { id: `${idPrefix}-image`, type: 'RECTANGLE', absoluteBoundingBox: { x, y: 0, width: 380, height: 231 } },
      {
        id: `${idPrefix}-badge`,
        type: 'FRAME',
        absoluteBoundingBox: { x: x + 20, y: 20, width: 100, height: 24 },
        children: [{ id: `${idPrefix}-badge-t`, type: 'TEXT', characters: 'Badge', absoluteBoundingBox: { x: x + 24, y: 22, width: 92, height: 13 } }],
      },
      {
        id: `${idPrefix}-title`,
        type: 'GROUP',
        absoluteBoundingBox: { x, y: 261, width: 380, height: 88 },
        children: [{ id: `${idPrefix}-title-t`, type: 'TEXT', characters: 'Title', absoluteBoundingBox: { x, y: 261, width: 380, height: 61 } }],
      },
      {
        id: `${idPrefix}-footer`,
        type: 'GROUP',
        absoluteBoundingBox: { x, y: 362, width: 380, height: 51 },
        children: [{ id: `${idPrefix}-footer-t`, type: 'TEXT', characters: 'July 12, 2026', absoluteBoundingBox: { x, y: 388, width: 100, height: 18 } }],
      },
    ],
  };
}

function cardRowDoc() {
  return {
    id: 'cards',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 1140, height: 413 },
    children: [
      mkArticleCard('c0', 0),
      mkArticleCard('c1', 380),
      mkArticleCard('c2', 760),
    ],
  };
}

/** 3 cards side by side (axis:"row"), each with 2 internal content items —
 *  icon + title — uniformly inset 40px from the CARD's own left edge
 *  (Incentives' real shape: every card insets its icon/title/description the
 *  same 40px; verified directly against the cached Figma JSON). Unlike
 *  mkArticleCard (badge inset 20px, but image/title/footer flush at 0 —
 *  crossInset's min() would report 0, not exercising this fix), every content
 *  item here shares the SAME non-zero inset, so a real regression (crossInset
 *  silently back to 0) is actually caught. */
function mkInsetCard(idPrefix, x) {
  return {
    id: idPrefix,
    type: 'GROUP',
    absoluteBoundingBox: { x, y: 0, width: 380, height: 358 },
    children: [
      {
        id: `${idPrefix}-icon`,
        type: 'FRAME',
        absoluteBoundingBox: { x: x + 40, y: 44, width: 50, height: 50 },
        children: [{ id: `${idPrefix}-icon-t`, type: 'TEXT', characters: 'I', absoluteBoundingBox: { x: x + 40, y: 44, width: 50, height: 50 } }],
      },
      {
        id: `${idPrefix}-title`,
        type: 'GROUP',
        absoluteBoundingBox: { x: x + 40, y: 132, width: 280, height: 36 },
        children: [{ id: `${idPrefix}-title-t`, type: 'TEXT', characters: 'Title', absoluteBoundingBox: { x: x + 40, y: 132, width: 280, height: 36 } }],
      },
    ],
  };
}

/** Mirrors the real "Blogs" card shape (Figma node 84:7): a full-bleed photo
 *  (flush with the card's own left edge, 0 inset) stacked above a title text
 *  that IS genuinely inset (16px) — the exact mixed-inset shape a single
 *  group-level crossInset can't express (see this test file's own
 *  "crossInset is PER COLUMN" test). */
function mkMixedInsetCard(idPrefix, x) {
  return {
    id: idPrefix,
    type: 'GROUP',
    absoluteBoundingBox: { x, y: 0, width: 200, height: 300 },
    children: [
      {
        id: `${idPrefix}-photo`,
        type: 'RECTANGLE',
        fills: [{ type: 'SOLID' }],
        absoluteBoundingBox: { x, y: 0, width: 200, height: 200 },
      },
      {
        id: `${idPrefix}-title`,
        type: 'GROUP',
        absoluteBoundingBox: { x: x + 16, y: 220, width: 140, height: 24 },
        children: [{ id: `${idPrefix}-title-t`, type: 'TEXT', characters: 'Title', absoluteBoundingBox: { x: x + 16, y: 220, width: 140, height: 24 } }],
      },
    ],
  };
}

function mixedInsetCardRowDoc() {
  return {
    id: 'mixed-cards',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 700, height: 300 },
    children: [
      mkMixedInsetCard('mc0', 0),
      mkMixedInsetCard('mc1', 250),
      mkMixedInsetCard('mc2', 500),
    ],
  };
}

function insetCardRowDoc() {
  return {
    id: 'inset-cards',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 1140, height: 358 },
    children: [
      mkInsetCard('ic0', 0),
      mkInsetCard('ic1', 380),
      mkInsetCard('ic2', 760),
    ],
  };
}

/** 4 rows stacked (Challenge Arena's real shape), row 1 asymmetric: a
 *  single 95%-wide wrapper bundles ALL 5 columns (including the button);
 *  rows 2-4 pull the button out as its own direct child, alongside an
 *  84%-wide wrapper bundling only the other 4 columns. Every row also has a
 *  full-bleed chrome rectangle as its first child. Every column/button node
 *  carries a TEXT leaf child (mirroring the real fixture's structure) so
 *  compiler/ndg's materialization does not prune it as an empty/redundant
 *  container — an NDG behavior confirmed by direct inspection while
 *  building this fixture: a childless GROUP/FRAME is pruned entirely, and a
 *  single-child GROUP/FRAME is collapsed (its child promoted up, own box
 *  discarded) — real Challenge Arena column groups always carry TEXT
 *  content for exactly this reason. */
function mkRow(idPrefix, y, buttonSeparate) {
  const rowW = 1196;
  const cols = [
    { id: `${idPrefix}-c0`, x: 142, w: 40 },
    { id: `${idPrefix}-c1`, x: 231, w: 424 },
    { id: `${idPrefix}-c2`, x: 761, w: 212 },
    { id: `${idPrefix}-c3`, x: 1039, w: 87 },
  ];
  const button = { id: `${idPrefix}-button`, x: 1164, w: 123 };
  const chrome = {
    id: `${idPrefix}-chrome`,
    type: 'RECTANGLE',
    fills: [{ type: 'SOLID' }],
    absoluteBoundingBox: { x: 121, y, width: rowW, height: 177 },
  };
  const colNodes = (list) => list.map((c) => ({
    id: c.id,
    type: 'GROUP',
    absoluteBoundingBox: { x: c.x, y: y + 48, width: c.w, height: 80 },
    children: [{ id: `${c.id}-t`, type: 'TEXT', characters: c.id, absoluteBoundingBox: { x: c.x, y: y + 48, width: c.w, height: 20 } }],
  }));
  const buttonNode = () => ({
    id: `${idPrefix}-button`,
    type: 'FRAME',
    fills: [{ type: 'SOLID' }],
    absoluteBoundingBox: { x: button.x, y: y + 40, width: button.w, height: 38 },
    children: [{ id: `${idPrefix}-button-t`, type: 'TEXT', characters: 'Register Now', absoluteBoundingBox: { x: button.x + 10, y: y + 46, width: button.w - 20, height: 18 } }],
  });
  if (buttonSeparate) {
    const wrapper = {
      id: `${idPrefix}-wrap`,
      type: 'GROUP',
      // spans cols[0..3] — 84% of row width, perpendicular-to-axis (column
      // axis) dimension is width, per unwrapChild's spanDim(axis='column').
      absoluteBoundingBox: { x: 142, y: y + 48, width: 984, height: 80 },
      children: colNodes(cols),
    };
    return {
      id: idPrefix,
      type: 'GROUP',
      absoluteBoundingBox: { x: 121, y, width: rowW, height: 177 },
      children: [chrome, wrapper, buttonNode()],
    };
  }
  const allWrapper = {
    id: `${idPrefix}-wrap`,
    type: 'GROUP',
    // spans all 5 columns — ~96% of row width.
    absoluteBoundingBox: { x: 142, y: y + 48, width: 1145, height: 80 },
    children: [...colNodes(cols), buttonNode()],
  };
  return {
    id: idPrefix,
    type: 'GROUP',
    absoluteBoundingBox: { x: 121, y, width: rowW, height: 177 },
    children: [chrome, allWrapper],
  };
}

function rowSetTableDoc() {
  return {
    id: 'table',
    type: 'GROUP',
    absoluteBoundingBox: { x: 121, y: 0, width: 1196, height: 4 * 177 },
    children: [
      mkRow('row0', 0, false), // asymmetric — single wrapper bundling all 5
      mkRow('row1', 177, true),
      mkRow('row2', 354, true),
      mkRow('row3', 531, true),
    ],
  };
}

async function main() {
  // ─── (a) determineGroupAxis — pure, data-driven, both orientations ───────

  await test('determineGroupAxis — uniform height + x-spread + top-aligned => axis=row', () => {
    const items = [
      { nodeId: 'a', box: { x: 0, y: 0, w: 200, h: 220 } },
      { nodeId: 'b', box: { x: 220, y: 0, w: 200, h: 220 } },
    ];
    const result = determineGroupAxis('p', items);
    assert(result && result.axis === 'row', `expected axis=row, got ${JSON.stringify(result)}`);
    assert(result.orderedIds.length === 2, 'both items ordered');
  });

  await test('determineGroupAxis — uniform width + y-spread + left-aligned => axis=column', () => {
    const items = [
      { nodeId: 'r0', box: { x: 0, y: 0, w: 1000, h: 160 } },
      { nodeId: 'r1', box: { x: 0, y: 160, w: 1000, h: 160 } },
      { nodeId: 'r2', box: { x: 0, y: 320, w: 1000, h: 160 } },
    ];
    const result = determineGroupAxis('p', items);
    assert(result && result.axis === 'column', `expected axis=column, got ${JSON.stringify(result)}`);
    assert(result.orderedIds.length === 3, 'all 3 rows ordered');
  });

  await test('determineGroupAxis — a minority outlier does not block axis recognition of the majority cluster', () => {
    const items = [
      { nodeId: 'header', box: { x: 0, y: 0, w: 1000, h: 30 } },
      { nodeId: 'row0', box: { x: 0, y: 40, w: 1000, h: 160 } },
      { nodeId: 'row1', box: { x: 0, y: 200, w: 1000, h: 160 } },
      { nodeId: 'row2', box: { x: 0, y: 360, w: 1000, h: 160 } },
    ];
    const result = determineGroupAxis('p', items);
    assert(result && result.axis === 'column', 'header outlier excluded, column axis recognized');
    assert(!result.orderedIds.includes('header'), 'header itself excluded from the group');
  });

  await test('determineGroupAxis — fewer than 2 items => no group', () => {
    assert(determineGroupAxis('p', [{ nodeId: 'a', box: { x: 0, y: 0, w: 100, h: 100 } }]) === null, 'single item rejected');
    assert(determineGroupAxis('p', []) === null, 'empty rejected');
  });

  // ─── (b) chrome/content separation ────────────────────────────────────────

  await test('resolveMemberContent — excludes a full-bleed chrome background', async () => {
    const { ws, graph } = await seedNdg(mkRow('rowchrome', 0, true), 'g-chrome');
    const index = indexGraph(graph);
    const childrenOf = new Map();
    for (const [pid, refs] of index.childrenOf) childrenOf.set(pid, refs.map((r) => index.byId.get(r.id)).filter(Boolean));
    const childrenOfFn = (id) => childrenOf.get(id) || [];
    const rowId = idFor(graph, 'rowchrome');
    const rowNode = index.byId.get(rowId);
    const { boxOf } = require('../rulepack/packs/component-detect/geometry-rules');
    const content = resolveMemberContent(rowNode, boxOf(rowNode), 'column', childrenOfFn);
    const chromeId = idFor(graph, 'rowchrome-chrome');
    assert(!content.some((c) => c.node.id === chromeId), 'chrome rectangle excluded from real content');
    assert(content.length >= 4, `expected the wrapper unwrapped into >=4 columns + button, got ${content.length}`);
  });

  // ─── (c) wrapper unwrap — the row-1-vs-row-2 asymmetry, synthetically ────

  await test('unwrapChild — a wide multi-child wrapper bundling real content (text/image grandkids) is replaced by its own children', () => {
    const memberBox = { x: 121, y: 0, w: 1196, h: 177 };
    const wrapper = { node: { id: 'wrap' }, box: { x: 142, y: 48, w: 984, h: 80 } };
    const grandkids = [
      { id: 'g0', type: 'TEXT', box: { x: 142, y: 48, width: 40, height: 80 } },
      { id: 'g1', type: 'TEXT', box: { x: 231, y: 48, width: 424, height: 80 } },
    ];
    const childrenOfFn = (id) => (id === 'wrap' ? grandkids : []);
    const out = unwrapChild(wrapper, memberBox, 'column', childrenOfFn, 0);
    assert(out.length === 2, `expected wrapper unwrapped into 2 children, got ${out.length}`);
    assert(out.every((o) => o.node.id !== 'wrap'), 'wrapper itself replaced, not kept');
  });

  await test('unwrapChild — a narrow child (e.g. the action button) is left alone, not unwrapped', () => {
    const memberBox = { x: 121, y: 0, w: 1196, h: 177 };
    const button = { node: { id: 'button' }, box: { x: 1164, y: 40, w: 123, h: 38 } };
    const childrenOfFn = () => [{ id: 'button-text', type: 'TEXT', box: { x: 1174, y: 46, width: 103, height: 18 } }];
    const out = unwrapChild(button, memberBox, 'column', childrenOfFn, 0);
    assert(out.length === 1 && out[0].node.id === 'button', 'narrow child kept as-is');
  });

  await test('unwrapChild — a wide multi-child wrapper whose grandkids are ALL plain decorative shapes (no text, no image fill) is NOT unwrapped (real, confirmed bug: Figma file eOwzPCQP0f3sAxzI0T0b9d, "Group 357" — a small icon glyph made of 4 identical 10x10 rectangles, wrapper spanning ~95% of its 22px-tall parent, was being unwrapped exactly like a genuine multi-column content wrapper; one of its 4 rectangles then got pulled in as "resolved column content" while its 3 siblings did not, losing its normal absolute position and rendering as an invisible box, breaking the icon)', () => {
    const memberBox = { x: 0, y: 0, w: 93, h: 22 };
    const iconWrapper = { node: { id: 'icon-wrap' }, box: { x: 0, y: 0, w: 21, h: 21 } };
    const decorativeGrandkids = [
      { id: 'sq0', type: 'RECTANGLE', box: { x: 0, y: 0, width: 10, height: 10 } },
      { id: 'sq1', type: 'RECTANGLE', box: { x: 11, y: 0, width: 10, height: 10 } },
      { id: 'sq2', type: 'RECTANGLE', box: { x: 0, y: 11, width: 10, height: 10 } },
      { id: 'sq3', type: 'RECTANGLE', box: { x: 11, y: 11, width: 10, height: 10 } },
    ];
    const childrenOfFn = (id) => (id === 'icon-wrap' ? decorativeGrandkids : []);
    const out = unwrapChild(iconWrapper, memberBox, 'row', childrenOfFn, 0);
    assert(out.length === 1 && out[0].node.id === 'icon-wrap', `expected the icon wrapper kept intact (not unwrapped into its 4 decorative squares), got ${out.length} item(s)`);
  });

  await test('unwrapChild — a wide multi-child wrapper with a MIX of decorative shapes and one real image grandkid IS unwrapped (any real content signal is enough, even if most siblings are decorative)', () => {
    const memberBox = { x: 0, y: 0, w: 93, h: 22 };
    const wrapper = { node: { id: 'mixed-wrap' }, box: { x: 0, y: 0, w: 21, h: 21 } };
    const mixedGrandkids = [
      { id: 'sq0', type: 'RECTANGLE', box: { x: 0, y: 0, width: 10, height: 10 } },
      { id: 'photo', type: 'RECTANGLE', paints: [{ type: 'IMAGE' }], box: { x: 11, y: 0, width: 10, height: 10 } },
    ];
    const childrenOfFn = (id) => (id === 'mixed-wrap' ? mixedGrandkids : []);
    const out = unwrapChild(wrapper, memberBox, 'row', childrenOfFn, 0);
    assert(out.length === 2, `expected the wrapper unwrapped into its 2 grandkids, got ${out.length}`);
  });

  await test('row-set asymmetry — row 1 (single all-in-one wrapper) and rows 2-4 (wrapper + separate button) close onto the SAME 5-column shape', async () => {
    const { graph } = await seedNdg(rowSetTableDoc(), 'g-asymmetry');
    const componentDetected = detectComponents(graph, {});
    const detected = detectFreeformLayout(graph, { componentDetected });
    const tableId = idFor(graph, 'table');
    const group = detected.groups.find((g) => g.containerNodeId === tableId);
    assert(group, 'row-set group recognized for the table');
    assert(group.axis === 'column', 'axis=column');
    assert(group.memberCount === 4, `expected 4 members, got ${group.memberCount}`);
    assert(group.columns.length === 5, `expected 5 canonical columns (union across all members), got ${group.columns.length}`);

    const row0Id = idFor(graph, 'row0'); // the asymmetric one (single wrapper, all 5 bundled)
    const row0Member = group.members.find((m) => m.nodeId === row0Id);
    assert(row0Member, 'row0 (asymmetric) is a member');
    const row0Nulls = Object.values(row0Member.memberColumnMap).filter((v) => v === null).length;
    assert(row0Nulls === 0, `expected row0's asymmetric wrapper to close onto all 5 columns with no nulls, got ${row0Nulls} nulls`);

    for (const idPrefix of ['row1', 'row2', 'row3']) {
      const rid = idFor(graph, idPrefix);
      const m = group.members.find((mm) => mm.nodeId === rid);
      assert(m, `${idPrefix} is a member`);
      const nulls = Object.values(m.memberColumnMap).filter((v) => v === null).length;
      assert(nulls === 0, `expected ${idPrefix} to map onto all 5 columns with no nulls, got ${nulls}`);
    }
  });

  await test('detectFreeformLayout — each column\'s OWN crossInset recovers the real cross-axis content inset (real bug: Incentives\' cards render their icon/title/description flush-left instead of 40px in, because positionOf() only ever clustered the OTHER axis) — every column happens to share 40px here (this fixture\'s cards are uniformly inset)', async () => {
    const { graph } = await seedNdg(insetCardRowDoc(), 'g-crossinset');
    const componentDetected = detectComponents(graph, {});
    const detected = detectFreeformLayout(graph, { componentDetected });
    const containerId = idFor(graph, 'inset-cards');
    const group = detected.groups.find((g) => g.containerNodeId === containerId);
    assert(group, 'group recognized for inset-cards container');
    assert(group.axis === 'row', `expected axis "row" (members spread along X), got ${group.axis}`);
    assert(group.columns.length >= 1, 'at least one column recognized');
    for (const col of group.columns) {
      assert(col.crossInset === 40, `expected every column's own crossInset=40 (every card's real content inset), got ${col.crossInset} for ${col.columnId}`);
    }
  });

  await test('detectFreeformLayout — crossInset is PER COLUMN, not group-uniform: a member mixing a full-bleed column (0 inset) with a genuinely inset column keeps each column\'s own correct value, instead of the old group-level min() collapsing everything to the full-bleed column\'s 0 (real bug: Figma file fYKUEGHAxVkJwn8CwvJCsp node 84:7, "Blogs" card 1 — the photo sits flush at 0, but its date/title/avatar rows sit ~16px in)', async () => {
    const { graph } = await seedNdg(mixedInsetCardRowDoc(), 'g-mixed-crossinset');
    const componentDetected = detectComponents(graph, {});
    const detected = detectFreeformLayout(graph, { componentDetected });
    const containerId = idFor(graph, 'mixed-cards');
    const group = detected.groups.find((g) => g.containerNodeId === containerId);
    assert(group, 'group recognized for mixed-cards container');
    // axis:'row' members cluster their OWN internal content along the
    // PERPENDICULAR (Y) dimension — so column "order" 0/1 here means
    // topmost/next Y-band (the photo, then the title below it), not X
    // position; "width" on a row-axis column is the band's Y-extent
    // (height), not horizontal width — hence selecting by order, not width.
    assert(group.columns.length === 2, `expected 2 Y-band columns (photo, title), got ${group.columns.length}`);
    const photoCol = group.columns.find((c) => c.order === 0);
    const titleCol = group.columns.find((c) => c.order === 1);
    assert(photoCol.crossInset === 0, `expected the full-bleed photo column's own crossInset=0, got ${photoCol.crossInset}`);
    assert(titleCol.crossInset === 16, `expected the inset title column's own crossInset=16, got ${titleCol.crossInset}`);
  });

  // ─── (d) union-of-columns with an explicit null ──────────────────────────

  await test('clusterByPosition — union across members, explicit null for a member genuinely missing a column', () => {
    const tagged = [
      { memberIndex: 0, nodeId: 'm0-a', pos: 0, size: 40 },
      { memberIndex: 0, nodeId: 'm0-b', pos: 200, size: 100 },
      { memberIndex: 1, nodeId: 'm1-a', pos: 0, size: 40 },
      // member 1 genuinely has no node near pos=200 — must not silently
      // borrow member 0's node or be dropped from the group.
      { memberIndex: 1, nodeId: 'm1-c', pos: 500, size: 60 },
    ];
    const clusters = clusterByPosition(tagged, 24);
    assert(clusters.length === 3, `expected 3 canonical columns (union), got ${clusters.length}`);
    const byPos = (p) => clusters.find((c) => c.pos === p);
    assert(byPos(0).membersByIndex.get(0) === 'm0-a' && byPos(0).membersByIndex.get(1) === 'm1-a', 'column at pos=0 has both members');
    assert(byPos(200).membersByIndex.get(0) === 'm0-b', 'column at pos=200 has member 0');
    assert(!byPos(200).membersByIndex.has(1), 'member 1 is genuinely absent from the pos=200 column (explicit gap, not silently dropped)');
    assert(byPos(500).membersByIndex.get(1) === 'm1-c', 'column at pos=500 has member 1 only');
  });

  // ─── (e) END-TO-END — Fact reaches a published freeform-layout-ir IrSlice ─

  await test('END-TO-END: card-grid RepeatingGroupMembership Fact reaches a projected freeform-layout-ir slice', async () => {
    const { graph } = await seedNdg(cardRowDoc(), 'g-e2e-cards');
    const componentDetected = detectComponents(graph, {});
    const out = projectFreeformLayoutIR(graph, {
      componentDetected,
      sliceId: 'slice:freeform-layout:g-e2e-cards',
    });
    assert(out.slice.stageId === STAGE_ID, 'stage id');
    assert(Object.isFrozen(out.slice), 'frozen');
    const cardsParentId = idFor(graph, 'cards');
    const group = out.slice.payload.groups.find((g) => g.containerNodeId === cardsParentId);
    assert(group, 'card group published');
    assert(group.axis === 'row', 'axis=row published');
    assert(group.memberCount === 3, 'memberCount=3 published');
    // 3 regions, not 4: the badge sits at relative-y +20-22 from the card
    // top, within the 24px column-clustering tolerance of the image at
    // relative-y 0 (it visually overlaps the image in the real fixture too
    // — a badge chip painted on top of a thumbnail), so image+badge cluster
    // into ONE column alongside title/footer. Confirmed against the REAL
    // Articles fixture via scripts/validate-freeform-layout-ir.js (reports
    // columns=3 for the same 3-card group), not just this synthetic mirror.
    assert(group.columns.length === 3, `expected 3 internal regions (image+badge merged, title, footer), got ${group.columns.length}`);
    assert(out.checksum === freeformLayoutIrChecksum(out.slice.payload), 'checksum matches published payload');
  });

  await test('END-TO-END: materializeFreeformLayoutIR publishes an IrSlice + Fact into the workspace', async () => {
    const { ws, graph } = await seedNdg(rowSetTableDoc(), 'g-e2e-materialize');
    const componentDetected = detectComponents(graph, {});
    const result = await materializeFreeformLayoutIR({
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      componentDetected,
      sliceId: 'slice:freeform-layout:g-e2e-materialize',
    });
    const slice = ws.getIrSlice('slice:freeform-layout:g-e2e-materialize');
    assert(slice, 'IrSlice persisted in workspace');
    assert(slice.stageId === STAGE_ID, 'stage id on persisted slice');
    const fact = ws.listIds('Fact').map((id) => ws.getFact(id)).find((f) => f.kind === 'freeform-layout.ir');
    assert(fact, 'freeform-layout.ir Fact persisted in workspace');
    assert(fact.assertion.checksum === result.checksum, 'Fact checksum matches materialize() result');
    const tableId = idFor(graph, 'table');
    const group = slice.payload.groups.find((g) => g.containerNodeId === tableId);
    assert(group && group.memberCount === 4, 'table row-set group reached the published workspace slice');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
