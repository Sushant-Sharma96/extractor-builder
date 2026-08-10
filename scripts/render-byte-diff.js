#!/usr/bin/env node
'use strict';

/**
 * Phase 3 (docs/COMPILER_MIGRATION_BLUEPRINT.md §6) — full HTML/CSS byte-diff
 * between the LEGACY emitter path (server/figma-build.js's analyze()+emit(),
 * confirmed the actual shipping HTML/CSS producer — compiler/artifacts/index.js's
 * emitArtifacts() calls exactly this) and the NEW Phase-3 renderer
 * (compiler/emit/render/materialize-html.js), gated on the Articles fixture
 * first per the blueprint's explicit instruction.
 *
 * Usage: node scripts/render-byte-diff.js [fixtureDir]
 *   default fixture: output/figma-cache/c0kt3mp76RoEiq3CFoeCHa__1_848 (Articles)
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

const figmaBuild = require('../server/figma-build');
const { materializeNormalizedDesignGraph } = require('../compiler/ndg');
const { createWorkspace } = require('../compiler/workspace');
const { indexGraph } = require('../compiler/layout/collect');
const { interpretGraph } = require('../compiler/layout/interpret');
const { detectGeometry } = require('../compiler/geometry');
const { detectComponentGeometry } = require('../compiler/rulepack/packs/component-detect/geometry-rules');
const { materializeHtml } = require('../compiler/emit/render/materialize-html');
const { solidFillCss } = require('../compiler/emit/render/css-declarations');

function loadArticles(cacheDir) {
  const doc = JSON.parse(fs.readFileSync(path.join(cacheDir, 'document.json'), 'utf8'));
  return doc.document || doc;
}

function runLegacy(document) {
  const analyzed = figmaBuild.analyze(document, { emitMode: 'auto' });
  const emitted = figmaBuild.emit(analyzed.tree, { title: 'Articles' });
  return { html: emitted.html, css: emitted.css };
}

async function runNew(document, graphId) {
  const ws = createWorkspace();
  const ndg = await materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    document,
    graphId,
  });
  const graph = ndg.graph;
  const index = indexGraph(graph);
  const detectedGeometry = detectGeometry(graph, {});
  const interpretations = interpretGraph(graph, index, {
    recognitionHintsByNode: detectedGeometry.recognitionHintsByNode,
  });
  const interpByNodeId = new Map(interpretations.map((i) => [i.nodeId, i]));

  const geometryCandidatesByNode = {};
  for (const c of detectedGeometry.candidates || []) {
    geometryCandidatesByNode[c.nodeId] = c;
  }
  const detectedComponent = detectComponentGeometry(graph, { geometryCandidatesByNode });
  const cardByNodeId = new Map((detectedComponent.cardFacts || []).map((c) => [c.nodeId, c]));
  const bannerByNodeId = new Map((detectedComponent.bannerFacts || []).map((b) => [b.nodeId, b]));

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const roots = graph.nodes.filter((n) => {
    const kids = index.childrenOf.get(n.id) || [];
    // root candidates: nodes with no parent edge pointing to them
    return !graph.nodes.some((p) => (index.childrenOf.get(p.id) || []).some((k) => k.id === n.id));
  });

  function buildRenderNode(node, parentBox) {
    const interp = interpByNodeId.get(node.id);
    const top = interp && interp.modeCandidates && interp.modeCandidates[0];
    const cardFact = cardByNodeId.get(node.id);
    const bannerFact = bannerByNodeId.get(node.id);
    const mode = top ? top.mode : 'unknown';
    const layoutChoice = {
      mode,
      gap: interp ? interp.gap : null,
      padding: interp ? interp.padding : null,
      // Real fill data (Phase 3 item 3: image/SVG/text-fill resolution) —
      // node.paints comes straight from the NDG node, same source legacy's
      // paintLayers/solidFillCss reads from.
      fillCss: solidFillCss(node.paints),
    };
    if (mode === 'absolute' && node.box && parentBox) {
      layoutChoice.left = node.box.x - parentBox.x;
      layoutChoice.top = node.box.y - parentBox.y;
    }
    if (cardFact) {
      layoutChoice.cardShape = cardFact.shape;
      layoutChoice.cardFact = { shape: cardFact.shape, padding: cardFact.padding };
    }
    if (bannerFact) {
      layoutChoice.bannerShape = true;
      layoutChoice.bannerFact = { padding: bannerFact.padding };
    }

    const kids = (index.childrenOf.get(node.id) || []).map((k) => byId.get(k.id)).filter(Boolean);
    return {
      nodeId: node.sourceNodeId,
      type: node.type,
      name: node.name,
      characters: node.attributes && node.attributes.characters,
      fontSize: node.attributes && node.attributes.fontSize,
      // Per-character text-style overrides now carried on NDG TEXT nodes
      // (compiler/ndg/ingest.js, additive). textRuns()/runStyleCss() in
      // materialize-html.js consume these to reproduce legacy's inline
      // <span style="color:..."> run styling. Absent on nodes with no runs.
      characterStyleOverrides: node.attributes && node.attributes.characterStyleOverrides,
      styleOverrideTable: node.attributes && node.attributes.styleOverrideTable,
      layoutChoice,
      box: node.box,
      fillCss: layoutChoice.fillCss,
      clips: node.attributes && node.attributes.overflow === 'HIDDEN',
      children: kids.map((k) => buildRenderNode(k, node.box)),
    };
  }

  const rootNode = roots[0] || graph.nodes[0];
  const renderTree = buildRenderNode(rootNode, null);
  return materializeHtml(renderTree, {
    title: 'Articles',
    canvas: { fillCss: renderTree.fillCss, box: renderTree.box, clips: renderTree.clips },
  });
}

function diffLines(label, a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const max = Math.max(la.length, lb.length);
  let firstDiff = -1;
  let diffCount = 0;
  for (let i = 0; i < max; i += 1) {
    if (la[i] !== lb[i]) {
      diffCount += 1;
      if (firstDiff < 0) firstDiff = i;
    }
  }
  console.log(`\n--- ${label} ---`);
  console.log(`legacy: ${la.length} lines, ${Buffer.byteLength(a, 'utf8')} bytes`);
  console.log(`new:    ${lb.length} lines, ${Buffer.byteLength(b, 'utf8')} bytes`);
  console.log(`differing lines: ${diffCount} / ${max}`);
  if (firstDiff >= 0) {
    console.log(`first diff at line ${firstDiff + 1}:`);
    console.log(`  legacy: ${JSON.stringify((la[firstDiff] || '').slice(0, 200))}`);
    console.log(`  new:    ${JSON.stringify((lb[firstDiff] || '').slice(0, 200))}`);
  } else {
    console.log('IDENTICAL — byte match.');
  }
  return { legacyLines: la.length, newLines: lb.length, differingLines: diffCount, match: firstDiff < 0 };
}

async function main() {
  const cacheDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'output', 'figma-cache', 'c0kt3mp76RoEiq3CFoeCHa__1_848');
  const document = loadArticles(cacheDir);

  const legacy = runLegacy(document);
  const fresh = await runNew(document, 'g:figma:render-byte-diff:articles');

  const htmlResult = diffLines('HTML', legacy.html, fresh.html);
  const cssResult = diffLines('CSS', legacy.css, fresh.css);

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({ html: htmlResult, css: cssResult }, null, 2));
}

main().catch((e) => {
  console.error('[render-byte-diff] FATAL', e);
  process.exit(1);
});
