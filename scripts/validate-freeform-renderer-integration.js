#!/usr/bin/env node
'use strict';

/**
 * freeform-layout-ir renderer integration — real-fixture validation.
 *
 * Read-only diagnostic (mirrors scripts/validate-row-set-render.js's and
 * scripts/validate-freeform-layout-ir.js's pattern): for each of the 3 real
 * cached fixtures (Articles, IBM, Challenge Arena), runs BOTH
 *   (a) detectFreeformLayout() directly (the detection-stage output, same as
 *       validate-freeform-layout-ir.js, extended here to include IBM), and
 *   (b) renderIrExperimental() end-to-end (the renderer: 'ir-experimental'
 *       opt-in path), inspecting the literal generated HTML/CSS bytes for
 *       evidence of which decision tier fired per group/member (freeform
 *       grid decls, row-set fallback, card/banner fallback, or raw
 *       coordinate fallback).
 *
 * Does not modify anything under server/ or change any default behavior.
 *
 * Usage: node scripts/validate-freeform-renderer-integration.js
 */

const path = require('path');
const fs = require('fs');

const { detectComponents } = require('../compiler/components');
const { detectFreeformLayout } = require('../compiler/freeform-layout');
const { materializeNormalizedDesignGraph } = require('../compiler/ndg');
const { createWorkspace } = require('../compiler/workspace');
const { renderIrExperimental } = require('../compiler/artifacts/ir-experimental-renderer');

function findNode(n, id) {
  if (!n) return null;
  if (n.id === id) return n;
  for (const c of n.children || []) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return null;
}

function loadDoc(cacheDirName) {
  const cacheDir = path.join(__dirname, '..', 'output', 'figma-cache', cacheDirName);
  const doc = JSON.parse(fs.readFileSync(path.join(cacheDir, 'document.json'), 'utf8'));
  return doc.document || doc;
}

async function loadGraph(rootDoc, graphId) {
  const ws = createWorkspace();
  const ndg = await materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    document: rootDoc,
    graphId,
  });
  return ndg.graph;
}

function srcOf(graph, nodeId) {
  const n = (graph.nodes || []).find((x) => x.id === nodeId);
  return n ? n.sourceNodeId : null;
}

async function runFixture(name, rootDoc, graphId) {
  console.log(`\n${'='.repeat(70)}\n=== ${name} ===\n${'='.repeat(70)}`);
  const graph = await loadGraph(rootDoc, `${graphId}-detect`);
  const component = detectComponents(graph, {});
  const freeform = detectFreeformLayout(graph, { componentDetected: component });

  console.log(`total nodes: ${graph.nodes.length}`);
  console.log(`freeform-layout-ir groups found: ${freeform.groups.length}`);
  for (const g of freeform.groups) {
    const nulls = g.members.reduce(
      (n, m) => n + Object.values(m.memberColumnMap).filter((v) => v === null).length,
      0
    );
    console.log(
      `  group=${g.groupId} container(src)=${srcOf(graph, g.containerNodeId)} axis=${g.axis} `
      + `memberCount=${g.memberCount} columns=${g.columns.length} seedHint=${g.seedHint} totalNulls=${nulls}`
    );
  }

  const rowSetContainerIds = new Set((component.rowSetPatterns || []).map((p) => p.nodeId));
  const cardGridContainerIds = new Set((component.cardGridPatterns || []).map((p) => p.nodeId));
  const freeformContainerIds = new Set(freeform.groups.map((g) => g.containerNodeId));

  console.log(`\nComponent IR rowSetPatterns containers: ${rowSetContainerIds.size}`);
  console.log(`Component IR cardGridPatterns containers: ${cardGridContainerIds.size}`);
  console.log('Mutual-exclusion check — row-set containers ALSO claimed by freeform-layout-ir (superseded):');
  for (const id of rowSetContainerIds) {
    if (freeformContainerIds.has(id)) console.log(`  SUPERSEDED: ${id} (src ${srcOf(graph, id)})`);
  }

  const rendered = await renderIrExperimental(rootDoc, {
    graphId: `${graphId}-render`,
    title: `${name} freeform-layout-ir integration validation`,
  });

  const outDir = path.join(__dirname, '..', 'output');
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  fs.writeFileSync(path.join(outDir, `freeform-render-${base}.html`), rendered.html);
  fs.writeFileSync(path.join(outDir, `freeform-render-${base}.css`), rendered.css);

  const gridRules = [...rendered.css.matchAll(/\.([a-z0-9-]+)\s*\{\n([^}]*)\}/g)]
    .filter(([, , body]) => /display:\s*grid/.test(body));
  const contentsRules = [...rendered.css.matchAll(/\.([a-z0-9-]+)\s*\{\n([^}]*)\}/g)]
    .filter(([, , body]) => /display:\s*contents/.test(body));
  const noneRules = [...rendered.css.matchAll(/\.([a-z0-9-]+)\s*\{\n([^}]*)\}/g)]
    .filter(([, , body]) => /display:\s*none/.test(body));
  const gridColumnPlacement = [...rendered.css.matchAll(/grid-column:\s*(\d+)/g)].map((m) => m[1]);
  const gridRowPlacement = [...rendered.css.matchAll(/grid-row:\s*(\d+)/g)].map((m) => m[1]);

  console.log(`\nRendered HTML bytes: ${rendered.html.length}, CSS bytes: ${rendered.css.length}`);
  console.log(`display:grid rules: ${gridRules.length}`);
  console.log(`display:contents rules: ${contentsRules.length}`);
  console.log(`display:none rules: ${noneRules.length}`);
  console.log(`explicit grid-column placements found: ${gridColumnPlacement.length} ${JSON.stringify(gridColumnPlacement)}`);
  console.log(`explicit grid-row placements found: ${gridRowPlacement.length} ${JSON.stringify(gridRowPlacement)}`);
  for (const [, cls, body] of gridRules) {
    console.log(`\n.${cls} {\n${body}}`);
  }

  return {
    name, graph, freeform, rendered, gridRules, contentsRules, noneRules, gridColumnPlacement, gridRowPlacement,
  };
}

async function main() {
  const articlesDoc = loadDoc('c0kt3mp76RoEiq3CFoeCHa__1_848');
  const arenaFull = loadDoc('c0kt3mp76RoEiq3CFoeCHa__1_2');
  const arenaDoc = findNode(arenaFull, '1:4');
  const ibmDoc = loadDoc('oPJPuHvvZOPo4nkzVxr11M__11_79');

  await runFixture('Articles', articlesDoc, 'g-validate-freeform-render-articles');
  await runFixture('ChallengeArena', arenaDoc, 'g-validate-freeform-render-arena');
  await runFixture('IBM', ibmDoc, 'g-validate-freeform-render-ibm');
}

main().catch((e) => {
  console.error('[validate-freeform-renderer-integration] FATAL', e);
  process.exit(1);
});
