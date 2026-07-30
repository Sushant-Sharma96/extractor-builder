'use strict';

/**
 * Design Skeleton v0 tests — docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md
 * Part 3. Covers every base-role classification branch, both reading-order
 * rules, provenance, repeating-group wrapping, and a real cached Figma
 * fixture end-to-end sanity check.
 *
 * Fixture note: every test's OUTER wrapping frame is given its own solid
 * fill specifically so compiler/ndg/build.js's Pass 2/3 (empty-leaf-drop /
 * passthrough-collapse) never removes it — a paintless single-child FRAME is
 * exactly what those passes exist to delete, which would silently promote
 * the test's real target node to graph ROOT instead of exercising the role
 * this file means to test. This is not an artificial testing concern: it is
 * the same real interaction documented in constants.js's ROLE_STRUCTURAL_
 * WRAPPER comment.
 */

const assert = require('assert');
const path = require('path');
const { buildNormalizedDesignGraph } = require('../ndg');
const {
  buildDesignSkeleton,
  resolveReadingOrder,
  ROLE_ROOT,
  ROLE_CONTENT,
  ROLE_DECORATIVE_CHROME,
  ROLE_STRUCTURAL_WRAPPER,
  ROLE_LAYOUT_CONTAINER_REAL,
  ROLE_LAYOUT_CONTAINER_INFERRED,
  ROLE_LEAF_SHAPE,
  ROLES,
  GROUP_KIND_REPEATING,
} = require('../skeleton');
const { orderChildrenVisualY } = require('../geometry/rules/structural-polish');

let passed = 0;
let failed = 0;
function pass(name) { passed += 1; console.log(`PASS  ${name}`); }
function fail(name, err) { failed += 1; console.error(`FAIL  ${name} — ${err && err.message ? err.message : err}`); }
function test(name, fn) {
  try { fn(); pass(name); } catch (e) { fail(name, e); }
}

const WHITE_FILL = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];

/** Wraps `child` under an outer, never-collapsed root frame. */
function graphOfChild(child, outerBox) {
  const doc = {
    id: 'outer-root',
    type: 'FRAME',
    absoluteBoundingBox: outerBox || { x: 0, y: 0, width: 400, height: 400 },
    fills: WHITE_FILL, // paint signal — never eligible for Pass 3 collapse
    children: [child],
  };
  return buildNormalizedDesignGraph({ document: doc, graphId: `ndg:skel-${child.id}` }).graph;
}
function skeletonEntry(skeleton, sourceNodeId) {
  return skeleton.nodes.find((n) => n.sourceNodeId === sourceNodeId);
}

// ─── base role classification ──────────────────────────────────────────────

test('root node gets ROLE_ROOT regardless of its own shape', () => {
  const graph = buildNormalizedDesignGraph({
    document: {
      id: 'root1', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 }, fills: WHITE_FILL, children: [],
    },
    graphId: 'ndg:skel-root',
  }).graph;
  const skeleton = buildDesignSkeleton(graph);
  assert.strictEqual(skeletonEntry(skeleton, 'root1').role, ROLE_ROOT);
});

test('TEXT leaf with real characters -> content', () => {
  const graph = graphOfChild({
    id: 't1', type: 'TEXT', characters: 'Hello', absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 },
  });
  assert.strictEqual(skeletonEntry(buildDesignSkeleton(graph), 't1').role, ROLE_CONTENT);
});

test('leaf with an IMAGE fill -> content', () => {
  const graph = graphOfChild({
    id: 'img1',
    type: 'RECTANGLE',
    absoluteBoundingBox: { x: 10, y: 10, width: 40, height: 40 },
    fills: [{ type: 'IMAGE', imageRef: 'abc' }],
  });
  assert.strictEqual(skeletonEntry(buildDesignSkeleton(graph), 'img1').role, ROLE_CONTENT);
});

test('leaf VECTOR icon (small, not chrome-shaped relative to parent) -> content', () => {
  const graph = graphOfChild({
    id: 'icon1',
    type: 'VECTOR',
    absoluteBoundingBox: { x: 20, y: 20, width: 24, height: 24 },
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
  }, { x: 0, y: 0, width: 200, height: 200 });
  assert.strictEqual(skeletonEntry(buildDesignSkeleton(graph), 'icon1').role, ROLE_CONTENT);
});

test('leaf RECTANGLE covering (near) the full parent box with solid fill -> decorative-chrome', () => {
  const graph = graphOfChild({
    id: 'bg1',
    type: 'RECTANGLE',
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    fills: [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }],
  }, { x: 0, y: 0, width: 200, height: 100 });
  assert.strictEqual(skeletonEntry(buildDesignSkeleton(graph), 'bg1').role, ROLE_DECORATIVE_CHROME);
});

test('leaf RECTANGLE that is small/thin (neither content nor full-bleed chrome) -> leaf-shape', () => {
  const graph = graphOfChild({
    id: 'divider1',
    type: 'RECTANGLE',
    absoluteBoundingBox: { x: 20, y: 90, width: 160, height: 1 },
    fills: [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }],
  }, { x: 0, y: 0, width: 200, height: 200 });
  assert.strictEqual(skeletonEntry(buildDesignSkeleton(graph), 'divider1').role, ROLE_LEAF_SHAPE);
});

test('container with layoutMode HORIZONTAL -> layout-container-real', () => {
  const graph = graphOfChild({
    id: 'row1',
    type: 'FRAME',
    layoutMode: 'HORIZONTAL',
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 50 },
    children: [
      { id: 'a', type: 'TEXT', characters: 'A', absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 } },
      { id: 'b', type: 'TEXT', characters: 'B', absoluteBoundingBox: { x: 60, y: 0, width: 50, height: 20 } },
    ],
  });
  assert.strictEqual(skeletonEntry(buildDesignSkeleton(graph), 'row1').role, ROLE_LAYOUT_CONTAINER_REAL);
});

test('container with layoutMode GRID -> layout-container-real', () => {
  const graph = graphOfChild({
    id: 'grid1',
    type: 'FRAME',
    layoutMode: 'GRID',
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
    children: [
      { id: 'a', type: 'TEXT', characters: 'A', absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 } },
      { id: 'b', type: 'TEXT', characters: 'B', absoluteBoundingBox: { x: 0, y: 30, width: 50, height: 20 } },
    ],
  });
  assert.strictEqual(skeletonEntry(buildDesignSkeleton(graph), 'grid1').role, ROLE_LAYOUT_CONTAINER_REAL);
});

test('container with no layoutMode, no own paint, 2 children -> layout-container-inferred', () => {
  const graph = graphOfChild({
    id: 'group1',
    type: 'GROUP',
    absoluteBoundingBox: { x: 10, y: 10, width: 150, height: 40 },
    children: [
      { id: 'c1', type: 'TEXT', characters: 'A', absoluteBoundingBox: { x: 10, y: 10, width: 60, height: 20 } },
      { id: 'c2', type: 'TEXT', characters: 'B', absoluteBoundingBox: { x: 90, y: 10, width: 60, height: 20 } },
    ],
  });
  assert.strictEqual(skeletonEntry(buildDesignSkeleton(graph), 'group1').role, ROLE_LAYOUT_CONTAINER_INFERRED);
});

test('container with no layoutMode but WITH its own paint (a card shell), 1 child -> layout-container-inferred (has real visual meaning, not organizational-only)', () => {
  const graph = graphOfChild({
    id: 'card1',
    type: 'FRAME',
    absoluteBoundingBox: { x: 10, y: 10, width: 150, height: 80 },
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
    cornerRadius: 12,
    children: [{
      id: 'cardInner', type: 'TEXT', characters: 'x', absoluteBoundingBox: { x: 20, y: 20, width: 100, height: 20 },
    }],
  });
  assert.strictEqual(skeletonEntry(buildDesignSkeleton(graph), 'card1').role, ROLE_LAYOUT_CONTAINER_INFERRED);
});

test('every ROLE constant used above is a member of the exported ROLES list (no typo drift)', () => {
  for (const r of [
    ROLE_ROOT, ROLE_CONTENT, ROLE_DECORATIVE_CHROME, ROLE_STRUCTURAL_WRAPPER,
    ROLE_LAYOUT_CONTAINER_REAL, ROLE_LAYOUT_CONTAINER_INFERRED, ROLE_LEAF_SHAPE,
  ]) {
    assert.ok(ROLES.includes(r), `${r} missing from ROLES`);
  }
});

test('structural-wrapper role — exercised directly against a hand-built graph object, since compiler/ndg/build.js\'s own Pass 3 already removes every real-world node this role would apply to (see constants.js\'s comment)', () => {
  // Deliberately bypasses buildNormalizedDesignGraph()/its collapse passes —
  // this proves the CLASSIFIER logic itself is correct in isolation, the
  // same way compiler/test/render.test.js unit-tests modeDecls() against
  // hand-built layoutChoice objects rather than a full pipeline run.
  const graph = {
    graphId: 'ndg:skel-structwrap-direct',
    nodes: [
      {
        id: 'src:root', sourceNodeId: 'root', type: 'FRAME', visible: true,
        box: { x: 0, y: 0, width: 100, height: 100 }, paints: [], geometry: {}, attributes: {},
      },
      {
        id: 'src:wrap', sourceNodeId: 'wrap', type: 'GROUP', visible: true,
        box: { x: 10, y: 10, width: 80, height: 30 }, paints: [], geometry: {}, attributes: {},
      },
      {
        id: 'src:inner', sourceNodeId: 'inner', type: 'TEXT', visible: true,
        box: { x: 10, y: 10, width: 80, height: 30 }, paints: [], geometry: {},
        attributes: { characters: 'x' },
      },
    ],
    edges: [
      { from: 'src:root', to: 'src:wrap', kind: 'parent', index: 0 },
      { from: 'src:wrap', to: 'src:inner', kind: 'parent', index: 0 },
    ],
  };
  const skeleton = buildDesignSkeleton(graph);
  assert.strictEqual(skeletonEntry(skeleton, 'wrap').role, ROLE_STRUCTURAL_WRAPPER);
});

// ─── reading order ──────────────────────────────────────────────────────────

test('reading order — real Auto Layout parent preserves declared child order even when boxes are visually reversed', () => {
  const graph = graphOfChild({
    id: 'row1',
    type: 'FRAME',
    layoutMode: 'HORIZONTAL',
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 50 },
    children: [
      // Declared order: first-declared child is visually on the RIGHT.
      { id: 'declaredFirst', type: 'TEXT', characters: 'A', absoluteBoundingBox: { x: 150, y: 0, width: 40, height: 20 } },
      { id: 'declaredSecond', type: 'TEXT', characters: 'B', absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 20 } },
    ],
  });
  const skeleton = buildDesignSkeleton(graph);
  assert.strictEqual(skeletonEntry(skeleton, 'declaredFirst').readingOrder, 0, 'declared order wins for real Auto Layout, not visual position');
  assert.strictEqual(skeletonEntry(skeleton, 'declaredSecond').readingOrder, 1);
});

test('reading order — freeform parent (no layoutMode) resolves by real visual position, not scrambled document order (the confirmed real-fixture 001/003/004/002 scenario)', () => {
  const rowFill = [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95 } }];
  // Declared/document order is 001, 003, 004, 002 — scrambled relative to
  // true top-to-bottom visual position, mirroring the real Challenge Arena
  // fixture finding in the research doc. Each row carries a fill so it
  // survives NDG's own empty-leaf-drop pass (Pass 2) untouched.
  const graph = graphOfChild({
    id: 'freeform-rows',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 400 },
    children: [
      { id: 'row-001', type: 'FRAME', fills: rowFill, absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 90 } },
      { id: 'row-003', type: 'FRAME', fills: rowFill, absoluteBoundingBox: { x: 0, y: 200, width: 100, height: 90 } },
      { id: 'row-004', type: 'FRAME', fills: rowFill, absoluteBoundingBox: { x: 0, y: 300, width: 100, height: 90 } },
      { id: 'row-002', type: 'FRAME', fills: rowFill, absoluteBoundingBox: { x: 0, y: 100, width: 100, height: 90 } },
    ],
  }, { x: 0, y: 0, width: 100, height: 400 });
  const skeleton = buildDesignSkeleton(graph);
  assert.strictEqual(skeletonEntry(skeleton, 'row-001').readingOrder, 0);
  assert.strictEqual(skeletonEntry(skeleton, 'row-002').readingOrder, 1, 'visually second despite being declared last');
  assert.strictEqual(skeletonEntry(skeleton, 'row-003').readingOrder, 2);
  assert.strictEqual(skeletonEntry(skeleton, 'row-004').readingOrder, 3);
});

test('resolveReadingOrder is provably equivalent to the already-proven orderChildrenVisualY for freeform siblings (isHeader:false case) — this is what makes swapping one for the other in the renderer safe, not just plausible', () => {
  const kids = [
    { id: 'a', box: { x: 10, y: 100, width: 5, height: 5 } },
    { id: 'b', box: { x: 5, y: 100, width: 5, height: 5 } }, // same y as 'a', smaller x
    { id: 'c', box: { x: 0, y: 50, width: 5, height: 5 } },
    { id: 'd', box: { x: 0, y: 102, width: 5, height: 5 } }, // near (but not equal) to a/b's y
  ];
  const fakeParent = { attributes: {} }; // no layoutMode -> freeform branch
  const skeletonOrder = resolveReadingOrder(fakeParent, kids);
  const visualYOrder = orderChildrenVisualY(kids.map((k) => ({ id: k.id, box: k.box, isHeader: false })));
  assert.deepStrictEqual(skeletonOrder, visualYOrder);
});

// ─── provenance ─────────────────────────────────────────────────────────────

test('provenance — every node points directly back to its own source id (v0: always 1:1)', () => {
  const graph = graphOfChild({
    id: 'child1', type: 'TEXT', characters: 'x', absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 },
  });
  const skeleton = buildDesignSkeleton(graph);
  for (const entry of skeleton.nodes) {
    assert.strictEqual(entry.provenance.kind, 'direct');
    assert.deepStrictEqual(entry.provenance.sourceNodeIds, [entry.sourceNodeId]);
  }
});

// ─── repeating-group membership (wraps freeform-layout's real detector) ────

test('repeating-group membership — 3 uniform freeform "cards" in a row are tagged as repeating members with correct axis + slotIndex', () => {
  const cardW = 100;
  const gap = 20;
  const makeCard = (i) => ({
    id: `card-${i}`,
    type: 'FRAME',
    absoluteBoundingBox: { x: i * (cardW + gap), y: 0, width: cardW, height: 120 },
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
    children: [{
      id: `card-${i}-label`,
      type: 'TEXT',
      characters: `Card ${i}`,
      absoluteBoundingBox: { x: i * (cardW + gap) + 10, y: 10, width: cardW - 20, height: 20 },
    }],
  });
  const graph = graphOfChild({
    id: 'group1',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 3 * cardW + 2 * gap, height: 120 },
    children: [makeCard(0), makeCard(1), makeCard(2)],
  }, { x: 0, y: 0, width: 3 * cardW + 2 * gap, height: 120 });
  const skeleton = buildDesignSkeleton(graph);
  const entries = [0, 1, 2].map((i) => skeletonEntry(skeleton, `card-${i}`));
  for (const entry of entries) {
    assert.ok(entry.group, `card ${entry.sourceNodeId} should be tagged as a group member`);
    assert.strictEqual(entry.group.kind, GROUP_KIND_REPEATING);
    assert.strictEqual(entry.group.groupRole, 'member');
    assert.strictEqual(entry.group.axis, 'row');
  }
  const slots = entries.map((e) => e.group.slotIndex).sort();
  assert.deepStrictEqual(slots, [0, 1, 2], 'each card gets a distinct slot index');
  assert.ok(skeleton.freeformGroups.length >= 1, 'the underlying freeform group fact is exposed too');
});

test('a node with no detected repeating group has group:null (no false-positive tagging)', () => {
  const graph = graphOfChild({
    id: 'lonely', type: 'TEXT', characters: 'x', absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 },
  });
  assert.strictEqual(skeletonEntry(buildDesignSkeleton(graph), 'lonely').group, null);
});

// ─── real cached Figma fixture end-to-end sanity check ─────────────────────

test('real fixture (Incentives) — Skeleton builds cleanly, every node gets exactly one valid role, distribution is not degenerate', () => {
  process.env.FIGMA_CACHE_DIR = path.resolve(__dirname, '..', '..', 'output', 'figma-cache');
  const snapMod = require('../../server/figma-snapshot');
  const snap = snapMod.loadSnapshot('fYKUEGHAxVkJwn8CwvJCsp', '0:1');
  if (!snap) {
    console.log('SKIP  (no cached Incentives snapshot available in this environment)');
    return;
  }
  function find(n, id) {
    if (!n) return null;
    if (n.id === id) return n;
    for (const c of n.children || []) {
      const f = find(c, id);
      if (f) return f;
    }
    return null;
  }
  const document = find(snap.document, '50:192') || find(snap.document, '50:2');
  assert.ok(document, 'fixture document node found');

  const graph = buildNormalizedDesignGraph({ document, graphId: 'ndg:skel-real-incentives' }).graph;
  const skeleton = buildDesignSkeleton(graph);

  assert.strictEqual(skeleton.nodes.length, graph.nodes.length, 'every NDG node gets exactly one Skeleton entry');
  for (const entry of skeleton.nodes) {
    assert.ok(ROLES.includes(entry.role), `node ${entry.sourceNodeId} has an unrecognized role: ${entry.role}`);
  }
  const roleCounts = {};
  for (const entry of skeleton.nodes) roleCounts[entry.role] = (roleCounts[entry.role] || 0) + 1;
  assert.strictEqual(roleCounts[ROLE_ROOT], 1, 'exactly one root');
  assert.ok((roleCounts[ROLE_CONTENT] || 0) > 0, 'a real design section has at least some content nodes');
  assert.ok(
    Object.keys(roleCounts).length > 1,
    'role distribution is not degenerate (everything classified identically)',
  );
  console.log(`  (role distribution: ${JSON.stringify(roleCounts)})`);
});

console.log('\n---');
console.log(`Passed: ${passed}  Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
