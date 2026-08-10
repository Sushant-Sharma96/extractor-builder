#!/usr/bin/env node
'use strict';

/**
 * freeform-layout-ir — real-fixture validation.
 *
 * Read-only diagnostic (mirrors scripts/validate-row-set-challenge-arena.js's
 * pattern): loads BOTH real cached Figma documents, materializes each into a
 * real NDG graph via the same compiler/ndg pipeline the test suite uses,
 * runs the new detectFreeformLayout() against each, and reports the actual
 * RepeatingGroupMembership facts produced — verbatim, including whether
 * Challenge Arena's row-1 wrapper asymmetry is genuinely closed (all 5
 * columns present, no unexpected nulls) or not.
 *
 * Does not modify anything under server/ or wire into any renderer.
 *
 * Usage: node scripts/validate-freeform-layout-ir.js
 */

const path = require('path');
const fs = require('fs');

const { detectComponents } = require('../compiler/components');
const { detectFreeformLayout } = require('../compiler/freeform-layout');
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

async function loadGraph(cacheDirName, rootSourceId, graphId) {
  const cacheDir = path.join(__dirname, '..', 'output', 'figma-cache', cacheDirName);
  const doc = JSON.parse(fs.readFileSync(path.join(cacheDir, 'document.json'), 'utf8'));
  const full = doc.document || doc;
  const root = rootSourceId ? findNode(full, rootSourceId) : full;
  if (!root) throw new Error(`node ${rootSourceId} not found in ${cacheDirName}`);
  const ws = createWorkspace();
  const ndg = await materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    document: root,
    graphId,
  });
  return ndg.graph;
}

function idFor(graph, sourceNodeId) {
  const n = (graph.nodes || []).find((x) => x.sourceNodeId === sourceNodeId);
  return n ? n.id : null;
}

function printGroup(graph, g) {
  const srcOf = (nodeId) => {
    const n = (graph.nodes || []).find((x) => x.id === nodeId);
    return n ? n.sourceNodeId : null;
  };
  console.log(`  groupId=${g.groupId} containerNodeId=${g.containerNodeId} (source ${srcOf(g.containerNodeId)}) axis=${g.axis} memberCount=${g.memberCount} seedHint=${g.seedHint}`);
  console.log(`  columns (${g.columns.length}):`);
  for (const c of g.columns) {
    console.log(`    columnId=${c.columnId} order=${c.order} x=${c.x} width=${c.width}`);
  }
  console.log('  members:');
  for (const m of g.members) {
    const nulls = Object.entries(m.memberColumnMap).filter(([, v]) => v === null).map(([k]) => k);
    console.log(`    slotIndex=${m.slotIndex} nodeId=${m.nodeId} (source ${srcOf(m.nodeId)}) nullColumns=${JSON.stringify(nulls)}`);
  }
}

async function main() {
  console.log('=== freeform-layout-ir validation — Articles (c0kt3mp76RoEiq3CFoeCHa__1_848) ===');
  const articlesGraph = await loadGraph('c0kt3mp76RoEiq3CFoeCHa__1_848', null, 'g-validate-freeform-articles');
  const articlesComponent = detectComponents(articlesGraph, {});
  const articlesFreeform = detectFreeformLayout(articlesGraph, { componentDetected: articlesComponent });
  console.log('total nodes:', articlesGraph.nodes.length);
  console.log('groups found:', articlesFreeform.groups.length);
  for (const g of articlesFreeform.groups) printGroup(articlesGraph, g);

  const cardsParentId = idFor(articlesGraph, '1:849');
  const cardGroup = articlesFreeform.groups.find((g) => g.containerNodeId === cardsParentId);
  console.log('\n--- Articles assertions ---');
  if (!cardGroup) {
    console.log('RESULT: FAIL — no RepeatingGroupMembership group found for the 3-card parent (source 1:849).');
  } else {
    console.log(`axis === 'row': ${cardGroup.axis === 'row'}`);
    console.log(`memberCount === 3: ${cardGroup.memberCount === 3}`);
    const totalNulls = cardGroup.members.reduce((n, m) => n + Object.values(m.memberColumnMap).filter((v) => v === null).length, 0);
    console.log(`total nulls across all 3 members: ${totalNulls} (expected 0)`);
    console.log(`RESULT: ${cardGroup.axis === 'row' && cardGroup.memberCount === 3 && totalNulls === 0 ? 'PASS' : 'PARTIAL/FAIL — see numbers above'}`);
  }

  console.log('\n=== freeform-layout-ir validation — Challenge Arena (c0kt3mp76RoEiq3CFoeCHa__1_2) ===');
  const arenaGraph = await loadGraph('c0kt3mp76RoEiq3CFoeCHa__1_2', '1:4', 'g-validate-freeform-arena');
  const arenaComponent = detectComponents(arenaGraph, {});
  const arenaFreeform = detectFreeformLayout(arenaGraph, { componentDetected: arenaComponent });
  console.log('total nodes:', arenaGraph.nodes.length);
  console.log('groups found:', arenaFreeform.groups.length);
  for (const g of arenaFreeform.groups) printGroup(arenaGraph, g);

  const tableId = idFor(arenaGraph, '1:326');
  const tableGroup = arenaFreeform.groups.find((g) => g.containerNodeId === tableId);
  console.log('\n--- Challenge Arena assertions ---');
  if (!tableGroup) {
    console.log('RESULT: FAIL — no RepeatingGroupMembership group found for the table node (source 1:326).');
  } else {
    console.log(`axis === 'column': ${tableGroup.axis === 'column'}`);
    console.log(`memberCount === 4: ${tableGroup.memberCount === 4}`);
    console.log(`columns.length === 5: ${tableGroup.columns.length === 5}`);
    const xs = tableGroup.columns.map((c) => c.x);
    console.log(`column x offsets: ${JSON.stringify(xs)} (design brief real values: [142,231,761,1039,1164])`);
    const widths = tableGroup.columns.map((c) => c.width);
    console.log(`column widths: ${JSON.stringify(widths)} (design brief real values: [40,424,212,87,123])`);

    const row1Node = (arenaGraph.nodes || []).find((n) => n.sourceNodeId === '1:327');
    const row1Member = row1Node && tableGroup.members.find((m) => m.nodeId === row1Node.id);
    if (!row1Member) {
      console.log('RESULT for row 1 (source 1:327): FAIL — row 1 is not a member of the recognized group.');
    } else {
      const row1Nulls = Object.entries(row1Member.memberColumnMap).filter(([, v]) => v === null);
      console.log(`row 1 (source 1:327) memberColumnMap null columns: ${JSON.stringify(row1Nulls.map(([k]) => k))} (expected: none — this is the asymmetry-closure test)`);
      console.log(`ROW-1 ASYMMETRY RESULT: ${row1Nulls.length === 0 ? 'CLOSED — row 1 maps onto all 5 columns with no nulls' : `NOT FULLY CLOSED — ${row1Nulls.length} null column(s) remain for row 1`}`);
    }

    const totalNulls = tableGroup.members.reduce((n, m) => n + Object.values(m.memberColumnMap).filter((v) => v === null).length, 0);
    console.log(`total nulls across all 4 rows: ${totalNulls} (expected 0 if fully closed)`);
  }
}

main().catch((e) => {
  console.error('[validate-freeform-layout-ir] FATAL', e);
  process.exit(1);
});
