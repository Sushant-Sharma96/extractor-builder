#!/usr/bin/env node
'use strict';

/**
 * Phase 0 dual-run comparison — docs/COMPILER_MIGRATION_BLUEPRINT.md §9.
 *
 * For a real, cached Figma fixture, runs BOTH paths independently and diffs
 * their row/column decisions node-by-node:
 *
 *   LEGACY  — server/figma-build.js's analyze() (inferFlow's geometric test,
 *             already proven pixel-neutral in production)
 *   NEW     — compiler/geometry's detectGeometry() (Phase 0 port of the same
 *             test, read-only, feeding compiler/layout/interpret.js's
 *             recognitionHints extension point)
 *
 * This is a decision-diff only (per the blueprint's Phase 0 scope) — it does
 * NOT compare HTML/CSS output, and it does NOT change what ships. Both paths
 * are read-only with respect to production; this script is diagnostic.
 *
 * Usage: node scripts/dual-run-compare.js <fixtureDir> <rootNodeId>
 *   e.g. node scripts/dual-run-compare.js c0kt3mp76RoEiq3CFoeCHa__1_2 1:4
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

const figmaBuild = require('../server/figma-build');
const { detectGeometry } = require('../compiler/geometry');
const { materializeNormalizedDesignGraph } = require('../compiler/ndg');
const { createWorkspace } = require('../compiler/workspace');
const { indexGraph } = require('../compiler/layout/collect');
const { interpretGraph } = require('../compiler/layout/interpret');

function findNode(n, id) {
  if (!n) return null;
  if (n.id === id) return n;
  for (const c of n.children || []) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return null;
}

/** Walk the LEGACY figma-build tree, collecting the FINAL shipped decision per
 *  node (display:flex + flex-direction on el.decls — not the _standardsFlow
 *  marker flag, which multiple heuristics set and never clear even after a
 *  LATER demotion reverts the node to absolute) → { sourceNodeId: { axis } }. */
function collectLegacyDecisions(tree) {
  const out = {};
  (function walk(el) {
    if (!el) return;
    const display = el.decls && el.decls.get('display');
    if (display === 'flex' && el.nodeId) {
      const dir = el.decls.get('flex-direction') || 'row';
      const axis = dir === 'column' ? 'column' : 'row';
      out[el.nodeId] = { axis };
    } else if (display === 'grid' && el.nodeId) {
      // Phase 1 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — track grid as its own
      // axis outcome alongside row/column, so the new geometry-grid detector
      // can be diffed against legacy's grid-producing paths (constraint
      // transcriber's 1×N GRID axis, figma-build's inferCardGrids).
      out[el.nodeId] = { axis: 'grid' };
    }
    (el.children || []).forEach(walk);
  })(tree);
  return out;
}

/** Run the NEW geometry stage + feed its hints into layout.interpret, then
 *  collect the top-scoring mode per node → { sourceNodeId: { axis } }. */
async function collectNewDecisions(rawDoc, graphId) {
  const ws = createWorkspace();
  const ndg = await materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    document: rawDoc,
    graphId,
  });
  const graph = ndg.graph;
  const index = indexGraph(graph);
  const detected = detectGeometry(graph, {});
  const interpretations = interpretGraph(graph, index, {
    recognitionHintsByNode: detected.recognitionHintsByNode,
  });

  const bySourceId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = {};
  for (const interp of interpretations) {
    const top = interp.modeCandidates[0];
    if (!top) continue;
    const axis = top.mode === 'flow-row' ? 'row'
      : top.mode === 'flow-column' ? 'column'
      : top.mode === 'grid-track' ? 'grid'
      : null;
    if (!axis) continue;
    const node = bySourceId.get(interp.nodeId);
    const sourceNodeId = node ? node.sourceNodeId : null;
    if (sourceNodeId) out[sourceNodeId] = { axis, cues: top.cues };
  }
  return { decisions: out, candidateCount: detected.metrics.candidateCount };
}

async function main() {
  const fixtureDir = process.argv[2] || 'c0kt3mp76RoEiq3CFoeCHa__1_2';
  const rootId = process.argv[3] || '1:4';
  const cacheDir = path.join(__dirname, '..', 'output', 'figma-cache', fixtureDir);
  const docPath = path.join(cacheDir, 'document.json');
  if (!fs.existsSync(docPath)) {
    console.error(`Fixture not found: ${docPath}`);
    process.exit(1);
  }
  const cached = JSON.parse(fs.readFileSync(docPath, 'utf8'));
  const full = cached.document || cached;
  const root = findNode(full, rootId) || full;

  // LEGACY path — real production analyze(), unmodified call.
  const analyzed = figmaBuild.analyze(root, { emitMode: 'standard' });
  const legacy = collectLegacyDecisions(analyzed.tree);

  // NEW path — Phase 0 geometry recognition + layout.interpret.
  const documentForNdg = {
    id: 'g:dual-run:root',
    name: 'Document',
    type: 'DOCUMENT',
    children: [{ id: 'g:dual-run:page', name: 'Page 1', type: 'CANVAS', children: [root] }],
  };
  const { decisions: fresh, candidateCount } = await collectNewDecisions(
    documentForNdg,
    `g:dual-run:${fixtureDir}:${rootId}`
  );

  const allIds = new Set([...Object.keys(legacy), ...Object.keys(fresh)]);
  let agree = 0;
  let legacyOnly = 0;
  let newOnly = 0;
  let disagree = 0;
  const disagreements = [];

  for (const id of allIds) {
    const l = legacy[id];
    const n = fresh[id];
    if (l && n) {
      if (l.axis === n.axis) agree += 1;
      else { disagree += 1; disagreements.push({ id, legacy: l.axis, new: n.axis }); }
    } else if (l && !n) legacyOnly += 1;
    else if (!l && n) newOnly += 1;
  }

  console.log(`\nDual-run decision diff — ${fixtureDir} / ${rootId}`);
  console.log('='.repeat(60));
  console.log(`Legacy (inferFlow) decisions : ${Object.keys(legacy).length}`);
  console.log(`New (geometry-ir) decisions  : ${Object.keys(fresh).length}  (candidates evaluated: ${candidateCount})`);
  console.log(`Agree                        : ${agree}`);
  console.log(`Legacy-only (new missed)     : ${legacyOnly}`);
  console.log(`New-only (legacy missed)     : ${newOnly}`);
  console.log(`Disagree (different axis)    : ${disagree}`);
  if (disagreements.length) {
    console.log('\nDisagreements:');
    disagreements.forEach((d) => console.log(`  ${d.id}: legacy=${d.legacy} new=${d.new}`));
  }
  console.log('');

  // Phase 0 exit criterion: zero disagreements on nodes both paths evaluated.
  // legacyOnly/newOnly are expected and fine at this phase — the new stage's
  // scope (uniform-gap row/column only) is intentionally narrower than the
  // full legacy heuristic set (which also covers uneven gaps, grids, etc.,
  // migrated in later phases).
  process.exit(disagree > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
