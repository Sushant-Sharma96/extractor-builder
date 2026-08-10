#!/usr/bin/env node
'use strict';

/**
 * Row-set (repeating-pattern / table) recognition — real-fixture validation.
 *
 * Read-only diagnostic (mirrors scripts/dual-run-compare.js's pattern): loads
 * the REAL cached Challenge Arena Figma document (output/figma-cache/
 * c0kt3mp76RoEiq3CFoeCHa__1_2/document.json), materializes it into a real NDG
 * graph via the same compiler/ndg pipeline the test suite uses, runs the new
 * detectComponentGeometry row-set detector against it, and reports whether
 * the actual 4-row "challenge" table (node 1:326, named "table") is
 * recognized as one row-set — plus the exact column x/width boundaries
 * computed across the 4 rows.
 *
 * This script does not modify anything under server/ or wire into the
 * renderer — it only calls the new pure detector
 * (compiler/rulepack/packs/component-detect/geometry-rules.js) against a
 * real graph and prints the result.
 *
 * Usage: node scripts/validate-row-set-challenge-arena.js
 */

const path = require('path');
const fs = require('fs');

const { detectComponentGeometry } = require('../compiler/rulepack/packs/component-detect/geometry-rules');
const { materializeNormalizedDesignGraph } = require('../compiler/ndg');
const { createWorkspace } = require('../compiler/workspace');

function findNode(n, id) {
  if (!n) return null;
  if (n.id === id) return n;
  for (const c of n.children || []) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return null;
}

async function main() {
  const cacheDir = path.join(__dirname, '..', 'output', 'figma-cache', 'c0kt3mp76RoEiq3CFoeCHa__1_2');
  const doc = JSON.parse(fs.readFileSync(path.join(cacheDir, 'document.json'), 'utf8'));
  const full = doc.document || doc;
  const arena = findNode(full, '1:4'); // "Challenge Arena" section
  if (!arena) throw new Error('Node 1:4 Challenge Arena not found in cache');

  const ws = createWorkspace();
  const ndg = await materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    document: arena,
    graphId: 'g-validate-row-set-challenge-arena',
  });

  const graph = ndg.graph;
  const geo = detectComponentGeometry(graph, {});

  // Resolve the "table" node's NDG id from its source id (1:326), same
  // idFor() pattern component-geometry.test.js uses.
  const tableGraphNode = (graph.nodes || []).find((n) => n.sourceNodeId === '1:326');
  const tableId = tableGraphNode ? tableGraphNode.id : null;

  console.log('=== Row-set validation against REAL Challenge Arena fixture ===');
  console.log('graphId:', graph.graphId);
  console.log('total nodes:', (graph.nodes || []).length);
  console.log('rowSetFacts found (whole Challenge Arena subtree):', geo.rowSetFacts.length);
  for (const r of geo.rowSetFacts) {
    const srcNode = (graph.nodes || []).find((n) => n.id === r.nodeId);
    console.log(`  - nodeId=${r.nodeId} sourceNodeId=${srcNode && srcNode.sourceNodeId} rows=${r.orderedChildIds.length} columns=${r.columns.length} gap=${r.gap}`);
  }

  if (!tableId) {
    console.log('\nRESULT: FAIL — could not resolve NDG id for source node 1:326 ("table")');
    process.exit(1);
  }

  const tableRowSet = geo.rowSetFacts.find((r) => r.nodeId === tableId);
  if (!tableRowSet) {
    console.log('\nRESULT: FAIL — the "table" node (1:326) was NOT recognized as a row-set.');
    process.exit(1);
  }

  console.log('\nRESULT: PASS — the "table" node (1:326) was recognized as a row-set.');
  console.log('  rows recognized:', tableRowSet.orderedChildIds.length, '(expected 4 — the TH header sibling correctly excluded)');
  console.log('  gap:', tableRowSet.gap);
  console.log('  columns (x, width, rowCount out of 4):');
  for (const c of tableRowSet.columns) {
    console.log(`    x=${c.x} width=${c.width} rowCount=${c.rowCount}`);
  }
}

main().catch((e) => {
  console.error('[validate-row-set-challenge-arena] FATAL', e);
  process.exit(1);
});
