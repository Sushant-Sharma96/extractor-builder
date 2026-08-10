#!/usr/bin/env node
'use strict';

/**
 * Phase 4 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — responsive dual-run.
 *
 * Per this phase's own validation instruction: "dual-run across corpus at
 * three viewport widths (desktop/tablet/mobile), structural diff per
 * breakpoint" — NOT a byte-diff (see Phase 3's STATUS notes for why
 * byte-parity was explicitly rejected as this migration's validation bar).
 *
 * IMPORTANT, stated plainly up front: legacy (server/figma-build.js) makes
 * NO per-node responsive decision at all. It ships one FIXED, class-keyed
 * stylesheet (RESPONSIVE_STANDARDS_BLOCK — compiler/emit/render/utility-css.js,
 * a verbatim port) with three hardcoded breakpoints (1100/900/720px) that
 * apply the SAME rule to every node carrying a given marker class
 * (`.et-flow-row`, `.et-banner`, `.et-card-grid`, ...). There is no
 * "legacy's per-node Fact" to diff against 1:1 — the best available oracle
 * is legacy's own documented class-selector behavior, simulated per node
 * from its marker classes. This script builds that simulation explicitly
 * (`legacyStrategyAt()` below) and diffs it against the new stage's real,
 * per-node ResponsiveIR Adaptation Facts (compiler/responsive/detect.js) —
 * a coarse-but-real structural comparison, not a byte-diff, and not a
 * pretend 1:1 Fact comparison either. Any mismatch is reported as
 * "disagree", not silently dropped.
 *
 * Usage: node scripts/responsive-dual-run.js [fixtureDir]
 *   Runs both named fixtures (Articles, IBM) when no argument is given.
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
const { detectResponsive, STRATEGY } = require('../compiler/responsive');

const VIEWPORTS = [
  { label: 'mobile', width: 375 },
  { label: 'tablet', width: 768 },
  { label: 'desktop', width: 1280 },
];

function loadDocument(cacheDir) {
  const doc = JSON.parse(fs.readFileSync(path.join(cacheDir, 'document.json'), 'utf8'));
  return doc.document || doc;
}

/** Legacy tree walk -> { sourceNodeId: Set(marker classes) }. */
function collectLegacyClasses(tree) {
  const out = {};
  (function walk(el) {
    if (!el) return;
    if (el.nodeId) {
      const tokens = String(el.extraClass || '').split(/\s+/).filter(Boolean);
      out[el.nodeId] = new Set(tokens);
    }
    (el.children || []).forEach(walk);
  })(tree);
  return out;
}

/**
 * Simulate legacy's per-node responsive behavior AT a given viewport width,
 * purely from the RESPONSIVE_STANDARDS_BLOCK's own documented selectors
 * (compiler/emit/render/utility-css.js — a verbatim port, so this is
 * evaluating the SAME rule text legacy ships, not an approximation of it).
 *
 * @param {Set<string>} classes
 * @param {number} width
 * @returns {'stack'|'wrap'|'hide'|'base'}
 */
function legacyStrategyAt(classes, width) {
  const has = (c) => classes.has(c);
  const isFlowRow = has('et-flow-row');
  const isBanner = has('et-banner');
  const isCardGrid = has('et-card-grid');
  // Selector exclusions from the `@media (max-width: 1100px)` et-flow-row
  // stacking rule (utility-css.js RESPONSIVE_STANDARDS_BLOCK).
  const excludedFromRowStack = has('et-card-grid') || has('et-banner')
    || has('et-section-eyebrow') || has('et-flow-col') || has('et-card') || has('et-title-link-row');

  if (isCardGrid && !has('et-measured-grid')) {
    // `.et-card-grid:not(.et-measured-grid)` always wraps (flex-wrap:wrap),
    // at every width the standards block defines — not a breakpoint-gated
    // decision, a constant. Reported as its own bucket ('wrap'), not folded
    // into 'stack', so it is never miscounted as agreeing/disagreeing with
    // a STACK adaptation.
    return 'wrap';
  }
  if (width <= 720 && isBanner) return 'stack';
  if (width <= 1100 && isFlowRow && !excludedFromRowStack) return 'stack';
  return 'base';
}

/** Map a ResponsiveIR strategy + its atBreakpointIds to a per-width decision. */
function newStrategyAt(adaptation, width, bpById) {
  if (!adaptation || adaptation.strategy === STRATEGY.ABSTAIN) return 'base';
  const applies = (adaptation.atBreakpointIds || []).some((bpId) => {
    const bp = bpById.get(bpId);
    if (!bp) return false;
    // An adaptation "applies" at a queried width when the queried width is
    // at or below the breakpoint's own widthHint (mobile-first, matches how
    // responsive-media.js emits `@media (max-width: widthHint)`) — except
    // `bp:wide` adaptations (e.g. STRATEGY.ROW), which represent the base
    // desktop state, not an override (see responsive-media.js's doc
    // comment) and are therefore never counted as a distinct decision here.
    if (bp.kind === 'wide') return false;
    return width <= bp.widthHint;
  });
  if (!applies) return 'base';
  if (adaptation.strategy === STRATEGY.STACK) return 'stack';
  if (adaptation.strategy === STRATEGY.WRAP) return 'wrap';
  if (adaptation.strategy === STRATEGY.HIDE) return 'hide';
  return 'other'; // shrink/fixed/space-tighten/space-preserve/show — no legacy analogue simulated
}

async function runFixture(cacheDir, label) {
  const document = loadDocument(cacheDir);

  // LEGACY — real production analyze(), unmodified call.
  const analyzed = figmaBuild.analyze(document, { emitMode: 'auto' });
  const legacyClassesBySourceId = collectLegacyClasses(analyzed.tree);

  // NEW — NDG -> geometry -> layout.interpret -> ResponsiveIR (detectResponsive).
  const ws = createWorkspace();
  const ndg = await materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: 'pixel-faithful' },
    document,
    graphId: `g:figma:responsive-dual-run:${label}`,
  });
  const graph = ndg.graph;
  const index = indexGraph(graph);
  const detectedGeometry = detectGeometry(graph, {});
  const interpretations = interpretGraph(graph, index, {
    recognitionHintsByNode: detectedGeometry.recognitionHintsByNode,
  });
  const layoutIrLike = {
    payload: {
      nodes: interpretations.map((i) => ({
        nodeId: i.nodeId,
        mode: i.modeCandidates && i.modeCandidates[0] ? i.modeCandidates[0].mode : 'unknown',
      })),
    },
  };
  const detected = detectResponsive(graph, { layoutIr: layoutIrLike, policy: {} });

  const bySourceId = new Map(graph.nodes.map((n) => [n.id, n.sourceNodeId]));
  const bpById = new Map(detected.breakpoints.map((b) => [b.breakpointId, b]));
  const adaptationByGraphId = new Map(detected.adaptations.map((a) => [a.nodeId, a]));

  const results = {};
  for (const vp of VIEWPORTS) {
    let agree = 0;
    let disagree = 0;
    let newOnly = 0;
    let legacyOnly = 0;
    const disagreements = [];

    for (const [graphNodeId, sourceNodeId] of bySourceId) {
      const classes = legacyClassesBySourceId[sourceNodeId];
      if (!classes) continue; // node not materialized into the legacy tree (e.g. hidden/pruned)
      const legacy = legacyStrategyAt(classes, vp.width);
      const adaptation = adaptationByGraphId.get(graphNodeId);
      const fresh = newStrategyAt(adaptation, vp.width, bpById);

      if (legacy === 'base' && fresh === 'base') continue; // both silent — not a decision either path made
      if (legacy !== 'base' && fresh === 'base') { legacyOnly += 1; continue; }
      if (legacy === 'base' && fresh !== 'base') { newOnly += 1; continue; }
      if (legacy === fresh) agree += 1;
      else {
        disagree += 1;
        disagreements.push({ sourceNodeId, legacy, new: fresh });
      }
    }

    results[vp.label] = {
      width: vp.width, agree, disagree, newOnly, legacyOnly, disagreements: disagreements.slice(0, 5),
    };
  }

  return {
    label,
    breakpointCount: detected.breakpoints.length,
    adaptationCount: detected.adaptations.length,
    results,
  };
}

async function main() {
  const fixtures = process.argv[2]
    ? [{ dir: process.argv[2], label: path.basename(process.argv[2]) }]
    : [
      { dir: 'c0kt3mp76RoEiq3CFoeCHa__1_848', label: 'articles' },
      { dir: 'oPJPuHvvZOPo4nkzVxr11M__11_79', label: 'ibm' },
    ];

  const summary = {};
  for (const f of fixtures) {
    const cacheDir = path.isAbsolute(f.dir) ? f.dir : path.join(__dirname, '..', 'output', 'figma-cache', f.dir);
    if (!fs.existsSync(path.join(cacheDir, 'document.json'))) {
      console.error(`Fixture not found, skipping: ${cacheDir}`);
      continue;
    }
    console.log(`\n=== ${f.label} (${f.dir}) ===`);
    const out = await runFixture(cacheDir, f.label);
    summary[f.label] = out;
    for (const vp of VIEWPORTS) {
      const r = out.results[vp.label];
      console.log(`  ${vp.label} (${vp.width}px): agree=${r.agree} disagree=${r.disagree} newOnly=${r.newOnly} legacyOnly=${r.legacyOnly}`);
      if (r.disagreements.length) {
        r.disagreements.forEach((d) => console.log(`    disagree: ${d.sourceNodeId} legacy=${d.legacy} new=${d.new}`));
      }
    }
  }

  console.log('\n=== SUMMARY (JSON) ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error('[responsive-dual-run] FATAL', e);
  process.exit(1);
});
