'use strict';

/**
 * Phase 0 — Geometry Recognition Engine tests.
 * @see docs/COMPILER_MIGRATION_BLUEPRINT.md
 */
const {
  detectGeometry,
  evaluateRowOrColumn,
  evaluateGrid,
  evaluateSideBySideRow,
  evaluateSideBySideColumn,
  evaluateColumnFlex,
  yOverlapRatio,
  groupByRowOverlap,
  projectGeometryIR,
  materializeGeometryIR,
  BUILDER_VERSION,
  STAGE_ID,
  geometryIrChecksum,
  HINT_GEOMETRY_COLUMN,
  HINT_GEOMETRY_GRID,
  HINT_GEOMETRY_SIDE_BY_SIDE,
  HINT_GEOMETRY_COLUMN_FLEX,
  HINT_GEOMETRY_SIDE_BY_SIDE_COLUMN,
} = require('../geometry');
const { materializeNormalizedDesignGraph } = require('../ndg');
const { createWorkspace } = require('../workspace');
const { indexGraph } = require('../layout/collect');
const { interpretGraph } = require('../layout/interpret');

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

/** Freeform Group (NO layoutMode) — a clean, uniform-gap vertical stack.
 *  This is exactly the shape layout.interpret cannot classify today: no
 *  declared Auto Layout, so it falls to 'unknown'. */
function freeformColumnDoc() {
  return {
    id: 'root',
    type: 'GROUP', // no layoutMode — freeform
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    children: [
      { id: 'a', type: 'TEXT', characters: 'Title', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 } },
      { id: 'b', type: 'TEXT', characters: 'Body', absoluteBoundingBox: { x: 0, y: 30, width: 100, height: 20 } },
      { id: 'c', type: 'TEXT', characters: 'Footer', absoluteBoundingBox: { x: 0, y: 60, width: 100, height: 20 } },
    ],
  };
}

/** Same shape but children overlap — must yield no candidate (Phase 0 safety). */
function overlappingDoc() {
  return {
    id: 'root',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    children: [
      { id: 'a', type: 'TEXT', characters: 'A', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 } },
      { id: 'b', type: 'TEXT', characters: 'B', absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 50 } },
    ],
  };
}

/** Non-uniform gaps — out of Phase 0's strict scope (its binary uniform-gap
 *  test correctly rejects this), but a clean single-file, left-aligned,
 *  non-overlapping column IS exactly the shape evaluateSideBySideColumn (and
 *  its already-shipped row counterpart, evaluateSideBySideRow, which has the
 *  identical non-uniform-gap tolerance — confirmed by direct test) exists to
 *  recover: real flow-column layout was never conditioned on uniform gaps in
 *  actual CSS, only Phase 0's simpler binary test needed that simplification. */
function unevenGapDoc() {
  return {
    id: 'root',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 150 },
    children: [
      { id: 'a', type: 'TEXT', characters: 'A', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 } },
      { id: 'b', type: 'TEXT', characters: 'B', absoluteBoundingBox: { x: 0, y: 30, width: 100, height: 20 } },
      { id: 'c', type: 'TEXT', characters: 'C', absoluteBoundingBox: { x: 0, y: 90, width: 100, height: 20 } },
    ],
  };
}

/** 2×3 grid of siblings — uniform row AND column spacing, no Auto Layout.
 *  Phase 0's evaluateRowOrColumn cannot classify this (neither a clean row
 *  nor a clean column: x spans 3 distinct groups, y spans 2). */
function gridDoc() {
  // RECTANGLE (not a wrapper type) so NDG's empty-leaf-wrapper drop pass
  // doesn't remove these childless boxes — see compiler/ndg/build.js.
  const mk = (id, x, y) => ({ id, type: 'RECTANGLE', absoluteBoundingBox: { x, y, width: 100, height: 60 } });
  return {
    id: 'root',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 360, height: 160 },
    children: [
      mk('r0c0', 0, 0), mk('r0c1', 120, 0), mk('r0c2', 240, 0),
      mk('r1c0', 0, 80), mk('r1c1', 120, 80), mk('r1c2', 240, 80),
    ],
  };
}

/** Side-by-side row: y-overlap ratio 1.0 against the leftmost sibling, but
 *  NOT pixel-perfectly top-aligned (28px offset) — Phase 0's edgesAligned
 *  (ALIGN_TOL=2) rejects this; only the looser Y-overlap-ratio test catches it. */
function sideBySideDoc() {
  return {
    id: 'root',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 100 },
    children: [
      { id: 'a', type: 'RECTANGLE', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'b', type: 'RECTANGLE', absoluteBoundingBox: { x: 140, y: 30, width: 100, height: 40 } },
    ],
  };
}

/** Side-by-side COLUMN: the direct symmetric counterpart of sideBySideDoc()
 *  above — 2 siblings simply stacked top-to-bottom (X-overlap ratio 1.0
 *  against the topmost sibling) but NOT sharing a left edge (142px offset),
 *  so Phase 0's edgesAligned(byY,'x') (ALIGN_TOL=2) rejects it — mirrors the
 *  real, confirmed bug shape (Figma "Blogs" section, node 84:5: a full-width
 *  card row below a narrower, independently-centered heading block). */
function sideBySideColumnDoc() {
  return {
    id: 'root',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 150 },
    children: [
      { id: 'heading', type: 'RECTANGLE', absoluteBoundingBox: { x: 142, y: 0, width: 100, height: 40 } },
      { id: 'row', type: 'RECTANGLE', absoluteBoundingBox: { x: 0, y: 70, width: 240, height: 80 } },
    ],
  };
}

/** Same 2-sibling top-to-bottom shape, but genuinely overlapping (a chrome
 *  background rect fully containing the second child) — confirmed as a real
 *  shape in this repo's own corpus (Figma node 1:327, "Group 1171278042":
 *  a background Rectangle with a content Group positioned inside it).
 *  evaluateSideBySideColumn must reject this exactly like evaluateSideBySideRow
 *  already rejects its own row-shaped equivalent — real overlap can never be
 *  reproduced by flow layout, regardless of axis. */
function overlappingColumnDoc() {
  return {
    id: 'root',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 150 },
    children: [
      { id: 'chrome', type: 'RECTANGLE', absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 150 } },
      { id: 'content', type: 'RECTANGLE', absoluteBoundingBox: { x: 20, y: 20, width: 200, height: 100 } },
    ],
  };
}

/** Freeform two-column recovery: column 1 has 2 stacked items (uniform gap),
 *  column 2 has 3 stacked items with UNEVEN gaps (20 vs 25) — Phase 0's
 *  binary uniform-gap test would never accept this shape (it isn't a single
 *  row or column at all), and even a per-column uniform-gap test would choke
 *  on column 2's variance. The legacy scorer (evaluateColumnFlex) still
 *  accepts it because column count (2), inter-column gap (40px), and content
 *  count (5) all score well above COLUMN_FLEX_MIN_SCORE (0.75). */
function columnFlexDoc() {
  return {
    id: 'root',
    type: 'GROUP',
    absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 130 },
    children: [
      { id: 'a', type: 'RECTANGLE', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 } },
      { id: 'b', type: 'RECTANGLE', absoluteBoundingBox: { x: 0, y: 60, width: 100, height: 40 } },
      { id: 'c', type: 'RECTANGLE', absoluteBoundingBox: { x: 140, y: 0, width: 100, height: 30 } },
      { id: 'd', type: 'RECTANGLE', absoluteBoundingBox: { x: 140, y: 50, width: 100, height: 25 } },
      { id: 'e', type: 'RECTANGLE', absoluteBoundingBox: { x: 140, y: 100, width: 100, height: 30 } },
    ],
  };
}

async function seedNdg(ws, document, graphId) {
  return materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    document,
    graphId,
  });
}

async function main() {
  await test('detect — clean freeform column (uniform gap, no overlap)', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, freeformColumnDoc(), 'g-col');
    const d = detectGeometry(ndg.graph, {});
    assert(d.candidates.length === 1, 'one candidate');
    assert(d.candidates[0].axis === 'column', 'axis=column');
    assert(Math.abs(d.candidates[0].gap - 10) < 0.01, 'gap=10');
    assert(d.recognitionHintsByNode[d.candidates[0].nodeId].includes(HINT_GEOMETRY_COLUMN), 'hint emitted');
    assert(d.metrics.candidateCount === 1, 'metrics');
  });

  await test('detect — real overlap yields no candidate', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, overlappingDoc(), 'g-ovl');
    const d = detectGeometry(ndg.graph, {});
    assert(d.candidates.length === 0, 'no candidate on overlap');
    assert(d.evidence.some((e) => e.ref === 'geometry.overlap'), 'overlap evidence recorded');
  });

  await test('detect — non-uniform gap is out of Phase 0\'s strict scope (falls through to it), but IS recovered by evaluateSideBySideColumn (same non-uniform-gap tolerance as the already-shipped evaluateSideBySideRow)', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, unevenGapDoc(), 'g-uneven');
    const d = detectGeometry(ndg.graph, {});
    assert(d.candidates.length === 1, 'one candidate, recovered by the side-by-side-column tier');
    assert(d.candidates[0].axis === 'column', 'axis=column');
    assert(d.recognitionHintsByNode[d.candidates[0].nodeId].includes(HINT_GEOMETRY_SIDE_BY_SIDE_COLUMN), 'recovered via the side-by-side-column hint, not Phase 0');
  });

  await test('evaluateRowOrColumn — pure function, no graph coupling', () => {
    const r = evaluateRowOrColumn('p', [
      { nodeId: 'x', box: { x: 0, y: 0, width: 10, height: 10 } },
      { nodeId: 'y', box: { x: 20, y: 0, width: 10, height: 10 } },
    ]);
    assert(r.axis === 'row', 'row detected from plain objects');
  });

  await test('project GeometryIR — immutable + checksum + no CSS leakage', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, freeformColumnDoc(), 'g-proj');
    const out = projectGeometryIR(ndg.graph, { sliceId: 'slice:geometry:g-proj' });
    assert(out.slice.stageId === STAGE_ID, 'stage');
    assert(Object.isFrozen(out.slice), 'frozen');
    assert(out.checksum === geometryIrChecksum(out.slice.payload), 'checksum matches');
    const raw = JSON.stringify(out.slice.payload);
    assert(!raw.includes('display:'), 'no css leakage');
    assert(!/<[a-z]+>/i.test(raw), 'no html leakage');
  });

  await test('materialize + Fact/IrSlice', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, freeformColumnDoc(), 'g-mat');
    const out = await materializeGeometryIR({
      workspace: ws,
      policy: { profileId: 'pixel-faithful' },
      suiteVersion: '1.0.0',
    });
    assert(out.builderVersion === BUILDER_VERSION, 'builder version');
    assert(out.sliceId, 'sliceId present');
    assert(out.report && out.report.candidateCount === 1, 'report candidate count');
  });

  await test('deterministic + idempotent — same graph, same checksum twice', async () => {
    const ws1 = createWorkspace();
    const ndg1 = await seedNdg(ws1, freeformColumnDoc(), 'g-det-a');
    const out1 = projectGeometryIR(ndg1.graph, { sliceId: 'slice:geometry:g-det-a' });

    const ws2 = createWorkspace();
    const ndg2 = await seedNdg(ws2, freeformColumnDoc(), 'g-det-a');
    const out2 = projectGeometryIR(ndg2.graph, { sliceId: 'slice:geometry:g-det-a' });

    assert(out1.checksum === out2.checksum, 'checksum stable across independent runs');
  });

  // ─── The decisive Phase 0 proof ───────────────────────────────────────────
  // Does feeding GeometryIR's recognitionHints into layout.interpret actually
  // change the outcome for freeform (no Auto Layout) content — from 'unknown'
  // to a real 'flow-column' decision? This is the entire point of Phase 0.
  await test('END-TO-END: geometry hints flip a freeform column from unknown to flow-column', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, freeformColumnDoc(), 'g-e2e');
    const graph = ndg.graph;
    const index = indexGraph(graph);

    // Baseline: no hints — freeform Group has no layoutMode, so it must be 'unknown'.
    const baseline = interpretGraph(graph, index, {});
    const rootBaseline = baseline.find((i) => i.nodeId === 'root' || (graph.nodes.find((n) => n.id === i.nodeId) || {}).sourceNodeId === 'root');
    assert(rootBaseline, 'root interpretation found (baseline)');
    assert(rootBaseline.modeCandidates[0].mode === 'unknown', `baseline should be unknown, got ${rootBaseline.modeCandidates[0].mode}`);

    // With geometry hints: the same node must now resolve to flow-column.
    const d = detectGeometry(graph, {});
    const withHints = interpretGraph(graph, index, { recognitionHintsByNode: d.recognitionHintsByNode });
    const rootWithHints = withHints.find((i) => i.nodeId === rootBaseline.nodeId);
    assert(rootWithHints, 'root interpretation found (with hints)');
    assert(rootWithHints.modeCandidates[0].mode === 'flow-column', `expected flow-column, got ${rootWithHints.modeCandidates[0].mode}`);
    assert(rootWithHints.modeCandidates[0].cues.includes('recognition:geometry-column'), 'cue recorded');
  });

  // ─── Phase 1 — full vocabulary ─────────────────────────────────────────────
  // @see docs/COMPILER_MIGRATION_BLUEPRINT.md Phase 1

  await test('evaluateGrid — pure function, 2x3 grid from plain objects', () => {
    const mk = (id, x, y) => ({ nodeId: id, box: { x, y, width: 100, height: 60 } });
    const children = [
      mk('r0c0', 0, 0), mk('r0c1', 120, 0), mk('r0c2', 240, 0),
      mk('r1c0', 0, 80), mk('r1c1', 120, 80), mk('r1c2', 240, 80),
    ];
    const g = evaluateGrid('p', children);
    assert(g.isGrid, 'grid detected');
    assert(g.rows === 2 && g.cols === 3, `expected 2x3, got ${g.rows}x${g.cols}`);
    assert(Math.abs(g.rowGap - 20) < 0.01, 'rowGap=20');
    assert(Math.abs(g.colGap - 20) < 0.01, 'colGap=20');
    assert(g.orderedIds.length === 6, 'all 6 ids ordered');
  });

  await test('detect — grid of cards yields geometry-grid hint (Phase 0 misses it)', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, gridDoc(), 'g-grid');
    const d = detectGeometry(ndg.graph, {});
    assert(d.candidates.length === 1, 'one candidate');
    assert(d.candidates[0].pattern === 'grid', 'pattern=grid');
    assert(d.candidates[0].rows === 2 && d.candidates[0].cols === 3, 'rows/cols');
    assert(d.recognitionHintsByNode[d.candidates[0].nodeId].includes(HINT_GEOMETRY_GRID), 'grid hint emitted');
    assert(d.metrics.gridCandidateCount === 1, 'grid metric');
  });

  await test('yOverlapRatio — pure geometric ratio', () => {
    assert(yOverlapRatio({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 10 }) === 0.5, 'half overlap');
    assert(yOverlapRatio({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 }) === 0, 'no overlap');
  });

  await test('evaluateSideBySideRow — pure function, y-offset row from plain objects', () => {
    const children = [
      { nodeId: 'a', box: { x: 0, y: 0, width: 100, height: 100 } },
      { nodeId: 'b', box: { x: 140, y: 30, width: 100, height: 40 } },
    ];
    const r = evaluateSideBySideRow('p', children);
    assert(r.axis === 'row', 'row detected despite y-offset');
  });

  await test('detect — side-by-side row (y-overlap, not edge-aligned) yields geometry-side-by-side hint', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, sideBySideDoc(), 'g-sbs');
    const d = detectGeometry(ndg.graph, {});
    assert(d.candidates.length === 1, 'one candidate');
    assert(d.candidates[0].pattern === 'side-by-side', 'pattern=side-by-side');
    assert(d.candidates[0].axis === 'row', 'axis=row');
    assert(
      d.recognitionHintsByNode[d.candidates[0].nodeId].includes(HINT_GEOMETRY_SIDE_BY_SIDE),
      'side-by-side hint emitted',
    );
    assert(d.metrics.sideBySideCandidateCount === 1, 'side-by-side metric');
  });

  await test('evaluateColumnFlex — pure function, scores a 2-column freeform cluster', () => {
    const children = [
      { nodeId: 'a', box: { x: 0, y: 0, width: 100, height: 40 } },
      { nodeId: 'b', box: { x: 0, y: 60, width: 100, height: 40 } },
      { nodeId: 'c', box: { x: 140, y: 0, width: 100, height: 30 } },
      { nodeId: 'd', box: { x: 140, y: 50, width: 100, height: 25 } },
      { nodeId: 'e', box: { x: 140, y: 100, width: 100, height: 30 } },
    ];
    const r = evaluateColumnFlex('p', children, 0.75);
    assert(r.ok, `expected ok, score=${r.score}`);
    assert(r.score >= 0.75, `score ${r.score} should clear 0.75`);
    assert(r.columns.length === 2, 'two columns');
  });

  await test('detect — uneven-gap freeform column-flex (Phase 0 + grid both miss it) yields geometry-column-flex hint', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, columnFlexDoc(), 'g-colflex');
    const d = detectGeometry(ndg.graph, {});
    assert(d.candidates.length === 1, 'one candidate');
    assert(d.candidates[0].pattern === 'column-flex', 'pattern=column-flex');
    assert(d.candidates[0].confidence >= 0.75, 'confidence clears threshold');
    assert(
      d.recognitionHintsByNode[d.candidates[0].nodeId].includes(HINT_GEOMETRY_COLUMN_FLEX),
      'column-flex hint emitted',
    );
    assert(d.metrics.columnFlexCandidateCount === 1, 'column-flex metric');
  });

  await test('precedence — Phase 0 row/column candidate suppresses Phase 1 detectors for the same node', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, freeformColumnDoc(), 'g-precedence');
    const d = detectGeometry(ndg.graph, {});
    // freeformColumnDoc is a clean uniform-gap column — Phase 0 must win outright.
    assert(d.candidates.length === 1, 'exactly one candidate (Phase 0, not Phase 1)');
    assert(d.candidates[0].pattern === 'row-or-column', 'Phase 0 pattern wins');
    assert(d.metrics.gridCandidateCount === 0, 'no grid candidate stole this node');
    assert(d.metrics.sideBySideCandidateCount === 0, 'no side-by-side candidate stole this node');
    assert(d.metrics.columnFlexCandidateCount === 0, 'no column-flex candidate stole this node');
  });

  // ─── Phase 1 end-to-end proofs — each new hint must flip a freeform node's
  // interpretGraph outcome from 'unknown' to the correct mode, mirroring the
  // decisive Phase 0 proof above. ──────────────────────────────────────────

  await test('END-TO-END: geometry-grid hint flips a freeform grid from unknown to grid-track', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, gridDoc(), 'g-grid-e2e');
    const graph = ndg.graph;
    const index = indexGraph(graph);

    const baseline = interpretGraph(graph, index, {});
    const rootBaseline = baseline.find((i) => (graph.nodes.find((n) => n.id === i.nodeId) || {}).sourceNodeId === 'root');
    assert(rootBaseline, 'root interpretation found (baseline)');
    assert(rootBaseline.modeCandidates[0].mode === 'unknown', `baseline should be unknown, got ${rootBaseline.modeCandidates[0].mode}`);

    const d = detectGeometry(graph, {});
    const withHints = interpretGraph(graph, index, { recognitionHintsByNode: d.recognitionHintsByNode });
    const rootWithHints = withHints.find((i) => i.nodeId === rootBaseline.nodeId);
    assert(rootWithHints.modeCandidates[0].mode === 'grid-track', `expected grid-track, got ${rootWithHints.modeCandidates[0].mode}`);
    assert(rootWithHints.modeCandidates[0].cues.includes('recognition:geometry-grid'), 'cue recorded');
  });

  await test('END-TO-END: geometry-side-by-side hint flips a freeform y-offset row from unknown to flow-row', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, sideBySideDoc(), 'g-sbs-e2e');
    const graph = ndg.graph;
    const index = indexGraph(graph);

    const baseline = interpretGraph(graph, index, {});
    const rootBaseline = baseline.find((i) => (graph.nodes.find((n) => n.id === i.nodeId) || {}).sourceNodeId === 'root');
    assert(rootBaseline.modeCandidates[0].mode === 'unknown', `baseline should be unknown, got ${rootBaseline.modeCandidates[0].mode}`);

    const d = detectGeometry(graph, {});
    const withHints = interpretGraph(graph, index, { recognitionHintsByNode: d.recognitionHintsByNode });
    const rootWithHints = withHints.find((i) => i.nodeId === rootBaseline.nodeId);
    assert(rootWithHints.modeCandidates[0].mode === 'flow-row', `expected flow-row, got ${rootWithHints.modeCandidates[0].mode}`);
    assert(rootWithHints.modeCandidates[0].cues.includes('recognition:geometry-side-by-side'), 'cue recorded');
  });

  await test('END-TO-END: geometry-column-flex hint flips a freeform uneven cluster from unknown to flow-row', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, columnFlexDoc(), 'g-colflex-e2e');
    const graph = ndg.graph;
    const index = indexGraph(graph);

    const baseline = interpretGraph(graph, index, {});
    const rootBaseline = baseline.find((i) => (graph.nodes.find((n) => n.id === i.nodeId) || {}).sourceNodeId === 'root');
    assert(rootBaseline.modeCandidates[0].mode === 'unknown', `baseline should be unknown, got ${rootBaseline.modeCandidates[0].mode}`);

    const d = detectGeometry(graph, {});
    const withHints = interpretGraph(graph, index, { recognitionHintsByNode: d.recognitionHintsByNode });
    const rootWithHints = withHints.find((i) => i.nodeId === rootBaseline.nodeId);
    assert(rootWithHints.modeCandidates[0].mode === 'flow-row', `expected flow-row, got ${rootWithHints.modeCandidates[0].mode}`);
    assert(rootWithHints.modeCandidates[0].cues.includes('recognition:geometry-column-flex'), 'cue recorded');
  });

  await test('evaluateSideBySideColumn — pure function, no graph coupling (direct symmetric counterpart of evaluateSideBySideRow)', () => {
    const r = evaluateSideBySideColumn('p', [
      { nodeId: 'heading', box: { x: 142, y: 0, width: 100, height: 40 } },
      { nodeId: 'row', box: { x: 0, y: 70, width: 240, height: 80 } },
    ]);
    assert(r.axis === 'column', 'column detected despite mismatched left edges (142 vs 0)');
    assert(r.orderedIds[0] === 'heading' && r.orderedIds[1] === 'row', 'ordered top-to-bottom');
  });

  await test('evaluateSideBySideColumn — real overlap yields no candidate, same as evaluateSideBySideRow', () => {
    const r = evaluateSideBySideColumn('p', [
      { nodeId: 'chrome', box: { x: 0, y: 0, width: 240, height: 150 } },
      { nodeId: 'content', box: { x: 20, y: 20, width: 200, height: 100 } },
    ]);
    assert(r.axis === null, 'no candidate — content is genuinely inside chrome, not stacked below it');
  });

  await test('detect — side-by-side column (mismatched left edges, no overlap) yields a column candidate with HINT_GEOMETRY_SIDE_BY_SIDE_COLUMN', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, sideBySideColumnDoc(), 'g-sbsc');
    const d = detectGeometry(ndg.graph, {});
    assert(d.candidates.length === 1, 'one candidate');
    assert(d.candidates[0].axis === 'column', 'axis=column');
    assert(d.recognitionHintsByNode[d.candidates[0].nodeId].includes(HINT_GEOMETRY_SIDE_BY_SIDE_COLUMN), 'hint emitted');
  });

  await test('detect — overlapping top-to-bottom siblings yield no candidate (chrome-background + inset-content shape, confirmed real via this repo\'s own corpus node 1:327)', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, overlappingColumnDoc(), 'g-ovlc');
    const d = detectGeometry(ndg.graph, {});
    assert(d.candidates.length === 0, 'no candidate on overlap');
  });

  await test('END-TO-END: geometry-side-by-side-column hint flips a freeform mismatched-width vertical stack from unknown to flow-column (real bug: Figma "Blogs" section, node 84:5)', async () => {
    const ws = createWorkspace();
    const ndg = await seedNdg(ws, sideBySideColumnDoc(), 'g-sbsc-e2e');
    const graph = ndg.graph;
    const index = indexGraph(graph);

    const baseline = interpretGraph(graph, index, {});
    const rootBaseline = baseline.find((i) => (graph.nodes.find((n) => n.id === i.nodeId) || {}).sourceNodeId === 'root');
    assert(rootBaseline.modeCandidates[0].mode === 'unknown', `baseline should be unknown, got ${rootBaseline.modeCandidates[0].mode}`);

    const d = detectGeometry(graph, {});
    const withHints = interpretGraph(graph, index, { recognitionHintsByNode: d.recognitionHintsByNode });
    const rootWithHints = withHints.find((i) => i.nodeId === rootBaseline.nodeId);
    assert(rootWithHints.modeCandidates[0].mode === 'flow-column', `expected flow-column, got ${rootWithHints.modeCandidates[0].mode}`);
    assert(rootWithHints.modeCandidates[0].cues.includes('recognition:geometry-side-by-side-column'), 'cue recorded');
  });

  await test('groupByRowOverlap — groups mismatched-height cards into one row via Y-range overlap, not top-edge proximity (real bug: Figma file c0kt3mp76RoEiq3CFoeCHa node 39:9, "Why Participate?" — 40px top-edge gap between two same-row cards)', () => {
    const items = [
      { id: 'sharpen', box: { x: 197, y: 230, w: 233, h: 226 } },
      { id: 'knowledge', box: { x: 631, y: 190, w: 183, h: 323 } },
      { id: 'earn', box: { x: 1054, y: 195, w: 152, h: 300 } },
    ].sort((a, b) => a.box.y - b.box.y);
    const rows = groupByRowOverlap(items);
    assert(rows.length === 1, 'all 3 cards recognized as one visual row despite up to 40px top-edge differences');
    assert(JSON.stringify(rows[0].map((i) => i.id).sort()) === JSON.stringify(['earn', 'knowledge', 'sharpen']), 'all 3 ids present in the one row');
  });

  await test('groupByRowOverlap — genuinely separate rows (no Y-range overlap at all) stay separate', () => {
    const items = [
      { id: 'row1-a', box: { x: 0, y: 0, w: 100, h: 90 } },
      { id: 'row2-a', box: { x: 0, y: 200, w: 100, h: 90 } },
    ];
    const rows = groupByRowOverlap(items);
    assert(rows.length === 2, 'two genuinely non-overlapping rows stay separate');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
